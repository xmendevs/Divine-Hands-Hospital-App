package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

// ---- test catalogue ----

type labTestResponse struct {
	ID                   string          `json:"id"`
	Code                 string          `json:"code"`
	Name                 string          `json:"name"`
	Category             string          `json:"category"`
	Price                float64         `json:"price"`
	SpecimenType         string          `json:"specimenType"`
	Container            string          `json:"container,omitempty"`
	TurnaroundMinutes    int             `json:"turnaroundMinutes"`
	Units                string          `json:"units,omitempty"`
	ReferenceRanges      json.RawMessage `json:"referenceRanges,omitempty"`
	VerificationRequired bool            `json:"verificationRequired"`
	Active               bool            `json:"active"`
	CreatedAt            string          `json:"createdAt"`
	UpdatedAt            string          `json:"updatedAt"`
}

func newLabTestResponse(t *domain.LabTest) labTestResponse {
	return labTestResponse{
		ID:                   t.ID,
		Code:                 t.Code,
		Name:                 t.Name,
		Category:             t.Category,
		Price:                t.Price,
		SpecimenType:         t.SpecimenType,
		Container:            t.Container,
		TurnaroundMinutes:    t.TurnaroundMinutes,
		Units:                t.Units,
		ReferenceRanges:      json.RawMessage(t.ReferenceRanges),
		VerificationRequired: t.VerificationRequired,
		Active:               t.Active,
		CreatedAt:            t.CreatedAt.UTC().Format(timeRFC3339),
		UpdatedAt:            t.UpdatedAt.UTC().Format(timeRFC3339),
	}
}

func (s *server) handleListLabTests(w http.ResponseWriter, r *http.Request) {
	tests, err := s.store.ListLabTests(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]labTestResponse, 0, len(tests))
	for _, t := range tests {
		out = append(out, newLabTestResponse(&t))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *server) handleGetLabTest(w http.ResponseWriter, r *http.Request) {
	t, err := s.store.GetLabTest(r.Context(), r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "test not found")
		return
	}
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, newLabTestResponse(t))
}

type createLabTestRequest struct {
	Code                 string          `json:"code"`
	Name                 string          `json:"name"`
	Category             string          `json:"category"`
	Price                float64         `json:"price"`
	SpecimenType         string          `json:"specimenType"`
	Container            string          `json:"container"`
	TurnaroundMinutes    int             `json:"turnaroundMinutes"`
	Units                string          `json:"units"`
	ReferenceRanges      json.RawMessage `json:"referenceRanges"`
	VerificationRequired bool            `json:"verificationRequired"`
}

func (s *server) handleCreateLabTest(w http.ResponseWriter, r *http.Request) {
	var req createLabTestRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Code == "" || req.Name == "" || req.Category == "" || req.SpecimenType == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "code, name, category and specimenType are required")
		return
	}
	t, err := s.store.CreateLabTest(r.Context(), store.CreateLabTestParams{
		Code:                 req.Code,
		Name:                 req.Name,
		Category:             req.Category,
		Price:                req.Price,
		SpecimenType:         req.SpecimenType,
		Container:            req.Container,
		TurnaroundMinutes:    req.TurnaroundMinutes,
		Units:                req.Units,
		ReferenceRanges:      req.ReferenceRanges,
		VerificationRequired: req.VerificationRequired,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionLabTestCreate, "lab_test", t.ID, nil, map[string]any{
		"code": t.Code, "name": t.Name, "category": t.Category,
	})
	writeJSON(w, http.StatusCreated, newLabTestResponse(t))
}

type updateLabTestRequest struct {
	Code                 string          `json:"code"`
	Name                 string          `json:"name"`
	Category             string          `json:"category"`
	Price                float64         `json:"price"`
	SpecimenType         string          `json:"specimenType"`
	Container            string          `json:"container"`
	TurnaroundMinutes    int             `json:"turnaroundMinutes"`
	Units                string          `json:"units"`
	ReferenceRanges      json.RawMessage `json:"referenceRanges"`
	VerificationRequired bool            `json:"verificationRequired"`
	Active               bool            `json:"active"`
}

