package httpapi

import (
	"errors"
	"math"
	"net/http"
	"strconv"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

// numValue extracts a positive finite float from a JSON number or numeric
// string (used for structured vitals like weight/height).
func numValue(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		if math.IsNaN(n) || math.IsInf(n, 0) || n <= 0 {
			return 0, false
		}
		return n, true
	case string:
		f, err := strconv.ParseFloat(n, 64)
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) || f <= 0 {
			return 0, false
		}
		return f, true
	}
	return 0, false
}

// ---- notes ----

func validNoteType(s string) bool {
	switch s {
	case domain.NoteTypeConsultation, domain.NoteTypeNursing, domain.NoteTypeProgress:
		return true
	}
	return false
}

type noteResponse struct {
	ID            string  `json:"id"`
	GroupID       string  `json:"groupId"`
	PatientID     string  `json:"patientId"`
	NoteType      string  `json:"noteType"`
	DepartmentID  *string `json:"departmentId,omitempty"`
	AuthorUserID  string  `json:"authorUserId"`
	AuthorName    string  `json:"authorName"`
	AuthorRole    string  `json:"authorRole"`
	Note          string  `json:"note"`
	Diagnosis     string  `json:"diagnosis,omitempty"`
	TreatmentPlan string  `json:"treatmentPlan,omitempty"`
	Version       int     `json:"version"`
	SignedBy      *string `json:"signedBy,omitempty"`
	SignedByName  string  `json:"signedByName,omitempty"`
	SignedAt      *string `json:"signedAt,omitempty"`
	SignatureHash string  `json:"signatureHash,omitempty"`
	CreatedAt     string  `json:"createdAt"`
}

func newNoteResponse(n *domain.ClinicalNote) noteResponse {
	resp := noteResponse{
		ID:            n.ID,
		GroupID:       n.GroupID,
		PatientID:     n.PatientID,
		NoteType:      n.NoteType,
		DepartmentID:  n.DepartmentID,
		AuthorUserID:  n.AuthorUserID,
		AuthorRole:    n.AuthorRole,
		Note:          n.Note,
		Diagnosis:     n.Diagnosis,
		TreatmentPlan: n.TreatmentPlan,
		Version:       n.Version,
		SignedBy:      n.SignedBy,
		SignatureHash: n.SignatureHash,
		CreatedAt:     n.CreatedAt.UTC().Format(timeRFC3339),
	}
	if n.SignedAt != nil {
		v := n.SignedAt.UTC().Format(timeRFC3339)
		resp.SignedAt = &v
	}
	return resp
}

type createNoteRequest struct {
	NoteType      string `json:"noteType"`
	DepartmentID  string `json:"departmentId"`
	Note          string `json:"note"`
	Diagnosis     string `json:"diagnosis"`
	TreatmentPlan string `json:"treatmentPlan"`
}

// handleCreateNote creates the first version of a clinical note.
func (s *server) handleCreateNote(w http.ResponseWriter, r *http.Request) {
	patientID := r.PathValue("id")
	var req createNoteRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.NoteType == "" {
		req.NoteType = domain.NoteTypeConsultation
	}
	if !validNoteType(req.NoteType) || req.Note == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "valid noteType and note are required")
		return
	}
	actor := userFromContext(r.Context())
	var deptID *string
	if req.DepartmentID != "" {
		deptID = &req.DepartmentID
	}
	n, err := s.store.CreateNote(r.Context(), store.CreateNoteParams{
		PatientID:     patientID,
		NoteType:      req.NoteType,
		DepartmentID:  deptID,
		AuthorUserID:  actor.ID,
		AuthorRole:    s.roleLabel(r),
		Note:          req.Note,
		Diagnosis:     req.Diagnosis,
		TreatmentPlan: req.TreatmentPlan,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	_ = s.store.AppendTimelineEvent(r.Context(), patientID, domain.EventNoteCreated,
		"Clinical note created", map[string]any{"noteType": req.NoteType, "groupId": n.GroupID}, &actor.ID)
	s.recordAudit(r, domain.ActionNoteCreate, "patient", patientID, nil, map[string]any{"groupId": n.GroupID, "noteType": req.NoteType})
	resp := newNoteResponse(n)
	resp.AuthorName = s.displayName(r, actor.ID)
	writeJSON(w, http.StatusCreated, resp)
}

// handleListNotes lists the current version of each note group.
func (s *server) handleListNotes(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	notes, err := s.store.ListNotes(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]noteResponse, 0, len(notes))
	names := s.displayNames(r, notes)
	signedNames := s.noteSignedNames(r, notes)
	for i := range notes {
		resp := newNoteResponse(&notes[i])
		resp.AuthorName = names[notes[i].AuthorUserID]
		if notes[i].SignedBy != nil {
			resp.SignedByName = signedNames[*notes[i].SignedBy]
		}
		out = append(out, resp)
	}
	s.recordAudit(r, domain.ActionNotesViewed, "patient", id, nil, nil)
	writeJSON(w, http.StatusOK, out)
}

