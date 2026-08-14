// Package store provides PostgreSQL persistence for the core service.
package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when a lookup finds no matching row.
var ErrNotFound = errors.New("not found")

// Store wraps the PostgreSQL connection pool.
type Store struct {
	pool *pgxpool.Pool
}

// New connects to PostgreSQL and verifies connectivity.
func New(ctx context.Context, databaseURL string) (*Store, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &Store{pool: pool}, nil
}

// Close releases the connection pool.
func (s *Store) Close() { s.pool.Close() }

// Ping verifies database connectivity.
func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

// nullableUUID returns nil for empty pointers and the string otherwise, so it
// can be used with a `$n::uuid` cast in SQL.
func nullableUUID(s *string) any {
	if s == nil || *s == "" {
		return nil
	}
	return *s
}
