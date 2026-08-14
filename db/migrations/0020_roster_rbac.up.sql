-- Roster planning permissions and role grants (Phase 10).
INSERT INTO permissions (code, name, module) VALUES
    ('roster.view', 'View roster plans and assignments', 'roster'),
    ('roster.plan', 'Create, generate, edit and submit rosters', 'roster'),
    ('roster.approve', 'Approve or reject submitted rosters', 'roster')
ON CONFLICT (code) DO NOTHING;

-- Matron and admin plan and review; super_admin approves (holds everything).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('roster.view','roster.plan')
WHERE r.code IN ('matron','admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;
