package httpapi

import (
	"encoding/csv"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

type staffShiftResponse struct {
	ID               string `json:"id"`
	Code             string `json:"code"`
	Name             string `json:"name"`
	StartTime        string `json:"startTime"`
	EndTime          string `json:"endTime"`
	LateGraceMinutes int    `json:"lateGraceMinutes"`
	IsNight          bool   `json:"isNight"`
}

func newStaffShiftResponse(sh *domain.StaffShift) staffShiftResponse {
	return staffShiftResponse{
		ID:               sh.ID,
		Code:             sh.Code,
		Name:             sh.Name,
		StartTime:        sh.StartTime,
		EndTime:          sh.EndTime,
		LateGraceMinutes: sh.LateGraceMinutes,
		IsNight:          sh.IsNight,
	}
}

type createShiftRequest struct {
	Code             string `json:"code"`
	Name             string `json:"name"`
	StartTime        string `json:"startTime"`
	EndTime          string `json:"endTime"`
	LateGraceMinutes int    `json:"lateGraceMinutes"`
	IsNight          bool   `json:"isNight"`
}

// handleCreateShift creates a shift definition.
func (s *server) handleCreateShift(w http.ResponseWriter, r *http.Request) {
	var req createShiftRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Code == "" || req.Name == "" || req.StartTime == "" || req.EndTime == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "code, name, startTime and endTime are required")
		return
	}
	if req.LateGraceMinutes < 0 {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "lateGraceMinutes cannot be negative")
		return
	}
	sh, err := s.store.CreateStaffShift(r.Context(), store.CreateShiftParams{
		Code:             req.Code,
		Name:             req.Name,
		StartTime:        req.StartTime,
		EndTime:          req.EndTime,
		LateGraceMinutes: req.LateGraceMinutes,
		IsNight:          req.IsNight,
	})
	if err != nil {
		writeError(w, r, http.StatusConflict, "conflict", "shift code already exists")
		return
	}
	s.recordAudit(r, domain.ActionAttendanceShiftCreate, "staff_shift", sh.ID, nil, map[string]any{"code": sh.Code})
	writeJSON(w, http.StatusCreated, newStaffShiftResponse(sh))
}

// handleListStaffShifts lists shift definitions.
func (s *server) handleListStaffShifts(w http.ResponseWriter, r *http.Request) {
	shifts, err := s.store.ListStaffShifts(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]staffShiftResponse, 0, len(shifts))
	for i := range shifts {
		out = append(out, newStaffShiftResponse(&shifts[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

type attendanceResponse struct {
	ID             string  `json:"id"`
	StaffID        string  `json:"staffId"`
	StaffName      string  `json:"staffName,omitempty"`
	EmployeeNo     string  `json:"employeeNo,omitempty"`
	ShiftID        string  `json:"shiftId"`
	ShiftName      string  `json:"shiftName,omitempty"`
	ShiftCode      string  `json:"shiftCode,omitempty"`
	DepartmentName string  `json:"departmentName,omitempty"`
	WorkDate       string  `json:"workDate"`
	ClockInAt      string  `json:"clockInAt"`
	ClockOutAt     *string `json:"clockOutAt,omitempty"`
	ClockInMethod  string  `json:"clockInMethod"`
	ClockOutMethod string  `json:"clockOutMethod,omitempty"`
	ClockInDevice  string  `json:"clockInDevice,omitempty"`
	ClockOutDevice string  `json:"clockOutDevice,omitempty"`
	IsLate         bool    `json:"isLate"`
	IsEarlyLeave   bool    `json:"isEarlyLeave"`
	Status         string  `json:"status"`
	Notes          string  `json:"notes,omitempty"`
}

func newAttendanceResponse(a *domain.AttendanceRecord) attendanceResponse {
	out := attendanceResponse{
		ID:             a.ID,
		StaffID:        a.StaffID,
		StaffName:      a.StaffName,
		EmployeeNo:     a.EmployeeNo,
		ShiftID:        a.ShiftID,
		ShiftName:      a.ShiftName,
		ShiftCode:      a.ShiftCode,
		DepartmentName: a.DepartmentName,
		WorkDate:       a.WorkDate,
		ClockInAt:      a.ClockInAt.UTC().Format(timeRFC3339),
		ClockInMethod:  a.ClockInMethod,
		ClockOutMethod: a.ClockOutMethod,
		ClockInDevice:  a.ClockInDevice,
		ClockOutDevice: a.ClockOutDevice,
		IsLate:         a.IsLate,
		IsEarlyLeave:   a.IsEarlyLeave,
		Status:         a.Status,
		Notes:          a.Notes,
	}
	if a.ClockOutAt != nil {
		v := a.ClockOutAt.UTC().Format(timeRFC3339)
		out.ClockOutAt = &v
	}
	return out
}

type clockInRequest struct {
	ShiftID  string `json:"shiftId"`
	WorkDate string `json:"workDate"`
	Method   string `json:"method"`
	Device   string `json:"device"`
	Notes    string `json:"notes"`
}

// handleClockIn records a clock-in for the authenticated staff member.
func (s *server) handleClockIn(w http.ResponseWriter, r *http.Request) {
	var req clockInRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.ShiftID == "" || req.Method == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "shiftId and method are required")
		return
	}
	actor := userFromContext(r.Context())
	staff, err := s.store.GetStaffByUserID(r.Context(), actor.ID)
	if err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "staff profile not found")
		return
	}
	rec, err := s.store.ClockIn(r.Context(), store.ClockInParams{
		StaffID:  staff.ID,
		ShiftID:  req.ShiftID,
		WorkDate: req.WorkDate,
		Method:   req.Method,
		Device:   req.Device,
		Notes:    req.Notes,
	})
	if err != nil {
		s.writeAttendanceError(w, r, err)
		return
	}
	s.recordAudit(r, domain.ActionAttendanceClockIn, "attendance", rec.ID, nil, map[string]any{
		"shiftId": rec.ShiftID, "method": rec.ClockInMethod, "isLate": rec.IsLate,
	})
	writeJSON(w, http.StatusCreated, newAttendanceResponse(rec))
}

