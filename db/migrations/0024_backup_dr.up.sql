-- Backup & disaster recovery: job ledger (Phase 13). Every local backup,
-- cloud upload and restore-verification attempt is recorded here so the Super
-- Admin dashboard can report age, storage usage, failed jobs and verification
-- status. Checksums are recorded per job and re-verified at restore time.
CREATE TABLE backup_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type TEXT NOT NULL CHECK (job_type IN ('local','cloud','verification')),
    status TEXT NOT NULL CHECK (status IN ('running','success','failed')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    target TEXT NOT NULL DEFAULT '',
    size_bytes BIGINT NOT NULL DEFAULT 0,
    checksum TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    details JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_backup_jobs_type ON backup_jobs (job_type, started_at DESC);
