-- Migration 0040: Enterprise Communications Upgrade
-- Adds: priority, threading (reply_to), read receipts, soft delete, typing indicator

-- 1. Extend comms_messages with new columns
ALTER TABLE comms_messages ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent', 'critical'));
ALTER TABLE comms_messages ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES comms_messages(id) ON DELETE SET NULL;
ALTER TABLE comms_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE comms_messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE comms_messages ADD COLUMN IF NOT EXISTS sender_name_cache TEXT;

-- 2. Read receipts table
CREATE TABLE IF NOT EXISTS comms_message_reads (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id  UUID NOT NULL REFERENCES comms_messages(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_comms_message_reads_msg ON comms_message_reads(message_id);
CREATE INDEX IF NOT EXISTS idx_comms_message_reads_user ON comms_message_reads(user_id);

-- 3. Typing indicators table (ephemeral, cleaned up periodically)
CREATE TABLE IF NOT EXISTS comms_typing_indicators (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id  UUID REFERENCES comms_channels(id) ON DELETE CASCADE,
    peer_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    UNIQUE(user_id, channel_id, peer_id)
);
CREATE INDEX IF NOT EXISTS idx_comms_typing_user ON comms_typing_indicators(user_id);
CREATE INDEX IF NOT EXISTS idx_comms_typing_expires ON comms_typing_indicators(expires_at);

-- 4. Extend comms_channels with new columns
ALTER TABLE comms_channels ADD COLUMN IF NOT EXISTS is_read_only BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE comms_channels ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;

-- 5. Channel unread counts (materialized per user per channel)
CREATE TABLE IF NOT EXISTS comms_channel_unreads (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id  UUID NOT NULL REFERENCES comms_channels(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    unread_count INT NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id, channel_id)
);

-- 6. DM unread counts
CREATE TABLE IF NOT EXISTS comms_dm_unreads (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    peer_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    unread_count INT NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id, peer_id)
);

-- 7. Notification preferences per user
CREATE TABLE IF NOT EXISTS comms_notification_prefs (
    user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    in_app_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
    sound_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    desktop_enabled   BOOLEAN NOT NULL DEFAULT TRUE
);

-- 8. Full text search index on messages
CREATE INDEX IF NOT EXISTS idx_comms_messages_body_gin ON comms_messages USING gin(to_tsvector('english', body));

-- 9. Populate sender_name_cache for existing messages
UPDATE comms_messages m SET sender_name_cache = COALESCE(
    (SELECT (s.first_name || ' ' || s.last_name) FROM staff s WHERE s.user_id = m.sender_id),
    (SELECT username FROM users WHERE id = m.sender_id),
    'Unknown'
);
