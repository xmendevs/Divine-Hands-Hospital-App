-- Lab module permissions and roles (Phase 07).
INSERT INTO permissions (code, name, module) VALUES
    ('lab.view', 'View lab catalogue, requests and results', 'lab'),
    ('lab.order', 'Order lab tests', 'lab'),
    ('lab.manage', 'Manage lab clients, catalogue and specimen custody', 'lab'),
    ('lab.analyze', 'Enter lab results', 'lab'),
    ('lab.verify', 'Verify results and acknowledge critical results', 'lab'),
    ('lab.release', 'Release verified results', 'lab')
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (code, name, description, mfa_required, is_system) VALUES
    ('lab_technician', 'Lab Technician', 'Specimen handling and result entry', FALSE, TRUE),
    ('lab_supervisor', 'Lab Supervisor', 'Result verification and release', FALSE, TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
    'lab.view','lab.order','lab.manage','lab.analyze'
) WHERE r.code = 'lab_technician'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
    'lab.view','lab.analyze','lab.verify','lab.release'
) WHERE r.code = 'lab_supervisor'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Doctors order lab tests; nurses may view results.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('lab.view','lab.order')
WHERE r.code = 'doctor'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'lab.view'
WHERE r.code = 'nurse'
ON CONFLICT (role_id, permission_id) DO NOTHING;
