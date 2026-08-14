package httpapi

import (
	"log/slog"
	"net/http"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/config"
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
// a versioned prefix (/api/v1/...).
func NewRouter(cfg config.Config, logger *slog.Logger, opts ...Option) http.Handler {
	s := newServer(cfg, logger)
	for _, opt := range opts {
		opt(s)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /ready", s.handleReady)
	mux.HandleFunc("GET /api/v1/version", s.handleVersion)

	return withMiddleware(mux, logger)
}
