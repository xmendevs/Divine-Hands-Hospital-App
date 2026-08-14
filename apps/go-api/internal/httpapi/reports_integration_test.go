//go:build integration

package httpapi

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// ---- permissions & role scoping ----

func TestReportPermissionScoping(t *testing.T) {
	_, auditorTok := seedRoleUser(t, "p12-auditor1", "auditor", "E-1201")
	_, nurseTok := seedRoleUser(t, "p12-nurse1", "nurse", "E-1202")
	_, receptionTok := seedRoleUser(t, "p12-reception1", "receptionist", "E-1203")
	_, pharmacistTok := seedRoleUser(t, "p12-pharm1", "pharmacist", "E-1204")
	_, cashierTok := seedRoleUser(t, "p12-cashier1", "cashier", "E-1205")
	_, storekeeperTok := seedRoleUser(t, "p12-store1", "storekeeper", "E-1206")

	// auditor holds no reports.view.
	rr := doJSON(t, http.MethodGet, "/api/v1/reports/my", auditorTok, nil)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("auditor my report status = %d, want 403", rr.Code)
	}

	// Role-scoped reports resolve per role.
	checks := []struct {
		token string
		key   string
	}{
		{nurseTok, "admittedPatients"},
		{receptionTok, "registeredToday"},
		{pharmacistTok, "stockOnHand"},
		{cashierTok, "collectedToday"},
		{storekeeperTok, "lowStock"},
	}
	for _, c := range checks {
		rr = doJSON(t, http.MethodGet, "/api/v1/reports/my", c.token, nil)
		if rr.Code != http.StatusOK {
			t.Fatalf("my report status = %d, body=%s", rr.Code, rr.Body.String())
		}
		var body map[string]any
		_ = json.Unmarshal(rr.Body.Bytes(), &body)
		if _, ok := body[c.key]; !ok {
			t.Fatalf("my report missing %q: %s", c.key, rr.Body.String())
		}
	}

	// Super admin sees the aggregate dashboard.
	rr = doJSON(t, http.MethodGet, "/api/v1/reports/dashboard", superToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("dashboard status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var dash map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &dash)
	if _, ok := dash["patientRegistrations"]; !ok {
		t.Fatalf("dashboard missing patientRegistrations: %s", rr.Body.String())
	}
	if _, ok := dash["revenue"]; !ok {
		t.Fatalf("dashboard missing revenue: %s", rr.Body.String())
	}

	// Admin (reports.admin) can also see the dashboard.
	rr = doJSON(t, http.MethodGet, "/api/v1/reports/dashboard", adminToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("admin dashboard status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// Operational roles cannot.
	rr = doJSON(t, http.MethodGet, "/api/v1/reports/dashboard", nurseTok, nil)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("nurse dashboard status = %d, want 403", rr.Code)
	}
}

func TestDashboardMetricsTrackTransactions(t *testing.T) {
	_, officerTok := seedRoleUser(t, "p12-officer1", "billing_officer", "E-1207")
	_, cashierTok := seedRoleUser(t, "p12-cashier2", "cashier", "E-1208")

	before := map[string]any{}
	rr := doJSON(t, http.MethodGet, "/api/v1/reports/dashboard", superToken, nil)
	_ = json.Unmarshal(rr.Body.Bytes(), &before)
	regBefore := before["patientRegistrations"].(map[string]any)["total"].(float64)

	patient := registerPatient(t, superToken, map[string]any{
		"firstName": "Report", "lastName": "Metrics", "gender": "male",
		"dateOfBirth": "1985-05-05",
	})
	patientID := patient["id"].(string)

	// Admit the patient.
	rr = doJSON(t, http.MethodPost, "/api/v1/patients/"+patientID+"/admissions", superToken, map[string]any{
		"ward": "W2", "room": "1", "bed": "A", "admissionReason": "observation",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("admit status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// Invoice and pay (invoices require billing.create; cashier only collects).
	pl := billingPriceList(t, officerTok)
	items := billingItems(t, officerTok, pl["id"].(string))
	inv := createBillingInvoice(t, officerTok, map[string]any{
		"patientId": patientID, "priceListId": pl["id"].(string),
		"items": []map[string]any{{"priceListItemId": items[0]["id"], "quantity": 1}},
	})
	issueInvoice(t, officerTok, inv["id"].(string))
	openShift(t, cashierTok, 0)
	payInvoice(t, cashierTok, inv["id"].(string), map[string]any{
		"method": "cash", "amount": inv["totalAmount"].(float64),
	})

	after := map[string]any{}
	rr = doJSON(t, http.MethodGet, "/api/v1/reports/dashboard", superToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("dashboard status = %d", rr.Code)
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &after)

	reg := after["patientRegistrations"].(map[string]any)
	if reg["total"].(float64) != regBefore+1 {
		t.Fatalf("patientRegistrations.total = %v, want %v", reg["total"], regBefore+1)
	}
	if reg["today"].(float64) < 1 {
		t.Fatalf("patientRegistrations.today = %v, want >= 1", reg["today"])
	}
	admissions := after["admissions"].(map[string]any)
	if admissions["active"].(float64) < 1 {
		t.Fatalf("admissions.active = %v, want >= 1", admissions["active"])
	}
	revenue := after["revenue"].(map[string]any)
	if revenue["collected"].(float64) <= 0 {
		t.Fatalf("revenue.collected = %v, want > 0", revenue["collected"])
	}

	// Cashier report reflects the collection.
	rr = doJSON(t, http.MethodGet, "/api/v1/reports/my", cashierTok, nil)
	var cashier map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &cashier)
	if cashier["paymentsToday"].(float64) < 1 {
		t.Fatalf("cashier paymentsToday = %v, want >= 1", cashier["paymentsToday"])
	}
}

// ---- exports ----

func TestReportExports(t *testing.T) {
	_, nurseTok := seedRoleUser(t, "p12-nurse2", "nurse", "E-1209")

	patient := registerPatient(t, superToken, map[string]any{
		"firstName": "Export", "lastName": "Subject", "gender": "female",
		"dateOfBirth": "2000-01-01", "phone": "08091234567",
	})
	patientNo := patient["patientNo"].(string)

	// CSV export contains header and the registered patient.
	rr := doJSON(t, http.MethodGet,
		"/api/v1/reports/export?report=patients&format=csv", superToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("export status = %d, body=%s", rr.Code, rr.Body.String())
	}
	if ct := rr.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/csv") {
		t.Fatalf("content type = %q, want text/csv", ct)
	}
	if cd := rr.Header().Get("Content-Disposition"); !strings.Contains(cd, "patients") {
		t.Fatalf("content disposition = %q", cd)
	}
	if !strings.Contains(rr.Body.String(), "Patient No") {
		t.Fatal("csv missing header")
	}
	if !strings.Contains(rr.Body.String(), patientNo) {
		t.Fatal("csv missing patient")
	}

	// XLSX export is a zip container (PK\x03\x04 magic).
	rr = doJSON(t, http.MethodGet,
		"/api/v1/reports/export?report=patients&format=xlsx", superToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("xlsx status = %d", rr.Code)
	}
	if !bytes.HasPrefix(rr.Body.Bytes(), []byte("PK\x03\x04")) {
		t.Fatal("xlsx not a zip file")
	}

	// PDF export has the PDF magic.
	rr = doJSON(t, http.MethodGet,
		"/api/v1/reports/export?report=patients&format=pdf", superToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("pdf status = %d", rr.Code)
	}
	if !bytes.HasPrefix(rr.Body.Bytes(), []byte("%PDF")) {
		t.Fatal("pdf missing %PDF header")
	}

	// Date range filtering.
	rr = doJSON(t, http.MethodGet,
		"/api/v1/reports/export?report=patients&from=2000-01-01&to=2999-12-31", superToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("ranged export status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// Validation failures.
	for _, q := range []string{
		"report=nope&format=csv",
		"report=patients&format=docx",
		"report=patients&from=01-01-2026",
		"report=patients&from=2026-02-01&to=2026-01-01",
	} {
		rr = doJSON(t, http.MethodGet, "/api/v1/reports/export?"+q, superToken, nil)
		if rr.Code != http.StatusUnprocessableEntity {
			t.Fatalf("export %q status = %d, want 422", q, rr.Code)
		}
	}

	// Export permission is enforced.
	rr = doJSON(t, http.MethodGet, "/api/v1/reports/export?report=patients", nurseTok, nil)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("nurse export status = %d, want 403", rr.Code)
	}
}

func TestExportIsAudited(t *testing.T) {
	rr := doJSON(t, http.MethodGet,
		"/api/v1/reports/export?report=payments&format=csv&from=2026-01-01", superToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("export status = %d, body=%s", rr.Code, rr.Body.String())
	}

	after := doJSON(t, http.MethodGet, "/api/v1/admin/audit-logs?limit=500", superToken, nil)
	if after.Code != http.StatusOK {
		t.Fatalf("audit logs status = %d", after.Code)
	}

	var entries []map[string]any
	_ = json.Unmarshal(after.Body.Bytes(), &entries)
	found := false
	for _, e := range entries {
		if e["Action"] == "reports.export" {
			raw, _ := base64.StdEncoding.DecodeString(e["Details"].(string))
			var d map[string]any
			_ = json.Unmarshal(raw, &d)
			if d["report"] == "payments" && d["format"] == "csv" {
				found = true
				if _, ok := d["rows"]; !ok {
					t.Fatal("export audit entry missing row count")
				}
			}
		}
	}
	if !found {
		t.Fatal("reports.export audit entry not found")
	}
}
