-- Staff attendance & handover permissions and role grants (Phase 09).
INSERT INTO permissions (code, name, module) VALUES
    ('attendance.clock', 'Clock in and out', 'attendance'),
    ('attendance.view', 'View attendance records and reports', 'attendance'),
    ('attendance.manage', 'Manage shifts and attendance', 'attendance'),
    ('handover.create', 'Create shift handover notes', 'handover'),
    ('handover.view', 'View shift handover notes', 'handover'),
    ('handover.acknowledge', 'Acknowledge shift handover notes', 'handover'),
    ('staff.leave_request', 'Request leave', 'staff'),
    ('staff.leave_manage', 'Approve and manage leave', 'staff')
ON CONFLICT (code) DO NOTHING;

-- Every clinical/operational role clocks in and requests leave.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('attendance.clock','staff.leave_request')
WHERE r.code IN ('nurse','matron','doctor','pharmacist','lab_technician','lab_supervisor','storekeeper','cashier','billing_officer','billing_supervisor','receptionist','admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Nursing handover: outgoing nurses create, incoming nurses acknowledge.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('handover.create','handover.view','handover.acknowledge')
WHERE r.code IN ('nurse','matron')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Doctors hand over patients too (create/view only).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('handover.create','handover.view')
WHERE r.code = 'doctor'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Attendance oversight and leave management.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('attendance.view','attendance.manage','staff.leave_manage')
WHERE r.code IN ('matron','admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'staff.view'
WHERE r.code = 'matron'
ON CONFLICT (role_id, permission_id) DO NOTHING;
