-- Grant staff.view to all operational roles so the DM staff directory is
-- visible to every logged-in user (not just admin/super_admin).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'staff.view'
WHERE r.code IN ('nurse','matron','doctor','pharmacist','lab_technician','lab_supervisor','cashier','receptionist')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Grant comms.announce to all operational roles so every staff member can
-- post hospital-wide broadcast announcements (text, files, and voice notes).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'comms.announce'
WHERE r.code IN ('nurse','matron','doctor','pharmacist','lab_technician','lab_supervisor','cashier','receptionist')
ON CONFLICT (role_id, permission_id) DO NOTHING;
