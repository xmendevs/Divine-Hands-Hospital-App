package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func validClinicalSection(s string) bool {
	switch s {
	case domain.SectionAllergy, domain.SectionMedicalHistory, domain.SectionSurgicalHistory,
		domain.SectionChronicCondition, domain.SectionMedication, domain.SectionFamilyHistory,
		domain.SectionSocialHistory:
		return true
	}
	return false
}

func validRegistrationType(s string) bool {
	switch domain.RegistrationType(s) {
	case domain.RegistrationNormal, domain.RegistrationAntenatal, domain.RegistrationEmergency:
		return true
	}
	return false
}

func jsonObject(b []byte) map[string]any {
	m := map[string]any{}
	_ = json.Unmarshal(b, &m)
	return m
}

// ---- responses ----

type clinicalEntryResponse struct {
	ID         string         `json:"id"`
	Section    string         `json:"section"`
	Summary    string         `json:"summary"`
	Details    map[string]any `json:"details"`
	RecordedBy *string        `json:"recordedBy,omitempty"`
	CreatedAt  string         `json:"createdAt"`
	UpdatedAt  string         `json:"updatedAt"`
}

type patientResponse struct {
	ID                   string                  `json:"id"`
	PatientNo            string                  `json:"patientNo"`
	RegistrationType     string                  `json:"registrationType"`
	FamilyID             *string                 `json:"familyId,omitempty"`
	FirstName            string                  `json:"firstName"`
	LastName             string                  `json:"lastName"`
	MiddleName           string                  `json:"middleName"`
	Gender               string                  `json:"gender"`
	DateOfBirth          *string                 `json:"dateOfBirth,omitempty"`
	BloodGroup           string                  `json:"bloodGroup"`
	Genotype             string                  `json:"genotype"`
	MaritalStatus        string                  `json:"maritalStatus"`
	Occupation           string                  `json:"occupation"`
	Phone                string                  `json:"phone"`
	AlternatePhone       string                  `json:"alternatePhone"`
	Email                string                  `json:"email"`
	AddressLine1         string                  `json:"addressLine1"`
	AddressLine2         string                  `json:"addressLine2"`
	City                 string                  `json:"city"`
	State                string                  `json:"state"`
	PostalCode           string                  `json:"postalCode"`
	Country              string                  `json:"country"`
	IdentificationType   string                  `json:"identificationType"`
	IdentificationNumber string                  `json:"identificationNumber"`
	NextOfKinName        string                  `json:"nextOfKinName"`
	NextOfKinRelation    string                  `json:"nextOfKinRelationship"`
	NextOfKinPhone       string                  `json:"nextOfKinPhone"`
	ConsentGiven         bool                    `json:"consentGiven"`
	ConsentDate          string                  `json:"consentDate,omitempty"`
	PrivacyNotes         string                  `json:"privacyNotes"`
	Status               string                  `json:"status"`
	CreatedAt            string                  `json:"createdAt"`
	UpdatedAt            string                  `json:"updatedAt"`
	Clinical             []clinicalEntryResponse `json:"clinical,omitempty"`
}

func newPatientResponse(p *domain.Patient) patientResponse {
	resp := patientResponse{
		ID:                   p.ID,
		PatientNo:            p.PatientNo,
		RegistrationType:     string(p.RegistrationType),
		FamilyID:             p.FamilyID,
		FirstName:            p.FirstName,
		LastName:             p.LastName,
		MiddleName:           p.MiddleName,
		Gender:               p.Gender,
		DateOfBirth:          p.DateOfBirth,
		BloodGroup:           p.BloodGroup,
		Genotype:             p.Genotype,
		MaritalStatus:        p.MaritalStatus,
		Occupation:           p.Occupation,
		Phone:                p.Phone,
		AlternatePhone:       p.AlternatePhone,
		Email:                p.Email,
		AddressLine1:         p.AddressLine1,
		AddressLine2:         p.AddressLine2,
		City:                 p.City,
		State:                p.State,
		PostalCode:           p.PostalCode,
		Country:              p.Country,
		IdentificationType:   p.IdentificationType,
		IdentificationNumber: p.IdentificationNumber,
		NextOfKinName:        p.NextOfKinName,
		NextOfKinRelation:    p.NextOfKinRelation,
		NextOfKinPhone:       p.NextOfKinPhone,
		ConsentGiven:         p.ConsentGiven,
		PrivacyNotes:         p.PrivacyNotes,
		Status:               string(p.Status),
		CreatedAt:            p.CreatedAt.UTC().Format(timeRFC3339),
		UpdatedAt:            p.UpdatedAt.UTC().Format(timeRFC3339),
	}
	if p.ConsentDate != nil {
		resp.ConsentDate = p.ConsentDate.UTC().Format(timeRFC3339)
	}
	return resp
}