func (s *server) handleUpdateLabTest(w http.ResponseWriter, r *http.Request) {
	var req updateLabTestRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Code == "" || req.Name == "" || req.Category == "" || req.SpecimenType == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "code, name, category and specimenType are required")
		return
	}
	id := r.PathValue("id")
	if err := s.store.UpdateLabTest(r.Context(), id, store.UpdateLabTestParams{
		Code:                 req.Code,
		Name:                 req.Name,
		Category:             req.Category,
		Price:                req.Price,
		SpecimenType:         req.SpecimenType,
		Container:            req.Container,
		TurnaroundMinutes:    req.TurnaroundMinutes,
		Units:                req.Units,
		ReferenceRanges:      req.ReferenceRanges,
		VerificationRequired: req.VerificationRequired,
		Active:               req.Active,
	}); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "test not found")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionLabTestUpdate, "lab_test", id, nil, map[string]any{"code": req.Code, "name": req.Name})
	writeJSON(w, http.StatusOK, map[string]any{"id": id})
}

// ---- clients ----

type labClientResponse struct {
	ID                 string  `json:"id"`
	ClientNo           string  `json:"clientNo"`
	ClientType         string  `json:"clientType"`
	FirstName          string  `json:"firstName"`
	LastName           string  `json:"lastName"`
	Gender             string  `json:"gender,omitempty"`
	DateOfBirth        *string `json:"dateOfBirth,omitempty"`
	Phone              string  `json:"phone,omitempty"`
	Email              string  `json:"email,omitempty"`
	AddressLine1       string  `json:"addressLine1,omitempty"`
	AddressLine2       string  `json:"addressLine2,omitempty"`
	City               string  `json:"city,omitempty"`
	State              string  `json:"state,omitempty"`
	Country            string  `json:"country,omitempty"`
	ReferringFacility  string  `json:"referringFacility,omitempty"`
	ReferringPhysician string  `json:"referringPhysician,omitempty"`
	Notes              string  `json:"notes,omitempty"`
	CreatedAt          string  `json:"createdAt"`
	UpdatedAt          string  `json:"updatedAt"`
}

func newLabClientResponse(c *domain.LabClient) labClientResponse {
	return labClientResponse{
		ID:                 c.ID,
		ClientNo:           c.ClientNo,
		ClientType:         c.ClientType,
		FirstName:          c.FirstName,
		LastName:           c.LastName,
		Gender:             c.Gender,
		DateOfBirth:        c.DateOfBirth,
		Phone:              c.Phone,
		Email:              c.Email,
		AddressLine1:       c.AddressLine1,
		AddressLine2:       c.AddressLine2,
		City:               c.City,
		State:              c.State,
		Country:            c.Country,
		ReferringFacility:  c.ReferringFacility,
		ReferringPhysician: c.ReferringPhysician,
		Notes:              c.Notes,
		CreatedAt:          c.CreatedAt.UTC().Format(timeRFC3339),
		UpdatedAt:          c.UpdatedAt.UTC().Format(timeRFC3339),
	}
}

func (s *server) handleListLabClients(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)
	clients, err := s.store.ListLabClients(r.Context(), r.URL.Query().Get("search"), limit, offset)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]labClientResponse, 0, len(clients))
	for _, c := range clients {
		out = append(out, newLabClientResponse(&c))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *server) handleGetLabClient(w http.ResponseWriter, r *http.Request) {
	c, err := s.store.GetLabClient(r.Context(), r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "client not found")
		return
	}
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, newLabClientResponse(c))
}

