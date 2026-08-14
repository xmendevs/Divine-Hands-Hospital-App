package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

// ErrInvalidTransition is returned when an order status transition is not allowed.
var ErrInvalidTransition = errors.New("invalid order status transition")

// orderTransitions defines the allowed status flow.
var orderTransitions = map[string]map[string]bool{
	domain.OrderStatusDraft:      {domain.OrderStatusSubmitted: true, domain.OrderStatusCancelled: true},
	domain.OrderStatusSubmitted:  {domain.OrderStatusAccepted: true, domain.OrderStatusCancelled: true},
	domain.OrderStatusAccepted:   {domain.OrderStatusInProgress: true, domain.OrderStatusCompleted: true},
	domain.OrderStatusInProgress: {domain.OrderStatusCompleted: true},
}

const orderCols = `id::text, order_no, patient_id::text, order_type, status, department_id::text, ordered_by::text, details, clinical_note_id::text, acted_by::text, cancelled_by::text, cancel_reason, created_at, submitted_at, accepted_at, completed_at, cancelled_at, updated_at`

func scanOrder(r pgx.Row) (*domain.Order, error) {
	var o domain.Order
	err := r.Scan(
		&o.ID, &o.OrderNo, &o.PatientID, &o.OrderType, &o.Status, &o.DepartmentID,
		&o.OrderedBy, &o.Details, &o.ClinicalNoteID, &o.ActedBy, &o.CancelledBy, &o.CancelReason,
		&o.CreatedAt, &o.SubmittedAt, &o.AcceptedAt, &o.CompletedAt, &o.CancelledAt, &o.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &o, nil
}

func nextOrderNo(ctx context.Context, q querier) (string, error) {
	var n int64
	if err := q.QueryRow(ctx, `SELECT nextval('orders_no_seq')`).Scan(&n); err != nil {
		return "", err
	}
	return fmt.Sprintf("ORD%06d", n), nil
}

// CreateOrderParams carries the fields for creating an order.
type CreateOrderParams struct {
	PatientID      string
	OrderType      string
	DepartmentID   *string
	OrderedBy      string
	Details        map[string]any
	ClinicalNoteID *string
	Submit         bool
}

// CreateOrder inserts an order (draft or submitted) in one transaction, and
// auto-creates a linked department task for submitted nursing orders.
func (s *Store) CreateOrder(ctx context.Context, p CreateOrderParams) (*domain.Order, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	orderNo, err := nextOrderNo(ctx, tx)
	if err != nil {
		return nil, err
	}
	if p.Details == nil {
		p.Details = map[string]any{}
	}
	details, _ := json.Marshal(p.Details)

	status := domain.OrderStatusDraft
	var submittedAt *time.Time
	if p.Submit {
		status = domain.OrderStatusSubmitted
		now := time.Now()
		submittedAt = &now
	}

	row := tx.QueryRow(ctx, `
		INSERT INTO orders (order_no, patient_id, order_type, status, department_id, ordered_by, details, clinical_note_id, submitted_at)
		VALUES ($1, $2::uuid, $3, $4, $5::uuid, $6::uuid, $7::jsonb, $8::uuid, $9)
		RETURNING `+orderCols,
		orderNo, p.PatientID, p.OrderType, status, nullableUUID(p.DepartmentID),
		p.OrderedBy, details, nullableUUID(p.ClinicalNoteID), submittedAt)
	order, err := scanOrder(row)
	if err != nil {
		return nil, err
	}

	if err := appendTimelineTx(ctx, tx, p.PatientID, domain.EventOrderCreated,
		"Order created: "+orderNo, map[string]any{"orderNo": orderNo, "orderType": p.OrderType, "status": status}, &p.OrderedBy); err != nil {
		return nil, err
	}

	// A submitted nursing order becomes an actionable department task.
	if p.OrderType == domain.OrderTypeNursingOrder && p.Submit {
		title := "Nursing order " + orderNo
		if t, ok := p.Details["title"].(string); ok && t != "" {
			title = t
		}
		desc, _ := p.Details["instruction"].(string)
		if _, err := tx.Exec(ctx, `
			INSERT INTO department_tasks (patient_id, department_id, order_id, title, description, created_by)
			VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid)`,
			p.PatientID, nullableUUID(p.DepartmentID), order.ID, title, desc, p.OrderedBy); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return order, nil
}

// GetOrder returns an order by internal UUID.
func (s *Store) GetOrder(ctx context.Context, id string) (*domain.Order, error) {
	o, err := scanOrder(s.pool.QueryRow(ctx, `SELECT `+orderCols+` FROM orders WHERE id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return o, err
}

// ListPatientOrders returns a patient's orders, newest first.
func (s *Store) ListPatientOrders(ctx context.Context, patientID string) ([]domain.Order, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+orderCols+` FROM orders WHERE patient_id = $1::uuid
		ORDER BY created_at DESC, id`, patientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanOrders(rows)
}

// ListActionableOrders returns orders awaiting or receiving nursing action.
func (s *Store) ListActionableOrders(ctx context.Context, limit, offset int) ([]domain.Order, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+orderCols+` FROM orders
		WHERE status IN ('submitted','accepted','in_progress')
		ORDER BY created_at ASC LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanOrders(rows)
}

func scanOrders(rows pgx.Rows) ([]domain.Order, error) {
	var out []domain.Order
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *o)
	}
	return out, rows.Err()
}

// SubmitOrder moves a draft order to submitted.
func (s *Store) SubmitOrder(ctx context.Context, id, actorID string) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE orders SET status = 'submitted', submitted_at = now(), updated_at = now()
		WHERE id = $1::uuid AND status = 'draft'`, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrInvalidTransition
	}
	return nil
}

// CancelOrder cancels a draft or submitted order with a reason.
func (s *Store) CancelOrder(ctx context.Context, id, reason, actorID string) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE orders SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2::uuid,
		                 cancel_reason = $3, updated_at = now()
		WHERE id = $1::uuid AND status IN ('draft','submitted')`, id, actorID, reason)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrInvalidTransition
	}
	return nil
}

