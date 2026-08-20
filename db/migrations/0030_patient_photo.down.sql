-- Rollback of 0030: drop the patient photo columns.
ALTER TABLE patients DROP COLUMN IF EXISTS photo_content_type;
ALTER TABLE patients DROP COLUMN IF EXISTS photo_data;