type createLabClientRequest struct {
	ClientType         string `json:"clientType"`
	FirstName          string `json:"firstName"`
	LastName           string `json:"lastName"`
	Gender             string `json:"gender"`
	DateOfBirth        string `json:"dateOfBirth"`
	Phone              string `json:"phone"`
	Email              string `json:"email"`
	AddressLine1       string `json:"addressLine1"`
	AddressLine2       string `json:"addressLine2"`
	City               string `json:"city"`
	State              string `json:"state"`
	Country            string `json:"country"`
	ReferringFacility  string `json:"referringFacility"`
	ReferringPhysician string `json:"referringPhysician"`
	Notes              string `json:"notes"`
}

func (s *server) handleCreateLabClient(w http.ResponseWriter, r *http.Request) {
	var req createLabClientRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.FirstName == "" || req.LastName == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "firstName and lastName are required")
		return
	}
	switch req.ClientType {
	case "", domain.LabClientExternal:
		req.ClientType = domain.LabClientExternal
	case domain.LabClientReferral:
	default:
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "clientType must be external or referral")
		return
	}
	actor := userFromContext(r.Context())
	c, err := s.store.CreateLabClient(r.Context(), store.CreateLabClientParams{
		ClientType:         req.ClientType,
		FirstName:          req.FirstName,
		LastName:           req.LastName,
		Gender:             req.Gender,
		DateOfBirth:        req.DateOfBirth,
		Phone:              req.Phone,
		Email:              req.Email,
		AddressLine1:       req.AddressLine1,
		AddressLine2:       req.AddressLine2,
		City:               req.City,
		State:              req.State,
		Country:            req.Country,
		ReferringFacility:  req.ReferringFacility,
		ReferringPhysician: req.ReferringPhysician,
		Notes:              req.Notes,
		CreatedBy:          actor.ID,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionLabClientCreate, "lab_client", c.ID, nil, map[string]any{
		"clientNo": c.ClientNo, "name": c.FirstName + " " + c.LastName,
	})
	writeJSON(w, http.StatusCreated, newLabClientResponse(c))
}

// ---- requests ----

type labItemResponse struct {
	ID                   string          `json:"id"`
	RequestID            string          `json:"requestId"`
	TestID               string          `json:"testId"`
	TestCode             string          `json:"testCode"`
	TestName             string          `json:"testName"`
	VerificationRequired bool            `json:"verificationRequired"`
	SpecimenType         string          `json:"specimenType"`
	Price                float64         `json:"price"`
	SpecimenID           *string         `json:"specimenId,omitempty"`
	ResultValue          json.RawMessage `json:"resultValue,omitempty"`
	ResultText           string          `json:"resultText,omitempty"`
	Critical             bool            `json:"critical"`
	ResultEnteredBy      *string         `json:"resultEnteredBy,omitempty"`
	ResultEnteredByName  string          `json:"resultEnteredByName,omitempty"`
	ResultEnteredAt      *string         `json:"resultEnteredAt,omitempty"`
	ResultVerifiedBy     *string         `json:"resultVerifiedBy,omitempty"`
	ResultVerifiedByName string          `json:"resultVerifiedByName,omitempty"`
	ResultVerifiedAt     *string         `json:"resultVerifiedAt,omitempty"`
}

func newLabItemResponse(i *domain.LabRequestItem) labItemResponse {
	out := labItemResponse{
		ID:                   i.ID,
		RequestID:            i.RequestID,
		TestID:               i.TestID,
		TestCode:             i.TestCode,
		TestName:             i.TestName,
		VerificationRequired: i.VerificationRequired,
		SpecimenType:         i.SpecimenType,
		Price:                i.Price,
		SpecimenID:           i.SpecimenID,
		ResultValue:          json.RawMessage(i.ResultValue),
		ResultText:           i.ResultText,
		Critical:             i.Critical,
		ResultEnteredBy:      i.ResultEnteredBy,
		ResultEnteredByName:  i.ResultEnteredByName,
		ResultVerifiedBy:     i.ResultVerifiedBy,
		ResultVerifiedByName: i.ResultVerifiedByName,
	}
	if i.ResultEnteredAt != nil {
		v := i.ResultEnteredAt.UTC().Format(timeRFC3339)
		out.ResultEnteredAt = &v
	}
	if i.ResultVerifiedAt != nil {
		v := i.ResultVerifiedAt.UTC().Format(timeRFC3339)
		out.ResultVerifiedAt = &v
	}
	return out
}

