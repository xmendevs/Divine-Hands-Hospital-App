package httpapi

import (
	"errors"
	"net/http"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

// ---- medicines ----

type medicineResponse struct {
	ID              string  `json:"id"`
	Code            string  `json:"code"`
	GenericName     string  `json:"genericName"`
	Brand           string  `json:"brand"`
	Strength        string  `json:"strength"`
	DosageForm      string  `json:"dosageForm"`
	Category        string  `json:"category"`
	Supplier        string  `json:"supplier"`
	ReorderLevel    float64 `json:"reorderLevel"`
	StorageLocation string  `json:"storageLocation"`
	UnitCost        float64 `json:"unitCost"`
	SellingPrice    float64 `json:"sellingPrice"`
	Active          bool    `json:"active"`
}

func newMedicineResponse(m *domain.Medicine) medicineResponse {
	return medicineResponse{
		ID:              m.ID,
		Code:            m.Code,
		GenericName:     m.GenericName,
		Brand:           m.Brand,
		Strength:        m.Strength,
		DosageForm:      m.DosageForm,
		Category:        m.Category,
		Supplier:        m.Supplier,
		ReorderLevel:    m.ReorderLevel,
		StorageLocation: m.StorageLocation,
		UnitCost:        m.UnitCost,
		SellingPrice:    m.SellingPrice,
		Active:          m.Active,
	}
}

type createMedicineRequest struct {
	GenericName     string  `json:"genericName"`
	Brand           string  `json:"brand"`
	Strength        string  `json:"strength"`
	DosageForm      string  `json:"dosageForm"`
	Category        string  `json:"category"`
	Supplier        string  `json:"supplier"`
	ReorderLevel    float64 `json:"reorderLevel"`
	StorageLocation string  `json:"storageLocation"`
	UnitCost        float64 `json:"unitCost"`
	SellingPrice    float64 `json:"sellingPrice"`
}

// handleCreateMedicine creates a medicine master record.
func (s *server) handleCreateMedicine(w http.ResponseWriter, r *http.Request) {
	var req createMedicineRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.GenericName == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "genericName is required")
		return
	}
	m, err := s.store.CreateMedicine(r.Context(), store.CreateMedicineParams{
		GenericName:     req.GenericName,
		Brand:           req.Brand,
		Strength:        req.Strength,
		DosageForm:      req.DosageForm,
		Category:        req.Category,
		Supplier:        req.Supplier,
		ReorderLevel:    req.ReorderLevel,
		StorageLocation: req.StorageLocation,
		UnitCost:        req.UnitCost,
		SellingPrice:    req.SellingPrice,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionMedicineCreate, "medicine", m.ID, nil, map[string]any{"code": m.Code, "genericName": m.GenericName})
	writeJSON(w, http.StatusCreated, newMedicineResponse(m))
}

// handleListMedicines lists medicines.
func (s *server) handleListMedicines(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)
	medicines, err := s.store.ListMedicines(r.Context(), limit, offset)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]medicineResponse, 0, len(medicines))
	for i := range medicines {
		out = append(out, newMedicineResponse(&medicines[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

// handleGetMedicine returns a medicine with its batches.
func (s *server) handleGetMedicine(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	m, err := s.store.GetMedicine(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "medicine not found")
		return
	}
	batches, _ := s.store.ListBatches(r.Context(), id)
	batchResp := make([]batchResponse, 0, len(batches))
	for i := range batches {
		batchResp = append(batchResp, newBatchResponse(&batches[i]))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"medicine": newMedicineResponse(m),
		"batches":  batchResp,
	})
}

type updateMedicineRequest struct {
	GenericName     string   `json:"genericName"`
	Brand           string   `json:"brand"`
	Strength        string   `json:"strength"`
	DosageForm      string   `json:"dosageForm"`
	Category        string   `json:"category"`
	Supplier        string   `json:"supplier"`
	ReorderLevel    *float64 `json:"reorderLevel"`
	StorageLocation string   `json:"storageLocation"`
	UnitCost        *float64 `json:"unitCost"`
	SellingPrice    *float64 `json:"sellingPrice"`
	Active          *bool    `json:"active"`
}

// handleUpdateMedicine updates a medicine master record (price changes audited).
func (s *server) handleUpdateMedicine(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	existing, err := s.store.GetMedicine(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "medicine not found")
		return
	}
	var req updateMedicineRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}

	params := store.UpdateMedicineParams{
		GenericName:     req.GenericName,
		Brand:           req.Brand,
		Strength:        req.Strength,
		DosageForm:      req.DosageForm,
		Category:        req.Category,
		Supplier:        req.Supplier,
		ReorderLevel:    existing.ReorderLevel,
		StorageLocation: req.StorageLocation,
		UnitCost:        existing.UnitCost,
		SellingPrice:    existing.SellingPrice,
		Active:          existing.Active,
	}
	if req.ReorderLevel != nil {
		params.ReorderLevel = *req.ReorderLevel
	}
	if req.UnitCost != nil {
		params.UnitCost = *req.UnitCost
	}
	if req.SellingPrice != nil {
		params.SellingPrice = *req.SellingPrice
	}
	if req.Active != nil {
		params.Active = *req.Active
	}

	if err := s.store.UpdateMedicine(r.Context(), id, params); err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}

	details := map[string]any{}
	if params.UnitCost != existing.UnitCost || params.SellingPrice != existing.SellingPrice {
		details["priceChange"] = map[string]any{
			"oldUnitCost": existing.UnitCost, "newUnitCost": params.UnitCost,
			"oldSellingPrice": existing.SellingPrice, "newSellingPrice": params.SellingPrice,
		}
	}
	s.recordAudit(r, domain.ActionMedicineUpdate, "medicine", id, nil, details)
	w.WriteHeader(http.StatusNoContent)
}

