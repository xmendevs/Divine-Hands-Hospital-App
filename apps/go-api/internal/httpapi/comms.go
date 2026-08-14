package httpapi

import (
	"errors"
	"net/http"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

type channelResponse struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Type           string  `json:"type"`
	DepartmentID   *string `json:"departmentId,omitempty"`
	ShiftID        *string `json:"shiftId,omitempty"`
	DepartmentName string  `json:"departmentName,omitempty"`
	ShiftName      string  `json:"shiftName,omitempty"`
	Description    string  `json:"description,omitempty"`
	CreatedBy      string  `json:"createdBy"`
	CreatedAt      string  `json:"createdAt"`
	MemberCount    int     `json:"memberCount"`
	IsMember       bool    `json:"isMember"`
}

func newChannelResponse(c *domain.CommsChannel) channelResponse {
	return channelResponse{
		ID:             c.ID,
		Name:           c.Name,
		Type:           c.Type,
		DepartmentID:   c.DepartmentID,
		ShiftID:        c.ShiftID,
		DepartmentName: c.DepartmentName,
		ShiftName:      c.ShiftName,
		Description:    c.Description,
		CreatedBy:      c.CreatedBy,
		CreatedAt:      c.CreatedAt.UTC().Format(timeRFC3339),
		MemberCount:    c.MemberCount,
		IsMember:       c.IsMember,
	}
}

type channelMemberResponse struct {
	ID         string  `json:"id"`
	UserID     string  `json:"userId"`
	Username   string  `json:"username"`
	StaffName  string  `json:"staffName,omitempty"`
	EmployeeNo string  `json:"employeeNo,omitempty"`
	AddedBy    *string `json:"addedBy,omitempty"`
	AddedAt    string  `json:"addedAt"`
}

func newChannelMemberResponse(m *domain.CommsChannelMember) channelMemberResponse {
	return channelMemberResponse{
		ID:         m.ID,
		UserID:     m.UserID,
		Username:   m.Username,
		StaffName:  m.StaffName,
		EmployeeNo: m.EmployeeNo,
		AddedBy:    m.AddedBy,
		AddedAt:    m.AddedAt.UTC().Format(timeRFC3339),
	}
}

type channelDetailResponse struct {
	channelResponse
	Members []channelMemberResponse `json:"members"`
}

type attachmentResponse struct {
	ID         string `json:"id"`
	FileName   string `json:"fileName"`
	MimeType   string `json:"mimeType"`
	SizeBytes  int64  `json:"sizeBytes"`
	StorageRef string `json:"storageRef,omitempty"`
}

type messageResponse struct {
	ID             string               `json:"id"`
	Kind           string               `json:"kind"`
	SenderID       string               `json:"senderId"`
	SenderName     string               `json:"senderName,omitempty"`
	SenderUsername string               `json:"senderUsername,omitempty"`
	RecipientID    *string              `json:"recipientId,omitempty"`
	RecipientName  string               `json:"recipientName,omitempty"`
	ChannelID      *string              `json:"channelId,omitempty"`
	ChannelName    string               `json:"channelName,omitempty"`
	Body           string               `json:"body"`
	CreatedAt      string               `json:"createdAt"`
	Attachments    []attachmentResponse `json:"attachments"`
}

func newMessageResponse(m *domain.Message) messageResponse {
	out := messageResponse{
		ID:             m.ID,
		Kind:           m.Kind,
		SenderID:       m.SenderID,
		SenderName:     m.SenderName,
		SenderUsername: m.SenderUsername,
		RecipientID:    m.RecipientID,
		RecipientName:  m.RecipientName,
		ChannelID:      m.ChannelID,
		ChannelName:    m.ChannelName,
		Body:           m.Body,
		CreatedAt:      m.CreatedAt.UTC().Format(timeRFC3339),
		Attachments:    []attachmentResponse{},
	}
	for _, a := range m.Attachments {
		out.Attachments = append(out.Attachments, attachmentResponse{
			ID: a.ID, FileName: a.FileName, MimeType: a.MimeType,
			SizeBytes: a.SizeBytes, StorageRef: a.StorageRef,
		})
	}
	return out
}

type createChannelRequest struct {
	Name         string `json:"name"`
	Type         string `json:"type"`
	DepartmentID string `json:"departmentId"`
	ShiftID      string `json:"shiftId"`
	Description  string `json:"description"`
}

