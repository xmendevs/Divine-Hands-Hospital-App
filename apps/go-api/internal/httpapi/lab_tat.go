package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

// handleLabTAT returns the turnaround-time monitoring dashboard.
func (s *server) handleLabTAT(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	report, err := s.store.LabTATReport(r.Context(), limit)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, report)
}

// ---- instruments / analyzer interface ----

type instrumentResponse struct {
	ID              string  `json:"id"`
	Code            string  `json:"code"`
	Name            string  `json:"name"`
	InstrumentType  string  `json:"instrumentType"`
	Manufacturer    string  `json:"manufacturer"`
	Model           string  `json:"model"`
	Status          string  `json:"status"`
	LastConnectedAt *string `json:"lastConnectedAt,omitempty"`
	CreatedAt       string  `json:"createdAt"`
	UpdatedAt       string  `json:"updatedAt"`
}

func newInstrumentResponse(i *domain.LabInstrument) instrumentResponse {
	out := instrumentResponse{
		ID:             i.ID,
		Code:           i.Code,
		Name:           i.Name,
		InstrumentType: i.InstrumentType,
		Manufacturer:   i.Manufacturer,
		Model:          i.Model,
		Status:         i.Status,
		CreatedAt:      i.CreatedAt.UTC().Format(timeRFC3339),
		UpdatedAt:      i.UpdatedAt.UTC().Format(timeRFC3339),
	}
	if i.LastConnectedAt != nil {
		v := i.LastConnectedAt.UTC().Format(timeRFC3339)
		out.LastConnectedAt = &v
	}
	return out
}

type createInstrumentRequest struct {
	Code           string `json:"code"`
	Name           string `json:"name"`
	InstrumentType string `json:"instrumentType"`
	Manufacturer   string `json:"manufacturer"`
	Model          string `json:"model"`
	Status         string `json:"status"`
}

func (s *server) handleCreateInstrument(w http.ResponseWriter, r *http.Request) {
	var req createInstrumentRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Code == "" || req.Name == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "code and name are required")
		return
	}
	switch req.InstrumentType {
	case "", "chemistry":
		req.InstrumentType = "chemistry"
	case "haematology", "immunology", "microbiology", "coagulation", "urinalysis", "other":
	default:
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid instrumentType")
		return
	}
	if req.Status == "" {
		req.Status = "offline"
	}
	switch req.Status {
	case "online", "offline", "maintenance", "retired":
	default:
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid status")
		return
	}
	inst, err := s.store.CreateInstrument(r.Context(), domain.LabInstrument{
		Code:           req.Code,
		Name:           req.Name,
		InstrumentType: req.InstrumentType,
		Manufacturer:   req.Manufacturer,
		Model:          req.Model,
		Status:         req.Status,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionInstrumentRegister, "lab_instrument", inst.ID, nil, map[string]any{
		"code": inst.Code, "name": inst.Name, "type": inst.InstrumentType,
	})
	writeJSON(w, http.StatusCreated, newInstrumentResponse(inst))
}

func (s *server) handleListInstruments(w http.ResponseWriter, r *http.Request) {
	instruments, err := s.store.ListInstruments(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]instrumentResponse, 0, len(instruments))
	for i := range instruments {
		out = append(out, newInstrumentResponse(&instruments[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

type setInstrumentStatusRequest struct {
	Status string `json:"status"`
}

func (s *server) handleSetInstrumentStatus(w http.ResponseWriter, r *http.Request) {
	var req setInstrumentStatusRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	switch req.Status {
	case "online", "offline", "maintenance", "retired":
	default:
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "status must be online, offline, maintenance or retired")
		return
	}
	inst, err := s.store.SetInstrumentStatus(r.Context(), r.PathValue("id"), req.Status)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "instrument not found")
		return
	}
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionInstrumentStatus, "lab_instrument", inst.ID, nil, map[string]any{"status": req.Status})
	writeJSON(w, http.StatusOK, newInstrumentResponse(inst))
}

type instrumentLogResponse struct {
	ID           string          `json:"id"`
	InstrumentID string          `json:"instrumentId"`
	Direction    string          `json:"direction"`
	MessageType  string          `json:"messageType"`
	Payload      json.RawMessage `json:"payload"`
	Status       string          `json:"status"`
	Error        string          `json:"error,omitempty"`
	CreatedAt    string          `json:"createdAt"`
	ProcessedAt  *string         `json:"processedAt,omitempty"`
}

func newInstrumentLogResponse(l *domain.LabInstrumentLog) instrumentLogResponse {
	out := instrumentLogResponse{
		ID:           l.ID,
		InstrumentID: l.InstrumentID,
		Direction:    l.Direction,
		MessageType:  l.MessageType,
		Payload:      json.RawMessage(l.Payload),
		Status:       l.Status,
		Error:        l.Error,
		CreatedAt:    l.CreatedAt.UTC().Format(timeRFC3339),
	}
	if l.ProcessedAt != nil {
		v := l.ProcessedAt.UTC().Format(timeRFC3339)
		out.ProcessedAt = &v
	}
	return out
}

type queueInstrumentLogRequest struct {
	Direction   string          `json:"direction"`
	MessageType string          `json:"messageType"`
	Payload     json.RawMessage `json:"payload"`
}

func (s *server) handleQueueInstrumentLog(w http.ResponseWriter, r *http.Request) {
	var req queueInstrumentLogRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	switch req.Direction {
	case "inbound", "outbound":
	default:
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "direction must be inbound or outbound")
		return
	}
	switch req.MessageType {
	case "order", "sample", "result", "query", "ack", "error":
	default:
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid messageType")
		return
	}
	if len(req.Payload) == 0 {
		req.Payload = []byte("{}")
	}
	log, err := s.store.QueueInstrumentLog(r.Context(), r.PathValue("id"), req.Direction, req.MessageType, req.Payload)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "instrument not found")
		return
	}
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionInstrumentLog, "lab_instrument_log", log.ID, nil, map[string]any{
		"instrument": r.PathValue("id"), "direction": req.Direction, "messageType": req.MessageType,
	})
	writeJSON(w, http.StatusCreated, newInstrumentLogResponse(log))
}

func (s *server) handleListInstrumentLogs(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	logs, err := s.store.ListInstrumentLogs(r.Context(), r.PathValue("id"), status, limit)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]instrumentLogResponse, 0, len(logs))
	for i := range logs {
		out = append(out, newInstrumentLogResponse(&logs[i]))
	}
	writeJSON(w, http.StatusOK, out)
}
