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
	ID               string
	UserID           string
	DepartmentID     *string
	EmployeeNo       string
	FirstName        string
	LastName         string
	JobTitle         string
	ContactPhone     string
	ContactEmail     string
	EmploymentStatus string
	Availability     string
	Skills           []string
	Certifications   []string
	HireDate         *string // ISO date; nil when none
	DepartmentName   string  // populated on list/get joins
	Username         string  // populated on list/get joins
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

	EventMedicineDispensed = "medicine_dispensed"
	EventStockReceived     = "stock_received"
	EventStockAdjusted     = "stock_adjusted"
	EventStockCounted      = "stock_counted"

	ActionMedicineCreate    = "medicine.create"
	ActionMedicineUpdate    = "medicine.update"
	ActionInventoryReceipt  = "inventory.receipt"
	ActionInventoryDispense = "inventory.dispense"
	ActionInventoryAdjust   = "inventory.adjust"
	ActionInventoryApprove  = "inventory.approve"
	ActionInventoryReject   = "inventory.reject"
	ActionInventoryTransfer = "inventory.transfer"
	ActionInventoryCount    = "inventory.count"
	ActionInventoryReturn   = "inventory.return"
	ActionInventoryDamage   = "inventory.damage"
	ActionInventoryViewed   = "inventory.viewed"
)

