-- Pharmacy permissions and role.
INSERT INTO permissions (code, name, module) VALUES
    ('medicines.view', 'View medicines and inventory', 'pharmacy'),
    ('medicines.manage', 'Manage medicine master', 'pharmacy'),
    ('inventory.receive', 'Receive stock', 'pharmacy'),
    ('inventory.dispense', 'Dispense prescriptions', 'pharmacy'),
    ('inventory.adjust', 'Adjust stock', 'pharmacy'),
    ('inventory.transfer', 'Transfer stock', 'pharmacy'),
    ('inventory.count', 'Stock counts', 'pharmacy'),
    ('inventory.approve', 'Approve stock adjustments', 'pharmacy')
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (code, name, description, mfa_required, is_system) VALUES
    ('pharmacist', 'Pharmacist', 'Pharmacy and medicine inventory', FALSE, TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
    'medicines.view','medicines.manage',
    'inventory.receive','inventory.dispense','inventory.adjust',
    'inventory.transfer','inventory.count','inventory.approve'
) WHERE r.code = 'pharmacist'
ON CONFLICT (role_id, permission_id) DO NOTHING;
