package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

// ErrSelfVerification is returned when a user verifies their own entered
// result on a high-risk test.
var ErrSelfVerification = errors.New("cannot verify your own result entry")

// ErrDuplicateTest is returned when a request repeats the same test.
var ErrDuplicateTest = errors.New("duplicate test in request")

// ErrInvalidLabTransition is returned for disallowed lab workflow transitions.
var ErrInvalidLabTransition = errors.New("invalid lab request transition")

// labRequestTransitions maps each status to its allowed next statuses.
var labRequestTransitions = map[string][]string{
	domain.LabStatusRequested:         {domain.LabStatusPayment},
	domain.LabStatusPayment:           {domain.LabStatusSpecimenCollected},
	domain.LabStatusSpecimenCollected: {domain.LabStatusReceived},
	domain.LabStatusReceived:          {domain.LabStatusProcessing, domain.LabStatusSpecimenCollected},
	domain.LabStatusProcessing:        {domain.LabStatusResultEntered},
	domain.LabStatusResultEntered:     {domain.LabStatusVerified},
	domain.LabStatusVerified:          {domain.LabStatusReleased},
	domain.LabStatusReleased:          {},
	domain.LabStatusCancelled:         {},
}

func canTransitionLab(from, to string) bool {
	if from == to {
		return false
	}
	for _, s := range labRequestTransitions[from] {
		if s == to {
			return true
		}
	}
	return false
}

// ---- lab clients ----

const labClientCols = `id::text, client_no, client_type, first_name, last_name, gender, date_of_birth::text,
	phone, email, address_line1, address_line2, city, state, country, referring_facility,
	referring_physician, notes, created_by::text, created_at, updated_at`