type labSpecimenResponse struct {
	ID              string  `json:"id"`
	SpecimenNo      string  `json:"specimenNo"`
	Barcode         string  `json:"barcode"`
	RequestID       string  `json:"requestId"`
	ItemID          string  `json:"itemId"`
	SpecimenType    string  `json:"specimenType"`
	OriginLocation  string  `json:"originLocation,omitempty"`
	CollectedBy     string  `json:"collectedBy"`
	CollectedAt     string  `json:"collectedAt"`
	ReceivedBy      *string `json:"receivedBy,omitempty"`
	ReceivedAt      *string `json:"receivedAt,omitempty"`
	Condition       string  `json:"condition,omitempty"`
	StorageLocation string  `json:"storageLocation,omitempty"`
	Status          string  `json:"status"`
	RejectionReason string  `json:"rejectionReason,omitempty"`
	CreatedAt       string  `json:"createdAt"`
	UpdatedAt       string  `json:"updatedAt"`
}

func newLabSpecimenResponse(sp *domain.LabSpecimen) labSpecimenResponse {
	out := labSpecimenResponse{
		ID:             sp.ID,
		SpecimenNo:     sp.SpecimenNo,
		Barcode:        sp.Barcode,
		RequestID:      sp.RequestID,
		ItemID:         sp.ItemID,
		SpecimenType:   sp.SpecimenType,
		OriginLocation: sp.OriginLocation,

		CollectedBy:     sp.CollectedBy,
		CollectedAt:     sp.CollectedAt.UTC().Format(timeRFC3339),
		ReceivedBy:      sp.ReceivedBy,
		Condition:       sp.Condition,
		StorageLocation: sp.StorageLocation,
		Status:          sp.Status,
		RejectionReason: sp.RejectionReason,
		CreatedAt:       sp.CreatedAt.UTC().Format(timeRFC3339),
		UpdatedAt:       sp.UpdatedAt.UTC().Format(timeRFC3339),
	}
	if sp.ReceivedAt != nil {
		v := sp.ReceivedAt.UTC().Format(timeRFC3339)
		out.ReceivedAt = &v
	}
	return out
}

type labRequestResponse struct {
	ID            string                `json:"id"`
	RequestNo     string                `json:"requestNo"`
	PatientID     *string               `json:"patientId,omitempty"`
	ClientID      *string               `json:"clientId,omitempty"`
	PatientNo     string                `json:"patientNo,omitempty"`
	PatientName   string                `json:"patientName,omitempty"`
	ClientNo      string                `json:"clientNo,omitempty"`
	ClientName    string                `json:"clientName,omitempty"`
	OrderedBy     string                `json:"orderedBy"`
	OrderedByName string                `json:"orderedByName"`
	OrderID       *string               `json:"orderId,omitempty"`
	Priority      string                `json:"priority"`
	ClinicalNotes string                `json:"clinicalNotes,omitempty"`
	PaymentStatus string                `json:"paymentStatus"`
	Status        string                `json:"status"`
	CancelReason  string                `json:"cancelReason,omitempty"`
	RequestedAt   string                `json:"requestedAt"`
	ReleasedAt    *string               `json:"releasedAt,omitempty"`
	CreatedAt     string                `json:"createdAt"`
	UpdatedAt     string                `json:"updatedAt"`
	Items         []labItemResponse     `json:"items,omitempty"`
	Specimens     []labSpecimenResponse `json:"specimens,omitempty"`
}

