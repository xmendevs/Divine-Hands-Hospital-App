//go:build integration

package httpapi

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/auth"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/backup"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/config"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

// fakeS3 is an in-memory S3-compatible endpoint for backup cloud tests.
type fakeS3 struct {
	mu      sync.Mutex
	objects map[string][]byte
	server  *httptest.Server
}

func newFakeS3(t *testing.T) *fakeS3 {
	t.Helper()
	f := &fakeS3{objects: map[string][]byte{}}
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		key := strings.TrimPrefix(r.URL.Path, "/hims-backups")
		key = strings.TrimPrefix(key, "/")
		switch r.Method {
		case http.MethodPut:
			b, _ := io.ReadAll(r.Body)
			f.objects[key] = b
			w.WriteHeader(http.StatusOK)
		case http.MethodGet:
			if b, ok := f.objects[key]; ok {
				w.Write(b)
				return
			}
			if key != "" {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			var sb strings.Builder
			sb.WriteString(`<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>`)
			for k, v := range f.objects {
				if strings.HasPrefix(k, r.URL.Query().Get("prefix")) {
					fmt.Fprintf(&sb, "<Contents><Key>%s</Key><Size>%d</Size></Contents>", k, len(v))
				}
			}
			sb.WriteString(`</ListBucketResult>`)
			w.Write([]byte(sb.String()))
		case http.MethodDelete:
			delete(f.objects, key)
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}))
	t.Cleanup(f.server.Close)
	return f
}

func (f *fakeS3) URL() string { return f.server.URL }

func (f *fakeS3) keys() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []string
	for k := range f.objects {
		out = append(out, k)
	}
	return out
}

const testBackupKey = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"

// newBackupRouter builds a router whose backup endpoints use the given manager.
func newBackupRouter(t *testing.T, mgr *backup.Manager) http.Handler {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := config.Config{
		ServiceName: "go-api", SessionTTL: time.Hour, Timezone: "UTC",
		MFAIssuer: "Test", MFAEncryptionKey: testMFAKey,
	}
	return NewRouter(cfg, logger, testStore, WithBackupManager(mgr))
}

func findPgDump(t *testing.T) string {
	t.Helper()
	for _, p := range []string{"/usr/local/bin/pg_dump", "/usr/bin/pg_dump"} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	if p, err := exec.LookPath("pg_dump"); err == nil {
		return p
	}
	t.Skip("pg_dump not available on this host; skipping backup integration tests")
	return ""
}

// newTestManager builds a backup manager wired to the shared test store.
func newTestManager(t *testing.T, localDir string, s3URL string, now func() time.Time) *backup.Manager {
	t.Helper()
	key, _ := hex.DecodeString(testBackupKey)
	var s3 *backup.S3Config
	if s3URL != "" {
		s3 = &backup.S3Config{
			Endpoint: s3URL, Region: "us-east-1", Bucket: "hims-backups",
			Prefix: "prefix/", AccessKey: "ak", SecretKey: "sk", PathStyle: true,
		}
	}
	mgr := backup.NewManager(backup.Config{
		Enabled:        true,
		LocalDir:       localDir,
		S3:             s3,
		EncryptionKey:  key,
		PGDumpPath:     findPgDump(t),
		DatabaseURL:    testDBURL,
		MigrationsDir:  findMigrationsDir(),
		Retention:      backup.RetentionPolicy{Daily: 2, Weekly: 1, Monthly: 1},
		LocalInterval:  0,
		CloudInterval:  0,
		VerifyInterval: 0,
	}, testStore, testStore, now)
	return mgr
}

func doBackupJSON(t *testing.T, h http.Handler, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, rd)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

func listLocalBackups(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, e := range entries {
		if !e.IsDir() {
			out = append(out, e.Name())
		}
	}
	return out
}

