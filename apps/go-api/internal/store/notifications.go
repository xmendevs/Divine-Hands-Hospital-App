package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

const notificationCols = `id::text, user_id::text, category, title, body, link, channel, email_status, read_at, delivered_at, created_at`

func scanNotification(r pgx.Row) (*domain.Notification, error) {
	var n domain.Notification
	err := r.Scan(&n.ID, &n.UserID, &n.Category, &n.Title, &n.Body, &n.Link,
		&n.Channel, &n.EmailStatus, &n.ReadAt, &n.DeliveredAt, &n.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &n, nil
}

type CreateNotificationParams struct {
	UserID   string
	Category string
	Title    string
	Body     string
	Link     string
	Channel  string
}

// CreateNotification inserts one notification. Email channels are marked
// pending so a mail transport worker can pick them up.
func (s *Store) CreateNotification(ctx context.Context, p CreateNotificationParams) (*domain.Notification, error) {
	n, err := scanNotification(s.pool.QueryRow(ctx, `
		INSERT INTO notifications (user_id, category, title, body, link, channel, email_status)
		VALUES ($1::uuid, $2, $3, $4, $5, $6,
		        CASE WHEN $6 IN ('email','both') THEN 'pending' ELSE 'none' END)
		RETURNING `+notificationCols,
		p.UserID, p.Category, p.Title, p.Body, p.Link, p.Channel))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return n, err
}

// CreateNotifications fans out one notification to the given users.
func (s *Store) CreateNotifications(ctx context.Context, userIDs []string, category, title, body, link, channel string) (int, error) {
	if len(userIDs) == 0 {
		return 0, nil
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	for _, uid := range userIDs {
		if _, err := tx.Exec(ctx, `
			INSERT INTO notifications (user_id, category, title, body, link, channel, email_status)
			VALUES ($1::uuid, $2, $3, $4, $5, $6,
			        CASE WHEN $6 IN ('email','both') THEN 'pending' ELSE 'none' END)`,
			uid, category, title, body, link, channel); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(userIDs), nil
}

// BroadcastToActiveUsers fans a notification out to every active user.
func (s *Store) BroadcastToActiveUsers(ctx context.Context, category, title, body, link, channel string) (int64, error) {
	ct, err := s.pool.Exec(ctx, `
		INSERT INTO notifications (user_id, category, title, body, link, channel, email_status)
		SELECT id, $1, $2, $3, $4, $5,
		       CASE WHEN $5 IN ('email','both') THEN 'pending' ELSE 'none' END
		FROM users WHERE status = 'active'`, category, title, body, link, channel)
	if err != nil {
		return 0, err
	}
	return ct.RowsAffected(), nil
}

// BroadcastToChannelMembers fans a notification out to a channel's members.
func (s *Store) BroadcastToChannelMembers(ctx context.Context, channelID, category, title, body, link, channel string) (int64, error) {
	ct, err := s.pool.Exec(ctx, `
		INSERT INTO notifications (user_id, category, title, body, link, channel, email_status)
		SELECT cm.user_id, $2, $3, $4, $5, $6,
		       CASE WHEN $6 IN ('email','both') THEN 'pending' ELSE 'none' END
		FROM comms_channel_members cm WHERE cm.channel_id = $1::uuid`,
		channelID, category, title, body, link, channel)
	if err != nil {
		return 0, err
	}
	return ct.RowsAffected(), nil
}

type ListNotificationsParams struct {
	UserID     string
	Category   string
	UnreadOnly bool
	Limit      int
	Offset     int
}

// ListNotifications returns a user's notifications, newest first.
func (s *Store) ListNotifications(ctx context.Context, p ListNotificationsParams) ([]domain.Notification, error) {
	q := `SELECT ` + notificationCols + ` FROM notifications WHERE user_id = $1::uuid`
	args := []any{p.UserID}
	if p.Category != "" {
		args = append(args, p.Category)
		q += ` AND category = $` + itoa(len(args))
	}
	if p.UnreadOnly {
		q += ` AND read_at IS NULL`
	}
	q += ` ORDER BY created_at DESC LIMIT $` + itoa(len(args)+1) + ` OFFSET $` + itoa(len(args)+2)
	args = append(args, p.Limit, p.Offset)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []domain.Notification{}
	for rows.Next() {
		n, err := scanNotification(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *n)
	}
	return out, rows.Err()
}

// UnreadNotificationCount returns the number of unread notifications.
func (s *Store) UnreadNotificationCount(ctx context.Context, userID string) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
		SELECT count(*)::int FROM notifications WHERE user_id = $1::uuid AND read_at IS NULL`, userID).Scan(&n)
	return n, err
}

// MarkNotificationRead marks one of the user's notifications read.
func (s *Store) MarkNotificationRead(ctx context.Context, id, userID string) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE notifications SET read_at = now() WHERE id = $1::uuid AND user_id = $2::uuid AND read_at IS NULL`,
		id, userID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// MarkAllNotificationsRead marks every notification for the user read.
func (s *Store) MarkAllNotificationsRead(ctx context.Context, userID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE notifications SET read_at = now() WHERE user_id = $1::uuid AND read_at IS NULL`, userID)
	return err
}