// handleListNoteVersions lists every version of a note group.
func (s *server) handleListNoteVersions(w http.ResponseWriter, r *http.Request) {
	groupID := r.PathValue("groupId")
	notes, err := s.store.ListNoteVersions(r.Context(), groupID)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "note group not found")
		return
	}
	out := make([]noteResponse, 0, len(notes))
	names := s.displayNames(r, notes)
	signedNames := s.noteSignedNames(r, notes)
	for i := range notes {
		resp := newNoteResponse(&notes[i])
		resp.AuthorName = names[notes[i].AuthorUserID]
		if notes[i].SignedBy != nil {
			resp.SignedByName = signedNames[*notes[i].SignedBy]
		}
		out = append(out, resp)
	}
	writeJSON(w, http.StatusOK, out)
}

type addNoteVersionRequest struct {
	DepartmentID  string `json:"departmentId"`
	Note          string `json:"note"`
	Diagnosis     string `json:"diagnosis"`
	TreatmentPlan string `json:"treatmentPlan"`
}

// handleAddNoteVersion appends an immutable new version of a note.
func (s *server) handleAddNoteVersion(w http.ResponseWriter, r *http.Request) {
	patientID := r.PathValue("id")
	groupID := r.PathValue("groupId")
	var req addNoteVersionRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Note == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "note is required")
		return
	}
	actor := userFromContext(r.Context())
	var deptID *string
	if req.DepartmentID != "" {
		deptID = &req.DepartmentID
	}
	n, err := s.store.AddNoteVersion(r.Context(), store.AddNoteVersionParams{
		GroupID:       groupID,
		PatientID:     patientID,
		DepartmentID:  deptID,
		AuthorUserID:  actor.ID,
		AuthorRole:    s.roleLabel(r),
		Note:          req.Note,
		Diagnosis:     req.Diagnosis,
		TreatmentPlan: req.TreatmentPlan,
	})
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "note group not found")
		return
	}
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	_ = s.store.AppendTimelineEvent(r.Context(), patientID, domain.EventNoteUpdated,
		"Clinical note updated", map[string]any{"groupId": groupID, "version": n.Version}, &actor.ID)
	s.recordAudit(r, domain.ActionNoteVersion, "patient", patientID, nil, map[string]any{"groupId": groupID, "version": n.Version})
	resp := newNoteResponse(n)
	resp.AuthorName = s.displayName(r, actor.ID)
	writeJSON(w, http.StatusCreated, resp)
}

// ---- observations & vitals ----

func validObservationCategory(s string) bool {
	return s == domain.ObservationCategoryVitals || s == domain.ObservationCategoryObservation
}

type addObservationRequest struct {
	Category     string         `json:"category"`
	Measurements map[string]any `json:"measurements"`
	Notes        string         `json:"notes"`
}

type observationResponse struct {
	ID           string         `json:"id"`
	Category     string         `json:"category"`
	Measurements map[string]any `json:"measurements"`
	Notes        string         `json:"notes,omitempty"`
	RecordedBy   string         `json:"recordedBy"`
	RecordedAt   string         `json:"recordedAt"`
}

