package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

// Communications errors.
var (
	ErrNotChannelMember = errors.New("user is not a channel member")
	ErrAttachmentPolicy = errors.New("attachment violates policy")
)

const defaultCommsPolicyNotice = "Communications on this hospital system are hospital-owned and may be retained and audited in accordance with the organization's communications policy. Administrative and compliance access is restricted, authorized, and logged."

func (s *Store) getIntSetting(ctx context.Context, key string, def int) (int, error) {
	v, err := s.getStringSetting(ctx, key, "")
	if err != nil || v == "" {
		return def, err
	}
	var n int
	if json.Unmarshal([]byte(v), &n) != nil {
		return def, nil
	}
	return n, nil
}

func (s *Store) getInt64Setting(ctx context.Context, key string, def int64) (int64, error) {
	v, err := s.getStringSetting(ctx, key, "")
	if err != nil || v == "" {
		return def, err
	}
	var n int64
	if json.Unmarshal([]byte(v), &n) != nil {
		return def, nil
	}
	return n, nil
}

// ---- channels ----

const channelCols = `c.id::text, c.name, c.type, c.department_id::text, c.shift_id::text,
	COALESCE(d.name, ''), COALESCE(sh.name, ''), c.description, c.created_by::text, c.created_at`

const channelFrom = ` FROM comms_channels c
	LEFT JOIN departments d ON d.id = c.department_id
	LEFT JOIN staff_shifts sh ON sh.id = c.shift_id`

func scanChannel(r pgx.Row, withMembership bool) (*domain.CommsChannel, error) {
	var ch domain.CommsChannel
	var err error
	if withMembership {
		err = r.Scan(&ch.ID, &ch.Name, &ch.Type, &ch.DepartmentID, &ch.ShiftID,
			&ch.DepartmentName, &ch.ShiftName, &ch.Description, &ch.CreatedBy, &ch.CreatedAt,
			&ch.MemberCount, &ch.IsMember)
	} else {
		err = r.Scan(&ch.ID, &ch.Name, &ch.Type, &ch.DepartmentID, &ch.ShiftID,
			&ch.DepartmentName, &ch.ShiftName, &ch.Description, &ch.CreatedBy, &ch.CreatedAt)
	}
	if err != nil {
		return nil, err
	}
	return &ch, nil
}

type CreateChannelParams struct {
	Name         string
	Type         string
	DepartmentID *string
	ShiftID      *string
	Description  string
	CreatedBy    string
}

// CreateChannel creates a department or shift channel.
func (s *Store) CreateChannel(ctx context.Context, p CreateChannelParams) (*domain.CommsChannel, error) {
	var id string
	if err := s.pool.QueryRow(ctx, `
		INSERT INTO comms_channels (name, type, department_id, shift_id, description, created_by)
		VALUES ($1, $2, $3::uuid, $4::uuid, $5, $6::uuid)
		RETURNING id::text`,
		p.Name, p.Type, nullableUUID(p.DepartmentID), nullableUUID(p.ShiftID), p.Description, p.CreatedBy).Scan(&id); err != nil {
		return nil, err
	}
	return s.GetChannel(ctx, id)
}

// ListChannels returns all channels with membership info for the given user.
func (s *Store) ListChannels(ctx context.Context, userID string) ([]domain.CommsChannel, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT c.id::text, c.name, c.type, c.department_id::text, c.shift_id::text,
		       COALESCE(d.name, ''), COALESCE(sh.name, ''), c.description, c.created_by::text, c.created_at,
		       (SELECT count(*) FROM comms_channel_members m WHERE m.channel_id = c.id)::int,
		       EXISTS (SELECT 1 FROM comms_channel_members m WHERE m.channel_id = c.id AND m.user_id = $1::uuid)
		FROM comms_channels c
		LEFT JOIN departments d ON d.id = c.department_id
		LEFT JOIN staff_shifts sh ON sh.id = c.shift_id
		ORDER BY c.name ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []domain.CommsChannel{}
	for rows.Next() {
		ch, err := scanChannel(rows, true)
		if err != nil {
			return nil, err
		}
		out = append(out, *ch)
	}
	return out, rows.Err()
}

