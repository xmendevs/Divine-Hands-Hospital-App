package store

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

// Billing errors.
var (
	ErrInvalidBillingTransition = errors.New("invalid billing transition")
	ErrShiftRequired            = errors.New("open a cashier shift first")
	ErrShiftOpen                = errors.New("cashier already has an open shift")
	ErrNotShiftOwner            = errors.New("only the shift cashier can close this shift")
	ErrRefundLimit              = errors.New("refund exceeds refundable amount")
	ErrOverpayment              = errors.New("payment exceeds balance due")
	ErrInvalidPaymentMethod     = errors.New("unsupported payment method")
	ErrDiscountExceedsSubtotal  = errors.New("discount cannot exceed subtotal")
)

// basePaymentMethods are the always-valid payment methods.
var basePaymentMethods = []string{
	domain.BillingPaymentMethodCash,
	domain.BillingPaymentMethodTransfer,
	domain.BillingPaymentMethodPOS,
	domain.BillingPaymentMethodCard,
	domain.BillingPaymentMethodOnline,
	domain.BillingPaymentMethodInsurance,
	domain.BillingPaymentMethodCorporate,
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

func nextBillingCode(ctx context.Context, q querier, seq, prefix string) (string, error) {
	var n int64
	if err := q.QueryRow(ctx, `SELECT nextval('`+seq+`')`).Scan(&n); err != nil {
		return "", err
	}
	return prefix + lpadInt(n, 6), nil
}

// paymentMethodAllowed reports whether m is a base or custom-configured method.
func (s *Store) paymentMethodAllowed(ctx context.Context, m string) (bool, error) {
	for _, b := range basePaymentMethods {
		if m == b {
			return true, nil
		}
	}
	var val []byte
	err := s.pool.QueryRow(ctx, `SELECT value FROM system_settings WHERE key = 'billing.custom_payment_methods'`).Scan(&val)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var customs []string
	if json.Unmarshal(val, &customs) != nil {
		return false, nil
	}
	for _, c := range customs {
		if m == c {
			return true, nil
		}
	}
	return false, nil
}

// ---- price lists ----

const priceListCols = `id::text, name, currency, description, valid_from::text, valid_to::text,
	status::text, created_by::text, created_at, updated_at`

func scanPriceList(r pgx.Row) (*domain.PriceList, error) {
	var p domain.PriceList
	err := r.Scan(&p.ID, &p.Name, &p.Currency, &p.Description, &p.ValidFrom, &p.ValidTo,
		&p.Status, &p.CreatedBy, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// CreatePriceListParams carries a new price list.
type CreatePriceListParams struct {
	Name        string
	Currency    string
	Description string
	ValidFrom   string
	ValidTo     string
	CreatedBy   string
}

// CreatePriceList registers a price list, defaulting currency from settings.
func (s *Store) CreatePriceList(ctx context.Context, p CreatePriceListParams) (*domain.PriceList, error) {
	if p.Currency == "" {
		cur, err := s.getStringSetting(ctx, "billing.currency", "NGN")
		if err != nil {
			return nil, err
		}
		p.Currency = cur
	}
	pl, err := scanPriceList(s.pool.QueryRow(ctx, `
		INSERT INTO price_lists (name, currency, description, valid_from, valid_to, created_by)
		VALUES ($1, $2, $3, $4::date, $5::date, $6::uuid)
		RETURNING `+priceListCols,
		p.Name, p.Currency, p.Description, nullableText(p.ValidFrom), nullableText(p.ValidTo),
		p.CreatedBy))
	if err != nil {
		return nil, err
	}
	return pl, nil
}

func (s *Store) getStringSetting(ctx context.Context, key, def string) (string, error) {
	var val []byte
	err := s.pool.QueryRow(ctx, `SELECT value FROM system_settings WHERE key = $1`, key).Scan(&val)
	if errors.Is(err, pgx.ErrNoRows) {
		return def, nil
	}
	if err != nil {
		return def, err
	}
	var out string
	if json.Unmarshal(val, &out) != nil {
		return def, nil
	}
	if out == "" {
		return def, nil
	}
	return out, nil
}

// GetPriceList returns a price list by internal UUID.
func (s *Store) GetPriceList(ctx context.Context, id string) (*domain.PriceList, error) {
	pl, err := scanPriceList(s.pool.QueryRow(ctx, `SELECT `+priceListCols+` FROM price_lists WHERE id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return pl, err
}

// ListPriceLists returns price lists, active first.
func (s *Store) ListPriceLists(ctx context.Context) ([]domain.PriceList, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+priceListCols+` FROM price_lists ORDER BY status = 'active' DESC, name ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.PriceList, 0)
	for rows.Next() {
		pl, err := scanPriceList(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *pl)
	}
	return out, rows.Err()
}

// UpdatePriceListParams carries editable price list fields.
type UpdatePriceListParams struct {
	Name        string
	Description string
	ValidFrom   string
	ValidTo     string
	Status      string
}

// UpdatePriceList updates a price list.
func (s *Store) UpdatePriceList(ctx context.Context, id string, p UpdatePriceListParams) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE price_lists SET name = $2, description = $3, valid_from = $4::date, valid_to = $5::date,
		                       status = $6, updated_at = now()
		WHERE id = $1::uuid`,
		id, p.Name, p.Description, nullableText(p.ValidFrom), nullableText(p.ValidTo), p.Status)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ---- price list items ----

const priceListItemCols = `id::text, price_list_id::text, code, name, category, unit, price,
	tax_rate, active, created_at, updated_at`

func scanPriceListItem(r pgx.Row) (*domain.PriceListItem, error) {
	var i domain.PriceListItem
	err := r.Scan(&i.ID, &i.PriceListID, &i.Code, &i.Name, &i.Category, &i.Unit, &i.Price,
		&i.TaxRate, &i.Active, &i.CreatedAt, &i.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &i, nil
}

// CreatePriceListItemParams carries a billable service.
type CreatePriceListItemParams struct {
	PriceListID string
	Code        string
	Name        string
	Category    string
	Unit        string
	Price       float64
	TaxRate     float64
}

// CreatePriceListItem adds a billable service to a price list.
func (s *Store) CreatePriceListItem(ctx context.Context, p CreatePriceListItemParams) (*domain.PriceListItem, error) {
	i, err := scanPriceListItem(s.pool.QueryRow(ctx, `
		INSERT INTO price_list_items (price_list_id, code, name, category, unit, price, tax_rate)
		VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
		RETURNING `+priceListItemCols,
		p.PriceListID, p.Code, p.Name, p.Category, p.Unit, p.Price, p.TaxRate))
	if err != nil {
		return nil, err
	}
	return i, nil
}

// ListPriceListItems returns the services of a price list.
func (s *Store) ListPriceListItems(ctx context.Context, priceListID string) ([]domain.PriceListItem, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+priceListItemCols+` FROM price_list_items WHERE price_list_id = $1::uuid ORDER BY code ASC`, priceListID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.PriceListItem, 0)
	for rows.Next() {
		i, err := scanPriceListItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *i)
	}
	return out, rows.Err()
}

// UpdatePriceListItemParams carries editable service fields.
type UpdatePriceListItemParams struct {
	Code     string
	Name     string
	Category string
	Unit     string
	Price    float64
	TaxRate  float64
	Active   bool
}

// UpdatePriceListItem updates a billable service.
func (s *Store) UpdatePriceListItem(ctx context.Context, id string, p UpdatePriceListItemParams) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE price_list_items SET code = $2, name = $3, category = $4, unit = $5, price = $6,
		                             tax_rate = $7, active = $8, updated_at = now()
		WHERE id = $1::uuid`,
		id, p.Code, p.Name, p.Category, p.Unit, p.Price, p.TaxRate, p.Active)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ---- invoices ----

const invoiceCols = `i.id::text, i.invoice_no, i.patient_id::text, i.price_list_id::text, i.currency,
	i.bill_to::text, i.payer_name, i.policy_number, i.subtotal, i.discount_amount, i.tax_amount,
	i.total_amount, i.amount_paid, i.status::text, i.issued_by::text, i.issued_at,
	i.void_reason, i.voided_by::text, i.voided_at, i.created_by::text, i.created_at, i.updated_at,
	COALESCE(p.patient_no, ''), COALESCE(p.first_name || ' ' || p.last_name, '')`

const invoiceFrom = ` FROM invoices i LEFT JOIN patients p ON p.id = i.patient_id`

func scanInvoice(r pgx.Row) (*domain.Invoice, error) {
	var inv domain.Invoice
	err := r.Scan(&inv.ID, &inv.InvoiceNo, &inv.PatientID, &inv.PriceListID, &inv.Currency,
		&inv.BillTo, &inv.PayerName, &inv.PolicyNumber, &inv.Subtotal, &inv.DiscountAmount, &inv.TaxAmount,
		&inv.TotalAmount, &inv.AmountPaid, &inv.Status, &inv.IssuedBy, &inv.IssuedAt,
		&inv.VoidReason, &inv.VoidedBy, &inv.VoidedAt, &inv.CreatedBy, &inv.CreatedAt, &inv.UpdatedAt,
		&inv.PatientNo, &inv.PatientName)
	if err != nil {
		return nil, err
	}
	return &inv, nil
}

const invoiceItemCols = `id::text, invoice_id::text, price_list_item_id::text, code, name, category,
	unit, quantity, unit_price, tax_rate, line_total, tax_amount`

const invoiceItemFrom = ` FROM invoice_items`

func scanInvoiceItem(r pgx.Row) (*domain.InvoiceItem, error) {
	var it domain.InvoiceItem
	err := r.Scan(&it.ID, &it.InvoiceID, &it.PriceListItemID, &it.Code, &it.Name, &it.Category,
		&it.Unit, &it.Quantity, &it.UnitPrice, &it.TaxRate, &it.LineTotal, &it.TaxAmount)
	if err != nil {
		return nil, err
	}
	return &it, nil
}

// InvoiceItemInput is one requested line at invoice creation.
type InvoiceItemInput struct {
	PriceListItemID string
	Quantity        float64
}

// CreateInvoiceParams carries a draft invoice.
type CreateInvoiceParams struct {
	PatientID      *string
	PriceListID    string
	BillTo         string
	PayerName      string
	PolicyNumber   string
	DiscountAmount float64
	Items          []InvoiceItemInput
	CreatedBy      string
}

// CreateInvoice drafts an invoice, snapshotting service prices from the
// active price list.
func (s *Store) CreateInvoice(ctx context.Context, p CreateInvoiceParams) (*domain.Invoice, error) {
	if len(p.Items) == 0 {
		return nil, errors.New("at least one item is required")
	}
	if p.BillTo == "" {
		p.BillTo = domain.BillingBillToPatient
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var currency, status string
	if err := tx.QueryRow(ctx, `SELECT currency, status::text FROM price_lists WHERE id = $1::uuid`, p.PriceListID).Scan(&currency, &status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if status != domain.BillingPriceListActive {
		return nil, ErrInvalidBillingTransition
	}

	var subtotal, taxAmount float64
	snapshot := make([]domain.PriceListItem, 0)
	for _, in := range p.Items {
		it, err := scanPriceListItem(tx.QueryRow(ctx, `
			SELECT `+priceListItemCols+` FROM price_list_items
			WHERE id = $1::uuid AND price_list_id = $2::uuid AND active`, in.PriceListItemID, p.PriceListID))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrNotFound
			}
			return nil, err
		}
		if in.Quantity <= 0 {
			return nil, errors.New("quantity must be positive")
		}
		snapshot = append(snapshot, *it)
		line := round2(in.Quantity * it.Price)
		subtotal += line
		taxAmount += round2(line * it.TaxRate / 100)
	}
	subtotal = round2(subtotal)
	taxAmount = round2(taxAmount)
	if p.DiscountAmount > subtotal {
		return nil, ErrDiscountExceedsSubtotal
	}
	total := round2(subtotal - p.DiscountAmount + taxAmount)

	invoiceNo, err := nextBillingCode(ctx, tx, "invoices_no_seq", "INV")
	if err != nil {
		return nil, err
	}
	var invoiceID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO invoices (invoice_no, patient_id, price_list_id, currency, bill_to, payer_name,
		                      policy_number, subtotal, discount_amount, tax_amount, total_amount,
		                      created_by)
		VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12::uuid)
		RETURNING id::text`,
		invoiceNo, nullableUUID(p.PatientID), p.PriceListID, currency, p.BillTo, p.PayerName,
		p.PolicyNumber, subtotal, p.DiscountAmount, taxAmount, total, p.CreatedBy).
		Scan(&invoiceID); err != nil {
		return nil, err
	}

	for idx, in := range p.Items {
		line := round2(in.Quantity * snapshot[idx].Price)
		if _, err := tx.Exec(ctx, `
			INSERT INTO invoice_items (invoice_id, price_list_item_id, code, name, category, unit,
			                           quantity, unit_price, tax_rate, line_total, tax_amount)
			VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
			invoiceID, in.PriceListItemID, snapshot[idx].Code, snapshot[idx].Name,
			snapshot[idx].Category, snapshot[idx].Unit, in.Quantity, snapshot[idx].Price,
			snapshot[idx].TaxRate, line, round2(line*snapshot[idx].TaxRate/100)); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetInvoice(ctx, invoiceID)
}

// GetInvoice returns an invoice with its items.
func (s *Store) GetInvoice(ctx context.Context, id string) (*domain.Invoice, error) {
	inv, err := scanInvoice(s.pool.QueryRow(ctx, `SELECT `+invoiceCols+invoiceFrom+` WHERE i.id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	items, err := s.listInvoiceItems(ctx, id)
	if err != nil {
		return nil, err
	}
	inv.Items = items
	return inv, nil
}

func (s *Store) listInvoiceItems(ctx context.Context, invoiceID string) ([]domain.InvoiceItem, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+invoiceItemCols+invoiceItemFrom+` WHERE invoice_id = $1::uuid ORDER BY created_at ASC`, invoiceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.InvoiceItem, 0)
	for rows.Next() {
		it, err := scanInvoiceItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *it)
	}
	return out, rows.Err()
}

// ListInvoicesParams filters the invoice list.
type ListInvoicesParams struct {
	Status  string
	Patient string
	Limit   int
	Offset  int
}

// ListInvoices returns invoices matching the filters, newest first.
func (s *Store) ListInvoices(ctx context.Context, p ListInvoicesParams) ([]domain.Invoice, error) {
	q := `SELECT ` + invoiceCols + invoiceFrom + ` WHERE true`
	args := []any{}
	if p.Status != "" {
		args = append(args, p.Status)
		q += ` AND i.status = $` + itoa(len(args))
	}
	if p.Patient != "" {
		args = append(args, p.Patient)
		q += ` AND i.patient_id = $` + itoa(len(args)) + `::uuid`
	}
	q += ` ORDER BY i.created_at DESC LIMIT $` + itoa(len(args)+1) + ` OFFSET $` + itoa(len(args)+2)
	args = append(args, p.Limit, p.Offset)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.Invoice, 0)
	for rows.Next() {
		inv, err := scanInvoice(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *inv)
	}
	return out, rows.Err()
}

// IssueInvoice locks a draft invoice (recomputing totals from its items) and
// records a patient timeline event.
func (s *Store) IssueInvoice(ctx context.Context, invoiceID, issuedBy string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var status, patientID string
	if err := tx.QueryRow(ctx, `SELECT status::text, COALESCE(patient_id::text, '') FROM invoices WHERE id = $1::uuid FOR UPDATE`, invoiceID).
		Scan(&status, &patientID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if status != domain.BillingInvoiceStatusDraft {
		return ErrInvalidBillingTransition
	}
	if _, err := tx.Exec(ctx, `
		UPDATE invoices SET status = 'issued', issued_by = $2::uuid, issued_at = now(), updated_at = now(),
		                    subtotal = (SELECT COALESCE(SUM(line_total), 0) FROM invoice_items WHERE invoice_id = $1::uuid),
		                    tax_amount = (SELECT COALESCE(SUM(tax_amount), 0) FROM invoice_items WHERE invoice_id = $1::uuid),
		                    total_amount = (SELECT COALESCE(SUM(line_total), 0) FROM invoice_items WHERE invoice_id = $1::uuid)
		                                  - discount_amount
		                                  + (SELECT COALESCE(SUM(tax_amount), 0) FROM invoice_items WHERE invoice_id = $1::uuid)
		WHERE id = $1::uuid`, invoiceID, issuedBy); err != nil {
		return err
	}
	if patientID != "" {
		if err := appendTimelineTx(ctx, tx, patientID, domain.EventBillingInvoiceIssued,
			"invoice issued", map[string]any{"invoiceNo": invoiceID}, &issuedBy); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// VoidInvoice voids a draft or issued invoice that has no payments.
func (s *Store) VoidInvoice(ctx context.Context, invoiceID, reason, voidedBy string) error {
	if reason == "" {
		return errors.New("void reason is required")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var status string
	var amountPaid float64
	if err := tx.QueryRow(ctx, `SELECT status::text, amount_paid FROM invoices WHERE id = $1::uuid FOR UPDATE`, invoiceID).
		Scan(&status, &amountPaid); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if status != domain.BillingInvoiceStatusDraft && status != domain.BillingInvoiceStatusIssued {
		return ErrInvalidBillingTransition
	}
	if amountPaid > 0 {
		return ErrInvalidBillingTransition
	}
	if _, err := tx.Exec(ctx, `
		UPDATE invoices SET status = 'voided', void_reason = $2, voided_by = $3::uuid,
		                    voided_at = now(), updated_at = now()
		WHERE id = $1::uuid`, invoiceID, reason, voidedBy); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ---- payments & receipts ----

const paymentCols = `p.id::text, p.payment_no, p.invoice_id::text, p.patient_id::text, p.shift_id::text,
	p.amount, p.method, p.reference, p.received_by::text, p.received_at, p.notes, p.created_at,
	COALESCE(i.invoice_no, ''), COALESCE(pa.first_name || ' ' || pa.last_name, '')`

const paymentFrom = ` FROM payments p
	LEFT JOIN invoices i ON i.id = p.invoice_id
	LEFT JOIN patients pa ON pa.id = p.patient_id`

func scanPayment(r pgx.Row) (*domain.Payment, error) {
	var pay domain.Payment
	err := r.Scan(&pay.ID, &pay.PaymentNo, &pay.InvoiceID, &pay.PatientID, &pay.ShiftID,
		&pay.Amount, &pay.Method, &pay.Reference, &pay.ReceivedBy, &pay.ReceivedAt, &pay.Notes, &pay.CreatedAt,
		&pay.InvoiceNo, &pay.PatientName)
	if err != nil {
		return nil, err
	}
	return &pay, nil
}

func (s *Store) openShiftForUser(ctx context.Context, q querier, userID string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT id::text FROM cashier_shifts WHERE cashier_id = $1::uuid AND status = 'open'`, userID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrShiftRequired
	}
	return id, err
}

// ReceivePaymentParams carries a payment against an invoice.
type ReceivePaymentParams struct {
	InvoiceID  string
	Amount     float64
	Method     string
	Reference  string
	Notes      string
	ReceivedBy string
}

// ReceivePayment posts a payment, updates the invoice balance, generates a
// receipt, and records the shift and patient timeline. Payments are
// append-only; corrections go through refunds.
func (s *Store) ReceivePayment(ctx context.Context, p ReceivePaymentParams) (*domain.Payment, *domain.Receipt, error) {
	if p.Amount <= 0 {
		return nil, nil, errors.New("payment amount must be positive")
	}
	allowed, err := s.paymentMethodAllowed(ctx, p.Method)
	if err != nil {
		return nil, nil, err
	}
	if !allowed {
		return nil, nil, ErrInvalidPaymentMethod
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	shiftID, err := s.openShiftForUser(ctx, tx, p.ReceivedBy)
	if err != nil {
		return nil, nil, err
	}

	var status string
	var total, amountPaid float64
	if err := tx.QueryRow(ctx, `SELECT status::text, total_amount, amount_paid FROM invoices WHERE id = $1::uuid FOR UPDATE`, p.InvoiceID).
		Scan(&status, &total, &amountPaid); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, ErrNotFound
		}
		return nil, nil, err
	}
	if status != domain.BillingInvoiceStatusIssued && status != domain.BillingInvoiceStatusPartiallyPaid {
		return nil, nil, ErrInvalidBillingTransition
	}
	if p.Amount > round2(total-amountPaid) {
		return nil, nil, ErrOverpayment
	}

	paymentNo, err := nextBillingCode(ctx, tx, "payments_no_seq", "PAY")
	if err != nil {
		return nil, nil, err
	}
	var paymentID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO payments (payment_no, invoice_id, patient_id, shift_id, amount, method, reference,
		                      received_by, notes)
		VALUES ($1, $2::uuid, (SELECT patient_id FROM invoices WHERE id = $2::uuid),
		        $3::uuid, $4, $5, $6, $7::uuid, $8)
		RETURNING id::text`,
		paymentNo, p.InvoiceID, shiftID, p.Amount, p.Method, p.Reference, p.ReceivedBy, p.Notes).
		Scan(&paymentID); err != nil {
		return nil, nil, err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE invoices SET amount_paid = amount_paid + $2,
		                    status = CASE WHEN amount_paid + $2 >= total_amount THEN 'paid'
		                                  ELSE 'partially_paid' END,
		                    updated_at = now()
		WHERE id = $1::uuid`, p.InvoiceID, p.Amount); err != nil {
		return nil, nil, err
	}

	receiptNo, err := nextBillingCode(ctx, tx, "receipts_no_seq", "RCP")
	if err != nil {
		return nil, nil, err
	}
	var receiptID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO receipts (receipt_no, payment_id, invoice_id, patient_id, amount, method, reference,
		                      issued_by)
		VALUES ($1, $2::uuid, $3::uuid, (SELECT patient_id FROM invoices WHERE id = $3::uuid),
		        $4, $5, $6, $7::uuid)
		RETURNING id::text`,
		receiptNo, paymentID, p.InvoiceID, p.Amount, p.Method, p.Reference, p.ReceivedBy).
		Scan(&receiptID); err != nil {
		return nil, nil, err
	}

	if status == domain.BillingInvoiceStatusIssued {
		var patientID string
		if err := tx.QueryRow(ctx, `SELECT COALESCE(patient_id::text, '') FROM invoices WHERE id = $1::uuid`, p.InvoiceID).Scan(&patientID); err != nil {
			return nil, nil, err
		}
		if patientID != "" {
			if err := appendTimelineTx(ctx, tx, patientID, domain.EventBillingPaymentMade,
				"payment received", map[string]any{"paymentNo": paymentNo, "amount": p.Amount}, &p.ReceivedBy); err != nil {
				return nil, nil, err
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	payment, err := s.GetPayment(ctx, paymentID)
	if err != nil {
		return nil, nil, err
	}
	receipt, err := s.GetReceipt(ctx, receiptID)
	if err != nil {
		return nil, nil, err
	}
	return payment, receipt, nil
}

// GetPayment returns a payment with invoice context.
func (s *Store) GetPayment(ctx context.Context, id string) (*domain.Payment, error) {
	pay, err := scanPayment(s.pool.QueryRow(ctx, `SELECT `+paymentCols+paymentFrom+` WHERE p.id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return pay, err
}

