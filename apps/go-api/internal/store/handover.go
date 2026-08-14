package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

// Handover errors.
var (
	ErrHandoverNotPending  = errors.New("handover is not pending acknowledgement")
	ErrSelfAcknowledgement = errors.New("cannot acknowledge your own handover")
)

const handoverCols = `h.id::text, h.handover_no, h.outgoing_staff_id::text, h.department_id::text,
	h.shift_id::text, h.patients, h.current_condition, h.medications, h.pending_investigations,
	h.pending_orders, h.important_observations, h.tasks, h.incidents, h.instructions,
	h.status::text, h.created_by::text, h.acknowledged_by::text, h.acknowledged_at,
	h.created_at, h.updated_at,
	COALESCE(ost.first_name || ' ' || ost.last_name, ''), COALESCE(d.name, ''),
	COALESCE(sh.name, ''), COALESCE(ack.first_name || ' ' || ack.last_name, '')`

const handoverFrom = ` FROM handover_notes h
	JOIN staff ost ON ost.id = h.outgoing_staff_id
	LEFT JOIN departments d ON d.id = h.department_id
	LEFT JOIN staff_shifts sh ON sh.id = h.shift_id
	LEFT JOIN users acku ON acku.id = h.acknowledged_by
	LEFT JOIN staff ack ON ack.user_id = acku.id`

func scanHandover(r pgx.Row) (*domain.HandoverNote, error) {
	var h domain.HandoverNote
	err := r.Scan(&h.ID, &h.HandoverNo, &h.OutgoingStaffID, &h.DepartmentID,
		&h.ShiftID, &h.PatientIDs, &h.CurrentCondition, &h.Medications, &h.PendingInvestigations,
		&h.PendingOrders, &h.ImportantObservations, &h.Tasks, &h.Incidents, &h.Instructions,
		&h.Status, &h.CreatedBy, &h.AcknowledgedBy, &h.AcknowledgedAt,
		&h.CreatedAt, &h.UpdatedAt,
		&h.OutgoingStaffName, &h.DepartmentName, &h.ShiftName, &h.AcknowledgedByName)
	if err != nil {
		return nil, err
	}
	return &h, nil
}

// nextHandoverNo returns the next business handover number.
func nextHandoverNo(ctx context.Context, q querier) (string, error) {
	var n int64
	if err := q.QueryRow(ctx, `SELECT nextval('handover_no_seq')`).Scan(&n); err != nil {
		return "", err
	}
	return "HOV" + lpadInt(n, 6), nil
}

// CreateHandoverParams carries a structured handover note.
type CreateHandoverParams struct {
	OutgoingStaffID       string
	DepartmentID          *string
	ShiftID               *string
	PatientIDs            []string
	CurrentCondition      string
	Medications           string
	PendingInvestigations string
	PendingOrders         string
	ImportantObservations string
	Tasks                 string
	Incidents             string
	Instructions          string
	CreatedBy             string
}

// CreateHandover stores a handover note authored by an outgoing nurse.
func (s *Store) CreateHandover(ctx context.Context, p CreateHandoverParams) (*domain.HandoverNote, error) {
	if p.PatientIDs == nil {
		p.PatientIDs = []string{}
	}
	no, err := nextHandoverNo(ctx, s.pool)
	if err != nil {
		return nil, err
	}
	var id string
	if err := s.pool.QueryRow(ctx, `
		INSERT INTO handover_notes (handover_no, outgoing_staff_id, department_id, shift_id, patients,
		                            current_condition, medications, pending_investigations, pending_orders,
		                            important_observations, tasks, incidents, instructions, created_by)
		VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::uuid)
		RETURNING id::text`,
		no, p.OutgoingStaffID, nullableUUID(p.DepartmentID), nullableUUID(p.ShiftID), p.PatientIDs,
		p.CurrentCondition, p.Medications, p.PendingInvestigations, p.PendingOrders,
		p.ImportantObservations, p.Tasks, p.Incidents, p.Instructions, p.CreatedBy).Scan(&id); err != nil {
		return nil, err
	}
	return s.GetHandover(ctx, id)
}

// GetHandover returns a handover note with joins.
func (s *Store) GetHandover(ctx context.Context, id string) (*domain.HandoverNote, error) {
	h, err := scanHandover(s.pool.QueryRow(ctx, `SELECT `+handoverCols+handoverFrom+` WHERE h.id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return h, err
}

// ListHandoverParams filters handover notes.
type ListHandoverParams struct {
	Status     string
	Department string
	Staff      string
	Limit      int
	Offset     int
}

// ListHandovers returns handover notes, newest first.
func (s *Store) ListHandovers(ctx context.Context, p ListHandoverParams) ([]domain.HandoverNote, error) {
	q := `SELECT ` + handoverCols + handoverFrom + ` WHERE true`
	args := []any{}
	if p.Status != "" {
		args = append(args, p.Status)
		q += ` AND h.status = $` + itoa(len(args))
	}
	if p.Department != "" {
		args = append(args, p.Department)
		q += ` AND h.department_id = $` + itoa(len(args)) + `::uuid`
	}
	if p.Staff != "" {
		args = append(args, p.Staff)
		q += ` AND h.outgoing_staff_id = $` + itoa(len(args)) + `::uuid`
	}
	q += ` ORDER BY h.created_at DESC LIMIT $` + itoa(len(args)+1) + ` OFFSET $` + itoa(len(args)+2)
	args = append(args, p.Limit, p.Offset)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []domain.HandoverNote
	for rows.Next() {
		h, err := scanHandover(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *h)
	}
	return out, rows.Err()
}

// AcknowledgeHandover marks a handover as received by an incoming nurse.
// Self-acknowledgement is blocked.
func (s *Store) AcknowledgeHandover(ctx context.Context, id, acknowledgedBy string) (*domain.HandoverNote, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var status, createdBy string
	if err := tx.QueryRow(ctx, `SELECT status::text, created_by::text FROM handover_notes WHERE id = $1::uuid FOR UPDATE`, id).
		Scan(&status, &createdBy); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if status != domain.HandoverStatusCreated {
		return nil, ErrHandoverNotPending
	}
	if createdBy == acknowledgedBy {
		return nil, ErrSelfAcknowledgement
	}
	if _, err := tx.Exec(ctx, `
		UPDATE handover_notes SET status = 'acknowledged', acknowledged_by = $2::uuid,
		                          acknowledged_at = now(), updated_at = now()
		WHERE id = $1::uuid`, id, acknowledgedBy); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetHandover(ctx, id)
}