// handleDeleteMedicine soft-deletes a medicine by setting active = false.
func (s *server) handleDeleteMedicine(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.store.DeleteMedicine(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "medicine not found")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionMedicineUpdate, "medicine", id, nil, map[string]any{"action": "soft_delete"})
	w.WriteHeader(http.StatusNoContent)
}

// ---- batches ----

type batchResponse struct {
	ID                string  `json:"id"`
	MedicineID        string  `json:"medicineId"`
	BatchNumber       string  `json:"batchNumber"`
	ManufacturingDate *string `json:"manufacturingDate,omitempty"`
	ExpiryDate        *string `json:"expiryDate,omitempty"`
	QuantityOnHand    float64 `json:"quantityOnHand"`
	PurchaseCost      float64 `json:"purchaseCost"`
	SellingPrice      float64 `json:"sellingPrice"`
	Supplier          string  `json:"supplier"`
	Status            string  `json:"status"`
	ReceivedAt        string  `json:"receivedAt"`
}

func newBatchResponse(b *domain.Batch) batchResponse {
	return batchResponse{
		ID:                b.ID,
		MedicineID:        b.MedicineID,
		BatchNumber:       b.BatchNumber,
		ManufacturingDate: b.ManufacturingDate,
		ExpiryDate:        b.ExpiryDate,
		QuantityOnHand:    b.QuantityOnHand,
		PurchaseCost:      b.PurchaseCost,
		SellingPrice:      b.SellingPrice,
		Supplier:          b.Supplier,
		Status:            b.Status,
		ReceivedAt:        b.ReceivedAt.UTC().Format(timeRFC3339),
	}
}

