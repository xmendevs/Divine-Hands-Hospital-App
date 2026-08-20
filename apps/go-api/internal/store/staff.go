package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

// ErrLeaveNotPending is returned when deciding a leave request that is not pending.
var ErrLeaveNotPending = errors.New("leave request is not pending")

// staffCols is the canonical staff projection with department and user context.
const staffCols = `st.id::text, st.user_id::text, st.department_id::text, st.employee_no,
	st.first_name, st.last_name, st.job_title, st.contact_phone, st.contact_email,
	st.employment_status::text, st.availability, COALESCE(st.shift_tag, 'flexible'), st.can_work_weekends, st.min_days_off, st.max_days_off, st.skills, st.certifications, st.hire_date::text,
	COALESCE(d.name, ''), COALESCE(u.username, '')`

const staffFrom = ` FROM staff st
	LEFT JOIN departments d ON d.id = st.department_id
	LEFT JOIN users u ON u.id = st.user_id`

func scanStaff(r pgx.Row) (*domain.Staff, error) {
	var st domain.Staff
	err := r.Scan(&st.ID, &st.UserID, &st.DepartmentID, &st.EmployeeNo,
		&st.FirstName, &st.LastName, &st.JobTitle, &st.ContactPhone, &st.ContactEmail,
		&st.EmploymentStatus, &st.Availability, &st.ShiftTag, &st.CanWorkWeekends, &st.MinDaysOff, &st.MaxDaysOff, &st.Skills, &st.Certifications, &st.HireDate,
		&st.DepartmentName, &st.Username)
	if err != nil {
		return nil, err
	}
	return &st, nil
}

// ListStaff returns staff profiles, active first.
func (s *Store) ListStaff(ctx context.Context) ([]domain.Staff, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+staffCols+staffFrom+
		` ORDER BY st.employment_status = 'active' DESC, st.employee_no ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.Staff, 0)
	for rows.Next() {
		st, err := scanStaff(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *st)
	}
	return out, rows.Err()
}

// GetStaffByID returns a staff profile by internal staff UUID.
func (s *Store) GetStaffByID(ctx context.Context, id string) (*domain.Staff, error) {
	st, err := scanStaff(s.pool.QueryRow(ctx, `SELECT `+staffCols+staffFrom+` WHERE st.id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return st, err
}

// UpdateStaffProfileParams carries editable workforce fields.
type UpdateStaffProfileParams struct {
	DepartmentID     *string
	JobTitle         string
	ContactPhone     string
	ContactEmail     string
	EmploymentStatus string
	Availability     string
	ShiftTag         string
	CanWorkWeekends  *bool
	MinDaysOff       *int
	MaxDaysOff       *int
	Skills           []string
	Certifications   []string
	HireDate         *string
}

