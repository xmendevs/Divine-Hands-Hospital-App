-- Extended patient intake: next-of-kin address column (clinical histories are
-- stored in patient_clinical_entries, which already exists).
ALTER TABLE patients ADD COLUMN next_of_kin_address TEXT NOT NULL DEFAULT '';