// handleListBatches lists a medicine's batches.
func (s *server) handleListBatches(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	batches, err := s.store.ListBatches(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]batchResponse, 0, len(batches))
	for i := range batches {
		out = append(out, newBatchResponse(&batches[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

type receiveStockRequest struct {
	MedicineID        string  `json:"medicineId"`
	BatchNumber       string  `json:"batchNumber"`
	ManufacturingDate string  `json:"manufacturingDate"`
	ExpiryDate        string  `json:"expiryDate"`
	Quantity          float64 `json:"quantity"`
	PurchaseCost      float64 `json:"purchaseCost"`
	SellingPrice      float64 `json:"sellingPrice"`
	Supplier          string  `json:"supplier"`
}

// handleReceiveStock receives stock into a batch.
func (s *server) handleReceiveStock(w http.ResponseWriter, r *http.Request) {
	var req receiveStockRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.MedicineID == "" || req.BatchNumber == "" || req.Quantity <= 0 {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "medicineId, batchNumber, and a positive quantity are required")
		return
	}
	actor := userFromContext(r.Context())
	batch, err := s.store.ReceiveStock(r.Context(), store.ReceiveStockParams{
		MedicineID:        req.MedicineID,
		BatchNumber:       req.BatchNumber,
		ManufacturingDate: req.ManufacturingDate,
		ExpiryDate:        req.ExpiryDate,
		Quantity:          req.Quantity,
		PurchaseCost:      req.PurchaseCost,
		SellingPrice:      req.SellingPrice,
		Supplier:          req.Supplier,
		PerformedBy:       actor.ID,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionInventoryReceipt, "medicine", req.MedicineID, nil, map[string]any{
		"batchNumber": req.BatchNumber, "quantity": req.Quantity,
	})
	writeJSON(w, http.StatusCreated, newBatchResponse(batch))
}

// ---- dispensing ----

type dispenseItemRequest struct {
	MedicineID string  `json:"medicineId"`
	Quantity   float64 `json:"quantity"`
}

type dispenseRequest struct {
	OrderID string                `json:"orderId"`
	Items   []dispenseItemRequest `json:"items"`
	Notes   string                `json:"notes"`
}

type dispensationItemResponse struct {
	MedicineID string  `json:"medicineId"`
	BatchID    string  `json:"batchId"`
	Quantity   float64 `json:"quantity"`
	UnitPrice  float64 `json:"unitPrice"`
}

type dispensationResponse struct {
	ID                     string                     `json:"id"`
	DispensationNo         string                     `json:"dispensationNo"`
	PrescriptionOrderID    string                     `json:"prescriptionOrderId"`
	PatientID              string                     `json:"patientId"`
	DispensedBy            string                     `json:"dispensedBy"`
	TotalAmount            float64                    `json:"totalAmount"`
	Notes                  string                     `json:"notes,omitempty"`
	DispenseStatus         string                     `json:"dispenseStatus"`
	CounselingNotes        string                     `json:"counselingNotes,omitempty"`
	AllergyCheckPassed     bool                       `json:"allergyCheckPassed"`
	InteractionCheckPassed bool                       `json:"interactionCheckPassed"`
	SignOffBy              *string                    `json:"signOffBy,omitempty"`
	SignOffAt              *string                    `json:"signOffAt,omitempty"`
	CreatedAt              string                     `json:"createdAt"`
	Items                  []dispensationItemResponse `json:"items,omitempty"`
}

func newDispensationResponse(d *domain.Dispensation) dispensationResponse {
	resp := dispensationResponse{
		ID:                     d.ID,
		DispensationNo:         d.DispensationNo,
		PrescriptionOrderID:    d.PrescriptionOrderID,
		PatientID:              d.PatientID,
		DispensedBy:            d.DispensedBy,
		TotalAmount:            d.TotalAmount,
		Notes:                  d.Notes,
		DispenseStatus:         d.DispenseStatus,
		CounselingNotes:        d.CounselingNotes,
		AllergyCheckPassed:     d.AllergyCheckPassed,
		InteractionCheckPassed: d.InteractionCheckPassed,
		SignOffBy:              d.SignOffBy,
		CreatedAt:              d.CreatedAt.UTC().Format(timeRFC3339),
		Items:                  make([]dispensationItemResponse, 0, len(d.Items)),
	}
	if d.SignOffAt != nil {
		t := d.SignOffAt.UTC().Format(timeRFC3339)
		resp.SignOffAt = &t
	}
	for _, it := range d.Items {
		resp.Items = append(resp.Items, dispensationItemResponse{
			MedicineID: it.MedicineID,
			BatchID:    it.BatchID,
			Quantity:   it.Quantity,
			UnitPrice:  it.UnitPrice,
		})
	}
	return resp
}

// handleDispense fills a prescription using FEFO.
func (s *server) handleDispense(w http.ResponseWriter, r *http.Request) {
	var req dispenseRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.OrderID == "" || len(req.Items) == 0 {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "orderId and at least one item are required")
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
	if order.Status == domain.OrderStatusCompleted {
		writeError(w, r, http.StatusConflict, "already_dispensed", "prescription already dispensed")
		return
	}
	if order.Status == domain.OrderStatusCancelled || order.Status == domain.OrderStatusDraft {
		writeError(w, r, http.StatusConflict, "invalid_transition", "order is not in a dispensable state")
		return
	}

	items := make([]store.DispenseItemParams, 0, len(req.Items))
	for _, it := range req.Items {
		if it.Quantity <= 0 {
			writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "item quantity must be positive")
			return
		}
		items = append(items, store.DispenseItemParams{MedicineID: it.MedicineID, Quantity: it.Quantity})
	}

	actor := userFromContext(r.Context())
	disp, err := s.store.Dispense(r.Context(), store.DispenseParams{
		OrderID:     req.OrderID,
		Items:       items,
		Notes:       req.Notes,
		DispensedBy: actor.ID,
	})
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, r, http.StatusNotFound, "not_found", "medicine not found")
		return
	case errors.Is(err, store.ErrInsufficientStock):
		writeError(w, r, http.StatusConflict, "insufficient_stock", "not enough dispensable stock")
		return
	case errors.Is(err, store.ErrNotDispensable):
		writeError(w, r, http.StatusConflict, "not_dispensable", "medicine or batch is not dispensable")
		return
	case errors.Is(err, store.ErrAlreadyDispensed):
		writeError(w, r, http.StatusConflict, "already_dispensed", "prescription already dispensed")
		return
	case err != nil:
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionInventoryDispense, "patient", order.PatientID, nil, map[string]any{
		"orderNo": order.OrderNo, "dispensationNo": disp.DispensationNo,
	})
	writeJSON(w, http.StatusCreated, newDispensationResponse(disp))
}

// handleGetDispensation returns a dispensation.
func (s *server) handleGetDispensation(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	d, err := s.store.GetDispensation(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "dispensation not found")
		return
	}
	writeJSON(w, http.StatusOK, newDispensationResponse(d))
}

