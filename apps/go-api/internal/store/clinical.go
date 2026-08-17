package store

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

// ---- clinical notes (immutable, versioned) ----

const noteCols = `id::text, group_id::text, patient_id::text, note_type, department_id::text, author_user_id::text, author_role, note, diagnosis, treatment_plan, version, created_at`

func scanNote(r pgx.Row) (*domain.ClinicalNote, error) {
	var n domain.ClinicalNote
	err := r.Scan(&n.ID, &n.GroupID, &n.PatientID, &n.NoteType, &n.DepartmentID,
		&n.AuthorUserID, &n.AuthorRole, &n.Note, &n.Diagnosis, &n.TreatmentPlan, &n.Version, &n.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &n, nil
}

// CreateNoteParams carries a new (version 1) clinical note.
type CreateNoteParams struct {
	PatientID     string
	NoteType      string
	DepartmentID  *string
	AuthorUserID  string
	AuthorRole    string
	Note          string
	Diagnosis     string
	TreatmentPlan string
}

// CreateNote creates the first version of a note in a new note group.
func (s *Store) CreateNote(ctx context.Context, p CreateNoteParams) (*domain.ClinicalNote, error) {
	row := s.pool.QueryRow(ctx, `
		INSERT INTO clinical_notes (group_id, patient_id, note_type, department_id, author_user_id, author_role, note, diagnosis, treatment_plan, version)
		VALUES (gen_random_uuid(), $1::uuid, $2, $3::uuid, $4::uuid, $5, $6, $7, $8, 1)
		RETURNING `+noteCols,
		p.PatientID, p.NoteType, nullableUUID(p.DepartmentID), p.AuthorUserID, p.AuthorRole,
		p.Note, p.Diagnosis, p.TreatmentPlan)
	n, err := scanNote(row)
	if err != nil {
		return nil, err
	}
	return n, nil
}

// ListNotes returns the current (latest) version of each note group, newest first.
func (s *Store) ListNotes(ctx context.Context, patientID string) ([]domain.ClinicalNote, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT * FROM (
			SELECT DISTINCT ON (group_id) `+noteCols+`
			FROM clinical_notes WHERE patient_id = $1::uuid
			ORDER BY group_id, version DESC
		) latest ORDER BY created_at DESC`, patientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.ClinicalNote, 0)
	for rows.Next() {
		n, err := scanNote(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *n)
	}
	return out, rows.Err()
}

// ListNoteVersions returns every version of a note group, oldest first.
func (s *Store) ListNoteVersions(ctx context.Context, groupID string) ([]domain.ClinicalNote, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+noteCols+` FROM clinical_notes WHERE group_id = $1::uuid ORDER BY version ASC`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.ClinicalNote, 0)
	for rows.Next() {
		n, err := scanNote(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *n)
	}
	if len(out) == 0 {
		return nil, ErrNotFound
	}
	return out, rows.Err()
}

// AddNoteVersionParams appends a new version to an existing note group.
type AddNoteVersionParams struct {
	GroupID       string
	PatientID     string
	DepartmentID  *string
	AuthorUserID  string
	AuthorRole    string
	Note          string
	Diagnosis     string
	TreatmentPlan string
}

// AddNoteVersion appends an immutable new version; prior versions are retained.
func (s *Store) AddNoteVersion(ctx context.Context, p AddNoteVersionParams) (*domain.ClinicalNote, error) {
	row := s.pool.QueryRow(ctx, `
		INSERT INTO clinical_notes (group_id, patient_id, note_type, department_id, author_user_id, author_role, note, diagnosis, treatment_plan, version)
		SELECT group_id, patient_id, note_type, $3::uuid, $4::uuid, $5, $6, $7, $8,
		       (SELECT COALESCE(MAX(version), 0) + 1 FROM clinical_notes WHERE group_id = $1::uuid)
		FROM clinical_notes
		WHERE group_id = $1::uuid AND patient_id = $2::uuid
		ORDER BY version DESC LIMIT 1
		RETURNING `+noteCols,
		p.GroupID, p.PatientID, nullableUUID(p.DepartmentID), p.AuthorUserID, p.AuthorRole,
		p.Note, p.Diagnosis, p.TreatmentPlan)
	n, err := scanNote(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return n, err
}

// ---- observations & vitals ----

// AddObservation records a vitals/observation entry.
func (s *Store) AddObservation(ctx context.Context, patientID, category string, measurements map[string]any, notes, recordedBy string) (string, error) {
	if measurements == nil {
		measurements = map[string]any{}
	}
	b, _ := json.Marshal(measurements)
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO patient_observations (patient_id, category, measurements, notes, recorded_by)
		VALUES ($1::uuid, $2, $3::jsonb, $4, $5::uuid)
		RETURNING id::text`,
		patientID, category, b, notes, recordedBy).Scan(&id)
	return id, err
}

