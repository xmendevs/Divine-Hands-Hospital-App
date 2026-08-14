package httpapi

import (
	"errors"
	"net/http"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

type handoverResponse struct {
	ID                    string   `json:"id"`
	HandoverNo            string   `json:"handoverNo"`
	OutgoingStaffID       string   `json:"outgoingStaffId"`
	OutgoingStaffName     string   `json:"outgoingStaffName,omitempty"`
	DepartmentID          *string  `json:"departmentId,omitempty"`
	DepartmentName        string   `json:"departmentName,omitempty"`
	ShiftID               *string  `json:"shiftId,omitempty"`
	ShiftName             string   `json:"shiftName,omitempty"`
	PatientIDs            []string `json:"patientIds,omitempty"`
	CurrentCondition      string   `json:"currentCondition,omitempty"`
	Medications           string   `json:"medications,omitempty"`
	PendingInvestigations string   `json:"pendingInvestigations,omitempty"`
	PendingOrders         string   `json:"pendingOrders,omitempty"`
	ImportantObservations string   `json:"importantObservations,omitempty"`
	Tasks                 string   `json:"tasks,omitempty"`
	Incidents             string   `json:"incidents,omitempty"`
	Instructions          string   `json:"instructions,omitempty"`
	Status                string   `json:"status"`
	AcknowledgedBy        *string  `json:"acknowledgedBy,omitempty"`
	AcknowledgedByName    string   `json:"acknowledgedByName,omitempty"`
	AcknowledgedAt        *string  `json:"acknowledgedAt,omitempty"`
	CreatedAt             string   `json:"createdAt"`
	UpdatedAt             string   `json:"updatedAt"`
}

func newHandoverResponse(h *domain.HandoverNote) handoverResponse {
	out := handoverResponse{
		ID:                    h.ID,
		HandoverNo:            h.HandoverNo,
		OutgoingStaffID:       h.OutgoingStaffID,
		OutgoingStaffName:     h.OutgoingStaffName,
		DepartmentID:          h.DepartmentID,
		DepartmentName:        h.DepartmentName,
		ShiftID:               h.ShiftID,
		ShiftName:             h.ShiftName,
		PatientIDs:            h.PatientIDs,
		CurrentCondition:      h.CurrentCondition,
		Medications:           h.Medications,
		PendingInvestigations: h.PendingInvestigations,
		PendingOrders:         h.PendingOrders,
		ImportantObservations: h.ImportantObservations,
		Tasks:                 h.Tasks,
		Incidents:             h.Incidents,
		Instructions:          h.Instructions,
		Status:                h.Status,
		AcknowledgedBy:        h.AcknowledgedBy,
		AcknowledgedByName:    h.AcknowledgedByName,
		CreatedAt:             h.CreatedAt.UTC().Format(timeRFC3339),
		UpdatedAt:             h.UpdatedAt.UTC().Format(timeRFC3339),
	}
	if h.AcknowledgedAt != nil {
		v := h.AcknowledgedAt.UTC().Format(timeRFC3339)
		out.AcknowledgedAt = &v
	}
	return out
}

type createHandoverRequest struct {
	DepartmentID          string   `json:"departmentId"`
	ShiftID               string   `json:"shiftId"`
	PatientIDs            []string `json:"patientIds"`
	CurrentCondition      string   `json:"currentCondition"`
	Medications           string   `json:"medications"`
	PendingInvestigations string   `json:"pendingInvestigations"`
	PendingOrders         string   `json:"pendingOrders"`
	ImportantObservations string   `json:"importantObservations"`
	Tasks                 string   `json:"tasks"`
	Incidents             string   `json:"incidents"`
	Instructions          string   `json:"instructions"`
}

// handleCreateHandover stores a handover note authored by the outgoing nurse.
func (s *server) handleCreateHandover(w http.ResponseWriter, r *http.Request) {
	var req createHandoverRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	actor := userFromContext(r.Context())
	staff, err := s.store.GetStaffByUserID(r.Context(), actor.ID)
	if err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "staff profile not found")
		return
	}
	var deptID, shiftID *string
	if req.DepartmentID != "" {
		deptID = &req.DepartmentID
	}
	if req.ShiftID != "" {
		shiftID = &req.ShiftID
	}
	h, err := s.store.CreateHandover(r.Context(), store.CreateHandoverParams{
		OutgoingStaffID:       staff.ID,
		DepartmentID:          deptID,
		ShiftID:               shiftID,
		PatientIDs:            req.PatientIDs,
		CurrentCondition:      req.CurrentCondition,
		Medications:           req.Medications,
		PendingInvestigations: req.PendingInvestigations,
		PendingOrders:         req.PendingOrders,
		ImportantObservations: req.ImportantObservations,
		Tasks:                 req.Tasks,
		Incidents:             req.Incidents,
		Instructions:          req.Instructions,
		CreatedBy:             actor.ID,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionHandoverCreate, "handover", h.ID, nil, map[string]any{
		"handoverNo": h.HandoverNo, "patients": h.PatientIDs,
	})
	writeJSON(w, http.StatusCreated, newHandoverResponse(h))
}

// handleListHandovers lists handover notes.
func (s *server) handleListHandovers(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)
	notes, err := s.store.ListHandovers(r.Context(), store.ListHandoverParams{
		Status:     r.URL.Query().Get("status"),
		Department: r.URL.Query().Get("departmentId"),
		Staff:      r.URL.Query().Get("staffId"),
		Limit:      limit,
		Offset:     offset,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]handoverResponse, 0, len(notes))
	for i := range notes {
		out = append(out, newHandoverResponse(&notes[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

// handleGetHandover returns one handover note.
func (s *server) handleGetHandover(w http.ResponseWriter, r *http.Request) {
	h, err := s.store.GetHandover(r.Context(), r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "handover not found")
		return
	}
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, newHandoverResponse(h))
}

// handleAcknowledgeHandover marks a handover as received by the incoming nurse.
func (s *server) handleAcknowledgeHandover(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	id := r.PathValue("id")
	h, err := s.store.AcknowledgeHandover(r.Context(), id, actor.ID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "handover not found")
			return
		}
		if errors.Is(err, store.ErrSelfAcknowledgement) {
			writeError(w, r, http.StatusUnprocessableEntity, "self_acknowledgement", "cannot acknowledge your own handover")
			return
		}
		if errors.Is(err, store.ErrHandoverNotPending) {
			writeError(w, r, http.StatusConflict, "invalid_transition", "handover is not pending acknowledgement")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionHandoverAcknowledge, "handover", id, nil, map[string]any{"handoverNo": h.HandoverNo})
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": domain.HandoverStatusAcknowledged})
}
