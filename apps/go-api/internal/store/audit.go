package store

import (
	"context"
	"encoding/json"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

// AuditParams describes an audit log entry.
type AuditParams struct {
	ActorUserID  *string
	Action       string
	ResourceType string
	ResourceID   string
	TargetUserID *string
	Details      map[string]any
	IPAddress    string
	RequestID    string
}

// InsertAuditLog appends an audit entry. audit_logs is append-only at the
// database level (a trigger rejects UPDATE/DELETE).
func (s *Store) InsertAuditLog(ctx context.Context, p AuditParams) error {
	b, _ := json.Marshal(p.Details)
	if p.Details == nil {
		b = []byte("{}")
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, target_user_id, details, ip_address, request_id)
		VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6::jsonb, $7, $8)`,
		nullableUUID(p.ActorUserID), p.Action, p.ResourceType, p.ResourceID,
		nullableUUID(p.TargetUserID), b, p.IPAddress, p.RequestID)
	return err
}

// ListAuditLogs returns audit entries, newest first.
func (s *Store) ListAuditLogs(ctx context.Context, limit, offset int) ([]domain.AuditLog, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, actor_user_id::text, action, resource_type, resource_id,
		       target_user_id::text, details, ip_address, request_id, created_at
		FROM audit_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []domain.AuditLog
	for rows.Next() {
		var a domain.AuditLog
		if err := rows.Scan(&a.ID, &a.ActorUserID, &a.Action, &a.ResourceType, &a.ResourceID,
			&a.TargetUserID, &a.Details, &a.IPAddress, &a.RequestID, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ListSettings returns all system settings.
func (s *Store) ListSettings(ctx context.Context) ([]domain.Setting, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT key, value, description, updated_by::text, updated_at
		FROM system_settings ORDER BY key`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []domain.Setting
	for rows.Next() {
		var st domain.Setting
		if err := rows.Scan(&st.Key, &st.Value, &st.Description, &st.UpdatedBy, &st.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, st)
	}
	return out, rows.Err()
}

// GetSettingsMap returns all system settings as a key → JSON value map.
func (s *Store) GetSettingsMap(ctx context.Context) (map[string]json.RawMessage, error) {
	rows, err := s.pool.Query(ctx, `SELECT key, value FROM system_settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]json.RawMessage)
	for rows.Next() {
		var k string
		var v json.RawMessage
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

// SetSetting upserts a system setting.
func (s *Store) SetSetting(ctx context.Context, key string, value any, updatedBy *string) error {
	b, _ := json.Marshal(value)
	_, err := s.pool.Exec(ctx, `
		INSERT INTO system_settings (key, value, updated_by, updated_at)
		VALUES ($1, $2::jsonb, $3::uuid, now())
		ON CONFLICT (key) DO UPDATE
		SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
		key, b, nullableUUID(updatedBy))
	return err
}
