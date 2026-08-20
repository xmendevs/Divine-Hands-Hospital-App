-- Grant orders.manage to pharmacy and lab roles so they can process orders.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'orders.manage'
WHERE r.code IN ('pharmacist', 'lab_technician', 'lab_supervisor')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Add priority column to orders table for urgency tracking across all order types.
ALTER TABLE orders ADD COLUMN priority VARCHAR(20) DEFAULT 'routine'
    CHECK (priority IN ('routine', 'urgent', 'stat'));

-- Add invoice_id to orders for auto-billing link.
ALTER TABLE orders ADD COLUMN invoice_id UUID REFERENCES invoices(id);
