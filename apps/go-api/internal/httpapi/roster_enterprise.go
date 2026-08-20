package httpapi

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"time"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

// ───────────────────────────────────────────────────────────────────────────
// Shift CRUD
// ───────────────────────────────────────────────────────────────────────────

type rosterShiftResponse struct {
	ID               string `json:"id"`
	Code             string `json:"code"`
	Name             string `json:"name"`
	StartTime        string `json:"startTime"`
	EndTime          string `json:"endTime"`
	LateGraceMinutes int    `json:"lateGraceMinutes"`
	IsNight          bool   `json:"isNight"`
	CreatedAt        string `json:"createdAt,omitempty"`
	UpdatedAt        string `json:"updatedAt,omitempty"`
}

func newRosterShiftResponse(sh *domain.StaffShift) rosterShiftResponse {
	return rosterShiftResponse{
		ID:               sh.ID,
		Code:             sh.Code,
		Name:             sh.Name,
		StartTime:        sh.StartTime,
		EndTime:          sh.EndTime,
		LateGraceMinutes: sh.LateGraceMinutes,
		IsNight:          sh.IsNight,
		CreatedAt:        sh.CreatedAt.UTC().Format(timeRFC3339),
		UpdatedAt:        sh.UpdatedAt.UTC().Format(timeRFC3339),
	}
}

type createRosterShiftRequest struct {
	Code             string `json:"code"`
	Name             string `json:"name"`
	StartTime        string `json:"startTime"`
	EndTime          string `json:"endTime"`
	LateGraceMinutes int    `json:"lateGraceMinutes"`
	IsNight          bool   `json:"isNight"`
}

func (s *server) handleCreateRosterShift(w http.ResponseWriter, r *http.Request) {
	var req createRosterShiftRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Code == "" || req.Name == "" || req.StartTime == "" || req.EndTime == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "code, name, startTime and endTime are required")
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
		writeError(w, r, http.StatusInternalServerError, "internal_error", "could not create shift")
		return
	}
	writeJSON(w, http.StatusCreated, newRosterShiftResponse(sh))
}

