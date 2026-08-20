-- Payment attribution is per transaction: a relative, HMO, or employer may
-- pay a bill that is otherwise billed to the patient.
ALTER TABLE payments
    ADD COLUMN payer_name TEXT NOT NULL DEFAULT '';

CREATE INDEX idx_payments_invoice_received_at
    ON payments (invoice_id, received_at DESC);
