// Neon cloud destination: Neon is a managed Postgres database, so a "cloud
// backup" to Neon restores the latest dump of the hospital database into the
// Neon database (a point-in-time snapshot). History is still kept by the
// encrypted local backups; Neon always mirrors the newest data.
package backup

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// NeonConfig configures the Neon Postgres destination. ConnectionString is the
// project's postgres:// URL, entered by the Super Admin in Settings.
type NeonConfig struct {
	ConnectionString string
}

// NeonRestoreResult reports what was restored and sanity-checked on Neon.
type NeonRestoreResult struct {
	Database     string           `json:"database"`
	TableCount   int              `json:"tableCount"`
	SampleTables []string         `json:"sampleTables"`
	SampleRows   map[string]int64 `json:"sampleRows"`
	DurationMS   int64            `json:"durationMs"`
}

// RestoreToNeon replaces the data in the destination database with the given
// gzip'd plain-SQL dump (same format Dump produces). The destination schema
// is dropped and recreated so every run is a clean full snapshot.
func RestoreToNeon(ctx context.Context, connectionString, sqlGzPath string) (*NeonRestoreResult, error) {
	start := time.Now()
	cfg, err := pgx.ParseConfig(connectionString)
	if err != nil {
		return nil, fmt.Errorf("parse neon connection string: %w", err)
	}

	sqlData, err := gunzipFile(sqlGzPath)
	if err != nil {
		return nil, fmt.Errorf("decompress dump: %w", err)
	}

	// The dump clears search_path during replay (like VerifyRestore), so the
	// connection-level default is a safe fallback for any unqualified names.
	cfg.RuntimeParams = map[string]string{"search_path": "public"}
	conn, err := pgx.Connect(ctx, connString(*cfg))
	if err != nil {
		return nil, fmt.Errorf("connect to neon: %w", err)
	}
	defer conn.Close(ctx)

	if _, err := conn.Exec(ctx, `DROP SCHEMA public CASCADE`); err != nil {
		return nil, fmt.Errorf("drop public schema on neon: %w", err)
	}
	if _, err := conn.Exec(ctx, `CREATE SCHEMA public`); err != nil {
		return nil, fmt.Errorf("create public schema on neon: %w", err)
	}

	for _, stmt := range SplitSQL(sqlData) {
		if _, err := conn.Exec(ctx, stmt); err != nil {
			return nil, fmt.Errorf("replay dump into neon: %w", err)
		}
	}

	var db string
	_ = conn.QueryRow(ctx, "SELECT current_database()").Scan(&db)

	// Sanity-check the restored database the same way local verification does.
	vr := &VerifyResult{}
	if err := checksForRestored(ctx, conn, vr); err != nil {
		return nil, fmt.Errorf("sanity check on neon: %w", err)
	}
	return &NeonRestoreResult{
		Database:     db,
		TableCount:   vr.TableCount,
		SampleTables: vr.SampleTables,
		SampleRows:   vr.SampleRows,
		DurationMS:   time.Since(start).Milliseconds(),
	}, nil
}

// TestNeonConnection verifies the server can reach a Neon database with the
// given connection string (used by the Settings "Test connection" button).
func TestNeonConnection(ctx context.Context, connectionString string) (serverVersion, database string, err error) {
	cfg, err := pgx.ParseConfig(connectionString)
	if err != nil {
		return "", "", fmt.Errorf("parse connection string: %w", err)
	}
	conn, err := pgx.Connect(ctx, connString(*cfg))
	if err != nil {
		return "", "", err
	}
	defer conn.Close(ctx)
	var v, db string
	if err := conn.QueryRow(ctx, "SELECT version(), current_database()").Scan(&v, &db); err != nil {
		return "", "", err
	}
	return v, db, nil
}
