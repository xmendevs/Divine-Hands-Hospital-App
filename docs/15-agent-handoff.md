# AI-Agent Handoff

This document provides a complete handoff guide for an AI agent (or another developer)
taking over this project. It summarizes the repository structure, build instructions,
deployment steps, and recovery procedures.

## Repository Structure

```
Divine-Hands-Hospital-App/
├── apps/desktop/           Tauri + React + TypeScript desktop client
├── apps/fastapi/           FastAPI analytics & reporting service
├── apps/go-api/            Go core / high-throughput service
├── packages/api-contracts/ Versioned OpenAPI contracts (single source of truth)
├── packages/ui             Shared React components
├── db/migrations/          Versioned PostgreSQL migrations
├── db/seeds/               Development/test seed data
├── infra/                  Infrastructure (Docker, backup)
│   ├── docker/             Docker Compose development stack
│   └── backup/             Backup & disaster recovery (Phase 13)
├── scripts/                Developer scripts (bootstrap, up/down, verify)
├── docs/                   Project documentation (15 phases)
└── .github/workflows/      CI/CD pipelines
```

## Building the Project

### Prerequisites

- Go >= 1.26
- Node.js >= 20 with pnpm 10
- Python >= 3.12 with uv
- Docker + Docker Compose (for dependent services)
- Git

### Build Steps

```bash
# 1. Clone the repository
git clone https://github.com/xmendevs/Divine-Hands-Hospital-App
cd Divine-Hands-Hospital-App

# 2. Bootstrap dependencies
cp .env.example .env      # adjust values for your machine
scripts/bootstrap.sh      # pnpm install + uv sync + contract codegen

# 3. Start dependent services
scripts/dev-up.sh         # PostgreSQL, Redis, MinIO

# 4. Run the Go API
cd apps/go-api
go run ./cmd/server &

# 5. Run the desktop client
cd apps/desktop
pnpm tauri dev              # or `pnpm dev` for browser-only

# 6. Run the FastAPI service
cd apps/fastapi
uv run uvicorn app.main:app --reload
```

### Verification

```bash
# Run all checks
scripts/verify.sh

# Or individually:
# Go tests
cd apps/go-api
go test ./...

# Integration tests (requires TEST_DATABASE_URL)
TEST_DATABASE_URL=postgres://hims:change-me@127.0.0.1:5432/hims_test?sslmode=disable
go test -tags integration ./...

# FastAPI tests
cd apps/fastapi
uv run pytest -q
```

## Deployment

### Production Deployment

```bash
# 1. Ensure .env.prod exists with production values
cp .env.example .env.prod
# Adjust: S3 credentials, encryption key, DATABASE_URL, etc.

# 2. Run database migrations
cd apps/go-api
go run ./cmd/migrate -command up

# 2. Start the service
go run ./cmd/server
# Or build a binary:
go build -o go-api ./cmd/server

# 3. Verify
curl http://localhost:8080/health
curl http://localhost:8080/ready
```

### Docker Deployment

```bash
docker compose -f infra/docker/docker-compose.yml up -d
# Or build and run individual containers:
docker build -t divine-hands-go ./apps/go-api/
docker run -d \
  -p 5432:5432 \
  -p 6379:6379 \
  -p 9000:9000 \
  -p 9001:9001 \
  --name divine-go \
  divine-hands-go
```

## Rollback Plan

### Migration Rollback

```bash
# Rollback a specific migration
cd apps/go-api
go run ./cmd/migrate -command down -dir db/migrations

# Or rollback all the way
go run ./cmd/migrate -command down -dir db/migrations
```

### Backup Restoration

```bash
# 1. Decrypt the newest payload using the backup key
# 2. Run verification to prove restorability
POST /api/v1/backups/verify

# 3. Literal restore (if needed)
# - Decompress the gzip payload
# - Run the SQL through psql (ignoring \\restrict/\unrestrict psql meta-commands)
# - Replace server configuration from encrypted config payloads
```

### Disaster Recovery

```bash
# Full recovery from 3-2-1 backup strategy
# 1. Restore from latest encrypted local backup (disk/NAS)
# 2. Restore from latest encrypted off-site backup (object storage)
# 3. Run verification via POST /api/v1/backups/verify
# 4. Apply configuration from encrypted config payloads
# 5. Run database migrations: go run ./cmd/migrate -command up
```

## Environment Variables

### Core Variables (all services)

| Variable        | Default     | Description                                |
| --------------- | ----------- | ------------------------------------------ |
| `APP_TIMEZONE`  | `UTC`       | Display timezone (storage enforced as UTC) |
| `LOG_LEVEL`     | `info`      | Debug / info / warn / error                |
| `POSTGRES_HOST` | `127.0.0.1` | PostgreSQL address                         |
| `POSTGRES_PORT` | `5432`      | PostgreSQL port                            |
| `REDIS_HOST`    | `127.0.0.1` | Redis address                              |
| `REDIS_PORT`    | `6379`      | Redis port                                 |

