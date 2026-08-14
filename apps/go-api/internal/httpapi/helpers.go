package httpapi

import (
	"context"
	"net/http"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

// isSuperAdmin reports whether the user holds the super_admin role.
func (s *server) isSuperAdmin(ctx context.Context, userID string) bool {
	roles, err := s.store.GetUserRoles(ctx, userID)
	if err != nil {
		return false
	}
	for _, r := range roles {
		if r.Code == "super_admin" {
			return true
		}
	}
	return false
}

// roleLabel returns a role snapshot for the authenticated user (e.g. for note
// author metadata).
func (s *server) roleLabel(r *http.Request) string {
	u := userFromContext(r.Context())
	if u == nil {
		return ""
	}
	roles, _ := s.store.GetUserRoles(r.Context(), u.ID)
	if len(roles) > 0 {
		return roles[0].Code
	}
	return ""
}

// recordAudit appends an audit entry, attributed to the authenticated user if present.
func (s *server) recordAudit(r *http.Request, action, resourceType, resourceID string, targetUserID *string, details map[string]any) {
	if s.store == nil {
		return
	}
	var actor *string
	if u := userFromContext(r.Context()); u != nil {
		actor = &u.ID
	}
	_ = s.store.InsertAuditLog(r.Context(), store.AuditParams{
		ActorUserID:  actor,
		Action:       action,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		TargetUserID: targetUserID,
		Details:      details,
		IPAddress:    clientIP(r),
		RequestID:    requestIDFromContext(r.Context()),
	})
}

// recordSecurity appends a security event.
func (s *server) recordSecurity(r *http.Request, userID *string, eventType string, metadata map[string]any) {
	if s.store == nil {
		return
	}
	_ = s.store.InsertSecurityEvent(r.Context(), userID, eventType, clientIP(r), r.UserAgent(), metadata)
}
