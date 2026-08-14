package httpapi

import (
	"errors"
	"net/http"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

// ---- categories ----

type assetCategoryResponse struct {
	ID       string `json:"id"`
	Code     string `json:"code"`
	Name     string `json:"name"`
	Tracking string `json:"tracking"`
}

// handleListAssetCategories lists the seeded asset categories.
func (s *server) handleListAssetCategories(w http.ResponseWriter, r *http.Request) {
	categories, err := s.store.ListAssetCategories(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]assetCategoryResponse, 0, len(categories))
	for _, c := range categories {
		out = append(out, assetCategoryResponse{ID: c.ID, Code: c.Code, Name: c.Name, Tracking: c.Tracking})
	}
	writeJSON(w, http.StatusOK, out)
}

// ---- assets ----

type assetResponse struct {
	ID             string  `json:"id"`
	AssetNo        string  `json:"assetNo"`
	Name           string  `json:"name"`
	CategoryID     string  `json:"categoryId"`
	CategoryCode   string  `json:"categoryCode"`
	CategoryName   string  `json:"categoryName"`
	Tracking       string  `json:"tracking"`
	SerialNumber   string  `json:"serialNumber,omitempty"`
	Manufacturer   string  `json:"manufacturer,omitempty"`
	Supplier       string  `json:"supplier,omitempty"`
	PurchaseDate   *string `json:"purchaseDate,omitempty"`
	Cost           float64 `json:"cost"`
	Location       string  `json:"location,omitempty"`
	DepartmentID   *string `json:"departmentId,omitempty"`
	DepartmentName string  `json:"departmentName,omitempty"`
	CustodianID    *string `json:"custodianId,omitempty"`
	Condition      string  `json:"condition"`
	WarrantyExpiry *string `json:"warrantyExpiry,omitempty"`
	Status         string  `json:"status"`
	QuantityOnHand float64 `json:"quantityOnHand"`
	Notes          string  `json:"notes,omitempty"`
	CreatedAt      string  `json:"createdAt"`
	UpdatedAt      string  `json:"updatedAt"`
}

func newAssetResponse(a *domain.Asset) assetResponse {
	return assetResponse{
		ID:             a.ID,
		AssetNo:        a.AssetNo,
		Name:           a.Name,
		CategoryID:     a.CategoryID,
		CategoryCode:   a.CategoryCode,
		CategoryName:   a.CategoryName,
		Tracking:       a.Tracking,
		SerialNumber:   a.SerialNumber,
		Manufacturer:   a.Manufacturer,
		Supplier:       a.Supplier,
		PurchaseDate:   a.PurchaseDate,
		Cost:           a.Cost,
		Location:       a.Location,
		DepartmentID:   a.DepartmentID,
		DepartmentName: a.DepartmentName,
		CustodianID:    a.CustodianID,
		Condition:      a.Condition,
		WarrantyExpiry: a.WarrantyExpiry,
		Status:         a.Status,
		QuantityOnHand: a.QuantityOnHand,
		Notes:          a.Notes,
		CreatedAt:      a.CreatedAt.UTC().Format(timeRFC3339),
		UpdatedAt:      a.UpdatedAt.UTC().Format(timeRFC3339),
	}
}

type createAssetRequest struct {
	Name           string  `json:"name"`
	CategoryID     string  `json:"categoryId"`
	SerialNumber   string  `json:"serialNumber"`
	Manufacturer   string  `json:"manufacturer"`
	Supplier       string  `json:"supplier"`
	PurchaseDate   string  `json:"purchaseDate"`
	Cost           float64 `json:"cost"`
	Location       string  `json:"location"`
	DepartmentID   string  `json:"departmentId"`
	CustodianID    string  `json:"custodianId"`
	Condition      string  `json:"condition"`
	WarrantyExpiry string  `json:"warrantyExpiry"`
	QuantityOnHand float64 `json:"quantityOnHand"`
	Notes          string  `json:"notes"`
}

