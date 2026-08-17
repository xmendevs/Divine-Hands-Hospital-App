package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

// Attendance errors.
var (
	ErrAlreadyClockedIn        = errors.New("staff already has an open clock-in")
	ErrNotClockedIn            = errors.New("no open clock-in to clock out")
	ErrDuplicateAttendance     = errors.New("attendance already recorded for this staff and shift on this date")
	ErrInvalidAttendanceMethod = errors.New("unsupported clock-in method")
)

// baseAttendanceMethods are the always-valid clock-in methods.
var baseAttendanceMethods = []string{"kiosk", "biometric", "mobile", "manual"}

// attendanceMethodAllowed reports whether m is a base or configured method.
func (s *Store) attendanceMethodAllowed(ctx context.Context, m string) (bool, error) {
	for _, b := range baseAttendanceMethods {
		if m == b {
			return true, nil
		}
	}
	var val []byte
	err := s.pool.QueryRow(ctx, `SELECT value FROM system_settings WHERE key = 'attendance.allowed_methods'`).Scan(&val)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var customs []string
	if json.Unmarshal(val, &customs) != nil {
		return false, nil
	}
	for _, c := range customs {
		if m == c {
			return true, nil
		}
	}
	return false, nil
}

// ---- shift definitions ----

const staffShiftCols = `id::text, code, name, to_char(start_time, 'HH24:MI'), to_char(end_time, 'HH24:MI'),
	late_grace_minutes, is_night, created_at, updated_at`

func scanStaffShift(r pgx.Row) (*domain.StaffShift, error) {
	var sh domain.StaffShift
	err := r.Scan(&sh.ID, &sh.Code, &sh.Name, &sh.StartTime, &sh.EndTime,
		&sh.LateGraceMinutes, &sh.IsNight, &sh.CreatedAt, &sh.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &sh, nil
}

// CreateShiftParams carries a new shift definition.
type CreateShiftParams struct {
	Code             string
	Name             string
	StartTime        string // HH:MM
	EndTime          string // HH:MM
	LateGraceMinutes int
	IsNight          bool
}

// CreateStaffShift registers a shift definition.
func (s *Store) CreateStaffShift(ctx context.Context, p CreateShiftParams) (*domain.StaffShift, error) {
	sh, err := scanStaffShift(s.pool.QueryRow(ctx, `
		INSERT INTO staff_shifts (code, name, start_time, end_time, late_grace_minutes, is_night)
		VALUES ($1, $2, $3::time, $4::time, $5, $6)
		RETURNING `+staffShiftCols, p.Code, p.Name, p.StartTime, p.EndTime, p.LateGraceMinutes, p.IsNight))
	if err != nil {
		return nil, err
	}
	return sh, nil
}

// ListStaffShifts returns shift definitions ordered by start time.
func (s *Store) ListStaffShifts(ctx context.Context) ([]domain.StaffShift, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+staffShiftCols+` FROM staff_shifts ORDER BY start_time ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.StaffShift, 0)
	for rows.Next() {
		sh, err := scanStaffShift(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *sh)
	}
	return out, rows.Err()
}

// GetStaffShiftByID returns a shift definition.
func (s *Store) GetStaffShiftByID(ctx context.Context, id string) (*domain.StaffShift, error) {
	sh, err := scanStaffShift(s.pool.QueryRow(ctx, `SELECT `+staffShiftCols+` FROM staff_shifts WHERE id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return sh, err
}

// ---- attendance records ----

const attendanceCols = `a.id::text, a.staff_id::text, a.shift_id::text, a.work_date::text,
	a.clock_in_at, a.clock_out_at, a.clock_in_method, COALESCE(a.clock_out_method, ''),
	a.clock_in_device, COALESCE(a.clock_out_device, ''), a.is_late, a.is_early_leave,
	a.status::text, a.notes, a.created_at, a.updated_at,
	COALESCE(st.first_name || ' ' || st.last_name, ''), COALESCE(st.employee_no, ''),
	COALESCE(sh.name, ''), COALESCE(sh.code, ''), COALESCE(d.name, '')`

const attendanceFrom = ` FROM attendance_records a
	JOIN staff st ON st.id = a.staff_id
	JOIN staff_shifts sh ON sh.id = a.shift_id
	LEFT JOIN departments d ON d.id = st.department_id`

func scanAttendance(r pgx.Row) (*domain.AttendanceRecord, error) {
	var a domain.AttendanceRecord
	err := r.Scan(&a.ID, &a.StaffID, &a.ShiftID, &a.WorkDate,
		&a.ClockInAt, &a.ClockOutAt, &a.ClockInMethod, &a.ClockOutMethod,
		&a.ClockInDevice, &a.ClockOutDevice, &a.IsLate, &a.IsEarlyLeave,
		&a.Status, &a.Notes, &a.CreatedAt, &a.UpdatedAt,
		&a.StaffName, &a.EmployeeNo, &a.ShiftName, &a.ShiftCode, &a.DepartmentName)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// ClockInParams carries a clock-in event.
type ClockInParams struct {
	StaffID  string
	ShiftID  string
	WorkDate string // ISO date; empty means today (UTC)
	Method   string
	Device   string
	Notes    string
}

// ClockIn records a clock-in for a staff member, computing lateness against
// the shift's scheduled start time plus its grace period.
func (s *Store) ClockIn(ctx context.Context, p ClockInParams) (*domain.AttendanceRecord, error) {
	if p.Method == "" {
		return nil, ErrInvalidAttendanceMethod
	}
	allowed, err := s.attendanceMethodAllowed(ctx, p.Method)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, ErrInvalidAttendanceMethod
	}

	shift, err := s.GetStaffShiftByID(ctx, p.ShiftID)
	if err != nil {
		return nil, err
	}
	workDate := p.WorkDate
	if workDate == "" {
		workDate = time.Now().UTC().Format("2006-01-02")
	}
	isLate, err := clockInIsLate(shift, workDate, time.Now().UTC())
	if err != nil {
		return nil, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var open bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM attendance_records WHERE staff_id = $1::uuid AND clock_out_at IS NULL)`, p.StaffID).
		Scan(&open); err != nil {
		return nil, err
	}
	if open {
		return nil, ErrAlreadyClockedIn
	}
	var dup bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM attendance_records WHERE staff_id = $1::uuid AND shift_id = $2::uuid AND work_date = $3::date)`, p.StaffID, p.ShiftID, workDate).
		Scan(&dup); err != nil {
		return nil, err
	}
	if dup {
		return nil, ErrDuplicateAttendance
	}

	var id string
	if err := tx.QueryRow(ctx, `
		INSERT INTO attendance_records (staff_id, shift_id, work_date, clock_in_at, clock_in_method,
		                                clock_in_device, is_late, notes)
		VALUES ($1::uuid, $2::uuid, $3::date, now(), $4, $5, $6, $7)
		RETURNING id::text`,
		p.StaffID, p.ShiftID, workDate, p.Method, p.Device, isLate, p.Notes).Scan(&id); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetAttendance(ctx, id)
}