// Medicine is the medicine master record.
type Medicine struct {
	ID              string
	Code            string
	GenericName     string
	Brand           string
	Strength        string
	DosageForm      string
	Category        string
	Supplier        string
	ReorderLevel    float64
	StorageLocation string
	UnitCost        float64
	SellingPrice    float64
	Active          bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// Batch statuses.
const (
	BatchStatusActive      = "active"
	BatchStatusQuarantined = "quarantined"
)

// Batch is a medicine batch inventory record.
type Batch struct {
	ID                string
	MedicineID        string
	BatchNumber       string
	ManufacturingDate *string // ISO date; nil when unknown
	ExpiryDate        *string // ISO date; nil when none
	QuantityOnHand    float64
	PurchaseCost      float64
	SellingPrice      float64
	Supplier          string
	Status            string
	ReceivedAt        time.Time
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

// Stock movement types.
const (
	MovementReceipt       = "receipt"
	MovementDispense      = "dispense"
	MovementReturn        = "return"
	MovementAdjustment    = "adjustment"
	MovementDamage        = "damage"
	MovementTransferIn    = "transfer_in"
	MovementTransferOut   = "transfer_out"
	MovementCountVariance = "count_variance"
)

// StockMovement is an immutable stock movement record.
type StockMovement struct {
	ID             string
	MedicineID     string
	BatchID        *string
	MovementType   string
	Quantity       float64
	QuantityBefore float64
	QuantityAfter  float64
	Reason         string
	ReferenceType  string
	ReferenceID    *string
	PerformedBy    string
	CreatedAt      time.Time
}

// Adjustment statuses.
const (
	AdjustmentStatusPending  = "pending"
	AdjustmentStatusApproved = "approved"
	AdjustmentStatusRejected = "rejected"
)

// StockAdjustment is a signed stock delta that may require approval.
type StockAdjustment struct {
	ID                string
	MedicineID        string
	BatchID           string
	Quantity          float64
	Reason            string
	Status            string
	ApprovalRequestID *string
	RequestedBy       string
	DecidedBy         *string
	DecidedAt         *time.Time
	CreatedAt         time.Time
}

// Approval subject types.
const (
	ApprovalSubjectStockAdjustment = "stock_adjustment"
)

// Approval statuses.
const (
	ApprovalStatusPending  = "pending"
	ApprovalStatusApproved = "approved"
	ApprovalStatusRejected = "rejected"
)

// ApprovalRequest is a reusable approval record.
type ApprovalRequest struct {
	ID          string
	SubjectType string
	SubjectID   string
	Action      string
	RequestedBy string
	Status      string
	Details     []byte
	Reason      string
	DecidedBy   *string
	DecidedAt   *time.Time
	CreatedAt   time.Time
}

// Dispensation is a dispensing transaction header.
type Dispensation struct {
	ID                  string
	DispensationNo      string
	PrescriptionOrderID string
	PatientID           string
	DispensedBy         string
	TotalAmount         float64
	Notes               string
	CreatedAt           time.Time
	Items               []DispensationItem
}

// DispensationItem is a dispensing line item.
type DispensationItem struct {
	ID             string
	DispensationID string
	MedicineID     string
	BatchID        string
	Quantity       float64
	UnitPrice      float64
}

// StockCount records a physical count and its variance.
type StockCount struct {
	ID              string
	MedicineID      string
	BatchID         string
	SystemQuantity  float64
	CountedQuantity float64
	Variance        float64
	CountedBy       string
	CreatedAt       time.Time
}

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

// Asset tracking types.
const (
	AssetTrackingUnit     = "unit"
	AssetTrackingQuantity = "quantity"
)

// Asset statuses.
const (
	AssetStatusAvailable        = "available"
	AssetStatusInUse            = "in_use"
	AssetStatusUnderMaintenance = "under_maintenance"
	AssetStatusDamaged          = "damaged"
	AssetStatusLost             = "lost"
	AssetStatusDisposed         = "disposed"
)

// Asset conditions.
const (
	AssetConditionNew  = "new"
	AssetConditionGood = "good"
	AssetConditionFair = "fair"
	AssetConditionPoor = "poor"
)

// Asset movement types (auditable ledger, mirroring stock movements).
const (
	AssetMovementReceipt       = "receipt"
	AssetMovementAdjustment    = "adjustment"
	AssetMovementCountVariance = "count_variance"
	AssetMovementTransferIn    = "transfer_in"
	AssetMovementTransferOut   = "transfer_out"
	AssetMovementDispose       = "dispose"
)

// Audit action names (general inventory, Phase 06).
const (
	ActionAssetCreate         = "asset.create"
	ActionAssetUpdate         = "asset.update"
	ActionAssetStatusChange   = "asset.status_change"
	ActionAssetTransfer       = "asset.transfer"
	ActionAssetAdjust         = "asset.adjust"
	ActionAssetCount          = "asset.count"
	ActionAssetViewed         = "assets.viewed"
	ActionMaintenanceRecord   = "maintenance.record"
	ActionMaintenanceSchedule = "maintenance.schedule"
	ActionProviderCreate      = "maintenance.provider_create"
)

// AssetCategory is a seeded asset classification with a tracking mode.
type AssetCategory struct {
	ID       string
	Code     string
	Name     string
	Tracking string
}

// Asset is a general-inventory item: unit-tracked (instrument/equipment) or
// quantity-tracked (consumable stock). asset_no is the business ID.
type Asset struct {
	ID             string
	AssetNo        string
	Name           string
	CategoryID     string
	CategoryCode   string
	CategoryName   string
	Tracking       string
	SerialNumber   string
	Manufacturer   string
	Supplier       string
	PurchaseDate   *string // ISO date; nil when unknown
	Cost           float64
	Location       string
	DepartmentID   *string
	DepartmentName string
	CustodianID    *string
	Condition      string
	WarrantyExpiry *string // ISO date; nil when none
	Status         string
	QuantityOnHand float64
	Notes          string
	CreatedBy      string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// AssetMovement is an immutable asset quantity movement.
type AssetMovement struct {
	ID             string
	AssetID        string
	MovementType   string
	Quantity       float64
	QuantityBefore float64
	QuantityAfter  float64
	Reason         string
	ReferenceType  string
	ReferenceID    *string
	PerformedBy    string
	CreatedAt      time.Time
}

// AssetTransfer records relocation and/or custody reassignment.
type AssetTransfer struct {
	ID             string
	AssetID        string
	Quantity       float64
	FromDepartment *string
	ToDepartment   *string
	FromLocation   string
	ToLocation     string
	FromCustodian  *string
	ToCustodian    *string
	Reason         string
	TransferredBy  string
	CreatedAt      time.Time
}

// AssetStatusChange is an immutable, attributable status transition.
type AssetStatusChange struct {
	ID         string
	AssetID    string
	FromStatus string
	ToStatus   string
	Reason     string
	ChangedBy  string
	CreatedAt  time.Time
}

// AssetStockCount records a physical count and its variance.
type AssetStockCount struct {
	ID              string
	AssetID         string
	SystemQuantity  float64
	CountedQuantity float64
	Variance        float64
	CountedBy       string
	CreatedAt       time.Time
}

// ServiceProvider is a maintenance service provider.
type ServiceProvider struct {
	ID           string
	Name         string
	ContactPhone string
	ContactEmail string
	Address      string
	Notes        string
	Active       bool
	CreatedAt    time.Time
}

// MaintenanceSchedule is a recurring maintenance plan for an asset.
type MaintenanceSchedule struct {
	ID              string
	AssetID         string
	ServiceType     string
	FrequencyDays   int
	NextServiceDate string // ISO date
	Active          bool
	CreatedBy       string
	CreatedAt       time.Time
}

// MaintenanceRecord is one completed maintenance event.
type MaintenanceRecord struct {
	ID                string
	AssetID           string
	ScheduleID        *string
	ServiceProviderID *string
	ServiceType       string
	Description       string
	ServiceDate       string // ISO date
	DowntimeHours     float64
	Cost              float64
	NextServiceDate   *string // ISO date; nil when none
	PerformedBy       string
	CreatedAt         time.Time
}

// Lab client types.
const (
	LabClientExternal = "external"
	LabClientReferral = "referral"
)

// Lab payment statuses (finance-module integration point).
const (
	LabPaymentPending       = "pending"
	LabPaymentPreauthorized = "preauthorized"
	LabPaymentPaid          = "paid"
	LabPaymentWaived        = "waived"
)

// Lab request workflow: REQUESTED → PAYMENT/PREAUTH → SPECIMEN_COLLECTED →
// RECEIVED → PROCESSING → RESULT_ENTERED → VERIFIED → RELEASED.
const (
	LabStatusRequested         = "requested"
	LabStatusPayment           = "payment"
	LabStatusSpecimenCollected = "specimen_collected"
	LabStatusReceived          = "received"
	LabStatusProcessing        = "processing"
	LabStatusResultEntered     = "result_entered"
	LabStatusVerified          = "verified"
	LabStatusReleased          = "released"
	LabStatusCancelled         = "cancelled"
)

// Lab request priorities.
const (
	LabPriorityRoutine = "routine"
	LabPriorityUrgent  = "urgent"
	LabPriorityStat    = "stat"
)

// Specimen statuses.
const (
	SpecimenStatusCollected = "collected"
	SpecimenStatusReceived  = "received"
	SpecimenStatusRejected  = "rejected"
)

// Specimen chain-of-custody event types.
const (
	SpecimenEventCollected   = "collected"
	SpecimenEventReceived    = "received"
	SpecimenEventStored      = "stored"
	SpecimenEventTransferred = "transferred"
	SpecimenEventRejected    = "rejected"
)

// Critical result notification statuses.
const (
	CriticalStatusPending      = "pending"
	CriticalStatusAcknowledged = "acknowledged"
)

// Lab audit actions.
const (
	ActionLabClientCreate    = "lab.client_create"
	ActionLabTestCreate      = "lab.test_create"
	ActionLabTestUpdate      = "lab.test_update"
	ActionLabRequestCreate   = "lab.request_create"
	ActionLabRequestStatus   = "lab.request_status"
	ActionLabRequestCancel   = "lab.request_cancel"
	ActionLabSpecimenCollect = "lab.specimen_collect"
	ActionLabSpecimenReceive = "lab.specimen_receive"
	ActionLabSpecimenReject  = "lab.specimen_reject"
	ActionLabResultEnter     = "lab.result_enter"
	ActionLabResultVerify    = "lab.result_verify"
	ActionLabResultRelease   = "lab.result_release"
	ActionLabCriticalAck     = "lab.critical_acknowledge"
	ActionLabViewed          = "lab.viewed"
)

// Patient timeline events (lab, Phase 07).
const (
	EventLabRequested = "lab_requested"
	EventLabReleased  = "lab_released"
)

// LabClient is an external or referral lab client with a complete demographic
// record. client_no is the business ID (LBC000001).
type LabClient struct {
	ID                 string
	ClientNo           string
	ClientType         string
	FirstName          string
	LastName           string
	Gender             string
	DateOfBirth        *string // ISO date; nil when unknown
	Phone              string
	Email              string
	AddressLine1       string
	AddressLine2       string
	City               string
	State              string
	Country            string
	ReferringFacility  string
	ReferringPhysician string
	Notes              string
	CreatedBy          string
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

// LabTest is a catalogue entry for a laboratory test.
type LabTest struct {
	ID                   string
	Code                 string
	Name                 string
	Category             string
	Price                float64
	SpecimenType         string
	Container            string
	TurnaroundMinutes    int
	Units                string
	ReferenceRanges      []byte // JSONB
	VerificationRequired bool
	Active               bool
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

// LabRequest is a lab order for a hospital patient or lab client.
type LabRequest struct {
	ID            string
	RequestNo     string
	PatientID     *string
	ClientID      *string
	PatientNo     string
	PatientName   string
	ClientNo      string
	ClientName    string
	OrderedBy     string
	OrderedByName string
	Priority      string
	ClinicalNotes string
	PaymentStatus string
	Status        string
	CancelReason  string
	RequestedAt   time.Time
	ReleasedAt    *time.Time
	CreatedAt     time.Time
	UpdatedAt     time.Time
	Items         []LabRequestItem
	Specimens     []LabSpecimen
}

// LabRequestItem is a requested test with its structured result.
type LabRequestItem struct {
	ID                   string
	RequestID            string
	TestID               string
	TestCode             string
	TestName             string
	VerificationRequired bool
	SpecimenType         string
	Price                float64
	SpecimenID           *string
	ResultValue          []byte // JSONB
	ResultText           string
	Critical             bool
	ResultEnteredBy      *string
	ResultEnteredAt      *time.Time
	ResultVerifiedBy     *string
	ResultVerifiedAt     *time.Time
}

// LabSpecimen is one collected specimen with its chain of custody.
type LabSpecimen struct {
	ID              string
	SpecimenNo      string
	RequestID       string
	ItemID          string
	SpecimenType    string
	CollectedBy     string
	CollectedAt     time.Time
	ReceivedBy      *string
	ReceivedAt      *time.Time
	Condition       string
	StorageLocation string
	Status          string
	RejectionReason string
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// LabSpecimenEvent is an append-only chain-of-custody event.
type LabSpecimenEvent struct {
	ID         string
	SpecimenID string
	EventType  string
	Actor      string
	Notes      string
	CreatedAt  time.Time
}

// LabCriticalNotification records a critical result notification and its
// acknowledgement.
type LabCriticalNotification struct {
	ID                   string
	ItemID               string
	RequestID            string
	PatientID            *string
	ClientID             *string
	NotifiedToUserID     *string
	NotifiedToName       string
	NotifiedAt           time.Time
	AcknowledgedBy       *string
	AcknowledgedAt       *time.Time
	AcknowledgementNotes string
	Status               string
	CreatedAt            time.Time
}

// Billing constants (Phase 08).
const (
	BillingInvoiceStatusDraft         = "draft"
	BillingInvoiceStatusIssued        = "issued"
	BillingInvoiceStatusPartiallyPaid = "partially_paid"
	BillingInvoiceStatusPaid          = "paid"
	BillingInvoiceStatusVoided        = "voided"
)

const (
	BillingBillToPatient   = "patient"
	BillingBillToInsurance = "insurance"
	BillingBillToCorporate = "corporate"
)

const (
	BillingPriceListActive   = "active"
	BillingPriceListInactive = "inactive"
)

const (
	BillingPaymentMethodCash      = "cash"
	BillingPaymentMethodTransfer  = "transfer"
	BillingPaymentMethodPOS       = "pos"
	BillingPaymentMethodCard      = "card"
	BillingPaymentMethodOnline    = "online"
	BillingPaymentMethodInsurance = "insurance"
	BillingPaymentMethodCorporate = "corporate"
)

const (
	BillingRefundStatusPending   = "pending"
	BillingRefundStatusApproved  = "approved"
	BillingRefundStatusRejected  = "rejected"
	BillingRefundStatusProcessed = "processed"
)

const (
	BillingShiftOpen   = "open"
	BillingShiftClosed = "closed"
)

const (
	ReceiptShareEmail    = "email"
	ReceiptShareWhatsApp = "whatsapp"
)

// Billing audit actions.
const (
	ActionBillingPriceListCreate = "billing.price_list_create"
	ActionBillingPriceListUpdate = "billing.price_list_update"
	ActionBillingItemCreate      = "billing.item_create"
	ActionBillingItemUpdate      = "billing.item_update"
	ActionBillingInvoiceCreate   = "billing.invoice_create"
	ActionBillingInvoiceIssue    = "billing.invoice_issue"
	ActionBillingInvoiceVoid     = "billing.invoice_void"
	ActionBillingPaymentReceive  = "billing.payment_receive"
	ActionBillingReceiptShare    = "billing.receipt_share"
	ActionBillingRefundRequest   = "billing.refund_request"
	ActionBillingRefundApprove   = "billing.refund_approve"
	ActionBillingRefundReject    = "billing.refund_reject"
	ActionBillingRefundProcess   = "billing.refund_process"
	ActionBillingShiftOpen       = "billing.shift_open"
	ActionBillingShiftClose      = "billing.shift_close"
	ActionBillingViewed          = "billing.viewed"
)

// Patient timeline events (billing, Phase 08).
const (
	EventBillingInvoiceIssued = "billing_invoice_issued"
	EventBillingPaymentMade   = "billing_payment_received"
)

// PriceList is a billable services price catalogue.
type PriceList struct {
	ID          string
	Name        string
	Currency    string
	Description string
	ValidFrom   *string // ISO date; nil when none
	ValidTo     *string // ISO date; nil when none
	Status      string
	CreatedBy   *string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// PriceListItem is one billable service within a price list.
type PriceListItem struct {
	ID          string
	PriceListID string
	Code        string
	Name        string
	Category    string
	Unit        string
	Price       float64
	TaxRate     float64
	Active      bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// InvoiceItem is a snapshot line on an invoice.
type InvoiceItem struct {
	ID              string
	InvoiceID       string
	PriceListItemID *string
	Code            string
	Name            string
	Category        string
	Unit            string
	Quantity        float64
	UnitPrice       float64
	TaxRate         float64
	LineTotal       float64
	TaxAmount       float64
}

// Invoice is the central billing document.
type Invoice struct {
	ID             string
	InvoiceNo      string
	PatientID      *string
	PriceListID    *string
	Currency       string
	BillTo         string
	PayerName      string
	PolicyNumber   string
	Subtotal       float64
	DiscountAmount float64
	TaxAmount      float64
	TotalAmount    float64
	AmountPaid     float64
	Status         string
	IssuedBy       *string
	IssuedAt       *time.Time
	VoidReason     string
	VoidedBy       *string
	VoidedAt       *time.Time
	CreatedBy      *string
	CreatedAt      time.Time
	UpdatedAt      time.Time
	Items          []InvoiceItem
	PatientNo      string
	PatientName    string
}

// Payment is an append-only payment received against an invoice.
type Payment struct {
	ID          string
	PaymentNo   string
	InvoiceID   string
	PatientID   *string
	ShiftID     *string
	Amount      float64
	Method      string
	Reference   string
	ReceivedBy  string
	ReceivedAt  time.Time
	CreatedAt   time.Time
	Notes       string
	InvoiceNo   string
	PatientName string
}

// Receipt is the printable document generated for a payment.
type Receipt struct {
	ID          string
	ReceiptNo   string
	PaymentID   string
	InvoiceID   string
	PatientID   *string
	Amount      float64
	Method      string
	Reference   string
	IssuedBy    string
	IssuedAt    time.Time
	InvoiceNo   string
	Currency    string
	PatientName string
	BillTo      string
	PayerName   string
	ReceivedBy  string
	Items       []InvoiceItem
	TotalAmount float64
	AmountPaid  float64
}

// RefundRequest is an approval-tracked refund request against a payment.
type RefundRequest struct {
	ID              string
	RefundNo        string
	PaymentID       string
	InvoiceID       string
	PatientID       *string
	Amount          float64
	Reason          string
	Status          string
	RequestedBy     string
	RequestedAt     time.Time
	ApprovedBy      *string
	ApprovedAt      *time.Time
	RejectionReason string
	ProcessedBy     *string
	ProcessedAt     *time.Time
	PaymentNo       string
	InvoiceNo       string
	PatientName     string
}

// Refund is a processed (posted) refund that reverses part of a payment.
type Refund struct {
	ID              string
	RefundNo        string
	RefundRequestID string
	PaymentID       string
	InvoiceID       string
	PatientID       *string
	ShiftID         *string
	Amount          float64
	Reason          string
	ProcessedBy     string
	ProcessedAt     time.Time
	InvoiceNo       string
	PaymentNo       string
	PatientName     string
}

// CashierShift tracks a cashier session for end-of-shift reconciliation.
type CashierShift struct {
	ID           string
	ShiftNo      string
	CashierID    string
	OpenedAt     time.Time
	ClosedAt     *time.Time
	OpeningCash  float64
	ClosingCash  *float64
	ExpectedCash *float64
	Variance     *float64
	Status       string
	Payments     []Payment
	Refunds      []Refund
}

// ShiftTotals is the per-method transaction summary of a shift.
type ShiftTotals struct {
	Method   string  `json:"method"`
	Payments float64 `json:"payments"`
	Refunds  float64 `json:"refunds"`
	Net      float64 `json:"net"`
}

// ReceiptShare records a user-initiated receipt sharing action.
type ReceiptShare struct {
	ID        string
	ReceiptID string
	ShareVia  string
	Recipient string
	SharedBy  string
	SharedAt  time.Time
}

// Staff employment statuses (Phase 09).
const (
	StaffEmploymentActive     = "active"
	StaffEmploymentOnLeave    = "on_leave"
	StaffEmploymentTerminated = "terminated"
	StaffEmploymentSuspended  = "suspended"
)

// Staff leave statuses (Phase 09).
const (
	StaffLeaveStatusPending  = "pending"
	StaffLeaveStatusApproved = "approved"
	StaffLeaveStatusRejected = "rejected"
)

// Attendance record statuses (Phase 09).
const (
	AttendanceStatusClockedIn = "clocked_in"
	AttendanceStatusCompleted = "completed"
)

// Attendance report derived statuses (Phase 09).
const (
	AttendanceReportOnTime    = "on_time"
	AttendanceReportLate      = "late"
	AttendanceReportEarly     = "early"
	AttendanceReportCompleted = "completed"
	AttendanceReportMissed    = "missed"
	AttendanceReportOnLeave   = "on_leave"
)

// Handover note statuses (Phase 09).
const (
	HandoverStatusCreated      = "created"
	HandoverStatusAcknowledged = "acknowledged"
)

// Staff / attendance / handover audit actions (Phase 09).
const (
	ActionStaffUpdate           = "staff.update"
	ActionLeaveRequest          = "staff.leave_request"
	ActionLeaveApprove          = "staff.leave_approve"
	ActionLeaveReject           = "staff.leave_reject"
	ActionAttendanceShiftCreate = "attendance.shift_create"
	ActionAttendanceClockIn     = "attendance.clock_in"
	ActionAttendanceClockOut    = "attendance.clock_out"
	ActionHandoverCreate        = "handover.create"
	ActionHandoverAcknowledge   = "handover.acknowledge"
	ActionRosterAssign          = "attendance.roster_assign"
	ActionRosterRemove          = "attendance.roster_remove"
)

// StaffLeave is a leave request/record against a staff member.
type StaffLeave struct {
	ID          string
	StaffID     string
	LeaveType   string
	StartDate   string // ISO date
	EndDate     string // ISO date
	Reason      string
	Status      string
	RequestedBy string
	ApprovedBy  *string
	DecidedAt   *time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
	StaffName   string // joined
	EmployeeNo  string // joined
}

// StaffShift is a named work shift definition used for attendance.
type StaffShift struct {
	ID               string
	Code             string
	Name             string
	StartTime        string // HH:MM
	EndTime          string // HH:MM
	LateGraceMinutes int
	IsNight          bool
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// AttendanceRecord is one clock-in/out event for a staff member.
type AttendanceRecord struct {
	ID             string
	StaffID        string
	ShiftID        string
	WorkDate       string // ISO date
	ClockInAt      time.Time
	ClockOutAt     *time.Time
	ClockInMethod  string
	ClockOutMethod string
	ClockInDevice  string
	ClockOutDevice string
	IsLate         bool
	IsEarlyLeave   bool
	Status         string
	Notes          string
	CreatedAt      time.Time
	UpdatedAt      time.Time
	StaffName      string // joined
	EmployeeNo     string // joined
	ShiftName      string // joined
	ShiftCode      string // joined
	DepartmentName string // joined
}

// HandoverNote is a structured nursing shift handover.
type HandoverNote struct {
	ID                    string
	HandoverNo            string
	OutgoingStaffID       string
	DepartmentID          *string
	ShiftID               *string
	PatientIDs            []string
	CurrentCondition      string
	Medications           string
	PendingInvestigations string
	PendingOrders         string
	ImportantObservations string
	Tasks                 string
	Incidents             string
	Instructions          string
	Status                string
	CreatedBy             string
	AcknowledgedBy        *string
	AcknowledgedAt        *time.Time
	CreatedAt             time.Time
	UpdatedAt             time.Time
	OutgoingStaffName     string // joined
	DepartmentName        string // joined
	ShiftName             string // joined
	AcknowledgedByName    string // joined
}

// AttendanceReportRow is one row of a per-day attendance report.
type AttendanceReportRow struct {
	StaffID    string
	EmployeeNo string
	StaffName  string
	Department string
	ShiftID    string
	ShiftName  string
	Status     string // on_time | late | early | completed | clocked_in | missed | on_leave
	ClockInAt  *time.Time
	ClockOutAt *time.Time
}

// StaffRoster schedules a staff member to a shift on a date.
type StaffRoster struct {
	ID         string
	StaffID    string
	ShiftID    string
	WorkDate   string // ISO date
	Notes      string
	CreatedBy  *string
	CreatedAt  time.Time
	StaffName  string // joined
	EmployeeNo string // joined
	ShiftName  string // joined
	ShiftCode  string // joined
}

// Roster plan statuses (Phase 10).
const (
	RosterStatusDraft     = "draft"
	RosterStatusSubmitted = "submitted"
	RosterStatusApproved  = "approved"
	RosterStatusRejected  = "rejected"
)

// Roster audit actions (Phase 10).
const (
	ActionRosterPlanCreate       = "roster.plan_create"
	ActionRosterGenerate         = "roster.generate"
	ActionRosterAssignmentAdd    = "roster.assignment_add"
	ActionRosterAssignmentRemove = "roster.assignment_remove"
	ActionRosterSubmit           = "roster.submit"
	ActionRosterApprove          = "roster.approve"
	ActionRosterReject           = "roster.reject"
	ActionRosterAmend            = "roster.amend"
)

// RosterShiftRequirement is a required staffing level for one shift.
type RosterShiftRequirement struct {
	ShiftID  string `json:"shiftId"`
	Required int    `json:"required"`
}

// RosterAssignment is one staff-to-shift assignment within a plan.
type RosterAssignment struct {
	ID         string
	PlanID     string
	StaffID    string
	ShiftID    string
	WorkDate   string // ISO date
	CreatedBy  *string
	CreatedAt  time.Time
	StaffName  string // joined
	EmployeeNo string // joined
	ShiftName  string // joined
	ShiftCode  string // joined
}

// UnmetRequirement is a staffing shortfall the generator could not fill.
type UnmetRequirement struct {
	ShiftID   string `json:"shiftId"`
	ShiftName string `json:"shiftName"`
	WorkDate  string `json:"workDate"`
	Missing   int    `json:"missing"`
}

// RosterPlan is a roster generation session with parameters and status.
type RosterPlan struct {
	ID                   string
	PlanNo               string
	Name                 string
	DepartmentID         string
	DepartmentName       string
	StartDate            string // ISO date
	EndDate              string // ISO date
	MaxHoursPerWeek      float64
	MaxConsecutiveShifts int
	MinRestHours         float64
	MaxConsecutiveNights int
	ShiftRequirements    []RosterShiftRequirement
	Status               string
	Version              int
	AmendedFrom          *string
	CreatedBy            string
	SubmittedBy          *string
	SubmittedAt          *time.Time
	ApprovedBy           *string
	ApprovedAt           *time.Time
	RejectedReason       string
	CreatedAt            time.Time
	UpdatedAt            time.Time
	Assignments          []RosterAssignment
	Unmet                []UnmetRequirement
}

// StaffUnavailability marks a staff member unavailable for a whole day.
type StaffUnavailability struct {
	ID         string
	StaffID    string
	WorkDate   string // ISO date
	Reason     string
	CreatedBy  *string
	CreatedAt  time.Time
	StaffName  string // joined
	EmployeeNo string // joined
}

// ShiftPreference is a staff member's preferred shift, ranked.
type ShiftPreference struct {
	ShiftID   string `json:"shiftId"`
	ShiftCode string `json:"shiftCode,omitempty"`
	ShiftName string `json:"shiftName,omitempty"`
	Rank      int    `json:"rank"`
}

// Notification categories (Phase 11).
const (
	NotificationCategoryCriticalClinical = "critical_clinical"
	NotificationCategoryRoster           = "roster"
	NotificationCategoryStock            = "stock"
	NotificationCategoryPayment          = "payment"
	NotificationCategoryReminder         = "reminder"
	NotificationCategorySystem           = "system"
	NotificationCategoryMessage          = "message"
	NotificationCategoryAnnouncement     = "announcement"
)

// Notification delivery channels (Phase 11).
const (
	NotificationChannelInApp = "in_app"
	NotificationChannelEmail = "email"
	NotificationChannelBoth  = "both"
)

// Notification email delivery statuses (Phase 11).
const (
	NotificationEmailNone    = "none"
	NotificationEmailPending = "pending"
	NotificationEmailSent    = "sent"
	NotificationEmailFailed  = "failed"
)

// Communication channel types (Phase 11).
const (
	CommsChannelDepartment = "department"
	CommsChannelShift      = "shift"
)

// Message kinds (Phase 11).
const (
	MessageKindDirect       = "direct"
	MessageKindChannel      = "channel"
	MessageKindAnnouncement = "announcement"
)

// Notifications & communications audit actions (Phase 11).
const (
	ActionNotificationSend       = "notifications.send"
	ActionNotificationRead       = "notifications.read"
	ActionCommsChannelCreate     = "communications.channel_create"
	ActionCommsChannelUpdate     = "communications.channel_update"
	ActionCommsMemberAdd         = "communications.member_add"
	ActionCommsMemberRemove      = "communications.member_remove"
	ActionCommsMessageSend       = "communications.message_send"
	ActionCommsAnnouncementPost  = "communications.announcement_post"
	ActionCommsAdminAccess       = "communications.admin_access"
	ActionCommsComplianceSearch  = "communications.compliance_search"
	ActionCommsRetentionRun      = "communications.retention_run"
	ActionCommsPolicyAcknowledge = "communications.policy_acknowledge"
)

// Notification is a persisted in-app or email notification for a user.
type Notification struct {
	ID          string
	UserID      string
	Category    string
	Title       string
	Body        string
	Link        string
	Channel     string
	EmailStatus string
	ReadAt      *time.Time
	DeliveredAt *time.Time
	CreatedAt   time.Time
}

// CommsChannel is a department or shift messaging channel.
type CommsChannel struct {
	ID             string
	Name           string
	Type           string
	DepartmentID   *string
	ShiftID        *string
	DepartmentName string // joined
	ShiftName      string // joined
	Description    string
	CreatedBy      string
	CreatedAt      time.Time
	MemberCount    int
	IsMember       bool
}

// CommsChannelMember is one user's membership in a channel.
type CommsChannelMember struct {
	ID         string
	ChannelID  string
	UserID     string
	AddedBy    *string
	AddedAt    time.Time
	Username   string // joined
	StaffName  string // joined
	EmployeeNo string // joined
}

// MessageAttachment is a policy-governed attachment metadata record.
type MessageAttachment struct {
	ID         string
	MessageID  string
	FileName   string
	MimeType   string
	SizeBytes  int64
	StorageRef string
	CreatedAt  time.Time
}

// Message is a direct, channel, or announcement message.
type Message struct {
	ID             string
	Kind           string
	SenderID       string
	RecipientID    *string
	ChannelID      *string
	Body           string
	CreatedAt      time.Time
	SenderName     string // joined
	SenderUsername string // joined
	RecipientName  string // joined
	ChannelName    string // joined
	Attachments    []MessageAttachment
}

// CommsPolicy is the governance notice surfaced to users.
type CommsPolicy struct {
	Notice             string
	RetentionDays      int
	AttachmentMaxBytes int64
	Acknowledged       bool
}

// Reporting & exports audit actions (Phase 12).
const (
	ActionReportExport = "reports.export"
	ActionReportViewed = "reports.viewed"
)

// NameValue is a labelled metric row used across reports.
type NameValue struct {
	Name  string `json:"name"`
	Value int64  `json:"value"`
}

// Dashboard is the super-admin aggregate across all modules.
type Dashboard struct {
	PatientRegistrations struct {
		Total int64 `json:"total"`
		Today int64 `json:"today"`
	} `json:"patientRegistrations"`
	Admissions struct {
		Active          int64 `json:"active"`
		DischargedToday int64 `json:"dischargedToday"`
	} `json:"admissions"`
	Revenue struct {
		Collected   float64 `json:"collected"`
		Invoiced    float64 `json:"invoiced"`
		Outstanding float64 `json:"outstanding"`
	} `json:"revenue"`
	Pharmacy struct {
		MedicineCount int64   `json:"medicineCount"`
		StockOnHand   float64 `json:"stockOnHand"`
		ExpiringSoon  int64   `json:"expiringSoon"`
	} `json:"pharmacy"`
	InventoryVariance struct {
		CountsWithVariance int64   `json:"countsWithVariance"`
		TotalVariance      float64 `json:"totalVariance"`
	} `json:"inventoryVariance"`
	Attendance struct {
		ClockedIn int64 `json:"clockedIn"`
		Missed    int64 `json:"missed"`
	} `json:"attendance"`
	RosterCoverage struct {
		Scheduled   int64   `json:"scheduled"`
		Required    int64   `json:"required"`
		CoveragePct float64 `json:"coveragePct"`
	} `json:"rosterCoverage"`
	LabWorkload struct {
		PendingRequests     int64 `json:"pendingRequests"`
		PendingVerification int64 `json:"pendingVerification"`
	} `json:"labWorkload"`
	CriticalAlerts struct {
		Unacknowledged int64 `json:"unacknowledged"`
	} `json:"criticalAlerts"`
	SecurityEvents struct {
		Last24h int64 `json:"last24h"`
	} `json:"securityEvents"`
}

// DoctorReport is the doctor-scoped workload report.
type DoctorReport struct {
	AssignedPatients int64 `json:"assignedPatients"`
	PendingResults   int64 `json:"pendingResults"`
	PendingOrders    int64 `json:"pendingOrders"`
}

// NursingReport is the nursing-scoped report.
type NursingReport struct {
	AdmittedPatients        int64 `json:"admittedPatients"`
	Handovers               int64 `json:"handovers"`
	UnacknowledgedHandovers int64 `json:"unacknowledgedHandovers"`
	OnDutyToday             int64 `json:"onDutyToday"`
}

// PharmacyReport is the pharmacy-scoped report.
type PharmacyReport struct {
	DispensedToday      int64   `json:"dispensedToday"`
	DispensedValueToday float64 `json:"dispensedValueToday"`
	LowStock            int64   `json:"lowStock"`
	StockOnHand         float64 `json:"stockOnHand"`
	ExpiringSoon        int64   `json:"expiringSoon"`
	RecentAdjustments   int64   `json:"recentAdjustments"`
}

// LabReport is the laboratory-scoped report.
type LabReport struct {
	RequestsByStatus     []NameValue `json:"requestsByStatus"`
	PendingVerification  int64       `json:"pendingVerification"`
	AvgTurnaroundMinutes float64     `json:"avgTurnaroundMinutes"`
}

// CashierReport is the cashier-scoped report.
type CashierReport struct {
	CollectedToday float64 `json:"collectedToday"`
	PaymentsToday  int64   `json:"paymentsToday"`
	Outstanding    float64 `json:"outstanding"`
	RefundedToday  float64 `json:"refundedToday"`
	OpenShifts     int64   `json:"openShifts"`
	ShiftVariance  float64 `json:"shiftVariance"`
}

// InventoryReport is the storekeeper-scoped report.
type InventoryReport struct {
	LowStock           int64   `json:"lowStock"`
	ExpiringSoon       int64   `json:"expiringSoon"`
	StockOnHand        float64 `json:"stockOnHand"`
	CountsWithVariance int64   `json:"countsWithVariance"`
	TotalVariance      float64 `json:"totalVariance"`
}

// ReceptionReport is the receptionist-scoped report.
type ReceptionReport struct {
	RegisteredToday int64 `json:"registeredToday"`
	AdmittedToday   int64 `json:"admittedToday"`
	DischargedToday int64 `json:"dischargedToday"`
	TriageToday     int64 `json:"triageToday"`
}