type clockOutRequest struct {
	Method string `json:"method"`
	Device string `json:"device"`
	Notes  string `json:"notes"`
}

// handleClockOut closes the authenticated staff member's open clock-in.
func (s *server) handleClockOut(w http.ResponseWriter, r *http.Request) {
	var req clockOutRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Method == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "method is required")
		return
	}
	actor := userFromContext(r.Context())
	staff, err := s.store.GetStaffByUserID(r.Context(), actor.ID)
	if err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "staff profile not found")
		return
	}
	rec, err := s.store.ClockOut(r.Context(), store.ClockOutParams{
		StaffID: staff.ID,
		Method:  req.Method,
		Device:  req.Device,
		Notes:   req.Notes,
	})
	if err != nil {
		s.writeAttendanceError(w, r, err)
		return
	}
	s.recordAudit(r, domain.ActionAttendanceClockOut, "attendance", rec.ID, nil, map[string]any{
		"shiftId": rec.ShiftID, "method": rec.ClockOutMethod, "isEarlyLeave": rec.IsEarlyLeave,
	})
	writeJSON(w, http.StatusOK, newAttendanceResponse(rec))
}

func (s *server) writeAttendanceError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, r, http.StatusNotFound, "not_found", "shift not found")
	case errors.Is(err, store.ErrAlreadyClockedIn):
		writeError(w, r, http.StatusConflict, "already_clocked_in", "staff already has an open clock-in")
	case errors.Is(err, store.ErrDuplicateAttendance):
		writeError(w, r, http.StatusConflict, "duplicate_attendance", "attendance already recorded for this staff and shift on this date")
	case errors.Is(err, store.ErrNotClockedIn):
		writeError(w, r, http.StatusConflict, "not_clocked_in", "no open clock-in to clock out")
	case errors.Is(err, store.ErrInvalidAttendanceMethod):
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "unsupported clock-in method")
	default:
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
	}
}