// ClockOutParams carries a clock-out event.
type ClockOutParams struct {
	StaffID string
	Method  string
	Device  string
	Notes   string
}

// ClockOut closes the staff member's open clock-in, computing early-leave
// against the shift's scheduled end time.
func (s *Store) ClockOut(ctx context.Context, p ClockOutParams) (*domain.AttendanceRecord, error) {
	if p.Method == "" {
		return nil, ErrInvalidAttendanceMethod
	}
	allowed, err := s.attendanceMethodAllowed(ctx, p.Method)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, ErrInvalidAttendanceMethod
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var recordID, workDate string
	var shiftID string
	if err := tx.QueryRow(ctx, `
		SELECT id::text, work_date::text, shift_id::text
		FROM attendance_records
		WHERE staff_id = $1::uuid AND clock_out_at IS NULL
		ORDER BY clock_in_at DESC
		LIMIT 1 FOR UPDATE`, p.StaffID).Scan(&recordID, &workDate, &shiftID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotClockedIn
		}
		return nil, err
	}

	shift, err := s.GetStaffShiftByID(ctx, shiftID)
	if err != nil {
		return nil, err
	}
	isEarly, err := clockOutIsEarly(shift, workDate, time.Now().UTC())
	if err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE attendance_records
		SET clock_out_at = now(), clock_out_method = $2, clock_out_device = $3,
		    is_early_leave = $4, status = 'completed', updated_at = now()
		WHERE id = $1::uuid`, recordID, p.Method, p.Device, isEarly); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetAttendance(ctx, recordID)
}

// clockInIsLate reports whether now is later than the shift start plus grace.
func clockInIsLate(shift *domain.StaffShift, workDate string, now time.Time) (bool, error) {
	scheduled, err := scheduledTime(workDate, shift.StartTime)
	if err != nil {
		return false, err
	}
	return now.After(scheduled.Add(time.Duration(shift.LateGraceMinutes) * time.Minute)), nil
}

// clockOutIsEarly reports whether now is earlier than the shift end time.
func clockOutIsEarly(shift *domain.StaffShift, workDate string, now time.Time) (bool, error) {
	scheduled, err := scheduledTime(workDate, shift.EndTime)
	if err != nil {
		return false, err
	}
	return now.Before(scheduled), nil
}

// scheduledTime combines an ISO work date with an HH:MM clock time in UTC.
func scheduledTime(workDate, hhmm string) (time.Time, error) {
	d, err := time.Parse("2006-01-02", workDate)
	if err != nil {
		return time.Time{}, err
	}
	t, err := time.Parse("15:04", hhmm)
	if err != nil {
		return time.Time{}, err
	}
	return time.Date(d.Year(), d.Month(), d.Day(), t.Hour(), t.Minute(), 0, 0, time.UTC), nil
}

// GetAttendance returns a single attendance record with staff/shift context.
func (s *Store) GetAttendance(ctx context.Context, id string) (*domain.AttendanceRecord, error) {
	a, err := scanAttendance(s.pool.QueryRow(ctx, `SELECT `+attendanceCols+attendanceFrom+` WHERE a.id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return a, err
}

