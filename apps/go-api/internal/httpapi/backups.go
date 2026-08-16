// Backup & disaster recovery endpoints (Phase 13). Only admin and super
// admin (via the backups.* permissions) can view status, trigger backups or
// run restore verification; every manual trigger is audited.
package httpapi

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/backup"
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

// backupSettingPrefix marks the system settings managed by the Super Admin
// backup screen (see apps/desktop SettingsPage).
const backupSettingPrefix = "backup."

func settingString(m map[string]json.RawMessage, key, def string) string {
	if raw, ok := m[key]; ok {
		var v string
		if err := json.Unmarshal(raw, &v); err == nil {
			return v
		}
	}
	return def
}

func settingBool(m map[string]json.RawMessage, key string, def bool) bool {
	if raw, ok := m[key]; ok {
		var v bool
		if err := json.Unmarshal(raw, &v); err == nil {
			return v
		}
	}
	return def
}

func settingInt(m map[string]json.RawMessage, key string, def int) int {
	if raw, ok := m[key]; ok {
		var v int
		if err := json.Unmarshal(raw, &v); err == nil {
			return v
		}
	}
	return def
}

func envDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envSplit(key string) []string {
	var out []string
	for _, p := range strings.Split(os.Getenv(key), ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func parseDuration(s string) time.Duration {
	d, err := time.ParseDuration(s)
	if err != nil {
		return 0
	}
	return d
}

// buildBackupConfig assembles the backup manager configuration from the system
// settings table (edited in the Super Admin → Settings screen) with environment
// variables as fallback for values the screen does not manage (encryption key,
// pg_dump path, migrations directory). Returns nil when the store is
// unavailable so the backup endpoints report backup_not_configured.
func (s *server) buildBackupConfig(ctx context.Context) *backup.Config {
	if s.store == nil {
		return nil
	}
	settings, err := s.store.GetSettingsMap(ctx)
	if err != nil {
		s.logger.Error("read backup settings failed", "error", err)
		return nil
	}

	encKey, err := hex.DecodeString(os.Getenv("BACKUP_ENCRYPTION_KEY"))
	if err != nil || len(encKey) != 32 {
		encKey = nil
	}

	enabled := settingBool(settings, "backup.enabled", os.Getenv("BACKUP_ENABLED") == "true")
	// A backup without an encryption key cannot be restored later; treat the
	// service as disabled until the server operator sets BACKUP_ENCRYPTION_KEY.
	if enabled && len(encKey) != 32 {
		enabled = false
		s.logger.Warn("backups disabled: BACKUP_ENCRYPTION_KEY is not set to a valid 32-byte key")
	}

	cfg := &backup.Config{
		Enabled:       enabled,
		LocalDir:      settingString(settings, "backup.local_dir", envDefault("BACKUP_LOCAL_DIR", "./backups")),
		EncryptionKey: encKey,
		PGDumpPath:    envDefault("BACKUP_PGDUMP_PATH", "pg_dump"),
		DatabaseURL:   s.cfg.DatabaseURL,
		MigrationsDir: envDefault("MIGRATIONS_DIR", "../../db/migrations"),
		ConfigFiles:   envSplit("BACKUP_CONFIG_FILES"),
		Retention: backup.RetentionPolicy{
			Daily:   settingInt(settings, "backup.retention_daily", envInt("BACKUP_RETENTION_DAILY", 7)),
			Weekly:  settingInt(settings, "backup.retention_weekly", envInt("BACKUP_RETENTION_WEEKLY", 4)),
			Monthly: settingInt(settings, "backup.retention_monthly", envInt("BACKUP_RETENTION_MONTHLY", 3)),
		},
		LocalInterval:  parseDuration(settingString(settings, "backup.local_interval", envDefault("BACKUP_LOCAL_INTERVAL", "24h"))),
		CloudInterval:  parseDuration(settingString(settings, "backup.cloud_interval", envDefault("BACKUP_CLOUD_INTERVAL", "24h"))),
		VerifyInterval: parseDuration(settingString(settings, "backup.verify_interval", envDefault("BACKUP_VERIFY_INTERVAL", "24h"))),
	}

	if ep := settingString(settings, "backup.s3.endpoint", ""); ep != "" {
		s3cfg := &backup.S3Config{
			Endpoint:  ep,
			Region:    settingString(settings, "backup.s3.region", ""),
			Bucket:    settingString(settings, "backup.s3.bucket", ""),
			Prefix:    settingString(settings, "backup.s3.prefix", ""),
			AccessKey: settingString(settings, "backup.s3.access_key", ""),
			SecretKey: settingString(settings, "backup.s3.secret_key", ""),
			PathStyle: settingBool(settings, "backup.s3.path_style", false),
		}
		// A cloud target needs endpoint + bucket + credentials.
		if s3cfg.Bucket != "" && s3cfg.AccessKey != "" && s3cfg.SecretKey != "" {
			cfg.S3 = s3cfg
		}
	}
	return cfg
}

// rebuildBackupMgr rebuilds the backup manager from current settings and
// restarts its scheduler so changed values take effect immediately. Called at
// startup and after every backup.* setting update.
func (s *server) rebuildBackupMgr() {
	if s.backupMgr != nil {
		s.backupMgr.Stop()
	}
	cfg := s.buildBackupConfig(context.Background())
	if cfg == nil {
		s.backupMgr = nil
		return
	}
	mgr := backup.NewManager(*cfg, s.store, s.store, nil)
	mgr.SetLogger(s.logger.Info)
	mgr.Start(context.Background())
	s.backupMgr = mgr
}
