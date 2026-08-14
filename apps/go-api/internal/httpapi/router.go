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

	return withMiddleware(mux, logger)
}
