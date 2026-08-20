-- Billing validation & installment tracking:
-- 1. Super admin validates/signs off on charges before receipts are shareable
-- 2. Installment payment plans for patients
-- 3. Bill update audit trail

ALTER TABLE invoices
    ADD COLUMN validated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN validated_at TIMESTAMPTZ,
    ADD COLUMN payment_plan TEXT NOT NULL DEFAULT 'full'
        CHECK (payment_plan IN ('full', 'installment')),
    ADD COLUMN installment_amount NUMERIC(12,2) CHECK (installment_amount IS NULL OR installment_amount > 0),
    ADD COLUMN installment_frequency TEXT DEFAULT ''
        CHECK (installment_frequency IN ('', 'weekly', 'biweekly', 'monthly')),
    ADD COLUMN update_reason TEXT NOT NULL DEFAULT '',
    ADD COLUMN updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_invoices_validated ON invoices (validated_at);
CREATE INDEX idx_invoices_payment_plan ON invoices (payment_plan);
