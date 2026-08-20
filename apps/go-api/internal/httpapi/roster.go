package httpapi

import (
	"errors"
	"net/http"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

type rosterAssignmentResponse struct {
	ID         string `json:"id"`
	StaffID    string `json:"staffId"`
	StaffName  string `json:"staffName,omitempty"`
	EmployeeNo string `json:"employeeNo,omitempty"`
	ShiftID    string `json:"shiftId"`
	ShiftName  string `json:"shiftName,omitempty"`
	ShiftCode  string `json:"shiftCode,omitempty"`
	WorkDate   string `json:"workDate"`
}

func newRosterAssignmentResponse(a *domain.RosterAssignment) rosterAssignmentResponse {
	return rosterAssignmentResponse{
		ID:         a.ID,
		StaffID:    a.StaffID,
		StaffName:  a.StaffName,
		EmployeeNo: a.EmployeeNo,
		ShiftID:    a.ShiftID,
		ShiftName:  a.ShiftName,
		ShiftCode:  a.ShiftCode,
		WorkDate:   a.WorkDate,
	}
}

type rosterPlanResponse struct {
	ID                   string                          `json:"id"`
	PlanNo               string                          `json:"planNo"`
	Name                 string                          `json:"name"`
	DepartmentID         string                          `json:"departmentId"`
	DepartmentName       string                          `json:"departmentName,omitempty"`
	StartDate            string                          `json:"startDate"`
	EndDate              string                          `json:"endDate"`
	MaxHoursPerWeek      float64                         `json:"maxHoursPerWeek"`
	MaxConsecutiveShifts int                             `json:"maxConsecutiveShifts"`
	MinRestHours         float64                         `json:"minRestHours"`
	MaxConsecutiveNights int                             `json:"maxConsecutiveNights"`
	ShiftRequirements    []domain.RosterShiftRequirement `json:"shiftRequirements"`
	Status               string                          `json:"status"`
	Version              int                             `json:"version"`
	AmendedFrom          *string                         `json:"amendedFrom,omitempty"`
	SubmittedBy          *string                         `json:"submittedBy,omitempty"`
	SubmittedAt          *string                         `json:"submittedAt,omitempty"`
	ApprovedBy           *string                         `json:"approvedBy,omitempty"`
	ApprovedAt           *string                         `json:"approvedAt,omitempty"`
	RejectedReason       string                          `json:"rejectedReason,omitempty"`
	IsPublished          bool                            `json:"isPublished"`
	CreatedAt            string                          `json:"createdAt"`
	UpdatedAt            string                          `json:"updatedAt"`
	Assignments          []rosterAssignmentResponse      `json:"assignments,omitempty"`
	Unmet                []domain.UnmetRequirement       `json:"unmet,omitempty"`
}

func newRosterPlanResponse(p *domain.RosterPlan) rosterPlanResponse {
	out := rosterPlanResponse{
		ID:                   p.ID,
		PlanNo:               p.PlanNo,
		Name:                 p.Name,
		DepartmentID:         p.DepartmentID,
		DepartmentName:       p.DepartmentName,
		StartDate:            p.StartDate,
		EndDate:              p.EndDate,
		MaxHoursPerWeek:      p.MaxHoursPerWeek,
		MaxConsecutiveShifts: p.MaxConsecutiveShifts,
		MinRestHours:         p.MinRestHours,
		MaxConsecutiveNights: p.MaxConsecutiveNights,
		ShiftRequirements:    p.ShiftRequirements,
		Status:               p.Status,
		Version:              p.Version,
		AmendedFrom:          p.AmendedFrom,
		SubmittedBy:          p.SubmittedBy,
		ApprovedBy:           p.ApprovedBy,
		RejectedReason:       p.RejectedReason,
		IsPublished:          p.IsPublished,
		CreatedAt:            p.CreatedAt.UTC().Format(timeRFC3339),
		UpdatedAt:            p.UpdatedAt.UTC().Format(timeRFC3339),
	}
	if p.SubmittedAt != nil {
		v := p.SubmittedAt.UTC().Format(timeRFC3339)
		out.SubmittedAt = &v
	}
	if p.ApprovedAt != nil {
		v := p.ApprovedAt.UTC().Format(timeRFC3339)
		out.ApprovedAt = &v
	}
	out.Assignments = make([]rosterAssignmentResponse, 0, len(p.Assignments))
	for i := range p.Assignments {
		out.Assignments = append(out.Assignments, newRosterAssignmentResponse(&p.Assignments[i]))
	}
	out.Unmet = p.Unmet
	if out.Unmet == nil {
		out.Unmet = []domain.UnmetRequirement{}
	}
	return out
}

type createRosterPlanRequest struct {
	Name                 string                          `json:"name"`
	DepartmentID         string                          `json:"departmentId"`
	StartDate            string                          `json:"startDate"`
	EndDate              string                          `json:"endDate"`
	MaxHoursPerWeek      float64                         `json:"maxHoursPerWeek"`
	MaxConsecutiveShifts int                             `json:"maxConsecutiveShifts"`
	MinRestHours         float64                         `json:"minRestHours"`
	MaxConsecutiveNights int                             `json:"maxConsecutiveNights"`
	ShiftRequirements    []domain.RosterShiftRequirement `json:"shiftRequirements"`
}

// handleCreateRosterPlan creates a draft plan and generates its roster.
func (s *server) handleCreateRosterPlan(w http.ResponseWriter, r *http.Request) {
	var req createRosterPlanRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Name == "" || req.DepartmentID == "" || req.StartDate == "" || req.EndDate == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "name, departmentId, startDate and endDate are required")
		return
	}
	if len(req.ShiftRequirements) == 0 {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "at least one shift requirement is required")
		return
	}
	if req.MaxHoursPerWeek <= 0 {
		req.MaxHoursPerWeek = 40
	}
	if req.MaxConsecutiveShifts <= 0 {
		req.MaxConsecutiveShifts = 6
	}
	if req.MinRestHours <= 0 {
		req.MinRestHours = 11
	}
	if req.MaxConsecutiveNights <= 0 {
		req.MaxConsecutiveNights = 3
	}
	actor := userFromContext(r.Context())
	p, err := s.store.CreateRosterPlan(r.Context(), store.CreateRosterPlanParams{
		Name:                 req.Name,
		DepartmentID:         req.DepartmentID,
		StartDate:            req.StartDate,
		EndDate:              req.EndDate,
		MaxHoursPerWeek:      req.MaxHoursPerWeek,
		MaxConsecutiveShifts: req.MaxConsecutiveShifts,
		MinRestHours:         req.MinRestHours,
		MaxConsecutiveNights: req.MaxConsecutiveNights,
		ShiftRequirements:    req.ShiftRequirements,
		CreatedBy:            actor.ID,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionRosterPlanCreate, "roster_plan", p.ID, nil, map[string]any{"planNo": p.PlanNo})
	// Auto-generate assignments after plan creation.
	if genErr := s.store.RegenerateRoster(r.Context(), p.ID); genErr == nil {
		s.recordAudit(r, domain.ActionRosterGenerate, "roster_plan", p.ID, nil, map[string]any{"version": p.Version})
		// Reload plan with assignments.
		p2, _ := s.store.GetRosterPlan(r.Context(), p.ID)
		if p2 != nil {
			p = p2
		}
	}
	writeJSON(w, http.StatusCreated, newRosterPlanResponse(p))
}

