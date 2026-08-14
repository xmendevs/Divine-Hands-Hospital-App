//go:build integration

package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
)

func createOrderAPI(t *testing.T, token, patientID string, body map[string]any) map[string]any {
	t.Helper()
	rr := doJSON(t, http.MethodPost, "/api/v1/patients/"+patientID+"/orders", token, body)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create order status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	return resp
}

func createNoteAPI(t *testing.T, token, patientID string, body map[string]any) map[string]any {
	t.Helper()
	rr := doJSON(t, http.MethodPost, "/api/v1/patients/"+patientID+"/notes", token, body)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create note status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	return resp
}

func TestDoctorNotesAndOrders(t *testing.T) {
	_, doctorTok := seedRoleUser(t, "p4-doctor1", "doctor", "E-200")
	p := registerPatient(t, superToken, map[string]any{"firstName": "Clinical", "lastName": "Case"})
	id := p["id"].(string)

	// Doctor writes a consultation note with diagnosis + treatment plan.
	note := createNoteAPI(t, doctorTok, id, map[string]any{
		"noteType": "consultation", "note": "Patient presents with fever",
		"diagnosis": "Viral infection", "treatmentPlan": "Rest and fluids",
	})
	if note["authorRole"] != "doctor" {
		t.Fatalf("note authorRole = %v, want doctor", note["authorRole"])
	}
	if note["version"].(float64) != 1 {
		t.Fatalf("note version = %v", note["version"])
	}

	// Doctor prescribes (submitted directly).
	order := createOrderAPI(t, doctorTok, id, map[string]any{
		"orderType": "prescription", "submit": true,
		"details": map[string]any{"medication": "Paracetamol 500mg", "dosage": "1 tab q6h"},
	})
	if order["status"] != "submitted" {
		t.Fatalf("order status = %v, want submitted", order["status"])
	}
	if order["orderNo"].(string) == "" {
		t.Fatal("orderNo empty")
	}
}