// ListPaymentsParams filters payments.
type ListPaymentsParams struct {
	InvoiceID string
	ShiftID   string
	Method    string
	Patient   string
	Limit     int
	Offset    int
}

// ListPayments returns payments matching the filters, newest first.
func (s *Store) ListPayments(ctx context.Context, p ListPaymentsParams) ([]domain.Payment, error) {
	q := `SELECT ` + paymentCols + paymentFrom + ` WHERE true`
	args := []any{}
	if p.InvoiceID != "" {
		args = append(args, p.InvoiceID)
		q += ` AND p.invoice_id = $` + itoa(len(args)) + `::uuid`
	}
	if p.ShiftID != "" {
		args = append(args, p.ShiftID)
		q += ` AND p.shift_id = $` + itoa(len(args)) + `::uuid`
	}
	if p.Method != "" {
		args = append(args, p.Method)
		q += ` AND p.method = $` + itoa(len(args))
	}
	if p.Patient != "" {
		args = append(args, p.Patient)
		q += ` AND p.patient_id = $` + itoa(len(args)) + `::uuid`
	}
	q += ` ORDER BY p.received_at DESC LIMIT $` + itoa(len(args)+1) + ` OFFSET $` + itoa(len(args)+2)
	args = append(args, p.Limit, p.Offset)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.Payment, 0)
	for rows.Next() {
		pay, err := scanPayment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *pay)
	}
	return out, rows.Err()
}

