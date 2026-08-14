-- Clinical-workflow permissions and role grants.
INSERT INTO permissions (code, name, module) VALUES
    ('orders.view', 'View orders', 'orders'),
    ('orders.create', 'Create orders', 'orders'),
    ('orders.manage', 'Action orders', 'orders'),
    ('notes.view', 'View clinical notes', 'clinical'),
    ('notes.write', 'Write clinical notes', 'clinical'),
    ('vitals.view', 'View vitals and observations', 'clinical'),
    ('vitals.record', 'Record vitals and observations', 'clinical'),
    ('mar.view', 'View medication administration records', 'clinical'),
    ('mar.record', 'Record medication administration', 'clinical'),
    ('tasks.view', 'View department tasks', 'clinical'),
    ('tasks.create', 'Create department tasks', 'clinical'),
    ('tasks.complete', 'Complete department tasks', 'clinical'),
    ('admissions.view', 'View admissions', 'clinical'),
    ('admissions.manage', 'Admit and discharge patients', 'clinical'),
    ('reports.view', 'View clinical reports', 'clinical'),
    ('reports.write', 'Write clinical reports', 'clinical'),
    ('triage.manage', 'Register and triage emergency patients', 'clinical'),
    ('assignments.view', 'View patient assignments', 'clinical'),
    ('assignments.manage', 'Assign patients to staff', 'clinical')
ON CONFLICT (code) DO NOTHING;

-- doctor: order, prescribe, refer, note, admit/discharge, report, assign.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
    'orders.view','orders.create',
    'notes.view','notes.write',
    'vitals.view','mar.view',
    'tasks.view','tasks.create',
    'admissions.view','admissions.manage',
    'reports.view','reports.write',
    'assignments.view','assignments.manage'
) WHERE r.code = 'doctor'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- nurse: view/action orders, note, record vitals + MAR, complete tasks.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
    'orders.view','orders.manage',
    'notes.view','notes.write',
    'vitals.view','vitals.record',
    'mar.view','mar.record',
    'tasks.view','tasks.complete',
    'admissions.view',
    'assignments.view'
) WHERE r.code = 'nurse'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- matron: nurse surface plus task creation, assignments, and report view.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
    'orders.view','orders.manage',
    'notes.view','notes.write',
    'vitals.view','vitals.record',
    'mar.view','mar.record',
    'tasks.view','tasks.complete','tasks.create',
    'admissions.view',
    'reports.view',
    'assignments.view','assignments.manage'
) WHERE r.code = 'matron'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- receptionist: emergency registration/triage path.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
    'triage.manage','assignments.view'
) WHERE r.code = 'receptionist'
ON CONFLICT (role_id, permission_id) DO NOTHING;
