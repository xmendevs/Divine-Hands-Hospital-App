package httpapi

import (
	"log/slog"
	"net/http"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/config"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

// Option customizes server construction.
type Option func(*server)

// WithChecks overrides the default readiness checks.
func WithChecks(checks map[string]Checker) Option {
	return func(s *server) {
		s.checks = checks
	}
}

// NewRouter builds the fully-wired HTTP handler: middleware chain plus all
// routes. Health and readiness are unversioned; business endpoints live under
// the versioned /api/v1 prefix. st may be nil for tests that only exercise
// unauthenticated endpoints.
func NewRouter(cfg config.Config, logger *slog.Logger, st *store.Store, opts ...Option) http.Handler {
	s := newServer(cfg, logger, st)
	for _, opt := range opts {
		opt(s)
	}

	mux := http.NewServeMux()

	// Public / unversioned.
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /ready", s.handleReady)
	mux.HandleFunc("GET /api/v1/version", s.handleVersion)

	// Public authentication.
	mux.HandleFunc("POST /api/v1/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/v1/auth/password-reset/request", s.handlePasswordResetRequest)
	mux.HandleFunc("POST /api/v1/auth/password-reset/confirm", s.handlePasswordResetConfirm)

	// Authenticated.
	mux.Handle("GET /api/v1/auth/me", s.requireAuth(http.HandlerFunc(s.handleMe)))
	mux.Handle("POST /api/v1/auth/logout", s.requireAuth(http.HandlerFunc(s.handleLogout)))
	mux.Handle("POST /api/v1/auth/change-password", s.requireAuth(http.HandlerFunc(s.handleChangePassword)))
	mux.Handle("POST /api/v1/auth/mfa/setup", s.requireAuth(http.HandlerFunc(s.handleMFASetup)))
	mux.Handle("POST /api/v1/auth/mfa/confirm", s.requireAuth(http.HandlerFunc(s.handleMFAConfirm)))

	// Admin (authenticated + permission-checked).
	mux.Handle("GET /api/v1/admin/users", s.admin("users.view", s.handleListUsers))
	mux.Handle("POST /api/v1/admin/users", s.admin("users.create", s.handleCreateUser))
	mux.Handle("GET /api/v1/admin/users/{id}", s.admin("users.view", s.handleGetUser))
	mux.Handle("PATCH /api/v1/admin/users/{id}", s.admin("users.edit", s.handleUpdateUser))
	mux.Handle("POST /api/v1/admin/users/{id}/suspend", s.admin("users.edit", s.handleSuspendUser))
	mux.Handle("POST /api/v1/admin/users/{id}/activate", s.admin("users.edit", s.handleActivateUser))
	mux.Handle("PUT /api/v1/admin/users/{id}/roles", s.admin("roles.assign", s.handleAssignRoles))

	mux.Handle("GET /api/v1/admin/roles", s.admin("roles.view", s.handleListRoles))
	mux.Handle("POST /api/v1/admin/roles", s.admin("roles.create", s.handleCreateRole))
	mux.Handle("PATCH /api/v1/admin/roles/{id}", s.admin("roles.edit", s.handleUpdateRole))
	mux.Handle("PUT /api/v1/admin/roles/{id}/permissions", s.admin("roles.edit", s.handleSetRolePermissions))
	mux.Handle("GET /api/v1/admin/permissions", s.admin("roles.view", s.handleListPermissions))

	mux.Handle("GET /api/v1/admin/departments", s.admin("departments.view", s.handleListDepartments))
	mux.Handle("POST /api/v1/admin/departments", s.admin("departments.create", s.handleCreateDepartment))

	mux.Handle("GET /api/v1/admin/audit-logs", s.admin("audit.view", s.handleListAuditLogs))

	mux.Handle("GET /api/v1/admin/settings", s.admin("settings.view", s.handleListSettings))
	mux.Handle("PUT /api/v1/admin/settings/{key}", s.admin("settings.edit", s.handleSetSetting))

	// Patients & families (authenticated + permission-checked).
	mux.Handle("POST /api/v1/patients", s.perm("patients.create", s.handleRegisterPatient))
	mux.Handle("GET /api/v1/patients/search", s.perm("patients.search", s.handleSearchPatients))
	mux.Handle("GET /api/v1/patients/{id}", s.perm("patients.view", s.handleGetPatient))
	mux.Handle("PATCH /api/v1/patients/{id}", s.perm("patients.edit", s.handleUpdatePatient))
	mux.Handle("POST /api/v1/patients/{id}/amend", s.perm("patients.amend", s.handleAmendPatient))
	mux.Handle("GET /api/v1/patients/{id}/clinical", s.perm("clinical.view", s.handleListClinical))
	mux.Handle("POST /api/v1/patients/{id}/clinical", s.perm("clinical.edit", s.handleAddClinical))
	mux.Handle("PATCH /api/v1/patients/{id}/clinical/{entryId}", s.perm("patients.amend", s.handleAmendClinical))
	mux.Handle("GET /api/v1/patients/{id}/timeline", s.perm("patients.view", s.handleListTimeline))
	mux.Handle("GET /api/v1/patients/{id}/documents", s.perm("documents.view", s.handleListDocuments))
	mux.Handle("POST /api/v1/patients/{id}/documents", s.perm("documents.upload", s.handleAddDocument))

	mux.Handle("POST /api/v1/families", s.perm("families.create", s.handleCreateFamily))
	mux.Handle("GET /api/v1/families/{id}", s.perm("families.view", s.handleGetFamily))

	// Orders.
	mux.Handle("POST /api/v1/patients/{id}/orders", s.perm("orders.create", s.handleCreateOrder))
	mux.Handle("GET /api/v1/patients/{id}/orders", s.perm("orders.view", s.handleListPatientOrders))
	mux.Handle("GET /api/v1/orders/actionable", s.perm("orders.manage", s.handleListActionableOrders))
	mux.Handle("POST /api/v1/orders/{id}/submit", s.perm("orders.create", s.handleSubmitOrder))
	mux.Handle("POST /api/v1/orders/{id}/cancel", s.perm("orders.create", s.handleCancelOrder))
	mux.Handle("POST /api/v1/orders/{id}/status", s.perm("orders.manage", s.handleTransitionOrder))

	// Notes (immutable versions).
	mux.Handle("POST /api/v1/patients/{id}/notes", s.perm("notes.write", s.handleCreateNote))
	mux.Handle("GET /api/v1/patients/{id}/notes", s.perm("notes.view", s.handleListNotes))
	mux.Handle("GET /api/v1/patients/{id}/notes/{groupId}", s.perm("notes.view", s.handleListNoteVersions))
	mux.Handle("POST /api/v1/patients/{id}/notes/{groupId}/versions", s.perm("notes.write", s.handleAddNoteVersion))

	// Observations & vitals.
	mux.Handle("POST /api/v1/patients/{id}/observations", s.perm("vitals.record", s.handleAddObservation))
	mux.Handle("GET /api/v1/patients/{id}/observations", s.perm("vitals.view", s.handleListObservations))

	// Medication administration records (MAR).
	mux.Handle("POST /api/v1/patients/{id}/administrations", s.perm("mar.record", s.handleAddAdministration))
	mux.Handle("GET /api/v1/patients/{id}/administrations", s.perm("mar.view", s.handleListAdministrations))

	// Tasks.
	mux.Handle("POST /api/v1/tasks", s.perm("tasks.create", s.handleCreateTask))
	mux.Handle("GET /api/v1/tasks", s.perm("tasks.view", s.handleListTasks))
	mux.Handle("POST /api/v1/tasks/{id}/complete", s.perm("tasks.complete", s.handleCompleteTask))
	mux.Handle("GET /api/v1/patients/{id}/tasks", s.perm("tasks.view", s.handleListPatientTasks))

	// Admissions.
	mux.Handle("POST /api/v1/patients/{id}/admissions", s.perm("admissions.manage", s.handleAdmitPatient))
	mux.Handle("GET /api/v1/patients/{id}/admissions", s.perm("admissions.view", s.handleListAdmissions))
	mux.Handle("POST /api/v1/patients/{id}/admissions/{admissionId}/discharge", s.perm("admissions.manage", s.handleDischargePatient))

	// Reports.
	mux.Handle("POST /api/v1/patients/{id}/reports", s.perm("reports.write", s.handleCreateReport))
	mux.Handle("GET /api/v1/patients/{id}/reports", s.perm("reports.view", s.handleListReports))

	// Emergency triage + queue & assignments.
	mux.Handle("POST /api/v1/clinical/triage", s.perm("triage.manage", s.handleTriage))
	mux.Handle("GET /api/v1/clinical/queue", s.perm("assignments.view", s.handleMyQueue))
	mux.Handle("POST /api/v1/patients/{id}/assignments", s.perm("assignments.manage", s.handleAssignPatient))

	return withMiddleware(mux, logger)
}
