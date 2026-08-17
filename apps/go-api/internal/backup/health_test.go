package backup

import (
	"context"
	"testing"
	"time"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

// fakeLedger satisfies the Ledger interface for DecorateStatus tests.
type fakeLedger struct{}

func (fakeLedger) InsertBackupJob(context.Context, domain.BackupJob) (string, error) { return "", nil }
func (fakeLedger) UpdateBackupJob(context.Context, string, domain.BackupJob) error   { return nil }
func (fakeLedger) ListBackupJobs(context.Context, int) ([]domain.BackupJob, error)   { return nil, nil }
func (fakeLedger) BackupStatusSummary(context.Context) (domain.BackupStatus, error) {
	return domain.BackupStatus{}, nil
}

func job(t *testing.T, status domain.BackupJobStatus, age time.Duration) *domain.BackupJob {
	t.Helper()
	now := time.Now().UTC()
	fin := now.Add(-age)
	return &domain.BackupJob{
		JobType:    domain.BackupJobLocal,
		Status:     status,
		StartedAt:  fin,
		FinishedAt: &fin,
	}
}

func decorate(cfg Config, now time.Time, st *domain.BackupStatus) {
	m := NewManager(cfg, fakeLedger{}, nil, func() time.Time { return now })
	m.DecorateStatus(st)
}

func TestDecorateStatusHealth(t *testing.T) {
	now := time.Now().UTC()
	base := Config{Enabled: true, LocalDir: t.TempDir()}

	t.Run("disabled", func(t *testing.T) {
		st := &domain.BackupStatus{}
		decorate(Config{Enabled: false}, now, st)
		if st.HealthStatus != "disabled" {
			t.Fatalf("health = %q, want disabled", st.HealthStatus)
		}
	})

	t.Run("no backups yet", func(t *testing.T) {
		st := &domain.BackupStatus{}
		decorate(base, now, st)
		if st.HealthStatus != "local_backup_unhealthy" {
			t.Fatalf("health = %q, want local_backup_unhealthy", st.HealthStatus)
		}
	})

	t.Run("fresh local only is healthy", func(t *testing.T) {
		st := &domain.BackupStatus{LastLocal: job(t, domain.BackupJobStatusSuccess, time.Hour)}
		decorate(base, now, st)
		if st.HealthStatus != "healthy" {
			t.Fatalf("health = %q, want healthy", st.HealthStatus)
		}
	})

	t.Run("stale local is unhealthy", func(t *testing.T) {
		st := &domain.BackupStatus{LastLocal: job(t, domain.BackupJobStatusSuccess, 48*time.Hour)}
		decorate(base, now, st)
		if st.HealthStatus != "local_backup_unhealthy" {
			t.Fatalf("health = %q, want local_backup_unhealthy", st.HealthStatus)
		}
	})

	t.Run("failed local is unhealthy", func(t *testing.T) {
		st := &domain.BackupStatus{LastLocal: job(t, domain.BackupJobStatusFailed, time.Hour)}
		decorate(base, now, st)
		if st.HealthStatus != "local_backup_unhealthy" {
			t.Fatalf("health = %q, want local_backup_unhealthy", st.HealthStatus)
		}
	})

	t.Run("configured cloud with no cloud job is degraded", func(t *testing.T) {
		cfg := base
		cfg.S3 = &S3Config{Endpoint: "http://localhost", Bucket: "b", AccessKey: "a", SecretKey: "s"}
		st := &domain.BackupStatus{LastLocal: job(t, domain.BackupJobStatusSuccess, time.Hour)}
		decorate(cfg, now, st)
		if st.HealthStatus != "cloud_backup_unhealthy" {
			t.Fatalf("health = %q, want cloud_backup_unhealthy", st.HealthStatus)
		}
	})

	t.Run("fresh local and cloud is healthy", func(t *testing.T) {
		cfg := base
		cfg.S3 = &S3Config{Endpoint: "http://localhost", Bucket: "b", AccessKey: "a", SecretKey: "s"}
		st := &domain.BackupStatus{
			LastLocal: job(t, domain.BackupJobStatusSuccess, time.Hour),
			LastCloud: job(t, domain.BackupJobStatusSuccess, time.Hour),
		}
		decorate(cfg, now, st)
		if st.HealthStatus != "healthy" {
			t.Fatalf("health = %q, want healthy", st.HealthStatus)
		}
	})

	t.Run("recent failures downgrade health", func(t *testing.T) {
		st := &domain.BackupStatus{
			LastLocal:     job(t, domain.BackupJobStatusSuccess, time.Hour),
			FailedLast24h: 1,
		}
		decorate(base, now, st)
		if st.HealthStatus != "recent_failures" {
			t.Fatalf("health = %q, want recent_failures", st.HealthStatus)
		}
	})

	t.Run("neon destination counts as cloud", func(t *testing.T) {
		cfg := base
		cfg.Neon = &NeonConfig{ConnectionString: "postgres://u:p@h/db"}
		st := &domain.BackupStatus{LastLocal: job(t, domain.BackupJobStatusSuccess, time.Hour)}
		decorate(cfg, now, st)
		if st.HealthStatus != "cloud_backup_unhealthy" {
			t.Fatalf("health = %q, want cloud_backup_unhealthy", st.HealthStatus)
		}
	})
}