type patientSummaryResponse struct {
	ID               string `json:"id"`
	PatientNo        string `json:"patientNo"`
	RegistrationType string `json:"registrationType"`
	FirstName        string `json:"firstName"`
	LastName         string `json:"lastName"`
	Gender           string `json:"gender"`
	DateOfBirth      string `json:"dateOfBirth"`
	Phone            string `json:"phone"`
}

func summariesToResponse(in []domain.PatientSummary) []patientSummaryResponse {
	out := make([]patientSummaryResponse, 0, len(in))
	for _, s := range in {
		out = append(out, patientSummaryResponse{
			ID:               s.ID,
			PatientNo:        s.PatientNo,
			RegistrationType: s.RegistrationType,
			FirstName:        s.FirstName,
			LastName:         s.LastName,
			Gender:           s.Gender,
			DateOfBirth:      s.DateOfBirth,
			Phone:            s.Phone,
		})
	}
	return out
}

// ---- registration ----

type registerPatientRequest struct {
	RegistrationType      string `json:"registrationType"`
	FamilyID              string `json:"familyId"`
	FirstName             string `json:"firstName"`
	LastName              string `json:"lastName"`
	MiddleName            string `json:"middleName"`
	Gender                string `json:"gender"`
	DateOfBirth           string `json:"dateOfBirth"`
	BloodGroup            string `json:"bloodGroup"`
	Genotype              string `json:"genotype"`
	MaritalStatus         string `json:"maritalStatus"`
	Occupation            string `json:"occupation"`
	Phone                 string `json:"phone"`
	AlternatePhone        string `json:"alternatePhone"`
	Email                 string `json:"email"`
	AddressLine1          string `json:"addressLine1"`
	AddressLine2          string `json:"addressLine2"`
	City                  string `json:"city"`
	State                 string `json:"state"`
	PostalCode            string `json:"postalCode"`
	Country               string `json:"country"`
	IdentificationType    string `json:"identificationType"`
	IdentificationNumber  string `json:"identificationNumber"`
	NextOfKinName         string `json:"nextOfKinName"`
	NextOfKinRelationship string `json:"nextOfKinRelationship"`
	NextOfKinPhone        string `json:"nextOfKinPhone"`
	ConsentGiven          bool   `json:"consentGiven"`
	PrivacyNotes          string `json:"privacyNotes"`
	Force                 bool   `json:"force"`
}

