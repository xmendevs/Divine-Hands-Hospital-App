-- Enhanced dispensing workflow:
-- 1. Status tracking: pending_verification → ready_for_pickup → dispensed
-- 2. Allergy & drug interaction check confirmations
-- 3. Pharmacist / matron / superadmin sign-off
-- 4. Patient counseling notes

ALTER TABLE dispensations
    ADD COLUMN dispense_status TEXT NOT NULL DEFAULT 'dispensed'
        CHECK (dispense_status IN ('pending_verification','ready_for_pickup','dispensed')),
    ADD COLUMN counseling_notes TEXT NOT NULL DEFAULT '',
    ADD COLUMN allergy_check_passed BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN interaction_check_passed BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN sign_off_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN sign_off_at TIMESTAMPTZ;

-- Index for queue queries (pending_verification = awaiting pharmacist action).
CREATE INDEX idx_disp_status ON dispensations (dispense_status);
