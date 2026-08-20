-- Real-time queue synchronization + digital signatures & attestation.
--
-- 1. lab_requests may be linked back to the doctor order that created them so
--    the orders queue and the lab queue stay in sync (releasing lab results
--    completes the linked order).
-- 2. clinical_notes and orders carry an optional digital signature (attending
--    physician attestation) for compliance and audit logging.

ALTER TABLE lab_requests
    ADD COLUMN order_id UUID REFERENCES orders(id) ON DELETE SET NULL;

CREATE INDEX idx_lab_requests_order ON lab_requests (order_id);

ALTER TABLE clinical_notes
    ADD COLUMN signed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN signed_at TIMESTAMPTZ,
    ADD COLUMN signature_hash TEXT NOT NULL DEFAULT '';

ALTER TABLE orders
    ADD COLUMN signed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN signed_at TIMESTAMPTZ,
    ADD COLUMN signature_hash TEXT NOT NULL DEFAULT '';
