package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

// ErrAlreadyDispensed is returned when a prescription has already been filled.
var ErrAlreadyDispensed = errors.New("prescription already dispensed")

// ErrSelfApproval is returned when a requester tries to approve their own request.
var ErrSelfApproval = errors.New("cannot approve your own request")

const adjustmentCols = `id::text, medicine_id::text, batch_id::text, quantity, reason, status, approval_request_id::text, requested_by::text, decided_by::text, decided_at, created_at`

const approvalCols = `id::text, subject_type, subject_id::text, action, requested_by::text, status, details, reason, decided_by::text, decided_at, created_at`

func scanAdjustment(r pgx.Row) (*domain.StockAdjustment, error) {
	var a domain.StockAdjustment
	err := r.Scan(&a.ID, &a.MedicineID, &a.BatchID, &a.Quantity, &a.Reason, &a.Status,
		&a.ApprovalRequestID, &a.RequestedBy, &a.DecidedBy, &a.DecidedAt, &a.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func scanApproval(r pgx.Row) (*domain.ApprovalRequest, error) {
	var a domain.ApprovalRequest
	err := r.Scan(&a.ID, &a.SubjectType, &a.SubjectID, &a.Action, &a.RequestedBy, &a.Status,
		&a.Details, &a.Reason, &a.DecidedBy, &a.DecidedAt, &a.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func (s *Store) getBoolSetting(ctx context.Context, key string, def bool) (bool, error) {
	var val []byte
	err := s.pool.QueryRow(ctx, `SELECT value FROM system_settings WHERE key = $1`, key).Scan(&val)
	if errors.Is(err, pgx.ErrNoRows) {
		return def, nil
	}
	if err != nil {
		return def, err
	}
	var b bool
	if json.Unmarshal(val, &b) != nil {
		return def, nil
	}
	return b, nil
}

// ---- dispensing (FEFO) ----

// DispenseItemParams is a line item to dispense.
type DispenseItemParams struct {
	MedicineID string
	Quantity   float64
}

// DispenseParams carries a dispensing request against a prescription order.
type DispenseParams struct {
	OrderID     string
	Items       []DispenseItemParams
	Notes       string
	DispensedBy string
}

type fefoAlloc struct {
	MedicineID string
	BatchID    string
	Quantity   float64
	UnitPrice  float64
}

// Dispense fills a prescription using FEFO, records dispense movements, and
// completes the order. One dispensation per order.
func (s *Store) Dispense(ctx context.Context, p DispenseParams) (*domain.Dispensation, error) {
	if len(p.Items) == 0 {
		return nil, errors.New("no items to dispense")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Load and validate the order.
	var orderType, orderStatus, patientID string
	err = tx.QueryRow(ctx, `SELECT order_type, status, patient_id::text FROM orders WHERE id = $1::uuid FOR UPDATE`, p.OrderID).
		Scan(&orderType, &orderStatus, &patientID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if orderType != domain.OrderTypePrescription {
		return nil, errors.New("order is not a prescription")
	}
	switch orderStatus {
	case domain.OrderStatusCompleted:
		return nil, ErrAlreadyDispensed
	case domain.OrderStatusCancelled, domain.OrderStatusDraft:
		return nil, ErrInvalidTransition
	}

	var existing int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM dispensations WHERE prescription_order_id = $1::uuid`, p.OrderID).Scan(&existing); err != nil {
		return nil, err
	}
	if existing > 0 {
		return nil, ErrAlreadyDispensed
	}

	// Create the dispensation header.
	var dispSeq int64
	if err := tx.QueryRow(ctx, `SELECT nextval('dispensations_no_seq')`).Scan(&dispSeq); err != nil {
		return nil, err
	}
	dispNo := "DSP" + lpadInt(dispSeq, 6)

	var dispID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO dispensations (dispensation_no, prescription_order_id, patient_id, dispensed_by, notes)
		VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5)
		RETURNING id::text`, dispNo, p.OrderID, patientID, p.DispensedBy, p.Notes).Scan(&dispID); err != nil {
		return nil, err
	}

	// FEFO-deduct each item.
	var total float64
	for _, item := range p.Items {
		if item.Quantity <= 0 {
			return nil, errors.New("dispense quantity must be positive")
		}
		allocs, err := s.fefoDeductTx(ctx, tx, item.MedicineID, item.Quantity, p.DispensedBy, dispID)
		if err != nil {
			return nil, err
		}
		for _, a := range allocs {
			if _, err := tx.Exec(ctx, `
				INSERT INTO dispensation_items (dispensation_id, medicine_id, batch_id, quantity, unit_price)
				VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)`,
				dispID, a.MedicineID, a.BatchID, a.Quantity, a.UnitPrice); err != nil {
				return nil, err
			}
			total += a.Quantity * a.UnitPrice
		}
	}

	if _, err := tx.Exec(ctx, `UPDATE dispensations SET total_amount = $2 WHERE id = $1::uuid`, dispID, total); err != nil {
		return nil, err
	}

	// Complete the prescription order.
	if _, err := tx.Exec(ctx, `
		UPDATE orders SET status = 'completed', completed_at = now(), acted_by = $2::uuid, updated_at = now()
		WHERE id = $1::uuid`, p.OrderID, p.DispensedBy); err != nil {
		return nil, err
	}

	if err := appendTimelineTx(ctx, tx, patientID, domain.EventMedicineDispensed,
		"Medication dispensed: "+dispNo, map[string]any{"dispensationNo": dispNo}, &p.DispensedBy); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return s.GetDispensation(ctx, dispID)
}

// fefoDeductTx deducts quantity from the earliest-expiring dispensable batches
// and records dispense movements.
func (s *Store) fefoDeductTx(ctx context.Context, tx pgx.Tx, medicineID string, quantity float64, performedBy, dispID string) ([]fefoAlloc, error) {
	// Verify the medicine is active.
	var active bool
	if err := tx.QueryRow(ctx, `SELECT active FROM medicines WHERE id = $1::uuid`, medicineID).Scan(&active); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if !active {
		return nil, ErrNotDispensable
	}

	rows, err := tx.Query(ctx, `
		SELECT id::text, quantity_on_hand, selling_price
		FROM medicine_batches
		WHERE medicine_id = $1::uuid AND quantity_on_hand > 0 AND status = 'active'
		  AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE)
		ORDER BY expiry_date ASC NULLS LAST, received_at ASC
		FOR UPDATE`, medicineID)
	if err != nil {
		return nil, err
	}

	type cand struct {
		batchID string
		onHand  float64
		price   float64
	}
	var cands []cand
	for rows.Next() {
		var c cand
		if err := rows.Scan(&c.batchID, &c.onHand, &c.price); err != nil {
			rows.Close()
			return nil, err
		}
		cands = append(cands, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	remaining := quantity
	var allocs []fefoAlloc
	for _, c := range cands {
		if remaining <= 0 {
			break
		}
		take := c.onHand
		if take > remaining {
			take = remaining
		}
		if _, err := tx.Exec(ctx, `UPDATE medicine_batches SET quantity_on_hand = quantity_on_hand - $2, updated_at = now() WHERE id = $1::uuid`, c.batchID, take); err != nil {
			return nil, err
		}
		if err := insertMovementTx(ctx, tx, medicineID, c.batchID, domain.MovementDispense, -take, c.onHand, c.onHand-take, "dispense", "dispensation", &dispID, performedBy); err != nil {
			return nil, err
		}
		allocs = append(allocs, fefoAlloc{MedicineID: medicineID, BatchID: c.batchID, Quantity: take, UnitPrice: c.price})
		remaining -= take
	}
	if remaining > 0 {
		return nil, ErrInsufficientStock
	}
	return allocs, nil
}

// GetDispensation returns a dispensation with its line items.
const dispCols = `id::text, dispensation_no, prescription_order_id::text, patient_id::text, dispensed_by::text, total_amount, notes, dispense_status, counseling_notes, allergy_check_passed, interaction_check_passed, sign_off_by::text, sign_off_at, created_at`

func scanDispensation(r pgx.Row) (*domain.Dispensation, error) {
	var d domain.Dispensation
	err := r.Scan(&d.ID, &d.DispensationNo, &d.PrescriptionOrderID, &d.PatientID, &d.DispensedBy,
		&d.TotalAmount, &d.Notes, &d.DispenseStatus, &d.CounselingNotes,
		&d.AllergyCheckPassed, &d.InteractionCheckPassed, &d.SignOffBy, &d.SignOffAt, &d.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

func (s *Store) GetDispensation(ctx context.Context, id string) (*domain.Dispensation, error) {
	d, err := scanDispensation(s.pool.QueryRow(ctx, `SELECT `+dispCols+` FROM dispensations WHERE id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT id::text, dispensation_id::text, medicine_id::text, batch_id::text, quantity, unit_price
		FROM dispensation_items WHERE dispensation_id = $1::uuid`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var it domain.DispensationItem
		if err := rows.Scan(&it.ID, &it.DispensationID, &it.MedicineID, &it.BatchID, &it.Quantity, &it.UnitPrice); err != nil {
			return nil, err
		}
		d.Items = append(d.Items, it)
	}
	return d, rows.Err()
}

// ListDispensations returns dispensing history, newest first.
func (s *Store) ListDispensations(ctx context.Context, patientID string, limit, offset int) ([]domain.Dispensation, error) {
	q := `SELECT ` + dispCols + ` FROM dispensations`
	args := []any{}
	if patientID != "" {
		q += ` WHERE patient_id = $1::uuid`
		args = append(args, patientID)
	}
	q += ` ORDER BY created_at DESC LIMIT $` + itoa(len(args)+1) + ` OFFSET $` + itoa(len(args)+2)
	args = append(args, limit, offset)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.Dispensation, 0)
	for rows.Next() {
		d, err := scanDispensation(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *d)
	}
	return out, rows.Err()
}

// ---- stock adjustments & approvals ----

// CreateAdjustmentParams carries a stock adjustment.
type CreateAdjustmentParams struct {
	MedicineID  string
	BatchID     string
	Quantity    float64
	Reason      string
	RequestedBy string
}

// CreateAdjustment records an adjustment. When approval is required (configurable)
// the adjustment is created pending with a linked approval request; otherwise it
// is applied immediately.
func (s *Store) CreateAdjustment(ctx context.Context, p CreateAdjustmentParams) (*domain.StockAdjustment, *domain.ApprovalRequest, error) {
	if p.Quantity == 0 {
		return nil, nil, errors.New("adjustment quantity must be non-zero")
	}

	requireApproval, err := s.getBoolSetting(ctx, "pharmacy.adjustment_approval_required", true)
	if err != nil {
		return nil, nil, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var before float64
	if err := tx.QueryRow(ctx, `SELECT quantity_on_hand FROM medicine_batches WHERE id = $1::uuid FOR UPDATE`, p.BatchID).Scan(&before); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, ErrNotFound
		}
		return nil, nil, err
	}
	if before+p.Quantity < 0 {
		return nil, nil, ErrInsufficientStock
	}

	status := domain.AdjustmentStatusApproved
	if requireApproval {
		status = domain.AdjustmentStatusPending
	}

	var adj domain.StockAdjustment
	row := tx.QueryRow(ctx, `
		INSERT INTO stock_adjustments (medicine_id, batch_id, quantity, reason, status, requested_by)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
		RETURNING `+adjustmentCols,
		p.MedicineID, p.BatchID, p.Quantity, p.Reason, status, p.RequestedBy)
	scanned, err := scanAdjustment(row)
	if err != nil {
		return nil, nil, err
	}
	adj = *scanned

	if !requireApproval {
		// Apply immediately.
		if err := s.applyAdjustmentTx(ctx, tx, adj, before); err != nil {
			return nil, nil, err
		}
		now := time.Now()
		adj.Status = domain.AdjustmentStatusApproved
		adj.DecidedBy = &p.RequestedBy
		adj.DecidedAt = &now
	} else {
		// Create a linked approval request.
		details, _ := json.Marshal(map[string]any{"medicineId": p.MedicineID, "batchId": p.BatchID, "quantity": p.Quantity, "reason": p.Reason})
		var approvalID string
		if err := tx.QueryRow(ctx, `
			INSERT INTO approval_requests (subject_type, subject_id, action, requested_by, details, reason)
			VALUES ($1, $2::uuid, 'approve_adjustment', $3::uuid, $4::jsonb, $5)
			RETURNING id::text`,
			domain.ApprovalSubjectStockAdjustment, adj.ID, p.RequestedBy, details, p.Reason).Scan(&approvalID); err != nil {
			return nil, nil, err
		}
		if _, err := tx.Exec(ctx, `UPDATE stock_adjustments SET approval_request_id = $2::uuid WHERE id = $1::uuid`, adj.ID, approvalID); err != nil {
			return nil, nil, err
		}
		adj.ApprovalRequestID = &approvalID
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}

	var approval *domain.ApprovalRequest
	if requireApproval && adj.ApprovalRequestID != nil {
		approval, err = s.GetApproval(ctx, *adj.ApprovalRequestID)
		if err != nil {
			return nil, nil, err
		}
	}
	return &adj, approval, nil
}

// applyAdjustmentTx applies an approved adjustment to its batch and records a movement.
func (s *Store) applyAdjustmentTx(ctx context.Context, tx pgx.Tx, adj domain.StockAdjustment, before float64) error {
	after := before + adj.Quantity
	if _, err := tx.Exec(ctx, `UPDATE medicine_batches SET quantity_on_hand = $2, updated_at = now() WHERE id = $1::uuid`, adj.BatchID, after); err != nil {
		return err
	}
	return insertMovementTx(ctx, tx, adj.MedicineID, adj.BatchID, domain.MovementAdjustment, adj.Quantity, before, after, adj.Reason, "adjustment", &adj.ID, adj.RequestedBy)
}

// GetAdjustment returns an adjustment by ID.
func (s *Store) GetAdjustment(ctx context.Context, id string) (*domain.StockAdjustment, error) {
	a, err := scanAdjustment(s.pool.QueryRow(ctx, `SELECT `+adjustmentCols+` FROM stock_adjustments WHERE id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return a, err
}

// ListAdjustments returns adjustments, newest first.
func (s *Store) ListAdjustments(ctx context.Context, status string, limit, offset int) ([]domain.StockAdjustment, error) {
	q := `SELECT ` + adjustmentCols + ` FROM stock_adjustments`
	args := []any{}
	if status != "" {
		q += ` WHERE status = $1`
		args = append(args, status)
	}
	q += ` ORDER BY created_at DESC LIMIT $` + itoa(len(args)+1) + ` OFFSET $` + itoa(len(args)+2)
	args = append(args, limit, offset)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.StockAdjustment, 0)
	for rows.Next() {
		a, err := scanAdjustment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// GetApproval returns an approval request by ID.
func (s *Store) GetApproval(ctx context.Context, id string) (*domain.ApprovalRequest, error) {
	a, err := scanApproval(s.pool.QueryRow(ctx, `SELECT `+approvalCols+` FROM approval_requests WHERE id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return a, err
}

// ListApprovals returns approval requests, optionally filtered by status.
func (s *Store) ListApprovals(ctx context.Context, status string, limit, offset int) ([]domain.ApprovalRequest, error) {
	q := `SELECT ` + approvalCols + ` FROM approval_requests`
	args := []any{}
	if status != "" {
		q += ` WHERE status = $1`
		args = append(args, status)
	}
	q += ` ORDER BY created_at DESC LIMIT $` + itoa(len(args)+1) + ` OFFSET $` + itoa(len(args)+2)
	args = append(args, limit, offset)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.ApprovalRequest, 0)
	for rows.Next() {
		a, err := scanApproval(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// ApproveApproval approves a pending approval request and applies its subject.
func (s *Store) ApproveApproval(ctx context.Context, approvalID, decidedBy string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var subjectType, subjectID, requestedBy, status string
	err = tx.QueryRow(ctx, `SELECT subject_type, subject_id::text, requested_by::text, status FROM approval_requests WHERE id = $1::uuid FOR UPDATE`, approvalID).
		Scan(&subjectType, &subjectID, &requestedBy, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if status != domain.ApprovalStatusPending {
		return ErrInvalidTransition
	}
	if requestedBy == decidedBy {
		return ErrSelfApproval
	}

	switch subjectType {
	case domain.ApprovalSubjectStockAdjustment:
		adj, err := s.getAdjustmentTx(ctx, tx, subjectID)
		if err != nil {
			return err
		}
		var before float64
		if err := tx.QueryRow(ctx, `SELECT quantity_on_hand FROM medicine_batches WHERE id = $1::uuid FOR UPDATE`, adj.BatchID).Scan(&before); err != nil {
			return err
		}
		if err := s.applyAdjustmentTx(ctx, tx, *adj, before); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE stock_adjustments SET status = 'approved', decided_by = $2::uuid, decided_at = now() WHERE id = $1::uuid`, adj.ID, decidedBy); err != nil {
			return err
		}
	default:
		return errors.New("unsupported approval subject type")
	}

	if _, err := tx.Exec(ctx, `UPDATE approval_requests SET status = 'approved', decided_by = $2::uuid, decided_at = now() WHERE id = $1::uuid`, approvalID, decidedBy); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// RejectApproval rejects a pending approval request.
func (s *Store) RejectApproval(ctx context.Context, approvalID, decidedBy string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var subjectType, subjectID, requestedBy, status string
	err = tx.QueryRow(ctx, `SELECT subject_type, subject_id::text, requested_by::text, status FROM approval_requests WHERE id = $1::uuid FOR UPDATE`, approvalID).
		Scan(&subjectType, &subjectID, &requestedBy, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if status != domain.ApprovalStatusPending {
		return ErrInvalidTransition
	}
	if requestedBy == decidedBy {
		return ErrSelfApproval
	}

	if subjectType == domain.ApprovalSubjectStockAdjustment {
		if _, err := tx.Exec(ctx, `UPDATE stock_adjustments SET status = 'rejected', decided_by = $2::uuid, decided_at = now() WHERE id = $1::uuid`, subjectID, decidedBy); err != nil {
			return err
		}
	}

	if _, err := tx.Exec(ctx, `UPDATE approval_requests SET status = 'rejected', decided_by = $2::uuid, decided_at = now() WHERE id = $1::uuid`, approvalID, decidedBy); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) getAdjustmentTx(ctx context.Context, tx pgx.Tx, id string) (*domain.StockAdjustment, error) {
	a, err := scanAdjustment(tx.QueryRow(ctx, `SELECT `+adjustmentCols+` FROM stock_adjustments WHERE id = $1::uuid FOR UPDATE`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return a, err
}

// ---- stock counts ----

// CreateStockCountParams carries a physical count.
type CreateStockCountParams struct {
	BatchID         string
	CountedQuantity float64
	CountedBy       string
}

// CreateStockCount records a physical count and reconciles the variance.
func (s *Store) CreateStockCount(ctx context.Context, p CreateStockCountParams) (*domain.StockCount, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var medicineID string
	var system float64
	err = tx.QueryRow(ctx, `SELECT medicine_id::text, quantity_on_hand FROM medicine_batches WHERE id = $1::uuid FOR UPDATE`, p.BatchID).
		Scan(&medicineID, &system)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	variance := p.CountedQuantity - system
	if _, err := tx.Exec(ctx, `UPDATE medicine_batches SET quantity_on_hand = $2, updated_at = now() WHERE id = $1::uuid`, p.BatchID, p.CountedQuantity); err != nil {
		return nil, err
	}
	if err := insertMovementTx(ctx, tx, medicineID, p.BatchID, domain.MovementCountVariance, variance, system, p.CountedQuantity, "stock count", "count", nil, p.CountedBy); err != nil {
		return nil, err
	}

	var sc domain.StockCount
	err = tx.QueryRow(ctx, `
		INSERT INTO stock_counts (medicine_id, batch_id, system_quantity, counted_quantity, variance, counted_by)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
		RETURNING id::text, medicine_id::text, batch_id::text, system_quantity, counted_quantity, variance, counted_by::text, created_at`,
		medicineID, p.BatchID, system, p.CountedQuantity, variance, p.CountedBy).
		Scan(&sc.ID, &sc.MedicineID, &sc.BatchID, &sc.SystemQuantity, &sc.CountedQuantity, &sc.Variance, &sc.CountedBy, &sc.CreatedAt)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &sc, nil
}

// ListStockCounts returns stock counts for a batch.
func (s *Store) ListStockCounts(ctx context.Context, batchID string) ([]domain.StockCount, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, medicine_id::text, batch_id::text, system_quantity, counted_quantity, variance, counted_by::text, created_at
		FROM stock_counts WHERE batch_id = $1::uuid ORDER BY created_at DESC`, batchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.StockCount, 0)
	for rows.Next() {
		var c domain.StockCount
		if err := rows.Scan(&c.ID, &c.MedicineID, &c.BatchID, &c.SystemQuantity, &c.CountedQuantity, &c.Variance, &c.CountedBy, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ---- allergy & interaction checks ----

// AllergyAlert represents a known patient allergy relevant to a medication.
type AllergyAlert struct {
	AllergyID    string
	Summary      string
	Severity     string
	MedicineName string
}

// GetPatientAllergies returns the patient's recorded allergies.
func (s *Store) GetPatientAllergies(ctx context.Context, patientID string) ([]AllergyAlert, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, summary, COALESCE(details->>'severity','') AS severity
		FROM patient_clinical_entries
		WHERE patient_id = $1::uuid AND section = 'allergy'
		ORDER BY created_at DESC`, patientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]AllergyAlert, 0)
	for rows.Next() {
		var a AllergyAlert
		if err := rows.Scan(&a.AllergyID, &a.Summary, &a.Severity); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// InteractionAlert represents a potential drug interaction.
type InteractionAlert struct {
	ExistingMedication string
	ExistingDose       string
	Warning            string
	Severity           string // mild | moderate | severe
}

// CheckDrugInteractions checks a medication against the patient's current
// medications for potential interactions. Uses a built-in severity table.
func (s *Store) CheckDrugInteractions(ctx context.Context, patientID, medication string) ([]InteractionAlert, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT summary, COALESCE(details->>'dose','') AS dose
		FROM patient_clinical_entries
		WHERE patient_id = $1::uuid AND section = 'medication'
		ORDER BY created_at DESC`, patientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type med struct{ name, dose string }
	var meds []med
	for rows.Next() {
		var m med
		if err := rows.Scan(&m.name, &m.dose); err != nil {
			return nil, err
		}
		meds = append(meds, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	medLower := toLower(medication)
	var alerts []InteractionAlert
	for _, m := range meds {
		if sev, warn := knownInteraction(medLower, toLower(m.name)); sev != "" {
			alerts = append(alerts, InteractionAlert{
				ExistingMedication: m.name,
				ExistingDose:       m.dose,
				Warning:            warn,
				Severity:           sev,
			})
		}
	}
	return alerts, nil
}

func toLower(s string) string {
	b := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		b[i] = c
	}
	return string(b)
}

// knownInteraction returns severity and warning for known drug pairs.
func knownInteraction(a, b string) (severity, warning string) {
	pair := a + "|" + b
	if a > b {
		pair = b + "|" + a
	}
	interactions := map[string]struct{ sev, warn string }{
		"warfarin|aspirin":          {"severe", "Increased bleeding risk: both affect coagulation."},
		"warfarin|ibuprofen":        {"severe", "NSAIDs increase bleeding risk with warfarin."},
		"warfarin|paracetamol":      {"moderate", "High-dose paracetamol may potentiate warfarin."},
		"metformin|alcohol":         {"severe", "Alcohol increases risk of lactic acidosis with metformin."},
		"metformin|gliclazide":      {"moderate", "Dual hypoglycemics: monitor blood glucose closely."},
		"amlodipine|simvastatin":    {"moderate", "Amlodipine increases simvastatin exposure; max simvastatin 20mg."},
		"omeprazole|clopidogrel":    {"severe", "Omeprazole reduces clopidogrel activation; consider pantoprazole."},
		"ciprofloxacin|theophylline": {"moderate", "Fluoroquinolones increase theophylline levels."},
		"ciprofloxacin|warfarin":    {"moderate", "Ciprofloxacin may increase INR with warfarin."},
		"enalapril|spironolactone":  {"severe", "Dual RAAS blockade: risk of hyperkalaemia."},
		"metoprolol|verapamil":      {"severe", "Combined bradycardia and heart block risk."},
		"lithium|ibuprofen":         {"severe", "NSAIDs increase lithium levels; toxicity risk."},
		"methotrexate|ibuprofen":    {"severe", "NSAIDs reduce methotrexate clearance; toxicity risk."},
		"fluoxetine|tramadol":       {"severe", "Serotonin syndrome risk with combined serotonergic agents."},
		"sertraline|tramadol":       {"severe", "Serotonin syndrome risk with combined serotonergic agents."},
		"amiodarone|simvastatin":    {"severe", "Amiodarone doubles simvastatin exposure; rhabdomyolysis risk."},
		"fluconazole|warfarin":      {"severe", "Fluconazole potentiates warfarin; monitor INR closely."},
	}
	if v, ok := interactions[pair]; ok {
		return v.sev, v.warn
	}
	return "", ""
}

// ---- dispense status transitions ----

// UpdateDispenseStatusParams carries a status change with sign-off.
type UpdateDispenseStatusParams struct {
	DispensationID string
	DispenseStatus string
	SignOffBy      string
}

// UpdateDispenseStatus transitions a dispensation's workflow status.
// Valid transitions: pending_verification → ready_for_pickup → dispensed.
func (s *Store) UpdateDispenseStatus(ctx context.Context, p UpdateDispenseStatusParams) (*domain.Dispensation, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var current string
	err = tx.QueryRow(ctx, `SELECT dispense_status FROM dispensations WHERE id = $1::uuid FOR UPDATE`, p.DispensationID).
		Scan(&current)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	valid := map[string]string{
		"pending_verification": "ready_for_pickup",
		"ready_for_pickup":     "dispensed",
	}
	next, ok := valid[current]
	if !ok || next != p.DispenseStatus {
		return nil, ErrInvalidTransition
	}

	if p.DispenseStatus == "ready_for_pickup" {
		if _, err := tx.Exec(ctx, `
			UPDATE dispensations SET dispense_status = $2, sign_off_by = $3::uuid, sign_off_at = now()
			WHERE id = $1::uuid`, p.DispensationID, p.DispenseStatus, p.SignOffBy); err != nil {
			return nil, err
		}
	} else {
		if _, err := tx.Exec(ctx, `
			UPDATE dispensations SET dispense_status = $2
			WHERE id = $1::uuid`, p.DispensationID, p.DispenseStatus); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetDispensation(ctx, p.DispensationID)
}

// ---- enhanced dispense with allergy/interaction tracking ----

// EnhancedDispenseParams extends DispenseParams with safety checks.
type EnhancedDispenseParams struct {
	DispenseParams
	AllergyCheckPassed     bool
	InteractionCheckPassed bool
	CounselingNotes        string
	DispenseStatus         string
}

// EnhancedDispense fills a prescription with safety check tracking.
func (s *Store) EnhancedDispense(ctx context.Context, p EnhancedDispenseParams) (*domain.Dispensation, error) {
	disp, err := s.Dispense(ctx, p.DispenseParams)
	if err != nil {
		return nil, err
	}

	status := p.DispenseStatus
	if status == "" {
		status = "pending_verification"
	}
	_, err = s.pool.Exec(ctx, `
		UPDATE dispensations
		SET allergy_check_passed = $2, interaction_check_passed = $3,
		    counseling_notes = $4, dispense_status = $5
		WHERE id = $1::uuid`,
		disp.ID, p.AllergyCheckPassed, p.InteractionCheckPassed, p.CounselingNotes, status)
	if err != nil {
		return nil, err
	}
	return s.GetDispensation(ctx, disp.ID)
}

// ---- batch lookup for dispense drawer ----

// BatchWithFifoInfo extends Batch with FIFO priority.
type BatchWithFifoInfo struct {
	Batch        domain.Batch
	MedicineName string
	FIFOPriority int
	TotalStock   float64
}

// ListBatchesWithFifo returns a medicine's active batches with FIFO ordering.
func (s *Store) ListBatchesWithFifo(ctx context.Context, medicineID string) ([]BatchWithFifoInfo, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT b.id::text, b.medicine_id::text, b.batch_number, b.manufacturing_date::text, b.expiry_date::text,
		       b.quantity_on_hand, b.purchase_cost, b.selling_price, b.supplier, b.status, b.received_at, b.created_at, b.updated_at,
		       m.generic_name,
		       (SELECT COALESCE(SUM(b2.quantity_on_hand),0) FROM medicine_batches b2
		        WHERE b2.medicine_id = b.medicine_id AND b2.status = 'active') AS total_stock
		FROM medicine_batches b
		JOIN medicines m ON m.id = b.medicine_id
		WHERE b.medicine_id = $1::uuid AND b.status = 'active'
		  AND (b.expiry_date IS NULL OR b.expiry_date > CURRENT_DATE)
		  AND b.quantity_on_hand > 0
		ORDER BY b.expiry_date ASC NULLS LAST, b.received_at ASC`, medicineID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BatchWithFifoInfo
	priority := 0
	for rows.Next() {
		var bi BatchWithFifoInfo
		priority++
		if err := rows.Scan(&bi.Batch.ID, &bi.Batch.MedicineID, &bi.Batch.BatchNumber,
			&bi.Batch.ManufacturingDate, &bi.Batch.ExpiryDate, &bi.Batch.QuantityOnHand,
			&bi.Batch.PurchaseCost, &bi.Batch.SellingPrice, &bi.Batch.Supplier,
			&bi.Batch.Status, &bi.Batch.ReceivedAt, &bi.Batch.CreatedAt, &bi.Batch.UpdatedAt,
			&bi.MedicineName, &bi.TotalStock); err != nil {
			return nil, err
		}
		bi.FIFOPriority = priority
		out = append(out, bi)
	}
	return out, rows.Err()
}
