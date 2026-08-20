-- Revoke staff.view from operational roles (admin retains it from 0003).
DELETE FROM role_permissions
WHERE permission_id = (SELECT id FROM permissions WHERE code = 'staff.view')
  AND role_id IN (SELECT id FROM roles WHERE code IN ('nurse','matron','doctor','pharmacist','lab_technician','lab_supervisor','cashier','receptionist'));

-- Revoke comms.announce from operational roles (matron/admin retain it from 0022).
DELETE FROM role_permissions
WHERE permission_id = (SELECT id FROM permissions WHERE code = 'comms.announce')
  AND role_id IN (SELECT id FROM roles WHERE code IN ('nurse','doctor','pharmacist','lab_technician','lab_supervisor','cashier','receptionist'));
