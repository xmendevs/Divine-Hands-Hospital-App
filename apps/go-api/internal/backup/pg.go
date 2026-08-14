package backup

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/golang-migrate/migrate/v4"
	migratepgx "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5"
	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" database/sql driver
)

// DumpResult describes a produced SQL dump.
type DumpResult struct {
	Path      string
	SizeBytes int64
	SHA256    string
	PGVersion string
}

// Dump runs pg_dump (plain SQL, --inserts, no owner/privileges) and stores a
// gzip-compressed copy at dest. It returns the sha256 of the plain SQL
// payload (computed before compression) so verification can compare against
// the manifest after decompression.
func Dump(ctx context.Context, pgDumpPath, databaseURL, dest string) (*DumpResult, error) {
	cfg, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}

	args := []string{
		"-Fp",
		"--inserts",
		"--no-owner",
		"--no-privileges",
		"--dbname=" + databaseURL,
	}
	cmd := exec.CommandContext(ctx, pgDumpPath, args...)
	cmd.Env = append(os.Environ(), "PGPASSWORD="+cfg.Password)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start pg_dump: %w", err)
	}

	out, err := os.OpenFile(dest, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		cmd.Process.Kill()
		return nil, err
	}
	defer out.Close()

	gz := gzip.NewWriter(out)
	hash := sha256.New()
	if _, err := copyAll(io.MultiWriter(hash, gz), stdout); err != nil {
		cmd.Process.Kill()
		gz.Close()
		return nil, fmt.Errorf("pg_dump failed: %w", err)
	}
	if err := gz.Close(); err != nil {
		return nil, err
	}
	if err := out.Close(); err != nil {
		return nil, err
	}
	if err := cmd.Wait(); err != nil {
		return nil, fmt.Errorf("pg_dump exited: %v: %s", err, strings.TrimSpace(stderr.String()))
	}

	info, err := os.Stat(dest)
	if err != nil {
		return nil, err
	}
	return &DumpResult{
		Path:      dest,
		SizeBytes: info.Size(),
		SHA256:    hex.EncodeToString(hash.Sum(nil)),
		PGVersion: serverVersion(ctx, cfg),
	}, nil
}

// VerifyResult reports the outcome of a restore verification.
type VerifyResult struct {
	MigrationVersion int64            `json:"migrationVersion"`
	TableCount       int              `json:"tableCount"`
	SampleTables     []string         `json:"sampleTables"`
	SampleRows       map[string]int64 `json:"sampleRows"`
	ChecksumOK       bool             `json:"checksumOK"`
	DurationMS       int64            `json:"durationMs"`
}

