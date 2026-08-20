-- Add shift_tag to staff for shift availability tagging (Night-Only, Day-Only, Afternoon-Only, Flexible)
ALTER TABLE staff ADD COLUMN IF NOT EXISTS shift_tag TEXT NOT NULL DEFAULT 'flexible';

-- Add is_published flag to roster_plans for Validate & Publish workflow
ALTER TABLE roster_plans ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE roster_plans ADD COLUMN IF NOT EXISTS published_by TEXT;
ALTER TABLE roster_plans ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
