package httpapi

import (
	"context"
	"net/http"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
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

// displayName resolves a user's display name (staff name or username).
func (s *server) displayName(r *http.Request, userID string) string {
	if userID == "" {
		return ""
	}
	names, err := s.store.NamesByUserIDs(r.Context(), []string{userID})
	if err != nil {
		return ""
	}
	return names[userID]
}

// displayNames resolves display names for a list of author-bearing records.
// authors must be a slice of structs with an AuthorUserID field; the generic
// helper is only used with []domain.ClinicalNote here.
func (s *server) displayNames(r *http.Request, notes []domain.ClinicalNote) map[string]string {
	ids := make([]string, 0, len(notes))
	seen := map[string]bool{}
	for i := range notes {
		id := notes[i].AuthorUserID
		if id != "" && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	names, err := s.store.NamesByUserIDs(r.Context(), ids)
	if err != nil {
		return map[string]string{}
	}
	return names
}

// noteSignedNames resolves display names for note signers.
func (s *server) noteSignedNames(r *http.Request, notes []domain.ClinicalNote) map[string]string {
	ids := make([]string, 0)
	seen := map[string]bool{}
	for i := range notes {
		if notes[i].SignedBy == nil {
			continue
		}
		id := *notes[i].SignedBy
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	names, err := s.store.NamesByUserIDs(r.Context(), ids)
	if err != nil {
		return map[string]string{}
	}
	return names
}

// orderSignedNames resolves display names for order signers.
func (s *server) orderSignedNames(r *http.Request, orders []domain.Order) map[string]string {
	ids := make([]string, 0)
	seen := map[string]bool{}
	for i := range orders {
		if orders[i].SignedBy == nil {
			continue
		}
		id := *orders[i].SignedBy
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	names, err := s.store.NamesByUserIDs(r.Context(), ids)
	if err != nil {
		return map[string]string{}
	}
	return names
}

// orderDisplayNames resolves display names for order authors.
func (s *server) orderDisplayNames(r *http.Request, orders []domain.Order) map[string]string {
	ids := make([]string, 0, len(orders))
	seen := map[string]bool{}
	for i := range orders {
		id := orders[i].OrderedBy
		if id != "" && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	names, err := s.store.NamesByUserIDs(r.Context(), ids)
	if err != nil {
		return map[string]string{}
	}
	return names
}

// patientDisplayNames batch-loads patient names and patient numbers for a set of orders.
func (s *server) patientDisplayNames(r *http.Request, orders []domain.Order) (names, nos map[string]string) {
	names = map[string]string{}
	nos = map[string]string{}
	ids := make([]string, 0, len(orders))
	seen := map[string]bool{}
	for i := range orders {
		id := orders[i].PatientID
		if id != "" && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	for _, id := range ids {
		p, err := s.store.GetPatient(r.Context(), id)
		if err != nil {
			continue
		}
		names[id] = p.FirstName + " " + p.LastName
		nos[id] = p.PatientNo
	}
	return
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