// GetChannel returns one channel.
func (s *Store) GetChannel(ctx context.Context, id string) (*domain.CommsChannel, error) {
	ch, err := scanChannel(s.pool.QueryRow(ctx, `SELECT `+channelCols+channelFrom+` WHERE c.id = $1::uuid`, id), false)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return ch, err
}

// ListChannelMembers returns a channel's members.
func (s *Store) ListChannelMembers(ctx context.Context, channelID string) ([]domain.CommsChannelMember, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT m.id::text, m.channel_id::text, m.user_id::text, m.added_by::text, m.added_at,
		       u.username, COALESCE(st.first_name || ' ' || st.last_name, ''), COALESCE(st.employee_no, '')
		FROM comms_channel_members m
		JOIN users u ON u.id = m.user_id
		LEFT JOIN staff st ON st.user_id = m.user_id
		WHERE m.channel_id = $1::uuid
		ORDER BY u.username`, channelID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []domain.CommsChannelMember{}
	for rows.Next() {
		var m domain.CommsChannelMember
		if err := rows.Scan(&m.ID, &m.ChannelID, &m.UserID, &m.AddedBy, &m.AddedAt,
			&m.Username, &m.StaffName, &m.EmployeeNo); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// IsChannelMember reports whether the user belongs to a channel.
func (s *Store) IsChannelMember(ctx context.Context, channelID, userID string) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM comms_channel_members WHERE channel_id = $1::uuid AND user_id = $2::uuid)`,
		channelID, userID).Scan(&ok)
	return ok, err
}

// AddChannelMember adds a user to a channel.
func (s *Store) AddChannelMember(ctx context.Context, channelID, userID, addedBy string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO comms_channel_members (channel_id, user_id, added_by)
		VALUES ($1::uuid, $2::uuid, $3::uuid)
		ON CONFLICT (channel_id, user_id) DO NOTHING`,
		channelID, userID, nullableUUID(&addedBy))
	return err
}

// RemoveChannelMember removes a user from a channel.
func (s *Store) RemoveChannelMember(ctx context.Context, channelID, userID string) error {
	ct, err := s.pool.Exec(ctx, `
		DELETE FROM comms_channel_members WHERE channel_id = $1::uuid AND user_id = $2::uuid`,
		channelID, userID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ---- messages ----

const messageCols = `m.id::text, m.kind, m.sender_id::text, m.recipient_id::text, m.channel_id::text,
	m.body, m.priority, m.reply_to_id::text, m.edited_at, m.is_deleted,
	m.created_at,
	COALESCE(m.sender_name_cache, COALESCE(sst.first_name || ' ' || sst.last_name, su.username, 'Unknown')),
	su.username,
	COALESCE(rst.first_name || ' ' || rst.last_name, ''), COALESCE(c.name, '')`

const messageFrom = ` FROM comms_messages m
	JOIN users su ON su.id = m.sender_id
	LEFT JOIN staff sst ON sst.user_id = m.sender_id
	LEFT JOIN users ru ON ru.id = m.recipient_id
	LEFT JOIN staff rst ON rst.user_id = m.recipient_id
	LEFT JOIN comms_channels c ON c.id = m.channel_id`

func scanMessage(r pgx.Row) (*domain.Message, error) {
	var m domain.Message
	err := r.Scan(&m.ID, &m.Kind, &m.SenderID, &m.RecipientID, &m.ChannelID,
		&m.Body, &m.Priority, &m.ReplyToID, &m.EditedAt, &m.IsDeleted,
		&m.CreatedAt, &m.SenderName, &m.SenderUsername,
		&m.RecipientName, &m.ChannelName)
	if err != nil {
		return nil, err
	}
	return &m, nil
}

func (s *Store) loadAttachments(ctx context.Context, messageIDs []string) (map[string][]domain.MessageAttachment, error) {
	out := map[string][]domain.MessageAttachment{}
	if len(messageIDs) == 0 {
		return out, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, message_id::text, file_name, mime_type, size_bytes, storage_ref, created_at
		FROM comms_message_attachments WHERE message_id = ANY($1::uuid[])`, messageIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var a domain.MessageAttachment
		if err := rows.Scan(&a.ID, &a.MessageID, &a.FileName, &a.MimeType, &a.SizeBytes, &a.StorageRef, &a.CreatedAt); err != nil {
			return nil, err
		}
		out[a.MessageID] = append(out[a.MessageID], a)
	}
	return out, rows.Err()
}

