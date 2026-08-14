//go:build integration

package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
)

func createMedicineAPI(t *testing.T, token string, body map[string]any) map[string]any {
	t.Helper()
	rr := doJSON(t, http.MethodPost, "/api/v1/pharmacy/medicines", token, body)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create medicine status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	return resp
}

func receiveStockAPI(t *testing.T, token string, body map[string]any) map[string]any {
	t.Helper()
	rr := doJSON(t, http.MethodPost, "/api/v1/pharmacy/receipts", token, body)
	if rr.Code != http.StatusCreated {
		t.Fatalf("receive stock status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	return resp
}

func batchQuantities(t *testing.T, token, medicineID string) map[string]float64 {
	t.Helper()
	rr := doJSON(t, http.MethodGet, "/api/v1/pharmacy/medicines/"+medicineID+"/batches", token, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list batches status = %d", rr.Code)
	}
	var batches []map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &batches)
	out := map[string]float64{}
	for _, b := range batches {
		out[b["batchNumber"].(string)] = b["quantityOnHand"].(float64)
	}
	return out
}

func TestPrescriptionToDispensing(t *testing.T) {
	_, pharmTok := seedRoleUser(t, "p5-pharm1", "pharmacist", "E-300")
	_, doctorTok := seedRoleUser(t, "p5-doctor1", "doctor", "E-301")
	p := registerPatient(t, superToken, map[string]any{"firstName": "Dispense", "lastName": "Flow"})
	patientID := p["id"].(string)

	med := createMedicineAPI(t, pharmTok, map[string]any{
		"genericName": "Paracetamol", "sellingPrice": 5,
	})
	medID := med["id"].(string)

	receiveStockAPI(t, pharmTok, map[string]any{
		"medicineId": medID, "batchNumber": "B-001", "expiryDate": "2028-01-01",
		"quantity": 100, "sellingPrice": 5,
	})

	order := createOrderAPI(t, doctorTok, patientID, map[string]any{
		"orderType": "prescription", "submit": true,
		"details": map[string]any{"medication": "Paracetamol"},
	})
	orderID := order["id"].(string)

	rr := doJSON(t, http.MethodPost, "/api/v1/pharmacy/dispense", pharmTok, map[string]any{
		"orderId": orderID,
		"items":   []map[string]any{{"medicineId": medID, "quantity": 20}},
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("dispense status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// Batch reduced from 100 → 80.
	if q := batchQuantities(t, pharmTok, medID)["B-001"]; q != 80 {
		t.Fatalf("batch quantity = %v, want 80", q)
	}

	// Order is now completed; a second dispense is rejected.
	rr = doJSON(t, http.MethodGet, "/api/v1/patients/"+patientID+"/orders", doctorTok, nil)
	if !bytes.Contains(rr.Body.Bytes(), []byte("completed")) {
		t.Fatalf("order not completed: %s", rr.Body.String())
	}
	rr = doJSON(t, http.MethodPost, "/api/v1/pharmacy/dispense", pharmTok, map[string]any{
		"orderId": orderID,
		"items":   []map[string]any{{"medicineId": medID, "quantity": 1}},
	})
	if rr.Code != http.StatusConflict {
		t.Fatalf("second dispense status = %d, want 409", rr.Code)
	}
}

func TestFEFOSelection(t *testing.T) {
	_, pharmTok := seedRoleUser(t, "p5-pharm2", "pharmacist", "E-302")
	_, doctorTok := seedRoleUser(t, "p5-doctor2", "doctor", "E-303")
	p := registerPatient(t, superToken, map[string]any{"firstName": "FEFO", "lastName": "Select"})
	patientID := p["id"].(string)

	med := createMedicineAPI(t, pharmTok, map[string]any{"genericName": "Amoxicillin", "sellingPrice": 10})
	medID := med["id"].(string)

	// Later expiry.
	receiveStockAPI(t, pharmTok, map[string]any{
		"medicineId": medID, "batchNumber": "LATE", "expiryDate": "2028-06-01", "quantity": 10, "sellingPrice": 10,
	})
	// Earlier expiry.
	receiveStockAPI(t, pharmTok, map[string]any{
		"medicineId": medID, "batchNumber": "EARLY", "expiryDate": "2027-01-01", "quantity": 10, "sellingPrice": 10,
	})

	order := createOrderAPI(t, doctorTok, patientID, map[string]any{
		"orderType": "prescription", "submit": true,
	})
	orderID := order["id"].(string)

	rr := doJSON(t, http.MethodPost, "/api/v1/pharmacy/dispense", pharmTok, map[string]any{
		"orderId": orderID,
		"items":   []map[string]any{{"medicineId": medID, "quantity": 15}},
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("dispense status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// FEFO: EARLY batch (earlier expiry) fully consumed, LATE batch reduced to 5.
	quantities := batchQuantities(t, pharmTok, medID)
	if quantities["EARLY"] != 0 {
		t.Fatalf("EARLY batch = %v, want 0", quantities["EARLY"])
	}
	if quantities["LATE"] != 5 {
		t.Fatalf("LATE batch = %v, want 5", quantities["LATE"])
	}
}

func TestBatchExpiryAndQuarantineBlockDispensing(t *testing.T) {
	_, pharmTok := seedRoleUser(t, "p5-pharm3", "pharmacist", "E-304")
	_, doctorTok := seedRoleUser(t, "p5-doctor3", "doctor", "E-305")

	// Expired batch.
	expMed := createMedicineAPI(t, pharmTok, map[string]any{"genericName": "ExpiredDrug"})
	expID := expMed["id"].(string)
	receiveStockAPI(t, pharmTok, map[string]any{
		"medicineId": expID, "batchNumber": "EXP", "expiryDate": "2025-01-01", "quantity": 10,
	})

	// Quarantined batch.
	qrMed := createMedicineAPI(t, pharmTok, map[string]any{"genericName": "QuarantinedDrug"})
	qrID := qrMed["id"].(string)
	batch := receiveStockAPI(t, pharmTok, map[string]any{
		"medicineId": qrID, "batchNumber": "QR", "expiryDate": "2028-01-01", "quantity": 10,
	})
	rr := doJSON(t, http.MethodPost, "/api/v1/pharmacy/batches/"+batch["id"].(string)+"/quarantine", pharmTok, map[string]any{
		"reason": "suspected contamination",
	})
	if rr.Code != http.StatusNoContent {
		t.Fatalf("quarantine status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// Both must fail to dispense.
	for name, medID := range map[string]string{"expired": expID, "quarantined": qrID} {
		p := registerPatient(t, superToken, map[string]any{"firstName": "Block", "lastName": name})
		order := createOrderAPI(t, doctorTok, p["id"].(string), map[string]any{"orderType": "prescription", "submit": true})
		rr = doJSON(t, http.MethodPost, "/api/v1/pharmacy/dispense", pharmTok, map[string]any{
			"orderId": order["id"].(string),
			"items":   []map[string]any{{"medicineId": medID, "quantity": 5}},
		})
		if rr.Code != http.StatusConflict {
			t.Fatalf("dispense %s status = %d, want 409", name, rr.Code)
		}
	}
}

func TestLowStockAndExpiryAlerts(t *testing.T) {
	_, pharmTok := seedRoleUser(t, "p5-pharm4", "pharmacist", "E-306")

	// Low-stock medicine: reorder level 50, only 10 on hand.
	low := createMedicineAPI(t, pharmTok, map[string]any{"genericName": "LowStockDrug", "reorderLevel": 50})
	receiveStockAPI(t, pharmTok, map[string]any{
		"medicineId": low["id"].(string), "batchNumber": "L1", "expiryDate": "2028-01-01", "quantity": 10,
	})

	// Expiring soon (within default 30 days).
	exp := createMedicineAPI(t, pharmTok, map[string]any{"genericName": "ExpiringDrug"})
	receiveStockAPI(t, pharmTok, map[string]any{
		"medicineId": exp["id"].(string), "batchNumber": "E1", "expiryDate": "2026-08-20", "quantity": 5,
	})

	rr := doJSON(t, http.MethodGet, "/api/v1/pharmacy/alerts", pharmTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("alerts status = %d", rr.Code)
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte("LowStockDrug")) {
		t.Fatalf("alerts missing low-stock medicine: %s", rr.Body.String())
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte("ExpiringDrug")) {
		t.Fatalf("alerts missing expiring batch: %s", rr.Body.String())
	}
}

func TestStockAdjustmentApprovalFlow(t *testing.T) {
	_, pharmTok := seedRoleUser(t, "p5-pharm5", "pharmacist", "E-307")
	_, pharm2Tok := seedRoleUser(t, "p5-pharm6", "pharmacist", "E-308")

	med := createMedicineAPI(t, pharmTok, map[string]any{"genericName": "AdjustableDrug"})
	medID := med["id"].(string)
	batch := receiveStockAPI(t, pharmTok, map[string]any{
		"medicineId": medID, "batchNumber": "A1", "expiryDate": "2028-01-01", "quantity": 50,
	})
	batchID := batch["id"].(string)

	rr := doJSON(t, http.MethodPost, "/api/v1/pharmacy/adjustments", pharmTok, map[string]any{
		"medicineId": medID, "batchId": batchID, "quantity": -5, "reason": "damaged during storage",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("adjust status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Adjustment map[string]any `json:"adjustment"`
		Approval   map[string]any `json:"approval"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp.Adjustment["status"] != "pending" {
		t.Fatalf("adjustment status = %v, want pending", resp.Adjustment["status"])
	}
	approvalID := resp.Approval["id"].(string)

	// Self-approval is rejected.
	rr = doJSON(t, http.MethodPost, "/api/v1/approvals/"+approvalID+"/approve", pharmTok, nil)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("self-approve status = %d, want 403", rr.Code)
	}

	// A different pharmacist approves.
	rr = doJSON(t, http.MethodPost, "/api/v1/approvals/"+approvalID+"/approve", pharm2Tok, nil)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("approve status = %d, body=%s", rr.Code, rr.Body.String())
	}

	if q := batchQuantities(t, pharmTok, medID)["A1"]; q != 45 {
		t.Fatalf("batch quantity = %v, want 45", q)
	}
}

func TestConfigurableApprovalDisabled(t *testing.T) {
	_, pharmTok := seedRoleUser(t, "p5-pharm7", "pharmacist", "E-309")

	// Disable the approval requirement.
	rr := doJSON(t, http.MethodPut, "/api/v1/admin/settings/pharmacy.adjustment_approval_required", superToken, map[string]any{"value": false})
	if rr.Code != http.StatusNoContent {
		t.Fatalf("set setting status = %d", rr.Code)
	}
	defer doJSON(t, http.MethodPut, "/api/v1/admin/settings/pharmacy.adjustment_approval_required", superToken, map[string]any{"value": true})

	med := createMedicineAPI(t, pharmTok, map[string]any{"genericName": "NoApprovalDrug"})
	batch := receiveStockAPI(t, pharmTok, map[string]any{
		"medicineId": med["id"].(string), "batchNumber": "N1", "expiryDate": "2028-01-01", "quantity": 50,
	})

	rr = doJSON(t, http.MethodPost, "/api/v1/pharmacy/adjustments", pharmTok, map[string]any{
		"medicineId": med["id"].(string), "batchId": batch["id"].(string), "quantity": 10, "reason": "restock correction",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("adjust status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Adjustment map[string]any `json:"adjustment"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp.Adjustment["status"] != "approved" {
		t.Fatalf("adjustment status = %v, want approved (immediate)", resp.Adjustment["status"])
	}
}

func TestStockCountReconciliation(t *testing.T) {
	_, pharmTok := seedRoleUser(t, "p5-pharm8", "pharmacist", "E-310")

	med := createMedicineAPI(t, pharmTok, map[string]any{"genericName": "CountDrug"})
	medID := med["id"].(string)
	batch := receiveStockAPI(t, pharmTok, map[string]any{
		"medicineId": medID, "batchNumber": "C1", "expiryDate": "2028-01-01", "quantity": 100,
	})
	batchID := batch["id"].(string)

	rr := doJSON(t, http.MethodPost, "/api/v1/pharmacy/counts", pharmTok, map[string]any{
		"batchId": batchID, "countedQuantity": 90,
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("count status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp["variance"].(float64) != -10 {
		t.Fatalf("variance = %v, want -10", resp["variance"])
	}
	if q := batchQuantities(t, pharmTok, medID)["C1"]; q != 90 {
		t.Fatalf("batch quantity = %v, want 90 (reconciled)", q)
	}

	// The variance movement is recorded.
	rr = doJSON(t, http.MethodGet, "/api/v1/pharmacy/movements?medicineId="+medID, pharmTok, nil)
	if !bytes.Contains(rr.Body.Bytes(), []byte("count_variance")) {
		t.Fatalf("movements missing count_variance: %s", rr.Body.String())
	}
}

func TestPharmacyRoleGatingAndAudit(t *testing.T) {
	_, pharmTok := seedRoleUser(t, "p5-pharm9", "pharmacist", "E-311")
	_, nurseTok := seedRoleUser(t, "p5-nurse9", "nurse", "E-312")

	p := registerPatient(t, superToken, map[string]any{"firstName": "Pharm", "lastName": "Gate"})
	patientID := p["id"].(string)

	// Nurse cannot access pharmacy endpoints.
	rr := doJSON(t, http.MethodGet, "/api/v1/pharmacy/medicines", nurseTok, nil)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("nurse medicines status = %d, want 403", rr.Code)
	}

	// Pharmacist cannot view clinical notes (no notes.view / clinical access).
	rr = doJSON(t, http.MethodGet, "/api/v1/patients/"+patientID+"/notes", pharmTok, nil)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("pharmacist notes status = %d, want 403", rr.Code)
	}

	// Audit: medicine create + receipt are recorded.
	createMedicineAPI(t, pharmTok, map[string]any{"genericName": "AuditDrug"})
	rr = doJSON(t, http.MethodGet, "/api/v1/admin/audit-logs", superToken, nil)
	for _, want := range []string{"medicine.create"} {
		if !bytes.Contains(rr.Body.Bytes(), []byte(want)) {
			t.Fatalf("audit missing %q: %s", want, rr.Body.String())
		}
	}
}