// handleCreateChannel creates a department or shift channel.
func (s *server) handleCreateChannel(w http.ResponseWriter, r *http.Request) {
	var req createChannelRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Name == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "name is required")
		return
	}
	var deptID, shiftID *string
	switch req.Type {
	case domain.CommsChannelDepartment:
		if req.DepartmentID == "" {
			writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "departmentId is required for department channels")
			return
		}
		deptID = &req.DepartmentID
	case domain.CommsChannelShift:
		if req.ShiftID == "" {
			writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "shiftId is required for shift channels")
			return
		}
		shiftID = &req.ShiftID
	default:
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "type must be department or shift")
		return
	}
	actor := userFromContext(r.Context())
	c, err := s.store.CreateChannel(r.Context(), store.CreateChannelParams{
		Name:         req.Name,
		Type:         req.Type,
		DepartmentID: deptID,
		ShiftID:      shiftID,
		Description:  req.Description,
		CreatedBy:    actor.ID,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionCommsChannelCreate, "comms_channel", c.ID, nil, map[string]any{"type": c.Type})
	writeJSON(w, http.StatusCreated, newChannelResponse(c))
}

// handleListChannels lists all channels with the caller's membership flags.
func (s *server) handleListChannels(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	channels, err := s.store.ListChannels(r.Context(), actor.ID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]channelResponse, 0, len(channels))
	for i := range channels {
		out = append(out, newChannelResponse(&channels[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

// handleGetChannel returns one channel with its members.
func (s *server) handleGetChannel(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	c, err := s.store.GetChannel(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "channel not found")
		return
	}
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	members, err := s.store.ListChannelMembers(r.Context(), id)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := channelDetailResponse{channelResponse: newChannelResponse(c), Members: []channelMemberResponse{}}
	for i := range members {
		out.Members = append(out.Members, newChannelMemberResponse(&members[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

type addChannelMemberRequest struct {
	UserID string `json:"userId"`
}

// handleAddChannelMember adds a user to a channel.
func (s *server) handleAddChannelMember(w http.ResponseWriter, r *http.Request) {
	var req addChannelMemberRequest
	if err := decodeJSON(r, &req); err != nil || req.UserID == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "userId is required")
		return
	}
	actor := userFromContext(r.Context())
	id := r.PathValue("id")
	if err := s.store.AddChannelMember(r.Context(), id, req.UserID, actor.ID); err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionCommsMemberAdd, "comms_channel", id, &req.UserID, nil)
	writeJSON(w, http.StatusCreated, map[string]any{"channelId": id, "userId": req.UserID})
}

// handleRemoveChannelMember removes a user from a channel.
func (s *server) handleRemoveChannelMember(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	userID := r.PathValue("userId")
	if err := s.store.RemoveChannelMember(r.Context(), id, userID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "membership not found")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionCommsMemberRemove, "comms_channel", id, &userID, nil)
	w.WriteHeader(http.StatusNoContent)
}

// validateAttachments checks attachments against the attachment policy.
func (s *server) validateAttachments(w http.ResponseWriter, r *http.Request, inputs []attachmentInput) ([]domain.MessageAttachment, bool) {
	if len(inputs) == 0 {
		return nil, true
	}
	actor := userFromContext(r.Context())
	policy, err := s.store.GetCommsPolicy(r.Context(), actor.ID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return nil, false
	}
	out := make([]domain.MessageAttachment, 0, len(inputs))
	for _, in := range inputs {
		if in.FileName == "" {
			writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "attachment fileName is required")
			return nil, false
		}
		if in.SizeBytes < 0 || (policy.AttachmentMaxBytes > 0 && in.SizeBytes > policy.AttachmentMaxBytes) {
			writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "attachment exceeds the allowed size")
			return nil, false
		}
		mime := in.MimeType
		if mime == "" {
			mime = "application/octet-stream"
		}
		out = append(out, domain.MessageAttachment{
			FileName: in.FileName, MimeType: mime, SizeBytes: in.SizeBytes, StorageRef: in.StorageRef,
		})
	}
	return out, true
}

type attachmentInput struct {
	FileName   string `json:"fileName"`
	MimeType   string `json:"mimeType"`
	SizeBytes  int64  `json:"sizeBytes"`
	StorageRef string `json:"storageRef"`
}

type sendDirectMessageRequest struct {
	RecipientID string            `json:"recipientId"`
	Body        string            `json:"body"`
	Attachments []attachmentInput `json:"attachments"`
}

// handleSendDirectMessage sends a direct message and notifies the recipient.
func (s *server) handleSendDirectMessage(w http.ResponseWriter, r *http.Request) {
	var req sendDirectMessageRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.RecipientID == "" || req.Body == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "recipientId and body are required")
		return
	}
	atts, ok := s.validateAttachments(w, r, req.Attachments)
	if !ok {
		return
	}
	actor := userFromContext(r.Context())
	m, err := s.store.SendDirectMessage(r.Context(), actor.ID, req.RecipientID, req.Body, atts)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	// Deliver an in-app notification so the recipient sees the message alert.
	_, _ = s.store.CreateNotification(r.Context(), store.CreateNotificationParams{
		UserID:   req.RecipientID,
		Category: domain.NotificationCategoryMessage,
		Title:    "New message from " + m.SenderName,
		Body:     req.Body,
		Link:     "/communications/messages?recipientId=" + actor.ID,
		Channel:  domain.NotificationChannelInApp,
	})
	s.recordAudit(r, domain.ActionCommsMessageSend, "comms_message", m.ID, &req.RecipientID, map[string]any{"kind": "direct"})
	writeJSON(w, http.StatusCreated, newMessageResponse(m))
}

