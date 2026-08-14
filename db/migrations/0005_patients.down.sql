-- Reverse of 0005_patients.up.sql.
DROP TABLE IF EXISTS patient_documents;
DROP TABLE IF EXISTS patient_timeline;
DROP TABLE IF EXISTS patient_amendments;
DROP TABLE IF EXISTS patient_clinical_entries;

ALTER TABLE families DROP CONSTRAINT IF EXISTS families_head_patient_fk;
DROP TABLE IF EXISTS patients;
DROP TABLE IF EXISTS families;

DROP FUNCTION IF EXISTS next_patient_id(TEXT);
DROP TABLE IF EXISTS patient_id_counters;

DROP TYPE IF EXISTS patient_status;
DROP TYPE IF EXISTS patient_registration_type;
