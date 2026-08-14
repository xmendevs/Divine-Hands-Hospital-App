package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

// CreateUserParams carries the fields for creating a user, staff profile, and
// role assignments atomically.
type CreateUserParams struct {
	Username           string
	Email              string
	PasswordHash       string
	Status             domain.UserStatus
	MustChangePassword bool
	EmployeeNo         string
	FirstName          string
	LastName           string
	JobTitle           string
	DepartmentID       *string
	RoleCodes          []string
	GrantedBy          string
}

// CreateUserAccount creates the user, staff profile, and role assignments in a
// single transaction.
func (s *Store) CreateUserAccount(ctx context.Context, p CreateUserParams) (string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // safe no-op after commit

	var userID string
	err = tx.QueryRow(ctx, `
		INSERT INTO users (username, email, password_hash, status, must_change_password)
		VALUES ($1, $2, $3, $4::user_status, $5)
		RETURNING id::text`,
		p.Username, p.Email, p.PasswordHash, string(p.Status), p.MustChangePassword).Scan(&userID)
	if err != nil {
		return "", err
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO staff (user_id, department_id, employee_no, first_name, last_name, job_title)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)`,
		userID, nullableUUID(p.DepartmentID), p.EmployeeNo, p.FirstName, p.LastName, p.JobTitle)
	if err != nil {
		return "", err
	}

	for _, code := range p.RoleCodes {
		_, err = tx.Exec(ctx, `
			INSERT INTO user_roles (user_id, role_id, granted_by)
			SELECT $1::uuid, id, $2::uuid FROM roles WHERE code = $3`,
			userID, nullableUUID(&p.GrantedBy), code)
		if err != nil {
			return "", err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return userID, nil
}

// GetUserByLogin returns a user by username or email.
func (s *Store) GetUserByLogin(ctx context.Context, login string) (*domain.User, error) {
	u, err := s.getUser(ctx, `WHERE username = $1 OR email = $1`, login)
	if err != nil {
		return nil, err
	}
	return u, nil
}

// GetUserByID returns a user by internal UUID.
func (s *Store) GetUserByID(ctx context.Context, id string) (*domain.User, error) {
	return s.getUser(ctx, `WHERE id = $1::uuid`, id)
}

func (s *Store) getUser(ctx context.Context, where string, arg any) (*domain.User, error) {
	var (
		u      domain.User
		status string
	)
	err := s.pool.QueryRow(ctx, `
		SELECT id::text, username, email, password_hash, status::text, must_change_password,
		       mfa_enabled, mfa_secret_encrypted, last_login_at, created_at, updated_at
		FROM users `+where,
		arg).Scan(
		&u.ID, &u.Username, &u.Email, &u.PasswordHash, &status, &u.MustChangePassword,
		&u.MFAEnabled, &u.MFASecretEncrypted, &u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	u.Status = domain.UserStatus(status)
	return &u, nil
}

// UserRow is a flat list view of a user with their staff profile.
type UserRow struct {
	ID         string
	Username   string
	Email      string
	Status     domain.UserStatus
	FirstName  string
	LastName   string
	EmployeeNo string
	CreatedAt  time.Time
}

// ListUsers returns all users with their staff profile, newest first.
func (s *Store) ListUsers(ctx context.Context) ([]UserRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT u.id::text, u.username, u.email, u.status::text, u.created_at,
		       COALESCE(st.first_name, ''), COALESCE(st.last_name, ''), COALESCE(st.employee_no, '')
		FROM users u
		LEFT JOIN staff st ON st.user_id = u.id
		ORDER BY u.created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []UserRow
	for rows.Next() {
		var (
			r      UserRow
			status string
		)
		if err := rows.Scan(&r.ID, &r.Username, &r.Email, &status, &r.CreatedAt,
			&r.FirstName, &r.LastName, &r.EmployeeNo); err != nil {
			return nil, err
		}
		r.Status = domain.UserStatus(status)
		out = append(out, r)
	}
	return out, rows.Err()
}

// SetUserStatus updates a user's activation status.
func (s *Store) SetUserStatus(ctx context.Context, id string, status domain.UserStatus) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE users SET status = $2::user_status, updated_at = now() WHERE id = $1::uuid`,
		id, string(status))
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// SetUserPassword updates the password hash and clears the forced-change flag.
func (s *Store) SetUserPassword(ctx context.Context, id, passwordHash string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE users SET password_hash = $2, must_change_password = FALSE,
		                 password_changed_at = now(), updated_at = now()
		WHERE id = $1::uuid`, id, passwordHash)
	return err
}

// UpdateUserEmail updates a user's email address.
func (s *Store) UpdateUserEmail(ctx context.Context, id, email string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE users SET email = $2, updated_at = now() WHERE id = $1::uuid`, id, email)
	return err
}