func newLabRequestResponse(req *domain.LabRequest) labRequestResponse {
	out := labRequestResponse{
		ID:            req.ID,
		RequestNo:     req.RequestNo,
		PatientID:     req.PatientID,
		ClientID:      req.ClientID,
		PatientNo:     req.PatientNo,
		PatientName:   req.PatientName,
		ClientNo:      req.ClientNo,
		ClientName:    req.ClientName,
		OrderedBy:     req.OrderedBy,
		OrderedByName: req.OrderedByName,
		OrderID:       req.OrderID,
		Priority:      req.Priority,
		ClinicalNotes: req.ClinicalNotes,
		PaymentStatus: req.PaymentStatus,
		Status:        req.Status,
		CancelReason:  req.CancelReason,
		RequestedAt:   req.RequestedAt.UTC().Format(timeRFC3339),
		CreatedAt:     req.CreatedAt.UTC().Format(timeRFC3339),
		UpdatedAt:     req.UpdatedAt.UTC().Format(timeRFC3339),
	}
	if req.ReleasedAt != nil {
		v := req.ReleasedAt.UTC().Format(timeRFC3339)
		out.ReleasedAt = &v
	}
	out.Items = make([]labItemResponse, 0, len(req.Items))
	for i := range req.Items {
		out.Items = append(out.Items, newLabItemResponse(&req.Items[i]))
	}
	out.Specimens = make([]labSpecimenResponse, 0, len(req.Specimens))
	for i := range req.Specimens {
		out.Specimens = append(out.Specimens, newLabSpecimenResponse(&req.Specimens[i]))
	}
	return out
}

type createLabRequestRequest struct {
	PatientID     string   `json:"patientId"`
	ClientID      string   `json:"clientId"`
	Priority      string   `json:"priority"`
	ClinicalNotes string   `json:"clinicalNotes"`
	TestIDs       []string `json:"testIds"`
	CustomTests   []struct {
		Name         string `json:"name"`
		SpecimenType string `json:"specimenType"`
	} `json:"customTests"`
	OrderID string `json:"orderId"`
}

func (s *server) handleCreateLabRequest(w http.ResponseWriter, r *http.Request) {
	var req createLabRequestRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if (req.PatientID == "") == (req.ClientID == "") {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "exactly one of patientId or clientId is required")
		return
	}
	switch req.Priority {
	case "", domain.LabPriorityRoutine:
		req.Priority = domain.LabPriorityRoutine
	case domain.LabPriorityUrgent, domain.LabPriorityStat:
	default:
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "priority must be routine, urgent or stat")
		return
	}
	actor := userFromContext(r.Context())
	var patientID, clientID, orderID *string
	if req.PatientID != "" {
		patientID = &req.PatientID
	}
	if req.ClientID != "" {
		clientID = &req.ClientID
	}
	if req.OrderID != "" {
		orderID = &req.OrderID
	}
	custom := make([]store.CustomTestParams, 0, len(req.CustomTests))
	for _, ct := range req.CustomTests {
		if strings.TrimSpace(ct.Name) == "" {
			continue
		}
		custom = append(custom, store.CustomTestParams{
			Name:         strings.TrimSpace(ct.Name),
			SpecimenType: ct.SpecimenType,
		})
	}
	labReq, err := s.store.CreateLabRequest(r.Context(), store.CreateLabRequestParams{
		PatientID:     patientID,
		ClientID:      clientID,
		OrderedBy:     actor.ID,
		Priority:      req.Priority,
		ClinicalNotes: req.ClinicalNotes,
		TestIDs:       req.TestIDs,
		CustomTests:   custom,
		OrderID:       orderID,
	})
	if err != nil {
		if errors.Is(err, store.ErrDuplicateTest) {
			writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "duplicate test in request")
			return
		}
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "patient, client or test not found")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionLabRequestCreate, "lab_request", labReq.ID, nil, map[string]any{
		"requestNo": labReq.RequestNo,
		"priority":  labReq.Priority,
		"patientId": labReq.PatientID,
		"clientId":  labReq.ClientID,
	})
	writeJSON(w, http.StatusCreated, newLabRequestResponse(labReq))
}

