// Backup & disaster recovery endpoints (Phase 13). Only admin and super
// admin (via the backups.* permissions) can view status, trigger backups or
// run restore verification; every manual trigger is audited.
package httpapi

import (
	"net/http"
	"time"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

// handleBackupStatus returns the Super Admin backup dashboard summary.
func (s *server) handleBackupStatus(w http.ResponseWriter, r *http.Request) {
	if s.backupMgr == nil {
		writeError(w, r, http.StatusServiceUnavailable, "backup_not_configured", "backup service is not configured")
		return
	}
	st, err := s.backupMgr.Status(r.Context())
	if err != nil {
		s.logger.Error("backup status failed", "error", err)
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, st)
}

// handleBackupRun triggers a local or cloud backup synchronously.
func (s *server) handleBackupRun(w http.ResponseWriter, r *http.Request) {
	if s.backupMgr == nil {
		writeError(w, r, http.StatusServiceUnavailable, "backup_not_configured", "backup service is not configured")
		return
	}
	var body struct {
		Target string `json:"target"` // "local" (default) or "cloud"
	}
	_ = decodeJSON(r, &body)
	if body.Target == "" {
		body.Target = domain.BackupJobLocal
	}
	if body.Target != domain.BackupJobLocal && body.Target != domain.BackupJobCloud {
		writeError(w, r, http.StatusBadRequest, "invalid_target", "target must be local or cloud")
		return
	}

	actor := userFromContext(r.Context())
	s.recordAudit(r, domain.ActionBackupRun, "backups", body.Target, &actor.ID, map[string]any{"target": body.Target})

	started := time.Now().UTC()
	var runErr error
	if body.Target == domain.BackupJobCloud {
		runErr = s.backupMgr.RunCloud(r.Context())
	} else {
		runErr = s.backupMgr.RunLocal(r.Context())
	}
	if runErr != nil {
		writeError(w, r, http.StatusInternalServerError, "backup_failed", runErr.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success":    true,
		"target":     body.Target,
		"startedAt":  started,
		"finishedAt": time.Now().UTC(),
	})
}

// handleBackupVerify restores the newest backup into an isolated scratch
// database and reports the verification result.
func (s *server) handleBackupVerify(w http.ResponseWriter, r *http.Request) {
	if s.backupMgr == nil {
		writeError(w, r, http.StatusServiceUnavailable, "backup_not_configured", "backup service is not configured")
		return
	}
	actor := userFromContext(r.Context())
	s.recordAudit(r, domain.ActionBackupVerify, "backups", "verification", &actor.ID, nil)

	res, err := s.backupMgr.Verify(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "verification_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success":   true,
		"verify":    res,
		"startedAt": time.Now().UTC(),
	})
}

// handleBackupJobs lists recent backup/verification jobs.
func (s *server) handleBackupJobs(w http.ResponseWriter, r *http.Request) {
	jobs, err := s.store.ListBackupJobs(r.Context(), 50)
	if err != nil {
		s.logger.Error("list backup jobs failed", "error", err)
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, jobs)
}
