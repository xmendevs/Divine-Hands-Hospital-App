-- Backup & disaster recovery permissions (Phase 13). Operational roles do not
-- touch backups: only admin (and super_admin via the seed rule) may view
-- backup status, trigger backups, or run restore verification.
INSERT INTO permissions (code, name, module) VALUES
    ('backups.view', 'View backup status and job history', 'backup'),
    ('backups.run', 'Run local and cloud backups', 'backup'),
    ('backups.verify', 'Run restore verification', 'backup')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
    ON p.code IN ('backups.view','backups.run','backups.verify')
WHERE r.code = 'admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;