// ListObservations returns observations, optionally filtered by category.
func (s *Store) ListObservations(ctx context.Context, patientID, category string, limit int) ([]domain.Observation, error) {
	q := `SELECT id::text, patient_id::text, category, measurements, notes, recorded_by::text, recorded_at
	      FROM patient_observations WHERE patient_id = $1::uuid`
	args := []any{patientID}
	if category != "" {
		q += ` AND category = $2`
		args = append(args, category)
	}
	q += ` ORDER BY recorded_at DESC LIMIT $` + itoa(len(args)+1)
	args = append(args, limit)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.Observation, 0)
	for rows.Next() {
		var o domain.Observation
		if err := rows.Scan(&o.ID, &o.PatientID, &o.Category, &o.Measurements, &o.Notes, &o.RecordedBy, &o.RecordedAt); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// itoa is a tiny helper to format the LIMIT/OFFSET placeholder index.
func itoa(n int) string {
	return strconv.Itoa(n)
}

// ---- department tasks ----

// CreateTaskParams carries a new department task.
type CreateTaskParams struct {
	PatientID    *string
	DepartmentID *string
	OrderID      *string
	Title        string
	Description  string
	AssignedTo   *string
	CreatedBy    string
}

// CreateTask creates a department task.
func (s *Store) CreateTask(ctx context.Context, p CreateTaskParams) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO department_tasks (patient_id, department_id, order_id, title, description, assigned_to, created_by)
		VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid, $7::uuid)
		RETURNING id::text`,
		nullableUUID(p.PatientID), nullableUUID(p.DepartmentID), nullableUUID(p.OrderID),
		p.Title, p.Description, nullableUUID(p.AssignedTo), p.CreatedBy).Scan(&id)
	return id, err
}

// GetTask returns a task by internal UUID.
func (s *Store) GetTask(ctx context.Context, id string) (*domain.Task, error) {
	var t domain.Task
	err := s.pool.QueryRow(ctx, `
		SELECT id::text, patient_id::text, department_id::text, order_id::text, title, description,
		       status, assigned_to::text, created_by::text, created_at, completed_at, completed_by::text
		FROM department_tasks WHERE id = $1::uuid`, id).
		Scan(&t.ID, &t.PatientID, &t.DepartmentID, &t.OrderID, &t.Title, &t.Description,
			&t.Status, &t.AssignedTo, &t.CreatedBy, &t.CreatedAt, &t.CompletedAt, &t.CompletedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &t, err
}

// CompleteTask marks a task completed.
func (s *Store) CompleteTask(ctx context.Context, id, completedBy string) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE department_tasks SET status = 'completed', completed_at = now(), completed_by = $2::uuid
		WHERE id = $1::uuid AND status IN ('pending','in_progress')`, id, completedBy)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ListTasks returns tasks, optionally filtered by status.
func (s *Store) ListTasks(ctx context.Context, status string, limit, offset int) ([]domain.Task, error) {
	q := `SELECT id::text, patient_id::text, department_id::text, order_id::text, title, description,
	             status, assigned_to::text, created_by::text, created_at, completed_at, completed_by::text
	      FROM department_tasks`
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
	return scanTasks(rows)
}

// ListPatientTasks returns a patient's tasks.
func (s *Store) ListPatientTasks(ctx context.Context, patientID string) ([]domain.Task, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, patient_id::text, department_id::text, order_id::text, title, description,
		       status, assigned_to::text, created_by::text, created_at, completed_at, completed_by::text
		FROM department_tasks WHERE patient_id = $1::uuid ORDER BY created_at DESC`, patientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTasks(rows)
}

func scanTasks(rows pgx.Rows) ([]domain.Task, error) {
	out := make([]domain.Task, 0)
	for rows.Next() {
		var t domain.Task
		if err := rows.Scan(&t.ID, &t.PatientID, &t.DepartmentID, &t.OrderID, &t.Title, &t.Description,
			&t.Status, &t.AssignedTo, &t.CreatedBy, &t.CreatedAt, &t.CompletedAt, &t.CompletedBy); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ---- clinical reports ----

// CreateReportParams carries a new clinical report.
type CreateReportParams struct {
	PatientID    string
	ReportType   string
	Title        string
	Content      string
	AuthorUserID string
	DepartmentID *string
}

// CreateReport creates a clinical report.
func (s *Store) CreateReport(ctx context.Context, p CreateReportParams) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO clinical_reports (patient_id, report_type, title, content, author_user_id, department_id)
		VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6::uuid)
		RETURNING id::text`,
		p.PatientID, p.ReportType, p.Title, p.Content, p.AuthorUserID, nullableUUID(p.DepartmentID)).Scan(&id)
	return id, err
}