### Go Service Variables (`apps/go-api/.env`)

| Variable                        | Default                                                         | Description                                                            |
| ------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `DATABASE_URL`                  | `postgres://hims:change-me@127.0.0.1:5432/hims?sslmode=disable` | PostgreSQL connection                                                  |
| `SECRET_KEY`                    | _required_                                                      | Session signing key (32-byte hex)                                      |
| `MFA_ENCRYPTION_KEY`            | _required_                                                      | 32-byte hex for MFA token encryption                                   |
| `BACKUP_ENABLED`                | `false`                                                         | Master backup switch                                                   |
| `BACKUP_ENCRYPTION_KEY`         | _required_                                                      | 32-byte hex AES key (store separately!)                                |
| `BACKUP_LOCAL_DIR`              | `./backups`                                                     | Local backup directory                                                 |
| `BACKUP_S3_ENDPOINT`            | —                                                               | MinIO/AWS endpoint                                                     |
| `BACKUP_S3_REGION`              | `us-east-1`                                                     | Signing region                                                         |
| `BACKUP_S3_BUCKET`              | —                                                               | Bucket name                                                            |
| `BACKUP_S3_ACCESS_KEY`          | —                                                               | Object store user                                                      |
| `BACKUP_S3_SECRET_KEY`          | —                                                               | Object store secret                                                    |
| `BACKUP_S3_PATH_STYLE`          | `false`                                                         | `true` for MinIO (path-style URLs)                                     |
| `BACKUP_NEON_CONNECTION_STRING` | —                                                               | Neon Postgres destination (fallback; normally entered in app Settings) |
| `BACKUP_PG_DUMP_PATH`           | `pg_dump`                                                       | pg_dump binary path                                                    |
| `BACKUP_MIGRATIONS_DIR`         | `db/migrations`                                                 | Migrations dir for verification                                        |
| `BACKUP_CONFIG_FILES`           | —                                                               | Comma-separated config paths to back up                                |
| `BACKUP_RETENTION_DAILY`        | `7`                                                             | Days of daily backups to keep                                          |
| `BACKUP_RETENTION_WEEKLY`       | `4`                                                             | Weeks of weekly backups to keep                                        |
| `BACKUP_RETENTION_MONTHLY`      | `3`                                                             | Months of monthly backups to keep                                      |
| `BACKUP_LOCAL_INTERVAL`         | `24h`                                                           | How often to run local backup                                          |
| `BACKUP_CLOUD_INTERVAL`         | `24h`                                                           | How often to run cloud backup                                          |
| `BACKUP_VERIFY_INTERVAL`        | `24h`                                                           | How often to run verification                                          |

### FastAPI Variables (`apps/fastapi/.env`)

| Variable                                        | Default | Description |
| ----------------------------------------------- | ------- | ----------- |
| (Same as Go core, plus analytics-specific vars) |

### Desktop Client Variables (`apps/desktop/.env`)

| Variable                                                   | Default | Description |
| ---------------------------------------------------------- | ------- | ----------- |
| (Tauri-specific vars; see `apps/desktop/ty` for full list) |

## API Documentation

The single source of truth for API contracts is the OpenAPI specification:

```
packages/api-contracts/openapi/v1/go-api.openapi.yaml
```

This file is generated from the Go domain types and vice versa. To regenerate:

```bash
cd packages/api-contracts
pnpm generate  # runs openapi-typescript
```

### Key Endpoints (version 0.5.0)

| Method | Path                       | Permission                 |
| ------ | -------------------------- | -------------------------- |
| GET    | `/health`                  | public                     |
| GET    | `/ready`                   | public                     |
| GET    | `/api/v1/version`          | public                     |
| POST   | `/api/v1/auth/login`       | public                     |
| GET    | `/api/v1/auth/me`          | session                    |
| POST   | `/api/v1/admin/users/...*` | `users.*` / `roles.assign` |
| GET    | `/api/v1/admin/audit-logs` | `audit.view`               |
| GET    | `/api/v1/backups/status`   | `backups.view`             |
| POST   | `/api/v1/backups/run`      | `backups.run`              |
| POST   | `/api/v1/backups/verify`   | `backups.verify`           |

## Security Model

### Authentication

- Bearer token via `Authorization: Bearer <token>`
- Token generation via `auth.HashPassword` + `auth.GenerateToken`
- MFA required for super_admin accounts (enforced at login)
- Session rotation on password change

### Authorization (RBAC)

| Role                                    | Permissions                                                   |
| --------------------------------------- | ------------------------------------------------------------- |
| `super_admin`                           | All permissions (implicit)                                    |
| `admin`                                 | `users.*`, `roles.*`, `backups.*`, `audit.view`, `settings.*` |
| `operational` (`nurse`, `doctor`, etc.) | Role-specific clinical permissions (see `docs/rbac-audit.md`) |
| `auditor`                               | Read-only access to audit logs and selected reports           |

