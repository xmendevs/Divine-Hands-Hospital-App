-- Rollback of 0028: drop the next-of-kin address column.
ALTER TABLE patients DROP COLUMN IF EXISTS next_of_kin_address;
