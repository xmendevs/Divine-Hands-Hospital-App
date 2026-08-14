-- Billing module permissions and roles (Phase 08).
INSERT INTO permissions (code, name, module) VALUES
    ('billing.view', 'View invoices, payments, receipts and shifts', 'billing'),
    ('billing.create', 'Create and issue invoices (billable orders)', 'billing'),
    ('billing.manage', 'Manage price lists and services', 'billing'),
    ('billing.collect', 'Receive payments and open cashier shifts', 'billing'),
    ('billing.refund', 'Request and process refunds', 'billing'),
    ('billing.approve', 'Approve refunds', 'billing'),
    ('billing.reconcile', 'Close shifts and reconcile cash', 'billing')
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (code, name, description, mfa_required, is_system) VALUES
    ('cashier', 'Cashier', 'Receives payments, issues receipts, reconciles shifts', FALSE, TRUE),
    ('billing_officer', 'Billing Officer', 'Creates invoices and manages price lists', FALSE, TRUE),
    ('billing_supervisor', 'Billing Supervisor', 'Approves refunds and oversees cashiering', FALSE, TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
    'billing.view','billing.collect','billing.refund','billing.reconcile'
) WHERE r.code = 'cashier'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
    'billing.view','billing.create','billing.manage','billing.refund'
) WHERE r.code = 'billing_officer'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
    'billing.view','billing.refund','billing.approve','billing.reconcile'
) WHERE r.code = 'billing_supervisor'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Doctors create billable orders for their patients; admin may view billing.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('billing.view','billing.create')
WHERE r.code = 'doctor'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'billing.view'
WHERE r.code = 'admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;