func (s *server) handleListLabRequests(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)
	requests, err := s.store.ListLabRequests(r.Context(), store.ListLabRequestsParams{
		Status:  r.URL.Query().Get("status"),
		Patient: r.URL.Query().Get("patientId"),
		Client:  r.URL.Query().Get("clientId"),
		Limit:   limit,
		Offset:  offset,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]labRequestResponse, 0, len(requests))
	for _, req := range requests {
		out = append(out, newLabRequestResponse(&req))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *server) handleGetLabRequest(w http.ResponseWriter, r *http.Request) {
	req, err := s.store.GetLabRequest(r.Context(), r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "request not found")
		return
	}
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionLabViewed, "lab_request", req.ID, nil, map[string]any{"requestNo": req.RequestNo})
	writeJSON(w, http.StatusOK, newLabRequestResponse(req))
}

type transitionLabRequestRequest struct {
	Status        string `json:"status"`
	PaymentStatus string `json:"paymentStatus"`
}

func (s *server) handleTransitionLabRequest(w http.ResponseWriter, r *http.Request) {
	var req transitionLabRequestRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	switch req.PaymentStatus {
	case "", domain.LabPaymentPending, domain.LabPaymentPreauthorized, domain.LabPaymentPaid, domain.LabPaymentWaived:
	default:
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "paymentStatus must be pending, preauthorized, paid or waived")
		return
	}
	id := r.PathValue("id")
	actor := userFromContext(r.Context())
	from, err := s.store.TransitionLabRequest(r.Context(), id, req.Status, actor.ID)
	if err != nil {
		if errors.Is(err, store.ErrInvalidLabTransition) {
			writeError(w, r, http.StatusConflict, "invalid_transition", "invalid lab request transition")
			return
		}
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "request not found")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	if req.PaymentStatus != "" {
		if err := s.store.SetLabPaymentStatus(r.Context(), id, req.PaymentStatus); err != nil {
			writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
			return
		}
	}
	s.recordAudit(r, domain.ActionLabRequestStatus, "lab_request", id, nil, map[string]any{
		"from": from, "to": req.Status,
	})
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": req.Status})
}

type cancelLabRequestRequest struct {
	Reason string `json:"reason"`
}

func (s *server) handleCancelLabRequest(w http.ResponseWriter, r *http.Request) {
	var req cancelLabRequestRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Reason == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "reason is required")
		return
	}
	id := r.PathValue("id")
	actor := userFromContext(r.Context())
	if err := s.store.CancelLabRequest(r.Context(), id, req.Reason, actor.ID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "request not found")
			return
		}
		if errors.Is(err, store.ErrInvalidLabTransition) {
			writeError(w, r, http.StatusConflict, "invalid_transition", "request cannot be cancelled")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionLabRequestCancel, "lab_request", id, nil, map[string]any{"reason": req.Reason})
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": domain.LabStatusCancelled})
}

type collectSpecimensRequest struct {
	Specimens []struct {
		ItemID         string `json:"itemId"`
		SpecimenType   string `json:"specimenType"`
		OriginLocation string `json:"originLocation"`
		CollectedAt    string `json:"collectedAt"`
	} `json:"specimens"`
}

