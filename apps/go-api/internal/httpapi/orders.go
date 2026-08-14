package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

func validOrderType(s string) bool {
	switch s {
	case domain.OrderTypePrescription, domain.OrderTypeLabRequest, domain.OrderTypeNursingOrder, domain.OrderTypeReferral:
		return true
	}
	return false
}

type orderResponse struct {
	ID             string         `json:"id"`
	OrderNo        string         `json:"orderNo"`
	PatientID      string         `json:"patientId"`
	OrderType      string         `json:"orderType"`
	Status         string         `json:"status"`
	DepartmentID   *string        `json:"departmentId,omitempty"`
	OrderedBy      string         `json:"orderedBy"`
	Details        map[string]any `json:"details"`
	ClinicalNoteID *string        `json:"clinicalNoteId,omitempty"`
	ActedBy        *string        `json:"actedBy,omitempty"`
	CancelledBy    *string        `json:"cancelledBy,omitempty"`
	CancelReason   string         `json:"cancelReason,omitempty"`
	CreatedAt      string         `json:"createdAt"`
	SubmittedAt    string         `json:"submittedAt,omitempty"`
	AcceptedAt     string         `json:"acceptedAt,omitempty"`
	CompletedAt    string         `json:"completedAt,omitempty"`
	CancelledAt    string         `json:"cancelledAt,omitempty"`
	UpdatedAt      string         `json:"updatedAt"`
}

func newOrderResponse(o *domain.Order) orderResponse {
	resp := orderResponse{
		ID:             o.ID,
		OrderNo:        o.OrderNo,
		PatientID:      o.PatientID,
		OrderType:      o.OrderType,
		Status:         o.Status,
		DepartmentID:   o.DepartmentID,
		OrderedBy:      o.OrderedBy,
		Details:        jsonObject(o.Details),
		ClinicalNoteID: o.ClinicalNoteID,
		ActedBy:        o.ActedBy,
		CancelledBy:    o.CancelledBy,
		CancelReason:   o.CancelReason,
		CreatedAt:      o.CreatedAt.UTC().Format(timeRFC3339),
		UpdatedAt:      o.UpdatedAt.UTC().Format(timeRFC3339),
	}
	if o.SubmittedAt != nil {
		resp.SubmittedAt = o.SubmittedAt.UTC().Format(timeRFC3339)
	}
	if o.AcceptedAt != nil {
		resp.AcceptedAt = o.AcceptedAt.UTC().Format(timeRFC3339)
	}
	if o.CompletedAt != nil {
		resp.CompletedAt = o.CompletedAt.UTC().Format(timeRFC3339)
	}
	if o.CancelledAt != nil {
		resp.CancelledAt = o.CancelledAt.UTC().Format(timeRFC3339)
	}
	return resp
}

type createOrderRequest struct {
	OrderType    string         `json:"orderType"`
	DepartmentID string         `json:"departmentId"`
	Details      map[string]any `json:"details"`
	NoteID       string         `json:"noteId"`
	Submit       bool           `json:"submit"`
}

// handleCreateOrder creates a doctor order (draft or submitted).
func (s *server) handleCreateOrder(w http.ResponseWriter, r *http.Request) {
	patientID := r.PathValue("id")
	var req createOrderRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if !validOrderType(req.OrderType) {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid orderType")
		return
	}
	actor := userFromContext(r.Context())
	var deptID *string
	if req.DepartmentID != "" {
		deptID = &req.DepartmentID
	}
	var noteID *string
	if req.NoteID != "" {
		noteID = &req.NoteID
	}

	order, err := s.store.CreateOrder(r.Context(), store.CreateOrderParams{
		PatientID:      patientID,
		OrderType:      req.OrderType,
		DepartmentID:   deptID,
		OrderedBy:      actor.ID,
		Details:        req.Details,
		ClinicalNoteID: noteID,
		Submit:         req.Submit,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionOrderCreate, "order", order.ID, nil, map[string]any{
		"orderNo": order.OrderNo, "orderType": order.OrderType, "status": order.Status,
	})
	writeJSON(w, http.StatusCreated, newOrderResponse(order))
}

// handleListPatientOrders lists a patient's orders.
func (s *server) handleListPatientOrders(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	orders, err := s.store.ListPatientOrders(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]orderResponse, 0, len(orders))
	for i := range orders {
		out = append(out, newOrderResponse(&orders[i]))
	}
	s.recordAudit(r, domain.ActionOrdersViewed, "patient", id, nil, nil)
	writeJSON(w, http.StatusOK, out)
}