// handleCreateAsset registers an asset.
func (s *server) handleCreateAsset(w http.ResponseWriter, r *http.Request) {
	var req createAssetRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Name == "" || req.CategoryID == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "name and categoryId are required")
		return
	}
	actor := userFromContext(r.Context())
	var deptID, custID *string
	if req.DepartmentID != "" {
		deptID = &req.DepartmentID
	}
	if req.CustodianID != "" {
		custID = &req.CustodianID
	}
	a, err := s.store.CreateAsset(r.Context(), store.CreateAssetParams{
		Name:           req.Name,
		CategoryID:     req.CategoryID,
		SerialNumber:   req.SerialNumber,
		Manufacturer:   req.Manufacturer,
		Supplier:       req.Supplier,
		PurchaseDate:   req.PurchaseDate,
		Cost:           req.Cost,
		Location:       req.Location,
		DepartmentID:   deptID,
		CustodianID:    custID,
		Condition:      req.Condition,
		WarrantyExpiry: req.WarrantyExpiry,
		QuantityOnHand: req.QuantityOnHand,
		Notes:          req.Notes,
		CreatedBy:      actor.ID,
	})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "category not found")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionAssetCreate, "asset", a.ID, nil, map[string]any{
		"assetNo": a.AssetNo, "name": a.Name, "category": a.CategoryCode,
	})
	writeJSON(w, http.StatusCreated, newAssetResponse(a))
}

