//go:build integration

package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

func addDays(date string, n int) string {
	t, _ := time.Parse("2006-01-02", date)
	return t.AddDate(0, 0, n).Format("2006-01-02")
}

func createDept(t *testing.T, token, code, name string) string {
	t.Helper()
	rr := doJSON(t, http.MethodPost, "/api/v1/admin/departments", token, map[string]any{"code": code, "name": name})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create department status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var d map[string]string
	_ = json.Unmarshal(rr.Body.Bytes(), &d)
	return d["id"]
}

func assignDepartment(t *testing.T, token, staffID, deptID string, prefs []map[string]any) {
	t.Helper()
	body := map[string]any{"employmentStatus": "active", "departmentId": deptID}
	if prefs != nil {
		body["shiftPreferences"] = prefs
	}
	rr := doJSON(t, http.MethodPatch, "/api/v1/staff/"+staffID, token, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("assign department status = %d, body=%s", rr.Code, rr.Body.String())
	}
}

func createShiftWithNight(t *testing.T, token, code, name, start, end string, night bool) map[string]any {
	t.Helper()
	rr := doJSON(t, http.MethodPost, "/api/v1/attendance/shifts", token, map[string]any{
		"code": code, "name": name, "startTime": start, "endTime": end, "lateGraceMinutes": 0, "isNight": night,
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create shift status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var sh map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &sh)
	return sh
}

func createPlan(t *testing.T, token string, body map[string]any) map[string]any {
	t.Helper()
	rr := doJSON(t, http.MethodPost, "/api/v1/roster/plans", token, body)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create plan status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var p map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &p)
	return p
}

