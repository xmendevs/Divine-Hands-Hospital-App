ALTER TABLE invoices
    DROP COLUMN IF EXISTS validated_by,
    DROP COLUMN IF EXISTS validated_at,
    DROP COLUMN IF EXISTS payment_plan,
    DROP COLUMN IF EXISTS installment_amount,
    DROP COLUMN IF EXISTS installment_frequency,
    DROP COLUMN IF EXISTS update_reason,
    DROP COLUMN IF EXISTS updated_by;

DROP INDEX IF EXISTS idx_invoices_validated;
DROP INDEX IF EXISTS idx_invoices_payment_plan;