func scanLabClient(r pgx.Row) (*domain.LabClient, error) {
	var c domain.LabClient
	err := r.Scan(&c.ID, &c.ClientNo, &c.ClientType, &c.FirstName, &c.LastName, &c.Gender, &c.DateOfBirth,
		&c.Phone, &c.Email, &c.AddressLine1, &c.AddressLine2, &c.City, &c.State, &c.Country,
		&c.ReferringFacility, &c.ReferringPhysician, &c.Notes, &c.CreatedBy, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func nextLabClientCode(ctx context.Context, q querier) (string, error) {
	var n int64
	if err := q.QueryRow(ctx, `SELECT nextval('lab_clients_no_seq')`).Scan(&n); err != nil {
		return "", err
	}
	return "LBC" + lpadInt(n, 6), nil
}

// CreateLabClientParams carries a new external/referral lab client.
type CreateLabClientParams struct {
	ClientType         string
	FirstName          string
	LastName           string
	Gender             string
	DateOfBirth        string
	Phone              string
	Email              string
	AddressLine1       string
	AddressLine2       string
	City               string
	State              string
	Country            string
	ReferringFacility  string
	ReferringPhysician string
	Notes              string
	CreatedBy          string
}

// CreateLabClient registers an external or referral lab client.
func (s *Store) CreateLabClient(ctx context.Context, p CreateLabClientParams) (*domain.LabClient, error) {
	clientNo, err := nextLabClientCode(ctx, s.pool)
	if err != nil {
		return nil, err
	}
	c, err := scanLabClient(s.pool.QueryRow(ctx, `
		INSERT INTO lab_clients (client_no, client_type, first_name, last_name, gender, date_of_birth,
		                         phone, email, address_line1, address_line2, city, state, country,
		                         referring_facility, referring_physician, notes, created_by)
		VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::uuid)
		RETURNING `+labClientCols,
		clientNo, p.ClientType, p.FirstName, p.LastName, p.Gender, nullableText(p.DateOfBirth),
		p.Phone, p.Email, p.AddressLine1, p.AddressLine2, p.City, p.State, p.Country,
		p.ReferringFacility, p.ReferringPhysician, p.Notes, p.CreatedBy))
	if err != nil {
		return nil, err
	}
	return c, nil
}

// GetLabClient returns a lab client by internal UUID.
func (s *Store) GetLabClient(ctx context.Context, id string) (*domain.LabClient, error) {
	c, err := scanLabClient(s.pool.QueryRow(ctx, `SELECT `+labClientCols+` FROM lab_clients WHERE id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return c, err
}

// ListLabClients returns lab clients, optionally filtered by search text.
func (s *Store) ListLabClients(ctx context.Context, search string, limit, offset int) ([]domain.LabClient, error) {
	q := `SELECT ` + labClientCols + ` FROM lab_clients WHERE true`
	args := []any{}
	if search != "" {
		args = append(args, "%"+search+"%")
		q += ` AND (first_name ILIKE $` + itoa(len(args)) + ` OR last_name ILIKE $` + itoa(len(args)) + ` OR client_no ILIKE $` + itoa(len(args)) + ` OR phone ILIKE $` + itoa(len(args)) + `)`
	}
	q += ` ORDER BY last_name ASC, first_name ASC LIMIT $` + itoa(len(args)+1) + ` OFFSET $` + itoa(len(args)+2)
	args = append(args, limit, offset)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.LabClient, 0)
	for rows.Next() {
		c, err := scanLabClient(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// ---- test catalogue ----

const labTestCols = `id::text, code, name, category, price, specimen_type, container, turnaround_minutes,
	units, reference_ranges, verification_required, active, created_at, updated_at`

func scanLabTest(r pgx.Row) (*domain.LabTest, error) {
	var t domain.LabTest
	err := r.Scan(&t.ID, &t.Code, &t.Name, &t.Category, &t.Price, &t.SpecimenType, &t.Container,
		&t.TurnaroundMinutes, &t.Units, &t.ReferenceRanges, &t.VerificationRequired, &t.Active,
		&t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// CreateLabTestParams carries a catalogue entry.
type CreateLabTestParams struct {
	Code                 string
	Name                 string
	Category             string
	Price                float64
	SpecimenType         string
	Container            string
	TurnaroundMinutes    int
	Units                string
	ReferenceRanges      []byte
	VerificationRequired bool
}

// CreateLabTest adds a test to the catalogue.
func (s *Store) CreateLabTest(ctx context.Context, p CreateLabTestParams) (*domain.LabTest, error) {
	if p.TurnaroundMinutes <= 0 {
		p.TurnaroundMinutes = 60
	}
	t, err := scanLabTest(s.pool.QueryRow(ctx, `
		INSERT INTO lab_tests (code, name, category, price, specimen_type, container, turnaround_minutes,
		                       units, reference_ranges, verification_required)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
		RETURNING `+labTestCols,
		p.Code, p.Name, p.Category, p.Price, p.SpecimenType, p.Container, p.TurnaroundMinutes,
		p.Units, jsonBytesOrEmpty(p.ReferenceRanges), p.VerificationRequired))
	if err != nil {
		return nil, err
	}
	return t, nil
}

// GetLabTest returns a catalogue test by internal UUID.
func (s *Store) GetLabTest(ctx context.Context, id string) (*domain.LabTest, error) {
	t, err := scanLabTest(s.pool.QueryRow(ctx, `SELECT `+labTestCols+` FROM lab_tests WHERE id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return t, err
}

// ListLabTests returns active catalogue tests, code first.
func (s *Store) ListLabTests(ctx context.Context) ([]domain.LabTest, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+labTestCols+` FROM lab_tests WHERE active ORDER BY code ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.LabTest, 0)
	for rows.Next() {
		t, err := scanLabTest(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

// UpdateLabTestParams carries editable catalogue fields.
type UpdateLabTestParams struct {
	Code                 string
	Name                 string
	Category             string
	Price                float64
	SpecimenType         string
	Container            string
	TurnaroundMinutes    int
	Units                string
	ReferenceRanges      []byte
	VerificationRequired bool
	Active               bool
}

// UpdateLabTest updates a catalogue entry.
func (s *Store) UpdateLabTest(ctx context.Context, id string, p UpdateLabTestParams) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE lab_tests SET code = $2, name = $3, category = $4, price = $5, specimen_type = $6,
		                     container = $7, turnaround_minutes = $8, units = $9,
		                     reference_ranges = $10::jsonb, verification_required = $11,
		                     active = $12, updated_at = now()
		WHERE id = $1::uuid`,
		id, p.Code, p.Name, p.Category, p.Price, p.SpecimenType, p.Container, p.TurnaroundMinutes,
		p.Units, jsonBytesOrEmpty(p.ReferenceRanges), p.VerificationRequired, p.Active)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func jsonBytesOrEmpty(b []byte) []byte {
	if len(b) == 0 {
		return []byte("{}")
	}
	return b
}

// ---- requests ----

const labRequestCols = `r.id::text, r.request_no, r.patient_id::text, r.client_id::text,
	COALESCE(p.patient_no, ''), COALESCE(p.first_name || ' ' || p.last_name, ''),
	COALESCE(c.client_no, ''), COALESCE(c.first_name || ' ' || c.last_name, ''),
	r.ordered_by::text, COALESCE(st.first_name || ' ' || st.last_name, u.username),
	r.order_id::text,
	r.priority, r.clinical_notes, r.payment_status, r.status, r.cancel_reason,
	r.requested_at, r.released_at, r.created_at, r.updated_at`

const labRequestFrom = ` FROM lab_requests r
	LEFT JOIN patients p ON p.id = r.patient_id
	LEFT JOIN lab_clients c ON c.id = r.client_id
	LEFT JOIN users u ON u.id = r.ordered_by
	LEFT JOIN staff st ON st.user_id = u.id`

func scanLabRequest(r pgx.Row) (*domain.LabRequest, error) {
	var req domain.LabRequest
	err := r.Scan(&req.ID, &req.RequestNo, &req.PatientID, &req.ClientID, &req.PatientNo, &req.PatientName,
		&req.ClientNo, &req.ClientName, &req.OrderedBy, &req.OrderedByName, &req.OrderID, &req.Priority,
		&req.ClinicalNotes, &req.PaymentStatus, &req.Status, &req.CancelReason,
		&req.RequestedAt, &req.ReleasedAt, &req.CreatedAt, &req.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &req, nil
}

func nextLabRequestCode(ctx context.Context, q querier) (string, error) {
	var n int64
	if err := q.QueryRow(ctx, `SELECT nextval('lab_requests_no_seq')`).Scan(&n); err != nil {
		return "", err
	}
	return "LAB" + lpadInt(n, 6), nil
}

// resolveCustomTestTx returns the id of an active catalogue test matching the
// given name (case-insensitive, trimmed). If none exists it registers a new
// catalogue entry with an auto-generated code so the request item always
// references a real lab_tests row.
func (s *Store) resolveCustomTestTx(ctx context.Context, tx pgx.Tx, name, specimenType string) (string, error) {
	name = strings.TrimSpace(name)
	var id string
	err := tx.QueryRow(ctx, `
		SELECT id::text FROM lab_tests
		WHERE active AND lower(name) = lower($1)
		ORDER BY created_at ASC LIMIT 1`, name).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	if specimenType == "" {
		specimenType = "blood"
	}
	var seq int64
	if err := tx.QueryRow(ctx, `SELECT nextval('lab_tests_no_seq')`).Scan(&seq); err != nil {
		return "", err
	}
	code := "CT" + lpadInt(seq, 5)
	if err := tx.QueryRow(ctx, `
		INSERT INTO lab_tests (code, name, category, price, specimen_type, turnaround_minutes)
		VALUES ($1, $2, 'custom', 0, $3, 60)
		RETURNING id::text`, code, name, specimenType).Scan(&id); err != nil {
		return "", err
	}
	return id, nil
}

// CreateLabRequestParams carries a new lab order.
type CreateLabRequestParams struct {
	PatientID     *string
	ClientID      *string
	OrderedBy     string
	Priority      string
	ClinicalNotes string
	TestIDs       []string
	CustomTests   []CustomTestParams
	OrderID       *string
}

// CustomTestParams is a manually typed test on a lab request. If a matching
// active catalogue entry exists (case-insensitive name match) it is reused;
// otherwise the test is registered in the catalogue on the fly so every
// request item still references a real lab_tests row.
type CustomTestParams struct {
	Name         string
	SpecimenType string
}

// CreateLabRequest orders tests for a patient or lab client, snapshotting the
// catalogue prices.
func (s *Store) CreateLabRequest(ctx context.Context, p CreateLabRequestParams) (*domain.LabRequest, error) {
	if (p.PatientID == nil) == (p.ClientID == nil) {
		return nil, errors.New("exactly one of patientId or clientId is required")
	}
	if len(p.TestIDs) == 0 && len(p.CustomTests) == 0 {
		return nil, errors.New("at least one test is required")
	}
	if p.Priority == "" {
		p.Priority = domain.LabPriorityRoutine
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if p.PatientID != nil {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT true FROM patients WHERE id = $1::uuid`, *p.PatientID).Scan(&exists); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrNotFound
			}
			return nil, err
		}
	}
	if p.ClientID != nil {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT true FROM lab_clients WHERE id = $1::uuid`, *p.ClientID).Scan(&exists); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrNotFound
			}
			return nil, err
		}
	}

	requestNo, err := nextLabRequestCode(ctx, tx)
	if err != nil {
		return nil, err
	}

	// When linked to a doctor order, verify it exists and belongs to the same
	// patient, then record the link so releasing results completes the order.
	if p.OrderID != nil {
		if p.PatientID == nil {
			return nil, errors.New("order linkage requires a patient")
		}
		var orderType, orderPatient string
		err := tx.QueryRow(ctx, `
			SELECT order_type, patient_id::text FROM orders WHERE id = $1::uuid`, *p.OrderID).
			Scan(&orderType, &orderPatient)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		if err != nil {
			return nil, err
		}
		if orderType != domain.OrderTypeLabRequest && orderType != domain.OrderTypeLabInvestigation {
			return nil, errors.New("order is not a lab order")
		}
		if orderPatient != *p.PatientID {
			return nil, errors.New("order belongs to a different patient")
		}
	}

	var requestID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO lab_requests (request_no, patient_id, client_id, ordered_by, priority, clinical_notes, order_id)
		VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::uuid)
		RETURNING id::text`,
		requestNo, nullableUUID(p.PatientID), nullableUUID(p.ClientID), p.OrderedBy, p.Priority, p.ClinicalNotes,
		nullableUUID(p.OrderID)).
		Scan(&requestID); err != nil {
		return nil, err
	}

	// Price snapshot from the catalogue; duplicates of a test are rejected.
	// Manually typed tests resolve to an existing catalogue entry by name or
	// are registered on the fly.
	seen := map[string]bool{}
	insertItem := func(testID string) error {
		var price float64
		if err := tx.QueryRow(ctx, `SELECT price FROM lab_tests WHERE id = $1::uuid AND active`, testID).Scan(&price); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO lab_request_items (request_id, test_id, price)
			VALUES ($1::uuid, $2::uuid, $3)`, requestID, testID, price); err != nil {
			return err
		}
		return nil
	}
	for _, testID := range p.TestIDs {
		if seen[testID] {
			return nil, ErrDuplicateTest
		}
		seen[testID] = true
		if err := insertItem(testID); err != nil {
			return nil, err
		}
	}
	for _, ct := range p.CustomTests {
		if strings.TrimSpace(ct.Name) == "" {
			continue
		}
		testID, err := s.resolveCustomTestTx(ctx, tx, ct.Name, ct.SpecimenType)
		if err != nil {
			return nil, err
		}
		if seen[testID] {
			continue
		}
		seen[testID] = true
		if err := insertItem(testID); err != nil {
			return nil, err
		}
	}

	if p.PatientID != nil {
		if err := appendTimelineTx(ctx, tx, *p.PatientID, domain.EventLabRequested,
			"lab request "+requestNo, map[string]any{"requestNo": requestNo}, &p.OrderedBy); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetLabRequest(ctx, requestID)
}

// GetLabRequest returns a request with its items and specimens.
func (s *Store) GetLabRequest(ctx context.Context, id string) (*domain.LabRequest, error) {
	req, err := scanLabRequest(s.pool.QueryRow(ctx, `SELECT `+labRequestCols+labRequestFrom+` WHERE r.id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	items, err := s.listRequestItems(ctx, id)
	if err != nil {
		return nil, err
	}
	req.Items = items
	specimens, err := s.listRequestSpecimens(ctx, id)
	if err != nil {
		return nil, err
	}
	req.Specimens = specimens
	return req, nil
}

// ListLabRequestsParams filters the lab request list.
type ListLabRequestsParams struct {
	Status  string
	Patient string
	Client  string
	Limit   int
	Offset  int
}

// ListLabRequests returns requests matching the filters, newest first.
func (s *Store) ListLabRequests(ctx context.Context, p ListLabRequestsParams) ([]domain.LabRequest, error) {
	q := `SELECT ` + labRequestCols + labRequestFrom + ` WHERE true`
	args := []any{}
	if p.Status != "" {
		args = append(args, p.Status)
		q += ` AND r.status = $` + itoa(len(args))
	}
	if p.Patient != "" {
		args = append(args, p.Patient)
		q += ` AND r.patient_id = $` + itoa(len(args)) + `::uuid`
	}
	if p.Client != "" {
		args = append(args, p.Client)
		q += ` AND r.client_id = $` + itoa(len(args)) + `::uuid`
	}
	q += ` ORDER BY r.requested_at DESC LIMIT $` + itoa(len(args)+1) + ` OFFSET $` + itoa(len(args)+2)
	args = append(args, p.Limit, p.Offset)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.LabRequest, 0)
	for rows.Next() {
		req, err := scanLabRequest(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *req)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return out, nil
	}

	// Batch-load items and specimens for every listed request so the queue
	// table can render tests, specimen barcodes, and origin locations without
	// N+1 round trips.
	ids := make([]string, 0, len(out))
	for i := range out {
		ids = append(ids, out[i].ID)
	}
	items, err := s.listRequestItemsMany(ctx, ids)
	if err != nil {
		return nil, err
	}
	specimens, err := s.listRequestSpecimensMany(ctx, ids)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]int, len(out))
	for i := range out {
		byID[out[i].ID] = i
	}
	for _, it := range items {
		if idx, ok := byID[it.RequestID]; ok {
			out[idx].Items = append(out[idx].Items, it)
		}
	}
	for _, sp := range specimens {
		if idx, ok := byID[sp.RequestID]; ok {
			out[idx].Specimens = append(out[idx].Specimens, sp)
		}
	}
	return out, nil
}

// listRequestItemsMany loads items for several requests in one query.
func (s *Store) listRequestItemsMany(ctx context.Context, requestIDs []string) ([]domain.LabRequestItem, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+labItemCols+labItemFrom+`
		WHERE i.request_id = ANY($1::uuid[])
		ORDER BY t.code ASC`, requestIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.LabRequestItem, 0)
	for rows.Next() {
		it, err := scanLabItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *it)
	}
	return out, rows.Err()
}

// listRequestSpecimensMany loads specimens for several requests in one query.
func (s *Store) listRequestSpecimensMany(ctx context.Context, requestIDs []string) ([]domain.LabSpecimen, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+labSpecimenCols+` FROM lab_specimens
		WHERE request_id = ANY($1::uuid[])
		ORDER BY collected_at ASC`, requestIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.LabSpecimen, 0)
	for rows.Next() {
		sp, err := scanLabSpecimen(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *sp)
	}
	return out, rows.Err()
}

const labItemCols = `i.id::text, i.request_id::text, i.test_id::text, t.code, t.name,
	t.verification_required, t.specimen_type, i.price, i.specimen_id::text,
	i.result_value, i.result_text, i.critical,
	i.result_entered_by::text, i.result_entered_at,
	i.result_verified_by::text, i.result_verified_at,
	COALESCE(eb.first_name || ' ' || eb.last_name, ''),
	COALESCE(vb.first_name || ' ' || vb.last_name, '')`

const labItemFrom = ` FROM lab_request_items i
	JOIN lab_tests t ON t.id = i.test_id
	LEFT JOIN users eu ON eu.id = i.result_entered_by
	LEFT JOIN staff eb ON eb.user_id = eu.id
	LEFT JOIN users vu ON vu.id = i.result_verified_by
	LEFT JOIN staff vb ON vb.user_id = vu.id`

func scanLabItem(r pgx.Row) (*domain.LabRequestItem, error) {
	var it domain.LabRequestItem
	err := r.Scan(&it.ID, &it.RequestID, &it.TestID, &it.TestCode, &it.TestName,
		&it.VerificationRequired, &it.SpecimenType, &it.Price, &it.SpecimenID,
		&it.ResultValue, &it.ResultText, &it.Critical,
		&it.ResultEnteredBy, &it.ResultEnteredAt, &it.ResultVerifiedBy, &it.ResultVerifiedAt,
		&it.ResultEnteredByName, &it.ResultVerifiedByName)
	if err != nil {
		return nil, err
	}
	return &it, nil
}

func (s *Store) listRequestItems(ctx context.Context, requestID string) ([]domain.LabRequestItem, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+labItemCols+labItemFrom+`
		WHERE i.request_id = $1::uuid ORDER BY t.code ASC`, requestID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.LabRequestItem, 0)
	for rows.Next() {
		it, err := scanLabItem(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *it)
	}
	return out, rows.Err()
}

// ---- transitions / cancel ----

// TransitionLabRequest applies a single allowed workflow step. Guarded
// transitions (received / result_entered / verified) also enforce their
// completeness preconditions.
func (s *Store) TransitionLabRequest(ctx context.Context, requestID, toStatus, actor string) (string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var fromStatus string
	if err := tx.QueryRow(ctx, `SELECT status FROM lab_requests WHERE id = $1::uuid FOR UPDATE`, requestID).Scan(&fromStatus); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", err
	}
	if !canTransitionLab(fromStatus, toStatus) {
		return fromStatus, ErrInvalidLabTransition
	}

	switch toStatus {
	case domain.LabStatusReceived:
		all, err := allSpecimensReceivedTx(ctx, tx, requestID)
		if err != nil {
			return fromStatus, err
		}
		if !all {
			return fromStatus, errors.New("all specimens must be received first")
		}
	case domain.LabStatusResultEntered:
		all, err := allItemsEnteredTx(ctx, tx, requestID)
		if err != nil {
			return fromStatus, err
		}
		if !all {
			return fromStatus, errors.New("all results must be entered first")
		}
	case domain.LabStatusVerified:
		all, err := allItemsVerifiedTx(ctx, tx, requestID)
		if err != nil {
			return fromStatus, err
		}
		if !all {
			return fromStatus, errors.New("all results must be verified first")
		}
	}

	if _, err := tx.Exec(ctx, `UPDATE lab_requests SET status = $2, updated_at = now() WHERE id = $1::uuid`, requestID, toStatus); err != nil {
		return fromStatus, err
	}
	return fromStatus, tx.Commit(ctx)
}

// SetLabPaymentStatus updates the payment status of a lab request (finance
// module integration point).
func (s *Store) SetLabPaymentStatus(ctx context.Context, requestID, paymentStatus string) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE lab_requests SET payment_status = $2, updated_at = now() WHERE id = $1::uuid`,
		requestID, paymentStatus)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// CancelLabRequest cancels a request from any non-terminal state.
func (s *Store) CancelLabRequest(ctx context.Context, requestID, reason, actor string) error {
	if reason == "" {
		return errors.New("cancel reason is required")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var status string
	if err := tx.QueryRow(ctx, `SELECT status FROM lab_requests WHERE id = $1::uuid FOR UPDATE`, requestID).Scan(&status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if status == domain.LabStatusCancelled || status == domain.LabStatusReleased {
		return ErrInvalidLabTransition
	}
	if _, err := tx.Exec(ctx, `
		UPDATE lab_requests SET status = 'cancelled', cancel_reason = $2, updated_at = now()
		WHERE id = $1::uuid`, requestID, reason); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func allSpecimensReceivedTx(ctx context.Context, tx pgx.Tx, requestID string) (bool, error) {
	var total, received int
	if err := tx.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE status <> 'rejected'),
		       COUNT(*) FILTER (WHERE status = 'received')
		FROM lab_specimens WHERE request_id = $1::uuid`, requestID).Scan(&total, &received); err != nil {
		return false, err
	}
	return total > 0 && total == received, nil
}

func allItemsEnteredTx(ctx context.Context, tx pgx.Tx, requestID string) (bool, error) {
	var total, entered int
	if err := tx.QueryRow(ctx, `
		SELECT COUNT(*), COUNT(*) FILTER (WHERE result_entered_at IS NOT NULL)
		FROM lab_request_items WHERE request_id = $1::uuid`, requestID).Scan(&total, &entered); err != nil {
		return false, err
	}
	return total > 0 && total == entered, nil
}

func allItemsVerifiedTx(ctx context.Context, tx pgx.Tx, requestID string) (bool, error) {
	var total, verified int
	if err := tx.QueryRow(ctx, `
		SELECT COUNT(*), COUNT(*) FILTER (WHERE result_verified_at IS NOT NULL)
		FROM lab_request_items WHERE request_id = $1::uuid`, requestID).Scan(&total, &verified); err != nil {
		return false, err
	}
	return total > 0 && total == verified, nil
}

// ---- specimens ----

const labSpecimenCols = `id::text, specimen_no, barcode, request_id::text, item_id::text, specimen_type,
	origin_location, collected_by::text, collected_at, received_by::text, received_at, condition,
	storage_location, status, rejection_reason, created_at, updated_at`

func scanLabSpecimen(r pgx.Row) (*domain.LabSpecimen, error) {
	var sp domain.LabSpecimen
	err := r.Scan(&sp.ID, &sp.SpecimenNo, &sp.Barcode, &sp.RequestID, &sp.ItemID, &sp.SpecimenType,
		&sp.OriginLocation, &sp.CollectedBy, &sp.CollectedAt, &sp.ReceivedBy, &sp.ReceivedAt, &sp.Condition,
		&sp.StorageLocation, &sp.Status, &sp.RejectionReason, &sp.CreatedAt, &sp.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &sp, nil
}

func (s *Store) listRequestSpecimens(ctx context.Context, requestID string) ([]domain.LabSpecimen, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+labSpecimenCols+` FROM lab_specimens WHERE request_id = $1::uuid ORDER BY collected_at ASC`, requestID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.LabSpecimen, 0)
	for rows.Next() {
		sp, err := scanLabSpecimen(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *sp)
	}
	return out, rows.Err()
}

// GetLabSpecimen returns a specimen by internal UUID.
func (s *Store) GetLabSpecimen(ctx context.Context, id string) (*domain.LabSpecimen, error) {
	sp, err := scanLabSpecimen(s.pool.QueryRow(ctx, `SELECT `+labSpecimenCols+` FROM lab_specimens WHERE id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return sp, err
}

// SpecimenCollectParams describes one specimen to collect.
type SpecimenCollectParams struct {
	ItemID         string
	SpecimenType   string
	OriginLocation string
	CollectedAt    time.Time
}

// CollectSpecimens collects specimens for the given items, recording the
// collector and collection time, and advances the request to
// specimen_collected when it was still at requested/payment.
func (s *Store) CollectSpecimens(ctx context.Context, requestID string, items []SpecimenCollectParams, collectedBy string) ([]domain.LabSpecimen, error) {
	if len(items) == 0 {
		return nil, errors.New("at least one specimen is required")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var status string
	if err := tx.QueryRow(ctx, `SELECT status FROM lab_requests WHERE id = $1::uuid FOR UPDATE`, requestID).Scan(&status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	switch status {
	case domain.LabStatusRequested, domain.LabStatusPayment, domain.LabStatusSpecimenCollected, domain.LabStatusReceived:
	default:
		return nil, ErrInvalidLabTransition
	}

	collected := make([]domain.LabSpecimen, 0)
	for _, it := range items {
		var itemID string
		if err := tx.QueryRow(ctx, `SELECT id::text FROM lab_request_items WHERE id = $1::uuid AND request_id = $2::uuid`, it.ItemID, requestID).Scan(&itemID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrNotFound
			}
			return nil, err
		}
		// A non-rejected specimen cannot be recollected.
		var exists bool
		if err := tx.QueryRow(ctx, `
			SELECT true FROM lab_specimens WHERE item_id = $1::uuid AND status <> 'rejected'`, it.ItemID).Scan(&exists); err == nil && exists {
			return nil, fmt.Errorf("specimen already collected for item")
		} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}

		specimenType := it.SpecimenType
		if specimenType == "" {
			specimenType = "blood"
		}
		var seq int64
		if err := tx.QueryRow(ctx, `SELECT nextval('lab_specimens_no_seq')`).Scan(&seq); err != nil {
			return nil, err
		}
		specimenNo := "SPC" + lpadInt(seq, 6)
		barcode := "BC" + lpadInt(seq, 7) + checksumChar(seq)
		var sp domain.LabSpecimen
		if err := tx.QueryRow(ctx, `
			INSERT INTO lab_specimens (specimen_no, barcode, request_id, item_id, specimen_type, origin_location, collected_by, collected_at)
			VALUES ($1, $2, $3::uuid, $4::uuid, $5, $6, $7::uuid, $8)
			RETURNING `+labSpecimenCols,
			specimenNo, barcode, requestID, itemID, specimenType, it.OriginLocation, collectedBy, it.CollectedAt).Scan(&sp.ID, &sp.SpecimenNo, &sp.Barcode, &sp.RequestID, &sp.ItemID, &sp.SpecimenType,
			&sp.OriginLocation, &sp.CollectedBy, &sp.CollectedAt, &sp.ReceivedBy, &sp.ReceivedAt, &sp.Condition,
			&sp.StorageLocation, &sp.Status, &sp.RejectionReason, &sp.CreatedAt, &sp.UpdatedAt); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO lab_specimen_events (specimen_id, event_type, actor, notes)
			VALUES ($1::uuid, 'collected', $2::uuid, 'specimen collected' || CASE WHEN $3 <> '' THEN ' from ' || $3 ELSE '' END)`, sp.ID, collectedBy, it.OriginLocation); err != nil {
			return nil, err
		}
		// Link the item to its specimen.
		if _, err := tx.Exec(ctx, `UPDATE lab_request_items SET specimen_id = $2::uuid WHERE id = $1::uuid`, itemID, sp.ID); err != nil {
			return nil, err
		}
		collected = append(collected, sp)
	}

	if status == domain.LabStatusRequested || status == domain.LabStatusPayment {
		if _, err := tx.Exec(ctx, `UPDATE lab_requests SET status = 'specimen_collected', updated_at = now() WHERE id = $1::uuid`, requestID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return collected, nil
}

// ReceiveSpecimen records receipt of a specimen (condition, storage) and
// advances the request to received when all specimens are in.
func (s *Store) ReceiveSpecimen(ctx context.Context, specimenID, condition, storageLocation, receivedBy string) (*domain.LabSpecimen, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var status, requestID string
	if err := tx.QueryRow(ctx, `SELECT status, request_id::text FROM lab_specimens WHERE id = $1::uuid FOR UPDATE`, specimenID).Scan(&status, &requestID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if status != domain.SpecimenStatusCollected {
		return nil, ErrInvalidLabTransition
	}
	if _, err := tx.Exec(ctx, `
		UPDATE lab_specimens SET status = 'received', received_by = $2::uuid, received_at = now(),
		                         condition = $3, storage_location = $4, updated_at = now()
		WHERE id = $1::uuid`, specimenID, receivedBy, condition, storageLocation); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO lab_specimen_events (specimen_id, event_type, actor, notes)
		VALUES ($1::uuid, 'received', $2::uuid, 'specimen received')`, specimenID, receivedBy); err != nil {
		return nil, err
	}

	// Advance the request once every specimen is received.
	all, err := allSpecimensReceivedTx(ctx, tx, requestID)
	if err != nil {
		return nil, err
	}
	if all {
		if _, err := tx.Exec(ctx, `
			UPDATE lab_requests SET status = 'received', updated_at = now()
			WHERE id = $1::uuid AND status = 'specimen_collected'`, requestID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetLabSpecimen(ctx, specimenID)
}

// RejectSpecimen rejects a specimen (condition issue). A received request is
// moved back to specimen_collected for recollection.
func (s *Store) RejectSpecimen(ctx context.Context, specimenID, reason, rejectedBy string) error {
	if reason == "" {
		return errors.New("rejection reason is required")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var status, requestID string
	if err := tx.QueryRow(ctx, `SELECT status, request_id::text FROM lab_specimens WHERE id = $1::uuid FOR UPDATE`, specimenID).Scan(&status, &requestID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if status != domain.SpecimenStatusCollected && status != domain.SpecimenStatusReceived {
		return ErrInvalidLabTransition
	}
	if _, err := tx.Exec(ctx, `
		UPDATE lab_specimens SET status = 'rejected', rejection_reason = $2, updated_at = now()
		WHERE id = $1::uuid`, specimenID, reason); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO lab_specimen_events (specimen_id, event_type, actor, notes)
		VALUES ($1::uuid, 'rejected', $2::uuid, $3)`, specimenID, rejectedBy, reason); err != nil {
		return err
	}
	// A fully-received request must go back to collection.
	if _, err := tx.Exec(ctx, `
		UPDATE lab_requests SET status = 'specimen_collected', updated_at = now()
		WHERE id = $1::uuid AND status = 'received'`, requestID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ---- results ----

// ResultEntryParams carries one item's structured result.
type ResultEntryParams struct {
	ItemID      string
	ResultValue []byte // JSONB
	ResultText  string
	Critical    bool
}

// EnterResults stores results for request items and creates critical-result
// notifications where configured. The request advances to result_entered once
// every item has a result.
func (s *Store) EnterResults(ctx context.Context, requestID string, entries []ResultEntryParams, enteredBy string) ([]domain.LabCriticalNotification, error) {
	if len(entries) == 0 {
		return nil, errors.New("at least one result is required")
	}
	ackRequired, err := s.getBoolSetting(ctx, "lab.critical_acknowledgement_required", true)
	if err != nil {
		return nil, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var status string
	if err := tx.QueryRow(ctx, `SELECT status FROM lab_requests WHERE id = $1::uuid FOR UPDATE`, requestID).Scan(&status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if status != domain.LabStatusProcessing && status != domain.LabStatusResultEntered {
		return nil, ErrInvalidLabTransition
	}

	notifications := make([]domain.LabCriticalNotification, 0)
	for _, e := range entries {
		var itemID string
		var verifiedAt *time.Time
		if err := tx.QueryRow(ctx, `
			SELECT id::text, result_verified_at FROM lab_request_items
			WHERE id = $1::uuid AND request_id = $2::uuid`, e.ItemID, requestID).
			Scan(&itemID, &verifiedAt); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrNotFound
			}
			return nil, err
		}
		if verifiedAt != nil {
			return nil, errors.New("result is already verified and cannot be re-entered")
		}

		if _, err := tx.Exec(ctx, `
			UPDATE lab_request_items SET result_value = $2::jsonb, result_text = $3, critical = $4,
			                             result_entered_by = $5::uuid, result_entered_at = now()
			WHERE id = $1::uuid`,
			itemID, jsonBytesOrEmpty(e.ResultValue), e.ResultText, e.Critical, enteredBy); err != nil {
			return nil, err
		}

		if e.Critical && ackRequired {
			notif, err := s.insertCriticalNotificationTx(ctx, tx, requestID, itemID)
			if err != nil {
				return nil, err
			}
			notifications = append(notifications, *notif)
		}
	}

	all, err := allItemsEnteredTx(ctx, tx, requestID)
	if err != nil {
		return nil, err
	}
	if all {
		if _, err := tx.Exec(ctx, `UPDATE lab_requests SET status = 'result_entered', updated_at = now() WHERE id = $1::uuid`, requestID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return notifications, nil
}

func (s *Store) insertCriticalNotificationTx(ctx context.Context, tx pgx.Tx, requestID, itemID string) (*domain.LabCriticalNotification, error) {
	var patientID, clientID, orderedBy *string
	var clientPhysician string
	if err := tx.QueryRow(ctx, `
		SELECT r.patient_id::text, r.client_id::text, r.ordered_by::text,
		       COALESCE(NULLIF(c.referring_physician, ''), st.first_name || ' ' || st.last_name, u.username)
		FROM lab_requests r
		LEFT JOIN lab_clients c ON c.id = r.client_id
		LEFT JOIN users u ON u.id = r.ordered_by
		LEFT JOIN staff st ON st.user_id = u.id
		WHERE r.id = $1::uuid`, requestID).
		Scan(&patientID, &clientID, &orderedBy, &clientPhysician); err != nil {
		return nil, err
	}

	var n domain.LabCriticalNotification
	err := tx.QueryRow(ctx, `
		INSERT INTO lab_critical_notifications (item_id, request_id, patient_id, client_id,
		                                        notified_to_user_id, notified_to_name, status)
		VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, 'pending')
		RETURNING id::text, item_id::text, request_id::text, patient_id::text, client_id::text,
		          notified_to_user_id::text, notified_to_name, notified_at,
		          acknowledged_by::text, acknowledged_at, acknowledgement_notes, status, created_at`,
		itemID, requestID, nullableUUID(patientID), nullableUUID(clientID), nullableUUID(orderedBy), clientPhysician).
		Scan(&n.ID, &n.ItemID, &n.RequestID, &n.PatientID, &n.ClientID, &n.NotifiedToUserID,
			&n.NotifiedToName, &n.NotifiedAt, &n.AcknowledgedBy, &n.AcknowledgedAt,
			&n.AcknowledgementNotes, &n.Status, &n.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &n, nil
}

// VerifyItem verifies one entered result. High-risk tests (verification_required)
// must be verified by a different user than the one who entered the result.
func (s *Store) VerifyItem(ctx context.Context, itemID, verifiedBy string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var requestID, status, enteredBy, verificationRequired string
	var enteredAt *time.Time
	if err := tx.QueryRow(ctx, `
		SELECT i.request_id::text, r.status, i.result_entered_by::text, i.result_entered_at,
		       t.verification_required::text
		FROM lab_request_items i
		JOIN lab_requests r ON r.id = i.request_id
		JOIN lab_tests t ON t.id = i.test_id
		WHERE i.id = $1::uuid FOR UPDATE OF i`, itemID).
		Scan(&requestID, &status, &enteredBy, &enteredAt, &verificationRequired); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if status != domain.LabStatusResultEntered && status != domain.LabStatusVerified {
		return ErrInvalidLabTransition
	}
	if enteredAt == nil {
		return errors.New("result has not been entered")
	}
	if verificationRequired == "true" && enteredBy == verifiedBy {
		return ErrSelfVerification
	}

	if _, err := tx.Exec(ctx, `
		UPDATE lab_request_items SET result_verified_by = $2::uuid, result_verified_at = now()
		WHERE id = $1::uuid`, itemID, verifiedBy); err != nil {
		return err
	}
	all, err := allItemsVerifiedTx(ctx, tx, requestID)
	if err != nil {
		return err
	}
	if all {
		if _, err := tx.Exec(ctx, `UPDATE lab_requests SET status = 'verified', updated_at = now() WHERE id = $1::uuid`, requestID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// ReleaseRequest releases a verified request and records the release time.
func (s *Store) ReleaseRequest(ctx context.Context, requestID, releasedBy string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var status, patientID, orderID string
	var clientID *string
	if err := tx.QueryRow(ctx, `
		SELECT status, COALESCE(patient_id::text, ''), client_id::text, COALESCE(order_id::text, '')
		FROM lab_requests WHERE id = $1::uuid FOR UPDATE`, requestID).
		Scan(&status, &patientID, &clientID, &orderID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if status != domain.LabStatusVerified {
		return ErrInvalidLabTransition
	}
	if _, err := tx.Exec(ctx, `
		UPDATE lab_requests SET status = 'released', released_at = now(), updated_at = now()
		WHERE id = $1::uuid`, requestID); err != nil {
		return err
	}
	if patientID != "" {
		if err := appendTimelineTx(ctx, tx, patientID, domain.EventLabReleased,
			"lab results released", map[string]any{"requestNo": requestID}, &releasedBy); err != nil {
			return err
		}
	}
	// Real-time queue sync: releasing results completes the linked doctor
	// order (Ordered → Verified/Released).
	if orderID != "" {
		if _, err := tx.Exec(ctx, `
			UPDATE orders SET status = 'completed', completed_at = now(), acted_by = $2::uuid, updated_at = now()
			WHERE id = $1::uuid AND status NOT IN ('completed','cancelled')`, orderID, releasedBy); err != nil {
			return err
		}
		if err := appendTimelineTx(ctx, tx, patientID, domain.EventOrderStatusChanged,
			"Order completed by lab release", map[string]any{"requestNo": requestID}, &releasedBy); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// ---- critical notifications ----

const labCriticalCols = `id::text, item_id::text, request_id::text, patient_id::text, client_id::text,
	notified_to_user_id::text, notified_to_name, notified_at,
	acknowledged_by::text, acknowledged_at, acknowledgement_notes, status, created_at`

func scanLabCritical(r pgx.Row) (*domain.LabCriticalNotification, error) {
	var n domain.LabCriticalNotification
	err := r.Scan(&n.ID, &n.ItemID, &n.RequestID, &n.PatientID, &n.ClientID, &n.NotifiedToUserID,
		&n.NotifiedToName, &n.NotifiedAt, &n.AcknowledgedBy, &n.AcknowledgedAt,
		&n.AcknowledgementNotes, &n.Status, &n.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &n, nil
}

// ListCriticalNotifications returns critical notifications, optionally by status.
func (s *Store) ListCriticalNotifications(ctx context.Context, status string, limit, offset int) ([]domain.LabCriticalNotification, error) {
	q := `SELECT ` + labCriticalCols + ` FROM lab_critical_notifications WHERE true`
	args := []any{}
	if status != "" {
		args = append(args, status)
		q += ` AND status = $` + itoa(len(args))
	}
	q += ` ORDER BY notified_at DESC LIMIT $` + itoa(len(args)+1) + ` OFFSET $` + itoa(len(args)+2)
	args = append(args, limit, offset)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.LabCriticalNotification, 0)
	for rows.Next() {
		n, err := scanLabCritical(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *n)
	}
	return out, rows.Err()
}

// RouteCriticalAlerts pushes pending critical-result notifications into the
// attending physician's communications queue (a direct message) and creates an
// in-app notification, so the alert surfaces in the clinician's orders and
// communications views without leaving the lab workflow.
func (s *Store) RouteCriticalAlerts(ctx context.Context, actorID string, n []domain.LabCriticalNotification) error {
	for i := range n {
		if n[i].NotifiedToUserID == nil {
			continue
		}
		// Build a human-readable summary of the critical result.
		var patientNo, patientName, testName, resultText string
		if err := s.pool.QueryRow(ctx, `
			SELECT COALESCE(p.patient_no, ''), COALESCE(p.first_name || ' ' || p.last_name, ''),
			       COALESCE(t.name, ''), COALESCE(i.result_text, '')
			FROM lab_critical_notifications n
			JOIN lab_request_items i ON i.id = n.item_id
			JOIN lab_tests t ON t.id = i.test_id
			LEFT JOIN patients p ON p.id = n.patient_id
			WHERE n.id = $1::uuid`, n[i].ID).
			Scan(&patientNo, &patientName, &testName, &resultText); err != nil {
			return err
		}
		title := "CRITICAL LAB RESULT — " + testName
		body := "Patient " + patientName + " (" + patientNo + "): critical result for " + testName
		if resultText != "" {
			body += " — " + resultText
		}
		body += ". Please review and acknowledge in Lab & Pathology."
		if _, err := s.sendMessage(ctx, SendMessageParams{
			Kind:        "direct",
			SenderID:    actorID,
			RecipientID: n[i].NotifiedToUserID,
			Body:        body,
		}); err != nil {
			return err
		}
		if _, err := s.CreateNotification(ctx, CreateNotificationParams{
			UserID:   *n[i].NotifiedToUserID,
			Category: "lab_critical",
			Title:    title,
			Body:     body,
			Link:     "/lab",
			Channel:  "in_app",
		}); err != nil {
			return err
		}
	}
	return nil
}

// checksumChar derives a single Luhn-style check character for a numeric
// sequence, giving the accession barcode a self-validation digit (Code128
// printable range).
func checksumChar(seq int64) string {
	const digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
	n := seq
	sum := 0
	doubled := false
	for n > 0 {
		d := int(n % 10)
		n /= 10
		if doubled {
			d *= 2
			if d > 9 {
				d = d - 9
			}
		}
		sum += d
		doubled = !doubled
	}
	return string(digits[sum%len(digits)])
}

// AcknowledgeCritical acknowledges a pending critical-result notification.
func (s *Store) AcknowledgeCritical(ctx context.Context, notificationID, acknowledgedBy, notes string) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE lab_critical_notifications SET status = 'acknowledged',
		                                       acknowledged_by = $2::uuid, acknowledged_at = now(),
		                                       acknowledgement_notes = $3
		WHERE id = $1::uuid AND status = 'pending'`, notificationID, acknowledgedBy, notes)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