// handleListDirectMessages returns the thread between the caller and a peer.
func (s *server) handleListDirectMessages(w http.ResponseWriter, r *http.Request) {
	recipientID := r.URL.Query().Get("recipientId")
	if recipientID == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "recipientId is required")
		return
	}
	actor := userFromContext(r.Context())
	limit, offset := pagination(r)
	msgs, err := s.store.ListDirectMessages(r.Context(), actor.ID, recipientID, limit, offset)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]messageResponse, 0, len(msgs))
	for i := range msgs {
		out = append(out, newMessageResponse(&msgs[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

type sendChannelMessageRequest struct {
	Body        string            `json:"body"`
	Attachments []attachmentInput `json:"attachments"`
}

// handleSendChannelMessage sends a message to a channel the caller belongs to.
func (s *server) handleSendChannelMessage(w http.ResponseWriter, r *http.Request) {
	var req sendChannelMessageRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Body == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "body is required")
		return
	}
	atts, ok := s.validateAttachments(w, r, req.Attachments)
	if !ok {
		return
	}
	actor := userFromContext(r.Context())
	id := r.PathValue("id")
	m, err := s.store.SendChannelMessage(r.Context(), id, actor.ID, req.Body, atts)
	if err != nil {
		if errors.Is(err, store.ErrNotChannelMember) {
			writeError(w, r, http.StatusForbidden, "forbidden", "not a member of this channel")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionCommsMessageSend, "comms_message", m.ID, nil, map[string]any{"kind": "channel", "channelId": id})
	writeJSON(w, http.StatusCreated, newMessageResponse(m))
}

// handleListChannelMessages lists a channel's messages. Non-members are
// rejected unless they hold comms.admin, in which case the access is audited.
func (s *server) handleListChannelMessages(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	id := r.PathValue("id")
	if _, err := s.store.GetChannel(r.Context(), id); errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "channel not found")
		return
	}
	isMember, err := s.store.IsChannelMember(r.Context(), id, actor.ID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	if !isMember {
		ok, _ := s.store.UserHasPermission(r.Context(), actor.ID, "comms.admin")
		if !ok {
			writeError(w, r, http.StatusForbidden, "forbidden", "not a member of this channel")
			return
		}
		s.recordAudit(r, domain.ActionCommsAdminAccess, "comms_channel", id, nil, map[string]any{"reason": "read channel messages"})
	}
	limit, offset := pagination(r)
	msgs, err := s.store.ListChannelMessages(r.Context(), id, limit, offset)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]messageResponse, 0, len(msgs))
	for i := range msgs {
		out = append(out, newMessageResponse(&msgs[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

type announcementRequest struct {
	Body      string `json:"body"`
	ChannelID string `json:"channelId"`
}

// handleCreateAnnouncement posts an announcement (global or channel-scoped).
func (s *server) handleCreateAnnouncement(w http.ResponseWriter, r *http.Request) {
	var req announcementRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Body == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "body is required")
		return
	}
	actor := userFromContext(r.Context())
	var channelID *string
	if req.ChannelID != "" {
		channelID = &req.ChannelID
	}
	m, err := s.store.CreateAnnouncement(r.Context(), actor.ID, channelID, req.Body)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	// Fan out the announcement as a notification.
	if channelID != nil {
		_, _ = s.store.BroadcastToChannelMembers(r.Context(), *channelID,
			domain.NotificationCategoryAnnouncement, "Announcement", req.Body, "", domain.NotificationChannelInApp)
	} else {
		_, _ = s.store.BroadcastToActiveUsers(r.Context(),
			domain.NotificationCategoryAnnouncement, "Announcement", req.Body, "", domain.NotificationChannelInApp)
	}
	s.recordAudit(r, domain.ActionCommsAnnouncementPost, "comms_message", m.ID, nil, map[string]any{"channelId": req.ChannelID})
	writeJSON(w, http.StatusCreated, newMessageResponse(m))
}

// handleListAnnouncements lists announcements visible to the caller.
func (s *server) handleListAnnouncements(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	limit, offset := pagination(r)
	msgs, err := s.store.ListAnnouncements(r.Context(), actor.ID, limit, offset)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]messageResponse, 0, len(msgs))
	for i := range msgs {
		out = append(out, newMessageResponse(&msgs[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

type commsPolicyResponse struct {
	Notice             string `json:"notice"`
	RetentionDays      int    `json:"retentionDays"`
	AttachmentMaxBytes int64  `json:"attachmentMaxBytes"`
	Acknowledged       bool   `json:"acknowledged"`
}

// handleGetCommsPolicy returns the retention/audit notice and acknowledgement state.
func (s *server) handleGetCommsPolicy(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	p, err := s.store.GetCommsPolicy(r.Context(), actor.ID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, commsPolicyResponse{
		Notice:             p.Notice,
		RetentionDays:      p.RetentionDays,
		AttachmentMaxBytes: p.AttachmentMaxBytes,
		Acknowledged:       p.Acknowledged,
	})
}

// handleAcknowledgeCommsPolicy records the user's acknowledgement of the policy.
func (s *server) handleAcknowledgeCommsPolicy(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	if err := s.store.AcknowledgeCommsPolicy(r.Context(), actor.ID); err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionCommsPolicyAcknowledge, "comms_policy", actor.ID, nil, nil)
	writeJSON(w, http.StatusOK, map[string]any{"acknowledged": true})
}

func (s *server) commsSearchParams(r *http.Request) store.SearchMessagesParams {
	limit, offset := pagination(r)
	return store.SearchMessagesParams{
		SenderID:    r.URL.Query().Get("senderId"),
		RecipientID: r.URL.Query().Get("recipientId"),
		ChannelID:   r.URL.Query().Get("channelId"),
		Query:       r.URL.Query().Get("q"),
		From:        r.URL.Query().Get("from"),
		To:          r.URL.Query().Get("to"),
		Limit:       limit,
		Offset:      offset,
	}
}

// handleAdminSearchMessages is the restricted administrative access path. Every
// access is audited with the filters used.
func (s *server) handleAdminSearchMessages(w http.ResponseWriter, r *http.Request) {
	p := s.commsSearchParams(r)
	msgs, err := s.store.SearchMessages(r.Context(), p)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionCommsAdminAccess, "comms_message", "*", nil, map[string]any{
		"senderId": p.SenderID, "recipientId": p.RecipientID, "channelId": p.ChannelID,
		"query": p.Query, "from": p.From, "to": p.To,
	})
	s.writeMessageList(w, r, msgs)
}

// handleComplianceSearch runs a compliance investigation, also fully audited.
func (s *server) handleComplianceSearch(w http.ResponseWriter, r *http.Request) {
	p := s.commsSearchParams(r)
	msgs, err := s.store.SearchMessages(r.Context(), p)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionCommsComplianceSearch, "comms_message", "*", nil, map[string]any{
		"senderId": p.SenderID, "recipientId": p.RecipientID, "channelId": p.ChannelID,
		"query": p.Query, "from": p.From, "to": p.To,
	})
	s.writeMessageList(w, r, msgs)
}

func (s *server) writeMessageList(w http.ResponseWriter, r *http.Request, msgs []domain.Message) {
	out := make([]messageResponse, 0, len(msgs))
	for i := range msgs {
		out = append(out, newMessageResponse(&msgs[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

// handleRunRetention purges communications older than the retention window.
func (s *server) handleRunRetention(w http.ResponseWriter, r *http.Request) {
	messages, notifications, err := s.store.PurgeExpiredCommunications(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionCommsRetentionRun, "comms_message", "*", nil, map[string]any{
		"messagesPurged": messages, "notificationsPurged": notifications,
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"messagesPurged": messages, "notificationsPurged": notifications,
	})
}