// handleListAttendance lists attendance records.
func (s *server) handleListAttendance(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)
	records, err := s.store.ListAttendance(r.Context(), store.ListAttendanceParams{
		StaffID: r.URL.Query().Get("staffId"),
		Date:    r.URL.Query().Get("date"),
		Status:  r.URL.Query().Get("status"),
		Late:    queryBool(r, "late"),
		Early:   queryBool(r, "early"),
		Limit:   limit,
		Offset:  offset,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]attendanceResponse, 0, len(records))
	for i := range records {
		out = append(out, newAttendanceResponse(&records[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

type reportRowResponse struct {
	StaffID    string  `json:"staffId"`
	EmployeeNo string  `json:"employeeNo,omitempty"`
	StaffName  string  `json:"staffName"`
	Department string  `json:"department,omitempty"`
	ShiftID    string  `json:"shiftId,omitempty"`
	ShiftName  string  `json:"shiftName,omitempty"`
	Status     string  `json:"status"`
	ClockInAt  *string `json:"clockInAt,omitempty"`
	ClockOutAt *string `json:"clockOutAt,omitempty"`
}

// handleAttendanceReport builds the per-day attendance report.
func (s *server) handleAttendanceReport(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.AttendanceReport(r.Context(), r.URL.Query().Get("date"))
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]reportRowResponse, 0, len(rows))
	for _, row := range rows {
		rr := reportRowResponse{
			StaffID:    row.StaffID,
			EmployeeNo: row.EmployeeNo,
			StaffName:  row.StaffName,
			Department: row.Department,
			ShiftID:    row.ShiftID,
			ShiftName:  row.ShiftName,
			Status:     row.Status,
		}
		if row.ClockInAt != nil {
			v := row.ClockInAt.UTC().Format(timeRFC3339)
			rr.ClockInAt = &v
		}
		if row.ClockOutAt != nil {
			v := row.ClockOutAt.UTC().Format(timeRFC3339)
			rr.ClockOutAt = &v
		}
		out = append(out, rr)
	}
	writeJSON(w, http.StatusOK, out)
}

func queryBool(r *http.Request, key string) bool {
	v := r.URL.Query().Get(key)
	if v == "" {
		return false
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return v == "1"
	}
	return b
}

type rosterResponse struct {
	ID         string `json:"id"`
	StaffID    string `json:"staffId"`
	StaffName  string `json:"staffName,omitempty"`
	EmployeeNo string `json:"employeeNo,omitempty"`
	ShiftID    string `json:"shiftId"`
	ShiftName  string `json:"shiftName,omitempty"`
	ShiftCode  string `json:"shiftCode,omitempty"`
	WorkDate   string `json:"workDate"`
	Notes      string `json:"notes,omitempty"`
	CreatedAt  string `json:"createdAt"`
}

func newRosterResponse(ro *domain.StaffRoster) rosterResponse {
	return rosterResponse{
		ID:         ro.ID,
		StaffID:    ro.StaffID,
		StaffName:  ro.StaffName,
		EmployeeNo: ro.EmployeeNo,
		ShiftID:    ro.ShiftID,
		ShiftName:  ro.ShiftName,
		ShiftCode:  ro.ShiftCode,
		WorkDate:   ro.WorkDate,
		Notes:      ro.Notes,
		CreatedAt:  ro.CreatedAt.UTC().Format(timeRFC3339),
	}
}

type assignRosterRequest struct {
	StaffID  string `json:"staffId"`
	ShiftID  string `json:"shiftId"`
	WorkDate string `json:"workDate"`
	Notes    string `json:"notes"`
}

// handleAssignRoster schedules a staff member to a shift on a date.
func (s *server) handleAssignRoster(w http.ResponseWriter, r *http.Request) {
	var req assignRosterRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.StaffID == "" || req.ShiftID == "" || req.WorkDate == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "staffId, shiftId and workDate are required")
		return
	}
	actor := userFromContext(r.Context())
	ro, err := s.store.AssignRoster(r.Context(), store.AssignRosterParams{
		StaffID:   req.StaffID,
		ShiftID:   req.ShiftID,
		WorkDate:  req.WorkDate,
		Notes:     req.Notes,
		CreatedBy: actor.ID,
	})
	if err != nil {
		if errors.Is(err, store.ErrRosterDuplicate) {
			writeError(w, r, http.StatusConflict, "duplicate_roster", "staff already scheduled for this shift on this date")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionRosterAssign, "staff_roster", ro.ID, nil, map[string]any{
		"staffId": ro.StaffID, "shiftId": ro.ShiftID, "workDate": ro.WorkDate,
	})
	writeJSON(w, http.StatusCreated, newRosterResponse(ro))
}

// handleListRoster lists roster assignments.
func (s *server) handleListRoster(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)
	roster, err := s.store.ListRoster(r.Context(), store.ListRosterParams{
		Date:    r.URL.Query().Get("date"),
		StaffID: r.URL.Query().Get("staffId"),
		ShiftID: r.URL.Query().Get("shiftId"),
		Limit:   limit,
		Offset:  offset,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]rosterResponse, 0, len(roster))
	for i := range roster {
		out = append(out, newRosterResponse(&roster[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

// handleDeleteRoster removes a roster assignment.
func (s *server) handleDeleteRoster(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.store.DeleteRoster(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "roster assignment not found")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionRosterRemove, "staff_roster", id, nil, nil)
	w.WriteHeader(http.StatusNoContent)
}

// ───────────────────────────────────────────────────────────────────────────
// Enterprise attendance endpoints (Phase 18)
// ───────────────────────────────────────────────────────────────────────────

type attendanceDashboardResponse struct {
	TotalStaff    int `json:"totalStaff"`
	ClockedIn     int `json:"clockedIn"`
	Absent        int `json:"absent"`
	LateToday     int `json:"lateToday"`
	OvertimeHours int `json:"overtimeHours"`
	LeavePending  int `json:"leavePending"`
}

// handleAttendanceDashboard returns KPI metrics for the attendance dashboard.
func (s *server) handleAttendanceDashboard(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	today := time.Now().Format("2006-01-02")

	// Total active staff
	allStaff, err := s.store.ListStaff(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	totalStaff := len(allStaff)

	// Today's attendance
	records, err := s.store.ListAttendanceByDate(r.Context(), today)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	clockedIn := 0
	lateToday := 0
	overtimeMinutes := 0
	for _, rec := range records {
		if rec.Status == "clocked_in" {
			clockedIn++
		}
		if rec.IsLate {
			lateToday++
		}
		overtimeMinutes += rec.OvertimeMinutes
	}
	absent := totalStaff - clockedIn - len(records) + clockedIn
	if absent < 0 {
		absent = 0
	}

	// Pending leave requests
	leavePending := 0
	if actor != nil {
		leavePending, _ = s.store.CountPendingLeaveRequests(r.Context())
	}

	writeJSON(w, http.StatusOK, attendanceDashboardResponse{
		TotalStaff:    totalStaff,
		ClockedIn:     clockedIn,
		Absent:        absent,
		LateToday:     lateToday,
		OvertimeHours: overtimeMinutes / 60,
		LeavePending:  leavePending,
	})
}

type leaveRequestResponse struct {
	ID           string  `json:"id"`
	StaffID      string  `json:"staffId"`
	StaffName    string  `json:"staffName"`
	LeaveType    string  `json:"leaveType"`
	StartDate    string  `json:"startDate"`
	EndDate      string  `json:"endDate"`
	Reason       string  `json:"reason"`
	Status       string  `json:"status"`
	ReviewedBy   *string `json:"reviewedBy,omitempty"`
	ReviewNotes  string  `json:"reviewNotes"`
	CreatedAt    string  `json:"createdAt"`
}

type createLeaveRequest struct {
	LeaveType string `json:"leaveType"`
	StartDate string `json:"startDate"`
	EndDate   string `json:"endDate"`
	Reason    string `json:"reason"`
}

// handleCreateLeaveRequest submits a new leave request.
func (s *server) handleCreateLeaveRequest(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	if actor == nil {
		writeError(w, r, http.StatusUnauthorized, "unauthorized", "authentication required")
		return
	}
	var req createLeaveRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.LeaveType == "" {
		req.LeaveType = "annual"
	}
	if req.StartDate == "" || req.EndDate == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "start and end dates are required")
		return
	}
	lr, err := s.store.CreateLeaveRequest(r.Context(), actor.ID, req.LeaveType, req.StartDate, req.EndDate, req.Reason)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionLeaveRequest, "leave_request", lr.ID, nil, nil)
	writeJSON(w, http.StatusCreated, leaveRequestResponse{
		ID: lr.ID, StaffID: lr.StaffID, LeaveType: lr.LeaveType,
		StartDate: lr.StartDate, EndDate: lr.EndDate, Reason: lr.Reason,
		Status: lr.Status, CreatedAt: lr.CreatedAt,
	})
}

// handleListLeaveRequests lists leave requests (own for non-admin, all for admin/super_admin).
func (s *server) handleListLeaveRequests(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	if actor == nil {
		writeError(w, r, http.StatusUnauthorized, "unauthorized", "authentication required")
		return
	}
	statuses := r.URL.Query().Get("status")
	limit, offset := pagination(r)

	// Non-admins only see their own requests
	staffID := ""
	roles, _ := s.store.GetUserRoles(r.Context(), actor.ID)
	isAdmin := false
	for _, rl := range roles {
		if rl.Code == "super_admin" || rl.Code == "admin" || rl.Code == "matron" {
			isAdmin = true
			break
		}
	}
	if !isAdmin {
		staffID = actor.ID
	}

	requests, err := s.store.ListLeaveRequests(r.Context(), store.ListLeaveRequestsParams{
		StaffID: staffID, Status: statuses, Limit: limit, Offset: offset,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]leaveRequestResponse, 0, len(requests))
	for _, lr := range requests {
		out = append(out, leaveRequestResponse{
			ID: lr.ID, StaffID: lr.StaffID, StaffName: lr.StaffName, LeaveType: lr.LeaveType,
			StartDate: lr.StartDate, EndDate: lr.EndDate, Reason: lr.Reason,
			Status: lr.Status, ReviewNotes: lr.ReviewNotes, CreatedAt: lr.CreatedAt,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

type reviewLeaveRequest struct {
	Action string `json:"action"` // "approve", "reject", or "revert"
	Notes  string `json:"notes"`
}

// handleReviewLeaveRequest approves, rejects, or reverts a leave request.
// Only super_admin can approve, reject, or revert leave requests.
func (s *server) handleReviewLeaveRequest(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	id := r.PathValue("id")
	var req reviewLeaveRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}

	// Only super_admin can approve, reject, or revert leave requests
	roles, err := s.store.GetUserRoles(r.Context(), actor.ID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	isSuperAdmin := false
	for _, rl := range roles {
		if rl.Code == "super_admin" {
			isSuperAdmin = true
			break
		}
	}
	if !isSuperAdmin {
		writeError(w, r, http.StatusForbidden, "forbidden", "only super admin can manage leave requests")
		return
	}

	var status string
	switch req.Action {
	case "approve", "approved":
		status = "approved"
	case "reject", "rejected":
		status = "rejected"
	case "revert":
		status = "pending"
	default:
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "action must be approve, reject, or revert")
		return
    }

	if err := s.store.ReviewLeaveRequest(r.Context(), id, actor.ID, status, req.Notes); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "leave request not found")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleExportAttendance exports attendance records as CSV.
func (s *server) handleExportAttendance(w http.ResponseWriter, r *http.Request) {
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	if from == "" {
		from = time.Now().AddDate(0, 0, -30).Format("2006-01-02")
	}
	if to == "" {
		now := time.Now()
		to = now.Format("2006-01-02")
	}

	// Fetch all attendance in range (iterate dates)
	records := []domain.AttendanceRecord{}
	t, _ := time.Parse("2006-01-02", from)
	te, _ := time.Parse("2006-01-02", to)
	for !t.After(te) {
		recs, _ := s.store.ListAttendanceByDate(r.Context(), t.Format("2006-01-02"))
		records = append(records, recs...)
		t = t.AddDate(0, 0, 1)
	}

	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="attendance_%s_to_%s.csv"`, from, to))
	writer := csv.NewWriter(w)
	writer.Write([]string{"Staff", "Employee No", "Department", "Shift", "Work Date", "Clock In", "Clock Out", "Status", "Late", "Early Leave", "Overtime (min)", "Notes"})
	for _, rec := range records {			writer.Write([]string{
				rec.StaffName, rec.EmployeeNo, rec.DepartmentName, rec.ShiftName,
				rec.WorkDate, rec.ClockInAt.Format("15:04"), timePtrStr(rec.ClockOutAt),
				rec.Status, boolStr(rec.IsLate), boolStr(rec.IsEarlyLeave),
				strconv.Itoa(rec.OvertimeMinutes), rec.Notes,
			})
	}
	writer.Flush()
}

func timePtrStr(t *time.Time) string {
	if t == nil {
		return "—"
	}
	return t.Format("15:04")
}

func boolStr(b bool) string {
	if b {
		return "Yes"
	}
	return "No"
}
