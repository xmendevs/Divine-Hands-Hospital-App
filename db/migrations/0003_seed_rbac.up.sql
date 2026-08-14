-- Seed default permissions and roles. Idempotent via ON CONFLICT DO NOTHING.
INSERT INTO permissions (code, name, module) VALUES
    ('users.view', 'View users', 'users'),
    ('users.create', 'Create users', 'users'),
    ('users.edit', 'Edit users', 'users'),
    ('users.suspend', 'Suspend users', 'users'),
    ('users.reset_password', 'Reset user passwords', 'users'),
    ('staff.view', 'View staff', 'staff'),
    ('staff.create', 'Create staff', 'staff'),
    ('staff.edit', 'Edit staff', 'staff'),
    ('roles.view', 'View roles', 'roles'),
    ('roles.create', 'Create roles', 'roles'),
    ('roles.edit', 'Edit roles', 'roles'),
    ('roles.assign', 'Assign roles', 'roles'),
    ('departments.view', 'View departments', 'departments'),
    ('departments.create', 'Create departments', 'departments'),
    ('departments.edit', 'Edit departments', 'departments'),
    ('audit.view', 'View audit logs', 'audit'),
    ('settings.view', 'View system settings', 'settings'),
    ('settings.edit', 'Edit system settings', 'settings')
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (code, name, description, mfa_required, is_system) VALUES
    ('super_admin', 'Super Admin', 'Full system access', TRUE, TRUE),
    ('admin', 'Administrator', 'Operational administration', FALSE, TRUE),
    ('auditor', 'Auditor', 'Read-only audit access', FALSE, TRUE)
ON CONFLICT (code) DO NOTHING;

-- super_admin holds every permission.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'super_admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- admin holds an operational subset.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
    'users.view','users.create','users.edit','users.suspend','users.reset_password',
    'staff.view','staff.create','staff.edit',
    'departments.view','departments.create','departments.edit',
    'roles.view','audit.view','settings.view'
) WHERE r.code = 'admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- auditor is read-only over audit logs.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'audit.view'
WHERE r.code = 'auditor'
ON CONFLICT (role_id, permission_id) DO NOTHING;
