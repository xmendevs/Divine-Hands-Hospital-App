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