// handleListDispensations lists dispensing history.
func (s *server) handleListDispensations(w http.ResponseWriter, r *http.Request) {
	patientID := r.URL.Query().Get("patientId")
	limit, offset := pagination(r)
	disps, err := s.store.ListDispensations(r.Context(), patientID, limit, offset)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]dispensationResponse, 0, len(disps))
	for i := range disps {
		out = append(out, newDispensationResponse(&disps[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

// ---- adjustments & approvals ----

type createAdjustmentRequest struct {
	MedicineID string  `json:"medicineId"`
	BatchID    string  `json:"batchId"`
	Quantity   float64 `json:"quantity"`
	Reason     string  `json:"reason"`
}

type adjustmentResponse struct {
	ID                string  `json:"id"`
	MedicineID        string  `json:"medicineId"`
	BatchID           string  `json:"batchId"`
	Quantity          float64 `json:"quantity"`
	Reason            string  `json:"reason"`
	Status            string  `json:"status"`
	ApprovalRequestID *string `json:"approvalRequestId,omitempty"`
	RequestedBy       string  `json:"requestedBy"`
	CreatedAt         string  `json:"createdAt"`
}

func newAdjustmentResponse(a *domain.StockAdjustment) adjustmentResponse {
	return adjustmentResponse{
		ID:                a.ID,
		MedicineID:        a.MedicineID,
		BatchID:           a.BatchID,
		Quantity:          a.Quantity,
		Reason:            a.Reason,
		Status:            a.Status,
		ApprovalRequestID: a.ApprovalRequestID,
		RequestedBy:       a.RequestedBy,
		CreatedAt:         a.CreatedAt.UTC().Format(timeRFC3339),
	}
}

// handleCreateAdjustment creates a stock adjustment (pending or applied).
func (s *server) handleCreateAdjustment(w http.ResponseWriter, r *http.Request) {
	var req createAdjustmentRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.MedicineID == "" || req.BatchID == "" || req.Quantity == 0 || req.Reason == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "medicineId, batchId, a non-zero quantity, and reason are required")
		return
	}
	actor := userFromContext(r.Context())
	adj, approval, err := s.store.CreateAdjustment(r.Context(), store.CreateAdjustmentParams{
		MedicineID:  req.MedicineID,
		BatchID:     req.BatchID,
		Quantity:    req.Quantity,
		Reason:      req.Reason,
		RequestedBy: actor.ID,
	})
	if err != nil {
		if errors.Is(err, store.ErrInsufficientStock) {
			writeError(w, r, http.StatusConflict, "insufficient_stock", "adjustment would take stock below zero")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionInventoryAdjust, "medicine", req.MedicineID, nil, map[string]any{
		"batchId": req.BatchID, "quantity": req.Quantity, "status": adj.Status,
	})
	resp := map[string]any{"adjustment": newAdjustmentResponse(adj)}
	if approval != nil {
		resp["approval"] = newApprovalResponse(approval)
	}
	writeJSON(w, http.StatusCreated, resp)
}

// handleListAdjustments lists adjustments.
func (s *server) handleListAdjustments(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	limit, offset := pagination(r)
	adjustments, err := s.store.ListAdjustments(r.Context(), status, limit, offset)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]adjustmentResponse, 0, len(adjustments))
	for i := range adjustments {
		out = append(out, newAdjustmentResponse(&adjustments[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

type approvalResponse struct {
	ID          string         `json:"id"`
	SubjectType string         `json:"subjectType"`
	SubjectID   string         `json:"subjectId"`
	Action      string         `json:"action"`
	RequestedBy string         `json:"requestedBy"`
	Status      string         `json:"status"`
	Details     map[string]any `json:"details,omitempty"`
	Reason      string         `json:"reason,omitempty"`
	DecidedBy   *string        `json:"decidedBy,omitempty"`
	CreatedAt   string         `json:"createdAt"`
}

func newApprovalResponse(a *domain.ApprovalRequest) approvalResponse {
	return approvalResponse{
		ID:          a.ID,
		SubjectType: a.SubjectType,
		SubjectID:   a.SubjectID,
		Action:      a.Action,
		RequestedBy: a.RequestedBy,
		Status:      a.Status,
		Details:     jsonObject(a.Details),
		Reason:      a.Reason,
		DecidedBy:   a.DecidedBy,
		CreatedAt:   a.CreatedAt.UTC().Format(timeRFC3339),
	}
}

// handleListApprovals lists approval requests.
func (s *server) handleListApprovals(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	limit, offset := pagination(r)
	approvals, err := s.store.ListApprovals(r.Context(), status, limit, offset)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]approvalResponse, 0, len(approvals))
	for i := range approvals {
		out = append(out, newApprovalResponse(&approvals[i]))
	}
	s.recordAudit(r, domain.ActionInventoryViewed, "approval", "", nil, nil)
	writeJSON(w, http.StatusOK, out)
}

// handleApproveApproval approves a pending approval request.
func (s *server) handleApproveApproval(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	actor := userFromContext(r.Context())
	err := s.store.ApproveApproval(r.Context(), id, actor.ID)
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, r, http.StatusNotFound, "not_found", "approval request not found")
		return
	case errors.Is(err, store.ErrSelfApproval):
		writeError(w, r, http.StatusForbidden, "forbidden", "you cannot approve your own request")
		return
	case errors.Is(err, store.ErrInvalidTransition):
		writeError(w, r, http.StatusConflict, "invalid_transition", "approval request is not pending")
		return
	case err != nil:
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionInventoryApprove, "approval", id, nil, nil)
	w.WriteHeader(http.StatusNoContent)
}

// handleRejectApproval rejects a pending approval request.
func (s *server) handleRejectApproval(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	actor := userFromContext(r.Context())
	err := s.store.RejectApproval(r.Context(), id, actor.ID)
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, r, http.StatusNotFound, "not_found", "approval request not found")
		return
	case errors.Is(err, store.ErrSelfApproval):
		writeError(w, r, http.StatusForbidden, "forbidden", "you cannot reject your own request")
		return
	case errors.Is(err, store.ErrInvalidTransition):
		writeError(w, r, http.StatusConflict, "invalid_transition", "approval request is not pending")
		return
	case err != nil:
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionInventoryReject, "approval", id, nil, nil)
	w.WriteHeader(http.StatusNoContent)
}

