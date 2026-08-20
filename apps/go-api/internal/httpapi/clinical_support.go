package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/auth"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

// handleCDSAlerts returns clinical decision-support warnings for a patient,
// optionally scoped to a proposed medication (allergy check + critical vitals).
func (s *server) handleCDSAlerts(w http.ResponseWriter, r *http.Request) {
	patientID := r.PathValue("id")
	medication := r.URL.Query().Get("medication")
	alerts, err := s.store.CheckCDS(r.Context(), patientID, medication)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"alerts": alerts})
}

// handlePatientHistory returns the one-call timeline bundle for a patient.
func (s *server) handlePatientHistory(w http.ResponseWriter, r *http.Request) {
	patientID := r.PathValue("id")
	b, err := s.store.PatientHistory(r.Context(), patientID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionNotesViewed, "patient", patientID, nil, map[string]any{"scope": "history"})
	writeJSON(w, http.StatusOK, buildHistoryResponse(b))
}

type historyResponse struct {
	Notes     []noteResponse       `json:"notes"`
	Vitals    []observationHistory `json:"vitals"`
	Lab       []labHistoryItem     `json:"lab"`
	Orders    []orderResponse      `json:"orders"`
	Allergies []allergyItem        `json:"allergies"`
}

type observationHistory struct {
	ID           string         `json:"id"`
	Measurements map[string]any `json:"measurements"`
	RecordedBy   string         `json:"recordedBy"`
	RecordedAt   string         `json:"recordedAt"`
}

type labHistoryItem struct {
	ID          string      `json:"id"`
	RequestNo   string      `json:"requestNo"`
	Priority    string      `json:"priority"`
	Status      string      `json:"status"`
	RequestedAt string      `json:"requestedAt"`
	ReleasedAt  *string     `json:"releasedAt,omitempty"`
	Tests       []string    `json:"tests"`
	Results     []labResult `json:"results"`
}

type labResult struct {
	TestName string `json:"testName"`
	Result   string `json:"result"`
	Critical bool   `json:"critical"`
}

type allergyItem struct {
	Summary string `json:"summary"`
}

func buildHistoryResponse(b *domain.PatientHistoryBundle) historyResponse {
	out := historyResponse{
		Notes:     make([]noteResponse, 0, len(b.Notes)),
		Vitals:    make([]observationHistory, 0, len(b.Vitals)),
		Lab:       make([]labHistoryItem, 0, len(b.Lab)),
		Orders:    make([]orderResponse, 0, len(b.Orders)),
		Allergies: make([]allergyItem, 0, len(b.Allergies)),
	}
	for i := range b.Notes {
		out.Notes = append(out.Notes, newNoteResponse(&b.Notes[i]))
	}
	for i := range b.Vitals {
		out.Vitals = append(out.Vitals, observationHistory{
			ID:           b.Vitals[i].ID,
			Measurements: jsonObject(b.Vitals[i].Measurements),
			RecordedBy:   b.Vitals[i].RecordedBy,
			RecordedAt:   b.Vitals[i].RecordedAt.UTC().Format(timeRFC3339),
		})
	}
	for i := range b.Lab {
		item := labHistoryItem{
			ID:          b.Lab[i].ID,
			RequestNo:   b.Lab[i].RequestNo,
			Priority:    b.Lab[i].Priority,
			Status:      b.Lab[i].Status,
			RequestedAt: b.Lab[i].RequestedAt.UTC().Format(timeRFC3339),
			Tests:       make([]string, 0, len(b.Lab[i].Items)),
			Results:     make([]labResult, 0, len(b.Lab[i].Items)),
		}
		if b.Lab[i].ReleasedAt != nil {
			v := b.Lab[i].ReleasedAt.UTC().Format(timeRFC3339)
			item.ReleasedAt = &v
		}
		for _, it := range b.Lab[i].Items {
			item.Tests = append(item.Tests, it.TestName)
			item.Results = append(item.Results, labResult{
				TestName: it.TestName,
				Result:   it.ResultText,
				Critical: it.Critical,
			})
		}
		out.Lab = append(out.Lab, item)
	}
	for i := range b.Orders {
		out.Orders = append(out.Orders, newOrderResponse(&b.Orders[i]))
	}
	for i := range b.Allergies {
		out.Allergies = append(out.Allergies, allergyItem{Summary: b.Allergies[i].Summary})
	}
	return out
}

// ---- digital signatures & attestation ----

type signRequest struct {
	Password string `json:"password"`
}

// signResponse carries the attestation result.
type signResponse struct {
	ID            string `json:"id"`
	SignedBy      string `json:"signedBy"`
	SignedByName  string `json:"signedByName"`
	SignedAt      string `json:"signedAt"`
	SignatureHash string `json:"signatureHash"`
}

