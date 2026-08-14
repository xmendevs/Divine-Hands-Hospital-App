-- Remove the pharmacist role and pharmacy permissions.
DELETE FROM role_permissions
WHERE role_id IN (SELECT id FROM roles WHERE code = 'pharmacist');

DELETE FROM roles WHERE code = 'pharmacist';

DELETE FROM permissions WHERE code IN (
    'medicines.view','medicines.manage',
    'inventory.receive','inventory.dispense','inventory.adjust',
    'inventory.transfer','inventory.count','inventory.approve'
);