// ---- returns / damage / quarantine / transfer / count ----

type batchActionRequest struct {
	Quantity float64 `json:"quantity"`
	Reason   string  `json:"reason"`
}

// handleReturnStock returns quantity to a batch.
func (s *server) handleReturnStock(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req batchActionRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Quantity <= 0 || req.Reason == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "a positive quantity and reason are required")
		return
	}
	actor := userFromContext(r.Context())
	if err := s.store.ReturnStock(r.Context(), id, req.Quantity, req.Reason, actor.ID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "batch not found")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionInventoryReturn, "batch", id, nil, map[string]any{"quantity": req.Quantity, "reason": req.Reason})
	w.WriteHeader(http.StatusNoContent)
}

// handleDamageStock writes off damaged quantity.
func (s *server) handleDamageStock(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req batchActionRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Quantity <= 0 || req.Reason == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "a positive quantity and reason are required")
		return
	}
	actor := userFromContext(r.Context())
	if err := s.store.DamageStock(r.Context(), id, req.Quantity, req.Reason, actor.ID); err != nil {
		if errors.Is(err, store.ErrInsufficientStock) {
			writeError(w, r, http.StatusConflict, "insufficient_stock", "damage quantity exceeds stock on hand")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionInventoryDamage, "batch", id, nil, map[string]any{"quantity": req.Quantity, "reason": req.Reason})
	w.WriteHeader(http.StatusNoContent)
}

type quarantineRequest struct {
	Reason string `json:"reason"`
}

