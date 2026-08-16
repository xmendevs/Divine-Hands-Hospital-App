# Divine Hands Hospital — Hospital Management System

Production-grade Hospital Information Management System (HIMS) for desktop use.

## Stack

| Concern         | Technology                                          |
| --------------- | --------------------------------------------------- |
| Desktop client  | Electron + Tauri + React + TypeScript               |
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

# Desktop client (Tauri)
cd apps/desktop && pnpm tauri dev

# Desktop client (Electron, loads the production build)
cd apps/desktop && pnpm build && pnpm start

# Go core service
cd apps/go-api && go run ./cmd/server

# FastAPI service
cd apps/fastapi && uv run uvicorn app.main:app --reload
```

Verify everything:

```bash
scripts/verify.sh
```

## Windows desktop app (Electron)

The React UI ships as a Windows desktop app. Two packaging paths coexist:

| Path     | Command                 | Output                                          |
| -------- | ----------------------- | ----------------------------------------------- |
| Electron | `cd apps/desktop && pnpm dist` | `apps/desktop/release/*.exe` (NSIS installer) |
| Tauri    | `cd apps/desktop && pnpm tauri build` | `src-tauri/target/release/bundle/nsis|msi`    |

### Downloading the installer

The latest installer is attached to every GitHub **Release** (tag `v*`):

> **Releases → [latest release](https://github.com/xmendevs/divine-hands-hospital-app/releases/latest) → Assets → `Divine Hands Hospital Setup <version>.exe`**

The installer is also served by the Go API at `GET /api/v1/downloads/installer`
when the server runs with `APP_INSTALLER_PATH` set to the file on disk — so
hospitals can fetch the exact build from their own main PC instead of GitHub.

### License keys (access control)

The app is **license-gated**: it cannot be signed in to without a valid license
key, so only authorized installations can use the software.

- The installer itself is public; the **activation key gates the app**: the
  desktop client asks for a key before the sign-in form, and the server rejects
  logins (`401 license_required`) that do not carry a valid key.
- Seed keys on the main PC when setting up the database:

  ```bash
  SEED_LICENSE_KEYS='DH-ALPHA-1:Front desk,DH-ALPHA-2:Lab' \
    SEED_SUPERADMIN_PASSWORD='<a strong password>' \
    go run ./cmd/seed
  ```

  Each entry is `key` or `key:label`, comma-separated. Re-running the seed with
  extra keys adds them without touching existing data.
- While **no keys are configured**, licensing is disabled and any key is
  accepted — existing deployments keep working until the hospital seeds keys.
- The download endpoint requires an authenticated session, and the Go API only
  serves the installer when `APP_INSTALLER_PATH` is configured on the server.

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
- [Clinical workflows & orders](docs/clinical.md)
- [Pharmacy & medicine inventory](docs/pharmacy.md)
- [General inventory, instruments & maintenance](docs/assets.md)
- [Laboratory information system](docs/lab.md)
- [Billing, cashier, payments & receipts](docs/billing.md)
- [Staff, attendance, clock-in/out & handover](docs/staff-attendance.md)
- [Automatic roster planning & approval](docs/roster-planning.md)
- [Notifications & governed internal communications](docs/notifications-comms.md)
- [Reporting, dashboards & exports](docs/reports.md)

Go and FastAPI share versioned OpenAPI contracts so they never implement
conflicting business rules (see `docs/architecture.md`). Identity, RBAC, sessions,
audit (Phase 02), the patient master record (Phase 03), clinical workflows
(Phase 04), pharmacy/inventory (Phase 05), general inventory, equipment &
maintenance (Phase 06), the laboratory information system (Phase 07), billing,
cashier, payments & receipts (Phase 08), staff, attendance, clock-in/out &
handover (Phase 09), automatic roster planning & approval (Phase 10),
notifications & governed internal communications (Phase 11), and reporting,
dashboards & exports (Phase 12) are implemented in the Go core service.
