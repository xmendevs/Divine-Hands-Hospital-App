# Backup & disaster recovery

Implementing the 3-2-1-oriented backup strategy from the Master Implementation
Plan belongs to the Backup/DR phase (Phase 13; Phase 12 is reporting, dashboards & exports). This directory will hold the
backup tooling, retention configuration, and restore-verification scripts.

Key constraints (from the plan):

- Primary PostgreSQL on the hospital server.
- Automated encrypted local backups to a separate disk/NAS.
- Automated encrypted off-site backups to object storage.
- Regular restore verification.
- Backup encryption keys stored separately from backup data.
- Configurable retention policies.
- Backup status visible to Super Admin.
- Never claim a backup succeeded until integrity verification completes.
