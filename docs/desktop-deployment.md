# Desktop deployment — 3-PC hospital (no dedicated server)

This document pins down how the app runs in the target environment and what is
left to build to turn the source code into a downloadable Windows application.

## Target environment (confirmed)

- **3 Windows PCs** in one hospital, on the **same WiFi/LAN**.
- **No dedicated server** and **no reliable internet** — but the 3 PCs can
  always reach each other over the LAN.
- Staff must be able to enter data on any PC and see it on the others in near
  real time, with **no internet required**.
- Data must be **backed up to cloud storage at intervals**, catching up
  whenever internet is available.

## Architecture

```
                    ┌─────────────────────────────┐
                    │  MAIN PC (also usable)      │
                    │  ├─ Go API  (bundled, LAN)  │
                    │  ├─ PostgreSQL (portable)   │
                    │  └─ encrypted backups dir   │──► Google Drive / S3-compatible
                    └──────────────┬──────────────┘
                                   │ LAN (WiFi, no internet needed)
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
        ┌───────────┐        ┌───────────┐        ┌───────────┐
        │  PC 2     │        │  PC 3     │        │  (main PC │
        │ desktop   │        │ desktop   │        │  desktop  │
        │  app      │        │  app      │        │  app)     │
        └───────────┘        └───────────┘        └───────────┘
```

- One PC runs the bundled backend (Go API + PostgreSQL) and also runs the
  desktop app pointed at itself. The other two run only the desktop app,
  pointed at the main PC's LAN address (`http://<main-pc-ip>:8080`).
- Because everything sits on one LAN, all three PCs read and write the same
  database with **no internet connection required**. "Offline" here means
  "no internet", not "PCs can't reach each other".
- The existing Phase 13 backup scheduler writes **encrypted** backups on a
  schedule; those upload to cloud storage whenever internet returns.

### Why not Bluetooth

Bluetooth is point-to-point, too slow, and unreliable for multi-client
database traffic. WiFi/LAN is the correct transport. Use the same router for
all three PCs.

## What already exists (no work needed)

- The full backend (Go API + Postgres): auth/RBAC, patients, clinical,
  pharmacy, lab, billing, staff/attendance, roster, notifications, reports,
  and backup/DR — ~200 endpoints.
- Cloud backup on a schedule (Phase 13): encrypted, tiered retention, restore
  verification, S3-compatible object storage.
- Tauri 2 desktop shell config (windows/installer targets, icons).
- Redis is **not used** by the core service (only a readiness check) — see
  `REDIS_ENABLED=false` in `.env.example`. The FastAPI analytics service is
  optional and can be skipped for a first release.

## What is missing (the real work)

1. **The desktop UI.** `apps/desktop/src/App.tsx` is a placeholder shell — no
   login, no screens, no API connection. This is the largest item: a front-end
   for the existing endpoints.
2. **Server packaging.** Bundle the Go binary + portable PostgreSQL and a
   launcher so the main PC runs with a double-click (no Docker, no dev tools,
   no terminal windows).
3. **LAN binding.** The server must listen on `0.0.0.0` (`HOST=0.0.0.0`) on
   the main PC so the other PCs can connect.
4. **Real-time refresh.** The API is request/response; add short polling or
   server-sent events so list screens update as other PCs make changes.
5. **Installer & release.** A Windows installer (NSIS/MSI) from `tauri build`,
   a GitHub Actions build job, optional code signing, and optional auto-update.

## Step-by-step plan

### Phase 1 — Desktop client foundation
- Add a configurable server address (runtime setting, default
  `http://127.0.0.1:8080`; set to the main PC's LAN IP on the other PCs).
- Add a typed API client (from the generated OpenAPI types) and session
  storage.
- Build a login screen wired to `/api/v1/auth/login` and `/auth/me`.
- Build an app shell/navigation and a first working screen (dashboard).

### Phase 2 — Main-PC server bundle
- Cross-compile the Go API for Windows and register it as a Tauri **sidecar**.
- Bundle portable PostgreSQL; launcher runs `initdb` on first run, applies
  migrations, seeds the super admin, then starts the API with `HOST=0.0.0.0`.
- Run the bundle as a tray/background app so no terminal windows are needed.

### Phase 3 — Real-time + backup wiring
- Add polling (or SSE) so each PC's changes appear on the others.
- Configure `BACKUP_*` for cloud: either the Google Drive folder trick below
  or Backblaze B2 / Cloudflare R2 (both S3-compatible, no new code).

### Phase 4 — Installer & release pipeline
- `tauri build` → Windows installer (NSIS/MSI) for the client, and an
  installer for the main-PC bundle.
- GitHub Actions Windows runner to build and upload artifacts.
- Optional: code-signing certificate, auto-updater.

### Phase 5 — Feature screens
- Build UI for each domain (patients, clinical, pharmacy, lab, billing, staff,
  roster, notifications, reports) on top of the Phase 1 client.

## Cloud backup options

**Option 1 — Google Drive (zero new code).** Backups are already
AES-256-GCM-encrypted before they touch disk, so point the backup directory at
the Google Drive synced folder on the main PC and let the Google Drive desktop
app upload the encrypted files:

```
BACKUP_ENABLED=true
BACKUP_ENCRYPTION_KEY=<32-byte hex>
BACKUP_LOCAL_DIR=C:\Users\<you>\Google Drive\hims-backups
```

Keep the `BACKUP_ENCRYPTION_KEY` **outside** the synced folder. Downside:
Google Drive's sync client is not designed as a backup target; for a
production hospital prefer a real object store. Step-by-step setup:
[`docs/backup-google-drive.md`](backup-google-drive.md).

**Option 2 — Backblaze B2 or Cloudflare R2.** Both are S3-compatible and work
with the existing backup code unchanged. Cheaper and more reliable than Drive
sync. Recommended for production.

## Decisions still open

- Cloud backup target: Google Drive folder (start) vs B2/R2 (production).
- Whether to include the FastAPI analytics service (skip for first release).
- Code-signing certificate and auto-updater (optional, later).

## Current status

- [x] Architecture confirmed (main PC = LAN server, 2 clients, cloud backup).
- [x] Redis made optional (`REDIS_ENABLED`).
- [x] LAN binding documented (`HOST=0.0.0.0`).
- [ ] Phase 1 — desktop client foundation.
- [ ] Phase 2 — main-PC server bundle.
- [ ] Phase 3 — real-time + backup wiring.
- [ ] Phase 4 — installer & release pipeline.
- [ ] Phase 5 — feature screens.