// UpdateStaffProfile updates a staff member's workforce fields.
func (s *Store) UpdateStaffProfile(ctx context.Context, id string, p UpdateStaffProfileParams) error {
	if p.Skills == nil {
		p.Skills = []string{}
	}
	if p.Certifications == nil {
		p.Certifications = []string{}
	}
	// Set defaults for optional fields
	canWeekends := true
	if p.CanWorkWeekends != nil {
		canWeekends = *p.CanWorkWeekends
	}
	minOff := 4
	if p.MinDaysOff != nil {
		minOff = *p.MinDaysOff
	}
	maxOff := 10
	if p.MaxDaysOff != nil {
		maxOff = *p.MaxDaysOff
	}
	ct, err := s.pool.Exec(ctx, `
		UPDATE staff SET department_id = $2::uuid, job_title = $3, contact_phone = $4,
		                 contact_email = $5, employment_status = $6, availability = $7,
		                 shift_tag = $8, can_work_weekends = $9, min_days_off = $10, max_days_off = $11,
		                 skills = $12, certifications = $13, hire_date = $14::date, updated_at = now()
		WHERE id = $1::uuid`,
		id, nullableUUID(p.DepartmentID), p.JobTitle, p.ContactPhone, p.ContactEmail,
		p.EmploymentStatus, p.Availability, p.ShiftTag, canWeekends, minOff, maxOff,
		p.Skills, p.Certifications, nullableTextPtr(p.HireDate))
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ---- staff leave ----

const staffLeaveCols = `sl.id::text, sl.staff_id::text, sl.leave_type, sl.start_date::text, sl.end_date::text,
	sl.reason, sl.status::text, sl.requested_by::text, sl.approved_by::text, sl.decided_at,
	sl.created_at, sl.updated_at, COALESCE(st.first_name || ' ' || st.last_name, ''), COALESCE(st.employee_no, '')`

const staffLeaveFrom = ` FROM staff_leave sl JOIN staff st ON st.id = sl.staff_id`

func scanStaffLeave(r pgx.Row) (*domain.StaffLeave, error) {
	var lv domain.StaffLeave
	err := r.Scan(&lv.ID, &lv.StaffID, &lv.LeaveType, &lv.StartDate, &lv.EndDate,
		&lv.Reason, &lv.Status, &lv.RequestedBy, &lv.ApprovedBy, &lv.DecidedAt,
		&lv.CreatedAt, &lv.UpdatedAt, &lv.StaffName, &lv.EmployeeNo)
	if err != nil {
		return nil, err
	}
	return &lv, nil
}

// CreateLeaveParams carries a leave request.
type CreateLeaveParams struct {
	StaffID     string
	LeaveType   string
	StartDate   string
	EndDate     string
	Reason      string
	RequestedBy string
}

// CreateLeave files a leave request for a staff member.
func (s *Store) CreateLeave(ctx context.Context, p CreateLeaveParams) (*domain.StaffLeave, error) {
	var id string
	if err := s.pool.QueryRow(ctx, `
		INSERT INTO staff_leave (staff_id, leave_type, start_date, end_date, reason, requested_by)
		VALUES ($1::uuid, $2, $3::date, $4::date, $5, $6::uuid)
		RETURNING id::text`,
		p.StaffID, p.LeaveType, p.StartDate, p.EndDate, p.Reason, p.RequestedBy).Scan(&id); err != nil {
		return nil, err
	}
	return s.GetLeave(ctx, id)
}

// GetLeave returns a single leave request with staff context.
func (s *Store) GetLeave(ctx context.Context, id string) (*domain.StaffLeave, error) {
	lv, err := scanStaffLeave(s.pool.QueryRow(ctx, `SELECT `+staffLeaveCols+staffLeaveFrom+` WHERE sl.id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return lv, err
}

// ListLeaveParams filters leave requests.
type ListLeaveParams struct {
	StaffID string
	Status  string
	Limit   int
	Offset  int
}

// ListLeave returns leave requests, newest first.
func (s *Store) ListLeave(ctx context.Context, p ListLeaveParams) ([]domain.StaffLeave, error) {
	q := `SELECT ` + staffLeaveCols + staffLeaveFrom + ` WHERE true`
	args := []any{}
	if p.StaffID != "" {
		args = append(args, p.StaffID)
		q += ` AND sl.staff_id = $` + itoa(len(args)) + `::uuid`
	}
	if p.Status != "" {
		args = append(args, p.Status)
		q += ` AND sl.status = $` + itoa(len(args))
	}
	q += ` ORDER BY sl.created_at DESC LIMIT $` + itoa(len(args)+1) + ` OFFSET $` + itoa(len(args)+2)
	args = append(args, p.Limit, p.Offset)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.StaffLeave, 0)
	for rows.Next() {
		lv, err := scanStaffLeave(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *lv)
	}
	return out, rows.Err()
}

// ---- staff unavailability & shift preferences ----

const unavailabilityCols = `su.id::text, su.staff_id::text, su.work_date::text, su.reason,
	su.created_by::text, su.created_at, COALESCE(st.first_name || ' ' || st.last_name, ''), COALESCE(st.employee_no, '')`

const unavailabilityFrom = ` FROM staff_unavailability su JOIN staff st ON st.id = su.staff_id`

func scanUnavailability(r pgx.Row) (*domain.StaffUnavailability, error) {
	var u domain.StaffUnavailability
	err := r.Scan(&u.ID, &u.StaffID, &u.WorkDate, &u.Reason,
		&u.CreatedBy, &u.CreatedAt, &u.StaffName, &u.EmployeeNo)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// MarkUnavailable records a staff member unavailable for a whole day.
func (s *Store) MarkUnavailable(ctx context.Context, staffID, workDate, reason, createdBy string) (*domain.StaffUnavailability, error) {
	var id string
	if err := s.pool.QueryRow(ctx, `
		INSERT INTO staff_unavailability (staff_id, work_date, reason, created_by)
		VALUES ($1::uuid, $2::date, $3, $4::uuid)
		ON CONFLICT (staff_id, work_date) DO UPDATE SET reason = EXCLUDED.reason
		RETURNING id::text`, staffID, workDate, reason, nullableUUID(&createdBy)).Scan(&id); err != nil {
		return nil, err
	}
	u, err := scanUnavailability(s.pool.QueryRow(ctx, `SELECT `+unavailabilityCols+unavailabilityFrom+` WHERE su.id = $1::uuid`, id))
	if err != nil {
		return nil, err
	}
	return u, nil
}

// ListUnavailabilityParams filters unavailability records.
type ListUnavailabilityParams struct {
	StaffID string
	Date    string
	Limit   int
	Offset  int
}

// ListUnavailability returns unavailability records, newest first.
func (s *Store) ListUnavailability(ctx context.Context, p ListUnavailabilityParams) ([]domain.StaffUnavailability, error) {
	q := `SELECT ` + unavailabilityCols + unavailabilityFrom + ` WHERE true`
	args := []any{}
	if p.StaffID != "" {
		args = append(args, p.StaffID)
		q += ` AND su.staff_id = $` + itoa(len(args)) + `::uuid`
	}
	if p.Date != "" {
		args = append(args, p.Date)
		q += ` AND su.work_date = $` + itoa(len(args)) + `::date`
	}
	q += ` ORDER BY su.work_date DESC LIMIT $` + itoa(len(args)+1) + ` OFFSET $` + itoa(len(args)+2)
	args = append(args, p.Limit, p.Offset)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.StaffUnavailability, 0)
	for rows.Next() {
		u, err := scanUnavailability(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *u)
	}
	return out, rows.Err()
}

// DeleteUnavailability removes an unavailability record.
func (s *Store) DeleteUnavailability(ctx context.Context, id string) error {
	ct, err := s.pool.Exec(ctx, `DELETE FROM staff_unavailability WHERE id = $1::uuid`, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ShiftPreferenceInput carries one preferred shift.
type ShiftPreferenceInput struct {
	ShiftID string
	Rank    int
}

// ReplaceShiftPreferences sets a staff member's shift preferences.
func (s *Store) ReplaceShiftPreferences(ctx context.Context, staffID string, prefs []ShiftPreferenceInput) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, `DELETE FROM staff_shift_preferences WHERE staff_id = $1::uuid`, staffID); err != nil {
		return err
	}
	for _, p := range prefs {
		if _, err := tx.Exec(ctx, `
			INSERT INTO staff_shift_preferences (staff_id, shift_id, rank)
			VALUES ($1::uuid, $2::uuid, $3)`, staffID, p.ShiftID, p.Rank); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// ListShiftPreferences returns a staff member's shift preferences.
func (s *Store) ListShiftPreferences(ctx context.Context, staffID string) ([]domain.ShiftPreference, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT sp.shift_id::text, COALESCE(sh.code, ''), COALESCE(sh.name, ''), sp.rank
		FROM staff_shift_preferences sp JOIN staff_shifts sh ON sh.id = sp.shift_id
		WHERE sp.staff_id = $1::uuid ORDER BY sp.rank ASC`, staffID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.ShiftPreference, 0)
	for rows.Next() {
		var p domain.ShiftPreference
		if err := rows.Scan(&p.ShiftID, &p.ShiftCode, &p.ShiftName, &p.Rank); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// DecideLeave approves or rejects a pending leave request.
func (s *Store) DecideLeave(ctx context.Context, id, status, decidedBy string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var current string
	if err := tx.QueryRow(ctx, `SELECT status::text FROM staff_leave WHERE id = $1::uuid FOR UPDATE`, id).
		Scan(&current); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if current != domain.StaffLeaveStatusPending {
		return ErrLeaveNotPending
	}
	if _, err := tx.Exec(ctx, `
		UPDATE staff_leave SET status = $2, approved_by = $3::uuid, decided_at = now(), updated_at = now()
		WHERE id = $1::uuid`, id, status, decidedBy); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
