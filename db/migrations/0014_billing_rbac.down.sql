-- Reverse of 0014_billing_rbac.up.sql.
DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE code IN ('cashier','billing_officer','billing_supervisor'))
    AND permission_id IN (SELECT id FROM permissions WHERE module = 'billing');
DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE code IN ('doctor','admin'))
    AND permission_id IN (SELECT id FROM permissions WHERE module = 'billing');
DELETE FROM roles WHERE code IN ('cashier','billing_officer','billing_supervisor');
DELETE FROM permissions WHERE module = 'billing';
