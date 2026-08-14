package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

// CreateSession inserts a new session and returns its internal ID.
func (s *Store) CreateSession(ctx context.Context, userID, tokenHash, ip, userAgent, device string, expiresAt time.Time) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO sessions (user_id, token_hash, ip_address, user_agent, device_name, expires_at)
		VALUES ($1::uuid, $2, $3, $4, $5, $6)
		RETURNING id::text`,
		userID, tokenHash, ip, userAgent, device, expiresAt).Scan(&id)
	return id, err
}

// GetSessionByTokenHash returns the session matching a token hash.
func (s *Store) GetSessionByTokenHash(ctx context.Context, tokenHash string) (*domain.Session, error) {
	var sess domain.Session
	err := s.pool.QueryRow(ctx, `
		SELECT id::text, user_id::text, token_hash, ip_address, user_agent, device_name,
		       created_at, last_seen_at, expires_at, revoked_at
		FROM sessions WHERE token_hash = $1`, tokenHash).
		Scan(&sess.ID, &sess.UserID, &sess.TokenHash, &sess.IPAddress, &sess.UserAgent,
			&sess.DeviceName, &sess.CreatedAt, &sess.LastSeenAt, &sess.ExpiresAt, &sess.RevokedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &sess, err
}

// RevokeSession revokes a session by ID.
func (s *Store) RevokeSession(ctx context.Context, id string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE sessions SET revoked_at = now() WHERE id = $1::uuid AND revoked_at IS NULL`, id)
	return err
}

// RevokeUserSessionsExcept revokes all of a user's sessions except the given one.
func (s *Store) RevokeUserSessionsExcept(ctx context.Context, userID, exceptID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE sessions SET revoked_at = now()
		WHERE user_id = $1::uuid AND id <> $2::uuid AND revoked_at IS NULL`, userID, exceptID)
	return err
}

// TouchSession updates the session's last-seen timestamp.
func (s *Store) TouchSession(ctx context.Context, id string) error {
	_, err := s.pool.Exec(ctx, `UPDATE sessions SET last_seen_at = now() WHERE id = $1::uuid`, id)
	return err
}

// InsertSecurityEvent records an authentication/security event.
func (s *Store) InsertSecurityEvent(ctx context.Context, userID *string, eventType, ip, userAgent string, metadata map[string]any) error {
	b, _ := json.Marshal(metadata)
	_, err := s.pool.Exec(ctx, `
		INSERT INTO security_events (user_id, event_type, ip_address, user_agent, metadata)
		VALUES ($1::uuid, $2, $3, $4, $5::jsonb)`,
		nullableUUID(userID), eventType, ip, userAgent, b)
	return err
}

// PasswordResetToken is a stored password-reset record.
type PasswordResetToken struct {
	ID        string
	UserID    string
	ExpiresAt time.Time
	UsedAt    *time.Time
	CreatedAt time.Time
}

// CreatePasswordResetToken stores a hashed reset token.
func (s *Store) CreatePasswordResetToken(ctx context.Context, userID, tokenHash string, expiresAt time.Time) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
		VALUES ($1::uuid, $2, $3)`, userID, tokenHash, expiresAt)
	return err
}

// GetPasswordResetToken returns a reset token by its hash.
func (s *Store) GetPasswordResetToken(ctx context.Context, tokenHash string) (*PasswordResetToken, error) {
	var t PasswordResetToken
	err := s.pool.QueryRow(ctx, `
		SELECT id::text, user_id::text, expires_at, used_at, created_at
		FROM password_reset_tokens WHERE token_hash = $1`, tokenHash).
		Scan(&t.ID, &t.UserID, &t.ExpiresAt, &t.UsedAt, &t.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &t, err
}

// MarkPasswordResetUsed marks a reset token as consumed.
func (s *Store) MarkPasswordResetUsed(ctx context.Context, id string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE password_reset_tokens SET used_at = now() WHERE id = $1::uuid`, id)
	return err
}

// RevokeAllUserSessions revokes every active session for a user.
func (s *Store) RevokeAllUserSessions(ctx context.Context, userID string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE sessions SET revoked_at = now()
		WHERE user_id = $1::uuid AND revoked_at IS NULL`, userID)
	return err
}
