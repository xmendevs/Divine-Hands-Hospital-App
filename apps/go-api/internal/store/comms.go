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
	m.body, m.created_at,
	COALESCE(sst.first_name || ' ' || sst.last_name, ''), su.username,
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
		&m.Body, &m.CreatedAt, &m.SenderName, &m.SenderUsername,
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
	Attachments []domain.MessageAttachment
}

// sendMessage inserts a message and its attachments.
func (s *Store) sendMessage(ctx context.Context, p SendMessageParams) (*domain.Message, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var id string
	if err := tx.QueryRow(ctx, `
		INSERT INTO comms_messages (kind, sender_id, recipient_id, channel_id, body)
		VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5)
		RETURNING id::text`,
		p.Kind, p.SenderID, nullableUUID(p.RecipientID), nullableUUID(p.ChannelID), p.Body).Scan(&id); err != nil {
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
func (s *Store) CreateAnnouncement(ctx context.Context, senderID string, channelID *string, body string) (*domain.Message, error) {
	return s.sendMessage(ctx, SendMessageParams{
		Kind:      domain.MessageKindAnnouncement,
		SenderID:  senderID,
		ChannelID: channelID,
		Body:      body,
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
