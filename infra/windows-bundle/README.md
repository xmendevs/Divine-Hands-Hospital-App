# Windows main-PC bundle

This turns the backend into a **double-click** server for the main PC: portable
PostgreSQL + the Go API + migrations + seed, with no Docker, no developer
tools, and no terminal commands for the end user.

## What's inside (after building)

```
hims-server/
├── Start.bat              <- double-click this to run the server
├── Stop.bat               <- stop it cleanly
├── config.example.bat     <- copy to config.bat and edit (passwords/keys)
├── bin/
│   ├── go-api.exe         <- the Go API (LAN-facing)
│   ├── migrate.exe        <- database migrations
│   ├── seed.exe           <- creates the first admin account
│   └── pgsql/             <- portable PostgreSQL 16
├── migrations/            <- versioned SQL migrations
└── data/                  <- created on first run (the actual database)
```

## How it works

`Start.bat` on the main PC:

1. Initializes the PostgreSQL data directory (first run only).
2. Starts PostgreSQL bound to `127.0.0.1` (the other PCs never reach it directly).
3. Creates the `hims` database if needed.
4. Applies the SQL migrations.
5. Creates the first `superadmin` account (skipped if it already exists).
6. Starts `go-api.exe` on `0.0.0.0:8080` so the other PCs can connect over WiFi.

Postgres stays on the main PC; only the Go API is exposed to the LAN. Backups
run immediately on startup and every 24h (see `docs/backup-google-drive.md`).

## Building the bundle

On a Linux/macOS machine (or CI) with Go installed:

```bash
./infra/windows-bundle/build-bundle.sh
```

This cross-compiles the three Go binaries for Windows, downloads the portable
PostgreSQL zip, and assembles `dist/windows-bundle`. Override the Postgres
version/URL if needed:

```bash
PG_VERSION=16.15-1 ./infra/windows-bundle/build-bundle.sh
```

Then zip `dist/windows-bundle` and copy it to the main PC.

## Installing on the main PC

1. Unzip the bundle anywhere permanent, e.g. `C:\hims-server`.
2. Copy `config.example.bat` to `config.bat` and edit it:
   - Set `PGPASSWORD` and `SEED_SUPERADMIN_PASSWORD` to strong passwords.
   - Generate `MFA_ENCRYPTION_KEY` and `BACKUP_ENCRYPTION_KEY` with
     `openssl rand -hex 32` (see `docs/backup-google-drive.md`).
   - Point `BACKUP_LOCAL_DIR` at the Google Drive synced folder.
   - **Avoid** `& ^ ! % " < >` in any password.
3. Double-click `Start.bat`. Keep the window open while the hospital uses the app.
4. On the other two PCs, open the desktop app, click **Connection settings** on
   the login screen, and set the address to `http://<main-PC-IP>:8080`.

## Stopping

- Close the `Start.bat` window (Ctrl+C), or run `Stop.bat` to stop the app and
  database cleanly.
- If the window was closed abruptly (the X button), PostgreSQL may keep running
  in the background — run `Stop.bat` to clean up, or just restart `Start.bat`
  (it tolerates an already-running database).

## Notes & caveats

- **Line endings:** the `.bat` files must be CRLF. `build-bundle.sh` converts
  them automatically. If you edit a `.bat` directly and Windows misbehaves
  (e.g. "goto" errors), re-save it with Windows (CRLF) line endings.
- **Windows Firewall:** the first time `go-api.exe` runs, Windows may ask to
  allow it on private networks — allow it, otherwise the other PCs can't connect.
- **No terminal-free UI yet:** the console window must stay open. A tray/silent
  launcher is a later polish step (Phase 4).
- The bundle is the **server** only. The desktop client (`apps/desktop`) is a
  separate Tauri app that the other PCs install.
