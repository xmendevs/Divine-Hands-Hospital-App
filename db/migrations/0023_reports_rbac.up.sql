-- Reporting, dashboards & exports permissions (Phase 12).
INSERT INTO permissions (code, name, module) VALUES
    ('reports.view', 'View clinical reports and role-scoped dashboards', 'reports'),
    ('reports.admin', 'View super admin dashboards', 'reports'),
    ('reports.export', 'Export reports (CSV)', 'reports')
ON CONFLICT (code) DO NOTHING;

-- reports.view already exists from Phase 04 (clinical reports, module
-- 'clinical'); refresh its name so it also covers role-scoped dashboards.
UPDATE permissions
SET name = 'View clinical reports and role-scoped dashboards', module = 'reports'
WHERE code = 'reports.view' AND module = 'clinical';

-- Every operational role can see its own department reports.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'reports.view'
WHERE r.code IN ('nurse','matron','doctor','pharmacist','lab_technician','lab_supervisor','storekeeper','cashier','billing_officer','billing_supervisor','receptionist','admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Super admin dashboards and exports are restricted to admins (super_admin
-- holds every permission via the seed rule). Exports contain sensitive data
-- and are audited at the handler.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('reports.admin','reports.export')
WHERE r.code = 'admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;