// ListReports returns a patient's reports, newest first.
func (s *Store) ListReports(ctx context.Context, patientID string) ([]domain.ClinicalReport, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, patient_id::text, report_type, title, content, author_user_id::text, department_id::text, created_at
		FROM clinical_reports WHERE patient_id = $1::uuid ORDER BY created_at DESC`, patientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.ClinicalReport, 0)
	for rows.Next() {
		var r domain.ClinicalReport
		if err := rows.Scan(&r.ID, &r.PatientID, &r.ReportType, &r.Title, &r.Content,
			&r.AuthorUserID, &r.DepartmentID, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ---- emergency triage ----

// TriageParams carries the minimal data for fast emergency registration + triage.
type TriageParams struct {
	FirstName      string
	LastName       string
	Gender         string
	ChiefComplaint string
	TriageLevel    string
	Measurements   map[string]any
	TriagedBy      string
}

// RegisterTriage creates an emergency patient and a triage record atomically.
func (s *Store) RegisterTriage(ctx context.Context, p TriageParams) (*domain.Patient, *domain.Triage, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	firstName := p.FirstName
	if firstName == "" {
		firstName = "Unknown"
	}
	lastName := p.LastName
	if lastName == "" {
		lastName = "Unknown"
	}

	var patientNo string
	if err := tx.QueryRow(ctx, `SELECT next_patient_id('DHHE')`).Scan(&patientNo); err != nil {
		return nil, nil, err
	}

	row := tx.QueryRow(ctx, `
		INSERT INTO patients (patient_no, registration_type, first_name, last_name, gender)
		VALUES ($1, 'emergency', $2, $3, $4)
		RETURNING `+patientCols, patientNo, firstName, lastName, p.Gender)
	patient, err := scanPatient(row)
	if err != nil {
		return nil, nil, err
	}

	if err := appendTimelineTx(ctx, tx, patient.ID, domain.EventPatientRegistered,
		"Emergency patient registered", map[string]any{"patientNo": patientNo, "registrationType": "emergency"}, &p.TriagedBy); err != nil {
		return nil, nil, err
	}

	if p.Measurements == nil {
		p.Measurements = map[string]any{}
	}
	measurements, _ := json.Marshal(p.Measurements)

	var triageID string
	err = tx.QueryRow(ctx, `
		INSERT INTO triage (patient_id, triage_level, chief_complaint, measurements, triaged_by)
		VALUES ($1::uuid, $2, $3, $4::jsonb, $5::uuid)
		RETURNING id::text`,
		patient.ID, p.TriageLevel, p.ChiefComplaint, measurements, p.TriagedBy).Scan(&triageID)
	if err != nil {
		return nil, nil, err
	}

	if err := appendTimelineTx(ctx, tx, patient.ID, domain.EventTriage,
		"Patient triaged", map[string]any{"triageLevel": p.TriageLevel, "chiefComplaint": p.ChiefComplaint}, &p.TriagedBy); err != nil {
		return nil, nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}

	var tr domain.Triage
	err = s.pool.QueryRow(ctx, `
		SELECT id::text, patient_id::text, triage_level, chief_complaint, measurements, triaged_by::text, created_at
		FROM triage WHERE id = $1::uuid`, triageID).
		Scan(&tr.ID, &tr.PatientID, &tr.TriageLevel, &tr.ChiefComplaint, &tr.Measurements, &tr.TriagedBy, &tr.CreatedAt)
	if err != nil {
		return nil, nil, err
	}
	return patient, &tr, nil
}

// ---- patient assignments ----

// AssignPatientParams carries a patient → clinician assignment.
type AssignPatientParams struct {
	PatientID      string
	AssigneeUserID string
	DepartmentID   *string
	AssignedBy     string
}

// AssignPatient links a patient to a clinician (active assignment).
func (s *Store) AssignPatient(ctx context.Context, p AssignPatientParams) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO patient_assignments (patient_id, assignee_user_id, department_id, assigned_by)
		VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)
		RETURNING id::text`,
		p.PatientID, p.AssigneeUserID, nullableUUID(p.DepartmentID), p.AssignedBy).Scan(&id)
	return id, err
}

// QueueItem is a patient assigned to a clinician (for their queue).
type QueueItem struct {
	AssignmentID string
	PatientID    string
	PatientNo    string
	FirstName    string
	LastName     string
	Gender       string
	DateOfBirth  string
	Phone        string
	AssignedAt   time.Time
}

// ListMyQueue returns the active patients assigned to a clinician.
func (s *Store) ListMyQueue(ctx context.Context, assigneeUserID string) ([]QueueItem, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT a.id::text, p.id::text, p.patient_no, p.first_name, p.last_name, p.gender,
		       COALESCE(p.date_of_birth::text, ''), p.phone, a.created_at
		FROM patient_assignments a JOIN patients p ON p.id = a.patient_id
		WHERE a.assignee_user_id = $1::uuid AND a.ended_at IS NULL
		ORDER BY a.created_at DESC`, assigneeUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]QueueItem, 0)
	for rows.Next() {
		var it QueueItem
		if err := rows.Scan(&it.AssignmentID, &it.PatientID, &it.PatientNo, &it.FirstName, &it.LastName,
			&it.Gender, &it.DateOfBirth, &it.Phone, &it.AssignedAt); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}
