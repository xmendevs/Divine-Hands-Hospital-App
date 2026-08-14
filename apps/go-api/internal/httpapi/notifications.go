package httpapi

import (
	"errors"
	"net/http"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

type notificationResponse struct {
	ID          string  `json:"id"`
	Category    string  `json:"category"`
	Title       string  `json:"title"`
	Body        string  `json:"body,omitempty"`
	Link        string  `json:"link,omitempty"`
	Channel     string  `json:"channel"`
	EmailStatus string  `json:"emailStatus"`
	ReadAt      *string `json:"readAt,omitempty"`
	DeliveredAt *string `json:"deliveredAt,omitempty"`
	CreatedAt   string  `json:"createdAt"`
}

func newNotificationResponse(n *domain.Notification) notificationResponse {
	out := notificationResponse{
		ID:          n.ID,
		Category:    n.Category,
		Title:       n.Title,
		Body:        n.Body,
		Link:        n.Link,
		Channel:     n.Channel,
		EmailStatus: n.EmailStatus,
		CreatedAt:   n.CreatedAt.UTC().Format(timeRFC3339),
	}
	if n.ReadAt != nil {
		v := n.ReadAt.UTC().Format(timeRFC3339)
		out.ReadAt = &v
	}
	if n.DeliveredAt != nil {
		v := n.DeliveredAt.UTC().Format(timeRFC3339)
		out.DeliveredAt = &v
	}
	return out
}

// handleListNotifications lists the caller's notifications.
func (s *server) handleListNotifications(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	limit, offset := pagination(r)
	notifications, err := s.store.ListNotifications(r.Context(), store.ListNotificationsParams{
		UserID:     actor.ID,
		Category:   r.URL.Query().Get("category"),
		UnreadOnly: r.URL.Query().Get("unread") == "true",
		Limit:      limit,
		Offset:     offset,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]notificationResponse, 0, len(notifications))
	for i := range notifications {
		out = append(out, newNotificationResponse(&notifications[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

// handleUnreadNotificationCount returns the caller's unread notification count.
func (s *server) handleUnreadNotificationCount(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	n, err := s.store.UnreadNotificationCount(r.Context(), actor.ID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"unread": n})
}

// handleMarkNotificationRead marks one notification read.
func (s *server) handleMarkNotificationRead(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	id := r.PathValue("id")
	if err := s.store.MarkNotificationRead(r.Context(), id, actor.ID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "notification not found")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionNotificationRead, "notification", id, nil, nil)
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "read": true})
}

// handleMarkAllNotificationsRead marks all the caller's notifications read.
func (s *server) handleMarkAllNotificationsRead(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	if err := s.store.MarkAllNotificationsRead(r.Context(), actor.ID); err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionNotificationRead, "notification", "*", nil, nil)
	writeJSON(w, http.StatusOK, map[string]any{"read": true})
}

type sendNotificationRequest struct {
	UserIDs  []string `json:"userIds"`
	Category string   `json:"category"`
	Title    string   `json:"title"`
	Body     string   `json:"body"`
	Link     string   `json:"link"`
	Channel  string   `json:"channel"`
}

// handleSendNotification sends one notification to specific users.
func (s *server) handleSendNotification(w http.ResponseWriter, r *http.Request) {
	var req sendNotificationRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if len(req.UserIDs) == 0 || req.Category == "" || req.Title == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "userIds, category and title are required")
		return
	}
	switch req.Channel {
	case "", domain.NotificationChannelInApp:
		req.Channel = domain.NotificationChannelInApp
	case domain.NotificationChannelEmail, domain.NotificationChannelBoth:
	default:
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "channel must be in_app, email or both")
		return
	}
	n, err := s.store.CreateNotifications(r.Context(), req.UserIDs, req.Category, req.Title, req.Body, req.Link, req.Channel)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionNotificationSend, "notification", "*", nil, map[string]any{
		"category": req.Category, "channel": req.Channel, "count": n,
	})
	writeJSON(w, http.StatusCreated, map[string]any{"delivered": n})
}
