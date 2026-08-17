package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

// ErrInsufficientStock is returned when not enough dispensable stock exists.
var ErrInsufficientStock = errors.New("insufficient stock")

// ErrNotDispensable is returned when a batch cannot be dispensed (expired/quarantined).
var ErrNotDispensable = errors.New("batch is not dispensable")

const medicineCols = `id::text, code, generic_name, brand, strength, dosage_form, category, supplier, reorder_level, storage_location, unit_cost, selling_price, active, created_at, updated_at`

func scanMedicine(r pgx.Row) (*domain.Medicine, error) {
	var m domain.Medicine
	err := r.Scan(&m.ID, &m.Code, &m.GenericName, &m.Brand, &m.Strength, &m.DosageForm,
		&m.Category, &m.Supplier, &m.ReorderLevel, &m.StorageLocation, &m.UnitCost, &m.SellingPrice,
		&m.Active, &m.CreatedAt, &m.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &m, nil
}

func nextMedicineCode(ctx context.Context, q querier) (string, error) {
	var n int64
	if err := q.QueryRow(ctx, `SELECT nextval('medicines_no_seq')`).Scan(&n); err != nil {
		return "", err
	}
	return "MED" + lpadInt(n, 6), nil
}

func lpadInt(n int64, width int) string {
	s := strconvItoa(n)
	for len(s) < width {
		s = "0" + s
	}
	return s
}

func strconvItoa(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// CreateMedicineParams carries a new medicine master record.
type CreateMedicineParams struct {
	GenericName     string
	Brand           string
	Strength        string
	DosageForm      string
	Category        string
	Supplier        string
	ReorderLevel    float64
	StorageLocation string
	UnitCost        float64
	SellingPrice    float64
}

// CreateMedicine creates a medicine master record with a generated code.
func (s *Store) CreateMedicine(ctx context.Context, p CreateMedicineParams) (*domain.Medicine, error) {
	code, err := nextMedicineCode(ctx, s.pool)
	if err != nil {
		return nil, err
	}
	row := s.pool.QueryRow(ctx, `
		INSERT INTO medicines (code, generic_name, brand, strength, dosage_form, category, supplier, reorder_level, storage_location, unit_cost, selling_price)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING `+medicineCols,
		code, p.GenericName, p.Brand, p.Strength, p.DosageForm, p.Category, p.Supplier,
		p.ReorderLevel, p.StorageLocation, p.UnitCost, p.SellingPrice)
	return scanMedicine(row)
}

// GetMedicine returns a medicine by internal UUID.
func (s *Store) GetMedicine(ctx context.Context, id string) (*domain.Medicine, error) {
	m, err := scanMedicine(s.pool.QueryRow(ctx, `SELECT `+medicineCols+` FROM medicines WHERE id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return m, err
}

// ListMedicines returns medicines, newest first.
func (s *Store) ListMedicines(ctx context.Context, limit, offset int) ([]domain.Medicine, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+medicineCols+` FROM medicines ORDER BY generic_name ASC LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.Medicine, 0)
	for rows.Next() {
		m, err := scanMedicine(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

// UpdateMedicineParams carries editable medicine master fields.
type UpdateMedicineParams struct {
	GenericName     string
	Brand           string
	Strength        string
	DosageForm      string
	Category        string
	Supplier        string
	ReorderLevel    float64
	StorageLocation string
	UnitCost        float64
	SellingPrice    float64
	Active          bool
}

// UpdateMedicine updates a medicine master record.
func (s *Store) UpdateMedicine(ctx context.Context, id string, p UpdateMedicineParams) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE medicines SET generic_name = $2, brand = $3, strength = $4, dosage_form = $5,
		                     category = $6, supplier = $7, reorder_level = $8, storage_location = $9,
		                     unit_cost = $10, selling_price = $11, active = $12, updated_at = now()
		WHERE id = $1::uuid`,
		id, p.GenericName, p.Brand, p.Strength, p.DosageForm, p.Category, p.Supplier,
		p.ReorderLevel, p.StorageLocation, p.UnitCost, p.SellingPrice, p.Active)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ---- batches ----

const batchCols = `id::text, medicine_id::text, batch_number, manufacturing_date::text, expiry_date::text, quantity_on_hand, purchase_cost, selling_price, supplier, status, received_at, created_at, updated_at`

func scanBatch(r pgx.Row) (*domain.Batch, error) {
	var b domain.Batch
	err := r.Scan(&b.ID, &b.MedicineID, &b.BatchNumber, &b.ManufacturingDate, &b.ExpiryDate,
		&b.QuantityOnHand, &b.PurchaseCost, &b.SellingPrice, &b.Supplier, &b.Status,
		&b.ReceivedAt, &b.CreatedAt, &b.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &b, nil
}

// GetBatch returns a batch by internal UUID.
func (s *Store) GetBatch(ctx context.Context, id string) (*domain.Batch, error) {
	b, err := scanBatch(s.pool.QueryRow(ctx, `SELECT `+batchCols+` FROM medicine_batches WHERE id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return b, err
}

// ListBatches returns a medicine's batches, FEFO order.
func (s *Store) ListBatches(ctx context.Context, medicineID string) ([]domain.Batch, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+batchCols+` FROM medicine_batches WHERE medicine_id = $1::uuid
		ORDER BY expiry_date ASC NULLS LAST, received_at ASC`, medicineID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.Batch, 0)
	for rows.Next() {
		b, err := scanBatch(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *b)
	}
	return out, rows.Err()
}

// ReceiveStockParams carries a stock receipt (purchase).
type ReceiveStockParams struct {
	MedicineID        string
	BatchNumber       string
	ManufacturingDate string
	ExpiryDate        string
	Quantity          float64
	PurchaseCost      float64
	SellingPrice      float64
	Supplier          string
	PerformedBy       string
}

// ReceiveStock adds quantity to a batch (creating it if new) and records a
// receipt movement.
func (s *Store) ReceiveStock(ctx context.Context, p ReceiveStockParams) (*domain.Batch, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var batch domain.Batch
	var before float64
	err = tx.QueryRow(ctx, `
		SELECT id::text, medicine_id::text, batch_number, manufacturing_date::text, expiry_date::text,
		       quantity_on_hand, purchase_cost, selling_price, supplier, status, received_at, created_at, updated_at
		FROM medicine_batches WHERE medicine_id = $1::uuid AND batch_number = $2
		FOR UPDATE`, p.MedicineID, p.BatchNumber).
		Scan(&batch.ID, &batch.MedicineID, &batch.BatchNumber, &batch.ManufacturingDate, &batch.ExpiryDate,
			&batch.QuantityOnHand, &batch.PurchaseCost, &batch.SellingPrice, &batch.Supplier, &batch.Status,
			&batch.ReceivedAt, &batch.CreatedAt, &batch.UpdatedAt)

	if errors.Is(err, pgx.ErrNoRows) {
		before = 0
		batch, err = s.insertBatchTx(ctx, tx, p)
		if err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	} else {
		before = batch.QuantityOnHand
	}

	after := before + p.Quantity
	if _, err := tx.Exec(ctx, `
		UPDATE medicine_batches SET quantity_on_hand = $2, updated_at = now()
		WHERE id = $1::uuid`, batch.ID, after); err != nil {
		return nil, err
	}

	if err := insertMovementTx(ctx, tx, p.MedicineID, batch.ID, domain.MovementReceipt,
		p.Quantity, before, after, "stock receipt", "receipt", nil, p.PerformedBy); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	batch.QuantityOnHand = after
	return &batch, nil
}

func (s *Store) insertBatchTx(ctx context.Context, tx pgx.Tx, p ReceiveStockParams) (domain.Batch, error) {
	var b domain.Batch
	err := tx.QueryRow(ctx, `
		INSERT INTO medicine_batches (medicine_id, batch_number, manufacturing_date, expiry_date, quantity_on_hand, purchase_cost, selling_price, supplier)
		VALUES ($1::uuid, $2, $3::date, $4::date, $5, $6, $7, $8)
		RETURNING `+batchCols,
		p.MedicineID, p.BatchNumber, nullableText(p.ManufacturingDate), nullableText(p.ExpiryDate),
		p.Quantity, p.PurchaseCost, p.SellingPrice, p.Supplier).Scan(
		&b.ID, &b.MedicineID, &b.BatchNumber, &b.ManufacturingDate, &b.ExpiryDate,
		&b.QuantityOnHand, &b.PurchaseCost, &b.SellingPrice, &b.Supplier, &b.Status,
		&b.ReceivedAt, &b.CreatedAt, &b.UpdatedAt)
	if err != nil {
		return domain.Batch{}, err
	}
	return b, nil
}

func insertMovementTx(ctx context.Context, tx pgx.Tx, medicineID, batchID, movementType string, quantity, before, after float64, reason, refType string, refID *string, performedBy string) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO stock_movements (medicine_id, batch_id, movement_type, quantity, quantity_before, quantity_after, reason, reference_type, reference_id, performed_by)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::uuid, $10::uuid)`,
		medicineID, batchID, movementType, quantity, before, after, reason, refType, nullableUUID(refID), performedBy)
	return err
}

// ---- returns / damage / quarantine / transfer ----

// ReturnStock adds returned quantity back to a batch.
func (s *Store) ReturnStock(ctx context.Context, batchID string, quantity float64, reason, performedBy string) error {
	return s.applyBatchDelta(ctx, batchID, quantity, domain.MovementReturn, reason, "", nil, performedBy)
}

// DamageStock writes off damaged/expired quantity from a batch.
func (s *Store) DamageStock(ctx context.Context, batchID string, quantity float64, reason, performedBy string) error {
	if quantity <= 0 {
		return errors.New("damage quantity must be positive")
	}
	return s.applyBatchDelta(ctx, batchID, -quantity, domain.MovementDamage, reason, "", nil, performedBy)
}

// QuarantineBatch marks a batch non-dispensable (remaining stock held).
func (s *Store) QuarantineBatch(ctx context.Context, batchID, reason, performedBy string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var medicineID string
	var qty float64
	err = tx.QueryRow(ctx, `SELECT medicine_id::text, quantity_on_hand FROM medicine_batches WHERE id = $1::uuid FOR UPDATE`, batchID).
		Scan(&medicineID, &qty)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `UPDATE medicine_batches SET status = 'quarantined', updated_at = now() WHERE id = $1::uuid`, batchID); err != nil {
		return err
	}
	if err := insertMovementTx(ctx, tx, medicineID, batchID, domain.MovementDamage, 0, qty, qty, reason, "quarantine", &batchID, performedBy); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// TransferStockParams carries a batch-to-batch transfer.
type TransferStockParams struct {
	FromBatchID string
	ToBatchID   string
	Quantity    float64
	Reason      string
	PerformedBy string
}

// TransferStock moves quantity between batches of the same medicine.
func (s *Store) TransferStock(ctx context.Context, p TransferStockParams) error {
	if p.Quantity <= 0 {
		return errors.New("transfer quantity must be positive")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var fromMedicine, toMedicine string
	var fromQty, toQty float64
	err = tx.QueryRow(ctx, `SELECT medicine_id::text, quantity_on_hand FROM medicine_batches WHERE id = $1::uuid FOR UPDATE`, p.FromBatchID).
		Scan(&fromMedicine, &fromQty)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	err = tx.QueryRow(ctx, `SELECT medicine_id::text, quantity_on_hand FROM medicine_batches WHERE id = $1::uuid FOR UPDATE`, p.ToBatchID).
		Scan(&toMedicine, &toQty)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if fromMedicine != toMedicine {
		return errors.New("transfers must be between batches of the same medicine")
	}
	if fromQty < p.Quantity {
		return ErrInsufficientStock
	}

	if _, err := tx.Exec(ctx, `UPDATE medicine_batches SET quantity_on_hand = quantity_on_hand - $2, updated_at = now() WHERE id = $1::uuid`, p.FromBatchID, p.Quantity); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE medicine_batches SET quantity_on_hand = quantity_on_hand + $2, updated_at = now() WHERE id = $1::uuid`, p.ToBatchID, p.Quantity); err != nil {
		return err
	}
	if err := insertMovementTx(ctx, tx, fromMedicine, p.FromBatchID, domain.MovementTransferOut, -p.Quantity, fromQty, fromQty-p.Quantity, p.Reason, "transfer", &p.ToBatchID, p.PerformedBy); err != nil {
		return err
	}
	if err := insertMovementTx(ctx, tx, toMedicine, p.ToBatchID, domain.MovementTransferIn, p.Quantity, toQty, toQty+p.Quantity, p.Reason, "transfer", &p.FromBatchID, p.PerformedBy); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// applyBatchDelta applies a signed quantity delta with a movement record.
func (s *Store) applyBatchDelta(ctx context.Context, batchID string, delta float64, movementType, reason, refType string, refID *string, performedBy string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var medicineID string
	var before float64
	err = tx.QueryRow(ctx, `SELECT medicine_id::text, quantity_on_hand FROM medicine_batches WHERE id = $1::uuid FOR UPDATE`, batchID).
		Scan(&medicineID, &before)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}

	after := before + delta
	if after < 0 {
		return ErrInsufficientStock
	}
	if _, err := tx.Exec(ctx, `UPDATE medicine_batches SET quantity_on_hand = $2, updated_at = now() WHERE id = $1::uuid`, batchID, after); err != nil {
		return err
	}
	if err := insertMovementTx(ctx, tx, medicineID, batchID, movementType, delta, before, after, reason, refType, refID, performedBy); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ---- movements ----

// ListMovements returns stock movements, optionally filtered by batch.
func (s *Store) ListMovements(ctx context.Context, medicineID string, batchID *string, limit, offset int) ([]domain.StockMovement, error) {
	q := `SELECT id::text, medicine_id::text, batch_id::text, movement_type, quantity, quantity_before, quantity_after, reason, reference_type, reference_id::text, performed_by::text, created_at
	      FROM stock_movements WHERE medicine_id = $1::uuid`
	args := []any{medicineID}
	if batchID != nil {
		q += ` AND batch_id = $2::uuid`
		args = append(args, *batchID)
	}
	q += ` ORDER BY created_at DESC LIMIT $` + itoa(len(args)+1) + ` OFFSET $` + itoa(len(args)+2)
	args = append(args, limit, offset)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.StockMovement, 0)
	for rows.Next() {
		var m domain.StockMovement
		if err := rows.Scan(&m.ID, &m.MedicineID, &m.BatchID, &m.MovementType, &m.Quantity,
			&m.QuantityBefore, &m.QuantityAfter, &m.Reason, &m.ReferenceType, &m.ReferenceID,
			&m.PerformedBy, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ---- alerts ----

// LowStockItem pairs a medicine with its total on-hand quantity.
type LowStockItem struct {
	Medicine      domain.Medicine
	TotalQuantity float64
}

// AlertBatch pairs a batch with its medicine name/code for alert display.
type AlertBatch struct {
	Batch        domain.Batch
	MedicineName string
	MedicineCode string
}

// Alerts is the aggregate low-stock / expiry alert result.
type Alerts struct {
	LowStock []LowStockItem
	Expiring []AlertBatch
	Expired  []AlertBatch
}

// GetAlerts returns low-stock medicines and expiring/expired batches.
func (s *Store) GetAlerts(ctx context.Context) (*Alerts, error) {
	res := &Alerts{}

	rows, err := s.pool.Query(ctx, `
		SELECT m.id::text, m.code, m.generic_name, m.brand, m.strength, m.dosage_form, m.category, m.supplier,
		       m.reorder_level, m.storage_location, m.unit_cost, m.selling_price, m.active, m.created_at, m.updated_at,
		       COALESCE((SELECT SUM(b.quantity_on_hand) FROM medicine_batches b WHERE b.medicine_id = m.id), 0) AS total
		FROM medicines m
		WHERE m.active AND COALESCE((SELECT SUM(b.quantity_on_hand) FROM medicine_batches b WHERE b.medicine_id = m.id), 0) <= m.reorder_level
		ORDER BY m.generic_name`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var m domain.Medicine
		var total float64
		if err := rows.Scan(&m.ID, &m.Code, &m.GenericName, &m.Brand, &m.Strength, &m.DosageForm, &m.Category, &m.Supplier,
			&m.ReorderLevel, &m.StorageLocation, &m.UnitCost, &m.SellingPrice, &m.Active, &m.CreatedAt, &m.UpdatedAt, &total); err != nil {
			rows.Close()
			return nil, err
		}
		res.LowStock = append(res.LowStock, LowStockItem{Medicine: m, TotalQuantity: total})
	}
	rows.Close()

	expiryDays := s.expiryAlertDays(ctx)

	batchRows, err := s.pool.Query(ctx, `
		SELECT b.id::text, b.medicine_id::text, b.batch_number, b.manufacturing_date::text, b.expiry_date::text,
		       b.quantity_on_hand, b.purchase_cost, b.selling_price, b.supplier, b.status, b.received_at, b.created_at, b.updated_at,
		       m.generic_name, m.code
		FROM medicine_batches b JOIN medicines m ON m.id = b.medicine_id
		WHERE b.status = 'active' AND b.expiry_date IS NOT NULL AND b.expiry_date <= CURRENT_DATE + ($1 * INTERVAL '1 day')
		ORDER BY b.expiry_date ASC`, expiryDays)
	if err != nil {
		return nil, err
	}
	for batchRows.Next() {
		var ab AlertBatch
		if err := batchRows.Scan(&ab.Batch.ID, &ab.Batch.MedicineID, &ab.Batch.BatchNumber, &ab.Batch.ManufacturingDate, &ab.Batch.ExpiryDate,
			&ab.Batch.QuantityOnHand, &ab.Batch.PurchaseCost, &ab.Batch.SellingPrice, &ab.Batch.Supplier, &ab.Batch.Status,
			&ab.Batch.ReceivedAt, &ab.Batch.CreatedAt, &ab.Batch.UpdatedAt, &ab.MedicineName, &ab.MedicineCode); err != nil {
			batchRows.Close()
			return nil, err
		}
		if ab.Batch.ExpiryDate != nil && *ab.Batch.ExpiryDate <= time.Now().Format("2006-01-02") {
			res.Expired = append(res.Expired, ab)
		} else {
			res.Expiring = append(res.Expiring, ab)
		}
	}
	batchRows.Close()

	return res, nil
}

func (s *Store) expiryAlertDays(ctx context.Context) int {
	var val []byte
	err := s.pool.QueryRow(ctx, `SELECT value FROM system_settings WHERE key = 'pharmacy.expiry_alert_days'`).Scan(&val)
	if err != nil {
		return 30
	}
	var days float64
	if json.Unmarshal(val, &days) != nil {
		return 30
	}
	return int(days)
}
