package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/config"
)

func testConfig() config.Config {
	return config.Config{
		ServiceName: "go-api",
		Timezone:    "UTC",
	}
}

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func doRequest(t *testing.T, h http.Handler, method, path string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

func decodeJSON(t *testing.T, rr *httptest.ResponseRecorder, v any) {
	t.Helper()
	if err := json.Unmarshal(rr.Body.Bytes(), v); err != nil {
		t.Fatalf("decode response: %v (body=%s)", err, rr.Body.String())
	}
}

func TestHealth(t *testing.T) {
	h := NewRouter(testConfig(), testLogger())
	rr := doRequest(t, h, http.MethodGet, "/health", nil)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
	var body map[string]string
	decodeJSON(t, rr, &body)
	if body["status"] != "ok" {
		t.Fatalf("status field = %q, want ok", body["status"])
	}
	if body["service"] != "go-api" {
		t.Fatalf("service = %q", body["service"])
	}
}

func TestReadyAllPass(t *testing.T) {
	checks := map[string]Checker{"db": fakeCheck{name: "db", status: "ok"}}
	h := NewRouter(testConfig(), testLogger(), WithChecks(checks))
	rr := doRequest(t, h, http.MethodGet, "/ready", nil)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusOK, rr.Body.String())
	}
	var body struct {
		Status string                 `json:"status"`
		Checks map[string]CheckResult `json:"checks"`
	}
	decodeJSON(t, rr, &body)
	if body.Status != "ready" {
		t.Fatalf("status = %q", body.Status)
	}
	if body.Checks["db"].Status != "ok" {
		t.Fatalf("db check = %q", body.Checks["db"].Status)
	}
}

func TestReadyFail(t *testing.T) {
	checks := map[string]Checker{"db": fakeCheck{name: "db", status: "error", errMsg: "boom"}}
	h := NewRouter(testConfig(), testLogger(), WithChecks(checks))
	rr := doRequest(t, h, http.MethodGet, "/ready", nil)

	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusServiceUnavailable)
	}
	var body struct {
		Status string                 `json:"status"`
		Checks map[string]CheckResult `json:"checks"`
	}
	decodeJSON(t, rr, &body)
	if body.Status != "not_ready" {
		t.Fatalf("status = %q", body.Status)
	}
	if body.Checks["db"].Error != "boom" {
		t.Fatalf("db error = %q", body.Checks["db"].Error)
	}
}

func TestRequestIDEcho(t *testing.T) {
	h := NewRouter(testConfig(), testLogger())
	rr := doRequest(t, h, http.MethodGet, "/health", map[string]string{"X-Request-ID": "test-123"})

	if got := rr.Header().Get("X-Request-ID"); got != "test-123" {
		t.Fatalf("X-Request-ID = %q, want test-123", got)
	}
}

func TestRequestIDGenerated(t *testing.T) {
	h := NewRouter(testConfig(), testLogger())
	rr := doRequest(t, h, http.MethodGet, "/health", nil)

	id := rr.Header().Get("X-Request-ID")
	if len(id) != 32 {
		t.Fatalf("generated request id %q has length %d, want 32", id, len(id))
	}
}

func TestVersion(t *testing.T) {
	h := NewRouter(testConfig(), testLogger())
	rr := doRequest(t, h, http.MethodGet, "/api/v1/version", nil)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d", rr.Code)
	}
	var body map[string]string
	decodeJSON(t, rr, &body)
	if body["service"] != "go-api" {
		t.Fatalf("service = %q", body["service"])
	}
	if body["timezone"] != "UTC" {
		t.Fatalf("timezone = %q", body["timezone"])
	}
}

func TestWriteError(t *testing.T) {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = req.WithContext(context.WithValue(req.Context(), requestIDKey, "abc"))

	writeError(rr, req, http.StatusNotFound, "not_found", "resource not found")

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d", rr.Code)
	}
	var env ErrorEnvelope
	decodeJSON(t, rr, &env)
	if env.Error.Code != "not_found" {
		t.Fatalf("code = %q", env.Error.Code)
	}
	if env.Error.RequestID != "abc" {
		t.Fatalf("requestId = %q", env.Error.RequestID)
	}
}

func TestTCPCheckPass(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()

	c := tcpCheck{name: "db", addr: l.Addr().String()}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if res := c.Check(ctx); res.Status != "ok" {
		t.Fatalf("status = %q, want ok (error=%s)", res.Status, res.Error)
	}
}

func TestTCPCheckFail(t *testing.T) {
	c := tcpCheck{name: "db", addr: "127.0.0.1:1"}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if res := c.Check(ctx); res.Status != "error" {
		t.Fatalf("status = %q, want error", res.Status)
	}
}

type fakeCheck struct {
	name   string
	status string
	errMsg string
}

func (f fakeCheck) Name() string { return f.name }
func (f fakeCheck) Check(context.Context) CheckResult {
	return CheckResult{Status: f.status, Error: f.errMsg}
}
