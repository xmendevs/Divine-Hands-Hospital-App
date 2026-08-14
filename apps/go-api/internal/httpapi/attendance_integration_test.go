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

func staffIDFor(t *testing.T, userID string) string {
	t.Helper()
	st, err := testStore.GetStaffByUserID(context.Background(), userID)
	if err != nil {
		t.Fatalf("staff lookup: %v", err)
	}
	return st.ID
}

func createShift(t *testing.T, token, code, name, start, end string, grace int) map[string]any {
	t.Helper()
	rr := doJSON(t, http.MethodPost, "/api/v1/attendance/shifts", token, map[string]any{
		"code": code, "name": name, "startTime": start, "endTime": end, "lateGraceMinutes": grace,
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create shift status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	return resp
}

func clockIn(t *testing.T, token, shiftID string) map[string]any {
	t.Helper()
	rr := doJSON(t, http.MethodPost, "/api/v1/attendance/clock-in", token, map[string]any{
		"shiftId": shiftID, "method": "kiosk",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("clock-in status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	return resp
}

func clockOut(t *testing.T, token string) map[string]any {
	t.Helper()
	rr := doJSON(t, http.MethodPost, "/api/v1/attendance/clock-out", token, map[string]any{
		"method": "kiosk",
	})
	if rr.Code != http.StatusOK {
		t.Fatalf("clock-out status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	return resp
}

func TestStaffProfileManagement(t *testing.T) {
	nurseUserID, _ := seedRoleUser(t, "p9-nurse1", "nurse", "E-901")

	rr := doJSON(t, http.MethodGet, "/api/v1/staff", adminToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list staff status = %d", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "E-901") {
		t.Fatal("staff list does not contain E-901")
	}

	staffID := staffIDFor(t, nurseUserID)
	rr = doJSON(t, http.MethodGet, "/api/v1/staff/"+staffID, adminToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("get staff status = %d", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), `"nurse"`) {
		t.Fatalf("staff detail missing nurse role: %s", rr.Body.String())
	}

	// Update workforce fields.
	rr = doJSON(t, http.MethodPatch, "/api/v1/staff/"+staffID, adminToken, map[string]any{
		"employmentStatus": "on_leave",
		"jobTitle":         "Staff Nurse",
		"contactPhone":     "08090001234",
		"availability":     "full_time",
		"skills":           []string{"IV", "triage"},
		"certifications":   []string{"BLS"},
	})
	if rr.Code != http.StatusOK {
		t.Fatalf("update staff status = %d, body=%s", rr.Code, rr.Body.String())
	}
	rr = doJSON(t, http.MethodGet, "/api/v1/staff/"+staffID, adminToken, nil)
	if !strings.Contains(rr.Body.String(), `"on_leave"`) || !strings.Contains(rr.Body.String(), `"BLS"`) {
		t.Fatalf("staff update not persisted: %s", rr.Body.String())
	}

	// Invalid employment status rejected.
	rr = doJSON(t, http.MethodPatch, "/api/v1/staff/"+staffID, adminToken, map[string]any{
		"employmentStatus": "nonsense",
	})
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid employmentStatus status = %d, want 422", rr.Code)
	}
}

func TestAttendanceClockInOut(t *testing.T) {
	_, nurseTok := seedRoleUser(t, "p9-nurse2", "nurse", "E-902")
	_, nurse2Tok := seedRoleUser(t, "p9-nurse3", "nurse", "E-903")
	_, matronTok := seedRoleUser(t, "p9-matron1", "matron", "E-904")
	_, doctorTok := seedRoleUser(t, "p9-doctor1", "doctor", "E-905")

	// Shift spanning the whole day with zero grace: any clock-in is late.
	lateShift := createShift(t, adminToken, "DAY", "Day", "00:00", "23:59", 0)

	// Unsupported method rejected before any clock-in.
	rr := doJSON(t, http.MethodPost, "/api/v1/attendance/clock-in", doctorTok, map[string]any{
		"shiftId": lateShift["id"], "method": "teleport",
	})
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("unsupported method status = %d, want 422", rr.Code)
	}

	// Clock-in, then a duplicate is blocked.
	rec := clockIn(t, nurseTok, lateShift["id"].(string))
	if rec["isLate"].(bool) != true {
		t.Fatalf("isLate = %v, want true", rec["isLate"])
	}
	if rec["status"] != "clocked_in" {
		t.Fatalf("status = %v, want clocked_in", rec["status"])
	}
	rr = doJSON(t, http.MethodPost, "/api/v1/attendance/clock-in", nurseTok, map[string]any{
		"shiftId": lateShift["id"], "method": "kiosk",
	})
	if rr.Code != http.StatusConflict {
		t.Fatalf("duplicate clock-in status = %d, want 409", rr.Code)
	}

	// Clock-out, then a second clock-out is blocked.
	out := clockOut(t, nurseTok)
	if out["isEarlyLeave"].(bool) != true {
		t.Fatalf("isEarlyLeave = %v, want true", out["isEarlyLeave"])
	}
	if out["status"] != "completed" {
		t.Fatalf("status = %v, want completed", out["status"])
	}
	rr = doJSON(t, http.MethodPost, "/api/v1/attendance/clock-out", nurseTok, map[string]any{"method": "kiosk"})
	if rr.Code != http.StatusConflict {
		t.Fatalf("clock-out without clock-in status = %d, want 409", rr.Code)
	}

	// A generous grace means not late, but still early (shift ends at 23:59).
	morning := createShift(t, adminToken, "MORNING", "Morning", "00:00", "23:59", 2000)
	clockIn(t, nurse2Tok, morning["id"].(string))
	out2 := clockOut(t, nurse2Tok)
	if out2["isLate"].(bool) != false || out2["isEarlyLeave"].(bool) != true {
		t.Fatalf("morning flags = late:%v early:%v, want false/true", out2["isLate"], out2["isEarlyLeave"])
	}

	// Attendance list is reportable and filterable.
	rr = doJSON(t, http.MethodGet, "/api/v1/attendance?late=true", matronTok, nil)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "E-902") {
		t.Fatalf("list attendance (late) status = %d, body=%s", rr.Code, rr.Body.String())
	}
}

func TestAttendanceReport(t *testing.T) {
	_, nurseTok := seedRoleUser(t, "p9-nurse4", "nurse", "E-906")
	nurse2UserID, nurse2Tok := seedRoleUser(t, "p9-nurse5", "nurse", "E-907")
	_, matronTok := seedRoleUser(t, "p9-matron2", "matron", "E-908")

	lateShift := createShift(t, adminToken, "R-DAY", "Day", "00:00", "23:59", 0)
	clockIn(t, nurseTok, lateShift["id"].(string))
	clockOut(t, nurseTok)

	date := time.Now().UTC().Format("2006-01-02")

	// Schedule nurse2 but they never clock in -> missed.
	nurse2Staff := staffIDFor(t, nurse2UserID)
	rr := doJSON(t, http.MethodPost, "/api/v1/attendance/rosters", adminToken, map[string]any{
		"staffId": nurse2Staff, "shiftId": lateShift["id"], "workDate": date,
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("assign roster status = %d, body=%s", rr.Code, rr.Body.String())
	}

	rr = doJSON(t, http.MethodGet, "/api/v1/attendance/report?date="+date, matronTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("report status = %d", rr.Code)
	}
	var rows []map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &rows)
	statusByEmp := map[string]string{}
	for _, r := range rows {
		statusByEmp[r["employeeNo"].(string)] = r["status"].(string)
	}
	if statusByEmp["E-906"] != "late" {
		t.Fatalf("E-906 status = %q, want late", statusByEmp["E-906"])
	}
	if statusByEmp["E-907"] != "missed" {
		t.Fatalf("E-907 status = %q, want missed", statusByEmp["E-907"])
	}

	// Approve leave for nurse2 covering today -> on_leave instead of missed.
	rr = doJSON(t, http.MethodPost, "/api/v1/staff/leave", nurse2Tok, map[string]any{
		"leaveType": "annual", "startDate": date, "endDate": date, "reason": "rest",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("request leave status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var lv map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &lv)
	rr = doJSON(t, http.MethodPost, "/api/v1/staff/leave/"+lv["id"].(string)+"/approve", matronTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("approve leave status = %d", rr.Code)
	}

	rr = doJSON(t, http.MethodGet, "/api/v1/attendance/report?date="+date, matronTok, nil)
	_ = json.Unmarshal(rr.Body.Bytes(), &rows)
	statusByEmp = map[string]string{}
	for _, r := range rows {
		statusByEmp[r["employeeNo"].(string)] = r["status"].(string)
	}
	if statusByEmp["E-907"] != "on_leave" {
		t.Fatalf("E-907 status = %q, want on_leave", statusByEmp["E-907"])
	}
}

func TestRoster(t *testing.T) {
	nurseUserID, nurseTok := seedRoleUser(t, "p9-nurse9", "nurse", "E-916")
	_, matronTok := seedRoleUser(t, "p9-matron4", "matron", "E-917")

	shift := createShift(t, adminToken, "R-NIGHT", "Night", "20:00", "08:00", 0)
	date := time.Now().UTC().Format("2006-01-02")
	staffID := staffIDFor(t, nurseUserID)

	// Nurses cannot assign rosters.
	rr := doJSON(t, http.MethodPost, "/api/v1/attendance/rosters", nurseTok, map[string]any{
		"staffId": staffID, "shiftId": shift["id"], "workDate": date,
	})
	if rr.Code != http.StatusForbidden {
		t.Fatalf("nurse assign roster status = %d, want 403", rr.Code)
	}

	rr = doJSON(t, http.MethodPost, "/api/v1/attendance/rosters", adminToken, map[string]any{
		"staffId": staffID, "shiftId": shift["id"], "workDate": date,
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("assign roster status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var ro map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &ro)
	rosterID := ro["id"].(string)

	// Duplicate assignment rejected.
	rr = doJSON(t, http.MethodPost, "/api/v1/attendance/rosters", adminToken, map[string]any{
		"staffId": staffID, "shiftId": shift["id"], "workDate": date,
	})
	if rr.Code != http.StatusConflict {
		t.Fatalf("duplicate roster status = %d, want 409", rr.Code)
	}

	// Listable.
	rr = doJSON(t, http.MethodGet, "/api/v1/attendance/rosters?date="+date, matronTok, nil)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "E-916") {
		t.Fatalf("list roster status = %d", rr.Code)
	}

	// Delete removes it.
	rr = doJSON(t, http.MethodDelete, "/api/v1/attendance/rosters/"+rosterID, adminToken, nil)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("delete roster status = %d", rr.Code)
	}
	rr = doJSON(t, http.MethodGet, "/api/v1/attendance/rosters?date="+date, matronTok, nil)
	if strings.Contains(rr.Body.String(), "E-916") {
		t.Fatal("roster still listed after delete")
	}
}

func TestStaffLeave(t *testing.T) {
	_, nurseTok := seedRoleUser(t, "p9-nurse6", "nurse", "E-909")
	_, matronTok := seedRoleUser(t, "p9-matron3", "matron", "E-910")

	date := time.Now().UTC().Format("2006-01-02")
	rr := doJSON(t, http.MethodPost, "/api/v1/staff/leave", nurseTok, map[string]any{
		"leaveType": "sick", "startDate": date, "endDate": date, "reason": "unwell",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("request leave status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var lv map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &lv)
	if lv["status"] != "pending" {
		t.Fatalf("leave status = %v, want pending", lv["status"])
	}

	// The requester cannot approve their own leave (no manage permission).
	rr = doJSON(t, http.MethodPost, "/api/v1/staff/leave/"+lv["id"].(string)+"/approve", nurseTok, nil)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("self approve leave status = %d, want 403", rr.Code)
	}

	// Matron approves.
	rr = doJSON(t, http.MethodPost, "/api/v1/staff/leave/"+lv["id"].(string)+"/approve", matronTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("approve leave status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// Re-approving a decided request is rejected.
	rr = doJSON(t, http.MethodPost, "/api/v1/staff/leave/"+lv["id"].(string)+"/approve", matronTok, nil)
	if rr.Code != http.StatusConflict {
		t.Fatalf("re-approve status = %d, want 409", rr.Code)
	}

	// The nurse can list their own leave only.
	rr = doJSON(t, http.MethodGet, "/api/v1/staff/leave", nurseTok, nil)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"approved"`) {
		t.Fatalf("list own leave status = %d, body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandover(t *testing.T) {
	_, nurseTok := seedRoleUser(t, "p9-nurse7", "nurse", "E-911")
	_, nurse2Tok := seedRoleUser(t, "p9-nurse8", "nurse", "E-912")
	_, doctorTok := seedRoleUser(t, "p9-doctor2", "doctor", "E-913")

	patient := registerPatient(t, superToken, map[string]any{
		"firstName": "Handover", "lastName": "Patient", "gender": "female",
		"dateOfBirth": "1980-01-01", "phone": "08090005555",
	})
	patientID := patient["id"].(string)

	rr := doJSON(t, http.MethodPost, "/api/v1/handovers", nurseTok, map[string]any{
		"patientIds":            []string{patientID},
		"currentCondition":      "stable",
		"medications":           "paracetamol 500mg",
		"pendingInvestigations": "FBC",
		"pendingOrders":         "physio review",
		"importantObservations": "fever spike at 2am",
		"tasks":                 "check vitals q4h",
		"incidents":             "none",
		"instructions":          "notify doctor if temp > 38",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create handover status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var h map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &h)
	handoverID := h["id"].(string)
	if !strings.HasPrefix(h["handoverNo"].(string), "HOV") {
		t.Fatalf("handoverNo = %v, want HOV prefix", h["handoverNo"])
	}
	if h["status"] != "created" {
		t.Fatalf("handover status = %v, want created", h["status"])
	}

	// Self-acknowledgement blocked.
	rr = doJSON(t, http.MethodPost, "/api/v1/handovers/"+handoverID+"/acknowledge", nurseTok, nil)
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("self acknowledge status = %d, want 422", rr.Code)
	}

	// Doctors cannot acknowledge (create/view only).
	rr = doJSON(t, http.MethodPost, "/api/v1/handovers/"+handoverID+"/acknowledge", doctorTok, nil)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("doctor acknowledge status = %d, want 403", rr.Code)
	}

	// Incoming nurse acknowledges.
	rr = doJSON(t, http.MethodPost, "/api/v1/handovers/"+handoverID+"/acknowledge", nurse2Tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("acknowledge status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var ack map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &ack)
	if ack["status"] != "acknowledged" {
		t.Fatalf("ack status = %v, want acknowledged", ack["status"])
	}

	// Double acknowledge blocked.
	rr = doJSON(t, http.MethodPost, "/api/v1/handovers/"+handoverID+"/acknowledge", nurse2Tok, nil)
	if rr.Code != http.StatusConflict {
		t.Fatalf("double acknowledge status = %d, want 409", rr.Code)
	}

	// Handover is retrievable with its fields.
	rr = doJSON(t, http.MethodGet, "/api/v1/handovers/"+handoverID, nurse2Tok, nil)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "stable") {
		t.Fatalf("get handover status = %d", rr.Code)
	}

	// Listable.
	rr = doJSON(t, http.MethodGet, "/api/v1/handovers?status=acknowledged", nurse2Tok, nil)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), handoverID) {
		t.Fatalf("list handovers status = %d", rr.Code)
	}
}

func TestAttendancePermissions(t *testing.T) {
	_, receptionTok := seedRoleUser(t, "p9-reception1", "receptionist", "E-914")
	_, cashierTok := seedRoleUser(t, "p9-cashier1", "cashier", "E-915")

	for _, path := range []string{
		"/api/v1/attendance",
		"/api/v1/attendance/report",
		"/api/v1/handovers",
	} {
		rr := doJSON(t, http.MethodGet, path, receptionTok, nil)
		if rr.Code != http.StatusForbidden {
			t.Fatalf("receptionist %s status = %d, want 403", path, rr.Code)
		}
	}

	// Cashier cannot manage attendance or create handovers.
	rr := doJSON(t, http.MethodPost, "/api/v1/attendance/shifts", cashierTok, map[string]any{
		"code": "X", "name": "X", "startTime": "00:00", "endTime": "23:59",
	})
	if rr.Code != http.StatusForbidden {
		t.Fatalf("cashier create shift status = %d, want 403", rr.Code)
	}
	rr = doJSON(t, http.MethodPost, "/api/v1/handovers", cashierTok, map[string]any{})
	if rr.Code != http.StatusForbidden {
		t.Fatalf("cashier create handover status = %d, want 403", rr.Code)
	}

	// Unauthenticated rejected.
	rr = doJSON(t, http.MethodGet, "/api/v1/attendance", "", nil)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("no token status = %d, want 401", rr.Code)
	}
}