type SendMessageParams struct {
	Kind        string
	SenderID    string
	RecipientID *string
	ChannelID   *string
	Body        string
	Priority    string
	ReplyToID   *string
	Attachments []domain.MessageAttachment
}

// sendMessage inserts a message and its attachments.
func (s *Store) sendMessage(ctx context.Context, p SendMessageParams) (*domain.Message, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	priority := p.Priority
	if priority == "" {
		priority = "normal"
	}

	var id string
	if err := tx.QueryRow(ctx, `
		INSERT INTO comms_messages (kind, sender_id, recipient_id, channel_id, body, priority, reply_to_id)
		VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::uuid)
		RETURNING id::text`,
		p.Kind, p.SenderID, nullableUUID(p.RecipientID), nullableUUID(p.ChannelID), p.Body, priority, nullableUUID(p.ReplyToID)).Scan(&id); err != nil {
		return nil, err
	}
	for _, a := range p.Attachments {
		if _, err := tx.Exec(ctx, `
			INSERT INTO comms_message_attachments (message_id, file_name, mime_type, size_bytes, storage_ref)
			VALUES ($1::uuid, $2, $3, $4, $5)`,
			id, a.FileName, a.MimeType, a.SizeBytes, a.StorageRef); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	m, err := scanMessage(s.pool.QueryRow(ctx, `SELECT `+messageCols+messageFrom+` WHERE m.id = $1::uuid`, id))
	if err != nil {
		return nil, err
	}
	atts, err := s.loadAttachments(ctx, []string{id})
	if err != nil {
		return nil, err
	}
	m.Attachments = atts[id]
	if m.Attachments == nil {
		m.Attachments = []domain.MessageAttachment{}
	}
	return m, nil
}

// SendDirectMessage sends a direct message between two users.
func (s *Store) SendDirectMessage(ctx context.Context, senderID, recipientID, body string, attachments []domain.MessageAttachment) (*domain.Message, error) {
	return s.sendMessage(ctx, SendMessageParams{
		Kind:        domain.MessageKindDirect,
		SenderID:    senderID,
		RecipientID: &recipientID,
		Body:        body,
		Attachments: attachments,
	})
}

// SendChannelMessage sends a message to a channel the sender belongs to.
func (s *Store) SendChannelMessage(ctx context.Context, channelID, senderID, body string, attachments []domain.MessageAttachment) (*domain.Message, error) {
	ok, err := s.IsChannelMember(ctx, channelID, senderID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotChannelMember
	}
	return s.sendMessage(ctx, SendMessageParams{
		Kind:        domain.MessageKindChannel,
		SenderID:    senderID,
		ChannelID:   &channelID,
		Body:        body,
		Attachments: attachments,
	})
}

// CreateAnnouncement records an announcement message (optionally channel-scoped).
func (s *Store) CreateAnnouncement(ctx context.Context, senderID string, channelID *string, body string, attachments []domain.MessageAttachment) (*domain.Message, error) {
	if attachments == nil {
		attachments = []domain.MessageAttachment{}
	}
	return s.sendMessage(ctx, SendMessageParams{
		Kind:        domain.MessageKindAnnouncement,
		SenderID:    senderID,
		ChannelID:   channelID,
		Body:        body,
		Attachments: attachments,
	})
}

func retentionCutoff(ctx context.Context, s *Store, now time.Time) time.Time {
	days, err := s.getIntSetting(ctx, "comms.retention_days", 365)
	if err != nil || days < 0 {
		return now.AddDate(0, 0, -365)
	}
	return now.AddDate(0, 0, -days)
}

// ListDirectMessages returns the thread between two users, newest first.
func (s *Store) ListDirectMessages(ctx context.Context, userA, userB string, limit, offset int) ([]domain.Message, error) {
	cutoff := retentionCutoff(ctx, s, time.Now())
	rows, err := s.pool.Query(ctx, `
		SELECT `+messageCols+messageFrom+`
		WHERE m.kind = 'direct'
		  AND ((m.sender_id = $1::uuid AND m.recipient_id = $2::uuid)
		    OR (m.sender_id = $2::uuid AND m.recipient_id = $1::uuid))
		  AND m.created_at >= $3::timestamptz
		ORDER BY m.created_at DESC LIMIT $4 OFFSET $5`, userA, userB, cutoff, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return s.collectMessages(ctx, rows)
}

// ListChannelMessages returns a channel's messages, newest first.
func (s *Store) ListChannelMessages(ctx context.Context, channelID string, limit, offset int) ([]domain.Message, error) {
	cutoff := retentionCutoff(ctx, s, time.Now())
	rows, err := s.pool.Query(ctx, `
		SELECT `+messageCols+messageFrom+`
		WHERE m.kind = 'channel' AND m.channel_id = $1::uuid AND m.created_at >= $2::timestamptz
		ORDER BY m.created_at DESC LIMIT $3 OFFSET $4`, channelID, cutoff, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return s.collectMessages(ctx, rows)
}

// ListAnnouncements returns announcements visible to the user (global or their channel).
func (s *Store) ListAnnouncements(ctx context.Context, userID string, limit, offset int) ([]domain.Message, error) {
	cutoff := retentionCutoff(ctx, s, time.Now())
	rows, err := s.pool.Query(ctx, `
		SELECT `+messageCols+messageFrom+`
		WHERE m.kind = 'announcement' AND m.created_at >= $2::timestamptz
		  AND (m.channel_id IS NULL OR m.channel_id IN (
		      SELECT channel_id FROM comms_channel_members WHERE user_id = $1::uuid))
		ORDER BY m.created_at DESC LIMIT $3 OFFSET $4`, userID, cutoff, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return s.collectMessages(ctx, rows)
}

func (s *Store) collectMessages(ctx context.Context, rows pgx.Rows) ([]domain.Message, error) {
	msgs := make([]domain.Message, 0)
	var ids []string
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		msgs = append(msgs, *m)
		ids = append(ids, m.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	atts, err := s.loadAttachments(ctx, ids)
	if err != nil {
		return nil, err
	}
	for i := range msgs {
		if a, ok := atts[msgs[i].ID]; ok {
			msgs[i].Attachments = a
		} else {
			msgs[i].Attachments = []domain.MessageAttachment{}
		}
	}
	return msgs, nil
}

type SearchMessagesParams struct {
	SenderID    string
	RecipientID string
	ChannelID   string
	Query       string
	From        string
	To          string
	Limit       int
	Offset      int
}

// SearchMessages searches communications across users and channels. Restricted
// to administrative/compliance callers; callers must log the access.
func (s *Store) SearchMessages(ctx context.Context, p SearchMessagesParams) ([]domain.Message, error) {
	q := `SELECT ` + messageCols + messageFrom + ` WHERE true`
	args := []any{}
	if p.SenderID != "" {
		args = append(args, p.SenderID)
		q += ` AND m.sender_id = $` + itoa(len(args)) + `::uuid`
	}
	if p.RecipientID != "" {
		args = append(args, p.RecipientID)
		q += ` AND m.recipient_id = $` + itoa(len(args)) + `::uuid`
	}
	if p.ChannelID != "" {
		args = append(args, p.ChannelID)
		q += ` AND m.channel_id = $` + itoa(len(args)) + `::uuid`
	}
	if p.Query != "" {
		args = append(args, "%"+p.Query+"%")
		q += ` AND m.body ILIKE $` + itoa(len(args))
	}
	if p.From != "" {
		args = append(args, p.From)
		q += ` AND m.created_at >= $` + itoa(len(args)) + `::date`
	}
	if p.To != "" {
		args = append(args, p.To)
		q += ` AND m.created_at < ($` + itoa(len(args)) + `::date + interval '1 day')`
	}
	q += ` ORDER BY m.created_at DESC LIMIT $` + itoa(len(args)+1) + ` OFFSET $` + itoa(len(args)+2)
	args = append(args, p.Limit, p.Offset)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return s.collectMessages(ctx, rows)
}

// PurgeExpiredCommunications deletes messages and notifications older than the
// configured retention window and returns how many rows were removed.
func (s *Store) PurgeExpiredCommunications(ctx context.Context) (messages, notifications int64, err error) {
	cutoff := retentionCutoff(ctx, s, time.Now())
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	mct, err := tx.Exec(ctx, `DELETE FROM comms_messages WHERE created_at < $1::timestamptz`, cutoff)
	if err != nil {
		return 0, 0, err
	}
	nct, err := tx.Exec(ctx, `DELETE FROM notifications WHERE created_at < $1::timestamptz`, cutoff)
	if err != nil {
		return 0, 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, 0, err
	}
	return mct.RowsAffected(), nct.RowsAffected(), nil
}

// ---- read receipts ----

// MarkMessagesRead marks messages as read by the given user.
func (s *Store) MarkMessagesRead(ctx context.Context, userID string, messageIDs []string) error {
	if len(messageIDs) == 0 {
		return nil
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO comms_message_reads (message_id, user_id, read_at)
		SELECT unnest($1::uuid[]), $2::uuid, now()
		ON CONFLICT (message_id, user_id) DO NOTHING`, messageIDs, userID)
	return err
}

// MarkConversationRead marks all messages in a DM thread as read.
func (s *Store) MarkConversationRead(ctx context.Context, userID, peerID string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO comms_message_reads (message_id, user_id, read_at)
		SELECT m.id, $1::uuid, now()
		FROM comms_messages m
		WHERE m.kind = 'direct' AND m.sender_id = $2::uuid AND m.recipient_id = $1::uuid
		  AND NOT EXISTS (SELECT 1 FROM comms_message_reads r WHERE r.message_id = m.id AND r.user_id = $1::uuid)
		ON CONFLICT DO NOTHING`, userID, peerID)
	return err
}

// MarkChannelRead marks all channel messages as read for the user.
func (s *Store) MarkChannelRead(ctx context.Context, userID, channelID string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO comms_message_reads (message_id, user_id, read_at)
		SELECT m.id, $2::uuid, now()
		FROM comms_messages m
		WHERE m.kind = 'channel' AND m.channel_id = $3::uuid AND m.sender_id != $2::uuid
		  AND NOT EXISTS (SELECT 1 FROM comms_message_reads r WHERE r.message_id = m.id AND r.user_id = $2::uuid)
		ON CONFLICT DO NOTHING`, userID, userID, channelID)
	return err
}

// GetMessageReadBy returns the user IDs who have read a message.
func (s *Store) GetMessageReadBy(ctx context.Context, messageID string) ([]string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT user_id::text FROM comms_message_reads WHERE message_id = $1::uuid`, messageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// GetUnreadCounts returns unread counts for DMs and channels for a user.
func (s *Store) GetUnreadCounts(ctx context.Context, userID string) (dmUnread map[string]int, channelUnread map[string]int, totalUnread int, err error) {
	dmUnread = make(map[string]int)
	channelUnread = make(map[string]int)

	// DM unread counts: messages sent TO this user that haven't been read
	dmRows, err := s.pool.Query(ctx, `
		SELECT m.sender_id::text, count(*)::int
		FROM comms_messages m
		WHERE m.kind = 'direct' AND m.recipient_id = $1::uuid AND m.sender_id != $1::uuid
		  AND NOT EXISTS (SELECT 1 FROM comms_message_reads r WHERE r.message_id = m.id AND r.user_id = $1::uuid)
		GROUP BY m.sender_id`, userID)
	if err != nil {
		return nil, nil, 0, err
	}
	defer dmRows.Close()
	for dmRows.Next() {
		var peerID string
		var count int
		if err := dmRows.Scan(&peerID, &count); err != nil {
			return nil, nil, 0, err
		}
		dmUnread[peerID] = count
		totalUnread += count
	}
	if err := dmRows.Err(); err != nil {
		return nil, nil, 0, err
	}

	// Channel unread counts: messages from OTHER members in channels this user belongs to
	chRows, err := s.pool.Query(ctx, `
		SELECT c.id::text, count(*)::int
		FROM comms_messages m
		JOIN comms_channels c ON c.id = m.channel_id
		JOIN comms_channel_members cm ON cm.channel_id = c.id AND cm.user_id = $1::uuid
		WHERE m.kind = 'channel' AND m.sender_id != $1::uuid
		  AND NOT EXISTS (SELECT 1 FROM comms_message_reads r WHERE r.message_id = m.id AND r.user_id = $1::uuid)
		GROUP BY c.id`, userID)
	if err != nil {
		return nil, nil, 0, err
	}
	defer chRows.Close()
	for chRows.Next() {
		var chID string
		var count int
		if err := chRows.Scan(&chID, &count); err != nil {
			return nil, nil, 0, err
		}
		channelUnread[chID] = count
		totalUnread += count
	}
	return dmUnread, channelUnread, totalUnread, chRows.Err()
}

// ---- typing indicators ----

// SetTypingIndicator records that a user is typing in a DM or channel.
func (s *Store) SetTypingIndicator(ctx context.Context, userID string, channelID, peerID *string) error {
	expires := time.Now().Add(5 * time.Second)
	_, err := s.pool.Exec(ctx, `
		INSERT INTO comms_typing_indicators (user_id, channel_id, peer_id, expires_at)
		VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
		ON CONFLICT (user_id, channel_id, peer_id)
		DO UPDATE SET expires_at = $4`, userID, nullableUUID(channelID), nullableUUID(peerID), expires)
	return err
}

// GetTypingIndicators returns who is currently typing in a channel or DM.
func (s *Store) GetTypingIndicators(ctx context.Context, userID string, channelID, peerID *string) ([]string, error) {
	q := `SELECT t.user_id::text FROM comms_typing_indicators t WHERE t.expires_at > now() AND t.user_id != $1::uuid`
	args := []any{userID}
	if channelID != nil && *channelID != "" {
		args = append(args, *channelID)
		q += ` AND t.channel_id = $` + itoa(len(args)) + `::uuid`
	} else if peerID != nil && *peerID != "" {
		args = append(args, *peerID)
		q += ` AND t.peer_id = $` + itoa(len(args)) + `::uuid`
	} else {
		q += ` AND FALSE`
	}
	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// CleanupExpiredTypingIndicators removes stale typing indicators.
func (s *Store) CleanupExpiredTypingIndicators(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM comms_typing_indicators WHERE expires_at < now()`)
	return err
}

// ---- message editing & deletion ----

// EditMessage updates a message body and sets edited_at.
func (s *Store) EditMessage(ctx context.Context, messageID, userID, newBody string) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE comms_messages SET body = $1, edited_at = now()
		WHERE id = $2::uuid AND sender_id = $3::uuid AND is_deleted = FALSE`,
		newBody, messageID, userID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// SoftDeleteMessage marks a message as deleted (soft delete).
func (s *Store) SoftDeleteMessage(ctx context.Context, messageID, userID string) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE comms_messages SET is_deleted = TRUE, body = '[Message deleted]'
		WHERE id = $1::uuid AND sender_id = $2::uuid`, messageID, userID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ---- thread replies ----

// GetThreadReplies returns replies to a parent message.
func (s *Store) GetThreadReplies(ctx context.Context, parentID string, limit, offset int) ([]domain.Message, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+messageCols+messageFrom+`
		WHERE m.reply_to_id = $1::uuid AND m.is_deleted = FALSE
		ORDER BY m.created_at ASC LIMIT $2 OFFSET $3`, parentID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return s.collectMessages(ctx, rows)
}

// GetReplyCount returns the number of replies to a message.
func (s *Store) GetReplyCount(ctx context.Context, messageID string) (int, error) {
	var count int
	err := s.pool.QueryRow(ctx, `
		SELECT count(*)::int FROM comms_messages WHERE reply_to_id = $1::uuid AND is_deleted = FALSE`, messageID).Scan(&count)
	return count, err
}

// ---- user-level search ----

// SearchUserMessages searches messages the user has access to (DMs they sent/received + channels they belong to).
func (s *Store) SearchUserMessages(ctx context.Context, userID string, query string, limit, offset int) ([]domain.Message, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+messageCols+messageFrom+`
		WHERE m.is_deleted = FALSE AND (
		  (m.kind = 'direct' AND (m.sender_id = $1::uuid OR m.recipient_id = $1::uuid))
		  OR (m.kind = 'channel' AND m.channel_id IN (SELECT channel_id FROM comms_channel_members WHERE user_id = $1::uuid))
		  OR m.kind = 'announcement'
		) AND m.body ILIKE $2
		ORDER BY m.created_at DESC LIMIT $3 OFFSET $4`,
		userID, "%"+query+"%", limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return s.collectMessages(ctx, rows)
}

// ---- call logs ----

// CreateCallLog records a new call event.
func (s *Store) CreateCallLog(ctx context.Context, callerID string, calleeID *string, channelID *string, callType, direction, status string) (*domain.CallLog, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO comms_call_logs (caller_id, callee_id, channel_id, call_type, direction, status)
		VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)
		RETURNING id::text`,
		callerID, nullableUUID(calleeID), nullableUUID(channelID), callType, direction, status).Scan(&id)
	if err != nil {
		return nil, err
	}
	return s.GetCallLog(ctx, id)
}

// GetCallLog returns a single call log entry with joined names.
func (s *Store) GetCallLog(ctx context.Context, id string) (*domain.CallLog, error) {
	var cl domain.CallLog
	err := s.pool.QueryRow(ctx, `
		SELECT cl.id::text, cl.caller_id::text, cl.callee_id::text, cl.channel_id::text,
		       cl.call_type, cl.direction, cl.status, cl.duration_seconds,
		       cl.started_at, cl.answered_at, cl.ended_at,
		       COALESCE(cs.first_name || ' ' || cs.last_name, cu.username, 'Unknown'),
		       COALESCE(cc.first_name || ' ' || cc.last_name, cu2.username, '')
		FROM comms_call_logs cl
		JOIN users cu ON cu.id = cl.caller_id
		LEFT JOIN staff cs ON cs.user_id = cl.caller_id
		LEFT JOIN users cu2 ON cu2.id = cl.callee_id
		LEFT JOIN staff cc ON cc.user_id = cl.callee_id
		WHERE cl.id = $1::uuid`, id).Scan(
		&cl.ID, &cl.CallerID, &cl.CalleeID, &cl.ChannelID,
		&cl.CallType, &cl.Direction, &cl.Status, &cl.DurationSeconds,
		&cl.StartedAt, &cl.AnsweredAt, &cl.EndedAt,
		&cl.CallerName, &cl.CalleeName)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &cl, err
}

// UpdateCallLogStatus updates the status, duration, and timestamps of a call.
func (s *Store) UpdateCallLogStatus(ctx context.Context, id, status string, duration int, answeredAt, endedAt *time.Time) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE comms_call_logs SET status = $2, duration_seconds = $3, answered_at = $4, ended_at = $5
		WHERE id = $1::uuid`, id, status, duration, answeredAt, endedAt)
	return err
}

// ListCallLogs returns call logs for a user (both as caller and callee), newest first.
func (s *Store) ListCallLogs(ctx context.Context, userID string, limit, offset int) ([]domain.CallLog, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT cl.id::text, cl.caller_id::text, cl.callee_id::text, cl.channel_id::text,
		       cl.call_type, cl.direction, cl.status, cl.duration_seconds,
		       cl.started_at, cl.answered_at, cl.ended_at,
		       COALESCE(cs.first_name || ' ' || cs.last_name, cu.username, 'Unknown'),
		       COALESCE(cc.first_name || ' ' || cc.last_name, cu2.username, '')
		FROM comms_call_logs cl
		JOIN users cu ON cu.id = cl.caller_id
		LEFT JOIN staff cs ON cs.user_id = cl.caller_id
		LEFT JOIN users cu2 ON cu2.id = cl.callee_id
		LEFT JOIN staff cc ON cc.user_id = cl.callee_id
		WHERE cl.caller_id = $1::uuid OR cl.callee_id = $1::uuid
		ORDER BY cl.started_at DESC
		LIMIT $2 OFFSET $3`, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.CallLog
	for rows.Next() {
		var cl domain.CallLog
		if err := rows.Scan(
			&cl.ID, &cl.CallerID, &cl.CalleeID, &cl.ChannelID,
			&cl.CallType, &cl.Direction, &cl.Status, &cl.DurationSeconds,
			&cl.StartedAt, &cl.AnsweredAt, &cl.EndedAt,
			&cl.CallerName, &cl.CalleeName); err != nil {
			return nil, err
		}
		out = append(out, cl)
	}
	return out, rows.Err()
}

// ---- notification preferences ----

// GetNotificationPrefs returns the user's notification preferences.
func (s *Store) GetNotificationPrefs(ctx context.Context, userID string) (inApp, sound, desktop bool, err error) {
	err = s.pool.QueryRow(ctx, `
		SELECT in_app_enabled, sound_enabled, desktop_enabled
		FROM comms_notification_prefs WHERE user_id = $1::uuid`, userID).Scan(&inApp, &sound, &desktop)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, true, true, nil // defaults
	}
	return
}

// UpsertNotificationPrefs saves notification preferences.
func (s *Store) UpsertNotificationPrefs(ctx context.Context, userID string, inApp, sound, desktop bool) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO comms_notification_prefs (user_id, in_app_enabled, sound_enabled, desktop_enabled)
		VALUES ($1::uuid, $2, $3, $4)
		ON CONFLICT (user_id) DO UPDATE SET in_app_enabled = $2, sound_enabled = $3, desktop_enabled = $4`,
		userID, inApp, sound, desktop)
	return err
}

// ---- policy governance ----

// GetCommsPolicy returns the retention/audit notice and acknowledgement state.
func (s *Store) GetCommsPolicy(ctx context.Context, userID string) (*domain.CommsPolicy, error) {
	notice, err := s.getStringSetting(ctx, "comms.policy_notice", defaultCommsPolicyNotice)
	if err != nil {
		return nil, err
	}
	retention, err := s.getIntSetting(ctx, "comms.retention_days", 365)
	if err != nil {
		return nil, err
	}
	maxBytes, err := s.getInt64Setting(ctx, "comms.attachment_max_bytes", 5<<20)
	if err != nil {
		return nil, err
	}
	var ack bool
	if err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM comms_policy_acknowledgements WHERE user_id = $1::uuid)`,
		userID).Scan(&ack); err != nil {
		return nil, err
	}
	return &domain.CommsPolicy{
		Notice:             notice,
		RetentionDays:      retention,
		AttachmentMaxBytes: maxBytes,
		Acknowledged:       ack,
	}, nil
}

// AcknowledgeCommsPolicy records the user's acknowledgement of the policy.
func (s *Store) AcknowledgeCommsPolicy(ctx context.Context, userID string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO comms_policy_acknowledgements (user_id, acknowledged_at)
		VALUES ($1::uuid, now())
		ON CONFLICT (user_id) DO UPDATE SET acknowledged_at = now()`, userID)
	return err
}
