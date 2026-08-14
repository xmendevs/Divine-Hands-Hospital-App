-- Reverse of 0012_lab_rbac.up.sql.
DELETE FROM role_permissions
WHERE permission_id IN (SELECT id FROM permissions WHERE module = 'lab');

DELETE FROM permissions WHERE module = 'lab';

DELETE FROM roles WHERE code IN ('lab_technician', 'lab_supervisor');
