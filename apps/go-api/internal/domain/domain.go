// Package domain holds the core entity types shared across the service.
// Internal primary keys are UUIDs (exposed as strings); human-readable
// business identifiers (username, employee_no, codes) are stored separately.
package domain

import "time"

type UserStatus string

const (
	UserStatusPending   UserStatus = "pending"
	UserStatusActive    UserStatus = "active"
	UserStatusSuspended UserStatus = "suspended"
)

type User struct {
	ID                 string
	Username           string
	Email              string
	PasswordHash       string
	Status             UserStatus
	MustChangePassword bool
	MFAEnabled         bool
	MFASecretEncrypted []byte
	LastLoginAt        *time.Time
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

type Staff struct {
	ID           string
	UserID       string
	DepartmentID *string
	EmployeeNo   string
	FirstName    string
	LastName     string
	JobTitle     string
}

type Role struct {
	ID          string
	Code        string
	Name        string
	Description string
	MFARequired bool
	IsSystem    bool
}

type Permission struct {
	ID          string
	Code        string
	Name        string
	Description string
	Module      string
}

type Department struct {
	ID   string
	Code string
	Name string
}

type Session struct {
	ID         string
	UserID     string
	TokenHash  string
	IPAddress  string
	UserAgent  string
	DeviceName string
	CreatedAt  time.Time
	LastSeenAt time.Time
	ExpiresAt  time.Time
	RevokedAt  *time.Time
}

type AuditLog struct {
	ID           string
	ActorUserID  *string
	Action       string
	ResourceType string
	ResourceID   string
	TargetUserID *string
	Details      []byte // JSONB
	IPAddress    string
	RequestID    string
	CreatedAt    time.Time
}

type Setting struct {
	Key         string
	Value       []byte // JSONB
	Description string
	UpdatedBy   *string
	UpdatedAt   time.Time
}

// Security event types.
const (
	EventLoginSuccess           = "login_success"
	EventLoginFailure           = "login_failure"
	EventLogout                 = "logout"
	EventPasswordResetRequested = "password_reset_requested"
	EventPasswordResetCompleted = "password_reset_completed"
	EventPasswordChanged        = "password_changed"
	EventMFAEnrolled            = "mfa_enrolled"
	EventMFAVerificationFailed  = "mfa_verification_failed"
	EventAccountSuspended       = "account_suspended"
	EventAccountActivated       = "account_activated"
)

// Audit action names.
const (
	ActionUserCreate          = "user.create"
	ActionUserUpdate          = "user.update"
	ActionUserSuspend         = "user.suspend"
	ActionUserActivate        = "user.activate"
	ActionUserRolesAssigned   = "user.roles_assigned"
	ActionUserPasswordReset   = "user.password_reset"
	ActionUserPasswordChanged = "user.password_changed"
	ActionUserMFAEnabled      = "user.mfa_enabled"
	ActionRoleCreate          = "role.create"
	ActionRoleUpdate          = "role.update"
	ActionRolePermissionsSet  = "role.permissions_set"
	ActionDepartmentCreate    = "department.create"
	ActionSettingsUpdate      = "settings.update"
	ActionUsersViewed         = "users.viewed"
	ActionAuditViewed         = "audit.viewed"

	ActionPatientCreate   = "patient.create"
	ActionPatientUpdate   = "patient.update"
	ActionPatientAmend    = "patient.amend"
	ActionPatientViewed   = "patient.viewed"
	ActionPatientSearch   = "patient.search"
	ActionClinicalAdd     = "clinical.add"
	ActionClinicalAmend   = "clinical.amend"
	ActionClinicalViewed  = "clinical.viewed"
	ActionFamilyCreate    = "family.create"
	ActionDocumentAdd     = "document.add"
	ActionDocumentsViewed = "documents.viewed"

	ActionOrderCreate            = "order.create"
	ActionOrderSubmit            = "order.submit"
	ActionOrderStatusChange      = "order.status_change"
	ActionOrderCancel            = "order.cancel"
	ActionOrdersViewed           = "orders.viewed"
	ActionNoteCreate             = "note.create"
	ActionNoteVersion            = "note.version"
	ActionNotesViewed            = "notes.viewed"
	ActionObservationRecorded    = "observation.recorded"
	ActionVitalsViewed           = "vitals.viewed"
	ActionAdministrationRecorded = "medication.administered"
	ActionMARViewed              = "mar.viewed"
	ActionTaskCreate             = "task.create"
	ActionTaskComplete           = "task.complete"
	ActionTasksViewed            = "tasks.viewed"
	ActionAdmissionCreate        = "admission.create"
	ActionAdmissionDischarge     = "admission.discharge"
	ActionAdmissionsViewed       = "admissions.viewed"
	ActionReportCreate           = "report.create"
	ActionReportsViewed          = "reports.viewed"
	ActionTriageCreate           = "triage.create"
	ActionAssignmentCreate       = "assignment.create"
)

// Order types.
const (
	OrderTypePrescription = "prescription"
	OrderTypeLabRequest   = "lab_request"
	OrderTypeNursingOrder = "nursing_order"
	OrderTypeReferral     = "referral"
)

// Order statuses: draft → submitted → accepted → in_progress → completed
// (or cancelled).
const (
	OrderStatusDraft      = "draft"
	OrderStatusSubmitted  = "submitted"
	OrderStatusAccepted   = "accepted"
	OrderStatusInProgress = "in_progress"
	OrderStatusCompleted  = "completed"
	OrderStatusCancelled  = "cancelled"
)

// Order is a unified doctor order. Type-specific fields live in Details (JSONB).
type Order struct {
	ID             string
	OrderNo        string
	PatientID      string
	OrderType      string
	Status         string
	DepartmentID   *string
	OrderedBy      string
	Details        []byte
	ClinicalNoteID *string
	ActedBy        *string
	CancelledBy    *string
	CancelReason   string
	CreatedAt      time.Time
	SubmittedAt    *time.Time
	AcceptedAt     *time.Time
	CompletedAt    *time.Time
	CancelledAt    *time.Time
	UpdatedAt      time.Time
}

// Clinical note types.
const (
	NoteTypeConsultation = "consultation"
	NoteTypeNursing      = "nursing"
	NoteTypeProgress     = "progress"
)

// ClinicalNote is an immutable version within a note group.
type ClinicalNote struct {
	ID            string
	GroupID       string
	PatientID     string
	NoteType      string
	DepartmentID  *string
	AuthorUserID  string
	AuthorRole    string
	Note          string
	Diagnosis     string
	TreatmentPlan string
	Version       int
	CreatedAt     time.Time
}

// MedicationAdministration is a nurse-recorded administration (MAR).
type MedicationAdministration struct {
	ID             string
	OrderID        string
	PatientID      string
	Medication     string
	Dose           string
	Route          string
	AdministeredBy string
	AdministeredAt time.Time
	Notes          string
	CreatedAt      time.Time
}

// Observation categories.
const (
	ObservationCategoryVitals      = "vitals"
	ObservationCategoryObservation = "observation"
)

// Observation is a vitals/observation record with JSONB measurements.
type Observation struct {
	ID           string
	PatientID    string
	Category     string
	Measurements []byte
	Notes        string
	RecordedBy   string
	RecordedAt   time.Time
}

// Task statuses.
const (
	TaskStatusPending    = "pending"
	TaskStatusInProgress = "in_progress"
	TaskStatusCompleted  = "completed"
	TaskStatusCancelled  = "cancelled"
)

// Task is a department task.
type Task struct {
	ID           string
	PatientID    *string
	DepartmentID *string
	OrderID      *string
	Title        string
	Description  string
	Status       string
	AssignedTo   *string
	CreatedBy    string
	CreatedAt    time.Time
	CompletedAt  *time.Time
	CompletedBy  *string
}

// Admission statuses.
const (
	AdmissionStatusAdmitted   = "admitted"
	AdmissionStatusDischarged = "discharged"
)

// Admission is an admission/discharge record.
type Admission struct {
	ID                   string
	PatientID            string
	Ward                 string
	Room                 string
	Bed                  string
	AdmittedAt           time.Time
	AttendingDoctorID    *string
	AdmissionReason      string
	Status               string
	DischargedAt         *time.Time
	DischargeSummary     string
	FollowUpInstructions string
	CreatedBy            *string
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

// ClinicalReport is a doctor-authored report.
type ClinicalReport struct {
	ID           string
	PatientID    string
	ReportType   string
	Title        string
	Content      string
	AuthorUserID string
	DepartmentID *string
	CreatedAt    time.Time
}

// Triage is an emergency triage record.
type Triage struct {
	ID             string
	PatientID      string
	TriageLevel    string
	ChiefComplaint string
	Measurements   []byte
	TriagedBy      string
	CreatedAt      time.Time
}

// Assignment links a patient to a clinician.
type Assignment struct {
	ID             string
	PatientID      string
	AssigneeUserID string
	DepartmentID   *string
	AssignedBy     *string
	CreatedAt      time.Time
	EndedAt        *time.Time
}

// Timeline event types (clinical workflows).
const (
	EventOrderCreated           = "order_created"
	EventOrderStatusChanged     = "order_status_changed"
	EventNoteCreated            = "note_created"
	EventNoteUpdated            = "note_updated"
	EventObservationRecorded    = "observation_recorded"
	EventMedicationAdministered = "medication_administered"
	EventTaskCreated            = "task_created"
	EventTaskCompleted          = "task_completed"
	EventAdmitted               = "admitted"
	EventDischarged             = "discharged"
	EventReportCreated          = "report_created"
	EventTriage                 = "triage"
	EventAssigned               = "assigned"
)

// RegistrationType drives the business-ID prefix: normal (DHH), antenatal
// (DHHA), emergency (DHHE). Family profiles use their own DHHF prefix.
type RegistrationType string

const (
	RegistrationNormal    RegistrationType = "normal"
	RegistrationAntenatal RegistrationType = "antenatal"
	RegistrationEmergency RegistrationType = "emergency"
)

type PatientStatus string

const (
	PatientStatusActive   PatientStatus = "active"
	PatientStatusInactive PatientStatus = "inactive"
	PatientStatusDeceased PatientStatus = "deceased"
	PatientStatusMerged   PatientStatus = "merged"
)

// Patient is the master patient record. Internal keys are UUIDs; patient_no is
// the human-readable business ID.
type Patient struct {
	ID                   string
	PatientNo            string
	RegistrationType     RegistrationType
	FamilyID             *string
	FirstName            string
	LastName             string
	MiddleName           string
	Gender               string
	DateOfBirth          *string // ISO date (YYYY-MM-DD); nil when unknown
	BloodGroup           string
	Genotype             string
	MaritalStatus        string
	Occupation           string
	Phone                string
	AlternatePhone       string
	Email                string
	AddressLine1         string
	AddressLine2         string
	City                 string
	State                string
	PostalCode           string
	Country              string
	IdentificationType   string
	IdentificationNumber string
	NextOfKinName        string
	NextOfKinRelation    string
	NextOfKinPhone       string
	ConsentGiven         bool
	ConsentDate          *time.Time
	PrivacyNotes         string
	Status               PatientStatus
	CreatedBy            *string
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

// PatientSummary is the restricted projection used for search and lists.
type PatientSummary struct {
	ID               string
	PatientNo        string
	RegistrationType string
	FirstName        string
	LastName         string
	Gender           string
	DateOfBirth      string // "" when unknown
	Phone            string
}

// Clinical sections.
const (
	SectionAllergy          = "allergy"
	SectionMedicalHistory   = "medical_history"
	SectionSurgicalHistory  = "surgical_history"
	SectionChronicCondition = "chronic_condition"
	SectionMedication       = "medication"
	SectionFamilyHistory    = "family_history"
	SectionSocialHistory    = "social_history"
)

// ClinicalEntry is a single item in a patient clinical section.
type ClinicalEntry struct {
	ID         string
	PatientID  string
	Section    string
	Summary    string
	Details    []byte // JSONB
	RecordedBy *string
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// Amendment records a correction with before/after values; never a silent
// overwrite.
type Amendment struct {
	ID            string
	PatientID     string
	Section       string
	EntryID       *string
	FieldName     string
	PreviousValue []byte // JSONB
	NewValue      []byte // JSONB
	Reason        string
	AmendedBy     *string
	CreatedAt     time.Time
}

// Family groups related patients under a shared business ID (DHHF...).
type Family struct {
	ID            string
	FamilyNo      string
	FamilyName    string
	HeadPatientID *string
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// TimelineEvent is a major event in a patient's journey.
type TimelineEvent struct {
	ID          string
	PatientID   string
	EventType   string
	Summary     string
	Data        []byte // JSONB
	ActorUserID *string
	OccurredAt  time.Time
}

// Document is patient document metadata (binary lives in object storage).
type Document struct {
	ID           string
	PatientID    string
	DocumentType string
	Title        string
	FileName     string
	ContentType  string
	FileSize     int64
	StorageKey   string
	UploadedBy   *string
	CreatedAt    time.Time
}

// Timeline event types.
const (
	EventPatientRegistered = "registration"
	EventPatientAmended    = "amendment"
	EventClinicalAdded     = "clinical_added"
	EventClinicalAmended   = "clinical_amended"
	EventFamilyLinked      = "family_linked"
	EventDocumentAdded     = "document_added"
)
