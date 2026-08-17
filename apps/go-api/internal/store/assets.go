package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

// ErrInvalidAssetTransition is returned for disallowed asset status changes.
var ErrInvalidAssetTransition = errors.New("invalid asset status transition")

// assetStatusAllowed maps each status to the statuses it may transition to.
var assetStatusAllowed = map[string][]string{
	domain.AssetStatusAvailable:        {domain.AssetStatusInUse, domain.AssetStatusUnderMaintenance, domain.AssetStatusDamaged, domain.AssetStatusLost, domain.AssetStatusDisposed},
	domain.AssetStatusInUse:            {domain.AssetStatusAvailable, domain.AssetStatusUnderMaintenance, domain.AssetStatusDamaged, domain.AssetStatusLost, domain.AssetStatusDisposed},
	domain.AssetStatusUnderMaintenance: {domain.AssetStatusAvailable, domain.AssetStatusInUse, domain.AssetStatusDamaged, domain.AssetStatusLost, domain.AssetStatusDisposed},
	domain.AssetStatusDamaged:          {domain.AssetStatusUnderMaintenance, domain.AssetStatusDisposed},
	domain.AssetStatusLost:             {domain.AssetStatusDisposed},
	domain.AssetStatusDisposed:         {},
}

// ---- categories ----

// ListAssetCategories returns the seeded asset categories.
func (s *Store) ListAssetCategories(ctx context.Context) ([]domain.AssetCategory, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, code, name, tracking FROM asset_categories ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.AssetCategory, 0)
	for rows.Next() {
		var c domain.AssetCategory
		if err := rows.Scan(&c.ID, &c.Code, &c.Name, &c.Tracking); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) getCategoryTracking(ctx context.Context, categoryID string) (string, error) {
	var tracking string
	err := s.pool.QueryRow(ctx, `SELECT tracking FROM asset_categories WHERE id = $1::uuid`, categoryID).Scan(&tracking)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return tracking, err
}

// ---- assets ----

const assetCols = `a.id::text, a.asset_no, a.name, a.category_id::text, c.code, c.name,
	a.tracking, a.serial_number, a.manufacturer, a.supplier, a.purchase_date::text, a.cost,
	a.location, a.department_id::text, COALESCE(d.name, ''), a.custodian_id::text, a.condition,
	a.warranty_expiry::text, a.status, a.quantity_on_hand, a.notes, a.created_by::text,
	a.created_at, a.updated_at`

const assetFrom = ` FROM assets a
	JOIN asset_categories c ON c.id = a.category_id
	LEFT JOIN departments d ON d.id = a.department_id`

