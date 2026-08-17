package domain

import (
	"time"
)

type BackupJobStatus string

const (
	BackupJobStatusPending BackupJobStatus = "pending"
	BackupJobStatusRunning BackupJobStatus = "running"
	BackupJobStatusSuccess BackupJobStatus = "success"
	BackupJobStatusFailed  BackupJobStatus = "failed"
)

const (
	BackupJobLocal        = "local"
	BackupJobCloud        = "cloud"
	BackupJobVerification = "verification"
)

const (
	ActionBackupRun      = "backup.run"
	ActionBackupVerify   = "backup.verify"
	ActionBackupTestNeon = "backup.test_neon"
)

type BackupJob struct {
	ID           string          `json:"id"`
	JobType      string          `json:"job_type"`
	Status       BackupJobStatus `json:"status"`
	StartedAt    time.Time       `json:"started_at"`
	FinishedAt   *time.Time      `json:"finished_at,omitempty"`
	Target       string          `json:"target,omitempty"`
	SizeBytes    int64           `json:"size_bytes,omitempty"`
	Checksum     string          `json:"checksum,omitempty"`
	ErrorMessage string          `json:"error_message,omitempty"`
	Details      []byte          `json:"details,omitempty"`
	CreatedAt    time.Time       `json:"created_at"`
}

type BackupStatus struct {
	Enabled          bool        `json:"enabled"`
	LocalHealthy     bool        `json:"local_healthy"`
	CloudHealthy     bool        `json:"cloud_healthy"`
	BackupAgeHours   float64     `json:"backup_age_hours,omitempty"`
	StorageBytes     int64       `json:"storage_bytes"`
	NextLocalAt      *string     `json:"next_local_at,omitempty"`
	NextCloudAt      *string     `json:"next_cloud_at,omitempty"`
	NextVerifyAt     *string     `json:"next_verify_at,omitempty"`
	FailedLast24h    int         `json:"failed_last_24h"`
	HealthStatus     string      `json:"health_status"`
	LastLocal        *BackupJob  `json:"last_local,omitempty"`
	LastCloud        *BackupJob  `json:"last_cloud,omitempty"`
	LastVerification *BackupJob  `json:"last_verification,omitempty"`
	RecentJobs       []BackupJob `json:"recent_jobs"`
}
