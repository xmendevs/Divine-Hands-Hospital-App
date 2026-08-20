ALTER TABLE orders
    DROP COLUMN IF EXISTS signed_by,
    DROP COLUMN IF EXISTS signed_at,
    DROP COLUMN IF EXISTS signature_hash;

ALTER TABLE clinical_notes
    DROP COLUMN IF EXISTS signed_by,
    DROP COLUMN IF EXISTS signed_at,
    DROP COLUMN IF EXISTS signature_hash;

DROP INDEX IF EXISTS idx_lab_requests_order;

ALTER TABLE lab_requests
    DROP COLUMN IF EXISTS order_id;
