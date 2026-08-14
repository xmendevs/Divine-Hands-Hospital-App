-- Notifications & governed internal communications (Phase 11).

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL DEFAULT '',
    channel TEXT NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app', 'email', 'both')),
    email_status TEXT NOT NULL DEFAULT 'none' CHECK (email_status IN ('none', 'pending', 'sent', 'failed')),
    read_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE comms_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('department', 'shift')),
    department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
    shift_id UUID REFERENCES staff_shifts(id) ON DELETE CASCADE,
    description TEXT NOT NULL DEFAULT '',
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (type = 'department' AND department_id IS NOT NULL AND shift_id IS NULL) OR
        (type = 'shift' AND shift_id IS NOT NULL AND department_id IS NULL)
    )
);

CREATE TABLE comms_channel_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES comms_channels(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_by UUID REFERENCES users(id),
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (channel_id, user_id)
);
CREATE INDEX comms_channel_members_user_idx ON comms_channel_members (user_id);

CREATE TABLE comms_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL CHECK (kind IN ('direct', 'channel', 'announcement')),
    sender_id UUID NOT NULL REFERENCES users(id),
    recipient_id UUID REFERENCES users(id),
    channel_id UUID REFERENCES comms_channels(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (kind = 'direct' AND recipient_id IS NOT NULL AND channel_id IS NULL) OR
        (kind = 'channel' AND channel_id IS NOT NULL AND recipient_id IS NULL) OR
        (kind = 'announcement')
    )
);
CREATE INDEX comms_messages_direct_idx ON comms_messages (sender_id, recipient_id, created_at DESC);
CREATE INDEX comms_messages_channel_idx ON comms_messages (channel_id, created_at DESC);

CREATE TABLE comms_message_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES comms_messages(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes BIGINT NOT NULL DEFAULT 0,
    storage_ref TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX comms_message_attachments_message_idx ON comms_message_attachments (message_id);

-- Users explicitly acknowledge the retention/audit policy notice.
CREATE TABLE comms_policy_acknowledgements (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