// handleListRosterPlans lists plans.
func (s *server) handleListRosterPlans(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)
	plans, err := s.store.ListRosterPlans(r.Context(), store.ListRosterPlansParams{
		Status:     r.URL.Query().Get("status"),
		Department: r.URL.Query().Get("departmentId"),
		Limit:      limit,
		Offset:     offset,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]rosterPlanResponse, 0, len(plans))
	for i := range plans {
		out = append(out, newRosterPlanResponse(&plans[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

// handleGetRosterPlan returns one plan with assignments and unmet requirements.
func (s *server) handleGetRosterPlan(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.GetRosterPlan(r.Context(), r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "roster plan not found")
		return
	}
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, newRosterPlanResponse(p))
}

// handleRegenerateRoster regenerates a draft plan's assignments.
func (s *server) handleRegenerateRoster(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.store.RegenerateRoster(r.Context(), id); err != nil {
		s.writeRosterError(w, r, err)
		return
	}
	s.recordAudit(r, domain.ActionRosterGenerate, "roster_plan", id, nil, nil)
	s.respondRoster(w, r, id)
}

type upsertRosterAssignmentRequest struct {
	StaffID  string `json:"staffId"`
	ShiftID  string `json:"shiftId"`
	WorkDate string `json:"workDate"`
}

// handleUpsertRosterAssignment adds or moves a single assignment (draft only).
func (s *server) handleUpsertRosterAssignment(w http.ResponseWriter, r *http.Request) {
	var req upsertRosterAssignmentRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.StaffID == "" || req.ShiftID == "" || req.WorkDate == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "staffId, shiftId and workDate are required")
		return
	}
	actor := userFromContext(r.Context())
	id := r.PathValue("id")
	a, err := s.store.UpsertRosterAssignment(r.Context(), id, req.StaffID, req.ShiftID, req.WorkDate, actor.ID)
	if err != nil {
		s.writeRosterError(w, r, err)
		return
	}
	s.recordAudit(r, domain.ActionRosterAssignmentAdd, "roster_plan", id, nil, map[string]any{
		"staffId": a.StaffID, "shiftId": a.ShiftID, "workDate": a.WorkDate,
	})
	writeJSON(w, http.StatusCreated, newRosterAssignmentResponse(a))
}

