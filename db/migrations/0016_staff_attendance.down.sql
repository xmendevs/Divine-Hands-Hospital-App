DROP TABLE IF EXISTS handover_notes;
DROP SEQUENCE IF EXISTS handover_no_seq;
DROP TABLE IF EXISTS attendance_records;
DROP TABLE IF EXISTS staff_shifts;
DROP TABLE IF EXISTS staff_leave;
ALTER TABLE staff
    DROP COLUMN IF EXISTS hire_date,
    DROP COLUMN IF EXISTS certifications,
    DROP COLUMN IF EXISTS skills,
    DROP COLUMN IF EXISTS availability,
    DROP COLUMN IF EXISTS employment_status,
    DROP COLUMN IF EXISTS contact_email,
    DROP COLUMN IF EXISTS contact_phone;
