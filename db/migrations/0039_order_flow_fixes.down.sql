-- Revoke orders.manage from pharmacy and lab roles.
DELETE FROM role_permissions
WHERE role_id IN (SELECT id FROM roles WHERE code IN ('pharmacist', 'lab_technician', 'lab_supervisor'))
  AND permission_id IN (SELECT id FROM permissions WHERE code = 'orders.manage');

-- Remove columns added in up migration.
ALTER TABLE orders DROP COLUMN IF EXISTS priority;
ALTER TABLE orders DROP COLUMN IF EXISTS invoice_id;