func TestBackupRunLocalEndToEnd(t *testing.T) {
	dir := t.TempDir()
	mgr := newTestManager(t, dir, "", nil)
	h := newBackupRouter(t, mgr)

	rr := doBackupJSON(t, h, http.MethodPost, "/api/v1/backups/run", adminToken, map[string]string{"target": "local"})
	if rr.Code != http.StatusOK {
		t.Fatalf("run status = %d, body=%s", rr.Code, rr.Body.String())
	}

	files := listLocalBackups(t, dir)
	var payload, manifest string
	for _, f := range files {
		if strings.HasSuffix(f, ".sql.gz.enc") {
			payload = f
		}
		if strings.HasSuffix(f, ".json") {
			manifest = f
		}
	}
	if payload == "" || manifest == "" {
		t.Fatalf("expected encrypted payload and manifest, got %v", files)
	}

	// The payload must be encrypted: no plaintext SQL may leak.
	b, err := os.ReadFile(filepath.Join(dir, payload))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(b, []byte("CREATE TABLE")) || bytes.Contains(b, []byte("INSERT INTO")) {
		t.Fatal("backup payload contains plaintext SQL; encryption missing")
	}

	mf, err := os.ReadFile(filepath.Join(dir, manifest))
	if err != nil {
		t.Fatal(err)
	}
	var m struct {
		Format           string `json:"format"`
		SHA256           string `json:"sha256"`
		KeyID            string `json:"keyId"`
		MigrationVersion int64  `json:"migrationVersion"`
	}
	if err := json.Unmarshal(mf, &m); err != nil {
		t.Fatal(err)
	}
	if m.Format != "pg_plain_gzip_aes256gcm" || len(m.SHA256) != 64 || m.KeyID == "" || m.MigrationVersion < 24 {
		t.Fatalf("manifest incomplete: %+v", m)
	}

	// Dashboard status reflects the run.
	rr = doBackupJSON(t, h, http.MethodGet, "/api/v1/backups/status", adminToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("status status = %d", rr.Code)
	}
	var st map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &st)
	if st["enabled"] != true || st["local_healthy"] != true {
		t.Fatalf("status unexpected: %s", rr.Body.String())
	}
	// The dashboard banner derives from health_status: it must be populated.
	if hs, ok := st["health_status"].(string); !ok || hs == "" {
		t.Fatalf("health_status missing/empty: %s", rr.Body.String())
	}

	// Job ledger records the run.
	rr = doBackupJSON(t, h, http.MethodGet, "/api/v1/backups/jobs", adminToken, nil)
	if rr.Code != http.StatusOK || !bytes.Contains(rr.Body.Bytes(), []byte(`"job_type":"local"`)) {
		t.Fatalf("jobs unexpected: %d %s", rr.Code, rr.Body.String())
	}

	// The manual trigger is audited.
	rr = doBackupJSON(t, h, http.MethodGet, "/api/v1/admin/audit-logs", superToken, nil)
	if rr.Code != http.StatusOK || !bytes.Contains(rr.Body.Bytes(), []byte("backup.run")) {
		t.Fatalf("audit log missing backup.run: %d %s", rr.Code, rr.Body.String())
	}

	// Permission guard: a user without backups.* is rejected.
	hash, _ := auth.HashPassword("WeakPass123!")
	uid, err := testStore.CreateUserAccount(t.Context(), store.CreateUserParams{
		Username: "bkclerk", Email: "bkclerk@test", PasswordHash: hash,
		Status: "active", MustChangePassword: false,
		EmployeeNo: "E-BK1", FirstName: "Bk", LastName: "Clerk",
		RoleCodes: []string{"auditor"},
	})
	if err != nil {
		t.Fatal(err)
	}
	clerkToken := makeSession(t.Context(), testStore, uid)
	rr = doBackupJSON(t, h, http.MethodPost, "/api/v1/backups/run", clerkToken, nil)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("clerk run status = %d, want 403", rr.Code)
	}
}

