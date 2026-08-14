DROP TABLE IF EXISTS roster_assignments;
DROP TABLE IF EXISTS roster_plans;
DROP SEQUENCE IF EXISTS roster_plans_no_seq;
DROP TABLE IF EXISTS staff_shift_preferences;
DROP TABLE IF EXISTS staff_unavailability;
ALTER TABLE staff_shifts DROP COLUMN IF EXISTS is_night;
