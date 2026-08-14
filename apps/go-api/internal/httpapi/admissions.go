package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

type admissionResponse struct {
	ID                   string  `json:"id"`
	PatientID            string  `json:"patientId"`
	Ward                 string  `json:"ward"`
	Room                 string  `json:"room"`
	Bed                  string  `json:"bed"`
	AdmittedAt           string  `json:"admittedAt"`
	AttendingDoctorID    *string `json:"attendingDoctorId,omitempty"`
	AdmissionReason      string  `json:"admissionReason,omitempty"`
	Status               string  `json:"status"`
	DischargedAt         string  `json:"dischargedAt,omitempty"`
	DischargeSummary     string  `json:"dischargeSummary,omitempty"`
	FollowUpInstructions string  `json:"followUpInstructions,omitempty"`
}

func newAdmissionResponse(a *domain.Admission) admissionResponse {
	resp := admissionResponse{
		ID:                   a.ID,
		PatientID:            a.PatientID,
		Ward:                 a.Ward,
		Room:                 a.Room,
		Bed:                  a.Bed,
		AdmittedAt:           a.AdmittedAt.UTC().Format(timeRFC3339),
		AttendingDoctorID:    a.AttendingDoctorID,
		AdmissionReason:      a.AdmissionReason,
		Status:               a.Status,
		DischargeSummary:     a.DischargeSummary,
		FollowUpInstructions: a.FollowUpInstructions,
	}
	if a.DischargedAt != nil {
		resp.DischargedAt = a.DischargedAt.UTC().Format(timeRFC3339)
	}
	return resp
}

type admitPatientRequest struct {
	Ward              string `json:"ward"`
	Room              string `json:"room"`
	Bed               string `json:"bed"`
	AttendingDoctorID string `json:"attendingDoctorId"`
	AdmissionReason   string `json:"admissionReason"`
}

// handleAdmitPatient admits a patient.
func (s *server) handleAdmitPatient(w http.ResponseWriter, r *http.Request) {
	patientID := r.PathValue("id")
	var req admitPatientRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Ward == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "ward is required")
		return
	}
	actor := userFromContext(r.Context())
	var doctorID *string
	if req.AttendingDoctorID != "" {
		doctorID = &req.AttendingDoctorID
	}
	adm, err := s.store.AdmitPatient(r.Context(), store.AdmitPatientParams{
		PatientID:         patientID,
		Ward:              req.Ward,
		Room:              req.Room,
		Bed:               req.Bed,
		AttendingDoctorID: doctorID,
		AdmissionReason:   req.AdmissionReason,
		CreatedBy:         &actor.ID,
	})
	if errors.Is(err, store.ErrAlreadyAdmitted) {
		writeError(w, r, http.StatusConflict, "already_admitted", "patient already has an active admission")
		return
	}
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	_ = s.store.AppendTimelineEvent(r.Context(), patientID, domain.EventAdmitted,
		"Patient admitted", map[string]any{"ward": req.Ward, "room": req.Room, "bed": req.Bed}, &actor.ID)
	s.recordAudit(r, domain.ActionAdmissionCreate, "patient", patientID, nil, map[string]any{
		"admissionId": adm.ID, "ward": req.Ward,
	})
	writeJSON(w, http.StatusCreated, newAdmissionResponse(adm))
}

// handleListAdmissions lists a patient's admission history.
func (s *server) handleListAdmissions(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	admissions, err := s.store.ListAdmissions(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]admissionResponse, 0, len(admissions))
	for i := range admissions {
		out = append(out, newAdmissionResponse(&admissions[i]))
	}
	s.recordAudit(r, domain.ActionAdmissionsViewed, "patient", id, nil, nil)
	writeJSON(w, http.StatusOK, out)
}

type dischargePatientRequest struct {
	DischargeSummary     string `json:"dischargeSummary"`
	FollowUpInstructions string `json:"followUpInstructions"`
}

// handleDischargePatient discharges an active admission.
func (s *server) handleDischargePatient(w http.ResponseWriter, r *http.Request) {
	patientID := r.PathValue("id")
	admissionID := r.PathValue("admissionId")
	var req dischargePatientRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.DischargeSummary == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "dischargeSummary is required")
		return
	}
	actor := userFromContext(r.Context())
	adm, err := s.store.DischargePatient(r.Context(), admissionID, req.DischargeSummary, req.FollowUpInstructions, time.Now())
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "active admission not found")
		return
	}
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	_ = s.store.AppendTimelineEvent(r.Context(), patientID, domain.EventDischarged,
		"Patient discharged", map[string]any{"ward": adm.Ward}, &actor.ID)
	s.recordAudit(r, domain.ActionAdmissionDischarge, "patient", patientID, nil, map[string]any{"admissionId": admissionID})
	writeJSON(w, http.StatusOK, newAdmissionResponse(adm))
}
