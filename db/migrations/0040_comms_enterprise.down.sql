-- Rollback Migration 0040
DROP INDEX IF EXISTS idx_comms_messages_body_gin;
DROP TABLE IF EXISTS comms_notification_prefs;
DROP TABLE IF EXISTS comms_dm_unreads;
DROP TABLE IF EXISTS comms_channel_unreads;
DROP TABLE IF EXISTS comms_typing_indicators;
DROP TABLE IF EXISTS comms_message_reads;

ALTER TABLE comms_channels DROP COLUMN IF EXISTS is_archived;
ALTER TABLE comms_channels DROP COLUMN IF EXISTS is_read_only;

ALTER TABLE comms_messages DROP COLUMN IF EXISTS sender_name_cache;
ALTER TABLE comms_messages DROP COLUMN IF EXISTS is_deleted;
ALTER TABLE comms_messages DROP COLUMN IF EXISTS edited_at;
ALTER TABLE comms_messages DROP COLUMN IF EXISTS reply_to_id;
ALTER TABLE comms_messages DROP COLUMN IF EXISTS priority;