// handleRegisterPatient registers a patient with a transactionally-generated ID.
func (s *server) handleRegisterPatient(w http.ResponseWriter, r *http.Request) {
	var req registerPatientRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.FirstName == "" || req.LastName == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "firstName and lastName are required")
		return
	}
	regType := req.RegistrationType
	if regType == "" {
		regType = string(domain.RegistrationNormal)
	}
	if !validRegistrationType(regType) {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "registrationType must be normal, antenatal, or emergency")
		return
	}

	// Duplicate safeguard (soft check; the DB unique index is the hard backstop).
	if !req.Force {
		candidates, err := s.store.DuplicateCandidates(r.Context(), req.IdentificationNumber, req.FirstName, req.LastName, req.DateOfBirth)
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
			return
		}
		if len(candidates) > 0 {
			writeJSON(w, http.StatusConflict, map[string]any{
				"error": ErrorBody{
					Code:      "duplicate_patient",
					Message:   "a patient with these identifiers already exists",
					RequestID: requestIDFromContext(r.Context()),
				},
				"candidates": summariesToResponse(candidates),
			})
			return
		}
	}

	actor := userFromContext(r.Context())
	var familyID *string
	if req.FamilyID != "" {
		familyID = &req.FamilyID
	}

	patient, err := s.store.RegisterPatient(r.Context(), store.RegisterPatientParams{
		RegistrationType:     domain.RegistrationType(regType),
		FamilyID:             familyID,
		FirstName:            req.FirstName,
		LastName:             req.LastName,
		MiddleName:           req.MiddleName,
		Gender:               req.Gender,
		DateOfBirth:          req.DateOfBirth,
		BloodGroup:           req.BloodGroup,
		Genotype:             req.Genotype,
		MaritalStatus:        req.MaritalStatus,
		Occupation:           req.Occupation,
		Phone:                req.Phone,
		AlternatePhone:       req.AlternatePhone,
		Email:                req.Email,
		AddressLine1:         req.AddressLine1,
		AddressLine2:         req.AddressLine2,
		City:                 req.City,
		State:                req.State,
		PostalCode:           req.PostalCode,
		Country:              req.Country,
		IdentificationType:   req.IdentificationType,
		IdentificationNumber: req.IdentificationNumber,
		NextOfKinName:        req.NextOfKinName,
		NextOfKinRelation:    req.NextOfKinRelationship,
		NextOfKinPhone:       req.NextOfKinPhone,
		ConsentGiven:         req.ConsentGiven,
		PrivacyNotes:         req.PrivacyNotes,
		CreatedBy:            &actor.ID,
	})
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, r, http.StatusConflict, "duplicate_patient", "a patient with this identification number already exists")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}

	s.recordAudit(r, domain.ActionPatientCreate, "patient", patient.ID, nil, map[string]any{
		"patientNo": patient.PatientNo, "registrationType": patient.RegistrationType,
	})
	writeJSON(w, http.StatusCreated, newPatientResponse(patient))
}

// ---- search ----

// handleSearchPatients searches by patient ID or permitted demographics.
func (s *server) handleSearchPatients(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "query parameter q is required")
		return
	}
	limit, offset := pagination(r)
	results, err := s.store.SearchPatients(r.Context(), q, limit, offset)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionPatientSearch, "patient", "", nil, map[string]any{"q": q})
	writeJSON(w, http.StatusOK, summariesToResponse(results))
}

// ---- get / update ----

// handleGetPatient returns the patient; clinical sections are included only for
// callers with the clinical.view permission.
func (s *server) handleGetPatient(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	p, err := s.store.GetPatient(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "patient not found")
		return
	}
	resp := newPatientResponse(p)

	actor := userFromContext(r.Context())
	canViewClinical, _ := s.store.UserHasPermission(r.Context(), actor.ID, "clinical.view")
	if canViewClinical {
		entries, err := s.store.ListClinicalEntries(r.Context(), p.ID)
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
			return
		}
		resp.Clinical = make([]clinicalEntryResponse, 0, len(entries))
		for _, e := range entries {
			resp.Clinical = append(resp.Clinical, clinicalEntryResponse{
				ID:         e.ID,
				Section:    e.Section,
				Summary:    e.Summary,
				Details:    jsonObject(e.Details),
				RecordedBy: e.RecordedBy,
				CreatedAt:  e.CreatedAt.UTC().Format(timeRFC3339),
				UpdatedAt:  e.UpdatedAt.UTC().Format(timeRFC3339),
			})
		}
		s.recordAudit(r, domain.ActionClinicalViewed, "patient", p.ID, nil, nil)
	}

	s.recordAudit(r, domain.ActionPatientViewed, "patient", p.ID, nil, nil)
	writeJSON(w, http.StatusOK, resp)
}

type updatePatientRequest struct {
	FirstName             *string `json:"firstName"`
	LastName              *string `json:"lastName"`
	MiddleName            *string `json:"middleName"`
	Gender                *string `json:"gender"`
	DateOfBirth           *string `json:"dateOfBirth"`
	BloodGroup            *string `json:"bloodGroup"`
	Genotype              *string `json:"genotype"`
	MaritalStatus         *string `json:"maritalStatus"`
	Occupation            *string `json:"occupation"`
	Phone                 *string `json:"phone"`
	AlternatePhone        *string `json:"alternatePhone"`
	Email                 *string `json:"email"`
	AddressLine1          *string `json:"addressLine1"`
	AddressLine2          *string `json:"addressLine2"`
	City                  *string `json:"city"`
	State                 *string `json:"state"`
	PostalCode            *string `json:"postalCode"`
	Country               *string `json:"country"`
	IdentificationType    *string `json:"identificationType"`
	IdentificationNumber  *string `json:"identificationNumber"`
	NextOfKinName         *string `json:"nextOfKinName"`
	NextOfKinRelationship *string `json:"nextOfKinRelationship"`
	NextOfKinPhone        *string `json:"nextOfKinPhone"`
	ConsentGiven          *bool   `json:"consentGiven"`
	PrivacyNotes          *string `json:"privacyNotes"`
}

