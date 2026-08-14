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
)
