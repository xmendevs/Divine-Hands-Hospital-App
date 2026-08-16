# Cloud backup to Google Drive — setup runbook (main PC)

This is the operator's guide for backing up the hospital's data to Google
Drive from the main PC. No code changes are required: the backup system already
encrypts everything before it leaves the PC.

> **Newer option — configure cloud backup from the app:** the Super Admin can
> enter any S3-compatible storage (Amazon S3, Backblaze B2, Cloudflare R2,
> MinIO…) directly in **Settings → Backup & cloud storage**, then trigger
> uploads and verification from the same screen. This runbook's Google Drive
> method is the zero-config alternative (no internet on the API is needed for
> local backups — Drive syncs when it can).

## How it works

- The Go API runs a scheduler that, on startup and then every
  `BACKUP_LOCAL_INTERVAL` (default **24h**), dumps the PostgreSQL database,
  compresses it, and **AES-256-GCM encrypts** it before writing it to a local
  folder.
- It writes files like `backup_daily_YYYY-MM-DD.sql.gz.enc`,
  `backup_weekly_YYYY-MM-DD.sql.gz.enc`, `backup_monthly_YYYY-MM-DD.sql.gz.enc`,
  and a `manifest_*.json`, into `BACKUP_LOCAL_DIR`.
- Point `BACKUP_LOCAL_DIR` at a folder that **Google Drive for desktop**
  syncs. Drive then uploads the encrypted files whenever internet is
  available — catching up after outages.
- Because files are encrypted **before** they touch disk, Google Drive (and
  anyone who gains access to it) sees only ciphertext. The plain data is
  unrecoverable without the `BACKUP_ENCRYPTION_KEY`.

## One-time setup

1. **Install Google Drive for desktop** on the main PC and sign in.
2. Note its sync folder path (default `C:\Users\<your user>\Google Drive`).
   Create a subfolder inside it named `hims-backups`.
3. **Generate an encryption key** (Git Bash or PowerShell on the main PC):
   ```
   openssl rand -hex 32
   ```
   This prints 64 hex characters. **Write it down and store it somewhere
   outside Google Drive** — a password manager, a locked drawer, or a USB key
   kept off-site. This key is the only way to restore the backups.
4. Edit the Go API's `.env` file on the main PC and set:
   ```
   BACKUP_ENABLED=true
   BACKUP_ENCRYPTION_KEY=<the 64 hex characters from step 3>
   BACKUP_LOCAL_DIR=C:\Users\<your user>\Google Drive\hims-backups
   ```
5. Restart the Go API. It takes a local backup **immediately**, then every 24h.

## Verify it is working

- Wait a few minutes, then look in Google Drive (on the web, or on another
  computer) inside `hims-backups`. You should see `.sql.gz.enc` files and a
  `manifest_*.json`.
- In the app (Super Admin → Backups): the status screen shows the last local
  backup, health flags, and the next scheduled run.

## Test that a restore actually works

A backup is only good if it can be restored. The system can prove this for you:

- `POST /api/v1/backups/verify` (Super Admin, in the Backups screen) restores
  the newest backup into a throwaway database, replays migrations, and checks
  the data. The scheduler also runs this automatically every
  `BACKUP_VERIFY_INTERVAL` (default 24h).

## Day-to-day notes

- **The encryption key is the crown jewel.** Losing it means losing the
  ability to restore, no matter how many `.enc` files you have. Never store it
  in the same Google Drive account as the backups.
- **Google Drive sync is a convenience, not a hardened backup target.** For a
  production hospital, prefer Backblaze B2 or Cloudflare R2 (both S3-compatible
  — set `BACKUP_S3_*` in the same `.env`, no code changes). You can run both:
  keep the local Drive folder *and* an object store.
- **`pg_dump` must be present** on the main PC. It ships with the PostgreSQL
  install. If backups fail with "pg_dump not found", install the PostgreSQL
  client tools.
- **Verification needs `CREATEDB`** on the API's database user (true for the
  standard `hims` user).
- **Changing the key:** old backups can only be decrypted with the key that
  made them. Keep old keys until their retention window has passed.

## Files kept

| Tier | File | Retention (env) |
|------|------|-----------------|
| Daily | `backup_daily_YYYY-MM-DD.sql.gz.enc` | `BACKUP_RETENTION_DAILY` (7) |
| Weekly (Sundays) | `backup_weekly_YYYY-MM-DD.sql.gz.enc` | `BACKUP_RETENTION_WEEKLY` (4) |
| Monthly (1st) | `backup_monthly_YYYY-MM-DD.sql.gz.enc` | `BACKUP_RETENTION_MONTHLY` (3) |

Old tiers are pruned automatically.