// handleAddObservation records vitals/observations.
func (s *server) handleAddObservation(w http.ResponseWriter, r *http.Request) {
	patientID := r.PathValue("id")
	var req addObservationRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Category == "" {
		req.Category = domain.ObservationCategoryVitals
	}
	if !validObservationCategory(req.Category) {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "category must be vitals or observation")
		return
	}
	actor := userFromContext(r.Context())

	// Structured vitals coding: compute BMI from weight (kg) + height (cm) when
	// both are supplied so the derived value is consistent everywhere.
	if req.Category == domain.ObservationCategoryVitals {
		if w, ok := numValue(req.Measurements["weight"]); ok && w > 0 {
			if h, ok := numValue(req.Measurements["height"]); ok && h > 0 {
				req.Measurements["bmi"] = math.Round(w/((h/100)*(h/100))*10) / 10
			}
		}
	}

	obsID, err := s.store.AddObservation(r.Context(), patientID, req.Category, req.Measurements, req.Notes, actor.ID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	_ = s.store.AppendTimelineEvent(r.Context(), patientID, domain.EventObservationRecorded,
		"Observation recorded", map[string]any{"category": req.Category, "bmi": req.Measurements["bmi"]}, &actor.ID)
	s.recordAudit(r, domain.ActionObservationRecorded, "patient", patientID, nil, map[string]any{"category": req.Category})
	writeJSON(w, http.StatusCreated, map[string]string{"id": obsID})
}

// handleListObservations lists observations, optionally filtered by category.
func (s *server) handleListObservations(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	category := r.URL.Query().Get("category")
	if category != "" && !validObservationCategory(category) {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid category")
		return
	}
	limit, _ := pagination(r)
	records, err := s.store.ListObservations(r.Context(), id, category, limit)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]observationResponse, 0, len(records))
	for _, o := range records {
		out = append(out, observationResponse{
			ID:           o.ID,
			Category:     o.Category,
			Measurements: jsonObject(o.Measurements),
			Notes:        o.Notes,
			RecordedBy:   o.RecordedBy,
			RecordedAt:   o.RecordedAt.UTC().Format(timeRFC3339),
		})
	}
	s.recordAudit(r, domain.ActionVitalsViewed, "patient", id, nil, nil)
	writeJSON(w, http.StatusOK, out)
}

// ---- tasks ----

type taskResponse struct {
	ID           string  `json:"id"`
	PatientID    *string `json:"patientId,omitempty"`
	DepartmentID *string `json:"departmentId,omitempty"`
	OrderID      *string `json:"orderId,omitempty"`
	Title        string  `json:"title"`
	Description  string  `json:"description,omitempty"`
	Status       string  `json:"status"`
	AssignedTo   *string `json:"assignedTo,omitempty"`
	CreatedAt    string  `json:"createdAt"`
	CompletedAt  string  `json:"completedAt,omitempty"`
}

func newTaskResponse(t *domain.Task) taskResponse {
	resp := taskResponse{
		ID:           t.ID,
		PatientID:    t.PatientID,
		DepartmentID: t.DepartmentID,
		OrderID:      t.OrderID,
		Title:        t.Title,
		Description:  t.Description,
		Status:       t.Status,
		AssignedTo:   t.AssignedTo,
		CreatedAt:    t.CreatedAt.UTC().Format(timeRFC3339),
	}
	if t.CompletedAt != nil {
		resp.CompletedAt = t.CompletedAt.UTC().Format(timeRFC3339)
	}
	return resp
}

type createTaskRequest struct {
	PatientID        string `json:"patientId"`
	DepartmentID     string `json:"departmentId"`
	Title            string `json:"title"`
	Description      string `json:"description"`
	AssignedToUserID string `json:"assignedToUserId"`
}

// handleCreateTask creates a department task.
func (s *server) handleCreateTask(w http.ResponseWriter, r *http.Request) {
	var req createTaskRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Title == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "title is required")
		return
	}
	actor := userFromContext(r.Context())
	var patientID, deptID, assignedTo *string
	if req.PatientID != "" {
		patientID = &req.PatientID
	}
	if req.DepartmentID != "" {
		deptID = &req.DepartmentID
	}
	if req.AssignedToUserID != "" {
		assignedTo = &req.AssignedToUserID
	}
	taskID, err := s.store.CreateTask(r.Context(), store.CreateTaskParams{
		PatientID:    patientID,
		DepartmentID: deptID,
		Title:        req.Title,
		Description:  req.Description,
		AssignedTo:   assignedTo,
		CreatedBy:    actor.ID,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	if patientID != nil {
		_ = s.store.AppendTimelineEvent(r.Context(), *patientID, domain.EventTaskCreated,
			"Task created", map[string]any{"title": req.Title}, &actor.ID)
	}
	s.recordAudit(r, domain.ActionTaskCreate, "task", taskID, nil, map[string]any{"title": req.Title})
	writeJSON(w, http.StatusCreated, map[string]string{"id": taskID})
}

// handleCompleteTask marks a task completed.
func (s *server) handleCompleteTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	actor := userFromContext(r.Context())
	if err := s.store.CompleteTask(r.Context(), id, actor.ID); err != nil {
		writeError(w, r, http.StatusNotFound, "not_found", "task not found or already completed")
		return
	}
	if task, err := s.store.GetTask(r.Context(), id); err == nil && task.PatientID != nil {
		_ = s.store.AppendTimelineEvent(r.Context(), *task.PatientID, domain.EventTaskCompleted,
			"Task completed: "+task.Title, map[string]any{"title": task.Title}, &actor.ID)
	}
	s.recordAudit(r, domain.ActionTaskComplete, "task", id, nil, nil)
	w.WriteHeader(http.StatusNoContent)
}

