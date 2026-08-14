package httpapi

import (
	"errors"
	"net/http"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

type staffResponse struct {
	ID               string   `json:"id"`
	UserID           string   `json:"userId"`
	Username         string   `json:"username,omitempty"`
	DepartmentID     *string  `json:"departmentId,omitempty"`
	DepartmentName   string   `json:"departmentName,omitempty"`
	EmployeeNo       string   `json:"employeeNo"`
	FirstName        string   `json:"firstName"`
	LastName         string   `json:"lastName"`
	JobTitle         string   `json:"jobTitle,omitempty"`
	ContactPhone     string   `json:"contactPhone,omitempty"`
	ContactEmail     string   `json:"contactEmail,omitempty"`
	EmploymentStatus string   `json:"employmentStatus"`
	Availability     string   `json:"availability,omitempty"`
	Skills           []string `json:"skills,omitempty"`
	Certifications   []string `json:"certifications,omitempty"`
	HireDate         *string  `json:"hireDate,omitempty"`
	Roles            []string `json:"roles,omitempty"`
}

func newStaffResponse(st *domain.Staff) staffResponse {
	return staffResponse{
		ID:               st.ID,
		UserID:           st.UserID,
		Username:         st.Username,
		DepartmentID:     st.DepartmentID,
		DepartmentName:   st.DepartmentName,
		EmployeeNo:       st.EmployeeNo,
		FirstName:        st.FirstName,
		LastName:         st.LastName,
		JobTitle:         st.JobTitle,
		ContactPhone:     st.ContactPhone,
		ContactEmail:     st.ContactEmail,
		EmploymentStatus: st.EmploymentStatus,
		Availability:     st.Availability,
		Skills:           st.Skills,
		Certifications:   st.Certifications,
		HireDate:         st.HireDate,
	}
}

// handleListStaff lists staff profiles.
func (s *server) handleListStaff(w http.ResponseWriter, r *http.Request) {
	staff, err := s.store.ListStaff(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]staffResponse, 0, len(staff))
	for i := range staff {
		out = append(out, newStaffResponse(&staff[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

// handleGetStaff returns one staff profile with their roles.
func (s *server) handleGetStaff(w http.ResponseWriter, r *http.Request) {
	st, err := s.store.GetStaffByID(r.Context(), r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "staff not found")
		return
	}
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	resp := newStaffResponse(st)
	roles, _ := s.store.GetUserRoles(r.Context(), st.UserID)
	for _, rl := range roles {
		resp.Roles = append(resp.Roles, rl.Code)
	}
	writeJSON(w, http.StatusOK, resp)
}

type updateStaffRequest struct {
	DepartmentID     string   `json:"departmentId"`
	JobTitle         string   `json:"jobTitle"`
	ContactPhone     string   `json:"contactPhone"`
	ContactEmail     string   `json:"contactEmail"`
	EmploymentStatus string   `json:"employmentStatus"`
	Availability     string   `json:"availability"`
	Skills           []string `json:"skills"`
	Certifications   []string `json:"certifications"`
	HireDate         string   `json:"hireDate"`
}

// handleUpdateStaff updates a staff member's workforce fields.
func (s *server) handleUpdateStaff(w http.ResponseWriter, r *http.Request) {
	var req updateStaffRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	switch req.EmploymentStatus {
	case domain.StaffEmploymentActive, domain.StaffEmploymentOnLeave,
		domain.StaffEmploymentTerminated, domain.StaffEmploymentSuspended:
	default:
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "employmentStatus must be active, on_leave, terminated or suspended")
		return
	}
	id := r.PathValue("id")
	var deptID *string
	if req.DepartmentID != "" {
		deptID = &req.DepartmentID
	}
	var hireDate *string
	if req.HireDate != "" {
		hireDate = &req.HireDate
	}
	if err := s.store.UpdateStaffProfile(r.Context(), id, store.UpdateStaffProfileParams{
		DepartmentID:     deptID,
		JobTitle:         req.JobTitle,
		ContactPhone:     req.ContactPhone,
		ContactEmail:     req.ContactEmail,
		EmploymentStatus: req.EmploymentStatus,
		Availability:     req.Availability,
		Skills:           req.Skills,
		Certifications:   req.Certifications,
		HireDate:         hireDate,
	}); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "staff not found")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionStaffUpdate, "staff", id, nil, map[string]any{"employmentStatus": req.EmploymentStatus})
	writeJSON(w, http.StatusOK, map[string]any{"id": id})
}

// ---- staff leave ----

type staffLeaveResponse struct {
	ID          string  `json:"id"`
	StaffID     string  `json:"staffId"`
	StaffName   string  `json:"staffName,omitempty"`
	EmployeeNo  string  `json:"employeeNo,omitempty"`
	LeaveType   string  `json:"leaveType"`
	StartDate   string  `json:"startDate"`
	EndDate     string  `json:"endDate"`
	Reason      string  `json:"reason,omitempty"`
	Status      string  `json:"status"`
	RequestedBy string  `json:"requestedBy"`
	ApprovedBy  *string `json:"approvedBy,omitempty"`
	DecidedAt   *string `json:"decidedAt,omitempty"`
	CreatedAt   string  `json:"createdAt"`
	UpdatedAt   string  `json:"updatedAt"`
}

func newStaffLeaveResponse(lv *domain.StaffLeave) staffLeaveResponse {
	out := staffLeaveResponse{
		ID:          lv.ID,
		StaffID:     lv.StaffID,
		StaffName:   lv.StaffName,
		EmployeeNo:  lv.EmployeeNo,
		LeaveType:   lv.LeaveType,
		StartDate:   lv.StartDate,
		EndDate:     lv.EndDate,
		Reason:      lv.Reason,
		Status:      lv.Status,
		RequestedBy: lv.RequestedBy,
		ApprovedBy:  lv.ApprovedBy,
		CreatedAt:   lv.CreatedAt.UTC().Format(timeRFC3339),
		UpdatedAt:   lv.UpdatedAt.UTC().Format(timeRFC3339),
	}
	if lv.DecidedAt != nil {
		v := lv.DecidedAt.UTC().Format(timeRFC3339)
		out.DecidedAt = &v
	}
	return out
}

type requestLeaveRequest struct {
	StaffID   string `json:"staffId"`
	LeaveType string `json:"leaveType"`
	StartDate string `json:"startDate"`
	EndDate   string `json:"endDate"`
	Reason    string `json:"reason"`
}

// handleRequestLeave files a leave request for the caller (or, with
// staff.leave_manage, on behalf of another staff member).
func (s *server) handleRequestLeave(w http.ResponseWriter, r *http.Request) {
	var req requestLeaveRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.StartDate == "" || req.EndDate == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "startDate and endDate are required")
		return
	}
	actor := userFromContext(r.Context())
	staff, err := s.store.GetStaffByUserID(r.Context(), actor.ID)
	if err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "staff profile not found")
		return
	}
	if req.StaffID != "" && req.StaffID != staff.ID {
		ok, _ := s.store.UserHasPermission(r.Context(), actor.ID, "staff.leave_manage")
		if !ok {
			writeError(w, r, http.StatusForbidden, "forbidden", "insufficient permissions")
			return
		}
		staff.ID = req.StaffID
	}
	lv, err := s.store.CreateLeave(r.Context(), store.CreateLeaveParams{
		StaffID:     staff.ID,
		LeaveType:   req.LeaveType,
		StartDate:   req.StartDate,
		EndDate:     req.EndDate,
		Reason:      req.Reason,
		RequestedBy: actor.ID,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionLeaveRequest, "staff_leave", lv.ID, nil, map[string]any{
		"staffId": lv.StaffID, "startDate": lv.StartDate, "endDate": lv.EndDate,
	})
	writeJSON(w, http.StatusCreated, newStaffLeaveResponse(lv))
}

