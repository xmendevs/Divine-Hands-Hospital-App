package backup

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestTierNamePromotion(t *testing.T) {
	sunday := time.Date(2026, 8, 9, 10, 0, 0, 0, time.UTC) // a Sunday
	if tier, name, _ := tierName(sunday); tier != "weekly" {
		t.Fatalf("Sunday should promote to weekly, got %s (%s)", tier, name)
	}
	first := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	if tier, _, _ := tierName(first); tier != "monthly" {
		t.Fatalf("1st of month should promote to monthly")
	}
	ordinary := time.Date(2026, 8, 12, 10, 0, 0, 0, time.UTC)
	if tier, _, _ := tierName(ordinary); tier != "daily" {
		t.Fatalf("ordinary day should stay daily")
	}
}

func TestPruneLocalRetention(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)
	files := map[string]time.Time{
		"backup_daily_2026-08-14.sql.gz.enc":   now.Add(-1 * time.Hour),
		"backup_daily_2026-08-13.sql.gz.enc":   now.Add(-25 * time.Hour),
		"backup_daily_2026-07-20.sql.gz.enc":   now.Add(-25 * 24 * time.Hour), // older than 7 days
		"backup_weekly_2026-08-09.sql.gz.enc":  now.Add(-5 * 24 * time.Hour),
		"backup_weekly_2026-06-28.sql.gz.enc":  now.Add(-47 * 24 * time.Hour), // older than 4 weeks
		"backup_monthly_2026-08-01.sql.gz.enc": now.Add(-13 * 24 * time.Hour),
		"backup_monthly_2026-02-01.sql.gz.enc": now.Add(-194 * 24 * time.Hour), // older than 3 months
		"config_app_2026-08-14.enc":            now.Add(-1 * time.Hour),        // never pruned
	}
	for name := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	removed, err := pruneLocal(dir, RetentionPolicy{Daily: 7, Weekly: 4, Monthly: 3}, now)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 3 {
		t.Fatalf("expected 3 expired backups pruned, got %d", removed)
	}
	for name := range files {
		_, statErr := os.Stat(filepath.Join(dir, name))
		if statErr != nil && (name == "backup_daily_2026-07-20.sql.gz.enc" ||
			name == "backup_weekly_2026-06-28.sql.gz.enc" ||
			name == "backup_monthly_2026-02-01.sql.gz.enc") {
			continue // expected to be pruned
		}
		if statErr != nil {
			t.Fatalf("%s should not have been pruned: %v", name, statErr)
		}
	}
}

func TestPruneCloudKeepsNewest(t *testing.T) {
	objs := []ObjectInfo{}
	for i := 0; i < 10; i++ {
		objs = append(objs, ObjectInfo{Key: fmt.Sprintf("backups/backup_daily_2026-08-%02d.sql.gz.enc", i+1)})
	}
	toDelete := pruneCloud(objs, 3)
	if len(toDelete) != 7 {
		t.Fatalf("expected 7 to delete, got %d", len(toDelete))
	}
	if toDelete[0].Key != "backups/backup_daily_2026-08-01.sql.gz.enc" {
		t.Fatalf("oldest should be deleted first, got %s", toDelete[0].Key)
	}
	if len(pruneCloud(objs, 20)) != 0 {
		t.Fatal("nothing should be deleted within retention")
	}
}

