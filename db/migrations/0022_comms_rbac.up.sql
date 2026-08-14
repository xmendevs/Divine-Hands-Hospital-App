-- Notifications & governed communications permissions (Phase 11).
INSERT INTO permissions (code, name, module) VALUES
    ('notifications.view', 'View own notifications', 'notifications'),
    ('notifications.send', 'Send notifications to users', 'notifications'),
    ('comms.send', 'Send direct and channel messages', 'communications'),
    ('comms.view', 'View channels and messages', 'communications'),
    ('comms.manage', 'Create and manage channels and membership', 'communications'),
    ('comms.announce', 'Post announcements', 'communications'),
    ('comms.admin', 'Administrative access to communications', 'communications'),
    ('comms.audit', 'Run compliance investigations over communications', 'communications')
ON CONFLICT (code) DO NOTHING;

-- Every operational role can see its own notifications and participate in
-- internal messaging.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('notifications.view','comms.send','comms.view')
WHERE r.code IN ('nurse','matron','doctor','pharmacist','lab_technician','lab_supervisor','storekeeper','cashier','billing_officer','billing_supervisor','receptionist','admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Matrons and admins send alerts/reminders, manage channels and announce.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('notifications.send','comms.manage','comms.announce')
WHERE r.code IN ('matron','admin')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Restricted administrative access is held by admins only (super_admin holds
-- everything via the seed rule). Every access is audited at the handler.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'comms.admin'
WHERE r.code = 'admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Compliance investigations run through the auditor role (authorized workflow).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('comms.audit','comms.view')
WHERE r.code = 'auditor'
ON CONFLICT (role_id, permission_id) DO NOTHING;
