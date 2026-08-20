-- Grant billing permissions to clinical roles so they can charge patients
-- and check balances via the ChargePatientModal.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('billing.create', 'billing.view')
WHERE r.code IN ('nurse', 'matron', 'pharmacist', 'lab_technician', 'lab_supervisor')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Grant orders.view to pharmacist so they can see the dispensing queue.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('orders.view')
WHERE r.code = 'pharmacist'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Grant pharmacy and inventory permissions to matron so she can monitor stock.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
    'medicines.view', 'medicines.manage',
    'inventory.receive', 'inventory.dispense', 'inventory.adjust',
    'inventory.transfer', 'inventory.count', 'inventory.approve'
)
WHERE r.code = 'matron'
ON CONFLICT (role_id, permission_id) DO NOTHING;
