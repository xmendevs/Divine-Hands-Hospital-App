-- Revoke billing permissions from clinical roles.
DELETE FROM role_permissions
WHERE role_id IN (SELECT id FROM roles WHERE code IN ('nurse', 'matron', 'pharmacist', 'lab_technician', 'lab_supervisor'))
  AND permission_id IN (SELECT id FROM permissions WHERE code IN ('billing.create', 'billing.view'));

-- Revoke pharmacy permissions from matron.
DELETE FROM role_permissions
WHERE role_id IN (SELECT id FROM roles WHERE code = 'matron')
  AND permission_id IN (SELECT id FROM permissions WHERE code IN (
      'medicines.view', 'medicines.manage',
      'inventory.receive', 'inventory.dispense', 'inventory.adjust',
      'inventory.transfer', 'inventory.count', 'inventory.approve'
  ));