func coalesceStr(p *string, def string) string {
	if p != nil {
		return *p
	}
	return def
}

// handleUpdatePatient applies a demographics update, audited field by field.
func (s *server) handleUpdatePatient(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	p, err := s.store.GetPatient(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "patient not found")
		return
	}

	var req updatePatientRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}

	dob := ""
	if p.DateOfBirth != nil {
		dob = *p.DateOfBirth
	}

	params := store.UpdatePatientParams{
		FirstName:            coalesceStr(req.FirstName, p.FirstName),
		LastName:             coalesceStr(req.LastName, p.LastName),
		MiddleName:           coalesceStr(req.MiddleName, p.MiddleName),
		Gender:               coalesceStr(req.Gender, p.Gender),
		DateOfBirth:          coalesceStr(req.DateOfBirth, dob),
		BloodGroup:           coalesceStr(req.BloodGroup, p.BloodGroup),
		Genotype:             coalesceStr(req.Genotype, p.Genotype),
		MaritalStatus:        coalesceStr(req.MaritalStatus, p.MaritalStatus),
		Occupation:           coalesceStr(req.Occupation, p.Occupation),
		Phone:                coalesceStr(req.Phone, p.Phone),
		AlternatePhone:       coalesceStr(req.AlternatePhone, p.AlternatePhone),
		Email:                coalesceStr(req.Email, p.Email),
		AddressLine1:         coalesceStr(req.AddressLine1, p.AddressLine1),
		AddressLine2:         coalesceStr(req.AddressLine2, p.AddressLine2),
		City:                 coalesceStr(req.City, p.City),
		State:                coalesceStr(req.State, p.State),
		PostalCode:           coalesceStr(req.PostalCode, p.PostalCode),
		Country:              coalesceStr(req.Country, p.Country),
		IdentificationType:   coalesceStr(req.IdentificationType, p.IdentificationType),
		IdentificationNumber: coalesceStr(req.IdentificationNumber, p.IdentificationNumber),
		NextOfKinName:        coalesceStr(req.NextOfKinName, p.NextOfKinName),
		NextOfKinRelation:    coalesceStr(req.NextOfKinRelationship, p.NextOfKinRelation),
		NextOfKinPhone:       coalesceStr(req.NextOfKinPhone, p.NextOfKinPhone),
		ConsentGiven:         coalesceBool(req.ConsentGiven, p.ConsentGiven),
		PrivacyNotes:         coalesceStr(req.PrivacyNotes, p.PrivacyNotes),
	}

	if err := s.store.UpdatePatient(r.Context(), id, params); err != nil {
		if isUniqueViolation(err) {
			writeError(w, r, http.StatusConflict, "conflict", "identification number already in use")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionPatientUpdate, "patient", id, nil, nil)
	w.WriteHeader(http.StatusNoContent)
}

func coalesceBool(p *bool, def bool) bool {
	if p != nil {
		return *p
	}
	return def
}

// ---- amendment ----

type amendPatientRequest struct {
	FieldName string `json:"fieldName"`
	NewValue  string `json:"newValue"`
	Reason    string `json:"reason"`
}

// handleAmendPatient records a corrected patient-level field (no silent overwrites).
func (s *server) handleAmendPatient(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req amendPatientRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.FieldName == "" || req.Reason == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "fieldName and reason are required")
		return
	}
	actor := userFromContext(r.Context())
	err := s.store.AmendPatientField(r.Context(), id, req.FieldName, req.NewValue, req.Reason, &actor.ID)
	switch {
	case errors.Is(err, store.ErrInvalidField):
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "field is not amendable")
		return
	case errors.Is(err, store.ErrNotFound):
		writeError(w, r, http.StatusNotFound, "not_found", "patient not found")
		return
	case err != nil:
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionPatientAmend, "patient", id, nil, map[string]any{"field": req.FieldName, "reason": req.Reason})
	w.WriteHeader(http.StatusNoContent)
}