// ListAttendanceParams filters attendance records.
type ListAttendanceParams struct {
	StaffID string
	Date    string
	Status  string
	Late    bool
	Early   bool
	Limit   int
	Offset  int
}

// ListAttendance returns attendance records, newest first.
func (s *Store) ListAttendance(ctx context.Context, p ListAttendanceParams) ([]domain.AttendanceRecord, error) {
	q := `SELECT ` + attendanceCols + attendanceFrom + ` WHERE true`
	args := []any{}
	if p.StaffID != "" {
		args = append(args, p.StaffID)
		q += ` AND a.staff_id = $` + itoa(len(args)) + `::uuid`
	}
	if p.Date != "" {
		args = append(args, p.Date)
		q += ` AND a.work_date = $` + itoa(len(args)) + `::date`
	}
	if p.Status != "" {
		args = append(args, p.Status)
		q += ` AND a.status = $` + itoa(len(args))
	}
	if p.Late {
		q += ` AND a.is_late = TRUE`
	}
	if p.Early {
		q += ` AND a.is_early_leave = TRUE`
	}
	q += ` ORDER BY a.clock_in_at DESC LIMIT $` + itoa(len(args)+1) + ` OFFSET $` + itoa(len(args)+2)
	args = append(args, p.Limit, p.Offset)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.AttendanceRecord, 0)
	for rows.Next() {
		a, err := scanAttendance(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// AttendanceReport builds a per-day report: every recorded attendance plus a
// missed/on-leave row for each active staff member with no record that day.
func (s *Store) AttendanceReport(ctx context.Context, date string) ([]domain.AttendanceReportRow, error) {
	if date == "" {
		date = time.Now().UTC().Format("2006-01-02")
	}
	records, err := s.ListAttendance(ctx, ListAttendanceParams{Date: date, Limit: 500})
	if err != nil {
		return nil, err
	}

	out := make([]domain.AttendanceReportRow, 0, len(records))
	for _, a := range records {
		row := domain.AttendanceReportRow{
			StaffID:    a.StaffID,
			EmployeeNo: a.EmployeeNo,
			StaffName:  a.StaffName,
			Department: a.DepartmentName,
			ShiftID:    a.ShiftID,
			ShiftName:  a.ShiftName,
			ClockInAt:  &a.ClockInAt,
			ClockOutAt: a.ClockOutAt,
		}
		switch {
		case a.Status == domain.AttendanceStatusClockedIn:
			row.Status = domain.AttendanceReportOnTime // still working; not yet early/late-complete
		case a.IsLate:
			row.Status = domain.AttendanceReportLate
		case a.IsEarlyLeave:
			row.Status = domain.AttendanceReportEarly
		default:
			row.Status = domain.AttendanceReportCompleted
		}
		out = append(out, row)
	}

	// Roster entries with no attendance that day: missed, or on approved leave.
	rows, err := s.pool.Query(ctx, `
		SELECT r.staff_id::text, COALESCE(st.employee_no, ''), COALESCE(st.first_name || ' ' || st.last_name, ''),
		       COALESCE(d.name, ''), r.shift_id::text, COALESCE(sh.name, ''),
		       CASE WHEN EXISTS (
		           SELECT 1 FROM staff_leave sl
		           WHERE sl.staff_id = r.staff_id AND sl.status = 'approved'
		             AND $1::date BETWEEN sl.start_date AND sl.end_date
		       ) THEN $2 ELSE $3 END
		FROM staff_rosters r
		JOIN staff st ON st.id = r.staff_id
		JOIN staff_shifts sh ON sh.id = r.shift_id
		LEFT JOIN departments d ON d.id = st.department_id
		WHERE r.work_date = $1::date
		  AND NOT EXISTS (
		      SELECT 1 FROM attendance_records a
		      WHERE a.staff_id = r.staff_id AND a.shift_id = r.shift_id AND a.work_date = r.work_date
		  )
		ORDER BY st.employee_no ASC, sh.name ASC`,
		date, domain.AttendanceReportOnLeave, domain.AttendanceReportMissed)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var row domain.AttendanceReportRow
		if err := rows.Scan(&row.StaffID, &row.EmployeeNo, &row.StaffName, &row.Department, &row.ShiftID, &row.ShiftName, &row.Status); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// ---- staff rosters ----

// ErrRosterDuplicate is returned when scheduling the same staff/shift/date twice.
var ErrRosterDuplicate = errors.New("staff already scheduled for this shift on this date")

const staffRosterCols = `r.id::text, r.staff_id::text, r.shift_id::text, r.work_date::text,
	r.notes, r.created_by::text, r.created_at,
	COALESCE(st.first_name || ' ' || st.last_name, ''), COALESCE(st.employee_no, ''),
	COALESCE(sh.name, ''), COALESCE(sh.code, '')`

const staffRosterFrom = ` FROM staff_rosters r
	JOIN staff st ON st.id = r.staff_id
	JOIN staff_shifts sh ON sh.id = r.shift_id`

func scanStaffRoster(r pgx.Row) (*domain.StaffRoster, error) {
	var ro domain.StaffRoster
	err := r.Scan(&ro.ID, &ro.StaffID, &ro.ShiftID, &ro.WorkDate,
		&ro.Notes, &ro.CreatedBy, &ro.CreatedAt,
		&ro.StaffName, &ro.EmployeeNo, &ro.ShiftName, &ro.ShiftCode)
	if err != nil {
		return nil, err
	}
	return &ro, nil
}

// AssignRosterParams carries a roster assignment.
type AssignRosterParams struct {
	StaffID   string
	ShiftID   string
	WorkDate  string
	Notes     string
	CreatedBy string
}

// AssignRoster schedules a staff member to a shift on a date.
func (s *Store) AssignRoster(ctx context.Context, p AssignRosterParams) (*domain.StaffRoster, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var dup bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM staff_rosters WHERE staff_id = $1::uuid AND shift_id = $2::uuid AND work_date = $3::date)`, p.StaffID, p.ShiftID, p.WorkDate).
		Scan(&dup); err != nil {
		return nil, err
	}
	if dup {
		return nil, ErrRosterDuplicate
	}

	var id string
	if err := tx.QueryRow(ctx, `
		INSERT INTO staff_rosters (staff_id, shift_id, work_date, notes, created_by)
		VALUES ($1::uuid, $2::uuid, $3::date, $4, $5::uuid)
		RETURNING id::text`,
		p.StaffID, p.ShiftID, p.WorkDate, p.Notes, p.CreatedBy).Scan(&id); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetRoster(ctx, id)
}

// GetRoster returns a single roster assignment.
func (s *Store) GetRoster(ctx context.Context, id string) (*domain.StaffRoster, error) {
	ro, err := scanStaffRoster(s.pool.QueryRow(ctx, `SELECT `+staffRosterCols+staffRosterFrom+` WHERE r.id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return ro, err
}

// ListRosterParams filters roster assignments.
type ListRosterParams struct {
	Date    string
	StaffID string
	ShiftID string
	Limit   int
	Offset  int
}

// ListRoster returns roster assignments, ordered by date then staff.
func (s *Store) ListRoster(ctx context.Context, p ListRosterParams) ([]domain.StaffRoster, error) {
	q := `SELECT ` + staffRosterCols + staffRosterFrom + ` WHERE true`
	args := []any{}
	if p.Date != "" {
		args = append(args, p.Date)
		q += ` AND r.work_date = $` + itoa(len(args)) + `::date`
	}
	if p.StaffID != "" {
		args = append(args, p.StaffID)
		q += ` AND r.staff_id = $` + itoa(len(args)) + `::uuid`
	}
	if p.ShiftID != "" {
		args = append(args, p.ShiftID)
		q += ` AND r.shift_id = $` + itoa(len(args)) + `::uuid`
	}
	q += ` ORDER BY r.work_date DESC, st.employee_no ASC LIMIT $` + itoa(len(args)+1) + ` OFFSET $` + itoa(len(args)+2)
	args = append(args, p.Limit, p.Offset)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.StaffRoster, 0)
	for rows.Next() {
		ro, err := scanStaffRoster(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *ro)
	}
	return out, rows.Err()
}

// DeleteRoster removes a roster assignment.
func (s *Store) DeleteRoster(ctx context.Context, id string) error {
	ct, err := s.pool.Exec(ctx, `DELETE FROM staff_rosters WHERE id = $1::uuid`, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