// handleListLeave lists leave requests. Managers see all; others only their own.
func (s *server) handleListLeave(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)
	actor := userFromContext(r.Context())
	staffID := r.URL.Query().Get("staffId")
	canManage, _ := s.store.UserHasPermission(r.Context(), actor.ID, "staff.leave_manage")
	if !canManage {
		st, err := s.store.GetStaffByUserID(r.Context(), actor.ID)
		if err != nil {
			writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "staff profile not found")
			return
		}
		staffID = st.ID
	}
	leave, err := s.store.ListLeave(r.Context(), store.ListLeaveParams{
		StaffID: staffID,
		Status:  r.URL.Query().Get("status"),
		Limit:   limit,
		Offset:  offset,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]staffLeaveResponse, 0, len(leave))
	for i := range leave {
		out = append(out, newStaffLeaveResponse(&leave[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

// handleApproveLeave approves a pending leave request.
func (s *server) handleApproveLeave(w http.ResponseWriter, r *http.Request) {
	s.decideLeave(w, r, domain.StaffLeaveStatusApproved, domain.ActionLeaveApprove)
}

// handleRejectLeave rejects a pending leave request.
func (s *server) handleRejectLeave(w http.ResponseWriter, r *http.Request) {
	s.decideLeave(w, r, domain.StaffLeaveStatusRejected, domain.ActionLeaveReject)
}

func (s *server) decideLeave(w http.ResponseWriter, r *http.Request, status, action string) {
	actor := userFromContext(r.Context())
	id := r.PathValue("id")
	if err := s.store.DecideLeave(r.Context(), id, status, actor.ID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "leave request not found")
			return
		}
		if errors.Is(err, store.ErrLeaveNotPending) {
			writeError(w, r, http.StatusConflict, "invalid_transition", "leave request is not pending")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, action, "staff_leave", id, nil, nil)
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": status})
}
