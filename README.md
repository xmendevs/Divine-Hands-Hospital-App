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

| Path     | Command                               | Output                                        |
| -------- | ------------------------------------- | --------------------------------------------- |
| Electron | `cd apps/desktop && pnpm dist`        | `apps/desktop/release/*.exe` (NSIS installer) |
| Tauri    | `cd apps/desktop && pnpm tauri build` | `src-tauri/target/release/bundle/nsis         | msi` |

### Downloading the installer

The latest **Electron installer** is attached to every GitHub **Release** (tag `v*`):

> **Releases → [latest release](https://github.com/xmendevs/divine-hands-hospital-app/releases/latest) → Assets → `Divine Hands Hospital Setup <version>.exe`**

The installer is also served by the Go API at `GET /api/v1/downloads/installer`
when the server runs with `APP_INSTALLER_PATH` set to the file on disk — so
hospitals can fetch the exact build from their own main PC instead of GitHub.

### Two installers: client and server edition

There are two ways to package the app:

| Edition    | Command                               | Installer                                                    | What it does                                                                                                                                                                                                                                                                        |
| ---------- | ------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Client** | `cd apps/desktop && pnpm dist`        | `Divine Hands Hospital Setup <version>.exe` (~90 MB)         | The desktop client. Connects to the server PC's address.                                                                                                                                                                                                                            |
| **Server** | `cd apps/desktop && pnpm dist:server` | `Divine Hands Hospital Server Setup <version>.exe` (~365 MB) | Client **plus** a bundled portable database and Go API. On first launch it creates the database, applies migrations, seeds the super admin, and starts the server - **no terminal, no admin needed**. The server keeps running when the app closes so the other PCs stay connected. |

The **Super Admin PC installs the Server edition**; every other PC installs the
Client edition and points it at the server PC's address.

On a server install, the generated super admin username/password are shown in
**Settings → Hospital server (this PC)** on first launch - change the password
after signing in.

### Hospital network (multiple PCs over WiFi, no internet)

The Super Admin PC runs the backend and every other PC connects to it over the
local WiFi/LAN:

- **Server on the Super Admin PC**: the Go API must listen on the LAN, not
  just localhost. Set `APP_HOST=0.0.0.0` (or `HOST=0.0.0.0`)
  when starting it — the `infra/windows-bundle` launcher already does this.
- **Every other PC**: install the app and set its server address (Connection
  settings / Settings → Server connection) to the Super Admin PC's network
  address, e.g. `http://192.168.1.10:8080`. All data lives on the Super Admin
  PC; the other PCs are thin clients.
- **App updates over the LAN**: with `APP_INSTALLER_PATH` set on the server,
  Settings → Hospital network & app updates offers a **Download app update**
  button that fetches the installer from the server — no internet required.

### Cloud backup from the Super Admin settings

The Super Admin can configure cloud backup without touching the server config:

- Settings → **Backup & cloud storage** lets you enter any S3-compatible
  object store (Amazon S3, Backblaze B2, Cloudflare R2, MinIO…), toggle
  automatic backups, run/upload/verify on demand, and see job history.
- Backups are **encrypted before leaving the PC**; the encryption key is set
  on the server as `BACKUP_ENCRYPTION_KEY` (see
  [docs/backup-google-drive.md](docs/backup-google-drive.md)) and is never
  shown in the app.

### First run (super admin)

Signing in uses the normal username/password flow. Set up the super admin on
the main PC once:

```bash
cd apps/go-api
go run ./cmd/migrate -command up
SEED_SUPERADMIN_USERNAME=superadmin \
  SEED_SUPERADMIN_PASSWORD='<a strong password>' \
  go run ./cmd/seed
```

Then sign in to the desktop app with those credentials. Additional staff
accounts are created from the admin user screen.

### Downloading the installer (access control)

The **Electron installer** is attached to every GitHub **Release** (tag `v*`):

> **Releases → [latest release](https://github.com/xmendevs/divine-hands-hospital-app/releases/latest) → Assets → `Divine Hands Hospital Setup <version>.exe`**

The installer is also served by the Go API at `GET /api/v1/downloads/installer`
when the server runs with `APP_INSTALLER_PATH` set to the file on disk. That
endpoint requires an authenticated session, so only signed-in users can fetch
it — keep `APP_INSTALLER_PATH` unset unless you want to host the installer on
the server itself.

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
