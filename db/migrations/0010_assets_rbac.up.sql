-- General inventory / asset-management permissions and the storekeeper role.
INSERT INTO permissions (code, name, module) VALUES
    ('assets.view', 'View assets and general inventory', 'assets'),
    ('assets.manage', 'Register and manage assets', 'assets'),
    ('assets.transfer', 'Transfer and assign assets', 'assets'),
    ('assets.adjust', 'Adjust asset quantities and status', 'assets'),
    ('assets.count', 'Asset stock counts', 'assets'),
    ('assets.maintain', 'Schedule and record maintenance', 'assets')
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (code, name, description, mfa_required, is_system) VALUES
    ('storekeeper', 'Storekeeper', 'General inventory, equipment and maintenance', FALSE, TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
    'assets.view','assets.manage','assets.transfer','assets.adjust',
    'assets.count','assets.maintain'
) WHERE r.code = 'storekeeper'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- admin gains read access to the asset register.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'assets.view'
WHERE r.code = 'admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;
