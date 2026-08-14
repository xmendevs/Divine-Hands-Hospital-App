//go:build integration

package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/auth"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

var patientNoRe = map[string]*regexp.Regexp{
	"normal":    regexp.MustCompile(`^DHH\d{4,}$`),
	"antenatal": regexp.MustCompile(`^DHHA\d{4,}$`),
	"emergency": regexp.MustCompile(`^DHHE\d{4,}$`),
	"family":    regexp.MustCompile(`^DHHF\d{4,}$`),
}

func seedRoleUser(t *testing.T, username, role, empNo string) (string, string) {
	t.Helper()
	hash, _ := auth.HashPassword("RolePass123!")
	id, err := testStore.CreateUserAccount(context.Background(), store.CreateUserParams{
		Username: username, Email: username + "@test", PasswordHash: hash,
		Status: domain.UserStatusActive, MustChangePassword: false,
		EmployeeNo: empNo, FirstName: "Role", LastName: "User",
		RoleCodes: []string{role},
	})
	if err != nil {
		t.Fatalf("seed %s: %v", role, err)
	}
	return id, makeSession(context.Background(), testStore, id)
}

func registerPatient(t *testing.T, token string, body map[string]any) map[string]any {
	t.Helper()
	rr := doJSON(t, http.MethodPost, "/api/v1/patients", token, body)
	if rr.Code != http.StatusCreated {
		t.Fatalf("register status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode register: %v", err)
	}
	return resp
}

func TestPatientIDFormats(t *testing.T) {
	normal := registerPatient(t, superToken, map[string]any{
		"firstName": "Ada", "lastName": "Lovelace", "gender": "female",
		"dateOfBirth": "1990-01-01",
	})
	if !patientNoRe["normal"].MatchString(normal["patientNo"].(string)) {
		t.Fatalf("normal patientNo = %q", normal["patientNo"])
	}

	antenatal := registerPatient(t, superToken, map[string]any{
		"firstName": "Grace", "lastName": "Hopper", "gender": "female",
		"registrationType": "antenatal",
	})
	if !patientNoRe["antenatal"].MatchString(antenatal["patientNo"].(string)) {
		t.Fatalf("antenatal patientNo = %q", antenatal["patientNo"])
	}

	emergency := registerPatient(t, superToken, map[string]any{
		"firstName": "Alan", "lastName": "Turing", "registrationType": "emergency",
	})
	if !patientNoRe["emergency"].MatchString(emergency["patientNo"].(string)) {
		t.Fatalf("emergency patientNo = %q", emergency["patientNo"])
	}

	// IDs are never duplicated: a second normal registration must differ.
	normal2 := registerPatient(t, superToken, map[string]any{
		"firstName": "Edsger", "lastName": "Dijkstra",
	})
	if normal2["patientNo"] == normal["patientNo"] {
		t.Fatalf("duplicate patientNo %q", normal["patientNo"])
	}
	if !patientNoRe["normal"].MatchString(normal2["patientNo"].(string)) {
		t.Fatalf("second normal patientNo = %q", normal2["patientNo"])
	}
}

func TestDuplicatePatientSafeguard(t *testing.T) {
	base := map[string]any{
		"firstName": "Duplicate", "lastName": "Check", "dateOfBirth": "1985-05-05",
	}
	first := map[string]any{"firstName": "Duplicate", "lastName": "Check", "dateOfBirth": "1985-05-05",
		"identificationNumber": "IDN-001"}
	registerPatient(t, superToken, first)

	// Same identification number → conflict (soft safeguard).
	rr := doJSON(t, http.MethodPost, "/api/v1/patients", superToken, first)
	if rr.Code != http.StatusConflict {
		t.Fatalf("dup ident status = %d, want 409", rr.Code)
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte("duplicate_patient")) {
		t.Fatalf("expected duplicate_patient, got %s", rr.Body.String())
	}

	// Same name + DOB without force → conflict.
	rr = doJSON(t, http.MethodPost, "/api/v1/patients", superToken, base)
	if rr.Code != http.StatusConflict {
		t.Fatalf("dup name/dob status = %d, want 409", rr.Code)
	}

	// force bypasses the soft name/dob check.
	base["force"] = true
	rr = doJSON(t, http.MethodPost, "/api/v1/patients", superToken, base)
	if rr.Code != http.StatusCreated {
		t.Fatalf("forced register status = %d, body=%s", rr.Code, rr.Body.String())
	}
}

func TestSearchPatients(t *testing.T) {
	p := registerPatient(t, superToken, map[string]any{
		"firstName": "Searchable", "lastName": "Person", "phone": "07000001111",
	})
	no := p["patientNo"].(string)

	for _, q := range []string{no, "Searchable", "Person", "07000001111"} {
		rr := doJSON(t, http.MethodGet, "/api/v1/patients/search?q="+q, superToken, nil)
		if rr.Code != http.StatusOK {
			t.Fatalf("search %q status = %d", q, rr.Code)
		}
		if !bytes.Contains(rr.Body.Bytes(), []byte(no)) {
			t.Fatalf("search %q did not return %s: %s", q, no, rr.Body.String())
		}
	}
}