// handleListAssets lists assets with optional filters.
func (s *server) handleListAssets(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)
	assets, err := s.store.ListAssets(r.Context(), store.ListAssetParams{
		CategoryID: r.URL.Query().Get("categoryId"),
		Status:     r.URL.Query().Get("status"),
		Department: r.URL.Query().Get("departmentId"),
		Search:     r.URL.Query().Get("q"),
		Limit:      limit,
		Offset:     offset,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]assetResponse, 0, len(assets))
	for i := range assets {
		out = append(out, newAssetResponse(&assets[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

// handleGetAsset returns an asset with its movements and status history.
func (s *server) handleGetAsset(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	a, err := s.store.GetAsset(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "asset not found")
		return
	}
	movements, _ := s.store.ListAssetMovements(r.Context(), id, 50, 0)
	movResp := make([]assetMovementResponse, 0, len(movements))
	for i := range movements {
		movResp = append(movResp, newAssetMovementResponse(&movements[i]))
	}
	history, _ := s.store.ListAssetStatusChanges(r.Context(), id, 50, 0)
	histResp := make([]assetStatusChangeResponse, 0, len(history))
	for i := range history {
		histResp = append(histResp, newAssetStatusChangeResponse(&history[i]))
	}
	s.recordAudit(r, domain.ActionAssetViewed, "asset", id, nil, nil)
	writeJSON(w, http.StatusOK, map[string]any{
		"asset":         newAssetResponse(a),
		"movements":     movResp,
		"statusHistory": histResp,
	})
}

type updateAssetRequest struct {
	Name           string   `json:"name"`
	SerialNumber   string   `json:"serialNumber"`
	Manufacturer   string   `json:"manufacturer"`
	Supplier       string   `json:"supplier"`
	PurchaseDate   *string  `json:"purchaseDate"`
	Cost           *float64 `json:"cost"`
	Location       string   `json:"location"`
	DepartmentID   *string  `json:"departmentId"`
	CustodianID    *string  `json:"custodianId"`
	Condition      string   `json:"condition"`
	WarrantyExpiry *string  `json:"warrantyExpiry"`
	Notes          string   `json:"notes"`
}

// handleUpdateAsset updates an asset master record.
func (s *server) handleUpdateAsset(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	existing, err := s.store.GetAsset(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "asset not found")
		return
	}
	var req updateAssetRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Name == "" {
		req.Name = existing.Name
	}

	purchaseDate, warranty := existing.PurchaseDate, existing.WarrantyExpiry
	if req.PurchaseDate != nil {
		purchaseDate = req.PurchaseDate
	}
	if req.WarrantyExpiry != nil {
		warranty = req.WarrantyExpiry
	}
	cost := existing.Cost
	if req.Cost != nil {
		cost = *req.Cost
	}
	departmentID, custodianID := existing.DepartmentID, existing.CustodianID
	if req.DepartmentID != nil {
		departmentID = req.DepartmentID
	}
	if req.CustodianID != nil {
		custodianID = req.CustodianID
	}
	condition := req.Condition
	if condition == "" {
		condition = existing.Condition
	}

	params := store.UpdateAssetParams{
		Name:           req.Name,
		SerialNumber:   req.SerialNumber,
		Manufacturer:   req.Manufacturer,
		Supplier:       req.Supplier,
		PurchaseDate:   stringValue(purchaseDate),
		Cost:           cost,
		Location:       req.Location,
		DepartmentID:   departmentID,
		CustodianID:    custodianID,
		Condition:      condition,
		WarrantyExpiry: stringValue(warranty),
		Notes:          req.Notes,
	}
	if err := s.store.UpdateAsset(r.Context(), id, params); err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionAssetUpdate, "asset", id, nil, map[string]any{"name": req.Name})
	w.WriteHeader(http.StatusNoContent)
}

// ---- status changes ----

type changeAssetStatusRequest struct {
	Status string `json:"status"`
	Reason string `json:"reason"`
}

type assetStatusChangeResponse struct {
	ID         string `json:"id"`
	AssetID    string `json:"assetId"`
	FromStatus string `json:"fromStatus"`
	ToStatus   string `json:"toStatus"`
	Reason     string `json:"reason,omitempty"`
	ChangedBy  string `json:"changedBy"`
	CreatedAt  string `json:"createdAt"`
}

func newAssetStatusChangeResponse(sc *domain.AssetStatusChange) assetStatusChangeResponse {
	return assetStatusChangeResponse{
		ID:         sc.ID,
		AssetID:    sc.AssetID,
		FromStatus: sc.FromStatus,
		ToStatus:   sc.ToStatus,
		Reason:     sc.Reason,
		ChangedBy:  sc.ChangedBy,
		CreatedAt:  sc.CreatedAt.UTC().Format(timeRFC3339),
	}
}

// handleChangeAssetStatus records an auditable status transition.
func (s *server) handleChangeAssetStatus(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req changeAssetStatusRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Status == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "status is required")
		return
	}
	actor := userFromContext(r.Context())
	sc, err := s.store.ChangeAssetStatus(r.Context(), id, req.Status, req.Reason, actor.ID)
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, r, http.StatusNotFound, "not_found", "asset not found")
		return
	case errors.Is(err, store.ErrInvalidAssetTransition):
		writeError(w, r, http.StatusConflict, "invalid_transition", "asset status change is not allowed")
		return
	case err != nil:
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionAssetStatusChange, "asset", id, nil, map[string]any{
		"fromStatus": sc.FromStatus, "toStatus": sc.ToStatus, "reason": req.Reason,
	})
	writeJSON(w, http.StatusCreated, newAssetStatusChangeResponse(sc))
}

// ---- transfers ----

type transferAssetRequest struct {
	Quantity       float64 `json:"quantity"`
	DepartmentID   string  `json:"departmentId"`
	Location       string  `json:"location"`
	CustodianID    string  `json:"custodianId"`
	FromDepartment string  `json:"fromDepartmentId"`
	FromLocation   string  `json:"fromLocation"`
	FromCustodian  string  `json:"fromCustodianId"`
	Reason         string  `json:"reason"`
}

type assetTransferResponse struct {
	ID             string  `json:"id"`
	AssetID        string  `json:"assetId"`
	Quantity       float64 `json:"quantity"`
	FromDepartment *string `json:"fromDepartmentId,omitempty"`
	ToDepartment   *string `json:"departmentId,omitempty"`
	FromLocation   string  `json:"fromLocation,omitempty"`
	ToLocation     string  `json:"location,omitempty"`
	FromCustodian  *string `json:"fromCustodianId,omitempty"`
	ToCustodian    *string `json:"custodianId,omitempty"`
	Reason         string  `json:"reason,omitempty"`
	TransferredBy  string  `json:"transferredBy"`
	CreatedAt      string  `json:"createdAt"`
}