// handleListTasks lists tasks, optionally filtered by status.
func (s *server) handleListTasks(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	limit, offset := pagination(r)
	tasks, err := s.store.ListTasks(r.Context(), status, limit, offset)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]taskResponse, 0, len(tasks))
	for i := range tasks {
		out = append(out, newTaskResponse(&tasks[i]))
	}
	s.recordAudit(r, domain.ActionTasksViewed, "task", "", nil, nil)
	writeJSON(w, http.StatusOK, out)
}

// handleListPatientTasks lists a patient's tasks.
func (s *server) handleListPatientTasks(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	tasks, err := s.store.ListPatientTasks(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]taskResponse, 0, len(tasks))
	for i := range tasks {
		out = append(out, newTaskResponse(&tasks[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

// ---- reports ----

type reportResponse struct {
	ID           string  `json:"id"`
	ReportType   string  `json:"reportType"`
	Title        string  `json:"title"`
	Content      string  `json:"content"`
	AuthorID     string  `json:"authorId"`
	DepartmentID *string `json:"departmentId,omitempty"`
	CreatedAt    string  `json:"createdAt"`
}

type createReportRequest struct {
	ReportType   string `json:"reportType"`
	Title        string `json:"title"`
	Content      string `json:"content"`
	DepartmentID string `json:"departmentId"`
}

// handleCreateReport creates a clinical report.
func (s *server) handleCreateReport(w http.ResponseWriter, r *http.Request) {
	patientID := r.PathValue("id")
	var req createReportRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Title == "" || req.Content == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "title and content are required")
		return
	}
	actor := userFromContext(r.Context())
	var deptID *string
	if req.DepartmentID != "" {
		deptID = &req.DepartmentID
	}
	reportID, err := s.store.CreateReport(r.Context(), store.CreateReportParams{
		PatientID:    patientID,
		ReportType:   req.ReportType,
		Title:        req.Title,
		Content:      req.Content,
		AuthorUserID: actor.ID,
		DepartmentID: deptID,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	_ = s.store.AppendTimelineEvent(r.Context(), patientID, domain.EventReportCreated,
		"Report created: "+req.Title, map[string]any{"title": req.Title}, &actor.ID)
	s.recordAudit(r, domain.ActionReportCreate, "patient", patientID, nil, map[string]any{"reportId": reportID, "title": req.Title})
	writeJSON(w, http.StatusCreated, map[string]string{"id": reportID})
}

// handleListReports lists a patient's reports.
func (s *server) handleListReports(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	reports, err := s.store.ListReports(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]reportResponse, 0, len(reports))
	for _, rep := range reports {
		out = append(out, reportResponse{
			ID:           rep.ID,
			ReportType:   rep.ReportType,
			Title:        rep.Title,
			Content:      rep.Content,
			AuthorID:     rep.AuthorUserID,
			DepartmentID: rep.DepartmentID,
			CreatedAt:    rep.CreatedAt.UTC().Format(timeRFC3339),
		})
	}
	s.recordAudit(r, domain.ActionReportsViewed, "patient", id, nil, nil)
	writeJSON(w, http.StatusOK, out)
}

// ---- emergency triage ----

type triageRequest struct {
	FirstName      string         `json:"firstName"`
	LastName       string         `json:"lastName"`
	Gender         string         `json:"gender"`
	ChiefComplaint string         `json:"chiefComplaint"`
	TriageLevel    string         `json:"triageLevel"`
	Measurements   map[string]any `json:"measurements"`
}

type triageResponse struct {
	ID             string         `json:"id"`
	PatientID      string         `json:"patientId"`
	TriageLevel    string         `json:"triageLevel"`
	ChiefComplaint string         `json:"chiefComplaint"`
	Measurements   map[string]any `json:"measurements"`
	CreatedAt      string         `json:"createdAt"`
}

// handleTriage registers an emergency patient and records triage in one call.
func (s *server) handleTriage(w http.ResponseWriter, r *http.Request) {
	var req triageRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.ChiefComplaint == "" || req.TriageLevel == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "chiefComplaint and triageLevel are required")
		return
	}
	actor := userFromContext(r.Context())
	patient, tr, err := s.store.RegisterTriage(r.Context(), store.TriageParams{
		FirstName:      req.FirstName,
		LastName:       req.LastName,
		Gender:         req.Gender,
		ChiefComplaint: req.ChiefComplaint,
		TriageLevel:    req.TriageLevel,
		Measurements:   req.Measurements,
		TriagedBy:      actor.ID,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionTriageCreate, "patient", patient.ID, nil, map[string]any{
		"patientNo": patient.PatientNo, "triageLevel": req.TriageLevel,
	})
	writeJSON(w, http.StatusCreated, map[string]any{
		"patient": newPatientResponse(patient),
		"triage": triageResponse{
			ID:             tr.ID,
			PatientID:      tr.PatientID,
			TriageLevel:    tr.TriageLevel,
			ChiefComplaint: tr.ChiefComplaint,
			Measurements:   jsonObject(tr.Measurements),
			CreatedAt:      tr.CreatedAt.UTC().Format(timeRFC3339),
		},
	})
}

// ---- queue & assignments ----

type queueItemResponse struct {
	AssignmentID string `json:"assignmentId"`
	PatientID    string `json:"patientId"`
	PatientNo    string `json:"patientNo"`
	FirstName    string `json:"firstName"`
	LastName     string `json:"lastName"`
	Gender       string `json:"gender"`
	DateOfBirth  string `json:"dateOfBirth"`
	Phone        string `json:"phone"`
	AssignedAt   string `json:"assignedAt"`
}

// handleMyQueue returns the patients assigned to the current clinician.
func (s *server) handleMyQueue(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	items, err := s.store.ListMyQueue(r.Context(), actor.ID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]queueItemResponse, 0, len(items))
	for _, it := range items {
		out = append(out, queueItemResponse{
			AssignmentID: it.AssignmentID,
			PatientID:    it.PatientID,
			PatientNo:    it.PatientNo,
			FirstName:    it.FirstName,
			LastName:     it.LastName,
			Gender:       it.Gender,
			DateOfBirth:  it.DateOfBirth,
			Phone:        it.Phone,
			AssignedAt:   it.AssignedAt.UTC().Format(timeRFC3339),
		})
	}
	writeJSON(w, http.StatusOK, out)
}

type assignPatientRequest struct {
	AssigneeUserID string `json:"assigneeUserId"`
	DepartmentID   string `json:"departmentId"`
}

// handleAssignPatient assigns a patient to a clinician.
func (s *server) handleAssignPatient(w http.ResponseWriter, r *http.Request) {
	patientID := r.PathValue("id")
	var req assignPatientRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.AssigneeUserID == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "assigneeUserId is required")
		return
	}
	actor := userFromContext(r.Context())
	var deptID *string
	if req.DepartmentID != "" {
		deptID = &req.DepartmentID
	}
	assignmentID, err := s.store.AssignPatient(r.Context(), store.AssignPatientParams{
		PatientID:      patientID,
		AssigneeUserID: req.AssigneeUserID,
		DepartmentID:   deptID,
		AssignedBy:     actor.ID,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	_ = s.store.AppendTimelineEvent(r.Context(), patientID, domain.EventAssigned,
		"Patient assigned", map[string]any{"assigneeUserId": req.AssigneeUserID}, &actor.ID)
	s.recordAudit(r, domain.ActionAssignmentCreate, "patient", patientID, nil, map[string]any{"assigneeUserId": req.AssigneeUserID})
	writeJSON(w, http.StatusCreated, map[string]string{"id": assignmentID})
}
