package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// ErrLicenseNotFound is returned when a license key is unknown or inactive.
var ErrLicenseNotFound = errors.New("license key not found")

// LicenseKeyCount returns the number of active license keys configured.
func (s *Store) LicenseKeyCount(ctx context.Context) (int64, error) {
	var n int64
	err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM license_keys WHERE active = TRUE`).Scan(&n)
	return n, err
}

// ValidateLicense returns the label for an active license key, or
// ErrLicenseNotFound if the key is unknown or inactive.
func (s *Store) ValidateLicense(ctx context.Context, key string) (string, error) {
	var label string
	err := s.pool.QueryRow(ctx, `SELECT label FROM license_keys WHERE key = $1 AND active = TRUE`, key).Scan(&label)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrLicenseNotFound
	}
	if err != nil {
		return "", err
	}
	return label, nil
}

// InsertLicense creates a license key if it does not already exist.
func (s *Store) InsertLicense(ctx context.Context, key, label string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO license_keys (key, label) VALUES ($1, $2)
		 ON CONFLICT (key) DO NOTHING`, key, label)
	return err
}
