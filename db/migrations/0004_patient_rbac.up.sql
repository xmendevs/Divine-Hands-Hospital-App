-- Patient, family, clinical, and document permissions + clinical roles.
INSERT INTO permissions (code, name, module) VALUES
    ('patients.view', 'View patients', 'patients'),
    ('patients.create', 'Register patients', 'patients'),
    ('patients.edit', 'Edit patient demographics', 'patients'),
    ('patients.search', 'Search patients', 'patients'),
    ('patients.amend', 'Amend patient records', 'patients'),
    ('clinical.view', 'View clinical data', 'clinical'),
    ('clinical.edit', 'Add clinical data', 'clinical'),
    ('families.view', 'View family profiles', 'patients'),
    ('families.create', 'Create family profiles', 'patients'),
    ('documents.view', 'View patient documents', 'patients'),
    ('documents.upload', 'Add patient documents', 'patients')
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (code, name, description, mfa_required, is_system) VALUES
    ('receptionist', 'Receptionist', 'Patient registration and demographics', FALSE, TRUE),
    ('nurse', 'Nurse', 'Nursing workflows and clinical capture', FALSE, TRUE),
    ('matron', 'Matron', 'Nursing oversight and record corrections', FALSE, TRUE),
    ('doctor', 'Doctor', 'Clinical care and record amendments', FALSE, TRUE)
ON CONFLICT (code) DO NOTHING;

-- receptionist: registration + demographics + family, no clinical view.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
    'patients.view','patients.create','patients.edit','patients.search',
    'families.view','families.create'
) WHERE r.code = 'receptionist'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- nurse: receptionist surface + clinical capture + documents.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
    'patients.view','patients.create','patients.edit','patients.search',
    'families.view','families.create',
    'clinical.view','clinical.edit',
    'documents.view','documents.upload'
) WHERE r.code = 'nurse'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- matron: nurse surface + the right to amend/correct records.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
    'patients.view','patients.create','patients.edit','patients.search',
    'families.view','families.create',
    'clinical.view','clinical.edit',
    'documents.view','documents.upload',
    'patients.amend'
) WHERE r.code = 'matron'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- doctor: full clinical care + amendments, no staff/demographics admin.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
    'patients.view','patients.create','patients.search','patients.amend',
    'clinical.view','clinical.edit',
    'documents.view','documents.upload',
    'families.view'
) WHERE r.code = 'doctor'
ON CONFLICT (role_id, permission_id) DO NOTHING;