// handleListActionableOrders lists orders awaiting/under nursing action.
func (s *server) handleListActionableOrders(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)
	orders, err := s.store.ListActionableOrders(r.Context(), limit, offset)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]orderResponse, 0, len(orders))
	for i := range orders {
		out = append(out, newOrderResponse(&orders[i]))
	}
	s.recordAudit(r, domain.ActionOrdersViewed, "order", "", nil, nil)
	writeJSON(w, http.StatusOK, out)
}

// handleSubmitOrder submits a draft order (ordering doctor only).
func (s *server) handleSubmitOrder(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	order, err := s.store.GetOrder(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "order not found")
		return
	}
	actor := userFromContext(r.Context())
	if order.OrderedBy != actor.ID && !s.isSuperAdmin(r.Context(), actor.ID) {
		writeError(w, r, http.StatusForbidden, "forbidden", "only the ordering doctor can submit this order")
		return
	}
	if err := s.store.SubmitOrder(r.Context(), id, actor.ID); err != nil {
		if errors.Is(err, store.ErrInvalidTransition) {
			writeError(w, r, http.StatusConflict, "invalid_transition", "order cannot be submitted from its current status")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	_ = s.store.AppendTimelineEvent(r.Context(), order.PatientID, domain.EventOrderStatusChanged,
		"Order submitted: "+order.OrderNo, map[string]any{"orderNo": order.OrderNo, "status": domain.OrderStatusSubmitted}, &actor.ID)
	s.recordAudit(r, domain.ActionOrderSubmit, "order", id, nil, nil)
	w.WriteHeader(http.StatusNoContent)
}

type cancelOrderRequest struct {
	Reason string `json:"reason"`
}

// handleCancelOrder cancels a draft/submitted order (ordering doctor only).
func (s *server) handleCancelOrder(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req cancelOrderRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Reason == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "reason is required")
		return
	}
	order, err := s.store.GetOrder(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "order not found")
		return
	}
	actor := userFromContext(r.Context())
	if order.OrderedBy != actor.ID && !s.isSuperAdmin(r.Context(), actor.ID) {
		writeError(w, r, http.StatusForbidden, "forbidden", "only the ordering doctor can cancel this order")
		return
	}
	if err := s.store.CancelOrder(r.Context(), id, req.Reason, actor.ID); err != nil {
		if errors.Is(err, store.ErrInvalidTransition) {
			writeError(w, r, http.StatusConflict, "invalid_transition", "order cannot be cancelled from its current status")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	_ = s.store.AppendTimelineEvent(r.Context(), order.PatientID, domain.EventOrderStatusChanged,
		"Order cancelled: "+order.OrderNo, map[string]any{"orderNo": order.OrderNo, "status": domain.OrderStatusCancelled, "reason": req.Reason}, &actor.ID)
	s.recordAudit(r, domain.ActionOrderCancel, "order", id, nil, map[string]any{"reason": req.Reason})
	w.WriteHeader(http.StatusNoContent)
}

type transitionOrderRequest struct {
	Status string `json:"status"`
}

// handleTransitionOrder advances an order to accepted/in_progress/completed.
func (s *server) handleTransitionOrder(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req transitionOrderRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	switch req.Status {
	case domain.OrderStatusAccepted, domain.OrderStatusInProgress, domain.OrderStatusCompleted:
	default:
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "status must be accepted, in_progress, or completed")
		return
	}
	order, err := s.store.GetOrder(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "order not found")
		return
	}
	actor := userFromContext(r.Context())
	if err := s.store.TransitionOrder(r.Context(), id, req.Status, actor.ID); err != nil {
		if errors.Is(err, store.ErrInvalidTransition) {
			writeError(w, r, http.StatusConflict, "invalid_transition", "invalid order status transition")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	_ = s.store.AppendTimelineEvent(r.Context(), order.PatientID, domain.EventOrderStatusChanged,
		"Order "+req.Status+": "+order.OrderNo, map[string]any{"orderNo": order.OrderNo, "status": req.Status}, &actor.ID)
	s.recordAudit(r, domain.ActionOrderStatusChange, "order", id, nil, map[string]any{"status": req.Status})
	w.WriteHeader(http.StatusNoContent)
}

type addAdministrationRequest struct {
	OrderID    string `json:"orderId"`
	Medication string `json:"medication"`
	Dose       string `json:"dose"`
	Route      string `json:"route"`
	Notes      string `json:"notes"`
}

// handleAddAdministration records a nurse administration linked to a prescription.
func (s *server) handleAddAdministration(w http.ResponseWriter, r *http.Request) {
	patientID := r.PathValue("id")
	var req addAdministrationRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.OrderID == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "orderId is required")
		return
	}
	order, err := s.store.GetOrder(r.Context(), req.OrderID)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "order not found")
		return
	}
	if order.OrderType != domain.OrderTypePrescription {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "order is not a prescription")
		return
	}
	if order.Status == domain.OrderStatusCancelled {
		writeError(w, r, http.StatusConflict, "invalid_transition", "cannot administer a cancelled prescription")
		return
	}
	medication := req.Medication
	if medication == "" {
		medication, _ = jsonObject(order.Details)["medication"].(string)
	}

	actor := userFromContext(r.Context())
	adminID, err := s.store.AddAdministration(r.Context(), store.AddAdministrationParams{
		OrderID:        order.ID,
		PatientID:      patientID,
		Medication:     medication,
		Dose:           req.Dose,
		Route:          req.Route,
		AdministeredBy: actor.ID,
		AdministeredAt: time.Now(),
		Notes:          req.Notes,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	_ = s.store.AppendTimelineEvent(r.Context(), patientID, domain.EventMedicationAdministered,
		"Medication administered: "+medication, map[string]any{"orderNo": order.OrderNo, "medication": medication}, &actor.ID)
	s.recordAudit(r, domain.ActionAdministrationRecorded, "patient", patientID, nil, map[string]any{
		"orderNo": order.OrderNo, "medication": medication, "administrationId": adminID,
	})
	writeJSON(w, http.StatusCreated, map[string]string{"id": adminID})
}

type administrationResponse struct {
	ID             string `json:"id"`
	OrderID        string `json:"orderId"`
	Medication     string `json:"medication"`
	Dose           string `json:"dose"`
	Route          string `json:"route"`
	AdministeredBy string `json:"administeredBy"`
	AdministeredAt string `json:"administeredAt"`
	Notes          string `json:"notes,omitempty"`
}

// handleListAdministrations lists a patient's medication administration records.
func (s *server) handleListAdministrations(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	records, err := s.store.ListAdministrations(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]administrationResponse, 0, len(records))
	for _, a := range records {
		out = append(out, administrationResponse{
			ID:             a.ID,
			OrderID:        a.OrderID,
			Medication:     a.Medication,
			Dose:           a.Dose,
			Route:          a.Route,
			AdministeredBy: a.AdministeredBy,
			AdministeredAt: a.AdministeredAt.UTC().Format(timeRFC3339),
			Notes:          a.Notes,
		})
	}
	s.recordAudit(r, domain.ActionMARViewed, "patient", id, nil, nil)
	writeJSON(w, http.StatusOK, out)
}