func TestRoleGatedClinicalVisibility(t *testing.T) {
	_, receptionistTok := seedRoleUser(t, "p3-receptionist1", "receptionist", "E-100")
	_, nurseTok := seedRoleUser(t, "p3-nurse1", "nurse", "E-101")

	// Register a patient (receptionist has patients.create).
	p := registerPatient(t, receptionistTok, map[string]any{
		"firstName": "RoleGated", "lastName": "Patient",
	})
	id := p["id"].(string)

	// Nurse adds an allergy.
	rr := doJSON(t, http.MethodPost, "/api/v1/patients/"+id+"/clinical", nurseTok, map[string]any{
		"section": "allergy", "summary": "Penicillin",
		"details": map[string]any{"reaction": "anaphylaxis", "severity": "severe"},
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("add allergy status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// Receptionist cannot view the clinical endpoint.
	rr = doJSON(t, http.MethodGet, "/api/v1/patients/"+id+"/clinical", receptionistTok, nil)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("receptionist clinical status = %d, want 403", rr.Code)
	}

	// Receptionist GET patient has no clinical section.
	rr = doJSON(t, http.MethodGet, "/api/v1/patients/"+id, receptionistTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("receptionist get status = %d", rr.Code)
	}
	if bytes.Contains(rr.Body.Bytes(), []byte("Penicillin")) {
		t.Fatalf("receptionist should not see clinical data: %s", rr.Body.String())
	}

	// Nurse GET patient includes the allergy.
	rr = doJSON(t, http.MethodGet, "/api/v1/patients/"+id, nurseTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("nurse get status = %d", rr.Code)
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte("Penicillin")) {
		t.Fatalf("nurse should see allergy: %s", rr.Body.String())
	}
}

func TestTimelineAndAmendments(t *testing.T) {
	_, nurseTok := seedRoleUser(t, "p3-nurse2", "nurse", "E-102")
	_, matronTok := seedRoleUser(t, "p3-matron1", "matron", "E-103")

	p := registerPatient(t, superToken, map[string]any{
		"firstName": "Timeline", "lastName": "Patient",
	})
	id := p["id"].(string)

	// Add an allergy, then amend it (matron holds patients.amend).
	rr := doJSON(t, http.MethodPost, "/api/v1/patients/"+id+"/clinical", nurseTok, map[string]any{
		"section": "allergy", "summary": "Peanuts",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("add allergy status = %d", rr.Code)
	}
	var created map[string]string
	_ = json.Unmarshal(rr.Body.Bytes(), &created)
	entryID := created["id"]

	rr = doJSON(t, http.MethodPatch, "/api/v1/patients/"+id+"/clinical/"+entryID, matronTok, map[string]any{
		"summary": "Peanut (legume)", "reason": "clarified allergen",
	})
	if rr.Code != http.StatusNoContent {
		t.Fatalf("amend clinical status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// The amendment record must capture before/after.
	conn, err := pgx.Connect(context.Background(), testDBURL)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(context.Background())
	var prevJSON, newJSON []byte
	err = conn.QueryRow(context.Background(), `
		SELECT previous_value, new_value FROM patient_amendments
		WHERE patient_id = $1::uuid ORDER BY created_at DESC LIMIT 1`, id).
		Scan(&prevJSON, &newJSON)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(prevJSON, []byte("Peanuts")) {
		t.Fatalf("amendment previous value missing original: %s", prevJSON)
	}
	if !bytes.Contains(newJSON, []byte("Peanut (legume)")) {
		t.Fatalf("amendment new value missing correction: %s", newJSON)
	}

	// Timeline captures registration, clinical_added, and clinical_amended.
	rr = doJSON(t, http.MethodGet, "/api/v1/patients/"+id+"/timeline", superToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("timeline status = %d", rr.Code)
	}
	for _, want := range []string{"registration", "clinical_added", "clinical_amended"} {
		if !bytes.Contains(rr.Body.Bytes(), []byte(want)) {
			t.Fatalf("timeline missing %q: %s", want, rr.Body.String())
		}
	}
}

func TestFamilyProfiles(t *testing.T) {
	// Head patient must exist first.
	head := registerPatient(t, superToken, map[string]any{
		"firstName": "Family", "lastName": "Head",
	})
	headID := head["id"].(string)

	rr := doJSON(t, http.MethodPost, "/api/v1/families", superToken, map[string]any{
		"familyName": "The Head Family", "headPatientId": headID,
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create family status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var fam struct {
		ID       string `json:"id"`
		FamilyNo string `json:"familyNo"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &fam)
	if !patientNoRe["family"].MatchString(fam.FamilyNo) {
		t.Fatalf("familyNo = %q", fam.FamilyNo)
	}

	// The head patient is linked as a member.
	rr = doJSON(t, http.MethodGet, "/api/v1/families/"+fam.ID, superToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("get family status = %d", rr.Code)
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte(headID)) {
		t.Fatalf("family members missing head patient: %s", rr.Body.String())
	}
}

func TestPatientAuditEvents(t *testing.T) {
	p := registerPatient(t, superToken, map[string]any{
		"firstName": "Audited", "lastName": "Patient",
	})
	id := p["id"].(string)

	// Amend a patient-level field.
	rr := doJSON(t, http.MethodPost, "/api/v1/patients/"+id+"/amend", superToken, map[string]any{
		"fieldName": "bloodGroup", "newValue": "O+", "reason": "lab result correction",
	})
	if rr.Code != http.StatusNoContent {
		t.Fatalf("amend patient status = %d, body=%s", rr.Code, rr.Body.String())
	}

	rr = doJSON(t, http.MethodGet, "/api/v1/admin/audit-logs", superToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("audit logs status = %d", rr.Code)
	}
	for _, want := range []string{"patient.create", "patient.amend"} {
		if !bytes.Contains(rr.Body.Bytes(), []byte(want)) {
			t.Fatalf("audit log missing %q: %s", want, rr.Body.String())
		}
	}
}
