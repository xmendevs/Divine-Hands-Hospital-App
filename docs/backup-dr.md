# Backup & disaster recovery

Phase 13 adds automated encrypted backups, off-site object storage, tiered
retention and restore verification to the Go core service. The operational
details (configuration, encryption format, runbook) live in
`infra/backup/README.md`; this page documents the API, RBAC and audit
surface.

## Endpoints

| Endpoint                      | Permission       | Purpose                                                                                                                                     | Audit                                                                                      |
| ----------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /api/v1/backups/status`  | `backups.view`   | Super Admin backup dashboard: last local/cloud/verification runs, health, age, storage usage, failures in the last 24h, next scheduled runs | — (dashboard views are covered by `reports.viewed` when seen through `/reports/dashboard`) |
| `GET /api/v1/backups/jobs`    | `backups.view`   | Recent job history (50 newest)                                                                                                              | —                                                                                          |
| `POST /api/v1/backups/run`    | `backups.run`    | Trigger a local or cloud backup synchronously                                                                                               | `backup.run` with target                                                                   |
| `POST /api/v1/backups/verify` | `backups.verify` | Restore the newest backup into an isolated scratch database and validate schema, data, migration version and checksums                      | `backup.verify`                                                                            |

When the backup service is disabled (`BACKUP_ENABLED=false`), the four
endpoints return `503 backup_not_configured`; the dashboard's `backupStatus`
block still shows job history from the ledger but reports `enabled: false`.

## RBAC

Migration `0025_backup_rbac` adds three permissions on the `backup` module —
`backups.view`, `backups.run`, `backups.verify` — granted to the `admin` role.
`super_admin` holds every permission implicitly (see `docs/rbac-audit.md`).
Operational roles have no backup access: backups are an administrative
function.

## Failure alerts

Every failed job raises an in-app notification to **all** admin and super
admin users (category `backup`, title `Backup failure`), so a failing
schedule cannot go unnoticed. Alerts use the Phase 11 fan-out
(`store.CreateNotifications` via `store.NotifyAdmins`).

## Dashboard integration

`GET /api/v1/reports/dashboard` (and the admin branch of
`GET /api/v1/reports/my`) embeds a `backupStatus` block:

- `enabled` — service configured and running
- `lastLocal` / `lastCloud` / `lastVerification` — most recent job of each type
- `localHealthy` / `cloudHealthy` — last successful run finished within 36h
- `backupAgeHours` — age of the newest local/cloud success
- `storageBytes` — total local backup directory size
- `failedLast24h` — failed jobs in the last 24h
- `nextLocalAt` / `nextCloudAt` / `nextVerifyAt` — next scheduled runs

## Job ledger

Migration `0024_backup_dr` adds `backup_jobs` with the job type
(`local`/`cloud`/`verification`), status (`running`/`success`/`failed`),
timestamps, target, size, checksum, error message and JSONB details
(tier, manifest, verification result, pruned-object counts). Jobs are
append-only in practice (only the initiating process updates its own row),
so the ledger doubles as a backup audit trail.

## Failure scenarios tested

- Cloud endpoint unreachable → the job is marked `failed`, the local backup
  still lands on disk, and admins receive the notification.
- Encrypted payload tampered → GCM authentication fails during verification.
- Wrong encryption key → key fingerprint mismatch before any decryption.
- Checksum drift → verification aborts with a checksum mismatch.
- pg_dump unavailable → local backup fails loudly and alerts.
- No backup yet → `POST /api/v1/backups/verify` returns
  `verification_failed` with a clear message.

See `apps/go-api/internal/backup/*_test.go` and
`apps/go-api/internal/httpapi/backups_integration_test.go` (build tag
`integration`, requires `TEST_DATABASE_URL` and `pg_dump`).