func TestSplitSQLHandlesStringsDollarQuotes(t *testing.T) {
	sql := `
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
-- (pg_dump comment lines contain semicolons)
CREATE TABLE notes (id int, body text);
\restrict some-psql-token
INSERT INTO notes VALUES (1, 'semi;colon inside string');
INSERT INTO notes VALUES (2, 'it''s escaped');
CREATE FUNCTION f() RETURNS int AS $$
BEGIN
  -- a comment inside a dollar-quoted body must survive
  RETURN 1;
END;
$$ LANGUAGE plpgsql;
CREATE FUNCTION g() RETURNS text AS $body$
  SELECT 'not; a terminator';
$body$ LANGUAGE sql;
`
	stmts := SplitSQL([]byte(sql))
	if len(stmts) != 5 {
		t.Fatalf("expected 5 statements, got %d: %v", len(stmts), stmts)
	}
	if !strings.Contains(stmts[1], "'semi;colon inside string'") {
		t.Fatalf("semicolon inside string split statement: %s", stmts[1])
	}
	if !strings.Contains(stmts[2], "'it''s escaped'") {
		t.Fatalf("escaped quote mangled: %s", stmts[2])
	}
	if !strings.Contains(stmts[3], "RETURN 1;") || !strings.Contains(stmts[3], "-- a comment") {
		t.Fatalf("dollar-quoted body split: %s", stmts[3])
	}
	if !strings.Contains(stmts[4], "not; a terminator") {
		t.Fatalf("tagged dollar-quoted body split: %s", stmts[4])
	}
}

func TestSplitSQLNoStatements(t *testing.T) {
	if got := SplitSQL([]byte("  \n\n  ")); len(got) != 0 {
		t.Fatalf("expected no statements, got %v", got)
	}
}

// fakeS3Server is an in-memory S3-compatible endpoint for tests.
type fakeS3Server struct {
	mu      sync.Mutex
	objects map[string][]byte
	server  *httptest.Server
}

func newFakeS3Server(t *testing.T) *fakeS3Server {
	t.Helper()
	f := &fakeS3Server{objects: map[string][]byte{}}
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		key := strings.TrimPrefix(r.URL.Path, "/bucket")
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
				if strings.HasPrefix(k, key) {
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

func (f *fakeS3Server) URL() string { return f.server.URL }

func (f *fakeS3Server) keys() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []string
	for k := range f.objects {
		out = append(out, k)
	}
	return out
}

func TestS3ClientPutGetDeleteListAgainstFake(t *testing.T) {
	f := newFakeS3Server(t)
	client := NewS3Client(S3Config{
		Endpoint:  f.URL(),
		Region:    "us-east-1",
		Bucket:    "bucket",
		AccessKey: "a",
		SecretKey: "s",
		PathStyle: true,
	}, nil)
	ctx := t.Context()

	if err := client.PutObject(ctx, "backups/a.sql.gz.enc", strings.NewReader("payload"), 7, "somehash"); err != nil {
		t.Fatal(err)
	}
	got, err := client.GetObjectBytes(ctx, "backups/a.sql.gz.enc")
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "payload" {
		t.Fatalf("roundtrip mismatch: %q", got)
	}
	objs, err := client.ListObjects(ctx, "backups/")
	if err != nil {
		t.Fatal(err)
	}
	if len(objs) != 1 || objs[0].Key != "backups/a.sql.gz.enc" {
		t.Fatalf("list mismatch: %+v", objs)
	}
	if err := client.DeleteObject(ctx, "backups/a.sql.gz.enc"); err != nil {
		t.Fatal(err)
	}
	if _, err := client.GetObjectBytes(ctx, "backups/a.sql.gz.enc"); err == nil {
		t.Fatal("expected error after delete")
	}
}

func TestSigningIncludesQueryParams(t *testing.T) {
	client := NewS3Client(S3Config{Region: "eu-west-1", AccessKey: "a", SecretKey: "s"}, nil)
	req, err := http.NewRequest("GET", "https://example.com/bucket?list-type=2&prefix=b&max-keys=10", nil)
	if err != nil {
		t.Fatal(err)
	}
	client.sign(req, emptySHA256)
	if !strings.HasPrefix(req.Header.Get("Authorization"), "AWS4-HMAC-SHA256 ") {
		t.Fatalf("authorization header malformed: %s", req.Header.Get("Authorization"))
	}

	// A different query must produce a different signature: the canonical
	// query is part of what is signed.
	req2, err := http.NewRequest("GET", "https://example.com/bucket?list-type=2&prefix=c&max-keys=10", nil)
	if err != nil {
		t.Fatal(err)
	}
	client.sign(req2, emptySHA256)
	if req.Header.Get("Authorization") == req2.Header.Get("Authorization") {
		t.Fatal("signature did not change with query parameters")
	}
}