func (s *server) handleCollectSpecimens(w http.ResponseWriter, r *http.Request) {
	var req collectSpecimensRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	items := make([]store.SpecimenCollectParams, 0, len(req.Specimens))
	for _, sp := range req.Specimens {
		if sp.ItemID == "" {
			writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "itemId is required for every specimen")
			return
		}
		collectedAt := time.Now().UTC()
		if sp.CollectedAt != "" {
			t, err := time.Parse(timeRFC3339, sp.CollectedAt)
			if err != nil {
				writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "collectedAt must be an RFC3339 timestamp")
				return
			}
			collectedAt = t
		}
		items = append(items, store.SpecimenCollectParams{
			ItemID:         sp.ItemID,
			SpecimenType:   sp.SpecimenType,
			OriginLocation: sp.OriginLocation,
			CollectedAt:    collectedAt,
		})
	}
	actor := userFromContext(r.Context())
	id := r.PathValue("id")
	specimens, err := s.store.CollectSpecimens(r.Context(), id, items, actor.ID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "request or item not found")
			return
		}
		if errors.Is(err, store.ErrInvalidLabTransition) {
			writeError(w, r, http.StatusConflict, "invalid_transition", "specimens cannot be collected at this stage")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionLabSpecimenCollect, "lab_request", id, nil, map[string]any{"count": len(specimens)})
	writeJSON(w, http.StatusOK, map[string]any{"count": len(specimens)})
}

type receiveSpecimenRequest struct {
	Condition       string `json:"condition"`
	StorageLocation string `json:"storageLocation"`
}

func (s *server) handleReceiveSpecimen(w http.ResponseWriter, r *http.Request) {
	var req receiveSpecimenRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	actor := userFromContext(r.Context())
	id := r.PathValue("id")
	sp, err := s.store.ReceiveSpecimen(r.Context(), id, req.Condition, req.StorageLocation, actor.ID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "specimen not found")
			return
		}
		if errors.Is(err, store.ErrInvalidLabTransition) {
			writeError(w, r, http.StatusConflict, "invalid_transition", "specimen is not in collected state")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionLabSpecimenReceive, "lab_specimen", sp.ID, nil, map[string]any{"specimenNo": sp.SpecimenNo})
	writeJSON(w, http.StatusOK, newLabSpecimenResponse(sp))
}

type rejectSpecimenRequest struct {
	Reason string `json:"reason"`
}

func (s *server) handleRejectSpecimen(w http.ResponseWriter, r *http.Request) {
	var req rejectSpecimenRequest
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
	if err := s.store.RejectSpecimen(r.Context(), id, req.Reason, actor.ID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "specimen not found")
			return
		}
		if errors.Is(err, store.ErrInvalidLabTransition) {
			writeError(w, r, http.StatusConflict, "invalid_transition", "specimen cannot be rejected")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionLabSpecimenReject, "lab_specimen", id, nil, map[string]any{"reason": req.Reason})
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": domain.SpecimenStatusRejected})
}

type enterResultsRequest struct {
	Entries []struct {
		ItemID      string          `json:"itemId"`
		ResultValue json.RawMessage `json:"resultValue"`
		ResultText  string          `json:"resultText"`
		Critical    bool            `json:"critical"`
	} `json:"entries"`
}

func (s *server) handleEnterResults(w http.ResponseWriter, r *http.Request) {
	var req enterResultsRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	entries := make([]store.ResultEntryParams, 0, len(req.Entries))
	for _, e := range req.Entries {
		if e.ItemID == "" {
			writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "itemId is required for every result")
			return
		}
		entries = append(entries, store.ResultEntryParams{
			ItemID:      e.ItemID,
			ResultValue: e.ResultValue,
			ResultText:  e.ResultText,
			Critical:    e.Critical,
		})
	}
	actor := userFromContext(r.Context())
	id := r.PathValue("id")
	notifications, err := s.store.EnterResults(r.Context(), id, entries, actor.ID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "request or item not found")
			return
		}
		if errors.Is(err, store.ErrInvalidLabTransition) {
			writeError(w, r, http.StatusConflict, "invalid_transition", "results cannot be entered at this stage")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	// Route critical alerts to the attending physician's communications queue
	// and in-app notifications (critical value alerting).
	if len(notifications) > 0 {
		if err := s.store.RouteCriticalAlerts(r.Context(), actor.ID, notifications); err != nil {
			// Routing failure must not fail the result entry itself.
			s.logger.Warn("critical alert routing failed", "error", err.Error())
		}
	}
	s.recordAudit(r, domain.ActionLabResultEnter, "lab_request", id, nil, map[string]any{"count": len(entries)})
	writeJSON(w, http.StatusOK, map[string]any{"notifications": len(notifications)})
}