// ---- clinical ----

// handleListClinical returns all clinical sections for a patient.
func (s *server) handleListClinical(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	entries, err := s.store.ListClinicalEntries(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]clinicalEntryResponse, 0, len(entries))
	for _, e := range entries {
		out = append(out, clinicalEntryResponse{
			ID:         e.ID,
			Section:    e.Section,
			Summary:    e.Summary,
			Details:    jsonObject(e.Details),
			RecordedBy: e.RecordedBy,
			CreatedAt:  e.CreatedAt.UTC().Format(timeRFC3339),
			UpdatedAt:  e.UpdatedAt.UTC().Format(timeRFC3339),
		})
	}
	s.recordAudit(r, domain.ActionClinicalViewed, "patient", id, nil, nil)
	writeJSON(w, http.StatusOK, out)
}

type addClinicalRequest struct {
	Section string         `json:"section"`
	Summary string         `json:"summary"`
	Details map[string]any `json:"details"`
}

// handleAddClinical appends an entry to a patient clinical section.
func (s *server) handleAddClinical(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req addClinicalRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if !validClinicalSection(req.Section) || req.Summary == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "valid section and summary are required")
		return
	}
	if _, err := s.store.GetPatient(r.Context(), id); err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "patient not found")
		return
	}
	actor := userFromContext(r.Context())
	entryID, err := s.store.AddClinicalEntry(r.Context(), id, req.Section, req.Summary, req.Details, &actor.ID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	_ = s.store.AppendTimelineEvent(r.Context(), id, domain.EventClinicalAdded,
		"Clinical record added: "+req.Section, map[string]any{"section": req.Section}, &actor.ID)
	s.recordAudit(r, domain.ActionClinicalAdd, "patient", id, nil, map[string]any{"section": req.Section, "entryId": entryID})
	writeJSON(w, http.StatusCreated, map[string]string{"id": entryID})
}

type amendClinicalRequest struct {
	Summary *string        `json:"summary"`
	Details map[string]any `json:"details"`
	Reason  string         `json:"reason"`
}

// handleAmendClinical corrects a clinical entry, recording before/after values.
func (s *server) handleAmendClinical(w http.ResponseWriter, r *http.Request) {
	patientID := r.PathValue("id")
	entryID := r.PathValue("entryId")
	var req amendClinicalRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Reason == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "reason is required")
		return
	}
	actor := userFromContext(r.Context())
	err := s.store.AmendClinicalEntry(r.Context(), store.AmendClinicalEntryParams{
		EntryID:   entryID,
		PatientID: patientID,
		Summary:   req.Summary,
		Details:   req.Details,
		Reason:    req.Reason,
		AmendedBy: &actor.ID,
	})
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "clinical entry not found")
		return
	}
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionClinicalAmend, "patient", patientID, nil, map[string]any{"entryId": entryID, "reason": req.Reason})
	w.WriteHeader(http.StatusNoContent)
}

// ---- timeline ----

type timelineEventResponse struct {
	ID          string         `json:"id"`
	EventType   string         `json:"eventType"`
	Summary     string         `json:"summary"`
	Data        map[string]any `json:"data"`
	ActorUserID *string        `json:"actorUserId,omitempty"`
	OccurredAt  string         `json:"occurredAt"`
}

// handleListTimeline returns a patient's timeline.
func (s *server) handleListTimeline(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	limit, _ := pagination(r)
	events, err := s.store.ListTimeline(r.Context(), id, limit)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]timelineEventResponse, 0, len(events))
	for _, e := range events {
		out = append(out, timelineEventResponse{
			ID:          e.ID,
			EventType:   e.EventType,
			Summary:     e.Summary,
			Data:        jsonObject(e.Data),
			ActorUserID: e.ActorUserID,
			OccurredAt:  e.OccurredAt.UTC().Format(timeRFC3339),
		})
	}
	writeJSON(w, http.StatusOK, out)
}

// ---- documents ----

type documentResponse struct {
	ID           string  `json:"id"`
	DocumentType string  `json:"documentType"`
	Title        string  `json:"title"`
	FileName     string  `json:"fileName"`
	ContentType  string  `json:"contentType"`
	FileSize     int64   `json:"fileSize"`
	UploadedBy   *string `json:"uploadedBy,omitempty"`
	CreatedAt    string  `json:"createdAt"`
}