func getPlan(t *testing.T, token, id string) map[string]any {
	t.Helper()
	rr := doJSON(t, http.MethodGet, "/api/v1/roster/plans/"+id, token, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("get plan status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var p map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &p)
	return p
}

func TestRosterGenerationAndApproval(t *testing.T) {
	deptID := createDept(t, adminToken, "NUR-A", "Nursing A")
	day := createShiftWithNight(t, adminToken, "DAY-A", "Day", "08:00", "16:00", false)
	night := createShiftWithNight(t, adminToken, "NIGHT-A", "Night", "00:00", "08:00", true)

	aUser, _ := seedRoleUser(t, "p10-nurse1", "nurse", "E-921")
	bUser, _ := seedRoleUser(t, "p10-nurse2", "nurse", "E-922")
	cUser, cTok := seedRoleUser(t, "p10-nurse3", "nurse", "E-923")
	_, matronTok := seedRoleUser(t, "p10-matron1", "matron", "E-924")

	aStaff := staffIDFor(t, aUser)
	bStaff := staffIDFor(t, bUser)
	cStaff := staffIDFor(t, cUser)

	assignDepartment(t, adminToken, aStaff, deptID, []map[string]any{{"shiftId": day["id"], "rank": 1}})
	assignDepartment(t, adminToken, bStaff, deptID, nil)
	assignDepartment(t, adminToken, cStaff, deptID, nil)

	today := time.Now().UTC().Format("2006-01-02")

	// B is unavailable today; C is on approved leave today.
	rr := doJSON(t, http.MethodPost, "/api/v1/staff/unavailability", adminToken, map[string]any{
		"staffId": bStaff, "workDate": today, "reason": "training",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("mark unavailable status = %d, body=%s", rr.Code, rr.Body.String())
	}
	// C requests leave covering today; matron approves it.
	rr = doJSON(t, http.MethodPost, "/api/v1/staff/leave", cTok, map[string]any{
		"leaveType": "annual", "startDate": today, "endDate": today, "reason": "rest",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("request leave status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var lv map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &lv)
	rr = doJSON(t, http.MethodPost, "/api/v1/staff/leave/"+lv["id"].(string)+"/approve", matronTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("approve leave status = %d, body=%s", rr.Code, rr.Body.String())
	}

	plan := createPlan(t, matronTok, map[string]any{
		"name": "Week A", "departmentId": deptID,
		"startDate": today, "endDate": addDays(today, 2),
		"shiftRequirements": []map[string]any{
			{"shiftId": day["id"], "required": 2},
			{"shiftId": night["id"], "required": 1},
		},
	})
	planID := plan["id"].(string)
	if !strings.HasPrefix(plan["planNo"].(string), "RST") {
		t.Fatalf("planNo = %v, want RST prefix", plan["planNo"])
	}
	if plan["status"] != "draft" {
		t.Fatalf("plan status = %v, want draft", plan["status"])
	}

	plan = getPlan(t, matronTok, planID)
	assignments := plan["assignments"].([]any)
	unmet := plan["unmet"].([]any)

	// No staff holds two shifts on the same date (no conflicting shifts).
	seen := map[string]bool{}
	for _, a := range assignments {
		m := a.(map[string]any)
		key := m["staffId"].(string) + "|" + m["workDate"].(string)
		if seen[key] {
			t.Fatalf("conflicting shifts: staff %s on %s", m["staffId"], m["workDate"])
		}
		seen[key] = true
	}

	// B (unavailable) and C (on leave) must not work today.
	for _, a := range assignments {
		m := a.(map[string]any)
		if m["workDate"] == today && (m["staffId"] == bStaff || m["staffId"] == cStaff) {
			t.Fatalf("unavailable/on-leave staff assigned: %v", m)
		}
	}

	// Required staffing levels are evaluated: with only A available today,
	// at least one requirement is unmet today.
	if len(unmet) == 0 {
		t.Fatal("expected unmet requirements, got none")
	}
	for _, u := range unmet {
		m := u.(map[string]any)
		if m["workDate"] != today {
			t.Fatalf("unmet on unexpected date: %v", m)
		}
	}

	// Planner can edit while draft.
	rr = doJSON(t, http.MethodPost, "/api/v1/roster/plans/"+planID+"/assignments", matronTok, map[string]any{
		"staffId": bStaff, "shiftId": day["id"], "workDate": addDays(today, 1),
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("upsert assignment status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// Submit; then edits are blocked.
	rr = doJSON(t, http.MethodPost, "/api/v1/roster/plans/"+planID+"/submit", matronTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("submit status = %d, body=%s", rr.Code, rr.Body.String())
	}
	rr = doJSON(t, http.MethodPost, "/api/v1/roster/plans/"+planID+"/assignments", matronTok, map[string]any{
		"staffId": bStaff, "shiftId": day["id"], "workDate": addDays(today, 1),
	})
	if rr.Code != http.StatusConflict {
		t.Fatalf("edit after submit status = %d, want 409", rr.Code)
	}

	// Matron cannot approve (no roster.approve).
	rr = doJSON(t, http.MethodPost, "/api/v1/roster/plans/"+planID+"/approve", matronTok, nil)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("matron approve status = %d, want 403", rr.Code)
	}

	// Super admin approves and publishes to the active roster.
	rr = doJSON(t, http.MethodPost, "/api/v1/roster/plans/"+planID+"/approve", superToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("super approve status = %d, body=%s", rr.Code, rr.Body.String())
	}
	if plan = getPlan(t, matronTok, planID); plan["status"] != "approved" {
		t.Fatalf("plan status after approve = %v, want approved", plan["status"])
	}

	// Published roster is immutable.
	rr = doJSON(t, http.MethodPost, "/api/v1/roster/plans/"+planID+"/regenerate", matronTok, nil)
	if rr.Code != http.StatusConflict {
		t.Fatalf("regenerate after approve status = %d, want 409", rr.Code)
	}

	// Published assignments appear in the active staff roster.
	rr = doJSON(t, http.MethodGet, "/api/v1/attendance/rosters?date="+today, matronTok, nil)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "E-921") {
		t.Fatalf("active roster missing published assignment, status=%d body=%s", rr.Code, rr.Body.String())
	}

	// Controlled amendment: create a new draft from the approved plan.
	rr = doJSON(t, http.MethodPost, "/api/v1/roster/plans/"+planID+"/amend", matronTok, nil)
	if rr.Code != http.StatusCreated {
		t.Fatalf("amend status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var amendment map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &amendment)
	if amendment["status"] != "draft" {
		t.Fatalf("amendment status = %v, want draft", amendment["status"])
	}
	if amendment["amendedFrom"] != planID {
		t.Fatalf("amendment amendedFrom = %v, want %s", amendment["amendedFrom"], planID)
	}
}

func TestRosterRestConstraint(t *testing.T) {
	deptID := createDept(t, adminToken, "NUR-B", "Nursing B")
	day := createShiftWithNight(t, adminToken, "DAY-B", "Day", "08:00", "16:00", false)

	u, _ := seedRoleUser(t, "p10-nurse4", "nurse", "E-925")
	_, matronTok := seedRoleUser(t, "p10-matron2", "matron", "E-926")
	assignDepartment(t, adminToken, staffIDFor(t, u), deptID, nil)

	today := time.Now().UTC().Format("2006-01-02")
	plan := createPlan(t, matronTok, map[string]any{
		"name": "Rest", "departmentId": deptID,
		"startDate": today, "endDate": addDays(today, 2),
		"minRestHours": 100,
		"shiftRequirements": []map[string]any{
			{"shiftId": day["id"], "required": 1},
		},
	})
	plan = getPlan(t, matronTok, plan["id"].(string))
	if got := len(plan["assignments"].([]any)); got != 1 {
		t.Fatalf("assignments = %d, want 1 (rest constraint)", got)
	}
	if got := len(plan["unmet"].([]any)); got != 2 {
		t.Fatalf("unmet = %d, want 2 (rest constraint blocks days 2-3)", got)
	}
}

func TestRosterPermissions(t *testing.T) {
	_, nurseTok := seedRoleUser(t, "p10-nurse5", "nurse", "E-927")
	_, receptionTok := seedRoleUser(t, "p10-reception1", "receptionist", "E-928")
	_, matronTok := seedRoleUser(t, "p10-matron3", "matron", "E-929")

	deptID := createDept(t, adminToken, "NUR-C", "Nursing C")
	day := createShiftWithNight(t, adminToken, "DAY-C", "Day", "08:00", "16:00", false)
	u, _ := seedRoleUser(t, "p10-nurse6", "nurse", "E-930")
	assignDepartment(t, adminToken, staffIDFor(t, u), deptID, nil)

	// Nurse and receptionist cannot plan or view rosters.
	for _, tok := range []string{nurseTok, receptionTok} {
		rr := doJSON(t, http.MethodGet, "/api/v1/roster/plans", tok, nil)
		if rr.Code != http.StatusForbidden {
			t.Fatalf("roster view status = %d, want 403", rr.Code)
		}
	}

	// Matron can create a plan; nurse cannot approve it.
	today := time.Now().UTC().Format("2006-01-02")
	plan := createPlan(t, matronTok, map[string]any{
		"name": "Perm", "departmentId": deptID,
		"startDate": today, "endDate": today,
		"shiftRequirements": []map[string]any{{"shiftId": day["id"], "required": 1}},
	})
	planID := plan["id"].(string)

	doJSON(t, http.MethodPost, "/api/v1/roster/plans/"+planID+"/submit", matronTok, nil)
	rr := doJSON(t, http.MethodPost, "/api/v1/roster/plans/"+planID+"/approve", nurseTok, nil)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("nurse approve status = %d, want 403", rr.Code)
	}

	// Super admin can approve.
	rr = doJSON(t, http.MethodPost, "/api/v1/roster/plans/"+planID+"/approve", superToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("super approve status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// Unauthenticated rejected.
	rr = doJSON(t, http.MethodGet, "/api/v1/roster/plans", "", nil)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("no token status = %d, want 401", rr.Code)
	}
}

var _ = context.Background
