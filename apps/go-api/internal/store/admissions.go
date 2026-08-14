package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

const admissionCols = `id::text, patient_id::text, ward, room, bed, admitted_at, attending_doctor_id::text, admission_reason, status, discharged_at, discharge_summary, follow_up_instructions, created_by::text, created_at, updated_at`

func scanAdmission(r pgx.Row) (*domain.Admission, error) {
	var a domain.Admission
	err := r.Scan(&a.ID, &a.PatientID, &a.Ward, &a.Room, &a.Bed, &a.AdmittedAt,
		&a.AttendingDoctorID, &a.AdmissionReason, &a.Status, &a.DischargedAt,
		&a.DischargeSummary, &a.FollowUpInstructions, &a.CreatedBy, &a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// ErrAlreadyAdmitted is returned when a patient already has an active admission.
var ErrAlreadyAdmitted = errors.New("patient already admitted")

// AdmitPatientParams carries the admission details.
type AdmitPatientParams struct {
	PatientID         string
	Ward              string
	Room              string
	Bed               string
	AttendingDoctorID *string
	AdmissionReason   string
	CreatedBy         *string
}

// AdmitPatient admits a patient. The partial unique index guarantees at most
// one active admission per patient.
func (s *Store) AdmitPatient(ctx context.Context, p AdmitPatientParams) (*domain.Admission, error) {
	row := s.pool.QueryRow(ctx, `
		INSERT INTO admissions (patient_id, ward, room, bed, attending_doctor_id, admission_reason, created_by)
		VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6, $7::uuid)
		RETURNING `+admissionCols,
		p.PatientID, p.Ward, p.Room, p.Bed, nullableUUID(p.AttendingDoctorID), p.AdmissionReason, nullableUUID(p.CreatedBy))
	a, err := scanAdmission(row)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, ErrAlreadyAdmitted
		}
		return nil, err
	}
	return a, nil
}

// GetActiveAdmission returns a patient's current admission, if any.
func (s *Store) GetActiveAdmission(ctx context.Context, patientID string) (*domain.Admission, error) {
	a, err := scanAdmission(s.pool.QueryRow(ctx, `
		SELECT `+admissionCols+` FROM admissions
		WHERE patient_id = $1::uuid AND status = 'admitted'
		ORDER BY admitted_at DESC LIMIT 1`, patientID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return a, err
}

// ListAdmissions returns a patient's admission history, newest first.
func (s *Store) ListAdmissions(ctx context.Context, patientID string) ([]domain.Admission, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+admissionCols+` FROM admissions WHERE patient_id = $1::uuid
		ORDER BY admitted_at DESC`, patientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []domain.Admission
	for rows.Next() {
		a, err := scanAdmission(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// DischargePatient finalizes an active admission with a discharge summary.
func (s *Store) DischargePatient(ctx context.Context, admissionID string, summary, followUp string, dischargedAt time.Time) (*domain.Admission, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE admissions SET status = 'discharged', discharged_at = $2, discharge_summary = $3,
		                      follow_up_instructions = $4, updated_at = now()
		WHERE id = $1::uuid AND status = 'admitted'
		RETURNING `+admissionCols,
		admissionID, dischargedAt, summary, followUp)
	a, err := scanAdmission(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return a, err
}
