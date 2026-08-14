-- Reverse of 0007_clinical_workflows.up.sql.
DROP TABLE IF EXISTS triage;
DROP TABLE IF EXISTS clinical_reports;
DROP TABLE IF EXISTS admissions;
DROP TABLE IF EXISTS department_tasks;
DROP TABLE IF EXISTS patient_observations;
DROP TABLE IF EXISTS medication_administrations;
DROP TABLE IF EXISTS orders;
DROP SEQUENCE IF EXISTS orders_no_seq;
DROP TABLE IF EXISTS clinical_notes;
DROP TABLE IF EXISTS patient_assignments;