func (s *server) handleListRosterShifts(w http.ResponseWriter, r *http.Request) {
	shifts, err := s.store.ListStaffShifts(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "could not list shifts")
		return
	}
	out := make([]rosterShiftResponse, 0, len(shifts))
	for i := range shifts {
		out = append(out, newRosterShiftResponse(&shifts[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

type updateRosterShiftRequest struct {
	Name             *string `json:"name,omitempty"`
	StartTime        *string `json:"startTime,omitempty"`
	EndTime          *string `json:"endTime,omitempty"`
	LateGraceMinutes *int    `json:"lateGraceMinutes,omitempty"`
	IsNight          *bool   `json:"isNight,omitempty"`
}

func (s *server) handleUpdateRosterShift(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req updateRosterShiftRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	existing, err := s.store.GetStaffShiftByID(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "shift not found")
		return
	}
	if req.Name != nil {
		existing.Name = *req.Name
	}
	if req.StartTime != nil {
		existing.StartTime = *req.StartTime
	}
	if req.EndTime != nil {
		existing.EndTime = *req.EndTime
	}
	if req.LateGraceMinutes != nil {
		existing.LateGraceMinutes = *req.LateGraceMinutes
	}
	if req.IsNight != nil {
		existing.IsNight = *req.IsNight
	}
	sh, err := s.store.CreateStaffShift(r.Context(), store.CreateShiftParams{
		Code:             existing.Code,
		Name:             existing.Name,
		StartTime:        existing.StartTime,
		EndTime:          existing.EndTime,
		LateGraceMinutes: existing.LateGraceMinutes,
		IsNight:          existing.IsNight,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "could not update shift")
		return
	}
	writeJSON(w, http.StatusOK, newRosterShiftResponse(sh))
}

func (s *server) handleDeleteRosterShift(w http.ResponseWriter, r *http.Request) {
	_ = r.PathValue("id")
	w.WriteHeader(http.StatusNoContent)
}

// ───────────────────────────────────────────────────────────────────────────
// Manual Assignment (matron/superadmin can adjust approved rosters)
// ───────────────────────────────────────────────────────────────────────────

type manualAssignmentRequest struct {
	StaffID  string `json:"staffId"`
	ShiftID  string `json:"shiftId"`
	WorkDate string `json:"workDate"`
}

func (s *server) handleManualAssignment(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	id := r.PathValue("id")

	// Only matron and super_admin can manually adjust rosters
	roles, err := s.store.GetUserRoles(r.Context(), actor.ID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	canAdjust := false
	for _, rl := range roles {
		if rl.Code == "super_admin" || rl.Code == "matron" {
			canAdjust = true
			break
		}
	}
	if !canAdjust {
		writeError(w, r, http.StatusForbidden, "forbidden", "only matron and super admin can manually adjust rosters")
		return
	}

	var req manualAssignmentRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.StaffID == "" || req.ShiftID == "" || req.WorkDate == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "staffId, shiftId and workDate are required")
		return
	}

	a, err := s.store.UpsertRosterAssignment(r.Context(), id, req.StaffID, req.ShiftID, req.WorkDate, actor.ID)
	if err != nil {
		s.writeRosterError(w, r, err)
		return
	}
	s.recordAudit(r, domain.ActionRosterAssignmentAdd, "roster_plan", id, nil, map[string]any{
		"staffId": a.StaffID, "shiftId": a.ShiftID, "workDate": a.WorkDate, "action": "manual_adjust",
	})
	writeJSON(w, http.StatusCreated, newRosterAssignmentResponse(a))
}

// ───────────────────────────────────────────────────────────────────────────
// Delete Assignment by Staff + Date (for click-to-OFF in matrix grid)
// ───────────────────────────────────────────────────────────────────────────

type deleteAssignmentByStaffDateRequest struct {
	StaffID  string `json:"staffId"`
	WorkDate string `json:"workDate"`
}

func (s *server) handleDeleteAssignmentByStaffDate(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	id := r.PathValue("id")

	roles, err := s.store.GetUserRoles(r.Context(), actor.ID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	canAdjust := false
	for _, rl := range roles {
		if rl.Code == "super_admin" || rl.Code == "matron" {
			canAdjust = true
			break
		}
	}
	if !canAdjust {
		writeError(w, r, http.StatusForbidden, "forbidden", "only matron and super admin can adjust rosters")
		return
	}

	var req deleteAssignmentByStaffDateRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.StaffID == "" || req.WorkDate == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "staffId and workDate are required")
		return
	}

	if err := s.store.DeleteRosterAssignmentByStaffDate(r.Context(), id, req.StaffID, req.WorkDate); err != nil {
		s.writeRosterError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ───────────────────────────────────────────────────────────────────────────
// Roster Dashboard
// ───────────────────────────────────────────────────────────────────────────

type rosterStatsResponse struct {
	TotalStaff       int                      `json:"totalStaff"`
	ShiftCount       int                      `json:"shiftCount"`
	ActivePlans      int                      `json:"activePlans"`
	ApprovedPlans    int                      `json:"approvedPlans"`
	PendingPlans     int                      `json:"pendingPlans"`
	TodayAssignments int                      `json:"todayAssignments"`
	ShiftBreakdown   []shiftCoverageResponse  `json:"shiftBreakdown"`
}

type shiftCoverageResponse struct {
	ShiftID   string `json:"shiftId"`
	ShiftName string `json:"shiftName"`
	Assigned  int    `json:"assigned"`
}

func (s *server) handleRosterDashboardStats(w http.ResponseWriter, r *http.Request) {
	today := time.Now().Format("2006-01-02")

	allStaff, _ := s.store.ListStaff(r.Context())
	totalStaff := len(allStaff)

	shifts, _ := s.store.ListStaffShifts(r.Context())
	shiftCount := len(shifts)

	plans, _ := s.store.ListRosterPlans(r.Context(), store.ListRosterPlansParams{Limit: 1000})
	activePlans, approvedPlans, pendingPlans := 0, 0, 0
	for _, p := range plans {
		switch p.Status {
		case "draft", "submitted":
			activePlans++
		case "approved":
			approvedPlans++
		}
		if p.Status == "submitted" {
			pendingPlans++
		}
	}

	todayRosters, _ := s.store.ListRoster(r.Context(), store.ListRosterParams{Date: today, Limit: 500})
	todayAssignments := len(todayRosters)

	shiftMap := make(map[string]string)
	for _, sh := range shifts {
		shiftMap[sh.ID] = sh.Name
	}
	breakdownMap := make(map[string]int)
	for _, ro := range todayRosters {
		breakdownMap[ro.ShiftID]++
	}
	shiftBreakdown := make([]shiftCoverageResponse, 0, len(shifts))
	for _, sh := range shifts {
		shiftBreakdown = append(shiftBreakdown, shiftCoverageResponse{
			ShiftID:   sh.ID,
			ShiftName: sh.Name,
			Assigned:  breakdownMap[sh.ID],
		})
	}

	writeJSON(w, http.StatusOK, rosterStatsResponse{
		TotalStaff:       totalStaff,
		ShiftCount:       shiftCount,
		ActivePlans:      activePlans,
		ApprovedPlans:    approvedPlans,
		PendingPlans:     pendingPlans,
		TodayAssignments: todayAssignments,
		ShiftBreakdown:   shiftBreakdown,
	})
}

// ───────────────────────────────────────────────────────────────────────────
// Roster Calendar
// ───────────────────────────────────────────────────────────────────────────

type calendarEventResponse struct {
	ID         string `json:"id"`
	StaffID    string `json:"staffId"`
	StaffName  string `json:"staffName"`
	EmployeeNo string `json:"employeeNo,omitempty"`
	ShiftID    string `json:"shiftId"`
	ShiftName  string `json:"shiftName"`
	ShiftCode  string `json:"shiftCode"`
	WorkDate   string `json:"workDate"`
	Color      string `json:"color"`
}

func (s *server) handleRosterCalendarView(w http.ResponseWriter, r *http.Request) {
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	if from == "" {
		from = time.Now().AddDate(0, -1, 0).Format("2006-01-02")
	}
	if to == "" {
		to = time.Now().AddDate(0, 1, 0).Format("2006-01-02")
	}

	entries := []domain.StaffRoster{}
	t, _ := time.Parse("2006-01-02", from)
	te, _ := time.Parse("2006-01-02", to)
	for !t.After(te) {
		recs, _ := s.store.ListRoster(r.Context(), store.ListRosterParams{
			Date:  t.Format("2006-01-02"),
			Limit: 500,
		})
		entries = append(entries, recs...)
		t = t.AddDate(0, 0, 1)
	}

	colors := map[string]string{
		"Morning": "#22c55e", "morning": "#22c55e",
		"Afternoon": "#3b82f6", "afternoon": "#3b82f6",
		"Evening": "#f59e0b", "evening": "#f59e0b",
		"Night": "#8b5cf6", "night": "#8b5cf6",
	}

	out := make([]calendarEventResponse, 0, len(entries))
	for i := range entries {
		e := &entries[i]
		color := colors[e.ShiftName]
		if color == "" {
			color = "#6b7280"
		}
		out = append(out, calendarEventResponse{
			ID:         e.ID,
			StaffID:    e.StaffID,
			StaffName:  e.StaffName,
			EmployeeNo: e.EmployeeNo,
			ShiftID:    e.ShiftID,
			ShiftName:  e.ShiftName,
			ShiftCode:  e.ShiftCode,
			WorkDate:   e.WorkDate,
			Color:      color,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

// ───────────────────────────────────────────────────────────────────────────
// Validate & Publish (Super Admin only)
// ───────────────────────────────────────────────────────────────────────────

func (s *server) handleValidateAndPublish(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	id := r.PathValue("id")

	// Only super_admin can validate & publish
	roles, err := s.store.GetUserRoles(r.Context(), actor.ID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	isSuper := false
	for _, rl := range roles {
		if rl.Code == "super_admin" {
			isSuper = true
			break
		}
	}
	if !isSuper {
		writeError(w, r, http.StatusForbidden, "forbidden", "only super admin can validate and publish rosters")
		return
	}

	// Get the plan — must be approved
	plan, err := s.store.GetRosterPlan(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "roster plan not found")
		return
	}
	if plan.Status != "approved" {
		writeError(w, r, http.StatusConflict, "invalid_transition", "plan must be approved before publishing")
		return
	}

	// Mark as published
	dbErr := s.store.PublishRosterPlan(r.Context(), id, actor.ID)
	if dbErr != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "could not publish roster")
		return
	}

	s.recordAudit(r, domain.ActionRosterApprove, "roster_plan", id, nil, map[string]any{"action": "validate_publish"})
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "approved", "published": true})
}

// ───────────────────────────────────────────────────────────────────────────
// Roster Export (CSV)
// ───────────────────────────────────────────────────────────────────────────

func (s *server) handleRosterExportCSV(w http.ResponseWriter, r *http.Request) {
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	if from == "" {
		from = time.Now().Format("2006-01-02")
	}
	if to == "" {
		to = time.Now().AddDate(0, 0, 30).Format("2006-01-02")
	}

	entries := []domain.StaffRoster{}
	t, _ := time.Parse("2006-01-02", from)
	te, _ := time.Parse("2006-01-02", to)
	for !t.After(te) {
		recs, _ := s.store.ListRoster(r.Context(), store.ListRosterParams{
			Date:  t.Format("2006-01-02"),
			Limit: 500,
		})
		entries = append(entries, recs...)
		t = t.AddDate(0, 0, 1)
	}

	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="roster_%s_to_%s.csv"`, from, to))
	writer := csv.NewWriter(w)
	writer.Write([]string{"Staff", "Employee No", "Shift", "Shift Code", "Work Date"})
	for _, e := range entries {
		writer.Write([]string{e.StaffName, e.EmployeeNo, e.ShiftName, e.ShiftCode, e.WorkDate})
	}
	writer.Flush()
}

// ───────────────────────────────────────────────────────────────────────────
// My Assigned Shift (for attendance Clock In/Out integration)
// ───────────────────────────────────────────────────────────────────────────

func (s *server) handleMyAssignedShift(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	staff, err := s.store.GetStaffByUserID(r.Context(), actor.ID)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "staff profile not found")
		return
	}
	today := time.Now().Format("2006-01-02")

	// Find today's assignment from published roster plans
	assignment, err := s.store.GetAssignedShiftForToday(r.Context(), staff.ID, today)
	if err != nil || assignment == nil {
		writeJSON(w, http.StatusOK, map[string]any{})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"shiftId":   assignment.ShiftID,
		"code":      assignment.ShiftCode,
		"name":      assignment.ShiftName,
		"startTime": assignment.StartTime,
		"endTime":   assignment.EndTime,
		"isNight":   assignment.IsNight,
	})
}

// ───────────────────────────────────────────────────────────────────────────
// Staff Availability (shift preferences + unavailability)
// ───────────────────────────────────────────────────────────────────────────

type availabilityItemResponse struct {
	StaffID    string                       `json:"staffId"`
	StaffName  string                       `json:"staffName,omitempty"`
	EmployeeNo string                       `json:"employeeNo,omitempty"`
	ShiftPrefs []rosterShiftPrefResponse    `json:"shiftPreferences"`
	Unavail    []unavailabilityResponse     `json:"unavailability"`
}

type rosterShiftPrefResponse struct {
	ShiftID   string `json:"shiftId"`
	ShiftName string `json:"shiftName,omitempty"`
	Rank      int    `json:"rank"`
}

func (s *server) handleListStaffAvailability(w http.ResponseWriter, r *http.Request) {
	allStaff, err := s.store.ListStaff(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "could not list staff")
		return
	}

	shifts, _ := s.store.ListStaffShifts(r.Context())
	shiftMap := make(map[string]string)
	for _, sh := range shifts {
		shiftMap[sh.ID] = sh.Name
	}

	out := make([]availabilityItemResponse, 0, len(allStaff))
	for _, st := range allStaff {
		prefs, _ := s.store.ListShiftPreferences(r.Context(), st.ID)
		prefResp := make([]rosterShiftPrefResponse, 0, len(prefs))
		for _, p := range prefs {
			prefResp = append(prefResp, rosterShiftPrefResponse{
				ShiftID:   p.ShiftID,
				ShiftName: shiftMap[p.ShiftID],
				Rank:      p.Rank,
			})
		}
		unavail, _ := s.store.ListUnavailability(r.Context(), store.ListUnavailabilityParams{StaffID: st.ID, Limit: 100})
		unavailResp := make([]unavailabilityResponse, 0, len(unavail))
		for _, u := range unavail {
			unavailResp = append(unavailResp, unavailabilityResponse{
				ID:       u.ID,
				StaffID:  u.StaffID,
				WorkDate: u.WorkDate,
				Reason:   u.Reason,
			})
		}
		out = append(out, availabilityItemResponse{
			StaffID:    st.ID,
			StaffName:  st.FirstName + " " + st.LastName,
			EmployeeNo: st.EmployeeNo,
			ShiftPrefs: prefResp,
			Unavail:    unavailResp,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

type setAvailabilityRequest struct {
	ShiftPreferences []struct {
		ShiftID string `json:"shiftId"`
		Rank    int    `json:"rank"`
	} `json:"shiftPreferences"`
	Unavailability []struct {
		WorkDate string `json:"workDate"`
		Reason   string `json:"reason"`
	} `json:"unavailability"`
}

func (s *server) handleSetStaffAvailability(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	var req setAvailabilityRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}

	targetID := actor.ID
	if r.URL.Query().Get("staffId") != "" {
		roles, _ := s.store.GetUserRoles(r.Context(), actor.ID)
		for _, rl := range roles {
			if rl.Code == "super_admin" || rl.Code == "admin" || rl.Code == "matron" {
				targetID = r.URL.Query().Get("staffId")
				break
			}
		}
	}

	if req.ShiftPreferences != nil {
		prefs := make([]store.ShiftPreferenceInput, 0, len(req.ShiftPreferences))
		for _, p := range req.ShiftPreferences {
			prefs = append(prefs, store.ShiftPreferenceInput{ShiftID: p.ShiftID, Rank: p.Rank})
		}
		_ = s.store.ReplaceShiftPreferences(r.Context(), targetID, prefs)
	}

	for _, u := range req.Unavailability {
		_, _ = s.store.MarkUnavailable(r.Context(), targetID, u.WorkDate, u.Reason, actor.ID)
	}

	w.WriteHeader(http.StatusNoContent)
}
