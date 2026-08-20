ALTER TABLE dispensations
    DROP COLUMN IF EXISTS dispense_status,
    DROP COLUMN IF EXISTS counseling_notes,
    DROP COLUMN IF EXISTS allergy_check_passed,
    DROP COLUMN IF EXISTS interaction_check_passed,
    DROP COLUMN IF EXISTS sign_off_by,
    DROP COLUMN IF EXISTS sign_off_at;

DROP INDEX IF EXISTS idx_disp_status;
