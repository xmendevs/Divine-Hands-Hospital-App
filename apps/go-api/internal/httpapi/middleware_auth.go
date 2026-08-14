package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/auth"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

const (
	userKey    contextKey = "user"
	sessionKey contextKey = "session"
)

func userFromContext(ctx context.Context) *domain.User {
	if u, ok := ctx.Value(userKey).(*domain.User); ok {
		return u
	}
	return nil
}

func sessionFromContext(ctx context.Context) *domain.Session {
	if s, ok := ctx.Value(sessionKey).(*domain.Session); ok {
		return s
	}
	return nil
}

// requireAuth authenticates the bearer token and attaches the user and session
// to the request context.
func (s *server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.store == nil {
			writeError(w, r, http.StatusServiceUnavailable, "unavailable", "database unavailable")
			return
		}
		u, sess, err := s.authenticate(r)
		if err != nil {
			writeError(w, r, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}
		ctx := context.WithValue(r.Context(), userKey, u)
		ctx = context.WithValue(ctx, sessionKey, sess)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// authenticate resolves and validates the bearer token into a user and session.
func (s *server) authenticate(r *http.Request) (*domain.User, *domain.Session, error) {
	authz := r.Header.Get("Authorization")
	token := strings.TrimPrefix(authz, "Bearer ")
	if token == "" || token == authz {
		return nil, nil, errors.New("missing bearer token")
	}

	sess, err := s.store.GetSessionByTokenHash(r.Context(), auth.HashToken(token))
	if err != nil {
		return nil, nil, err
	}
	if sess.RevokedAt != nil || time.Now().After(sess.ExpiresAt) {
		return nil, nil, errors.New("session expired or revoked")
	}

	u, err := s.store.GetUserByID(r.Context(), sess.UserID)
	if err != nil {
		return nil, nil, err
	}
	if u.Status != domain.UserStatusActive {
		return nil, nil, errors.New("account not active")
	}

	_ = s.store.TouchSession(r.Context(), sess.ID)
	return u, sess, nil
}

// requirePermission enforces a permission on the authenticated user.
func (s *server) requirePermission(code string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := userFromContext(r.Context())
		if u == nil {
			writeError(w, r, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}
		ok, err := s.store.UserHasPermission(r.Context(), u.ID, code)
		if err != nil || !ok {
			writeError(w, r, http.StatusForbidden, "forbidden", "insufficient permissions")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// admin chains requireAuth + requirePermission for admin endpoints.
func (s *server) admin(perm string, h http.HandlerFunc) http.Handler {
	return s.requireAuth(s.requirePermission(perm, h))
}
