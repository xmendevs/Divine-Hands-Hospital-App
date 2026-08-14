package httpapi

import (
	"net/http"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

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
