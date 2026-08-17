// Backup job ledger & dashboard summary (Phase 13).
package store

import (
	"context"
	"encoding/json"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

// InsertBackupJob records a new backup/verification job and returns its ID.
func (s *Store) InsertBackupJob(ctx context.Context, j domain.BackupJob) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO backup_jobs (job_type, status, started_at, target, size_bytes, checksum, error_message, details)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id`,
		j.JobType, j.Status, j.StartedAt, j.Target, j.SizeBytes, j.Checksum, j.ErrorMessage, json.RawMessage(j.Details)).
		Scan(&id)
	return id, err
}

// UpdateBackupJob finalizes a job after it completes.
func (s *Store) UpdateBackupJob(ctx context.Context, id string, j domain.BackupJob) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE backup_jobs
		SET status = $2, finished_at = $3, target = $4, size_bytes = $5,
		    checksum = $6, error_message = $7, details = $8
		WHERE id = $1`,
		id, j.Status, j.FinishedAt, j.Target, j.SizeBytes, j.Checksum, j.ErrorMessage, json.RawMessage(j.Details))
	return err
}

// ListBackupJobs returns the most recent jobs, newest first.
func (s *Store) ListBackupJobs(ctx context.Context, limit int) ([]domain.BackupJob, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, job_type, status, started_at, finished_at, target, size_bytes,
		       checksum, error_message, details
		FROM backup_jobs
		ORDER BY started_at DESC
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	jobs := make([]domain.BackupJob, 0)
	for rows.Next() {
		var j domain.BackupJob
		var details []byte
		if err := rows.Scan(&j.ID, &j.JobType, &j.Status, &j.StartedAt, &j.FinishedAt,
			&j.Target, &j.SizeBytes, &j.Checksum, &j.ErrorMessage, &details); err != nil {
			return nil, err
		}
		j.Details = details
		jobs = append(jobs, j)
	}
	return jobs, rows.Err()
}

// BackupStatusSummary returns the raw job-based summary for the dashboard.
func (s *Store) BackupStatusSummary(ctx context.Context) (domain.BackupStatus, error) {
	var st domain.BackupStatus

	last := func(jobType string, out **domain.BackupJob) error {
		rows, err := s.pool.Query(ctx, `
			SELECT id, job_type, status, started_at, finished_at, target, size_bytes,
			       checksum, error_message, details
			FROM backup_jobs
			WHERE job_type = $1 AND status <> 'running'
			ORDER BY started_at DESC LIMIT 1`, jobType)
		if err != nil {
			return err
		}
		defer rows.Close()
		if !rows.Next() {
			return nil
		}
		var j domain.BackupJob
		var details []byte
		if err := rows.Scan(&j.ID, &j.JobType, &j.Status, &j.StartedAt, &j.FinishedAt,
			&j.Target, &j.SizeBytes, &j.Checksum, &j.ErrorMessage, &details); err != nil {
			return err
		}
		j.Details = details
		*out = &j
		return nil
	}

	if err := last(domain.BackupJobLocal, &st.LastLocal); err != nil {
		return st, err
	}
	if err := last(domain.BackupJobCloud, &st.LastCloud); err != nil {
		return st, err
	}
	if err := last(domain.BackupJobVerification, &st.LastVerification); err != nil {
		return st, err
	}

	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM backup_jobs
		WHERE status = 'failed' AND started_at >= now() - INTERVAL '24 hours'`).
		Scan(&st.FailedLast24h); err != nil {
		return st, err
	}

	recent, err := s.ListBackupJobs(ctx, 10)
	if err != nil {
		return st, err
	}
	st.RecentJobs = recent
	return st, nil
}

// ListAdminUserIDs returns the IDs of all admin and super_admin users, used
// for backup-failure alerts.
func (s *Store) ListAdminUserIDs(ctx context.Context) ([]string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT DISTINCT ur.user_id
		FROM user_roles ur
		JOIN roles r ON r.id = ur.role_id
		WHERE r.code IN ('admin','super_admin')
		ORDER BY ur.user_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// Alerter satisfied by *Store: fan out an in-app notification to all admins.
func (s *Store) NotifyAdmins(ctx context.Context, title, body, link string) error {
	ids, err := s.ListAdminUserIDs(ctx)
	if err != nil {
		return err
	}
	if len(ids) == 0 {
		return nil
	}
	_, err = s.CreateNotifications(ctx, ids, "backup", title, body, link, "in_app")
	return err
}
