package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

const labConsumableCols = `id::text, item_code, name, category, packaging_unit, batch_lot_number,
	reorder_level, unit_cost, quantity_on_hand, storage_location, supplier, expiry_date::text,
	active, notes, created_by::text, created_at, updated_at`

func scanLabConsumable(r pgx.Row) (*domain.LabConsumable, error) {
	var lc domain.LabConsumable
	err := r.Scan(&lc.ID, &lc.ItemCode, &lc.Name, &lc.Category, &lc.PackagingUnit, &lc.BatchLotNumber,
		&lc.ReorderLevel, &lc.UnitCost, &lc.QuantityOnHand, &lc.StorageLocation, &lc.Supplier,
		&lc.ExpiryDate, &lc.Active, &lc.Notes, &lc.CreatedBy, &lc.CreatedAt, &lc.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &lc, nil
}

func nextLabConsumableCode(ctx context.Context, q querier) (string, error) {
	var n int64
	if err := q.QueryRow(ctx, `SELECT nextval('lab_consumables_no_seq')`).Scan(&n); err != nil {
		return "", err
	}
	return "LAB-CON-" + lpadInt(n, 3), nil
}

// CreateLabConsumableParams carries a new lab consumable.
type CreateLabConsumableParams struct {
	Name            string
	Category        string
	PackagingUnit   string
	BatchLotNumber  string
	ReorderLevel    float64
	UnitCost        float64
	QuantityOnHand  float64
	StorageLocation string
	Supplier        string
	ExpiryDate      string
	Notes           string
	CreatedBy       string
}

// CreateLabConsumable registers a new lab consumable with a generated code.
func (s *Store) CreateLabConsumable(ctx context.Context, p CreateLabConsumableParams) (*domain.LabConsumable, error) {
	code, err := nextLabConsumableCode(ctx, s.pool)
	if err != nil {
		return nil, err
	}
	row := s.pool.QueryRow(ctx, `
		INSERT INTO lab_consumables (item_code, name, category, packaging_unit, batch_lot_number,
		                             reorder_level, unit_cost, quantity_on_hand, storage_location,
		                             supplier, expiry_date, notes, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12, $13::uuid)
		RETURNING `+labConsumableCols,
		code, p.Name, p.Category, p.PackagingUnit, p.BatchLotNumber,
		p.ReorderLevel, p.UnitCost, p.QuantityOnHand, p.StorageLocation,
		p.Supplier, nullableText(p.ExpiryDate), p.Notes, nullableUUID(&p.CreatedBy))
	return scanLabConsumable(row)
}

// ListLabConsumables returns lab consumables, optionally filtered by search.
func (s *Store) ListLabConsumables(ctx context.Context, search string, limit, offset int) ([]domain.LabConsumable, error) {
	q := `SELECT ` + labConsumableCols + ` FROM lab_consumables WHERE active`
	args := []any{}
	if search != "" {
		args = append(args, "%"+search+"%")
		q += ` AND (name ILIKE $` + itoa(len(args)) + ` OR item_code ILIKE $` + itoa(len(args)) + ` OR category ILIKE $` + itoa(len(args)) + `)`
	}
	q += ` ORDER BY name ASC LIMIT $` + itoa(len(args)+1) + ` OFFSET $` + itoa(len(args)+2)
	args = append(args, limit, offset)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.LabConsumable, 0)
	for rows.Next() {
		lc, err := scanLabConsumable(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *lc)
	}
	return out, rows.Err()
}

// GetLabConsumable returns a lab consumable by ID.
func (s *Store) GetLabConsumable(ctx context.Context, id string) (*domain.LabConsumable, error) {
	lc, err := scanLabConsumable(s.pool.QueryRow(ctx, `SELECT `+labConsumableCols+` FROM lab_consumables WHERE id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return lc, err
}

// UpdateLabConsumableParams carries editable lab consumable fields.
type UpdateLabConsumableParams struct {
	Name            string
	Category        string
	PackagingUnit   string
	BatchLotNumber  string
	ReorderLevel    float64
	UnitCost        float64
	QuantityOnHand  float64
	StorageLocation string
	Supplier        string
	ExpiryDate      string
	Notes           string
	Active          bool
}

// UpdateLabConsumable updates a lab consumable record.
func (s *Store) UpdateLabConsumable(ctx context.Context, id string, p UpdateLabConsumableParams) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE lab_consumables SET name = $2, category = $3, packaging_unit = $4, batch_lot_number = $5,
		                           reorder_level = $6, unit_cost = $7, quantity_on_hand = $8,
		                           storage_location = $9, supplier = $10, expiry_date = $11::date,
		                           notes = $12, active = $13, updated_at = now()
		WHERE id = $1::uuid`,
		id, p.Name, p.Category, p.PackagingUnit, p.BatchLotNumber,
		p.ReorderLevel, p.UnitCost, p.QuantityOnHand, p.StorageLocation,
		p.Supplier, nullableText(p.ExpiryDate), p.Notes, p.Active)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteLabConsumable soft-deletes a lab consumable.
func (s *Store) DeleteLabConsumable(ctx context.Context, id string) error {
	ct, err := s.pool.Exec(ctx, `UPDATE lab_consumables SET active = false, updated_at = now() WHERE id = $1::uuid`, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
