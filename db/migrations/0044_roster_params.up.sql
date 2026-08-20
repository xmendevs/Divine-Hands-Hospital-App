-- Add weekend working rules and min/max off limits to staff
ALTER TABLE staff ADD COLUMN IF NOT EXISTS can_work_weekends BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS min_days_off INT NOT NULL DEFAULT 4;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS max_days_off INT NOT NULL DEFAULT 10;
