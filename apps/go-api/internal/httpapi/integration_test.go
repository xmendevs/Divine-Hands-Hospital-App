//go:build integration

package httpapi

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
	migratepgx "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pquerna/otp/totp"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/auth"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/config"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

var (
	testDBURL   string
	testStore   *store.Store
	testHandler http.Handler
	superToken  string
	adminToken  string
	adminUserID string
	superUserID string
)

const (
	superPassword = "SuperSecret123!"
	adminPassword = "AdminSecret123!"
	testMFAKey    = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
)

func TestMain(m *testing.M) {
	testDBURL = os.Getenv("TEST_DATABASE_URL")
	if testDBURL == "" {
		fmt.Println("TEST_DATABASE_URL not set; skipping integration tests")
		os.Exit(0)
	}
	ctx := context.Background()

	migrateReset(tDBName())

	st, err := store.New(ctx, testDBURL)
	if err != nil {
		fmt.Println("connect failed:", err)
		os.Exit(1)
	}
	testStore = st
	defer st.Close()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := config.Config{
		ServiceName:      "go-api",
		SessionTTL:       time.Hour,
		PasswordResetTTL: time.Minute,
		MFAIssuer:        "Test",
		MFAEncryptionKey: testMFAKey,
		Timezone:         "UTC",
	}
	testHandler = NewRouter(cfg, logger, st)

	seedUsers(ctx, st)

	os.Exit(m.Run())
}

func tDBName() string {
	c, err := pgx.ParseConfig(testDBURL)
	if err != nil {
		return "unknown"
	}
	return c.Database
}

func migrateReset(dbName string) {
	_ = dbName
	pgxCfg, err := pgx.ParseConfig(testDBURL)
	if err != nil {
		fmt.Println("parse url:", err)
		os.Exit(1)
	}
	sqlDB, err := sql.Open("pgx", testDBURL)
	if err != nil {
		fmt.Println("sql open:", err)
		os.Exit(1)
	}
	defer sqlDB.Close()

	// Fully reset the schema (drops all tables and any prior migrate state).
	if _, err := sqlDB.Exec(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); err != nil {
		fmt.Println("reset schema:", err)
		os.Exit(1)
	}

	driver, err := migratepgx.WithInstance(sqlDB, &migratepgx.Config{DatabaseName: pgxCfg.Database, SchemaName: "public"})
	if err != nil {
		fmt.Println("migrate driver:", err)
		os.Exit(1)
	}
	src, err := iofs.New(os.DirFS(findMigrationsDir()), ".")
	if err != nil {
		fmt.Println("migrate source:", err)
		os.Exit(1)
	}
	m, err := migrate.NewWithInstance("iofs", src, "pgx", driver)
	if err != nil {
		fmt.Println("migrate:", err)
		os.Exit(1)
	}
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		fmt.Println("migrate up:", err)
		os.Exit(1)
	}
}

func findMigrationsDir() string {
	if v := os.Getenv("MIGRATIONS_DIR"); v != "" {
		return v
	}
	dir, _ := os.Getwd()
	for {
		candidate := filepath.Join(dir, "db", "migrations")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "db/migrations"
}

func seedUsers(ctx context.Context, st *store.Store) {
	hash, _ := auth.HashPassword(superPassword)
	superUserID, _ = st.CreateUserAccount(ctx, store.CreateUserParams{
		Username: "superadmin", Email: "superadmin@test", PasswordHash: hash,
		Status: domain.UserStatusActive, MustChangePassword: false,
		EmployeeNo: "E1", FirstName: "Super", LastName: "Admin",
		RoleCodes: []string{"super_admin"},
	})

	hash2, _ := auth.HashPassword(adminPassword)
	adminUserID, _ = st.CreateUserAccount(ctx, store.CreateUserParams{
		Username: "admin", Email: "admin@test", PasswordHash: hash2,
		Status: domain.UserStatusActive, MustChangePassword: false,
		EmployeeNo: "E2", FirstName: "Ad", LastName: "Min",
		RoleCodes: []string{"admin"},
	})

	superToken = makeSession(ctx, st, superUserID)
	adminToken = makeSession(ctx, st, adminUserID)
}

func makeSession(ctx context.Context, st *store.Store, userID string) string {
	raw, hash, _ := auth.GenerateToken()
	_, _ = st.CreateSession(ctx, userID, hash, "127.0.0.1", "test", "", time.Now().Add(time.Hour))
	return raw
}

func doJSON(t *testing.T, method, path, token string, body any) *httptest.ResponseRecorder {
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
	testHandler.ServeHTTP(rr, req)
	return rr
}

func loginToken(t *testing.T, username, password, totpCode string) string {
	t.Helper()
	rr := doJSON(t, http.MethodPost, "/api/v1/auth/login", "", map[string]string{
		"username": username, "password": password, "totpCode": totpCode,
	})
	if rr.Code != http.StatusOK {
		t.Fatalf("login status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var resp loginResponse
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	return resp.Token
}

func TestLoginSuccess(t *testing.T) {
	tok := loginToken(t, "admin", adminPassword, "")
	if tok == "" {
		t.Fatal("empty token")
	}
	rr := doJSON(t, http.MethodGet, "/api/v1/auth/me", tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("me status = %d", rr.Code)
	}
	var me meResponse
	_ = json.Unmarshal(rr.Body.Bytes(), &me)
	if me.Username != "admin" {
		t.Fatalf("username = %q", me.Username)
	}
}

func TestLoginFailure(t *testing.T) {
	rr := doJSON(t, http.MethodPost, "/api/v1/auth/login", "", map[string]string{
		"username": "admin", "password": "wrong-password",
	})
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", rr.Code)
	}
}

func TestUnauthorizedNoToken(t *testing.T) {
	rr := doJSON(t, http.MethodGet, "/api/v1/admin/users", "", nil)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rr.Code)
	}
}