// handleListDocuments lists a patient's document metadata.
func (s *server) handleListDocuments(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	docs, err := s.store.ListDocuments(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]documentResponse, 0, len(docs))
	for _, d := range docs {
		out = append(out, documentResponse{
			ID:           d.ID,
			DocumentType: d.DocumentType,
			Title:        d.Title,
			FileName:     d.FileName,
			ContentType:  d.ContentType,
			FileSize:     d.FileSize,
			UploadedBy:   d.UploadedBy,
			CreatedAt:    d.CreatedAt.UTC().Format(timeRFC3339),
		})
	}
	s.recordAudit(r, domain.ActionDocumentsViewed, "patient", id, nil, nil)
	writeJSON(w, http.StatusOK, out)
}

type addDocumentRequest struct {
	DocumentType string `json:"documentType"`
	Title        string `json:"title"`
	FileName     string `json:"fileName"`
	ContentType  string `json:"contentType"`
	FileSize     int64  `json:"fileSize"`
}

// handleAddDocument records document metadata (binary upload lands with the
// object-storage phase).
func (s *server) handleAddDocument(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req addDocumentRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Title == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "title is required")
		return
	}
	actor := userFromContext(r.Context())
	docID, err := s.store.AddDocument(r.Context(), id, req.DocumentType, req.Title, req.FileName, req.ContentType, req.FileSize, &actor.ID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	_ = s.store.AppendTimelineEvent(r.Context(), id, domain.EventDocumentAdded,
		"Document added", map[string]any{"title": req.Title}, &actor.ID)
	s.recordAudit(r, domain.ActionDocumentAdd, "patient", id, nil, map[string]any{"documentId": docID, "title": req.Title})
	writeJSON(w, http.StatusCreated, map[string]string{"id": docID})
}

// ---- families ----

type familyResponse struct {
	ID            string                   `json:"id"`
	FamilyNo      string                   `json:"familyNo"`
	FamilyName    string                   `json:"familyName"`
	HeadPatientID *string                  `json:"headPatientId,omitempty"`
	CreatedAt     string                   `json:"createdAt"`
	Members       []patientSummaryResponse `json:"members,omitempty"`
}

type createFamilyRequest struct {
	FamilyName    string `json:"familyName"`
	HeadPatientID string `json:"headPatientId"`
}

// handleCreateFamily creates a family profile with a DHHF business ID.
func (s *server) handleCreateFamily(w http.ResponseWriter, r *http.Request) {
	var req createFamilyRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.FamilyName == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "familyName is required")
		return
	}
	actor := userFromContext(r.Context())
	var head *string
	if req.HeadPatientID != "" {
		head = &req.HeadPatientID
	}
	f, err := s.store.AddFamily(r.Context(), req.FamilyName, head, &actor.ID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	if head != nil {
		_ = s.store.AppendTimelineEvent(r.Context(), *head, domain.EventFamilyLinked,
			"Linked to family "+f.FamilyNo, map[string]any{"familyNo": f.FamilyNo}, &actor.ID)
	}
	s.recordAudit(r, domain.ActionFamilyCreate, "family", f.ID, nil, map[string]any{"familyNo": f.FamilyNo})
	writeJSON(w, http.StatusCreated, familyResponse{
		ID:            f.ID,
		FamilyNo:      f.FamilyNo,
		FamilyName:    f.FamilyName,
		HeadPatientID: f.HeadPatientID,
		CreatedAt:     f.CreatedAt.UTC().Format(timeRFC3339),
	})
}

// handleGetFamily returns a family profile with its members.
func (s *server) handleGetFamily(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	f, err := s.store.GetFamily(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "family not found")
		return
	}
	members, _ := s.store.ListFamilyMembers(r.Context(), f.ID)
	writeJSON(w, http.StatusOK, familyResponse{
		ID:            f.ID,
		FamilyNo:      f.FamilyNo,
		FamilyName:    f.FamilyName,
		HeadPatientID: f.HeadPatientID,
		CreatedAt:     f.CreatedAt.UTC().Format(timeRFC3339),
		Members:       summariesToResponse(members),
	})
}