func newAssetTransferResponse(t *domain.AssetTransfer) assetTransferResponse {
	return assetTransferResponse{
		ID:             t.ID,
		AssetID:        t.AssetID,
		Quantity:       t.Quantity,
		FromDepartment: t.FromDepartment,
		ToDepartment:   t.ToDepartment,
		FromLocation:   t.FromLocation,
		ToLocation:     t.ToLocation,
		FromCustodian:  t.FromCustodian,
		ToCustodian:    t.ToCustodian,
		Reason:         t.Reason,
		TransferredBy:  t.TransferredBy,
		CreatedAt:      t.CreatedAt.UTC().Format(timeRFC3339),
	}
}

// handleTransferAsset transfers quantity and/or custody between locations.
func (s *server) handleTransferAsset(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req transferAssetRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.DepartmentID == "" && req.Location == "" && req.CustodianID == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "departmentId, location, or custodianId is required")
		return
	}
	actor := userFromContext(r.Context())
	var fromDept, fromCust, toDept, toCust *string
	if req.FromDepartment != "" {
		fromDept = &req.FromDepartment
	}
	if req.FromCustodian != "" {
		fromCust = &req.FromCustodian
	}
	if req.DepartmentID != "" {
		toDept = &req.DepartmentID
	}
	if req.CustodianID != "" {
		toCust = &req.CustodianID
	}
	t, err := s.store.TransferAsset(r.Context(), store.TransferAssetParams{
		AssetID:        id,
		Quantity:       req.Quantity,
		FromDepartment: fromDept,
		ToDepartment:   toDept,
		FromLocation:   req.FromLocation,
		ToLocation:     req.Location,
		FromCustodian:  fromCust,
		ToCustodian:    toCust,
		Reason:         req.Reason,
		TransferredBy:  actor.ID,
	})
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, r, http.StatusNotFound, "not_found", "asset not found")
		return
	case errors.Is(err, store.ErrInsufficientStock):
		writeError(w, r, http.StatusConflict, "insufficient_stock", "transfer quantity exceeds quantity on hand")
		return
	case err != nil:
		writeError(w, r, http.StatusConflict, "conflict", err.Error())
		return
	}
	s.recordAudit(r, domain.ActionAssetTransfer, "asset", id, nil, map[string]any{
		"quantity": t.Quantity, "toDepartmentId": req.DepartmentID, "toLocation": req.Location, "toCustodianId": req.CustodianID,
	})
	writeJSON(w, http.StatusCreated, newAssetTransferResponse(t))
}

// ---- adjustments & counts ----

type adjustAssetRequest struct {
	Quantity float64 `json:"quantity"`
	Reason   string  `json:"reason"`
}

// handleAdjustAsset applies a signed quantity delta to a quantity-tracked asset.
func (s *server) handleAdjustAsset(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req adjustAssetRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Quantity == 0 || req.Reason == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "a non-zero quantity and reason are required")
		return
	}
	actor := userFromContext(r.Context())
	err := s.store.AdjustAssetQuantity(r.Context(), id, req.Quantity, req.Reason, actor.ID)
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, r, http.StatusNotFound, "not_found", "asset not found")
		return
	case errors.Is(err, store.ErrInsufficientStock):
		writeError(w, r, http.StatusConflict, "insufficient_stock", "adjustment would take quantity below zero")
		return
	case err != nil:
		writeError(w, r, http.StatusConflict, "conflict", err.Error())
		return
	}
	s.recordAudit(r, domain.ActionAssetAdjust, "asset", id, nil, map[string]any{"quantity": req.Quantity, "reason": req.Reason})
	w.WriteHeader(http.StatusNoContent)
}

type assetCountRequest struct {
	AssetID         string  `json:"assetId"`
	CountedQuantity float64 `json:"countedQuantity"`
}