const receiptCols = `r.id::text, r.receipt_no, r.payment_id::text, r.invoice_id::text, r.patient_id::text,
	r.amount, r.method, r.reference, r.issued_by::text, r.issued_at,
	COALESCE(i.invoice_no, ''), COALESCE(i.currency, ''), COALESCE(pa.first_name || ' ' || pa.last_name, ''),
	COALESCE(i.bill_to::text, ''), COALESCE(i.payer_name, ''), COALESCE(st.first_name || ' ' || st.last_name, u.username),
	COALESCE(i.total_amount, 0), COALESCE(i.amount_paid, 0)`

const receiptFrom = ` FROM receipts r
	JOIN invoices i ON i.id = r.invoice_id
	LEFT JOIN patients pa ON pa.id = r.patient_id
	JOIN users u ON u.id = r.issued_by
	LEFT JOIN staff st ON st.user_id = u.id`

func scanReceipt(r pgx.Row) (*domain.Receipt, error) {
	var rec domain.Receipt
	err := r.Scan(&rec.ID, &rec.ReceiptNo, &rec.PaymentID, &rec.InvoiceID, &rec.PatientID,
		&rec.Amount, &rec.Method, &rec.Reference, &rec.IssuedBy, &rec.IssuedAt,
		&rec.InvoiceNo, &rec.Currency, &rec.PatientName,
		&rec.BillTo, &rec.PayerName, &rec.ReceivedBy,
		&rec.TotalAmount, &rec.AmountPaid)
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

// GetReceipt returns a receipt with invoice context and line items.
func (s *Store) GetReceipt(ctx context.Context, id string) (*domain.Receipt, error) {
	rec, err := scanReceipt(s.pool.QueryRow(ctx, `SELECT `+receiptCols+receiptFrom+` WHERE r.id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	items, err := s.listInvoiceItems(ctx, rec.InvoiceID)
	if err != nil {
		return nil, err
	}
	rec.Items = items
	return rec, nil
}

// ListReceiptsParams filters receipts.
type ListReceiptsParams struct {
	InvoiceID string
	Limit     int
	Offset    int
}

// ListReceipts returns receipts for an invoice (or all, newest first).
func (s *Store) ListReceipts(ctx context.Context, p ListReceiptsParams) ([]domain.Receipt, error) {
	q := `SELECT ` + receiptCols + receiptFrom + ` WHERE true`
	args := []any{}
	if p.InvoiceID != "" {
		args = append(args, p.InvoiceID)
		q += ` AND r.invoice_id = $` + itoa(len(args)) + `::uuid`
	}
	q += ` ORDER BY r.issued_at DESC LIMIT $` + itoa(len(args)+1) + ` OFFSET $` + itoa(len(args)+2)
	args = append(args, p.Limit, p.Offset)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.Receipt, 0)
	for rows.Next() {
		rec, err := scanReceipt(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *rec)
	}
	return out, rows.Err()
}

// RecordReceiptShare records a user-initiated receipt share (email/WhatsApp);
// transport is handled by the frontend, this keeps an attributable trail.
func (s *Store) RecordReceiptShare(ctx context.Context, receiptID, via, recipient, sharedBy string) (*domain.ReceiptShare, error) {
	if via != domain.ReceiptShareEmail && via != domain.ReceiptShareWhatsApp {
		return nil, errors.New("shareVia must be email or whatsapp")
	}
	if recipient == "" {
		return nil, errors.New("recipient is required")
	}
	var share domain.ReceiptShare
	err := s.pool.QueryRow(ctx, `
		INSERT INTO receipt_shares (receipt_id, share_via, recipient, shared_by)
		VALUES ($1::uuid, $2, $3, $4::uuid)
		RETURNING id::text, receipt_id::text, share_via::text, recipient, shared_by::text, shared_at`,
		receiptID, via, recipient, sharedBy).
		Scan(&share.ID, &share.ReceiptID, &share.ShareVia, &share.Recipient, &share.SharedBy, &share.SharedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &share, nil
}

// ---- refunds ----

const refundRequestCols = `rr.id::text, rr.refund_no, rr.payment_id::text, rr.invoice_id::text, rr.patient_id::text,
	rr.amount, rr.reason, rr.status::text, rr.requested_by::text, rr.requested_at,
	rr.approved_by::text, rr.approved_at, rr.rejection_reason, rr.processed_by::text, rr.processed_at,
	COALESCE(p.payment_no, ''), COALESCE(i.invoice_no, ''), COALESCE(pa.first_name || ' ' || pa.last_name, '')`

const refundRequestFrom = ` FROM refund_requests rr
	LEFT JOIN payments p ON p.id = rr.payment_id
	LEFT JOIN invoices i ON i.id = rr.invoice_id
	LEFT JOIN patients pa ON pa.id = rr.patient_id`

func scanRefundRequest(r pgx.Row) (*domain.RefundRequest, error) {
	var req domain.RefundRequest
	err := r.Scan(&req.ID, &req.RefundNo, &req.PaymentID, &req.InvoiceID, &req.PatientID,
		&req.Amount, &req.Reason, &req.Status, &req.RequestedBy, &req.RequestedAt,
		&req.ApprovedBy, &req.ApprovedAt, &req.RejectionReason, &req.ProcessedBy, &req.ProcessedAt,
		&req.PaymentNo, &req.InvoiceNo, &req.PatientName)
	if err != nil {
		return nil, err
	}
	return &req, nil
}

// RequestRefund creates a refund request against a payment. When
// billing.refund_approval_required is false the request is auto-approved.
func (s *Store) RequestRefund(ctx context.Context, paymentID, reason string, amount float64, requestedBy string) (*domain.RefundRequest, error) {
	if reason == "" {
		return nil, errors.New("reason is required")
	}
	if amount <= 0 {
		return nil, errors.New("refund amount must be positive")
	}
	approvalRequired, err := s.getBoolSetting(ctx, "billing.refund_approval_required", true)
	if err != nil {
		return nil, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var invoiceID string
	var paymentAmount float64
	if err := tx.QueryRow(ctx, `SELECT invoice_id::text, amount FROM payments WHERE id = $1::uuid FOR UPDATE`, paymentID).
		Scan(&invoiceID, &paymentAmount); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	var refunded float64
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(r.amount), 0)
		FROM refunds r WHERE r.payment_id = $1::uuid`, paymentID).Scan(&refunded); err != nil {
		return nil, err
	}
	var reserved float64
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(rr.amount), 0)
		FROM refund_requests rr WHERE rr.payment_id = $1::uuid AND rr.status IN ('pending','approved')`, paymentID).Scan(&reserved); err != nil {
		return nil, err
	}
	if amount > round2(paymentAmount-refunded-reserved) {
		return nil, ErrRefundLimit
	}

	refundNo, err := nextBillingCode(ctx, tx, "refund_requests_no_seq", "RNF")
	if err != nil {
		return nil, err
	}

	status := domain.BillingRefundStatusPending
	approvedBy, approvedAt := any(nil), any(nil)
	if !approvalRequired {
		status = domain.BillingRefundStatusApproved
		approvedBy, approvedAt = requestedBy, time.Now().UTC()
	}

	var requestID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO refund_requests (refund_no, payment_id, invoice_id, patient_id, amount, reason,
		                             status, requested_by, approved_by, approved_at)
		VALUES ($1, $2::uuid, $3::uuid, (SELECT patient_id FROM payments WHERE id = $2::uuid),
		        $4, $5, $6, $7::uuid, $8::uuid, $9)
		RETURNING id::text`,
		refundNo, paymentID, invoiceID, amount, reason, status, requestedBy, approvedBy, approvedAt).
		Scan(&requestID); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetRefundRequest(ctx, requestID)
}