// handleDeleteRosterAssignment removes a single assignment (draft only).
func (s *server) handleDeleteRosterAssignment(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	assignmentID := r.PathValue("assignmentId")
	if err := s.store.DeleteRosterAssignment(r.Context(), id, assignmentID); err != nil {
		s.writeRosterError(w, r, err)
		return
	}
	s.recordAudit(r, domain.ActionRosterAssignmentRemove, "roster_plan", id, nil, map[string]any{"assignmentId": assignmentID})
	w.WriteHeader(http.StatusNoContent)
}

// handleSubmitRoster submits a draft plan for approval.
func (s *server) handleSubmitRoster(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	id := r.PathValue("id")
	if err := s.store.SubmitRoster(r.Context(), id, actor.ID); err != nil {
		s.writeRosterError(w, r, err)
		return
	}
	s.recordAudit(r, domain.ActionRosterSubmit, "roster_plan", id, nil, nil)
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": domain.RosterStatusSubmitted})
}

// handleApproveRoster approves a submitted plan (super admin).
func (s *server) handleApproveRoster(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	id := r.PathValue("id")
	if err := s.store.ApproveRoster(r.Context(), id, actor.ID); err != nil {
		s.writeRosterError(w, r, err)
		return
	}
	s.recordAudit(r, domain.ActionRosterApprove, "roster_plan", id, nil, nil)
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": domain.RosterStatusApproved})
}

type rejectRosterRequest struct {
	Reason string `json:"reason"`
}

// handleRejectRoster rejects a submitted plan (super admin).
func (s *server) handleRejectRoster(w http.ResponseWriter, r *http.Request) {
	var req rejectRosterRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Reason == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "reason is required")
		return
	}
	actor := userFromContext(r.Context())
	id := r.PathValue("id")
	if err := s.store.RejectRoster(r.Context(), id, actor.ID, req.Reason); err != nil {
		s.writeRosterError(w, r, err)
		return
	}
	s.recordAudit(r, domain.ActionRosterReject, "roster_plan", id, nil, map[string]any{"reason": req.Reason})
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": domain.RosterStatusRejected})
}

// handleAmendRoster creates a new draft plan from an approved plan.
func (s *server) handleAmendRoster(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	id := r.PathValue("id")
	p, err := s.store.AmendRoster(r.Context(), id, actor.ID)
	if err != nil {
		s.writeRosterError(w, r, err)
		return
	}
	s.recordAudit(r, domain.ActionRosterAmend, "roster_plan", p.ID, nil, map[string]any{"amendedFrom": id})
	writeJSON(w, http.StatusCreated, newRosterPlanResponse(p))
}

func (s *server) respondRoster(w http.ResponseWriter, r *http.Request, id string) {
	p, err := s.store.GetRosterPlan(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, newRosterPlanResponse(p))
}

func (s *server) writeRosterError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, r, http.StatusNotFound, "not_found", "roster plan not found")
	case errors.Is(err, store.ErrRosterNotDraft):
		writeError(w, r, http.StatusConflict, "invalid_transition", "roster is not editable in this state")
	case errors.Is(err, store.ErrRosterNotSubmitted):
		writeError(w, r, http.StatusConflict, "invalid_transition", "roster is not in a state that allows this action")
	default:
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
	}
}
