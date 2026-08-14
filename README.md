# Divine Hands Hospital — Hospital Management System

Production-grade Hospital Information Management System (HIMS) for desktop use.

## Stack

| Concern         | Technology                                          |
| --------------- | --------------------------------------------------- |
| Desktop client  | Tauri + React + TypeScript                          |
| Core services   | Go (high-throughput / core domain)                  |
| Python services | FastAPI (analytics, reporting, docs, ML)            |
| Database        | PostgreSQL                                          |
| Cache / queues  | Redis                                               |
| Object storage  | S3-compatible (MinIO for development)               |
| API contracts   | OpenAPI (versioned under `packages/api-contracts/`) |
| Migrations      | Versioned SQL under `db/migrations/`                |
| CI/CD           | GitHub Actions                                      |
| Containers      | Docker / Docker Compose                             |

## Layout

```
apps/desktop          Tauri + React + TypeScript desktop client
apps/go-api           Go core / high-throughput service
apps/fastapi          FastAPI analytics & reporting service
packages/api-contracts Versioned OpenAPI contracts (single source of truth)
packages/ui           Shared React components
db/migrations/        Versioned PostgreSQL migrations
db/seeds/             Development/test seed data
infra/docker/         Docker Compose development stack
infra/backup/         Backup & disaster recovery
scripts/              Developer scripts
docs/                 Project documentation
```

## Getting started

```bash
cp .env.example .env       # adjust values; generate MFA_ENCRYPTION_KEY
scripts/bootstrap.sh       # install deps + generate contract types
scripts/dev-up.sh          # start PostgreSQL, Redis, MinIO

# Database + super admin (one time)
cd apps/go-api
go run ./cmd/migrate -command up
SEED_SUPERADMIN_PASSWORD='<a strong password>' go run ./cmd/seed

# Desktop client
cd apps/desktop && pnpm tauri dev

# Go core service
cd apps/go-api && go run ./cmd/server

# FastAPI service
cd apps/fastapi && uv run uvicorn app.main:app --reload
```

Verify everything:

```bash
scripts/verify.sh
```

## Documentation

- [Developer setup](docs/developer-setup.md)
- [Architecture](docs/architecture.md)
- [API conventions](docs/api-conventions.md)
- [Logging & errors](docs/logging-and-errors.md)
- [Environment configuration](docs/environment.md)
- [Coding conventions](docs/coding-conventions.md)
- [Migrations & rollback](docs/migrations.md)
- [Identity, RBAC & audit](docs/rbac-audit.md)
- [Patients & families](docs/patients.md)

Go and FastAPI share versioned OpenAPI contracts so they never implement
conflicting business rules (see `docs/architecture.md`). Identity, RBAC, sessions,
audit (Phase 02) and the patient master record (Phase 03) are implemented in the
Go core service.