// GetRefundRequest returns a refund request with payment/invoice context.
func (s *Store) GetRefundRequest(ctx context.Context, id string) (*domain.RefundRequest, error) {
	req, err := scanRefundRequest(s.pool.QueryRow(ctx, `SELECT `+refundRequestCols+refundRequestFrom+` WHERE rr.id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return req, err
}

// ListRefundRequests returns refund requests, optionally by status.
func (s *Store) ListRefundRequests(ctx context.Context, status string, limit, offset int) ([]domain.RefundRequest, error) {
	q := `SELECT ` + refundRequestCols + refundRequestFrom + ` WHERE true`
	args := []any{}
	if status != "" {
		args = append(args, status)
		q += ` AND rr.status = $` + itoa(len(args))
	}
	q += ` ORDER BY rr.requested_at DESC LIMIT $` + itoa(len(args)+1) + ` OFFSET $` + itoa(len(args)+2)
	args = append(args, limit, offset)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.RefundRequest, 0)
	for rows.Next() {
		req, err := scanRefundRequest(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *req)
	}
	return out, rows.Err()
}

// ApproveRefund approves a pending refund request. Self-approval is blocked.
func (s *Store) ApproveRefund(ctx context.Context, requestID, approver string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var status, requestedBy string
	if err := tx.QueryRow(ctx, `SELECT status::text, requested_by::text FROM refund_requests WHERE id = $1::uuid FOR UPDATE`, requestID).
		Scan(&status, &requestedBy); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if status != domain.BillingRefundStatusPending {
		return ErrInvalidBillingTransition
	}
	if requestedBy == approver {
		return ErrSelfApproval
	}
	if _, err := tx.Exec(ctx, `
		UPDATE refund_requests SET status = 'approved', approved_by = $2::uuid, approved_at = now()
		WHERE id = $1::uuid`, requestID, approver); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// RejectRefund rejects a pending refund request.
func (s *Store) RejectRefund(ctx context.Context, requestID, reason, rejecter string) error {
	if reason == "" {
		return errors.New("rejection reason is required")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var status string
	if err := tx.QueryRow(ctx, `SELECT status::text FROM refund_requests WHERE id = $1::uuid FOR UPDATE`, requestID).
		Scan(&status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if status != domain.BillingRefundStatusPending {
		return ErrInvalidBillingTransition
	}
	if _, err := tx.Exec(ctx, `
		UPDATE refund_requests SET status = 'rejected', rejection_reason = $2
		WHERE id = $1::uuid`, requestID, reason); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ProcessRefund posts an approved refund: it reverses the payment balance on
// the invoice and records the refund in the cashier's shift.
func (s *Store) ProcessRefund(ctx context.Context, requestID, processedBy string) (*domain.Refund, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	shiftID, err := s.openShiftForUser(ctx, tx, processedBy)
	if err != nil {
		return nil, err
	}

	var status, invoiceID, patientID string
	var amount float64
	var reason string
	if err := tx.QueryRow(ctx, `
		SELECT status::text, invoice_id::text, COALESCE(patient_id::text, ''), amount, reason
		FROM refund_requests WHERE id = $1::uuid FOR UPDATE`, requestID).
		Scan(&status, &invoiceID, &patientID, &amount, &reason); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if status != domain.BillingRefundStatusApproved {
		return nil, ErrInvalidBillingTransition
	}

	refundNo, err := nextBillingCode(ctx, tx, "refunds_no_seq", "RFN")
	if err != nil {
		return nil, err
	}
	var refundID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO refunds (refund_no, refund_request_id, payment_id, invoice_id, patient_id,
		                     shift_id, amount, reason, processed_by)
		VALUES ($1, $2::uuid, (SELECT payment_id FROM refund_requests WHERE id = $2::uuid),
		        $3::uuid, $4::uuid, $5::uuid, $6, $7, $8::uuid)
		RETURNING id::text`,
		refundNo, requestID, invoiceID, nullableText(patientID), shiftID, amount, reason, processedBy).
		Scan(&refundID); err != nil {
		return nil, err
	}

	// Reverse the payment balance; a fully-reversed paid invoice drops back.
	if _, err := tx.Exec(ctx, `
		UPDATE invoices SET amount_paid = GREATEST(amount_paid - $2, 0),
		                    status = CASE
		                                WHEN GREATEST(amount_paid - $2, 0) >= total_amount THEN 'paid'
		                                WHEN GREATEST(amount_paid - $2, 0) > 0 THEN 'partially_paid'
		                                ELSE 'issued'
		                            END,
		                    updated_at = now()
		WHERE id = $1::uuid`, invoiceID, amount); err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE refund_requests SET status = 'processed', processed_by = $2::uuid, processed_at = now()
		WHERE id = $1::uuid`, requestID, processedBy); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetRefund(ctx, refundID)
}

const refundCols = `r.id::text, r.refund_no, r.refund_request_id::text, r.payment_id::text, r.invoice_id::text,
	r.patient_id::text, r.shift_id::text, r.amount, r.reason, r.processed_by::text, r.processed_at,
	COALESCE(i.invoice_no, ''), COALESCE(p.payment_no, ''), COALESCE(pa.first_name || ' ' || pa.last_name, '')`

const refundFrom = ` FROM refunds r
	LEFT JOIN invoices i ON i.id = r.invoice_id
	LEFT JOIN payments p ON p.id = r.payment_id
	LEFT JOIN patients pa ON pa.id = r.patient_id`

func scanRefund(r pgx.Row) (*domain.Refund, error) {
	var ref domain.Refund
	err := r.Scan(&ref.ID, &ref.RefundNo, &ref.RefundRequestID, &ref.PaymentID, &ref.InvoiceID,
		&ref.PatientID, &ref.ShiftID, &ref.Amount, &ref.Reason, &ref.ProcessedBy, &ref.ProcessedAt,
		&ref.InvoiceNo, &ref.PaymentNo, &ref.PatientName)
	if err != nil {
		return nil, err
	}
	return &ref, nil
}

// GetRefund returns a processed refund.
func (s *Store) GetRefund(ctx context.Context, id string) (*domain.Refund, error) {
	ref, err := scanRefund(s.pool.QueryRow(ctx, `SELECT `+refundCols+refundFrom+` WHERE r.id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return ref, err
}

// ---- cashier shifts ----

const shiftCols = `id::text, shift_no, cashier_id::text, opened_at, closed_at, opening_cash,
	closing_cash, expected_cash, variance, status::text`

func scanShift(r pgx.Row) (*domain.CashierShift, error) {
	var sh domain.CashierShift
	err := r.Scan(&sh.ID, &sh.ShiftNo, &sh.CashierID, &sh.OpenedAt, &sh.ClosedAt, &sh.OpeningCash,
		&sh.ClosingCash, &sh.ExpectedCash, &sh.Variance, &sh.Status)
	if err != nil {
		return nil, err
	}
	return &sh, nil
}

// OpenShift opens a cashier session. A cashier may only have one open shift.
func (s *Store) OpenShift(ctx context.Context, cashierID string, openingCash float64) (*domain.CashierShift, error) {
	if openingCash < 0 {
		return nil, errors.New("opening cash cannot be negative")
	}
	_, err := s.openShiftForUser(ctx, s.pool, cashierID)
	if err == nil {
		return nil, ErrShiftOpen
	}
	if !errors.Is(err, ErrShiftRequired) {
		return nil, err
	}

	shiftNo, err := nextBillingCode(ctx, s.pool, "cashier_shifts_no_seq", "SFT")
	if err != nil {
		return nil, err
	}
	sh, err := scanShift(s.pool.QueryRow(ctx, `
		INSERT INTO cashier_shifts (shift_no, cashier_id, opening_cash)
		VALUES ($1, $2::uuid, $3) RETURNING `+shiftCols,
		shiftNo, cashierID, openingCash))
	if err != nil {
		return nil, err
	}
	return sh, nil
}

// CloseShift closes the shift, computing expected cash and variance from the
// cash transactions recorded during the shift.
func (s *Store) CloseShift(ctx context.Context, shiftID, cashierID string, closingCash float64) (*domain.CashierShift, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var status, owner string
	if err := tx.QueryRow(ctx, `SELECT status::text, cashier_id::text FROM cashier_shifts WHERE id = $1::uuid FOR UPDATE`, shiftID).
		Scan(&status, &owner); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if status != domain.BillingShiftOpen {
		return nil, ErrInvalidBillingTransition
	}
	if owner != cashierID {
		return nil, ErrNotShiftOwner
	}

	var expected float64
	if err := tx.QueryRow(ctx, `
		SELECT opening_cash
		     + (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.shift_id = $1::uuid AND p.method = 'cash')
		     - (SELECT COALESCE(SUM(r.amount), 0) FROM refunds r
		        JOIN payments p ON p.id = r.payment_id
		        WHERE r.shift_id = $1::uuid AND p.method = 'cash')
		FROM cashier_shifts WHERE id = $1::uuid`, shiftID).Scan(&expected); err != nil {
		return nil, err
	}
	variance := round2(closingCash - expected)

	if _, err := tx.Exec(ctx, `
		UPDATE cashier_shifts SET status = 'closed', closed_at = now(), closing_cash = $2,
		                          expected_cash = $3, variance = $4
		WHERE id = $1::uuid`, shiftID, closingCash, expected, variance); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetShift(ctx, shiftID)
}

// GetShift returns a shift with its payments and refunds.
func (s *Store) GetShift(ctx context.Context, id string) (*domain.CashierShift, error) {
	sh, err := scanShift(s.pool.QueryRow(ctx, `SELECT `+shiftCols+` FROM cashier_shifts WHERE id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	payments, err := s.ListPayments(ctx, ListPaymentsParams{ShiftID: id, Limit: 1000})
	if err != nil {
		return nil, err
	}
	sh.Payments = payments

	rows, err := s.pool.Query(ctx, `SELECT `+refundCols+refundFrom+` WHERE r.shift_id = $1::uuid ORDER BY r.processed_at ASC`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		ref, err := scanRefund(rows)
		if err != nil {
			return nil, err
		}
		sh.Refunds = append(sh.Refunds, *ref)
	}
	return sh, rows.Err()
}

// ShiftTotalsByMethod aggregates a shift's transactions per payment method.
func ShiftTotalsByMethod(shift *domain.CashierShift) []domain.ShiftTotals {
	byMethod := map[string]*domain.ShiftTotals{}
	for _, p := range shift.Payments {
		t := byMethod[p.Method]
		if t == nil {
			t = &domain.ShiftTotals{Method: p.Method}
			byMethod[p.Method] = t
		}
		t.Payments = round2(t.Payments + p.Amount)
	}
	for _, r := range shift.Refunds {
		method := "cash"
		for _, p := range shift.Payments {
			if p.ID == r.PaymentID {
				method = p.Method
				break
			}
		}
		t := byMethod[method]
		if t == nil {
			t = &domain.ShiftTotals{Method: method}
			byMethod[method] = t
		}
		t.Refunds = round2(t.Refunds + r.Amount)
	}
	out := make([]domain.ShiftTotals, 0, len(byMethod))
	for _, t := range byMethod {
		t.Net = round2(t.Payments - t.Refunds)
		out = append(out, *t)
	}
	return out
}

// ListShiftsParams filters shifts.
type ListShiftsParams struct {
	Status  string
	Cashier string
	Limit   int
	Offset  int
}

// ListShifts returns shifts matching the filters, newest first.
func (s *Store) ListShifts(ctx context.Context, p ListShiftsParams) ([]domain.CashierShift, error) {
	q := `SELECT ` + shiftCols + ` FROM cashier_shifts WHERE true`
	args := []any{}
	if p.Status != "" {
		args = append(args, p.Status)
		q += ` AND status = $` + itoa(len(args))
	}
	if p.Cashier != "" {
		args = append(args, p.Cashier)
		q += ` AND cashier_id = $` + itoa(len(args)) + `::uuid`
	}
	q += ` ORDER BY opened_at DESC LIMIT $` + itoa(len(args)+1) + ` OFFSET $` + itoa(len(args)+2)
	args = append(args, p.Limit, p.Offset)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.CashierShift, 0)
	for rows.Next() {
		sh, err := scanShift(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *sh)
	}
	return out, rows.Err()
}