// SetUserMFA stores the encrypted TOTP secret and enabled flag.
func (s *Store) SetUserMFA(ctx context.Context, id string, secretEncrypted []byte, enabled bool) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE users SET mfa_secret_encrypted = $2, mfa_enabled = $3,
		                 mfa_enrolled_at = now(), updated_at = now()
		WHERE id = $1::uuid`, id, secretEncrypted, enabled)
	return err
}

// UpdateLastLogin records a successful login timestamp.
func (s *Store) UpdateLastLogin(ctx context.Context, id string) error {
	_, err := s.pool.Exec(ctx, `UPDATE users SET last_login_at = now() WHERE id = $1::uuid`, id)
	return err
}

// GetStaffByUserID returns a user's staff profile.
func (s *Store) GetStaffByUserID(ctx context.Context, userID string) (*domain.Staff, error) {
	var st domain.Staff
	err := s.pool.QueryRow(ctx, `
		SELECT id::text, user_id::text, department_id::text, employee_no, first_name, last_name, job_title
		FROM staff WHERE user_id = $1::uuid`, userID).
		Scan(&st.ID, &st.UserID, &st.DepartmentID, &st.EmployeeNo, &st.FirstName, &st.LastName, &st.JobTitle)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &st, err
}

// UpdateStaff updates a user's staff profile fields.
func (s *Store) UpdateStaff(ctx context.Context, userID string, departmentID *string, firstName, lastName, jobTitle string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE staff SET department_id = $2::uuid, first_name = $3, last_name = $4,
		                 job_title = $5, updated_at = now()
		WHERE user_id = $1::uuid`,
		userID, nullableUUID(departmentID), firstName, lastName, jobTitle)
	return err
}

// ReplaceUserRoles sets the user's roles to exactly the given codes.
func (s *Store) ReplaceUserRoles(ctx context.Context, userID string, roleCodes []string, grantedBy string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, `DELETE FROM user_roles WHERE user_id = $1::uuid`, userID); err != nil {
		return err
	}
	for _, code := range roleCodes {
		if _, err := tx.Exec(ctx, `
			INSERT INTO user_roles (user_id, role_id, granted_by)
			SELECT $1::uuid, id, $2::uuid FROM roles WHERE code = $3`,
			userID, nullableUUID(&grantedBy), code); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// GetUserRoles returns the roles assigned to a user.
func (s *Store) GetUserRoles(ctx context.Context, userID string) ([]domain.Role, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT r.id::text, r.code, r.name, r.description, r.mfa_required, r.is_system
		FROM user_roles ur JOIN roles r ON r.id = ur.role_id
		WHERE ur.user_id = $1::uuid
		ORDER BY r.code`, userID)
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

// GetUserPermissions returns the distinct permission codes granted to a user.
func (s *Store) GetUserPermissions(ctx context.Context, userID string) ([]string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT DISTINCT p.code
		FROM user_roles ur
		JOIN role_permissions rp ON rp.role_id = ur.role_id
		JOIN permissions p ON p.id = rp.permission_id
		WHERE ur.user_id = $1::uuid
		ORDER BY p.code`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			return nil, err
		}
		out = append(out, code)
	}
	return out, rows.Err()
}

// UserHasPermission reports whether the user holds the permission directly or
// via the super_admin role.
func (s *Store) UserHasPermission(ctx context.Context, userID, code string) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM user_roles ur
			JOIN roles r ON r.id = ur.role_id
			LEFT JOIN role_permissions rp ON rp.role_id = r.id
			LEFT JOIN permissions p ON p.id = rp.permission_id
			WHERE ur.user_id = $1::uuid AND (r.code = 'super_admin' OR p.code = $2)
		)`, userID, code).Scan(&ok)
	return ok, err
}

// UserHasPrivilegedRole reports whether the user holds any role that requires MFA.
func (s *Store) UserHasPrivilegedRole(ctx context.Context, userID string) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
			WHERE ur.user_id = $1::uuid AND r.mfa_required = TRUE
		)`, userID).Scan(&ok)
	return ok, err
}
