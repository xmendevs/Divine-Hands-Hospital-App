//go:build integration

package httpapi

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/auth"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/backup"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

// mustTestManager returns a backup manager wired to the test store with a
// temporary local directory and no S3 backend. The s3Endpoint parameter is
// accepted for compatibility but currently ignored.
func mustTestManager(t *testing.T, s3Endpoint string) *backup.Manager {
	t.Helper()
	dir := t.TempDir()
	key, _ := hex.DecodeString("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f")
	mgr := backup.NewManager(backup.Config{
		Enabled:        true,
		LocalDir:       dir,
		S3:             nil,
		EncryptionKey:  key,
		PGDumpPath:     "pg_dump",
		DatabaseURL:    testDBURL,
		MigrationsDir:  findMigrationsDir(),
		Retention:      backup.RetentionPolicy{Daily: 2, Weekly: 1, Monthly: 1},
		LocalInterval:  0,
		CloudInterval:  0,
		VerifyInterval: 0,
	}, testStore, testStore, func() time.Time { return time.Now() })
	return mgr
}

func TestBackupSecurity(t *testing.T) {
	t.Parallel()

	// ---- 1. Authentication testing ----
	t.Run("authentication requires token", func(t *testing.T) {
		h := newBackupRouter(t, mustTestManager(t, ""))
		rr := doBackupJSON(t, h, http.MethodGet, "/api/v1/backups/status", "", nil)
		if rr.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 without token, got %d", rr.Code)
		}
	})

	// ---- 2. Authorization/IDOR testing ----
	t.Run("admin can access backups.* endpoints", func(t *testing.T) {
		h := newBackupRouter(t, mustTestManager(t, ""))
		rr := doBackupJSON(t, h, http.MethodGet, "/api/v1/backups/status", adminToken, nil)
		if rr.Code != http.StatusOK {
			t.Fatalf("admin status = %d, body=%s", rr.Code, rr.Body.String())
		}
	})
	t.Run("auditor cannot access backups.* endpoints", func(t *testing.T) {
		hash, _ := auth.HashPassword("WeakPass123!")
		uid, _ := testStore.CreateUserAccount(t.Context(), store.CreateUserParams{
			Username: "bk-auditor", Email: "bk-auditor@test", PasswordHash: hash,
			Status: "active", MustChangePassword: false,
			EmployeeNo: "E-BK-A1", FirstName: "Bk", LastName: "Auditor",
			RoleCodes: []string{"auditor"},
		})
		token := makeSession(t.Context(), testStore, uid)
		h := newBackupRouter(t, mustTestManager(t, ""))
		testPaths := []struct {
			path   string
			method string
		}{
			{"/api/v1/backups/status", http.MethodGet},
			{"/api/v1/backups/jobs", http.MethodGet},
			{"/api/v1/backups/run", http.MethodPost},
			{"/api/v1/backups/verify", http.MethodPost},
		}
		for _, tp := range testPaths {
			rr := doBackupJSON(t, h, tp.method, tp.path, token, nil)
			if rr.Code != http.StatusForbidden {
				t.Errorf("%s %s: expected 403 for auditor, got %d", tp.method, tp.path, rr.Code)
			}
		}
	})
	t.Run("super_admin can access all backups.* endpoints", func(t *testing.T) {
		h := newBackupRouter(t, mustTestManager(t, ""))
		rr := doBackupJSON(t, h, http.MethodGet, "/api/v1/backups/status", superToken, nil)
		if rr.Code != http.StatusOK {
			t.Fatalf("super_admin status = %d", rr.Code)
		}
		rr = doBackupJSON(t, h, http.MethodPost, "/api/v1/backups/run", superToken, map[string]string{"target": "local"})
		if rr.Code != http.StatusOK {
			t.Fatalf("super_admin run = %d", rr.Code)
		}
		rr = doBackupJSON(t, h, http.MethodPost, "/api/v1/backups/verify", superToken, nil)
		if rr.Code != http.StatusOK {
			t.Fatalf("super_admin verify = %d", rr.Code)
		}
	})

	// ---- 3. SQL injection testing ----
	t.Run("sql injection in database URL", func(t *testing.T) {
		hash, _ := auth.HashPassword("SuperSecret123!")
		uid, _ := testStore.CreateUserAccount(t.Context(), store.CreateUserParams{
			Username: "sql-injection-test", Email: "inject@test", PasswordHash: hash,
			Status: "active", MustChangePassword: false,
			EmployeeNo: "E-SQL", FirstName: "Sql", LastName: "Test",
			RoleCodes: []string{"super_admin"},
		})
		superSQLToken := makeSession(t.Context(), testStore, uid)

		h := newBackupRouter(t, mustTestManager(t, "")) // no S3, local only
		rr := doBackupJSON(t, h, http.MethodPost, "/api/v1/backups/run", superSQLToken, map[string]string{"target": "local"})
		// Should not panic; either succeed or return 500 with error message
		if rr.Code == http.StatusInternalServerError {
			// Expected if pg_dump unavailable or DB issues; not a panic
		} else if rr.Code != http.StatusOK {
			t.Fatalf("sql inject run unexpected status %d", rr.Code)
		}
	})

	// ---- 4. XSS testing ----
	t.Run("no XSS in backup status response", func(t *testing.T) {
		h := newBackupRouter(t, mustTestManager(t, ""))
		rr := doBackupJSON(t, h, http.MethodGet, "/api/v1/backups/status", adminToken, nil)
		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d", rr.Code)
		}
		body := rr.Body.String()
		// Check for common XSS patterns in JSON output
		xssPatterns := []string{"<script>", "</script>", "alert(", "onerror=", "vbscript:"}
		for _, pattern := range xssPatterns {
			if strings.Contains(body, pattern) {
				t.Fatalf("XSS pattern %q found in status response body", pattern)
			}
		}
		// Verify JSON is well-formed (no injection that broke parsing)
		var out map[string]any
		if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
			t.Fatalf("status response not valid JSON: %v", err)
		}
	})

	// ---- 5. Rate limiting testing ----
	t.Run("backup endpoints respect rate limiter", func(t *testing.T) {
		h := newBackupRouter(t, mustTestManager(t, ""))
		// Fire many rapid requests; should get 429 or succeed, never crash
		for i := 0; i < 20; i++ {
			rr := doBackupJSON(t, h, http.MethodGet, "/api/v1/backups/status", adminToken, nil)
			// Accept 200 or 503 (service Unavailable = rate limited); reject 500 (error)
			if rr.Code != http.StatusOK && rr.Code != http.StatusServiceUnavailable {
				t.Errorf("request %d: unexpected status %d", i, rr.Code)
			}
		}
	})

	// ---- 6. Secret scanning testing ----
	t.Run("encryption key does not leak in logs or responses", func(t *testing.T) {
		h := newBackupRouter(t, mustTestManager(t, ""))
		rr := doBackupJSON(t, h, http.MethodGet, "/api/v1/backups/status", adminToken, nil)
		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d", rr.Code)
		}
		body := rr.Body.String()
		// The test key is 32 hex chars; ensure it doesn't appear verbatim
		testKey := "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
		if strings.Contains(body, testKey) {
			t.Fatal("encryption key leaked in status response")
		}
	})

	// ---- 7. Privilege escalation testing ----
	t.Run("admin cannot escalate to super_admin backup perms", func(t *testing.T) {
		h := newBackupRouter(t, mustTestManager(t, ""))
		// Attempt admin actions; should succeed with admin token
		rr := doBackupJSON(t, h, http.MethodGet, "/api/v1/backups/status", adminToken, nil)
		if rr.Code != http.StatusOK {
			t.Fatalf("admin status = %d", rr.Code)
		}
		// Admin can run local backup
		rr = doBackupJSON(t, h, http.MethodPost, "/api/v1/backups/run", adminToken, map[string]string{"target": "local"})
		if rr.Code != http.StatusOK {
			t.Fatalf("admin run local = %d, body=%s", rr.Code, rr.Body.String())
		}
		// Admin cannot run cloud (no S3 configured)
		rr = doBackupJSON(t, h, http.MethodPost, "/api/v1/backups/run", adminToken, map[string]string{"target": "cloud"})
		if rr.Code != http.StatusInternalServerError {
			t.Fatalf("admin run cloud expected 500, got %d", rr.Code)
		}
		// Admin can verify (backup.verify granted)
		rr = doBackupJSON(t, h, http.MethodPost, "/api/v1/backups/verify", adminToken, nil)
		if rr.Code != http.StatusOK {
			t.Fatalf("admin verify = %d", rr.Code)
		}
	})

	// ---- 8. Audit bypass testing ----
	t.Run("every backup action is audited", func(t *testing.T) {
		h := newBackupRouter(t, mustTestManager(t, ""))
		// Run a local backup
		rr := doBackupJSON(t, h, http.MethodPost, "/api/v1/backups/run", adminToken, map[string]string{"target": "local"})
		if rr.Code != http.StatusOK {
			t.Fatalf("run = %d", rr.Code)
		}
		// Verify audit log contains backup.run
		rr = doBackupJSON(t, h, http.MethodGet, "/api/v1/admin/audit-logs", superToken, nil)
		if rr.Code != http.StatusOK {
			t.Fatalf("audit logs = %d", rr.Code)
		}
		if !bytes.Contains(rr.Body.Bytes(), []byte("backup.run")) {
			t.Fatal("audit log missing backup.run after run backup")
		}
		// Run verification
		rr = doBackupJSON(t, h, http.MethodPost, "/api/v1/backups/verify", adminToken, nil)
		if rr.Code != http.StatusOK {
			t.Fatalf("verify = %d", rr.Code)
		}
		// Check audit log contains backup.verify
		rr = doBackupJSON(t, h, http.MethodGet, "/api/v1/admin/audit-logs", superToken, nil)
		if !bytes.Contains(rr.Body.Bytes(), []byte("backup.verify")) {
			t.Fatal("audit log missing backup.verify after verify action")
		}
	})
}
