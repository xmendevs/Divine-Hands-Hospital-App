//go:build integration

package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
)

func createLabTestAPI(t *testing.T, token string, body map[string]any) map[string]any {
	t.Helper()
	rr := doJSON(t, http.MethodPost, "/api/v1/lab/tests", token, body)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create lab test status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	return resp
}

func createLabClientAPI(t *testing.T, token string, body map[string]any) map[string]any {
	t.Helper()
	rr := doJSON(t, http.MethodPost, "/api/v1/lab/clients", token, body)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create lab client status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	return resp
}

func createLabRequestAPI(t *testing.T, token string, body map[string]any) map[string]any {
	t.Helper()
	rr := doJSON(t, http.MethodPost, "/api/v1/lab/requests", token, body)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create lab request status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	return resp
}

func getLabRequest(t *testing.T, token, id string) map[string]any {
	t.Helper()
	rr := doJSON(t, http.MethodGet, "/api/v1/lab/requests/"+id, token, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("get lab request status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	return resp
}

func transitionLabRequest(t *testing.T, token, id, status string) {
	t.Helper()
	rr := doJSON(t, http.MethodPost, "/api/v1/lab/requests/"+id+"/status", token, map[string]any{"status": status})
	if rr.Code != http.StatusOK {
		t.Fatalf("transition to %s status = %d, body=%s", status, rr.Code, rr.Body.String())
	}
}

func labItemIDs(t *testing.T, req map[string]any) []string {
	t.Helper()
	items, ok := req["items"].([]any)
	if !ok {
		t.Fatalf("request has no items: %v", req)
	}
	ids := make([]string, 0, len(items))
	for _, it := range items {
		ids = append(ids, it.(map[string]any)["id"].(string))
	}
	return ids
}

func TestLabWorkflowExternalClient(t *testing.T) {
	_, techTok := seedRoleUser(t, "p7-tech1", "lab_technician", "E-450")
	_, supTok := seedRoleUser(t, "p7-sup1", "lab_supervisor", "E-451")
	_, sup2Tok := seedRoleUser(t, "p7-sup2", "lab_supervisor", "E-452")

	// Catalogue: routine + high-risk tests.
	fbc := createLabTestAPI(t, superToken, map[string]any{
		"code": "FBC", "name": "Full Blood Count", "category": "haematology",
		"price": 5000, "specimenType": "blood", "turnaroundMinutes": 60,
		"referenceRanges": []map[string]any{{"key": "hb", "low": 12, "high": 16}},
	})
	hiv := createLabTestAPI(t, superToken, map[string]any{
		"code": "HIV", "name": "HIV Antibody", "category": "serology",
		"price": 8000, "specimenType": "blood", "turnaroundMinutes": 120,
		"verificationRequired": true,
	})

	client := createLabClientAPI(t, superToken, map[string]any{
		"clientType": "external", "firstName": "Chidi", "lastName": "Okafor",
		"phone": "08012345678", "city": "Lagos",
	})
	clientID := client["id"].(string)
	if client["clientNo"].(string)[:3] != "LBC" {
		t.Fatalf("clientNo = %q, want LBC prefix", client["clientNo"])
	}

	// Order two tests for the client.
	req := createLabRequestAPI(t, techTok, map[string]any{
		"clientId": clientID, "priority": "urgent",
		"testIds": []string{fbc["id"].(string), hiv["id"].(string)},
	})
	requestID := req["id"].(string)
	if req["requestNo"].(string)[:3] != "LAB" {
		t.Fatalf("requestNo = %q, want LAB prefix", req["requestNo"])
	}
	if req["status"] != "requested" || req["paymentStatus"] != "pending" {
		t.Fatalf("initial status/payment = %v/%v", req["status"], req["paymentStatus"])
	}
	items := labItemIDs(t, req)

	// Duplicate tests are rejected.
	rr := doJSON(t, http.MethodPost, "/api/v1/lab/requests", techTok, map[string]any{
		"clientId": clientID, "testIds": []string{fbc["id"].(string), fbc["id"].(string)},
	})
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("duplicate test status = %d, want 422", rr.Code)
	}

	// Payment step sets preauthorization.
	rr = doJSON(t, http.MethodPost, "/api/v1/lab/requests/"+requestID+"/status", techTok,
		map[string]any{"status": "payment", "paymentStatus": "preauthorized"})
	if rr.Code != http.StatusOK {
		t.Fatalf("to payment status = %d, body=%s", rr.Code, rr.Body.String())
	}
	req = getLabRequest(t, techTok, requestID)
	if req["status"] != "payment" || req["paymentStatus"] != "preauthorized" {
		t.Fatalf("after payment status = %v/%v", req["status"], req["paymentStatus"])
	}

	// Collect specimens for both items.
	rr = doJSON(t, http.MethodPost, "/api/v1/lab/requests/"+requestID+"/collect", techTok, map[string]any{
		"specimens": []map[string]any{{"itemId": items[0]}, {"itemId": items[1]}},
	})
	if rr.Code != http.StatusOK {
		t.Fatalf("collect status = %d, body=%s", rr.Code, rr.Body.String())
	}
	req = getLabRequest(t, techTok, requestID)
	if req["status"] != "specimen_collected" || len(req["specimens"].([]any)) != 2 {
		t.Fatalf("after collect status/specimens = %v/%v", req["status"], req["specimens"])
	}
	specimens := req["specimens"].([]any)
	if specimens[0].(map[string]any)["specimenNo"].(string)[:3] != "SPC" {
		t.Fatalf("specimenNo = %v, want SPC prefix", specimens[0].(map[string]any)["specimenNo"])
	}

	// Receive the first specimen; request must stay at specimen_collected.
	sp1ID := specimens[0].(map[string]any)["id"].(string)
	rr = doJSON(t, http.MethodPost, "/api/v1/lab/specimens/"+sp1ID+"/receive", techTok,
		map[string]any{"condition": "good", "storageLocation": "fridge A"})
	if rr.Code != http.StatusOK {
		t.Fatalf("receive 1 status = %d, body=%s", rr.Code, rr.Body.String())
	}
	req = getLabRequest(t, techTok, requestID)
	if req["status"] != "specimen_collected" {
		t.Fatalf("after partial receive status = %v", req["status"])
	}

	// Reject the second specimen (quality issue) and recollect it.
	sp2ID := specimens[1].(map[string]any)["id"].(string)
	rr = doJSON(t, http.MethodPost, "/api/v1/lab/specimens/"+sp2ID+"/reject", techTok,
		map[string]any{"reason": "clotted sample"})
	if rr.Code != http.StatusOK {
		t.Fatalf("reject status = %d, body=%s", rr.Code, rr.Body.String())
	}
	req = getLabRequest(t, techTok, requestID)
	specs := req["specimens"].([]any)
	if specs[1].(map[string]any)["status"] != "rejected" {
		t.Fatalf("specimen 2 not rejected: %v", specs[1])
	}
	sp2New := createSpecimenForItem(t, techTok, requestID, items[1])
	rr = doJSON(t, http.MethodPost, "/api/v1/lab/specimens/"+sp2New+"/receive", techTok,
		map[string]any{"condition": "good", "storageLocation": "fridge A"})
	if rr.Code != http.StatusOK {
		t.Fatalf("receive recollected status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// All specimens received -> request auto-advances to received.
	req = getLabRequest(t, techTok, requestID)
	if req["status"] != "received" {
		t.Fatalf("after all received status = %v", req["status"])
	}
	transitionLabRequest(t, techTok, requestID, "processing")

	// Enter both results; FBC is critical -> notification created.
	rr = doJSON(t, http.MethodPost, "/api/v1/lab/requests/"+requestID+"/results", techTok, map[string]any{
		"entries": []map[string]any{
			{"itemId": items[0], "resultValue": map[string]any{"hb": 8.2}, "resultText": "Low haemoglobin", "critical": true},
			{"itemId": items[1], "resultValue": map[string]any{"result": "non-reactive"}, "resultText": "Non-reactive"},
		},
	})
	if rr.Code != http.StatusOK {
		t.Fatalf("enter results status = %d, body=%s", rr.Code, rr.Body.String())
	}
	req = getLabRequest(t, techTok, requestID)
	if req["status"] != "result_entered" {
		t.Fatalf("after results status = %v", req["status"])
	}

	// Technicians cannot verify; supervisors can verify the routine test.
	rr = doJSON(t, http.MethodPost, "/api/v1/lab/items/"+items[0]+"/verify", techTok, nil)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("technician verify status = %d, want 403", rr.Code)
	}
	rr = doJSON(t, http.MethodPost, "/api/v1/lab/items/"+items[0]+"/verify", supTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("supervisor verify routine status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// Self-verification of a high-risk test is blocked: the supervisor takes
	// over the HIV entry, then tries to verify it themselves.
	rr = doJSON(t, http.MethodPost, "/api/v1/lab/requests/"+requestID+"/results", supTok, map[string]any{
		"entries": []map[string]any{
			{"itemId": items[1], "resultValue": map[string]any{"result": "reactive"}, "resultText": "Reactive", "critical": true},
		},
	})
	if rr.Code != http.StatusOK {
		t.Fatalf("supervisor re-entry status = %d, body=%s", rr.Code, rr.Body.String())
	}
	rr = doJSON(t, http.MethodPost, "/api/v1/lab/items/"+items[1]+"/verify", supTok, nil)
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("self-verify status = %d, want 422", rr.Code)
	}

	// A second supervisor verifies the high-risk test; request auto-advances.
	rr = doJSON(t, http.MethodPost, "/api/v1/lab/items/"+items[1]+"/verify", sup2Tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("second supervisor verify status = %d, body=%s", rr.Code, rr.Body.String())
	}
	req = getLabRequest(t, supTok, requestID)
	if req["status"] != "verified" {
		t.Fatalf("after verify status = %v", req["status"])
	}

	// Release.
	rr = doJSON(t, http.MethodPost, "/api/v1/lab/requests/"+requestID+"/release", supTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("release status = %d, body=%s", rr.Code, rr.Body.String())
	}
	req = getLabRequest(t, supTok, requestID)
	if req["status"] != "released" || req["releasedAt"] == nil {
		t.Fatalf("after release status = %v releasedAt=%v", req["status"], req["releasedAt"])
	}

	// Critical notifications: two entered (FBC + re-entered HIV), pending, then acknowledged.
	rr = doJSON(t, http.MethodGet, "/api/v1/lab/critical", supTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list critical status = %d", rr.Code)
	}
	var notifications []map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &notifications)
	if len(notifications) != 2 {
		t.Fatalf("critical notifications = %d, want 2", len(notifications))
	}
	notif := notifications[0]
	if notif["status"] != "pending" || notif["notifiedToName"].(string) != "Role User" {
		t.Fatalf("notification = %v", notif)
	}
	for _, n := range notifications {
		rr := doJSON(t, http.MethodPost, "/api/v1/lab/critical/"+n["id"].(string)+"/acknowledge", supTok,
			map[string]any{"notes": "called client"})
		if rr.Code != http.StatusOK {
			t.Fatalf("acknowledge status = %d, body=%s", rr.Code, rr.Body.String())
		}
	}
	rr = doJSON(t, http.MethodGet, "/api/v1/lab/critical?status=pending", supTok, nil)
	if rr.Code != http.StatusOK || len(bytes.TrimSpace(rr.Body.Bytes())) != 2 {
		t.Fatalf("pending criticals after ack = %s", rr.Body.String())
	}
}

func createSpecimenForItem(t *testing.T, token, requestID, itemID string) string {
	t.Helper()
	rr := doJSON(t, http.MethodPost, "/api/v1/lab/requests/"+requestID+"/collect", token, map[string]any{
		"specimens": []map[string]any{{"itemId": itemID}},
	})
	if rr.Code != http.StatusOK {
		t.Fatalf("recollect status = %d, body=%s", rr.Code, rr.Body.String())
	}
	req := getLabRequest(t, token, requestID)
	for _, sp := range req["specimens"].([]any) {
		s := sp.(map[string]any)
		if s["itemId"] == itemID && s["status"] == "collected" {
			return s["id"].(string)
		}
	}
	t.Fatalf("no collected specimen for item %s: %v", itemID, req["specimens"])
	return ""
}

func TestLabWorkflowHospitalPatient(t *testing.T) {
	_, docTok := seedRoleUser(t, "p7-doc1", "doctor", "E-459")

	patient := registerPatient(t, superToken, map[string]any{
		"firstName": "Ngozi", "lastName": "Adeyemi", "gender": "female",
		"dateOfBirth": "1985-04-20",
	})
	patientID := patient["id"].(string)

	// Doctor orders a test for the patient.
	urine := createLabTestAPI(t, superToken, map[string]any{
		"code": "UR", "name": "Urinalysis", "category": "urinalysis",
		"price": 3000, "specimenType": "urine",
	})
	req := createLabRequestAPI(t, docTok, map[string]any{
		"patientId": patientID, "testIds": []string{urine["id"].(string)},
	})
	requestID := req["id"].(string)
	if req["patientName"] != "Ngozi Adeyemi" {
		t.Fatalf("patientName = %v", req["patientName"])
	}

	// Patient timeline records the lab request.
	rr := doJSON(t, http.MethodGet, "/api/v1/patients/"+patientID+"/timeline", superToken, nil)
	if rr.Code != http.StatusOK || !bytes.Contains(rr.Body.Bytes(), []byte("lab_requested")) {
		t.Fatalf("timeline missing lab_requested: status=%d body=%s", rr.Code, rr.Body.String())
	}

	// Run the request through to release.
	items := labItemIDs(t, req)
	_, techTok := seedRoleUser(t, "p7-tech3", "lab_technician", "E-458")
	_, supTok := seedRoleUser(t, "p7-sup3", "lab_supervisor", "E-460")
	rr = doJSON(t, http.MethodPost, "/api/v1/lab/requests/"+requestID+"/status", techTok,
		map[string]any{"status": "payment", "paymentStatus": "paid"})
	if rr.Code != http.StatusOK {
		t.Fatalf("payment with paid status = %d", rr.Code)
	}
	doJSON(t, http.MethodPost, "/api/v1/lab/requests/"+requestID+"/collect", techTok, map[string]any{
		"specimens": []map[string]any{{"itemId": items[0], "specimenType": "urine"}},
	})
	req = getLabRequest(t, techTok, requestID)
	spID := req["specimens"].([]any)[0].(map[string]any)["id"].(string)
	doJSON(t, http.MethodPost, "/api/v1/lab/specimens/"+spID+"/receive", techTok,
		map[string]any{"condition": "good"})
	transitionLabRequest(t, techTok, requestID, "processing")
	doJSON(t, http.MethodPost, "/api/v1/lab/requests/"+requestID+"/results", techTok, map[string]any{
		"entries": []map[string]any{{"itemId": items[0], "resultValue": map[string]any{"glucose": "negative"}, "resultText": "Clear"}},
	})
	doJSON(t, http.MethodPost, "/api/v1/lab/items/"+items[0]+"/verify", supTok, nil)
	rr = doJSON(t, http.MethodPost, "/api/v1/lab/requests/"+requestID+"/release", supTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("release patient request status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// Patient timeline now records the release.
	rr = doJSON(t, http.MethodGet, "/api/v1/patients/"+patientID+"/timeline", superToken, nil)
	if rr.Code != http.StatusOK || !bytes.Contains(rr.Body.Bytes(), []byte("lab_released")) {
		t.Fatalf("timeline missing lab_released: status=%d body=%s", rr.Code, rr.Body.String())
	}
}

func TestLabCancel(t *testing.T) {
	_, techTok := seedRoleUser(t, "p7-tech2", "lab_technician", "E-454")

	glu := createLabTestAPI(t, superToken, map[string]any{
		"code": "GLU", "name": "Fasting Blood Sugar", "category": "biochemistry",
		"price": 2500, "specimenType": "blood",
	})
	client := createLabClientAPI(t, superToken, map[string]any{
		"firstName": "Efe", "lastName": "Bello",
	})
	req := createLabRequestAPI(t, techTok, map[string]any{
		"clientId": client["id"].(string), "testIds": []string{glu["id"].(string)},
	})

	// Missing reason -> 422.
	rr := doJSON(t, http.MethodPost, "/api/v1/lab/requests/"+req["id"].(string)+"/cancel", techTok, map[string]any{})
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("cancel without reason status = %d, want 422", rr.Code)
	}

	// Cancel then verify terminal state.
	rr = doJSON(t, http.MethodPost, "/api/v1/lab/requests/"+req["id"].(string)+"/cancel", techTok,
		map[string]any{"reason": "patient declined"})
	if rr.Code != http.StatusOK {
		t.Fatalf("cancel status = %d, body=%s", rr.Code, rr.Body.String())
	}
	detail := getLabRequest(t, techTok, req["id"].(string))
	if detail["status"] != "cancelled" || detail["cancelReason"] != "patient declined" {
		t.Fatalf("after cancel = %v / %v", detail["status"], detail["cancelReason"])
	}

	// Cancelled requests reject further transitions.
	rr = doJSON(t, http.MethodPost, "/api/v1/lab/requests/"+req["id"].(string)+"/status", techTok,
		map[string]any{"status": "payment"})
	if rr.Code != http.StatusConflict {
		t.Fatalf("transition cancelled status = %d, want 409", rr.Code)
	}
}

func TestLabPermissions(t *testing.T) {
	_, receptionistTok := seedRoleUser(t, "p7-recep1", "receptionist", "E-455")
	_, nurseTok := seedRoleUser(t, "p7-nurse1", "nurse", "E-456")
	_, docTok := seedRoleUser(t, "p7-doc2", "doctor", "E-457")

	// Receptionist has no lab access at all.
	rr := doJSON(t, http.MethodGet, "/api/v1/lab/tests", receptionistTok, nil)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("receptionist list tests status = %d, want 403", rr.Code)
	}
	rr = doJSON(t, http.MethodPost, "/api/v1/lab/tests", receptionistTok, map[string]any{"code": "X"})
	if rr.Code != http.StatusForbidden {
		t.Fatalf("receptionist create test status = %d, want 403", rr.Code)
	}

	// Nurse can view the catalogue but not order.
	rr = doJSON(t, http.MethodGet, "/api/v1/lab/tests", nurseTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("nurse list tests status = %d, want 200", rr.Code)
	}
	rr = doJSON(t, http.MethodPost, "/api/v1/lab/requests", nurseTok, map[string]any{"testIds": []string{"x"}})
	if rr.Code != http.StatusForbidden {
		t.Fatalf("nurse order status = %d, want 403", rr.Code)
	}

	// Doctor can view and order.
	rr = doJSON(t, http.MethodGet, "/api/v1/lab/tests", docTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("doctor list tests status = %d, want 200", rr.Code)
	}
	rr = doJSON(t, http.MethodPost, "/api/v1/lab/requests", docTok, map[string]any{
		"clientId": "00000000-0000-0000-0000-000000000000", "testIds": []string{"00000000-0000-0000-0000-000000000001"},
	})
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("doctor order status = %d, want 422 (permission passed, test missing)", rr.Code)
	}
}
