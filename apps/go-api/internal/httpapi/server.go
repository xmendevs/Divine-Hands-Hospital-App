package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/auth"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/config"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

const serviceVersion = "0.4.0"

type server struct {
	cfg       config.Config
	logger    *slog.Logger
	store     *store.Store
	checks    map[string]Checker
	mfaCipher *auth.Cipher
}

func newServer(cfg config.Config, logger *slog.Logger, st *store.Store) *server {
	s := &server{
		cfg:    cfg,
		logger: logger,
		store:  st,
		checks: defaultChecks(cfg),
	}
	if cfg.MFAEncryptionKey != "" {
		if c, err := auth.NewCipherFromHex(cfg.MFAEncryptionKey); err == nil {
			s.mfaCipher = c
		} else {
			logger.Warn("MFA encryption key invalid; MFA features disabled", "error", err)
		}
	}
	return s
}

// handleHealth reports liveness: the process is up and able to serve requests.
func (s *server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"service": s.cfg.ServiceName,
		"time":    time.Now().UTC().Format(time.RFC3339),
	})
}

// handleReady reports readiness: all configured dependencies are reachable.
func (s *server) handleReady(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	results := make(map[string]CheckResult, len(s.checks))
	ready := true
	for name, check := range s.checks {
		res := check.Check(ctx)
		results[name] = res
		if res.Status != "ok" {
			ready = false
		}
	}

	status := http.StatusOK
	body := map[string]any{"status": "ready", "checks": results}
	if !ready {
		status = http.StatusServiceUnavailable
		body["status"] = "not_ready"
	}
	writeJSON(w, status, body)
}

// handleVersion exposes service metadata under the versioned API prefix.
func (s *server) handleVersion(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"service":  s.cfg.ServiceName,
		"version":  serviceVersion,
		"timezone": s.cfg.Timezone,
		"utcNow":   time.Now().UTC().Format(time.RFC3339),
	})
}
