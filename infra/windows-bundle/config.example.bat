@echo off
REM =====================================================================
REM  Divine Hands Hospital - main PC configuration.
REM
REM  Copy this file to "config.bat", edit the values, then double-click
REM  Start.bat. Keep this file secret - it contains passwords and keys.
REM
REM  IMPORTANT: do NOT use these characters in any password:
REM      &  ^  !  %  "  <  >
REM =====================================================================

REM --- PostgreSQL (local only; the other PCs never connect to it directly) ---
set "PGUSER=hims"
set "PGPASSWORD=change-this-password"
set "PGPORT=5432"

REM --- Application (the Go API; this is what the other PCs connect to) ---
set "APP_HOST=0.0.0.0"
set "APP_PORT=8080"

REM --- First admin account (created automatically on the first run) ---
set "SEED_SUPERADMIN_USERNAME=superadmin"
set "SEED_SUPERADMIN_PASSWORD=ChooseAStrongPassword123!"
set "SEED_SUPERADMIN_EMAIL=admin@example.com"
set "SEED_SUPERADMIN_EMPLOYEE_NO=EMP-0001"

REM --- Sessions / MFA key. Generate with:  openssl rand -hex 32 ---
set "MFA_ENCRYPTION_KEY="

REM --- Cloud backup to Google Drive (see docs/backup-google-drive.md) ---
set "BACKUP_ENABLED=true"
REM Generate with: openssl rand -hex 32  (store this OUTSIDE Google Drive)
set "BACKUP_ENCRYPTION_KEY="
REM Point this at the Google Drive synced folder on this PC:
set "BACKUP_LOCAL_DIR=C:\Users\YourName\Google Drive\hims-backups"
set "BACKUP_RETENTION_DAILY=7"
set "BACKUP_RETENTION_WEEKLY=4"
set "BACKUP_RETENTION_MONTHLY=3"
set "BACKUP_LOCAL_INTERVAL=24h"
set "BACKUP_VERIFY_INTERVAL=24h"