// handleQuarantineBatch quarantines a batch.
func (s *server) handleQuarantineBatch(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req quarantineRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Reason == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "reason is required")
		return
	}
	actor := userFromContext(r.Context())
	if err := s.store.QuarantineBatch(r.Context(), id, req.Reason, actor.ID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "batch not found")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionInventoryDamage, "batch", id, nil, map[string]any{"reason": req.Reason, "action": "quarantine"})
	w.WriteHeader(http.StatusNoContent)
}

type transferRequest struct {
	FromBatchID string  `json:"fromBatchId"`
	ToBatchID   string  `json:"toBatchId"`
	Quantity    float64 `json:"quantity"`
	Reason      string  `json:"reason"`
}

// handleTransferStock transfers quantity between batches.
func (s *server) handleTransferStock(w http.ResponseWriter, r *http.Request) {
	var req transferRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.FromBatchID == "" || req.ToBatchID == "" || req.Quantity <= 0 || req.Reason == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "fromBatchId, toBatchId, a positive quantity, and reason are required")
		return
	}
	actor := userFromContext(r.Context())
	if err := s.store.TransferStock(r.Context(), store.TransferStockParams{
		FromBatchID: req.FromBatchID, ToBatchID: req.ToBatchID, Quantity: req.Quantity, Reason: req.Reason, PerformedBy: actor.ID,
	}); err != nil {
		if errors.Is(err, store.ErrInsufficientStock) {
			writeError(w, r, http.StatusConflict, "insufficient_stock", "source batch has insufficient stock")
			return
		}
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "batch not found")
			return
		}
		writeError(w, r, http.StatusConflict, "conflict", err.Error())
		return
	}
	s.recordAudit(r, domain.ActionInventoryTransfer, "batch", req.FromBatchID, nil, map[string]any{
		"toBatchId": req.ToBatchID, "quantity": req.Quantity, "reason": req.Reason,
	})
	w.WriteHeader(http.StatusNoContent)
}

type stockCountRequest struct {
	BatchID         string  `json:"batchId"`
	CountedQuantity float64 `json:"countedQuantity"`
}

type stockCountResponse struct {
	ID              string  `json:"id"`
	BatchID         string  `json:"batchId"`
	SystemQuantity  float64 `json:"systemQuantity"`
	CountedQuantity float64 `json:"countedQuantity"`
	Variance        float64 `json:"variance"`
	CreatedAt       string  `json:"createdAt"`
}

// handleStockCount records a physical count and reconciles variance.
func (s *server) handleStockCount(w http.ResponseWriter, r *http.Request) {
	var req stockCountRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.BatchID == "" || req.CountedQuantity < 0 {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "batchId and a non-negative countedQuantity are required")
		return
	}
	actor := userFromContext(r.Context())
	sc, err := s.store.CreateStockCount(r.Context(), store.CreateStockCountParams{
		BatchID: req.BatchID, CountedQuantity: req.CountedQuantity, CountedBy: actor.ID,
	})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "batch not found")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionInventoryCount, "batch", req.BatchID, nil, map[string]any{
		"countedQuantity": req.CountedQuantity, "variance": sc.Variance,
	})
	writeJSON(w, http.StatusCreated, stockCountResponse{
		ID:              sc.ID,
		BatchID:         sc.BatchID,
		SystemQuantity:  sc.SystemQuantity,
		CountedQuantity: sc.CountedQuantity,
		Variance:        sc.Variance,
		CreatedAt:       sc.CreatedAt.UTC().Format(timeRFC3339),
	})
}

// ---- movements & alerts ----

type movementResponse struct {
	ID             string  `json:"id"`
	MedicineID     string  `json:"medicineId"`
	BatchID        *string `json:"batchId,omitempty"`
	MovementType   string  `json:"movementType"`
	Quantity       float64 `json:"quantity"`
	QuantityBefore float64 `json:"quantityBefore"`
	QuantityAfter  float64 `json:"quantityAfter"`
	Reason         string  `json:"reason,omitempty"`
	ReferenceType  string  `json:"referenceType,omitempty"`
	PerformedBy    string  `json:"performedBy"`
	CreatedAt      string  `json:"createdAt"`
}