// TransitionOrder applies an accepted/in_progress/completed transition.
func (s *Store) TransitionOrder(ctx context.Context, id, targetStatus, actorID string) error {
	o, err := s.GetOrder(ctx, id)
	if err != nil {
		return err
	}
	if !orderTransitions[o.Status][targetStatus] {
		return ErrInvalidTransition
	}

	var setCol string
	switch targetStatus {
	case domain.OrderStatusAccepted:
		setCol = `, accepted_at = now()`
	case domain.OrderStatusCompleted:
		setCol = `, completed_at = now()`
	}

	_, err = s.pool.Exec(ctx, `
		UPDATE orders SET status = $2, acted_by = $3::uuid, updated_at = now()`+setCol+`
		WHERE id = $1::uuid`, id, targetStatus, actorID)
	return err
}

// AddAdministrationParams carries a medication administration record.
type AddAdministrationParams struct {
	OrderID        string
	PatientID      string
	Medication     string
	Dose           string
	Route          string
	AdministeredBy string
	AdministeredAt time.Time
	Notes          string
}

// AddAdministration records a nurse administration (MAR) linked to a prescription order.
func (s *Store) AddAdministration(ctx context.Context, p AddAdministrationParams) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO medication_administrations (order_id, patient_id, medication, dose, route, administered_by, administered_at, notes)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, $7, $8)
		RETURNING id::text`,
		p.OrderID, p.PatientID, p.Medication, p.Dose, p.Route, p.AdministeredBy, p.AdministeredAt, p.Notes).Scan(&id)
	return id, err
}

// ListAdministrations returns a patient's MAR, newest first.
func (s *Store) ListAdministrations(ctx context.Context, patientID string) ([]domain.MedicationAdministration, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, order_id::text, patient_id::text, medication, dose, route,
		       administered_by::text, administered_at, notes, created_at
		FROM medication_administrations WHERE patient_id = $1::uuid
		ORDER BY administered_at DESC`, patientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []domain.MedicationAdministration
	for rows.Next() {
		var a domain.MedicationAdministration
		if err := rows.Scan(&a.ID, &a.OrderID, &a.PatientID, &a.Medication, &a.Dose, &a.Route,
			&a.AdministeredBy, &a.AdministeredAt, &a.Notes, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