// VerifyRestore opens an isolated scratch database, restores the dump into
// it, replays migrations, checks tables and row counts, then drops the
// scratch database. It returns an error if any check fails.
func VerifyRestore(ctx context.Context, databaseURL, sqlPath, migrationsDir string, expectChecksum string) (*VerifyResult, error) {
	start := time.Now()
	cfg, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}

	sqlData, err := gunzipFile(sqlPath)
	if err != nil {
		return nil, fmt.Errorf("decompress backup: %w", err)
	}
	if expectChecksum != "" {
		sum := sha256.Sum256(sqlData)
		if hex.EncodeToString(sum[:]) != expectChecksum {
			return nil, fmt.Errorf("backup checksum mismatch: manifest %s, actual %x", expectChecksum, sum[:8])
		}
	}

	tmpName := "hims_verify_" + randomSuffix()
	maintainCfg := *cfg
	maintainCfg.Database = "postgres"
	maintainCfg.RuntimeParams = map[string]string{"search_path": "public"}

	mainConn, err := pgx.Connect(ctx, connString(maintainCfg))
	if err != nil {
		return nil, fmt.Errorf("connect maintenance db: %w", err)
	}
	defer mainConn.Close(ctx)

	if _, err := mainConn.Exec(ctx, `CREATE DATABASE `+quoteIdent(tmpName)); err != nil {
		return nil, fmt.Errorf("create scratch database: %w", err)
	}
	dropDB := func() {
		_, _ = mainConn.Exec(ctx, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = `+quoteLit(tmpName))
		_, _ = mainConn.Exec(ctx, `DROP DATABASE IF EXISTS `+quoteIdent(tmpName))
	}
	defer dropDB()

	scratchCfg := *cfg
	scratchCfg.Database = tmpName
	scratchCfg.RuntimeParams = map[string]string{"search_path": "public"}
	conn, err := pgx.Connect(ctx, connString(scratchCfg))
	if err != nil {
		return nil, fmt.Errorf("connect scratch database: %w", err)
	}
	defer conn.Close(ctx)

	for _, stmt := range SplitSQL(sqlData) {
		if _, err := conn.Exec(ctx, stmt); err != nil {
			return nil, fmt.Errorf("replay backup: %w", err)
		}
	}

	mv, err := migrateScratch(ctx, connString(scratchCfg), migrationsDir)
	if err != nil {
		return nil, fmt.Errorf("migrations on restored database: %w", err)
	}

	res := &VerifyResult{MigrationVersion: mv}
	if err := checksForRestored(ctx, conn, res); err != nil {
		return nil, err
	}
	res.ChecksumOK = true
	res.DurationMS = time.Since(start).Milliseconds()
	return res, nil
}

func migrateScratch(ctx context.Context, scratchURL, migrationsDir string) (int64, error) {
	sqlDB, err := sql.Open("pgx", scratchURL)
	if err != nil {
		return 0, err
	}
	defer sqlDB.Close()

	cfg, err := pgx.ParseConfig(scratchURL)
	if err != nil {
		return 0, err
	}
	driver, err := migratepgx.WithInstance(sqlDB, &migratepgx.Config{
		DatabaseName: cfg.Database,
		SchemaName:   "public",
	})
	if err != nil {
		return 0, err
	}
	src, err := iofs.New(os.DirFS(migrationsDir), ".")
	if err != nil {
		return 0, err
	}
	m, err := migrate.NewWithInstance("iofs", src, "pgx", driver)
	if err != nil {
		return 0, err
	}
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return 0, err
	}
	v, _, err := m.Version()
	if err != nil {
		return 0, err
	}
	return int64(v), nil
}

// checksForRestored validates that the restored schema matches expectations:
// the same table set and data row counts as the live application schema.
func checksForRestored(ctx context.Context, conn *pgx.Conn, res *VerifyResult) error {
	rows, err := conn.Query(ctx, `
		SELECT table_name FROM information_schema.tables
		WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
		ORDER BY table_name`)
	if err != nil {
		return err
	}
	var tables []string
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			rows.Close()
			return err
		}
		tables = append(tables, t)
	}
	rows.Close()
	if len(tables) < 10 {
		return fmt.Errorf("restored database has only %d tables; expected a full application schema", len(tables))
	}

	res.TableCount = len(tables)
	res.SampleTables = []string{"users", "patients", "payments", "medicines", "schema_migrations"}
	missing := 0
	for _, want := range res.SampleTables {
		found := false
		for _, t := range tables {
			if t == want {
				found = true
				break
			}
		}
		if !found {
			missing++
		}
	}
	if missing > 0 {
		return fmt.Errorf("restored database missing %d of the expected core tables", missing)
	}

	res.SampleRows = map[string]int64{}
	for _, t := range res.SampleTables {
		var n int64
		// The restored session has an empty search_path (the dump clears it),
		// so every reference is schema-qualified.
		if err := conn.QueryRow(ctx, `SELECT count(*) FROM public.`+quoteIdent(t)).Scan(&n); err != nil {
			return fmt.Errorf("row count on restored %s: %w", t, err)
		}
		res.SampleRows[t] = n
	}
	return nil
}

// SplitSQL splits a plain pg_dump output into individual statements,
// respecting single-quoted strings, dollar-quoted bodies and full-line
// comments (which pg_dump emits containing semicolons), so semicolons inside
// data never split statements. psql meta-command lines (\restrict,
// \unrestrict, ...) are psql-only directives and are dropped before parsing.
func SplitSQL(data []byte) []string {
	var filtered bytes.Buffer
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, `\`) {
			continue
		}
		filtered.WriteString(line)
		filtered.WriteByte('\n')
	}
	data = filtered.Bytes()
	var out []string
	var cur bytes.Buffer
	atLineStart := true
	i := 0
	for i < len(data) {
		c := data[i]
		switch {
		case c == '\'':
			cur.WriteByte(c)
			atLineStart = false
			i++
			for i < len(data) {
				cur.WriteByte(data[i])
				if data[i] == '\'' {
					if i+1 < len(data) && data[i+1] == '\'' {
						cur.WriteByte(data[i+1])
						i += 2
						continue
					}
					i++
					break
				}
				i++
			}
		case c == '$':
			if end, ok := dollarQuoteEnd(data, i); ok {
				open := string(data[i:end])
				cur.WriteString(open)
				if idx := bytes.Index(data[end:], []byte(open)); idx >= 0 {
					cur.Write(data[end : end+idx+len(open)])
					i = end + idx + len(open)
				} else {
					cur.Write(data[end:])
					i = len(data)
				}
			} else {
				cur.WriteByte(c)
				atLineStart = false
				i++
			}
		case c == '-' && atLineStart && i+1 < len(data) && data[i+1] == '-':
			for i < len(data) && data[i] != '\n' {
				i++
			}
		case c == '\n':
			cur.WriteByte(c)
			atLineStart = true
			i++
		case c == ';':
			cur.WriteByte(c)
			if s := strings.TrimSpace(cur.String()); s != "" {
				out = append(out, s)
			}
			cur.Reset()
			atLineStart = false
			i++
		default:
			cur.WriteByte(c)
			atLineStart = false
			i++
		}
	}
	if s := strings.TrimSpace(cur.String()); s != "" {
		out = append(out, s)
	}
	return out
}

func dollarQuoteEnd(data []byte, start int) (int, bool) {
	i := start + 1
	for i < len(data) && (isAlnum(data[i]) || data[i] == '_') {
		i++
	}
	if i < len(data) && data[i] == '$' {
		return i + 1, true
	}
	return 0, false
}

func isAlnum(b byte) bool {
	return b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9'
}

func gunzipFile(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return nil, fmt.Errorf("not a gzip stream: %w", err)
	}
	defer gz.Close()
	var buf bytes.Buffer
	if _, err := copyAll(&buf, gz); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func serverVersion(ctx context.Context, cfg *pgx.ConnConfig) string {
	conn, err := pgx.Connect(ctx, connString(*cfg))
	if err != nil {
		return ""
	}
	defer conn.Close(ctx)
	var v string
	_ = conn.QueryRow(ctx, "SHOW server_version").Scan(&v)
	return v
}

// migrationVersionOf returns the current schema migration version.
func migrationVersionOf(ctx context.Context, databaseURL string) int64 {
	cfg, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		return 0
	}
	conn, err := pgx.Connect(ctx, connString(*cfg))
	if err != nil {
		return 0
	}
	defer conn.Close(ctx)
	var v int64
	_ = conn.QueryRow(ctx, `
		SELECT version FROM schema_migrations WHERE dirty = false
		ORDER BY version DESC LIMIT 1`).Scan(&v)
	return v
}

func connString(cfg pgx.ConnConfig) string {
	q := urlValues(cfg)
	return fmt.Sprintf("postgres://%s:%s@%s:%d/%s?%s",
		url.QueryEscape(cfg.User), url.QueryEscape(cfg.Password), cfg.Host, cfg.Port, cfg.Database, q.Encode())
}

func urlValues(cfg pgx.ConnConfig) (out url.Values) {
	out = url.Values{}
	for k, v := range cfg.RuntimeParams {
		out.Set(k, v)
	}
	sslmode := "disable"
	if cfg.TLSConfig != nil {
		sslmode = "require"
	}
	out.Set("sslmode", sslmode)
	return out
}

func quoteIdent(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

func quoteLit(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

func randomSuffix() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func copyAll(dst io.Writer, src io.Reader) (int64, error) {
	return io.Copy(dst, src)
}