func scanAsset(r pgx.Row) (*domain.Asset, error) {
	var a domain.Asset
	err := r.Scan(&a.ID, &a.AssetNo, &a.Name, &a.CategoryID, &a.CategoryCode, &a.CategoryName,
		&a.Tracking, &a.SerialNumber, &a.Manufacturer, &a.Supplier, &a.PurchaseDate, &a.Cost,
		&a.Location, &a.DepartmentID, &a.DepartmentName, &a.CustodianID, &a.Condition,
		&a.WarrantyExpiry, &a.Status, &a.QuantityOnHand, &a.Notes, &a.CreatedBy,
		&a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func nextAssetCode(ctx context.Context, q querier) (string, error) {
	var n int64
	if err := q.QueryRow(ctx, `SELECT nextval('assets_no_seq')`).Scan(&n); err != nil {
		return "", err
	}
	return "AST" + lpadInt(n, 6), nil
}

// CreateAssetParams carries a new asset registration.
type CreateAssetParams struct {
	Name           string
	CategoryID     string
	SerialNumber   string
	Manufacturer   string
	Supplier       string
	PurchaseDate   string
	Cost           float64
	Location       string
	DepartmentID   *string
	CustodianID    *string
	Condition      string
	WarrantyExpiry string
	QuantityOnHand float64
	Notes          string
	CreatedBy      string
}

// CreateAsset registers an asset and records the opening receipt movement.
func (s *Store) CreateAsset(ctx context.Context, p CreateAssetParams) (*domain.Asset, error) {
	tracking, err := s.getCategoryTracking(ctx, p.CategoryID)
	if err != nil {
		return nil, err
	}
	assetNo, err := nextAssetCode(ctx, s.pool)
	if err != nil {
		return nil, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	quantity := p.QuantityOnHand
	if tracking == domain.AssetTrackingUnit {
		quantity = 1
	}
	if quantity < 0 {
		return nil, errors.New("quantity on hand cannot be negative")
	}

	condition := p.Condition
	if condition == "" {
		condition = domain.AssetConditionGood
	}

	var id string
	row := tx.QueryRow(ctx, `
		INSERT INTO assets (asset_no, name, category_id, tracking, serial_number, manufacturer, supplier,
		                   purchase_date, cost, location, department_id, custodian_id, condition,
		                   warranty_expiry, quantity_on_hand, notes, created_by)
		VALUES ($1, $2, $3::uuid, $4, $5, $6, $7, $8::date, $9, $10, $11::uuid, $12::uuid, $13, $14::date, $15, $16, $17::uuid)
		RETURNING id::text`,
		assetNo, p.Name, p.CategoryID, tracking, p.SerialNumber, p.Manufacturer, p.Supplier,
		nullableText(p.PurchaseDate), p.Cost, p.Location, nullableUUID(p.DepartmentID), nullableUUID(p.CustodianID),
		condition, nullableText(p.WarrantyExpiry), quantity, p.Notes, p.CreatedBy)
	if err := row.Scan(&id); err != nil {
		return nil, fmt.Errorf("insert asset: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO asset_movements (asset_id, movement_type, quantity, quantity_before, quantity_after, reason, reference_type, performed_by)
		VALUES ($1::uuid, 'receipt', $2, 0, $2, 'asset registration', 'registration', $3::uuid)`,
		id, quantity, p.CreatedBy); err != nil {
		return nil, fmt.Errorf("insert asset movement: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit asset: %w", err)
	}
	asset, err := s.GetAsset(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("get created asset: %w", err)
	}
	return asset, nil
}

// GetAsset returns an asset by internal UUID.
func (s *Store) GetAsset(ctx context.Context, id string) (*domain.Asset, error) {
	a, err := scanAsset(s.pool.QueryRow(ctx, `SELECT `+assetCols+assetFrom+` WHERE a.id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return a, err
}

// ListAssetParams filters the asset register.
type ListAssetParams struct {
	CategoryID string
	Status     string
	Department string
	Search     string
	Limit      int
	Offset     int
}

// ListAssets returns assets matching the filters, name first.
func (s *Store) ListAssets(ctx context.Context, p ListAssetParams) ([]domain.Asset, error) {
	q := `SELECT ` + assetCols + assetFrom + ` WHERE true`
	args := []any{}
	addFilter := func(cond string, val any) {
		args = append(args, val)
		q += ` AND ` + cond + ` = $` + itoa(len(args))
	}
	if p.CategoryID != "" {
		addFilter("a.category_id::text", p.CategoryID)
	}
	if p.Status != "" {
		addFilter("a.status", p.Status)
	}
	if p.Department != "" {
		addFilter("a.department_id::text", p.Department)
	}
	if p.Search != "" {
		args = append(args, "%"+p.Search+"%")
		q += ` AND (a.name ILIKE $` + itoa(len(args)) + ` OR a.serial_number ILIKE $` + itoa(len(args)) + ` OR a.asset_no ILIKE $` + itoa(len(args)) + `)`
	}
	q += ` ORDER BY a.name ASC LIMIT $` + itoa(len(args)+1) + ` OFFSET $` + itoa(len(args)+2)
	args = append(args, p.Limit, p.Offset)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.Asset, 0)
	for rows.Next() {
		a, err := scanAsset(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// UpdateAssetParams carries editable asset master fields.
type UpdateAssetParams struct {
	Name           string
	SerialNumber   string
	Manufacturer   string
	Supplier       string
	PurchaseDate   string
	Cost           float64
	Location       string
	DepartmentID   *string
	CustodianID    *string
	Condition      string
	WarrantyExpiry string
	Notes          string
}

// UpdateAsset updates an asset master record.
func (s *Store) UpdateAsset(ctx context.Context, id string, p UpdateAssetParams) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE assets SET name = $2, serial_number = $3, manufacturer = $4, supplier = $5,
		                  purchase_date = $6::date, cost = $7, location = $8, department_id = $9::uuid,
		                  custodian_id = $10::uuid, condition = $11, warranty_expiry = $12::date,
		                  notes = $13, updated_at = now()
		WHERE id = $1::uuid`,
		id, p.Name, p.SerialNumber, p.Manufacturer, p.Supplier, nullableText(p.PurchaseDate),
		p.Cost, p.Location, nullableUUID(p.DepartmentID), nullableUUID(p.CustodianID),
		p.Condition, nullableText(p.WarrantyExpiry), p.Notes)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ---- movements & status history ----

// ListAssetMovements returns an asset's movement ledger, newest first.
func (s *Store) ListAssetMovements(ctx context.Context, assetID string, limit, offset int) ([]domain.AssetMovement, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, asset_id::text, movement_type, quantity, quantity_before, quantity_after,
		       reason, reference_type, reference_id::text, performed_by::text, created_at
		FROM asset_movements WHERE asset_id = $1::uuid
		ORDER BY created_at DESC LIMIT $2 OFFSET $3`, assetID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.AssetMovement, 0)
	for rows.Next() {
		var m domain.AssetMovement
		if err := rows.Scan(&m.ID, &m.AssetID, &m.MovementType, &m.Quantity, &m.QuantityBefore,
			&m.QuantityAfter, &m.Reason, &m.ReferenceType, &m.ReferenceID, &m.PerformedBy, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ListAssetTransfers returns an asset's transfer history, newest first.
func (s *Store) ListAssetTransfers(ctx context.Context, assetID string, limit, offset int) ([]domain.AssetTransfer, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, asset_id::text, quantity, from_department_id::text, to_department_id::text,
		       from_location, to_location, from_custodian_id::text, to_custodian_id::text,
		       reason, transferred_by::text, created_at
		FROM asset_transfers WHERE asset_id = $1::uuid
		ORDER BY created_at DESC LIMIT $2 OFFSET $3`, assetID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.AssetTransfer, 0)
	for rows.Next() {
		var t domain.AssetTransfer
		if err := rows.Scan(&t.ID, &t.AssetID, &t.Quantity, &t.FromDepartment, &t.ToDepartment,
			&t.FromLocation, &t.ToLocation, &t.FromCustodian, &t.ToCustodian,
			&t.Reason, &t.TransferredBy, &t.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ListAssetStatusChanges returns an asset's status history, newest first.
func (s *Store) ListAssetStatusChanges(ctx context.Context, assetID string, limit, offset int) ([]domain.AssetStatusChange, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, asset_id::text, from_status, to_status, reason, changed_by::text, created_at
		FROM asset_status_changes WHERE asset_id = $1::uuid
		ORDER BY created_at DESC LIMIT $2 OFFSET $3`, assetID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.AssetStatusChange, 0)
	for rows.Next() {
		var sc domain.AssetStatusChange
		if err := rows.Scan(&sc.ID, &sc.AssetID, &sc.FromStatus, &sc.ToStatus, &sc.Reason, &sc.ChangedBy, &sc.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, sc)
	}
	return out, rows.Err()
}

// ChangeAssetStatus validates and records a status transition.
func (s *Store) ChangeAssetStatus(ctx context.Context, assetID, toStatus, reason, changedBy string) (*domain.AssetStatusChange, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var fromStatus string
	err = tx.QueryRow(ctx, `SELECT status FROM assets WHERE id = $1::uuid FOR UPDATE`, assetID).Scan(&fromStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if !canTransitionAsset(fromStatus, toStatus) {
		return nil, ErrInvalidAssetTransition
	}

	if _, err := tx.Exec(ctx, `UPDATE assets SET status = $2, updated_at = now() WHERE id = $1::uuid`, assetID, toStatus); err != nil {
		return nil, err
	}
	var sc domain.AssetStatusChange
	if err := tx.QueryRow(ctx, `
		INSERT INTO asset_status_changes (asset_id, from_status, to_status, reason, changed_by)
		VALUES ($1::uuid, $2, $3, $4, $5::uuid)
		RETURNING id::text, asset_id::text, from_status, to_status, reason, changed_by::text, created_at`,
		assetID, fromStatus, toStatus, reason, changedBy).
		Scan(&sc.ID, &sc.AssetID, &sc.FromStatus, &sc.ToStatus, &sc.Reason, &sc.ChangedBy, &sc.CreatedAt); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &sc, nil
}

func canTransitionAsset(from, to string) bool {
	if from == to {
		return false
	}
	for _, s := range assetStatusAllowed[from] {
		if s == to {
			return true
		}
	}
	return false
}

// ---- transfers ----

// TransferAssetParams carries a relocation and/or custody reassignment.
type TransferAssetParams struct {
	AssetID        string
	Quantity       float64
	FromDepartment *string
	ToDepartment   *string
	FromLocation   string
	ToLocation     string
	FromCustodian  *string
	ToCustodian    *string
	Reason         string
	TransferredBy  string
}

// TransferAsset moves quantity (and/or custody) and records the movement.
func (s *Store) TransferAsset(ctx context.Context, p TransferAssetParams) (*domain.AssetTransfer, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var tracking string
	var onHand float64
	err = tx.QueryRow(ctx, `SELECT tracking, quantity_on_hand FROM assets WHERE id = $1::uuid FOR UPDATE`, p.AssetID).
		Scan(&tracking, &onHand)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	quantity := p.Quantity
	if quantity <= 0 {
		quantity = onHand
	}
	if quantity > onHand {
		return nil, ErrInsufficientStock
	}
	if tracking == domain.AssetTrackingUnit && quantity != 1 {
		return nil, errors.New("unit-tracked assets transfer as a single unit")
	}

	// Move quantity in the ledger.
	if quantity > 0 && quantity < onHand {
		if _, err := tx.Exec(ctx, `UPDATE assets SET quantity_on_hand = quantity_on_hand - $2, updated_at = now() WHERE id = $1::uuid`, p.AssetID, quantity); err != nil {
			return nil, err
		}
	}
	// Relocation/custody applies to the asset record directly.
	if _, err := tx.Exec(ctx, `
		UPDATE assets SET department_id = $2::uuid, location = $3, custodian_id = $4::uuid, updated_at = now()
		WHERE id = $1::uuid`,
		p.AssetID, nullableUUID(p.ToDepartment), p.ToLocation, nullableUUID(p.ToCustodian)); err != nil {
		return nil, err
	}

	var t domain.AssetTransfer
	if err := tx.QueryRow(ctx, `
		INSERT INTO asset_transfers (asset_id, quantity, from_department_id, to_department_id, from_location, to_location,
		                             from_custodian_id, to_custodian_id, reason, transferred_by)
		VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7::uuid, $8::uuid, $9, $10::uuid)
		RETURNING id::text, asset_id::text, quantity, from_department_id::text, to_department_id::text, from_location,
		          to_location, from_custodian_id::text, to_custodian_id::text, reason, transferred_by::text, created_at`,
		p.AssetID, quantity, nullableUUID(p.FromDepartment), nullableUUID(p.ToDepartment), p.FromLocation, p.ToLocation,
		nullableUUID(p.FromCustodian), nullableUUID(p.ToCustodian), p.Reason, p.TransferredBy).
		Scan(&t.ID, &t.AssetID, &t.Quantity, &t.FromDepartment, &t.ToDepartment, &t.FromLocation,
			&t.ToLocation, &t.FromCustodian, &t.ToCustodian, &t.Reason, &t.TransferredBy, &t.CreatedAt); err != nil {
		return nil, err
	}
	if quantity > 0 {
		if err := insertAssetMovementTx(ctx, tx, p.AssetID, domain.AssetMovementTransferOut, -quantity, onHand, onHand-quantity, p.Reason, "transfer", &t.ID, p.TransferredBy); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &t, nil
}

// ---- adjustments & counts ----

// AdjustAssetQuantity applies a signed delta to a quantity-tracked asset.
func (s *Store) AdjustAssetQuantity(ctx context.Context, assetID string, delta float64, reason, performedBy string) error {
	if delta == 0 {
		return errors.New("adjustment quantity must be non-zero")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var tracking string
	var before float64
	err = tx.QueryRow(ctx, `SELECT tracking, quantity_on_hand FROM assets WHERE id = $1::uuid FOR UPDATE`, assetID).
		Scan(&tracking, &before)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if tracking != domain.AssetTrackingQuantity {
		return errors.New("only quantity-tracked assets can be adjusted")
	}
	after := before + delta
	if after < 0 {
		return ErrInsufficientStock
	}

	if _, err := tx.Exec(ctx, `UPDATE assets SET quantity_on_hand = $2, updated_at = now() WHERE id = $1::uuid`, assetID, after); err != nil {
		return err
	}
	if err := insertAssetMovementTx(ctx, tx, assetID, domain.AssetMovementAdjustment, delta, before, after, reason, "adjustment", nil, performedBy); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// CreateAssetCountParams carries a physical count for a quantity-tracked asset.
type CreateAssetCountParams struct {
	AssetID         string
	CountedQuantity float64
	CountedBy       string
}

// CreateAssetCount records a count and reconciles the variance.
func (s *Store) CreateAssetCount(ctx context.Context, p CreateAssetCountParams) (*domain.AssetStockCount, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var tracking string
	var system float64
	err = tx.QueryRow(ctx, `SELECT tracking, quantity_on_hand FROM assets WHERE id = $1::uuid FOR UPDATE`, p.AssetID).
		Scan(&tracking, &system)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if tracking != domain.AssetTrackingQuantity {
		return nil, errors.New("only quantity-tracked assets can be counted")
	}

	variance := p.CountedQuantity - system
	if _, err := tx.Exec(ctx, `UPDATE assets SET quantity_on_hand = $2, updated_at = now() WHERE id = $1::uuid`, p.AssetID, p.CountedQuantity); err != nil {
		return nil, err
	}
	if variance != 0 {
		if err := insertAssetMovementTx(ctx, tx, p.AssetID, domain.AssetMovementCountVariance, variance, system, p.CountedQuantity, "physical count", "count", nil, p.CountedBy); err != nil {
			return nil, err
		}
	}

	var sc domain.AssetStockCount
	if err := tx.QueryRow(ctx, `
		INSERT INTO asset_stock_counts (asset_id, system_quantity, counted_quantity, variance, counted_by)
		VALUES ($1::uuid, $2, $3, $4, $5::uuid)
		RETURNING id::text, asset_id::text, system_quantity, counted_quantity, variance, counted_by::text, created_at`,
		p.AssetID, system, p.CountedQuantity, variance, p.CountedBy).
		Scan(&sc.ID, &sc.AssetID, &sc.SystemQuantity, &sc.CountedQuantity, &sc.Variance, &sc.CountedBy, &sc.CreatedAt); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &sc, nil
}

func insertAssetMovementTx(ctx context.Context, tx pgx.Tx, assetID, movementType string, quantity, before, after float64, reason, refType string, refID *string, performedBy string) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO asset_movements (asset_id, movement_type, quantity, quantity_before, quantity_after, reason, reference_type, reference_id, performed_by)
		VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8::uuid, $9::uuid)`,
		assetID, movementType, quantity, before, after, reason, refType, nullableUUID(refID), performedBy)
	return err
}

// ---- service providers ----

// CreateServiceProviderParams carries a maintenance service provider.
type CreateServiceProviderParams struct {
	Name         string
	ContactPhone string
	ContactEmail string
	Address      string
	Notes        string
}

// CreateServiceProvider registers a maintenance service provider.
func (s *Store) CreateServiceProvider(ctx context.Context, p CreateServiceProviderParams) (*domain.ServiceProvider, error) {
	var sp domain.ServiceProvider
	err := s.pool.QueryRow(ctx, `
		INSERT INTO service_providers (name, contact_phone, contact_email, address, notes)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id::text, name, contact_phone, contact_email, address, notes, active, created_at`,
		p.Name, p.ContactPhone, p.ContactEmail, p.Address, p.Notes).
		Scan(&sp.ID, &sp.Name, &sp.ContactPhone, &sp.ContactEmail, &sp.Address, &sp.Notes, &sp.Active, &sp.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &sp, nil
}

// ListServiceProviders returns active providers, name first.
func (s *Store) ListServiceProviders(ctx context.Context) ([]domain.ServiceProvider, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, name, contact_phone, contact_email, address, notes, active, created_at
		FROM service_providers WHERE active ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.ServiceProvider, 0)
	for rows.Next() {
		var sp domain.ServiceProvider
		if err := rows.Scan(&sp.ID, &sp.Name, &sp.ContactPhone, &sp.ContactEmail, &sp.Address, &sp.Notes, &sp.Active, &sp.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, sp)
	}
	return out, rows.Err()
}

// ---- maintenance ----

// CreateMaintenanceScheduleParams carries a recurring maintenance plan.
type CreateMaintenanceScheduleParams struct {
	AssetID         string
	ServiceType     string
	FrequencyDays   int
	NextServiceDate string
	CreatedBy       string
}

// CreateMaintenanceSchedule plans recurring maintenance for an asset.
func (s *Store) CreateMaintenanceSchedule(ctx context.Context, p CreateMaintenanceScheduleParams) (*domain.MaintenanceSchedule, error) {
	if _, err := s.GetAsset(ctx, p.AssetID); err != nil {
		return nil, err
	}
	var ms domain.MaintenanceSchedule
	err := s.pool.QueryRow(ctx, `
		INSERT INTO maintenance_schedules (asset_id, service_type, frequency_days, next_service_date, created_by)
		VALUES ($1::uuid, $2, $3, $4::date, $5::uuid)
		RETURNING id::text, asset_id::text, service_type, frequency_days, next_service_date::text, active, created_by::text, created_at`,
		p.AssetID, p.ServiceType, p.FrequencyDays, p.NextServiceDate, p.CreatedBy).
		Scan(&ms.ID, &ms.AssetID, &ms.ServiceType, &ms.FrequencyDays, &ms.NextServiceDate, &ms.Active, &ms.CreatedBy, &ms.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &ms, nil
}

// ListMaintenanceSchedules returns schedules; dueOnly filters to those whose
// next service date is today or earlier.
func (s *Store) ListMaintenanceSchedules(ctx context.Context, assetID string, dueOnly bool) ([]domain.MaintenanceSchedule, error) {
	q := `SELECT id::text, asset_id::text, service_type, frequency_days, next_service_date::text, active, created_by::text, created_at
	      FROM maintenance_schedules WHERE active`
	args := []any{}
	if assetID != "" {
		args = append(args, assetID)
		q += ` AND asset_id = $` + itoa(len(args)) + `::uuid`
	}
	if dueOnly {
		q += ` AND next_service_date <= CURRENT_DATE`
	}
	q += ` ORDER BY next_service_date ASC`

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.MaintenanceSchedule, 0)
	for rows.Next() {
		var ms domain.MaintenanceSchedule
		if err := rows.Scan(&ms.ID, &ms.AssetID, &ms.ServiceType, &ms.FrequencyDays, &ms.NextServiceDate, &ms.Active, &ms.CreatedBy, &ms.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, ms)
	}
	return out, rows.Err()
}

// CreateMaintenanceRecordParams carries a completed maintenance event.
type CreateMaintenanceRecordParams struct {
	AssetID           string
	ScheduleID        *string
	ServiceProviderID *string
	ServiceType       string
	Description       string
	ServiceDate       string
	DowntimeHours     float64
	Cost              float64
	PerformedBy       string
}

// CreateMaintenanceRecord records completed maintenance. It takes the asset
// out of under_maintenance and advances a linked schedule's next service date.
func (s *Store) CreateMaintenanceRecord(ctx context.Context, p CreateMaintenanceRecordParams) (*domain.MaintenanceRecord, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var exists bool
	if err := tx.QueryRow(ctx, `SELECT true FROM assets WHERE id = $1::uuid`, p.AssetID).Scan(&exists); errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, err
	}

	serviceDate := p.ServiceDate
	if serviceDate == "" {
		serviceDate = time.Now().Format("2006-01-02")
	}

	var nextServiceDate *string
	if p.ScheduleID != nil {
		var freq int
		if err := tx.QueryRow(ctx, `SELECT frequency_days FROM maintenance_schedules WHERE id = $1::uuid`, *p.ScheduleID).Scan(&freq); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrNotFound
			}
			return nil, err
		}
		base, err := time.Parse("2006-01-02", serviceDate)
		if err != nil {
			return nil, errors.New("invalid service date")
		}
		next := base.AddDate(0, 0, freq).Format("2006-01-02")
		nextServiceDate = &next
		if _, err := tx.Exec(ctx, `UPDATE maintenance_schedules SET next_service_date = $2::date WHERE id = $1::uuid`, *p.ScheduleID, next); err != nil {
			return nil, err
		}
	}

	var mr domain.MaintenanceRecord
	if err := tx.QueryRow(ctx, `
		INSERT INTO maintenance_records (asset_id, schedule_id, service_provider_id, service_type, description,
		                                 service_date, downtime_hours, cost, next_service_date, performed_by)
		VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::date, $7, $8, $9::date, $10::uuid)
		RETURNING id::text, asset_id::text, schedule_id::text, service_provider_id::text, service_type, description,
		          service_date::text, downtime_hours, cost, next_service_date::text, performed_by::text, created_at`,
		p.AssetID, nullableUUID(p.ScheduleID), nullableUUID(p.ServiceProviderID), p.ServiceType, p.Description,
		serviceDate, p.DowntimeHours, p.Cost, nullableTextPtr(nextServiceDate), p.PerformedBy).
		Scan(&mr.ID, &mr.AssetID, &mr.ScheduleID, &mr.ServiceProviderID, &mr.ServiceType, &mr.Description,
			&mr.ServiceDate, &mr.DowntimeHours, &mr.Cost, &mr.NextServiceDate, &mr.PerformedBy, &mr.CreatedAt); err != nil {
		return nil, err
	}

	// Serviced assets leave under_maintenance.
	if _, err := tx.Exec(ctx, `
		UPDATE assets SET status = 'available', updated_at = now()
		WHERE id = $1::uuid AND status = 'under_maintenance'`, p.AssetID); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &mr, nil
}

// ListMaintenanceRecords returns an asset's maintenance history, newest first.
func (s *Store) ListMaintenanceRecords(ctx context.Context, assetID string, limit, offset int) ([]domain.MaintenanceRecord, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, asset_id::text, schedule_id::text, service_provider_id::text, service_type, description,
		       service_date::text, downtime_hours, cost, next_service_date::text, performed_by::text, created_at
		FROM maintenance_records WHERE asset_id = $1::uuid
		ORDER BY service_date DESC LIMIT $2 OFFSET $3`, assetID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.MaintenanceRecord, 0)
	for rows.Next() {
		var mr domain.MaintenanceRecord
		if err := rows.Scan(&mr.ID, &mr.AssetID, &mr.ScheduleID, &mr.ServiceProviderID, &mr.ServiceType, &mr.Description,
			&mr.ServiceDate, &mr.DowntimeHours, &mr.Cost, &mr.NextServiceDate, &mr.PerformedBy, &mr.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, mr)
	}
	return out, rows.Err()
}
