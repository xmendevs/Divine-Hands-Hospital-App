//go:build integration

package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestNotifications(t *testing.T) {
	nurseUserID, nurseTok := seedRoleUser(t, "p11-nurse1", "nurse", "E-931")
	_, matronTok := seedRoleUser(t, "p11-matron1", "matron", "E-932")

	// Matron sends a roster alert to the nurse.
	rr := doJSON(t, http.MethodPost, "/api/v1/notifications", matronTok, map[string]any{
		"userIds":  []string{nurseUserID},
		"category": "roster",
		"title":    "Shift change",
		"body":     "Your shift moved to 16:00",
		"channel":  "in_app",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("send notification status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// The nurse sees the persisted notification.
	rr = doJSON(t, http.MethodGet, "/api/v1/notifications", nurseTok, nil)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "Shift change") {
		t.Fatalf("list notifications status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var list []map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &list)
	if len(list) == 0 {
		t.Fatal("expected at least one notification")
	}
	notifID := list[0]["id"].(string)

	// Unread count reflects it, then drops after marking read.
	rr = doJSON(t, http.MethodGet, "/api/v1/notifications/unread-count", nurseTok, nil)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"unread":1`) {
		t.Fatalf("unread count status = %d, body=%s", rr.Code, rr.Body.String())
	}
	rr = doJSON(t, http.MethodPost, "/api/v1/notifications/"+notifID+"/read", nurseTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("mark read status = %d, body=%s", rr.Code, rr.Body.String())
	}
	rr = doJSON(t, http.MethodGet, "/api/v1/notifications/unread-count", nurseTok, nil)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"unread":0`) {
		t.Fatalf("unread count after read status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// A nurse cannot send notifications (no notifications.send).
	rr = doJSON(t, http.MethodPost, "/api/v1/notifications", nurseTok, map[string]any{
		"userIds": []string{nurseUserID}, "category": "system", "title": "x",
	})
	if rr.Code != http.StatusForbidden {
		t.Fatalf("nurse send notification status = %d, want 403", rr.Code)
	}
}

func TestDirectMessagesAndAttachments(t *testing.T) {
	userA, tokA := seedRoleUser(t, "p11-nurse2", "nurse", "E-933")
	userB, tokB := seedRoleUser(t, "p11-nurse3", "nurse", "E-934")

	rr := doJSON(t, http.MethodPost, "/api/v1/communications/messages", tokA, map[string]any{
		"recipientId": userB,
		"body":        "hello colleague",
		"attachments": []map[string]any{{"fileName": "x.pdf", "mimeType": "application/pdf", "sizeBytes": 100}},
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("send direct message status = %d, body=%s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"kind":"direct"`) {
		t.Fatalf("expected direct message, got %s", rr.Body.String())
	}

	// Recipient reads the thread.
	rr = doJSON(t, http.MethodGet, "/api/v1/communications/messages?recipientId="+userA, tokB, nil)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "hello colleague") {
		t.Fatalf("list direct messages status = %d, body=%s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "x.pdf") {
		t.Fatalf("attachment missing from message, body=%s", rr.Body.String())
	}

	// The recipient also received an in-app notification.
	rr = doJSON(t, http.MethodGet, "/api/v1/notifications", tokB, nil)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "hello colleague") {
		t.Fatalf("message notification status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// Oversized attachment is rejected by the policy (default 5 MiB).
	rr = doJSON(t, http.MethodPost, "/api/v1/communications/messages", tokA, map[string]any{
		"recipientId": userB,
		"body":        "too big",
		"attachments": []map[string]any{{"fileName": "big.bin", "sizeBytes": 999999999}},
	})
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("oversized attachment status = %d, want 422", rr.Code)
	}
}

func TestChannelsAndGovernance(t *testing.T) {
	_, matronTok := seedRoleUser(t, "p11-matron2", "matron", "E-935")
	nurseUserID, nurseTok := seedRoleUser(t, "p11-nurse4", "nurse", "E-936")
	_, receptionTok := seedRoleUser(t, "p11-reception1", "receptionist", "E-937")
	_, auditorTok := seedRoleUser(t, "p11-auditor1", "auditor", "E-938")

	deptID := createDept(t, adminToken, "COMM-A", "Comms A")

	// Matron creates a department channel.
	rr := doJSON(t, http.MethodPost, "/api/v1/communications/channels", matronTok, map[string]any{
		"name": "Ward A", "type": "department", "departmentId": deptID,
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create channel status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var ch map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &ch)
	channelID := ch["id"].(string)

	// Add the nurse as a member.
	rr = doJSON(t, http.MethodPost, "/api/v1/communications/channels/"+channelID+"/members", matronTok, map[string]any{
		"userId": nurseUserID,
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("add member status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// Nurse posts to the channel.
	rr = doJSON(t, http.MethodPost, "/api/v1/communications/channels/"+channelID+"/messages", nurseTok, map[string]any{
		"body": "handover ready",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("send channel message status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// A non-member cannot read channel messages.
	rr = doJSON(t, http.MethodGet, "/api/v1/communications/channels/"+channelID+"/messages", receptionTok, nil)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("non-member read status = %d, want 403", rr.Code)
	}

	// Admin (comms.admin) can read, and the access is audited.
	rr = doJSON(t, http.MethodGet, "/api/v1/communications/channels/"+channelID+"/messages", adminToken, nil)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "handover ready") {
		t.Fatalf("admin read status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// A nurse cannot use the restricted admin search.
	rr = doJSON(t, http.MethodGet, "/api/v1/communications/admin/messages?q=handover", nurseTok, nil)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("nurse admin search status = %d, want 403", rr.Code)
	}

	// The auditor runs a compliance investigation and finds the message.
	rr = doJSON(t, http.MethodGet, "/api/v1/communications/compliance/search?q=handover", auditorTok, nil)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "handover ready") {
		t.Fatalf("compliance search status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// Admin runs retention (audited purge).
	rr = doJSON(t, http.MethodPost, "/api/v1/communications/retention/run", adminToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("retention run status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// Both governed access paths wrote audit entries.
	rr = doJSON(t, http.MethodGet, "/api/v1/admin/audit-logs", superToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("audit logs status = %d", rr.Code)
	}
	for _, action := range []string{"communications.admin_access", "communications.compliance_search", "communications.retention_run"} {
		if !strings.Contains(rr.Body.String(), action) {
			t.Fatalf("audit log missing %q", action)
		}
	}
}

func TestAnnouncements(t *testing.T) {
	_, matronTok := seedRoleUser(t, "p11-matron3", "matron", "E-939")
	_, nurseTok := seedRoleUser(t, "p11-nurse5", "nurse", "E-940")

	rr := doJSON(t, http.MethodPost, "/api/v1/communications/announcements", matronTok, map[string]any{
		"body": "All-staff meeting at noon",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("post announcement status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// The nurse sees the announcement and the fanned-out notification.
	rr = doJSON(t, http.MethodGet, "/api/v1/communications/announcements", nurseTok, nil)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "All-staff meeting") {
		t.Fatalf("list announcements status = %d, body=%s", rr.Code, rr.Body.String())
	}
	rr = doJSON(t, http.MethodGet, "/api/v1/notifications", nurseTok, nil)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "All-staff meeting") {
		t.Fatalf("announcement notification status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// A nurse cannot post announcements.
	rr = doJSON(t, http.MethodPost, "/api/v1/communications/announcements", nurseTok, map[string]any{
		"body": "unauthorized",
	})
	if rr.Code != http.StatusForbidden {
		t.Fatalf("nurse announcement status = %d, want 403", rr.Code)
	}
}

func TestCommsPolicy(t *testing.T) {
	_, nurseTok := seedRoleUser(t, "p11-nurse6", "nurse", "E-941")

	rr := doJSON(t, http.MethodGet, "/api/v1/communications/policy", nurseTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("get policy status = %d, body=%s", rr.Code, rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), `"acknowledged":true`) {
		t.Fatalf("policy should start unacknowledged, body=%s", rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"retentionDays":365`) {
		t.Fatalf("policy should expose retention, body=%s", rr.Body.String())
	}

	rr = doJSON(t, http.MethodPost, "/api/v1/communications/policy/acknowledge", nurseTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("acknowledge policy status = %d, body=%s", rr.Code, rr.Body.String())
	}

	rr = doJSON(t, http.MethodGet, "/api/v1/communications/policy", nurseTok, nil)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"acknowledged":true`) {
		t.Fatalf("policy after acknowledge status = %d, body=%s", rr.Code, rr.Body.String())
	}
}