// handleListMovements lists stock movements.
func (s *server) handleListMovements(w http.ResponseWriter, r *http.Request) {
	medicineID := r.URL.Query().Get("medicineId")
	if medicineID == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "medicineId query parameter is required")
		return
	}
	var batchID *string
	if v := r.URL.Query().Get("batchId"); v != "" {
		batchID = &v
	}
	limit, offset := pagination(r)
	movements, err := s.store.ListMovements(r.Context(), medicineID, batchID, limit, offset)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]movementResponse, 0, len(movements))
	for _, m := range movements {
		out = append(out, movementResponse{
			ID:             m.ID,
			MedicineID:     m.MedicineID,
			BatchID:        m.BatchID,
			MovementType:   m.MovementType,
			Quantity:       m.Quantity,
			QuantityBefore: m.QuantityBefore,
			QuantityAfter:  m.QuantityAfter,
			Reason:         m.Reason,
			ReferenceType:  m.ReferenceType,
			PerformedBy:    m.PerformedBy,
			CreatedAt:      m.CreatedAt.UTC().Format(timeRFC3339),
		})
	}
	writeJSON(w, http.StatusOK, out)
}

// handleGetAlerts returns low-stock and expiry alerts.
func (s *server) handleGetAlerts(w http.ResponseWriter, r *http.Request) {
	alerts, err := s.store.GetAlerts(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	type lowStockItem struct {
		Medicine      medicineResponse `json:"medicine"`
		TotalQuantity float64          `json:"totalQuantity"`
	}
	type alertBatch struct {
		batchResponse
		MedicineName string `json:"medicineName"`
		MedicineCode string `json:"medicineCode"`
	}
	low := make([]lowStockItem, 0, len(alerts.LowStock))
	for _, item := range alerts.LowStock {
		low = append(low, lowStockItem{Medicine: newMedicineResponse(&item.Medicine), TotalQuantity: item.TotalQuantity})
	}
	expiring := make([]alertBatch, 0, len(alerts.Expiring))
	for _, ab := range alerts.Expiring {
		expiring = append(expiring, alertBatch{batchResponse: newBatchResponse(&ab.Batch), MedicineName: ab.MedicineName, MedicineCode: ab.MedicineCode})
	}
	expired := make([]alertBatch, 0, len(alerts.Expired))
	for _, ab := range alerts.Expired {
		expired = append(expired, alertBatch{batchResponse: newBatchResponse(&ab.Batch), MedicineName: ab.MedicineName, MedicineCode: ab.MedicineCode})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"lowStock": low,
		"expiring": expiring,
		"expired":  expired,
	})
}

// ---- allergy & interaction checks ----

// handleCheckAllergies returns the patient's known allergies.
func (s *server) handleCheckAllergies(w http.ResponseWriter, r *http.Request) {
	patientID := r.URL.Query().Get("patientId")
	if patientID == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "patientId query parameter is required")
		return
	}
	allergies, err := s.store.GetPatientAllergies(r.Context(), patientID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"allergies": allergies,
		"count":     len(allergies),
	})
}

// handleCheckInteractions returns potential drug interactions for a medication.
func (s *server) handleCheckInteractions(w http.ResponseWriter, r *http.Request) {
	patientID := r.URL.Query().Get("patientId")
	medication := r.URL.Query().Get("medication")
	if patientID == "" || medication == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "patientId and medication query parameters are required")
		return
	}
	interactions, err := s.store.CheckDrugInteractions(r.Context(), patientID, medication)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"interactions": interactions,
		"count":        len(interactions),
	})
}

// ---- dispense status transitions ----

type dispenseStatusRequest struct {
	Status string `json:"status"`
}

// handleUpdateDispenseStatus transitions a dispensation's workflow status.
func (s *server) handleUpdateDispenseStatus(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req dispenseStatusRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Status != "ready_for_pickup" && req.Status != "dispensed" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "status must be 'ready_for_pickup' or 'dispensed'")
		return
	}
	actor := userFromContext(r.Context())
	disp, err := s.store.UpdateDispenseStatus(r.Context(), store.UpdateDispenseStatusParams{
		DispensationID: id,
		DispenseStatus: req.Status,
		SignOffBy:      actor.ID,
	})
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, r, http.StatusNotFound, "not_found", "dispensation not found")
		return
	case errors.Is(err, store.ErrInvalidTransition):
		writeError(w, r, http.StatusConflict, "invalid_transition", "invalid status transition")
		return
	case err != nil:
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionInventoryDispense, "dispensation", id, nil, map[string]any{"newStatus": req.Status})
	writeJSON(w, http.StatusOK, newDispensationResponse(disp))
}

// ---- FIFO batch list for dispense drawer ----

type batchFifoResponse struct {
	ID                string  `json:"id"`
	MedicineID        string  `json:"medicineId"`
	BatchNumber       string  `json:"batchNumber"`
	ManufacturingDate *string `json:"manufacturingDate,omitempty"`
	ExpiryDate        *string `json:"expiryDate,omitempty"`
	QuantityOnHand    float64 `json:"quantityOnHand"`
	SellingPrice      float64 `json:"sellingPrice"`
	Supplier          string  `json:"supplier"`
	Status            string  `json:"status"`
	FIFOPriority      int     `json:"fifoPriority"`
	TotalStock        float64 `json:"totalStock"`
}