func TestForbiddenInsufficientPermission(t *testing.T) {
	rr := doJSON(t, http.MethodPost, "/api/v1/admin/roles", adminToken, map[string]any{
		"code": "x", "name": "x",
	})
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rr.Code)
	}
}

func TestSuperAdminCreateUserAndAudit(t *testing.T) {
	rr := doJSON(t, http.MethodPost, "/api/v1/admin/users", superToken, map[string]any{
		"username": "doctor1", "email": "doctor1@test", "password": "DoctorPass123!",
		"employeeNo": "E10", "firstName": "Doc", "lastName": "Tor",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create user status = %d, body=%s", rr.Code, rr.Body.String())
	}

	rr = doJSON(t, http.MethodGet, "/api/v1/admin/users", superToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list users status = %d", rr.Code)
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte("doctor1")) {
		t.Fatal("list does not contain doctor1")
	}

	rr = doJSON(t, http.MethodGet, "/api/v1/admin/audit-logs", superToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("audit logs status = %d", rr.Code)
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte("user.create")) {
		t.Fatal("audit log does not contain user.create")
	}
}

func TestAssignRoles(t *testing.T) {
	rr := doJSON(t, http.MethodPost, "/api/v1/admin/users", superToken, map[string]any{
		"username": "nurse1", "email": "nurse1@test", "password": "NursePass123!",
		"employeeNo": "E11", "firstName": "Nur", "lastName": "Se",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create user status = %d", rr.Code)
	}
	var created map[string]string
	_ = json.Unmarshal(rr.Body.Bytes(), &created)
	id := created["id"]

	rr = doJSON(t, http.MethodPut, "/api/v1/admin/users/"+id+"/roles", superToken, map[string]any{
		"roleCodes": []string{"auditor"},
	})
	if rr.Code != http.StatusNoContent {
		t.Fatalf("assign roles status = %d, body=%s", rr.Code, rr.Body.String())
	}

	rr = doJSON(t, http.MethodGet, "/api/v1/admin/users/"+id, superToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("get user status = %d", rr.Code)
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte("auditor")) {
		t.Fatal("user does not have auditor role")
	}
}

func TestSuspendActivate(t *testing.T) {
	rr := doJSON(t, http.MethodPost, "/api/v1/admin/users", superToken, map[string]any{
		"username": "temp1", "email": "temp1@test", "password": "TempPass123!",
		"employeeNo": "E12", "firstName": "Tem", "lastName": "P",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create user status = %d", rr.Code)
	}
	var created map[string]string
	_ = json.Unmarshal(rr.Body.Bytes(), &created)
	id := created["id"]

	doJSON(t, http.MethodPost, "/api/v1/admin/users/"+id+"/suspend", superToken, nil)
	rr = doJSON(t, http.MethodPost, "/api/v1/auth/login", "", map[string]string{
		"username": "temp1", "password": "TempPass123!",
	})
	if rr.Code != http.StatusForbidden {
		t.Fatalf("suspended login status = %d, want 403", rr.Code)
	}

	doJSON(t, http.MethodPost, "/api/v1/admin/users/"+id+"/activate", superToken, nil)
	loginToken(t, "temp1", "TempPass123!", "")
}

func TestLogout(t *testing.T) {
	tok := loginToken(t, "admin", adminPassword, "")
	rr := doJSON(t, http.MethodPost, "/api/v1/auth/logout", tok, nil)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("logout status = %d", rr.Code)
	}
	rr = doJSON(t, http.MethodGet, "/api/v1/auth/me", tok, nil)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("me after logout status = %d, want 401", rr.Code)
	}
}

func TestMFARequiredAndEnroll(t *testing.T) {
	// A brand-new privileged account has no TOTP secret yet, so the first
	// sign-in succeeds without a code; demanding one there would lock the
	// account forever. MFA is enforced once a secret is enrolled.
	rr := doJSON(t, http.MethodPost, "/api/v1/auth/login", "", map[string]string{
		"username": "superadmin", "password": superPassword,
	})
	if rr.Code != http.StatusOK {
		t.Fatalf("first login without MFA status = %d, want 200 (enroll later)", rr.Code)
	}

	// Enroll MFA using a directly-created session.
	rr = doJSON(t, http.MethodPost, "/api/v1/auth/mfa/setup", superToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("mfa setup status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var setup map[string]string
	_ = json.Unmarshal(rr.Body.Bytes(), &setup)
	secret := setup["secret"]
	if secret == "" {
		t.Fatal("no secret returned")
	}
	code, _ := totp.GenerateCode(secret, time.Now())
	rr = doJSON(t, http.MethodPost, "/api/v1/auth/mfa/confirm", superToken, map[string]string{"code": code})
	if rr.Code != http.StatusNoContent {
		t.Fatalf("mfa confirm status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// Once a secret is enrolled, logging in without a code is rejected.
	rr = doJSON(t, http.MethodPost, "/api/v1/auth/login", "", map[string]string{
		"username": "superadmin", "password": superPassword,
	})
	if rr.Code != http.StatusUnauthorized || !bytes.Contains(rr.Body.Bytes(), []byte("mfa_required")) {
		t.Fatalf("login without code after enroll = %d %s, want 401 mfa_required", rr.Code, rr.Body.String())
	}

	code2, _ := totp.GenerateCode(secret, time.Now())
	loginToken(t, "superadmin", superPassword, code2)
}

func TestPasswordResetFlow(t *testing.T) {
	// Create a dedicated user, then reset their password via a store-issued token.
	hash, _ := auth.HashPassword("OldPass123!")
	uid, err := testStore.CreateUserAccount(context.Background(), store.CreateUserParams{
		Username: "resetme", Email: "resetme@test", PasswordHash: hash,
		Status: domain.UserStatusActive, MustChangePassword: false,
		EmployeeNo: "E13", FirstName: "R", LastName: "Me", RoleCodes: []string{"auditor"},
	})
	if err != nil {
		t.Fatal(err)
	}
	raw, h, _ := auth.GenerateToken()
	_ = testStore.CreatePasswordResetToken(context.Background(), uid, h, time.Now().Add(time.Minute))

	rr := doJSON(t, http.MethodPost, "/api/v1/auth/password-reset/confirm", "", map[string]string{
		"token": raw, "newPassword": "NewPass123!",
	})
	if rr.Code != http.StatusNoContent {
		t.Fatalf("reset confirm status = %d, body=%s", rr.Code, rr.Body.String())
	}

	loginToken(t, "resetme", "NewPass123!", "")
	rr = doJSON(t, http.MethodPost, "/api/v1/auth/login", "", map[string]string{
		"username": "resetme", "password": "OldPass123!",
	})
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("old password should fail, got %d", rr.Code)
	}
}

func TestAuditAppendOnly(t *testing.T) {
	if err := testStore.InsertAuditLog(context.Background(), store.AuditParams{
		Action: "test.event", ResourceType: "test", Details: map[string]any{},
	}); err != nil {
		t.Fatal(err)
	}
	conn, err := pgx.Connect(context.Background(), testDBURL)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(context.Background())
	if _, err := conn.Exec(context.Background(), `UPDATE audit_logs SET action = 'hacked' WHERE action = 'test.event'`); err == nil {
		t.Fatal("expected UPDATE on audit_logs to be blocked")
	}
}