func TestNoteImmutableVersions(t *testing.T) {
	_, doctorTok := seedRoleUser(t, "p4-doctor2", "doctor", "E-201")
	p := registerPatient(t, superToken, map[string]any{"firstName": "Note", "lastName": "Version"})
	id := p["id"].(string)

	note := createNoteAPI(t, doctorTok, id, map[string]any{
		"noteType": "consultation", "note": "FIRST version text",
	})
	groupID := note["groupId"].(string)

	rr := doJSON(t, http.MethodPost, "/api/v1/patients/"+id+"/notes/"+groupID+"/versions", doctorTok, map[string]any{
		"note": "SECOND version text",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("add note version status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// Current note list shows only the latest version content.
	rr = doJSON(t, http.MethodGet, "/api/v1/patients/"+id+"/notes", doctorTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list notes status = %d", rr.Code)
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte("SECOND version text")) {
		t.Fatalf("current notes missing latest version: %s", rr.Body.String())
	}

	// Version history retains both versions.
	rr = doJSON(t, http.MethodGet, "/api/v1/patients/"+id+"/notes/"+groupID, doctorTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list versions status = %d", rr.Code)
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte("FIRST version text")) || !bytes.Contains(rr.Body.Bytes(), []byte("SECOND version text")) {
		t.Fatalf("version history missing a version: %s", rr.Body.String())
	}
}

func TestOrderLifecycleAndPrescriptionTraceability(t *testing.T) {
	_, doctorTok := seedRoleUser(t, "p4-doctor3", "doctor", "E-202")
	_, nurseTok := seedRoleUser(t, "p4-nurse3", "nurse", "E-203")
	p := registerPatient(t, superToken, map[string]any{"firstName": "Rx", "lastName": "Lifecycle"})
	id := p["id"].(string)

	// Doctor creates a draft prescription.
	order := createOrderAPI(t, doctorTok, id, map[string]any{
		"orderType": "prescription", "submit": false,
		"details": map[string]any{"medication": "Paracetamol 500mg"},
	})
	orderID := order["id"].(string)

	// Draft → submitted (doctor).
	rr := doJSON(t, http.MethodPost, "/api/v1/orders/"+orderID+"/submit", doctorTok, nil)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("submit status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// submitted → accepted → in_progress (nurse).
	for _, status := range []string{"accepted", "in_progress"} {
		rr = doJSON(t, http.MethodPost, "/api/v1/orders/"+orderID+"/status", nurseTok, map[string]any{"status": status})
		if rr.Code != http.StatusNoContent {
			t.Fatalf("transition to %s status = %d, body=%s", status, rr.Code, rr.Body.String())
		}
	}

	// Nurse administers (medication defaults from order details).
	rr = doJSON(t, http.MethodPost, "/api/v1/patients/"+id+"/administrations", nurseTok, map[string]any{
		"orderId": orderID, "dose": "500mg", "route": "oral",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("administer status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// completed.
	rr = doJSON(t, http.MethodPost, "/api/v1/orders/"+orderID+"/status", nurseTok, map[string]any{"status": "completed"})
	if rr.Code != http.StatusNoContent {
		t.Fatalf("complete status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// Completed is terminal: further transitions must be rejected.
	rr = doJSON(t, http.MethodPost, "/api/v1/orders/"+orderID+"/status", nurseTok, map[string]any{"status": "accepted"})
	if rr.Code != http.StatusConflict {
		t.Fatalf("invalid transition status = %d, want 409", rr.Code)
	}

	// MAR reflects the administered medication.
	rr = doJSON(t, http.MethodGet, "/api/v1/patients/"+id+"/administrations", nurseTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list administrations status = %d", rr.Code)
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte("Paracetamol 500mg")) {
		t.Fatalf("MAR missing medication: %s", rr.Body.String())
	}

	// Order shows completed status.
	rr = doJSON(t, http.MethodGet, "/api/v1/patients/"+id+"/orders", doctorTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list orders status = %d", rr.Code)
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte("completed")) {
		t.Fatalf("order not completed: %s", rr.Body.String())
	}
}

func TestNurseRecordsCareAndRoleGating(t *testing.T) {
	_, doctorTok := seedRoleUser(t, "p4-doctor4", "doctor", "E-204")
	_, nurseTok := seedRoleUser(t, "p4-nurse4", "nurse", "E-205")
	p := registerPatient(t, superToken, map[string]any{"firstName": "Role", "lastName": "Gating"})
	id := p["id"].(string)

	// Nurse records vitals.
	rr := doJSON(t, http.MethodPost, "/api/v1/patients/"+id+"/observations", nurseTok, map[string]any{
		"category": "vitals", "measurements": map[string]any{"temperature": 37.2, "pulse": 80},
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("record vitals status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// Doctor records a nursing note.
	createNoteAPI(t, doctorTok, id, map[string]any{"noteType": "nursing", "note": "Care update"})

	// Role gating: nurse cannot create orders (no orders.create).
	rr = doJSON(t, http.MethodPost, "/api/v1/patients/"+id+"/orders", nurseTok, map[string]any{
		"orderType": "lab_request",
	})
	if rr.Code != http.StatusForbidden {
		t.Fatalf("nurse create order status = %d, want 403", rr.Code)
	}

	// Role gating: doctor cannot record vitals (no vitals.record).
	rr = doJSON(t, http.MethodPost, "/api/v1/patients/"+id+"/observations", doctorTok, map[string]any{
		"measurements": map[string]any{"temperature": 37},
	})
	if rr.Code != http.StatusForbidden {
		t.Fatalf("doctor record vitals status = %d, want 403", rr.Code)
	}
}

func TestAdmissionDischarge(t *testing.T) {
	_, doctorTok := seedRoleUser(t, "p4-doctor5", "doctor", "E-206")
	p := registerPatient(t, superToken, map[string]any{"firstName": "Admit", "lastName": "Discharge"})
	id := p["id"].(string)

	rr := doJSON(t, http.MethodPost, "/api/v1/patients/"+id+"/admissions", doctorTok, map[string]any{
		"ward": "ICU", "room": "2", "bed": "4", "admissionReason": "sepsis",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("admit status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var adm map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &adm)
	admissionID := adm["id"].(string)

	// A second active admission is rejected.
	rr = doJSON(t, http.MethodPost, "/api/v1/patients/"+id+"/admissions", doctorTok, map[string]any{
		"ward": "General",
	})
	if rr.Code != http.StatusConflict {
		t.Fatalf("second admission status = %d, want 409", rr.Code)
	}

	// Discharge.
	rr = doJSON(t, http.MethodPost, "/api/v1/patients/"+id+"/admissions/"+admissionID+"/discharge", doctorTok, map[string]any{
		"dischargeSummary": "Recovered", "followUpInstructions": "Review in 1 week",
	})
	if rr.Code != http.StatusOK {
		t.Fatalf("discharge status = %d, body=%s", rr.Code, rr.Body.String())
	}

	rr = doJSON(t, http.MethodGet, "/api/v1/patients/"+id+"/admissions", doctorTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list admissions status = %d", rr.Code)
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte("discharged")) || !bytes.Contains(rr.Body.Bytes(), []byte("Recovered")) {
		t.Fatalf("admission not discharged: %s", rr.Body.String())
	}
}

func TestEmergencyTriage(t *testing.T) {
	_, receptionistTok := seedRoleUser(t, "p4-receptionist1", "receptionist", "E-207")

	rr := doJSON(t, http.MethodPost, "/api/v1/clinical/triage", receptionistTok, map[string]any{
		"chiefComplaint": "Chest pain", "triageLevel": "1",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("triage status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Patient map[string]any `json:"patient"`
		Triage  map[string]any `json:"triage"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)

	if !patientNoRe["emergency"].MatchString(resp.Patient["patientNo"].(string)) {
		t.Fatalf("triage patientNo = %v", resp.Patient["patientNo"])
	}
	if resp.Triage["chiefComplaint"] != "Chest pain" {
		t.Fatalf("triage chiefComplaint = %v", resp.Triage["chiefComplaint"])
	}
}

func TestTasksAndQueue(t *testing.T) {
	_, doctorTok := seedRoleUser(t, "p4-doctor6", "doctor", "E-208")
	nurseID, nurseTok := seedRoleUser(t, "p4-nurse6", "nurse", "E-209")
	p := registerPatient(t, superToken, map[string]any{"firstName": "Queue", "lastName": "Task"})
	id := p["id"].(string)

	// Doctor assigns the patient to the nurse.
	rr := doJSON(t, http.MethodPost, "/api/v1/patients/"+id+"/assignments", doctorTok, map[string]any{
		"assigneeUserId": nurseID,
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("assign status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// Nurse's queue contains the patient.
	rr = doJSON(t, http.MethodGet, "/api/v1/clinical/queue", nurseTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("queue status = %d", rr.Code)
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte(id)) {
		t.Fatalf("queue missing patient: %s", rr.Body.String())
	}

	// A submitted nursing order auto-creates a task.
	createOrderAPI(t, doctorTok, id, map[string]any{
		"orderType": "nursing_order", "submit": true,
		"details": map[string]any{"title": "Change dressing", "instruction": "Daily wound care"},
	})
	rr = doJSON(t, http.MethodGet, "/api/v1/patients/"+id+"/tasks", doctorTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list tasks status = %d", rr.Code)
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte("Change dressing")) {
		t.Fatalf("auto task missing: %s", rr.Body.String())
	}

	// Extract the task id and complete it as the nurse.
	var tasks []map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &tasks)
	taskID := tasks[0]["id"].(string)
	rr = doJSON(t, http.MethodPost, "/api/v1/tasks/"+taskID+"/complete", nurseTok, nil)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("complete task status = %d, body=%s", rr.Code, rr.Body.String())
	}
}

func TestClinicalAuditEvents(t *testing.T) {
	_, doctorTok := seedRoleUser(t, "p4-doctor7", "doctor", "E-210")
	p := registerPatient(t, superToken, map[string]any{"firstName": "Audit", "lastName": "Clinical"})
	id := p["id"].(string)

	createNoteAPI(t, doctorTok, id, map[string]any{"noteType": "consultation", "note": "Audited note"})
	createOrderAPI(t, doctorTok, id, map[string]any{"orderType": "lab_request", "submit": true})
	doJSON(t, http.MethodPost, "/api/v1/patients/"+id+"/admissions", doctorTok, map[string]any{
		"ward": "General",
	})

	rr := doJSON(t, http.MethodGet, "/api/v1/admin/audit-logs", superToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("audit logs status = %d", rr.Code)
	}
	for _, want := range []string{"note.create", "order.create", "admission.create"} {
		if !bytes.Contains(rr.Body.Bytes(), []byte(want)) {
			t.Fatalf("audit log missing %q: %s", want, rr.Body.String())
		}
	}
}