func (s *server) handleVerifyItem(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	id := r.PathValue("id")
	if err := s.store.VerifyItem(r.Context(), id, actor.ID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "item not found")
			return
		}
		if errors.Is(err, store.ErrSelfVerification) {
			writeError(w, r, http.StatusUnprocessableEntity, "self_verification", "cannot verify your own result entry")
			return
		}
		if errors.Is(err, store.ErrInvalidLabTransition) {
			writeError(w, r, http.StatusConflict, "invalid_transition", "result cannot be verified at this stage")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionLabResultVerify, "lab_request_item", id, nil, nil)
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "verified": true})
}

func (s *server) handleReleaseRequest(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	id := r.PathValue("id")
	if err := s.store.ReleaseRequest(r.Context(), id, actor.ID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "request not found")
			return
		}
		if errors.Is(err, store.ErrInvalidLabTransition) {
			writeError(w, r, http.StatusConflict, "invalid_transition", "request must be verified before release")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionLabResultRelease, "lab_request", id, nil, nil)
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": domain.LabStatusReleased})
}

// ---- critical notifications ----

type labCriticalResponse struct {
	ID                   string  `json:"id"`
	ItemID               string  `json:"itemId"`
	RequestID            string  `json:"requestId"`
	PatientID            *string `json:"patientId,omitempty"`
	ClientID             *string `json:"clientId,omitempty"`
	NotifiedToUserID     *string `json:"notifiedToUserId,omitempty"`
	NotifiedToName       string  `json:"notifiedToName"`
	NotifiedAt           string  `json:"notifiedAt"`
	AcknowledgedBy       *string `json:"acknowledgedBy,omitempty"`
	AcknowledgedAt       *string `json:"acknowledgedAt,omitempty"`
	AcknowledgementNotes string  `json:"acknowledgementNotes,omitempty"`
	Status               string  `json:"status"`
	CreatedAt            string  `json:"createdAt"`
}

func newLabCriticalResponse(n *domain.LabCriticalNotification) labCriticalResponse {
	out := labCriticalResponse{
		ID:                   n.ID,
		ItemID:               n.ItemID,
		RequestID:            n.RequestID,
		PatientID:            n.PatientID,
		ClientID:             n.ClientID,
		NotifiedToUserID:     n.NotifiedToUserID,
		NotifiedToName:       n.NotifiedToName,
		NotifiedAt:           n.NotifiedAt.UTC().Format(timeRFC3339),
		AcknowledgedBy:       n.AcknowledgedBy,
		AcknowledgementNotes: n.AcknowledgementNotes,
		Status:               n.Status,
		CreatedAt:            n.CreatedAt.UTC().Format(timeRFC3339),
	}
	if n.AcknowledgedAt != nil {
		v := n.AcknowledgedAt.UTC().Format(timeRFC3339)
		out.AcknowledgedAt = &v
	}
	return out
}

func (s *server) handleListCriticalNotifications(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)
	notifications, err := s.store.ListCriticalNotifications(r.Context(), r.URL.Query().Get("status"), limit, offset)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]labCriticalResponse, 0, len(notifications))
	for _, n := range notifications {
		out = append(out, newLabCriticalResponse(&n))
	}
	writeJSON(w, http.StatusOK, out)
}

type acknowledgeCriticalRequest struct {
	Notes string `json:"notes"`
}

func (s *server) handleAcknowledgeCritical(w http.ResponseWriter, r *http.Request) {
	var req acknowledgeCriticalRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	actor := userFromContext(r.Context())
	id := r.PathValue("id")
	if err := s.store.AcknowledgeCritical(r.Context(), id, actor.ID, req.Notes); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "notification not found or already acknowledged")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionLabCriticalAck, "lab_critical_notification", id, nil, nil)
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": domain.CriticalStatusAcknowledged})
}