### Privilege Escalation Prevention

- No path traversal vulnerabilities in file endpoints
- All SQL queries use parameterized queries (pgx)
- Input validation on all API endpoints
- No arbitrary financial edits possible
- Approval workflows for high-risk actions

### Audit Model

- Every critical action is logged to `audit_logs` table
- Immutable: `action`, `resource_type`, `resource_id`, `details` (JSONB), `created_at`
- Queryable via `/api/v1/admin/audit-logs`
- Retention: kept indefinitely; purge policy via `communications.retention_days`
- Audit bypass is impossible through the API; all actions pass through the service layer

### Data Encryption

- **At rest**: AES-256-GCM (backup encryption); PostgreSQL pgcrypto for sensitive fields
- **In transit**: TLS 1.3 for all HTTP connections
- **Key management**: `BACKUP_ENCRYPTION_KEY` supplied via env; never committed
- **Patient IDs**: E-1201+ format (enterprise numbering); generated via `gen_random_uuid()` (built-in PostgreSQL, no pgcrypto extension needed)

## Patient ID Generation Rules

- Format: `E-` followed by a numeric enterprise number (e.g., `E-1201`, `E-1202`, ...)
- Generated at patient creation via the API: `POST /api/v1/patients` with `employeeNo`
- Must be unique within the system
- No two patients may share the same enterprise number
- The `E-` prefix is enforced by the API validator
- Internally, patient IDs are stored as UUIDs (via `gen_random_uuid()`) for database operations
- The `employeeNo` is a human-readable overlay; the canonical ID is the UUID

## Clinical Workflow Documentation

### Patient Onboarding

1. **Create patient** via `POST /api/v1/patients` (admin or receptionist)
2. **Assign clinical notes** via `POST /api/v1/patients/{id}/clinical`
3. **Order labs** via `POST /api/v1/lab/requests`
4. **Dispatch prescriptions** via `POST /api/v1/pharmacy/dispense`

### Clinical Note Workflow

1. Note created by clinician via `POST /api/v1/patients/{id}/clinical`
2. Note tagged with `clinical.edit` permission for updates
3. History preserved; no overwrites (audit log tracks changes)
4. Note visible to all roles with `clinical.view` permission

### Prescription Workflow

1. Prescription created via `POST /api/v1/pharmacy/dispense`
2. Dispensed at pharmacy via `POST /api/v1/pharmacy/dispense`
3. Status tracked: `pending` → `dispensed` → `returned` / `quarantined`
4. All dispenses audited with `inventory.dispense`

## Pharmacy Workflow

### Medicine Dispense

1. `POST /api/v1/pharmacy/dispense` with medicine, quantity, patient ID
2. Stock decremented; audit log entry created (`inventory.dispense`)
3. Quantity validated against `stock_on_hand`
4. If insufficient stock: error returned; pharmacist can `adjust` or `quarantine`

### Medicine Batch

1. `POST /api/v1/pharmacy/batches` to create a batch
2. Track `stock_on_hand`, `expiry_date`, `lot_number`
3. `POST /api/v1/pharmacy/batches/{id}/adjust` to update stock
4. `POST /api/v1/pharmacy/batches/{id}/quarantine` to mark unsellable

## Laboratory Workflow

### Lab Request

1. `POST /api/v1/lab/requests` to create a lab request
2. Associated with a patient and ordering clinician
3. Status flows: `created` → `in_progress` → `result_entered` → `verified`
4. Results published via `POST /api/v1/lab/request-items`

### Lab Result

1. Result entered via `POST /api/v1/lab/request-items`
2. Verification by second clinician via `verified_at` field
3. Results visible to patient via portal (if enabled)
4. Critical results trigger `lab.critical_notifications`

## Billing Workflow

### Invoice Creation

1. Services rendered → create `invoices` via API or admin UI
2. Invoice line items: consultations, procedures, medications, lab fees
3. Status: `draft` → `issued` → `paid` / `void` / `refunded`
4. Payment tracked via `payments` table

### Payment Tracking

1. `POST /api/v1/payments` to record a payment
2. Linked to invoice via `invoice_id`
3. Status flows: `pending` → `complete` / `failed` / `refunded`
4. Receipt generated and visible to patient

## Roster Algorithm

### Automatic Roster Planning

1. Clinicians submit availability via `POST /api/v1/roster/plans`
2. System generates shift proposals based on:
   - Clinician availability
   - Required vs. scheduled coverage
3. Proposals reviewed and approved/rejected by admin
4. Final roster published; staff notified

### Shift Rules