type assetCountResponse struct {
	ID              string  `json:"id"`
	AssetID         string  `json:"assetId"`
	SystemQuantity  float64 `json:"systemQuantity"`
	CountedQuantity float64 `json:"countedQuantity"`
	Variance        float64 `json:"variance"`
	CreatedAt       string  `json:"createdAt"`
}

// handleAssetCount records a physical count and reconciles variance.
func (s *server) handleAssetCount(w http.ResponseWriter, r *http.Request) {
	var req assetCountRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.AssetID == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "assetId is required")
		return
	}
	if req.CountedQuantity < 0 {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "countedQuantity must be non-negative")
		return
	}
	actor := userFromContext(r.Context())
	sc, err := s.store.CreateAssetCount(r.Context(), store.CreateAssetCountParams{
		AssetID: req.AssetID, CountedQuantity: req.CountedQuantity, CountedBy: actor.ID,
	})
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, r, http.StatusNotFound, "not_found", "asset not found")
		return
	case err != nil:
		writeError(w, r, http.StatusConflict, "conflict", err.Error())
		return
	}
	s.recordAudit(r, domain.ActionAssetCount, "asset", req.AssetID, nil, map[string]any{
		"countedQuantity": req.CountedQuantity, "variance": sc.Variance,
	})
	writeJSON(w, http.StatusCreated, assetCountResponse{
		ID:              sc.ID,
		AssetID:         sc.AssetID,
		SystemQuantity:  sc.SystemQuantity,
		CountedQuantity: sc.CountedQuantity,
		Variance:        sc.Variance,
		CreatedAt:       sc.CreatedAt.UTC().Format(timeRFC3339),
	})
}

type assetMovementResponse struct {
	ID             string  `json:"id"`
	AssetID        string  `json:"assetId"`
	MovementType   string  `json:"movementType"`
	Quantity       float64 `json:"quantity"`
	QuantityBefore float64 `json:"quantityBefore"`
	QuantityAfter  float64 `json:"quantityAfter"`
	Reason         string  `json:"reason,omitempty"`
	ReferenceType  string  `json:"referenceType,omitempty"`
	PerformedBy    string  `json:"performedBy"`
	CreatedAt      string  `json:"createdAt"`
}

func newAssetMovementResponse(m *domain.AssetMovement) assetMovementResponse {
	return assetMovementResponse{
		ID:             m.ID,
		AssetID:        m.AssetID,
		MovementType:   m.MovementType,
		Quantity:       m.Quantity,
		QuantityBefore: m.QuantityBefore,
		QuantityAfter:  m.QuantityAfter,
		Reason:         m.Reason,
		ReferenceType:  m.ReferenceType,
		PerformedBy:    m.PerformedBy,
		CreatedAt:      m.CreatedAt.UTC().Format(timeRFC3339),
	}
}

