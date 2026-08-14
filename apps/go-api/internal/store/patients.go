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

// ErrInvalidField is returned when a requested correction targets an
// unsupported field.
var ErrInvalidField = errors.New("invalid field")

// querier abstracts *pgxpool.Pool and pgx.Tx so reads can run inside or
// outside a transaction.
type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// patientCols is the canonical column projection (with casts) for patients.
const patientCols = `id::text, patient_no, registration_type::text, family_id::text, first_name, last_name, middle_name, gender, date_of_birth::text, blood_group, genotype, marital_status, occupation, phone, alternate_phone, email, address_line1, address_line2, city, state, postal_code, country, identification_type, identification_number, next_of_kin_name, next_of_kin_relationship, next_of_kin_phone, consent_given, consent_date, privacy_notes, status::text, created_by::text, created_at, updated_at`

func scanPatient(r pgx.Row) (*domain.Patient, error) {
	var (
		p       domain.Patient
		regType string
		status  string
	)
	err := r.Scan(
		&p.ID, &p.PatientNo, &regType, &p.FamilyID,
		&p.FirstName, &p.LastName, &p.MiddleName, &p.Gender, &p.DateOfBirth,
		&p.BloodGroup, &p.Genotype, &p.MaritalStatus, &p.Occupation,
		&p.Phone, &p.AlternatePhone, &p.Email,
		&p.AddressLine1, &p.AddressLine2, &p.City, &p.State, &p.PostalCode, &p.Country,
		&p.IdentificationType, &p.IdentificationNumber,
		&p.NextOfKinName, &p.NextOfKinRelation, &p.NextOfKinPhone,
		&p.ConsentGiven, &p.ConsentDate, &p.PrivacyNotes,
		&status, &p.CreatedBy, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	p.RegistrationType = domain.RegistrationType(regType)
	p.Status = domain.PatientStatus(status)
	return &p, nil
}

func patientPrefix(rt domain.RegistrationType) string {
	switch rt {
	case domain.RegistrationAntenatal:
		return "DHHA"
	case domain.RegistrationEmergency:
		return "DHHE"
	default:
		return "DHH"
	}
}

func nullableText(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// RegisterPatientParams carries everything captured at registration.
type RegisterPatientParams struct {
	RegistrationType     domain.RegistrationType
	FamilyID             *string
	FirstName            string
	LastName             string
	MiddleName           string
	Gender               string
	DateOfBirth          string // ISO date, "" when unknown
	BloodGroup           string
	Genotype             string
	MaritalStatus        string
	Occupation           string
	Phone                string
	AlternatePhone       string
	Email                string
	AddressLine1         string
	AddressLine2         string
	City                 string
	State                string
	PostalCode           string
	Country              string
	IdentificationType   string
	IdentificationNumber string
	NextOfKinName        string
	NextOfKinRelation    string
	NextOfKinPhone       string
	ConsentGiven         bool
	PrivacyNotes         string
	CreatedBy            *string
}

// RegisterPatient inserts a patient and allocates their business ID in a single
// transaction. The ID is generated transactionally via next_patient_id and can
// never be duplicated.
func (s *Store) RegisterPatient(ctx context.Context, p RegisterPatientParams) (*domain.Patient, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var patientNo string
	if err := tx.QueryRow(ctx, `SELECT next_patient_id($1)`, patientPrefix(p.RegistrationType)).Scan(&patientNo); err != nil {
		return nil, err
	}

	var consentDate *time.Time
	if p.ConsentGiven {
		now := time.Now()
		consentDate = &now
	}

	row := tx.QueryRow(ctx, `
		INSERT INTO patients (
			patient_no, registration_type, family_id,
			first_name, last_name, middle_name, gender, date_of_birth,
			blood_group, genotype, marital_status, occupation,
			phone, alternate_phone, email,
			address_line1, address_line2, city, state, postal_code, country,
			identification_type, identification_number,
			next_of_kin_name, next_of_kin_relationship, next_of_kin_phone,
			consent_given, consent_date, privacy_notes, created_by
		) VALUES (
			$1, $2::patient_registration_type, $3::uuid,
			$4, $5, $6, $7, $8::date,
			$9, $10, $11, $12,
			$13, $14, $15,
			$16, $17, $18, $19, $20, $21,
			$22, $23,
			$24, $25, $26,
			$27, $28, $29, $30::uuid
		)
		RETURNING `+patientCols,
		patientNo, string(p.RegistrationType), nullableUUID(p.FamilyID),
		p.FirstName, p.LastName, p.MiddleName, p.Gender, nullableText(p.DateOfBirth),
		p.BloodGroup, p.Genotype, p.MaritalStatus, p.Occupation,
		p.Phone, p.AlternatePhone, p.Email,
		p.AddressLine1, p.AddressLine2, p.City, p.State, p.PostalCode, p.Country,
		p.IdentificationType, p.IdentificationNumber,
		p.NextOfKinName, p.NextOfKinRelation, p.NextOfKinPhone,
		p.ConsentGiven, consentDate, p.PrivacyNotes, nullableUUID(p.CreatedBy),
	)
	patient, err := scanPatient(row)
	if err != nil {
		return nil, err
	}

	if err := appendTimelineTx(ctx, tx, patient.ID, domain.EventPatientRegistered,
		"Patient registered", map[string]any{"patientNo": patient.PatientNo, "registrationType": p.RegistrationType}, p.CreatedBy); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return patient, nil
}

// GetPatient returns a patient by internal UUID.
func (s *Store) GetPatient(ctx context.Context, id string) (*domain.Patient, error) {
	return getPatient(ctx, s.pool, `WHERE id = $1::uuid`, id)
}

// GetPatientByNo returns a patient by business ID.
func (s *Store) GetPatientByNo(ctx context.Context, no string) (*domain.Patient, error) {
	return getPatient(ctx, s.pool, `WHERE patient_no = $1`, no)
}

func getPatient(ctx context.Context, q querier, where string, arg any) (*domain.Patient, error) {
	p, err := scanPatient(q.QueryRow(ctx, `SELECT `+patientCols+` FROM patients `+where, arg))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

// UpdatePatientParams carries the editable demographics/contact/consent fields.
type UpdatePatientParams struct {
	FirstName            string
	LastName             string
	MiddleName           string
	Gender               string
	DateOfBirth          string
	BloodGroup           string
	Genotype             string
	MaritalStatus        string
	Occupation           string
	Phone                string
	AlternatePhone       string
	Email                string
	AddressLine1         string
	AddressLine2         string
	City                 string
	State                string
	PostalCode           string
	Country              string
	IdentificationType   string
	IdentificationNumber string
	NextOfKinName        string
	NextOfKinRelation    string
	NextOfKinPhone       string
	ConsentGiven         bool
	PrivacyNotes         string
}

// UpdatePatient applies a full demographics update.
func (s *Store) UpdatePatient(ctx context.Context, id string, p UpdatePatientParams) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE patients SET
			first_name = $2, last_name = $3, middle_name = $4, gender = $5,
			date_of_birth = $6::date, blood_group = $7, genotype = $8,
			marital_status = $9, occupation = $10,
			phone = $11, alternate_phone = $12, email = $13,
			address_line1 = $14, address_line2 = $15, city = $16, state = $17,
			postal_code = $18, country = $19,
			identification_type = $20, identification_number = $21,
			next_of_kin_name = $22, next_of_kin_relationship = $23, next_of_kin_phone = $24,
			consent_given = $25,
			consent_date = CASE WHEN $25 THEN COALESCE(consent_date, now()) ELSE NULL END,
			privacy_notes = $26, updated_at = now()
		WHERE id = $1::uuid`,
		id, p.FirstName, p.LastName, p.MiddleName, p.Gender,
		nullableText(p.DateOfBirth), p.BloodGroup, p.Genotype,
		p.MaritalStatus, p.Occupation,
		p.Phone, p.AlternatePhone, p.Email,
		p.AddressLine1, p.AddressLine2, p.City, p.State,
		p.PostalCode, p.Country,
		p.IdentificationType, p.IdentificationNumber,
		p.NextOfKinName, p.NextOfKinRelation, p.NextOfKinPhone,
		p.ConsentGiven, p.PrivacyNotes,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// patientField is a whitelisted, amendable patient field. The column name is a
// fixed identifier (never user input), and cast is appended in the UPDATE.
type patientField struct {
	column string
	cast   string
}

var amendablePatientFields = map[string]patientField{
	"firstName":            {column: "first_name"},
	"lastName":             {column: "last_name"},
	"middleName":           {column: "middle_name"},
	"gender":               {column: "gender"},
	"dateOfBirth":          {column: "date_of_birth", cast: "::date"},
	"bloodGroup":           {column: "blood_group"},
	"genotype":             {column: "genotype"},
	"phone":                {column: "phone"},
	"identificationNumber": {column: "identification_number"},
}

func patientFieldValue(p *domain.Patient, fieldName string) any {
	switch fieldName {
	case "firstName":
		return p.FirstName
	case "lastName":
		return p.LastName
	case "middleName":
		return p.MiddleName
	case "gender":
		return p.Gender
	case "dateOfBirth":
		if p.DateOfBirth == nil {
			return nil
		}
		return *p.DateOfBirth
	case "bloodGroup":
		return p.BloodGroup
	case "genotype":
		return p.Genotype
	case "phone":
		return p.Phone
	case "identificationNumber":
		return p.IdentificationNumber
	default:
		return nil
	}
}

// AmendPatientField records a correction (before/after) and applies it in one
// transaction, so patient-level clinical fields are never silently overwritten.
func (s *Store) AmendPatientField(ctx context.Context, patientID, fieldName, newValue, reason string, amendedBy *string) error {
	f, ok := amendablePatientFields[fieldName]
	if !ok {
		return ErrInvalidField
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	p, err := getPatient(ctx, tx, `WHERE id = $1::uuid`, patientID)
	if err != nil {
		return err
	}

	prev := patientFieldValue(p, fieldName)
	prevJSON, _ := json.Marshal(prev)
	newJSON, _ := json.Marshal(newValue)

	if _, err := tx.Exec(ctx, `
		INSERT INTO patient_amendments (patient_id, section, field_name, previous_value, new_value, reason, amended_by)
		VALUES ($1::uuid, 'demographics', $2, $3::jsonb, $4::jsonb, $5, $6::uuid)`,
		patientID, f.column, prevJSON, newJSON, reason, nullableUUID(amendedBy)); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, fmt.Sprintf(
		`UPDATE patients SET %s = $1%s, updated_at = now() WHERE id = $2::uuid`,
		f.column, f.cast), newValue, patientID); err != nil {
		return err
	}

	if err := appendTimelineTx(ctx, tx, patientID, domain.EventPatientAmended,
		"Patient record amended: "+f.column, map[string]any{"field": f.column, "reason": reason}, amendedBy); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// AddClinicalEntry appends an entry to a patient clinical section.
func (s *Store) AddClinicalEntry(ctx context.Context, patientID, section, summary string, details map[string]any, recordedBy *string) (string, error) {
	if details == nil {
		details = map[string]any{}
	}
	b, _ := json.Marshal(details)
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO patient_clinical_entries (patient_id, section, summary, details, recorded_by)
		VALUES ($1::uuid, $2, $3, $4::jsonb, $5::uuid)
		RETURNING id::text`,
		patientID, section, summary, b, nullableUUID(recordedBy)).Scan(&id)
	return id, err
}

// ListClinicalEntries returns all clinical entries for a patient, newest first.
func (s *Store) ListClinicalEntries(ctx context.Context, patientID string) ([]domain.ClinicalEntry, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, patient_id::text, section, summary, details, recorded_by::text, created_at, updated_at
		FROM patient_clinical_entries WHERE patient_id = $1::uuid
		ORDER BY created_at DESC, id`, patientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []domain.ClinicalEntry
	for rows.Next() {
		var e domain.ClinicalEntry
		if err := rows.Scan(&e.ID, &e.PatientID, &e.Section, &e.Summary, &e.Details, &e.RecordedBy, &e.CreatedAt, &e.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// AmendClinicalEntryParams describes a clinical-entry correction.
type AmendClinicalEntryParams struct {
	EntryID   string
	PatientID string
	Summary   *string
	Details   map[string]any // merged into the existing details when non-nil
	Reason    string
	AmendedBy *string
}

// AmendClinicalEntry records the before/after state of a clinical entry and
// applies the correction atomically.
func (s *Store) AmendClinicalEntry(ctx context.Context, p AmendClinicalEntryParams) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var (
		section string
		summary string
		details []byte
	)
	err = tx.QueryRow(ctx, `
		SELECT section, summary, details
		FROM patient_clinical_entries WHERE id = $1::uuid AND patient_id = $2::uuid`,
		p.EntryID, p.PatientID).Scan(&section, &summary, &details)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}

	var prevDetails map[string]any
	_ = json.Unmarshal(details, &prevDetails)
	if prevDetails == nil {
		prevDetails = map[string]any{}
	}

	newSummary := summary
	if p.Summary != nil {
		newSummary = *p.Summary
	}
	newDetails := prevDetails
	if p.Details != nil {
		for k, v := range p.Details {
			newDetails[k] = v
		}
	}

	prevJSON, _ := json.Marshal(map[string]any{"summary": summary, "details": prevDetails})
	newJSON, _ := json.Marshal(map[string]any{"summary": newSummary, "details": newDetails})
	detailsJSON, _ := json.Marshal(newDetails)

	if _, err := tx.Exec(ctx, `
		INSERT INTO patient_amendments (patient_id, section, entry_id, field_name, previous_value, new_value, reason, amended_by)
		VALUES ($1::uuid, $2, $3::uuid, '', $4::jsonb, $5::jsonb, $6, $7::uuid)`,
		p.PatientID, section, p.EntryID, prevJSON, newJSON, p.Reason, nullableUUID(p.AmendedBy)); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE patient_clinical_entries SET summary = $3, details = $4::jsonb, updated_at = now()
		WHERE id = $1::uuid AND patient_id = $2::uuid`,
		p.EntryID, p.PatientID, newSummary, detailsJSON); err != nil {
		return err
	}

	if err := appendTimelineTx(ctx, tx, p.PatientID, domain.EventClinicalAmended,
		"Clinical record amended: "+section, map[string]any{"section": section, "reason": p.Reason}, p.AmendedBy); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// SearchPatients matches by business ID or permitted demographic identifiers.
func (s *Store) SearchPatients(ctx context.Context, q string, limit, offset int) ([]domain.PatientSummary, error) {
	like := "%" + q + "%"
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, patient_no, registration_type::text, first_name, last_name, gender,
		       COALESCE(date_of_birth::text, ''), phone
		FROM patients
		WHERE patient_no ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1
		   OR phone ILIKE $1 OR identification_number ILIKE $1
		ORDER BY patient_no LIMIT $2 OFFSET $3`, like, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanSummaries(rows)
}

// DuplicateCandidates surfaces potential duplicate patients before registration.
func (s *Store) DuplicateCandidates(ctx context.Context, identificationNumber, firstName, lastName, dob string) ([]domain.PatientSummary, error) {
	var (
		rows pgx.Rows
		err  error
	)
	cols := `id::text, patient_no, registration_type::text, first_name, last_name, gender,
	         COALESCE(date_of_birth::text, ''), phone`
	if identificationNumber != "" {
		rows, err = s.pool.Query(ctx, `SELECT `+cols+` FROM patients WHERE identification_number = $1 ORDER BY patient_no`, identificationNumber)
	} else if dob != "" {
		rows, err = s.pool.Query(ctx, `SELECT `+cols+` FROM patients
			WHERE lower(first_name) = lower($1) AND lower(last_name) = lower($2) AND date_of_birth = $3::date
			ORDER BY patient_no`, firstName, lastName, dob)
	} else {
		rows, err = s.pool.Query(ctx, `SELECT `+cols+` FROM patients
			WHERE lower(first_name) = lower($1) AND lower(last_name) = lower($2)
			ORDER BY patient_no`, firstName, lastName)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanSummaries(rows)
}

func scanSummaries(rows pgx.Rows) ([]domain.PatientSummary, error) {
	var out []domain.PatientSummary
	for rows.Next() {
		var s domain.PatientSummary
		if err := rows.Scan(&s.ID, &s.PatientNo, &s.RegistrationType, &s.FirstName, &s.LastName, &s.Gender, &s.DateOfBirth, &s.Phone); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// AddFamily creates a family profile with a transactional DHHF business ID.
func (s *Store) AddFamily(ctx context.Context, familyName string, headPatientID, createdBy *string) (*domain.Family, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var familyNo string
	if err := tx.QueryRow(ctx, `SELECT next_patient_id('DHHF')`).Scan(&familyNo); err != nil {
		return nil, err
	}

	var f domain.Family
	err = tx.QueryRow(ctx, `
		INSERT INTO families (family_no, family_name, head_patient_id)
		VALUES ($1, $2, $3::uuid)
		RETURNING id::text, family_no, family_name, head_patient_id::text, created_at, updated_at`,
		familyNo, familyName, nullableUUID(headPatientID)).
		Scan(&f.ID, &f.FamilyNo, &f.FamilyName, &f.HeadPatientID, &f.CreatedAt, &f.UpdatedAt)
	if err != nil {
		return nil, err
	}

	if headPatientID != nil {
		if _, err := tx.Exec(ctx, `UPDATE patients SET family_id = $2::uuid, updated_at = now() WHERE id = $1::uuid`, *headPatientID, f.ID); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &f, nil
}

// GetFamily returns a family by internal UUID.
func (s *Store) GetFamily(ctx context.Context, id string) (*domain.Family, error) {
	var f domain.Family
	err := s.pool.QueryRow(ctx, `
		SELECT id::text, family_no, family_name, head_patient_id::text, created_at, updated_at
		FROM families WHERE id = $1::uuid`, id).
		Scan(&f.ID, &f.FamilyNo, &f.FamilyName, &f.HeadPatientID, &f.CreatedAt, &f.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &f, err
}

// LinkPatientToFamily associates a patient with a family.
func (s *Store) LinkPatientToFamily(ctx context.Context, patientID, familyID string) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE patients SET family_id = $2::uuid, updated_at = now() WHERE id = $1::uuid`, patientID, familyID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ListFamilyMembers returns the patients linked to a family.
func (s *Store) ListFamilyMembers(ctx context.Context, familyID string) ([]domain.PatientSummary, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, patient_no, registration_type::text, first_name, last_name, gender,
		       COALESCE(date_of_birth::text, ''), phone
		FROM patients WHERE family_id = $1::uuid ORDER BY patient_no`, familyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanSummaries(rows)
}

// AppendTimelineEvent appends an event to a patient's timeline.
func (s *Store) AppendTimelineEvent(ctx context.Context, patientID, eventType, summary string, data map[string]any, actor *string) error {
	if data == nil {
		data = map[string]any{}
	}
	b, _ := json.Marshal(data)
	_, err := s.pool.Exec(ctx, `
		INSERT INTO patient_timeline (patient_id, event_type, summary, data, actor_user_id)
		VALUES ($1::uuid, $2, $3, $4::jsonb, $5::uuid)`,
		patientID, eventType, summary, b, nullableUUID(actor))
	return err
}

func appendTimelineTx(ctx context.Context, tx pgx.Tx, patientID, eventType, summary string, data map[string]any, actor *string) error {
	if data == nil {
		data = map[string]any{}
	}
	b, _ := json.Marshal(data)
	_, err := tx.Exec(ctx, `
		INSERT INTO patient_timeline (patient_id, event_type, summary, data, actor_user_id)
		VALUES ($1::uuid, $2, $3, $4::jsonb, $5::uuid)`,
		patientID, eventType, summary, b, nullableUUID(actor))
	return err
}

// ListTimeline returns a patient's timeline, newest first.
func (s *Store) ListTimeline(ctx context.Context, patientID string, limit int) ([]domain.TimelineEvent, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, patient_id::text, event_type, summary, data, actor_user_id::text, occurred_at
		FROM patient_timeline WHERE patient_id = $1::uuid
		ORDER BY occurred_at DESC, id DESC LIMIT $2`, patientID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []domain.TimelineEvent
	for rows.Next() {
		var e domain.TimelineEvent
		if err := rows.Scan(&e.ID, &e.PatientID, &e.EventType, &e.Summary, &e.Data, &e.ActorUserID, &e.OccurredAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// AddDocument records patient document metadata (binary upload lands with the
// object-storage phase).
func (s *Store) AddDocument(ctx context.Context, patientID, documentType, title, fileName, contentType string, fileSize int64, uploadedBy *string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO patient_documents (patient_id, document_type, title, file_name, content_type, file_size, uploaded_by)
		VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid)
		RETURNING id::text`,
		patientID, documentType, title, fileName, contentType, fileSize, nullableUUID(uploadedBy)).Scan(&id)
	return id, err
}

// ListDocuments returns a patient's documents, newest first.
func (s *Store) ListDocuments(ctx context.Context, patientID string) ([]domain.Document, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, patient_id::text, document_type, title, file_name, content_type,
		       file_size, storage_key, uploaded_by::text, created_at
		FROM patient_documents WHERE patient_id = $1::uuid
		ORDER BY created_at DESC`, patientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []domain.Document
	for rows.Next() {
		var d domain.Document
		if err := rows.Scan(&d.ID, &d.PatientID, &d.DocumentType, &d.Title, &d.FileName,
			&d.ContentType, &d.FileSize, &d.StorageKey, &d.UploadedBy, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
