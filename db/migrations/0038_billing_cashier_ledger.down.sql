DROP INDEX IF EXISTS idx_payments_invoice_received_at;

ALTER TABLE payments
    DROP COLUMN IF EXISTS payer_name;