// handleSignNote signs a clinical note with role-verified credentials.
func (s *server) handleSignNote(w http.ResponseWriter, r *http.Request) {
	noteID := r.PathValue("id")
	var req signRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Password == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "password is required to attest")
		return
	}
	note, err := s.store.GetNote(r.Context(), noteID)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "note not found")
		return
	}
	actor := userFromContext(r.Context())
	if !s.canAttest(r.Context(), note.AuthorUserID, actor.ID) {
		writeError(w, r, http.StatusForbidden, "forbidden", "only the author or a doctor/super-admin may attest this note")
		return
	}
	if !s.verifyCredentials(r.Context(), actor.ID, req.Password) {
		writeError(w, r, http.StatusUnauthorized, "invalid_credentials", "password verification failed")
		return
	}
	user, err := s.store.GetUserByID(r.Context(), actor.ID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	hash := store.ComputeSignatureHash(note.ID, actor.ID, user.PasswordHash, time.Now())
	signed, err := s.store.SignNote(r.Context(), note.ID, actor.ID, hash)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	_ = s.store.AppendTimelineEvent(r.Context(), note.PatientID, domain.EventNoteUpdated,
		"Note attested by "+s.displayName(r, actor.ID), map[string]any{"groupId": note.GroupID, "signedBy": actor.ID}, &actor.ID)
	s.recordAudit(r, domain.ActionNoteSign, "clinical_note", note.ID, nil, map[string]any{
		"groupId": note.GroupID, "signedBy": actor.ID, "signatureHash": hash[:16],
	})
	resp := signResponse{
		ID:            signed.ID,
		SignedBy:      actor.ID,
		SignedByName:  s.displayName(r, actor.ID),
		SignatureHash: signed.SignatureHash,
	}
	if signed.SignedAt != nil {
		resp.SignedAt = signed.SignedAt.UTC().Format(timeRFC3339)
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleSignOrder signs an order with role-verified credentials.
func (s *server) handleSignOrder(w http.ResponseWriter, r *http.Request) {
	orderID := r.PathValue("id")
	var req signRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Password == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "password is required to attest")
		return
	}
	order, err := s.store.GetOrder(r.Context(), orderID)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "order not found")
		return
	}
	actor := userFromContext(r.Context())
	if !s.canAttest(r.Context(), order.OrderedBy, actor.ID) {
		writeError(w, r, http.StatusForbidden, "forbidden", "only the ordering doctor or a super-admin may attest this order")
		return
	}
	if !s.verifyCredentials(r.Context(), actor.ID, req.Password) {
		writeError(w, r, http.StatusUnauthorized, "invalid_credentials", "password verification failed")
		return
	}
	user, err := s.store.GetUserByID(r.Context(), actor.ID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	hash := store.ComputeSignatureHash(order.ID, actor.ID, user.PasswordHash, time.Now())
	signed, err := s.store.SignOrder(r.Context(), order.ID, actor.ID, hash)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	_ = s.store.AppendTimelineEvent(r.Context(), order.PatientID, domain.EventOrderStatusChanged,
		"Order attested by "+s.displayName(r, actor.ID), map[string]any{"orderNo": order.OrderNo, "signedBy": actor.ID}, &actor.ID)
	s.recordAudit(r, domain.ActionOrderSign, "order", order.ID, nil, map[string]any{
		"orderNo": order.OrderNo, "signedBy": actor.ID, "signatureHash": hash[:16],
	})
	resp := signResponse{
		ID:            signed.ID,
		SignedBy:      actor.ID,
		SignedByName:  s.displayName(r, actor.ID),
		SignatureHash: signed.SignatureHash,
	}
	if signed.SignedAt != nil {
		resp.SignedAt = signed.SignedAt.UTC().Format(timeRFC3339)
	}
	writeJSON(w, http.StatusOK, resp)
}

// canAttest allows the record author, any doctor-role holder, or the
// super-admin to attest (role-verified access).
func (s *server) canAttest(ctx context.Context, authorID, actorID string) bool {
	if authorID == actorID {
		return true
	}
	roles, err := s.store.GetUserRoles(ctx, actorID)
	if err != nil {
		return false
	}
	for _, r := range roles {
		if r.Code == "doctor" || r.Code == "super_admin" {
			return true
		}
	}
	return false
}

// verifyCredentials re-verifies the actor's password (role-verified attestation).
func (s *server) verifyCredentials(ctx context.Context, userID, password string) bool {
	u, err := s.store.GetUserByID(ctx, userID)
	if err != nil {
		return false
	}
	ok, err := auth.VerifyPassword(u.PasswordHash, password)
	return err == nil && ok
}
