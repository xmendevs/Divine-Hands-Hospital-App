ALTER TABLE staff DROP COLUMN IF EXISTS shift_tag;
ALTER TABLE roster_plans DROP COLUMN IF EXISTS is_published;
ALTER TABLE roster_plans DROP COLUMN IF EXISTS published_by;
ALTER TABLE roster_plans DROP COLUMN IF EXISTS published_at;