// handleListAssetMovements lists an asset's movement ledger.
func (s *server) handleListAssetMovements(w http.ResponseWriter, r *http.Request) {
	assetID := r.URL.Query().Get("assetId")
	if assetID == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "assetId query parameter is required")
		return
	}
	limit, offset := pagination(r)
	movements, err := s.store.ListAssetMovements(r.Context(), assetID, limit, offset)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]assetMovementResponse, 0, len(movements))
	for i := range movements {
		out = append(out, newAssetMovementResponse(&movements[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

// ---- maintenance ----

type serviceProviderResponse struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	ContactPhone string `json:"contactPhone,omitempty"`
	ContactEmail string `json:"contactEmail,omitempty"`
	Address      string `json:"address,omitempty"`
	Notes        string `json:"notes,omitempty"`
	Active       bool   `json:"active"`
}

func newServiceProviderResponse(sp *domain.ServiceProvider) serviceProviderResponse {
	return serviceProviderResponse{
		ID:           sp.ID,
		Name:         sp.Name,
		ContactPhone: sp.ContactPhone,
		ContactEmail: sp.ContactEmail,
		Address:      sp.Address,
		Notes:        sp.Notes,
		Active:       sp.Active,
	}
}

type createServiceProviderRequest struct {
	Name         string `json:"name"`
	ContactPhone string `json:"contactPhone"`
	ContactEmail string `json:"contactEmail"`
	Address      string `json:"address"`
	Notes        string `json:"notes"`
}

// handleCreateServiceProvider registers a maintenance service provider.
func (s *server) handleCreateServiceProvider(w http.ResponseWriter, r *http.Request) {
	var req createServiceProviderRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Name == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "name is required")
		return
	}
	sp, err := s.store.CreateServiceProvider(r.Context(), store.CreateServiceProviderParams{
		Name: req.Name, ContactPhone: req.ContactPhone, ContactEmail: req.ContactEmail,
		Address: req.Address, Notes: req.Notes,
	})
	if err != nil {
		writeError(w, r, http.StatusConflict, "conflict", "service provider already exists")
		return
	}
	s.recordAudit(r, domain.ActionProviderCreate, "service_provider", sp.ID, nil, map[string]any{"name": sp.Name})
	writeJSON(w, http.StatusCreated, newServiceProviderResponse(sp))
}

// handleListServiceProviders lists active providers.
func (s *server) handleListServiceProviders(w http.ResponseWriter, r *http.Request) {
	providers, err := s.store.ListServiceProviders(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]serviceProviderResponse, 0, len(providers))
	for i := range providers {
		out = append(out, newServiceProviderResponse(&providers[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

type maintenanceScheduleResponse struct {
	ID              string `json:"id"`
	AssetID         string `json:"assetId"`
	ServiceType     string `json:"serviceType"`
	FrequencyDays   int    `json:"frequencyDays"`
	NextServiceDate string `json:"nextServiceDate"`
	Active          bool   `json:"active"`
	CreatedBy       string `json:"createdBy"`
	CreatedAt       string `json:"createdAt"`
}

func newMaintenanceScheduleResponse(ms *domain.MaintenanceSchedule) maintenanceScheduleResponse {
	return maintenanceScheduleResponse{
		ID:              ms.ID,
		AssetID:         ms.AssetID,
		ServiceType:     ms.ServiceType,
		FrequencyDays:   ms.FrequencyDays,
		NextServiceDate: ms.NextServiceDate,
		Active:          ms.Active,
		CreatedBy:       ms.CreatedBy,
		CreatedAt:       ms.CreatedAt.UTC().Format(timeRFC3339),
	}
}

type createMaintenanceScheduleRequest struct {
	AssetID         string `json:"assetId"`
	ServiceType     string `json:"serviceType"`
	FrequencyDays   int    `json:"frequencyDays"`
	NextServiceDate string `json:"nextServiceDate"`
}

// handleCreateMaintenanceSchedule plans recurring maintenance.
func (s *server) handleCreateMaintenanceSchedule(w http.ResponseWriter, r *http.Request) {
	var req createMaintenanceScheduleRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.AssetID == "" || req.ServiceType == "" || req.FrequencyDays <= 0 || req.NextServiceDate == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "assetId, serviceType, a positive frequencyDays, and nextServiceDate are required")
		return
	}
	actor := userFromContext(r.Context())
	ms, err := s.store.CreateMaintenanceSchedule(r.Context(), store.CreateMaintenanceScheduleParams{
		AssetID:         req.AssetID,
		ServiceType:     req.ServiceType,
		FrequencyDays:   req.FrequencyDays,
		NextServiceDate: req.NextServiceDate,
		CreatedBy:       actor.ID,
	})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "asset not found")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionMaintenanceSchedule, "asset", req.AssetID, nil, map[string]any{
		"serviceType": req.ServiceType, "nextServiceDate": req.NextServiceDate,
	})
	writeJSON(w, http.StatusCreated, newMaintenanceScheduleResponse(ms))
}

// handleListMaintenanceSchedules lists schedules (optionally due only).
func (s *server) handleListMaintenanceSchedules(w http.ResponseWriter, r *http.Request) {
	dueOnly := r.URL.Query().Get("dueOnly") == "true"
	schedules, err := s.store.ListMaintenanceSchedules(r.Context(), r.URL.Query().Get("assetId"), dueOnly)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]maintenanceScheduleResponse, 0, len(schedules))
	for i := range schedules {
		out = append(out, newMaintenanceScheduleResponse(&schedules[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

type maintenanceRecordResponse struct {
	ID                string  `json:"id"`
	AssetID           string  `json:"assetId"`
	ScheduleID        *string `json:"scheduleId,omitempty"`
	ServiceProviderID *string `json:"serviceProviderId,omitempty"`
	ServiceType       string  `json:"serviceType"`
	Description       string  `json:"description,omitempty"`
	ServiceDate       string  `json:"serviceDate"`
	DowntimeHours     float64 `json:"downtimeHours"`
	Cost              float64 `json:"cost"`
	NextServiceDate   *string `json:"nextServiceDate,omitempty"`
	PerformedBy       string  `json:"performedBy"`
	CreatedAt         string  `json:"createdAt"`
}

func newMaintenanceRecordResponse(mr *domain.MaintenanceRecord) maintenanceRecordResponse {
	return maintenanceRecordResponse{
		ID:                mr.ID,
		AssetID:           mr.AssetID,
		ScheduleID:        mr.ScheduleID,
		ServiceProviderID: mr.ServiceProviderID,
		ServiceType:       mr.ServiceType,
		Description:       mr.Description,
		ServiceDate:       mr.ServiceDate,
		DowntimeHours:     mr.DowntimeHours,
		Cost:              mr.Cost,
		NextServiceDate:   mr.NextServiceDate,
		PerformedBy:       mr.PerformedBy,
		CreatedAt:         mr.CreatedAt.UTC().Format(timeRFC3339),
	}
}

type createMaintenanceRecordRequest struct {
	ScheduleID        string  `json:"scheduleId"`
	ServiceProviderID string  `json:"serviceProviderId"`
	ServiceType       string  `json:"serviceType"`
	Description       string  `json:"description"`
	ServiceDate       string  `json:"serviceDate"`
	DowntimeHours     float64 `json:"downtimeHours"`
	Cost              float64 `json:"cost"`
}

// handleCreateMaintenanceRecord records completed maintenance work.
func (s *server) handleCreateMaintenanceRecord(w http.ResponseWriter, r *http.Request) {
	assetID := r.PathValue("id")
	var req createMaintenanceRecordRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.ServiceType == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "serviceType is required")
		return
	}
	actor := userFromContext(r.Context())
	var scheduleID, providerID *string
	if req.ScheduleID != "" {
		scheduleID = &req.ScheduleID
	}
	if req.ServiceProviderID != "" {
		providerID = &req.ServiceProviderID
	}
	mr, err := s.store.CreateMaintenanceRecord(r.Context(), store.CreateMaintenanceRecordParams{
		AssetID:           assetID,
		ScheduleID:        scheduleID,
		ServiceProviderID: providerID,
		ServiceType:       req.ServiceType,
		Description:       req.Description,
		ServiceDate:       req.ServiceDate,
		DowntimeHours:     req.DowntimeHours,
		Cost:              req.Cost,
		PerformedBy:       actor.ID,
	})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "asset or schedule not found")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionMaintenanceRecord, "asset", assetID, nil, map[string]any{
		"serviceType": req.ServiceType, "serviceDate": mr.ServiceDate, "cost": req.Cost,
	})
	writeJSON(w, http.StatusCreated, newMaintenanceRecordResponse(mr))
}

// handleListMaintenanceRecords lists an asset's maintenance history.
func (s *server) handleListMaintenanceRecords(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	limit, offset := pagination(r)
	records, err := s.store.ListMaintenanceRecords(r.Context(), id, limit, offset)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]maintenanceRecordResponse, 0, len(records))
	for i := range records {
		out = append(out, newMaintenanceRecordResponse(&records[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

func stringValue(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