func newBatchFifoResponse(bf store.BatchWithFifoInfo) batchFifoResponse {
	return batchFifoResponse{
		ID:                bf.Batch.ID,
		MedicineID:        bf.Batch.MedicineID,
		BatchNumber:       bf.Batch.BatchNumber,
		ManufacturingDate: bf.Batch.ManufacturingDate,
		ExpiryDate:        bf.Batch.ExpiryDate,
		QuantityOnHand:    bf.Batch.QuantityOnHand,
		SellingPrice:      bf.Batch.SellingPrice,
		Supplier:          bf.Batch.Supplier,
		Status:            bf.Batch.Status,
		FIFOPriority:      bf.FIFOPriority,
		TotalStock:        bf.TotalStock,
	}
}

// handleListBatchesFifo returns a medicine's batches ordered by FIFO.
func (s *server) handleListBatchesFifo(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	batches, err := s.store.ListBatchesWithFifo(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]batchFifoResponse, 0, len(batches))
	for _, b := range batches {
		out = append(out, newBatchFifoResponse(b))
	}
	writeJSON(w, http.StatusOK, out)
}

// ---- enhanced dispense ----

type enhancedDispenseRequest struct {
	OrderID                string                `json:"orderId"`
	Items                  []dispenseItemRequest `json:"items"`
	Notes                  string                `json:"notes"`
	AllergyCheckPassed     bool                  `json:"allergyCheckPassed"`
	InteractionCheckPassed bool                  `json:"interactionCheckPassed"`
	CounselingNotes        string                `json:"counselingNotes"`
	DispenseStatus         string                `json:"dispenseStatus"` // optional; defaults to pending_verification
}

// handleEnhancedDispense fills a prescription with safety check tracking.
func (s *server) handleEnhancedDispense(w http.ResponseWriter, r *http.Request) {
	var req enhancedDispenseRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.OrderID == "" || len(req.Items) == 0 {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "orderId and at least one item are required")
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
	if order.Status == domain.OrderStatusCompleted {
		writeError(w, r, http.StatusConflict, "already_dispensed", "prescription already dispensed")
		return
	}
	if order.Status == domain.OrderStatusCancelled || order.Status == domain.OrderStatusDraft {
		writeError(w, r, http.StatusConflict, "invalid_transition", "order is not in a dispensable state")
		return
	}

	items := make([]store.DispenseItemParams, 0, len(req.Items))
	for _, it := range req.Items {
		if it.Quantity <= 0 {
			writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "item quantity must be positive")
			return
		}
		items = append(items, store.DispenseItemParams{MedicineID: it.MedicineID, Quantity: it.Quantity})
	}

	actor := userFromContext(r.Context())
	status := req.DispenseStatus
	if status == "" {
		status = "pending_verification"
	}
	disp, err := s.store.EnhancedDispense(r.Context(), store.EnhancedDispenseParams{
		DispenseParams: store.DispenseParams{
			OrderID:     req.OrderID,
			Items:       items,
			Notes:       req.Notes,
			DispensedBy: actor.ID,
		},
		AllergyCheckPassed:     req.AllergyCheckPassed,
		InteractionCheckPassed: req.InteractionCheckPassed,
		CounselingNotes:        req.CounselingNotes,
		DispenseStatus:         status,
	})
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, r, http.StatusNotFound, "not_found", "medicine not found")
		return
	case errors.Is(err, store.ErrInsufficientStock):
		writeError(w, r, http.StatusConflict, "insufficient_stock", "not enough dispensable stock")
		return
	case errors.Is(err, store.ErrNotDispensable):
		writeError(w, r, http.StatusConflict, "not_dispensable", "medicine or batch is not dispensable")
		return
	case errors.Is(err, store.ErrAlreadyDispensed):
		writeError(w, r, http.StatusConflict, "already_dispensed", "prescription already dispensed")
		return
	case err != nil:
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionInventoryDispense, "patient", order.PatientID, nil, map[string]any{
		"orderNo": order.OrderNo, "dispensationNo": disp.DispensationNo,
		"allergyCheck": req.AllergyCheckPassed, "interactionCheck": req.InteractionCheckPassed,
	})
	writeJSON(w, http.StatusCreated, newDispensationResponse(disp))
}