func TestBackupVerifyRestoresIsolatedDatabase(t *testing.T) {
	dir := t.TempDir()
	mgr := newTestManager(t, dir, "", nil)
	h := newBackupRouter(t, mgr)

	rr := doBackupJSON(t, h, http.MethodPost, "/api/v1/backups/run", adminToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("run status = %d, body=%s", rr.Code, rr.Body.String())
	}

	rr = doBackupJSON(t, h, http.MethodPost, "/api/v1/backups/verify", adminToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("verify status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var out struct {
		Success bool `json:"success"`
		Verify  struct {
			TableCount       int              `json:"tableCount"`
			SampleTables     []string         `json:"sampleTables"`
			MigrationVersion int64            `json:"migrationVersion"`
			ChecksumOK       bool             `json:"checksumOK"`
			SampleRows       map[string]int64 `json:"sampleRows"`
		} `json:"verify"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if !out.Success || !out.Verify.ChecksumOK {
		t.Fatalf("verification not successful: %s", rr.Body.String())
	}
	if out.Verify.TableCount < 20 {
		t.Fatalf("expected a full schema, got %d tables", out.Verify.TableCount)
	}
	if len(out.Verify.SampleTables) != 5 {
		t.Fatalf("sample tables wrong: %v", out.Verify.SampleTables)
	}
	if out.Verify.MigrationVersion < 24 {
		t.Fatalf("migration version on restored DB = %d", out.Verify.MigrationVersion)
	}

	// No scratch database may be left behind.
	conn, err := pgx.Connect(t.Context(), testDBURL)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(t.Context())
	var n int
	if err := conn.QueryRow(t.Context(), `SELECT COUNT(*) FROM pg_database WHERE datname LIKE 'hims_verify_%'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("%d scratch databases left behind", n)
	}
}

func TestBackupCloudUploadsAndPrunes(t *testing.T) {
	fake := newFakeS3(t)
	dir := t.TempDir()

	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC) // Thursday: daily tier
	current := &now
	mgr := newTestManager(t, dir, fake.URL(), func() time.Time { return *current })
	h := newBackupRouter(t, mgr)

	// First cloud backup.
	rr := doBackupJSON(t, h, http.MethodPost, "/api/v1/backups/run", adminToken, map[string]string{"target": "cloud"})
	if rr.Code != http.StatusOK {
		t.Fatalf("cloud run 1 status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// Second cloud backup one day later.
	*current = current.Add(24 * time.Hour)
	rr = doBackupJSON(t, h, http.MethodPost, "/api/v1/backups/run", adminToken, map[string]string{"target": "cloud"})
	if rr.Code != http.StatusOK {
		t.Fatalf("cloud run 2 status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// Third cloud backup another day later; retention keeps the newest 2.
	*current = current.Add(24 * time.Hour)
	rr = doBackupJSON(t, h, http.MethodPost, "/api/v1/backups/run", adminToken, map[string]string{"target": "cloud"})
	if rr.Code != http.StatusOK {
		t.Fatalf("cloud run 3 status = %d, body=%s", rr.Code, rr.Body.String())
	}

	var payloads, manifests int
	for _, k := range fake.keys() {
		switch {
		case strings.Contains(k, "backups/backup_"):
			payloads++
		case strings.Contains(k, "manifests/"):
			manifests++
		}
	}
	if payloads != 2 {
		t.Fatalf("expected 2 payloads after pruning, got %d (%v)", payloads, fake.keys())
	}
	if manifests != 1 {
		t.Fatalf("expected 1 manifest object, got %d", manifests)
	}

	// Status reports the cloud destination as healthy.
	rr = doBackupJSON(t, h, http.MethodGet, "/api/v1/backups/status", adminToken, nil)
	if rr.Code != http.StatusOK || !bytes.Contains(rr.Body.Bytes(), []byte(`"cloud_healthy":true`)) {
		t.Fatalf("cloud health status: %d %s", rr.Code, rr.Body.String())
	}

	// Cloud-only verification: remove local payloads, verify downloads from S3.
	for _, f := range listLocalBackups(t, dir) {
		if strings.HasSuffix(f, ".sql.gz.enc") {
			os.Remove(filepath.Join(dir, f))
		}
	}
	rr = doBackupJSON(t, h, http.MethodPost, "/api/v1/backups/verify", adminToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("cloud verify status = %d, body=%s", rr.Code, rr.Body.String())
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte(`"success":true`)) {
		t.Fatalf("cloud verify not successful: %s", rr.Body.String())
	}
}

func TestBackupFailureAlertsAdmins(t *testing.T) {
	// Point the manager at a dead S3 endpoint so the cloud run fails after a
	// successful local dump, then check the admin notification.
	dir := t.TempDir()
	mgr := newTestManager(t, dir, "http://127.0.0.1:1", nil)
	h := newBackupRouter(t, mgr)

	rr := doBackupJSON(t, h, http.MethodPost, "/api/v1/backups/run", adminToken, map[string]string{"target": "cloud"})
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 on cloud failure, got %d body=%s", rr.Code, rr.Body.String())
	}

	rr = doBackupJSON(t, h, http.MethodGet, "/api/v1/backups/jobs", adminToken, nil)
	if rr.Code != http.StatusOK || !bytes.Contains(rr.Body.Bytes(), []byte(`"status":"failed"`)) {
		t.Fatalf("failed job not recorded: %d %s", rr.Code, rr.Body.String())
	}

	rr = doBackupJSON(t, h, http.MethodGet, "/api/v1/notifications", adminToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("notifications status = %d", rr.Code)
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte("Backup failure")) {
		t.Fatalf("admin was not alerted: %s", rr.Body.String())
	}
}

// buildTestURL rebuilds a postgres:// URL from a parsed config, mirroring the
// backup package's connString helper (unexported there).
func buildTestURL(cfg pgx.ConnConfig) string {
	q := url.Values{}
	for k, v := range cfg.RuntimeParams {
		q.Set(k, v)
	}
	sslmode := "disable"
	if cfg.TLSConfig != nil {
		sslmode = "require"
	}
	q.Set("sslmode", sslmode)
	return fmt.Sprintf("postgres://%s:%s@%s:%d/%s?%s",
		url.QueryEscape(cfg.User), url.QueryEscape(cfg.Password), cfg.Host, cfg.Port, cfg.Database, q.Encode())
}

// maintenanceConn connects to the "postgres" database of the test server so
// tests can create/drop scratch databases. It uses a bounded background
// context (not t.Context) because it is also called from t.Cleanup, where the
// test context is already canceled.
func maintenanceConn(t *testing.T) *pgx.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cfg, err := pgx.ParseConfig(testDBURL)
	if err != nil {
		t.Fatal(err)
	}
	maint := *cfg
	maint.Database = "postgres"
	conn, err := pgx.Connect(ctx, buildTestURL(maint))
	if err != nil {
		t.Fatal(err)
	}
	return conn
}

func dropAndCreateDB(t *testing.T, name string) string {
	t.Helper()
	conn := maintenanceConn(t)
	defer conn.Close(t.Context())
	_, _ = conn.Exec(t.Context(), `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = `+quoteTest(name))
	_, _ = conn.Exec(t.Context(), `DROP DATABASE IF EXISTS `+quoteTest(name))
	if _, err := conn.Exec(t.Context(), `CREATE DATABASE `+quoteTest(name)); err != nil {
		t.Fatal(err)
	}
	cfg, err := pgx.ParseConfig(testDBURL)
	if err != nil {
		t.Fatal(err)
	}
	scratch := *cfg
	scratch.Database = name
	return buildTestURL(scratch)
}

func dropTestDB(t *testing.T, name string) {
	t.Helper()
	conn := maintenanceConn(t)
	defer conn.Close(t.Context())
	_, _ = conn.Exec(t.Context(), `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = `+quoteTest(name))
	_, _ = conn.Exec(t.Context(), `DROP DATABASE IF EXISTS `+quoteTest(name))
}

func quoteTest(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

func TestBackupCloudRestoresIntoNeonTarget(t *testing.T) {
	dir := t.TempDir()

	// A scratch database on the local test server stands in for the Neon
	// project: the restore path is identical (a remote Postgres).
	scratchName := "hims_neon_test"
	neonURL := dropAndCreateDB(t, scratchName)
	t.Cleanup(func() { dropTestDB(t, scratchName) })

	key, _ := hex.DecodeString(testBackupKey)
	mgr := backup.NewManager(backup.Config{
		Enabled:       true,
		LocalDir:      dir,
		Neon:          &backup.NeonConfig{ConnectionString: neonURL},
		EncryptionKey: key,
		PGDumpPath:    findPgDump(t),
		DatabaseURL:   testDBURL,
		MigrationsDir: findMigrationsDir(),
		Retention:     backup.RetentionPolicy{Daily: 2, Weekly: 1, Monthly: 1},
	}, testStore, testStore, nil)
	h := newBackupRouter(t, mgr)

	rr := doBackupJSON(t, h, http.MethodPost, "/api/v1/backups/run", adminToken, map[string]string{"target": "cloud"})
	if rr.Code != http.StatusOK {
		t.Fatalf("neon cloud run status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// The destination database now holds a fresh copy of the schema + data.
	conn, err := pgx.Connect(t.Context(), neonURL)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(t.Context())
	var tables int
	if err := conn.QueryRow(t.Context(), `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`).Scan(&tables); err != nil {
		t.Fatal(err)
	}
	if tables < 20 {
		t.Fatalf("restored schema has %d tables, want >= 20", tables)
	}
	var users int64
	if err := conn.QueryRow(t.Context(), `SELECT count(*) FROM public.users`).Scan(&users); err != nil {
		t.Fatal(err)
	}
	if users == 0 {
		t.Fatal("restored database has no users; restore did not load data")
	}

	// The job ledger records the run as a cloud job.
	rr = doBackupJSON(t, h, http.MethodGet, "/api/v1/backups/jobs", adminToken, nil)
	if rr.Code != http.StatusOK || !bytes.Contains(rr.Body.Bytes(), []byte(`"job_type":"cloud"`)) {
		t.Fatalf("jobs unexpected: %d %s", rr.Code, rr.Body.String())
	}
}

func TestBackupEndpointsRequireConfiguration(t *testing.T) {
	// A store-backed router always builds a backup manager from settings; with
	// no backup.* settings it reports backups as disabled (200, enabled:false)
	// and rejects runs, instead of serving a phantom "healthy" state.
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := config.Config{ServiceName: "go-api", Timezone: "UTC"}
	plain := NewRouter(cfg, logger, testStore)
	rr := doBackupJSON(t, plain, http.MethodGet, "/api/v1/backups/status", adminToken, nil)
	if rr.Code != http.StatusOK || !bytes.Contains(rr.Body.Bytes(), []byte(`"enabled":false`)) {
		t.Fatalf("status = %d, want 200 with enabled:false: %s", rr.Code, rr.Body.String())
	}
	rr = doBackupJSON(t, plain, http.MethodPost, "/api/v1/backups/run", adminToken, map[string]string{"target": "local"})
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("run on disabled service = %d, want 500", rr.Code)
	}
	rr = doBackupJSON(t, plain, http.MethodPost, "/api/v1/backups/verify", adminToken, nil)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("verify on disabled service = %d, want 500", rr.Code)
	}
}
