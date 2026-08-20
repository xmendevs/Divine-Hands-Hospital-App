package httpapi

import (
	"errors"
	"net/http"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

// ---- lab consumables ----

type labConsumableResponse struct {
	ID              string  `json:"id"`
	ItemCode        string  `json:"itemCode"`
	Name            string  `json:"name"`
	Category        string  `json:"category"`
	PackagingUnit   string  `json:"packagingUnit"`
	BatchLotNumber  string  `json:"batchLotNumber"`
	ReorderLevel    float64 `json:"reorderLevel"`
	UnitCost        float64 `json:"unitCost"`
	QuantityOnHand  float64 `json:"quantityOnHand"`
	StorageLocation string  `json:"storageLocation"`
	Supplier        string  `json:"supplier"`
	ExpiryDate      *string `json:"expiryDate,omitempty"`
	Active          bool    `json:"active"`
	Notes           string  `json:"notes,omitempty"`
	CreatedAt       string  `json:"createdAt"`
	UpdatedAt       string  `json:"updatedAt"`
}

func newLabConsumableResponse(lc *domain.LabConsumable) labConsumableResponse {
	return labConsumableResponse{
		ID:              lc.ID,
		ItemCode:        lc.ItemCode,
		Name:            lc.Name,
		Category:        lc.Category,
		PackagingUnit:   lc.PackagingUnit,
		BatchLotNumber:  lc.BatchLotNumber,
		ReorderLevel:    lc.ReorderLevel,
		UnitCost:        lc.UnitCost,
		QuantityOnHand:  lc.QuantityOnHand,
		StorageLocation: lc.StorageLocation,
		Supplier:        lc.Supplier,
		ExpiryDate:      lc.ExpiryDate,
		Active:          lc.Active,
		Notes:           lc.Notes,
		CreatedAt:       lc.CreatedAt.UTC().Format(timeRFC3339),
		UpdatedAt:       lc.UpdatedAt.UTC().Format(timeRFC3339),
	}
}

type createLabConsumableRequest struct {
	Name            string  `json:"name"`
	Category        string  `json:"category"`
	PackagingUnit   string  `json:"packagingUnit"`
	BatchLotNumber  string  `json:"batchLotNumber"`
	ReorderLevel    float64 `json:"reorderLevel"`
	UnitCost        float64 `json:"unitCost"`
	QuantityOnHand  float64 `json:"quantityOnHand"`
	StorageLocation string  `json:"storageLocation"`
	Supplier        string  `json:"supplier"`
	ExpiryDate      string  `json:"expiryDate"`
	Notes           string  `json:"notes"`
}

// handleCreateLabConsumable registers a new lab consumable.
func (s *server) handleCreateLabConsumable(w http.ResponseWriter, r *http.Request) {
	var req createLabConsumableRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Name == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "name is required")
		return
	}
	actor := userFromContext(r.Context())
	lc, err := s.store.CreateLabConsumable(r.Context(), store.CreateLabConsumableParams{
		Name:            req.Name,
		Category:        req.Category,
		PackagingUnit:   req.PackagingUnit,
		BatchLotNumber:  req.BatchLotNumber,
		ReorderLevel:    req.ReorderLevel,
		UnitCost:        req.UnitCost,
		QuantityOnHand:  req.QuantityOnHand,
		StorageLocation: req.StorageLocation,
		Supplier:        req.Supplier,
		ExpiryDate:      req.ExpiryDate,
		Notes:           req.Notes,
		CreatedBy:       actor.ID,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionInventoryReceipt, "lab_consumable", lc.ID, nil, map[string]any{
		"itemCode": lc.ItemCode, "name": lc.Name,
	})
	writeJSON(w, http.StatusCreated, newLabConsumableResponse(lc))
}

// handleListLabConsumables lists lab consumables with optional search.
func (s *server) handleListLabConsumables(w http.ResponseWriter, r *http.Request) {
	search := r.URL.Query().Get("q")
	limit, offset := pagination(r)
	consumables, err := s.store.ListLabConsumables(r.Context(), search, limit, offset)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]labConsumableResponse, 0, len(consumables))
	for i := range consumables {
		out = append(out, newLabConsumableResponse(&consumables[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

// handleGetLabConsumable returns a lab consumable by ID.
func (s *server) handleGetLabConsumable(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	lc, err := s.store.GetLabConsumable(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "lab consumable not found")
		return
	}
	writeJSON(w, http.StatusOK, newLabConsumableResponse(lc))
}

type updateLabConsumableRequest struct {
	Name            string   `json:"name"`
	Category        string   `json:"category"`
	PackagingUnit   string   `json:"packagingUnit"`
	BatchLotNumber  string   `json:"batchLotNumber"`
	ReorderLevel    *float64 `json:"reorderLevel"`
	UnitCost        *float64 `json:"unitCost"`
	QuantityOnHand  *float64 `json:"quantityOnHand"`
	StorageLocation string   `json:"storageLocation"`
	Supplier        string   `json:"supplier"`
	ExpiryDate      *string  `json:"expiryDate"`
	Notes           string   `json:"notes"`
	Active          *bool    `json:"active"`
}

// handleUpdateLabConsumable updates a lab consumable record.
func (s *server) handleUpdateLabConsumable(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	existing, err := s.store.GetLabConsumable(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "lab consumable not found")
		return
	}
	var req updateLabConsumableRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}

	params := store.UpdateLabConsumableParams{
		Name:            orStr(req.Name, existing.Name),
		Category:        orStr(req.Category, existing.Category),
		PackagingUnit:   orStr(req.PackagingUnit, existing.PackagingUnit),
		BatchLotNumber:  orStr(req.BatchLotNumber, existing.BatchLotNumber),
		ReorderLevel:    existing.ReorderLevel,
		UnitCost:        existing.UnitCost,
		QuantityOnHand:  existing.QuantityOnHand,
		StorageLocation: orStr(req.StorageLocation, existing.StorageLocation),
		Supplier:        orStr(req.Supplier, existing.Supplier),
		ExpiryDate:      stringValue(existing.ExpiryDate),
		Notes:           orStr(req.Notes, existing.Notes),
		Active:          existing.Active,
	}
	if req.ReorderLevel != nil {
		params.ReorderLevel = *req.ReorderLevel
	}
	if req.UnitCost != nil {
		params.UnitCost = *req.UnitCost
	}
	if req.QuantityOnHand != nil {
		params.QuantityOnHand = *req.QuantityOnHand
	}
	if req.ExpiryDate != nil {
		params.ExpiryDate = *req.ExpiryDate
	}
	if req.Active != nil {
		params.Active = *req.Active
	}

	if err := s.store.UpdateLabConsumable(r.Context(), id, params); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "lab consumable not found")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionInventoryAdjust, "lab_consumable", id, nil, map[string]any{"name": params.Name})
	w.WriteHeader(http.StatusNoContent)
}

// handleDeleteLabConsumable soft-deletes a lab consumable.
func (s *server) handleDeleteLabConsumable(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.store.DeleteLabConsumable(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "lab consumable not found")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionInventoryDamage, "lab_consumable", id, nil, nil)
	w.WriteHeader(http.StatusNoContent)
}

// orStr returns fallback if val is empty.
func orStr(val, fallback string) string {
	if val != "" {
		return val
	}
	return fallback
}
