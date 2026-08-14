package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

func (s *Store) ListRoles(ctx context.Context) ([]domain.Role, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, code, name, description, mfa_required, is_system
		FROM roles ORDER BY code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []domain.Role
	for rows.Next() {
		var r domain.Role
		if err := rows.Scan(&r.ID, &r.Code, &r.Name, &r.Description, &r.MFARequired, &r.IsSystem); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) GetRoleByCode(ctx context.Context, code string) (*domain.Role, error) {
	return s.getRole(ctx, `WHERE code = $1`, code)
}

func (s *Store) GetRoleByID(ctx context.Context, id string) (*domain.Role, error) {
	return s.getRole(ctx, `WHERE id = $1::uuid`, id)
}

func (s *Store) getRole(ctx context.Context, where string, arg any) (*domain.Role, error) {
	var r domain.Role
	err := s.pool.QueryRow(ctx, `
		SELECT id::text, code, name, description, mfa_required, is_system
		FROM roles `+where, arg).
		Scan(&r.ID, &r.Code, &r.Name, &r.Description, &r.MFARequired, &r.IsSystem)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &r, err
}

// CreateRole creates a role and grants its permissions atomically.
func (s *Store) CreateRole(ctx context.Context, code, name, description string, mfaRequired bool, permissionCodes []string) (string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var id string
	err = tx.QueryRow(ctx, `
		INSERT INTO roles (code, name, description, mfa_required)
		VALUES ($1, $2, $3, $4) RETURNING id::text`,
		code, name, description, mfaRequired).Scan(&id)
	if err != nil {
		return "", err
	}
	for _, pc := range permissionCodes {
		if _, err := tx.Exec(ctx, `
			INSERT INTO role_permissions (role_id, permission_id)
			SELECT $1::uuid, id FROM permissions WHERE code = $2`,
			id, pc); err != nil {
			return "", err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return id, nil
}

// UpdateRole updates a role's mutable fields.
func (s *Store) UpdateRole(ctx context.Context, id, name, description string, mfaRequired bool) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE roles SET name = $2, description = $3, mfa_required = $4, updated_at = now()
		WHERE id = $1::uuid`, id, name, description, mfaRequired)
	return err
}

// SetRolePermissions replaces the permissions granted to a role.
func (s *Store) SetRolePermissions(ctx context.Context, roleID string, permissionCodes []string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, `DELETE FROM role_permissions WHERE role_id = $1::uuid`, roleID); err != nil {
		return err
	}
	for _, pc := range permissionCodes {
		if _, err := tx.Exec(ctx, `
			INSERT INTO role_permissions (role_id, permission_id)
			SELECT $1::uuid, id FROM permissions WHERE code = $2`,
			roleID, pc); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) ListPermissions(ctx context.Context) ([]domain.Permission, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, code, name, description, module
		FROM permissions ORDER BY module, code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []domain.Permission
	for rows.Next() {
		var p domain.Permission
		if err := rows.Scan(&p.ID, &p.Code, &p.Name, &p.Description, &p.Module); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) ListDepartments(ctx context.Context) ([]domain.Department, error) {
	rows, err := s.pool.Query(ctx, `SELECT id::text, code, name FROM departments ORDER BY code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []domain.Department
	for rows.Next() {
		var d domain.Department
		if err := rows.Scan(&d.ID, &d.Code, &d.Name); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (s *Store) CreateDepartment(ctx context.Context, code, name string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
		INSERT INTO departments (code, name) VALUES ($1, $2) RETURNING id::text`,
		code, name).Scan(&id)
	return id, err
}