- Maximum consecutive shifts: 5
- Minimum rest between shifts: 12 hours
- Weekend coverage: at least 2 clinicians per shift
- Holiday coverage: pre-planned and approved in advance

## Troubleshooting Guide

### Common Issues

| Issue                    | Cause                                  | Fix                                                 |
| ------------------------ | -------------------------------------- | --------------------------------------------------- |
| Service won't start      | Missing `DATABASE_URL` or wrong format | Set `TEST_DATABASE_URL` or production URL           |
| 503 Service Unavailable  | Backup service not configured          | `BACKUP_ENABLED=true` or remove `WithBackupManager` |
| 401 Unauthorized         | Missing or expired token               | Re-authenticate; refresh MFA if enabled             |
| 403 Forbidden            | Insufficient permissions               | Check role assignments in DB                        |
| Integration tests skip   | `TEST_DATABASE_URL` not set            | Export the variable before running                  |
| pg_dump not found        | Local backup cannot run                | `apt-get install postgresql-client-16`              |
| MFA login fails          | Time sync issue                        | Ensure server/client clocks are NTP-synchronized    |
| OpenAPI validation fails | Contract drift between Go and FastAPI  | Run `pnpm generate` to regenerate                   |

### Debug Commands

```bash
# Check service health
curl http://localhost:8080/health
curl http://localhost:8080/ready

# Check database connectivity
PGPASSWORD=change-me psql -h 127.0.0.1 -U hims -d hims_test -c "\dt"

# Check Redis connectivity
redis-cli ping

# Check MinIO connectivity
mc alias set myminio http://localhost:9000 minio minio
mc ls myminio

# View logs
docker logs divine-go  # Go service
docker logs divine-fastapi  # FastAPI service
```

## Release Notes

### Phase 15 (Current)

- Comprehensive documentation across 15 phases
- AI-agent handoff guide
- Final acceptance criteria verified
- Repository cloneable, buildable, deployable, recoverable
- All acceptance criteria met

### Previous Phases Summary

- **Phase 14**: Security, Performance, Integration & Release — security test suite passes, critical vulnerabilities resolved, performance targets documented, release artifacts reproducible, upgrade/rollback procedures tested
- **Phase 13**: Local + cloud backup & disaster recovery — encrypted local/cloud backups, tiered retention, restore verification, failure alerts, RBAC, audit logging
- **Phase 12**: Reporting, dashboards & exports — dashboard, reports, exports (CSV/XLSX/PDF)
- **Phase 11**: Notifications & governed internal communications — audit logs, RBAC, comms channels
- **Phase 10**: Automatic roster planning & approval — shift proposals, approval workflow
- **Phase 09**: Staff, attendance, clock-in/out & handover — roster algorithm, time tracking
- **Phase 08**: Add server-side PDF receipt generation — PDF service endpoint
- **Phase 07**: Billing, cashier, payments & receipts — invoice, payment tracking
- **Phase 06**: Laboratory information system — lab requests, results, notifications
- **Phase 07**: Pharmacy & medicine inventory — dispensing, batches, adjustments
- **Phase 06**: General inventory, instruments & maintenance — asset tracking
- **Phase 05**: Pharmacy/inventory — medicine inventory, dispensing
- **Phase 04**: Clinical workflows & orders — clinical notes, orders
- **Phase 03**: Patient master record — patient creation, ID generation
- **Phase 02**: Identity, RBAC & audit — users, roles, permissions, sessions, MFA
- **Phase 01**: Core identity and foundation

## AI-Agent Handoff Checklist

- [x] Repository is cloneable from GitHub
- [x] Build instructions are documented (`scripts/bootstrap.sh`, `scripts/dev-up.sh`)
- [x] Deployment guide is documented (`docs/15-final-acceptance.md`)
- [x] Backup/restore guide is documented (`infra/backup/README.md`, `docs/backup-dr.md`)
- [x] Security model is documented (`docs/rbac-audit.md`, `docs/15-agent-handoff.md`)
- [x] Audit model is documented (`docs/rbac-audit.md`)
- [x] Environment variables are documented (`docs/environment.md`)
- [x] Installation guide is documented (`docs/developer-setup.md`)
- [x] Troubleshooting guide is documented (`docs/15-agent-handoff.md` → Troubleshooting section)
- [x] Release notes are documented (`docs/15-final-acceptance.md`)
- [x] AI-agent handoff is complete
- [x] All phases documented (01–15)
- [x] All tests pass (`go test ./...`, `go test -tags integration ./...`)
- [x] OpenAPI contract current (`openapi-typescript` generates cleanly)
- [x] Migrations versioned and reversible (up/down scripts)
- [x] Docker Compose stack operational
- [x] No critical vulnerabilities unresolved

## Handoff Complete

The repository is ready for an AI agent or new developer to take over. All 15 phases
are documented, the system is buildable and deployable, and all acceptance criteria
are met.
