//go:build integration

package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
)

func createAssetAPI(t *testing.T, token string, body map[string]any) map[string]any {
	t.Helper()
	rr := doJSON(t, http.MethodPost, "/api/v1/assets", token, body)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create asset status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	return resp
}

func assetCategoryID(t *testing.T, token, code string) string {
	t.Helper()
	rr := doJSON(t, http.MethodGet, "/api/v1/assets/categories", token, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list categories status = %d", rr.Code)
	}
	var categories []map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &categories)
	for _, c := range categories {
		if c["code"] == code {
			return c["id"].(string)
		}
	}
	t.Fatalf("category %q not found", code)
	return ""
}

func getAsset(t *testing.T, token, id string) map[string]any {
	t.Helper()
	rr := doJSON(t, http.MethodGet, "/api/v1/assets/"+id, token, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("get asset status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	return resp
}

func createDepartmentAPI(t *testing.T, code, name string) string {
	t.Helper()
	rr := doJSON(t, http.MethodPost, "/api/v1/admin/departments", superToken, map[string]any{
		"code": code, "name": name,
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create department status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var resp map[string]string
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	return resp["id"]
}

func TestAssetLifecycle(t *testing.T) {
	storeID, storeTok := seedRoleUser(t, "p6-store1", "storekeeper", "E-400")
	_, adminTok := seedRoleUser(t, "p6-admin1", "admin", "E-401")

	instruments := assetCategoryID(t, adminTok, "instruments")
	wardID := createDepartmentAPI(t, "P6-WARD", "P6 Ward")

	asset := createAssetAPI(t, storeTok, map[string]any{
		"name": "Surgical Forceps", "categoryId": instruments,
		"serialNumber": "SF-0001", "manufacturer": "MedCo",
		"purchaseDate": "2025-01-10", "cost": 1200, "condition": "new",
	})
	assetID := asset["id"].(string)
	if asset["assetNo"].(string)[:3] != "AST" {
		t.Fatalf("assetNo = %q, want AST prefix", asset["assetNo"])
	}
	if asset["tracking"] != "unit" || asset["quantityOnHand"].(float64) != 1 {
		t.Fatalf("unit asset tracking/quantity = %v/%v", asset["tracking"], asset["quantityOnHand"])
	}

	// Transfer: assign department + custodian.
	rr := doJSON(t, http.MethodPost, "/api/v1/assets/"+assetID+"/transfer", storeTok, map[string]any{
		"departmentId": wardID, "custodianId": storeID, "location": "P6 Ward Store", "reason": "assign to ward",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("transfer status = %d, body=%s", rr.Code, rr.Body.String())
	}

	detail := getAsset(t, storeTok, assetID)
	a := detail["asset"].(map[string]any)
	if a["departmentId"] != wardID {
		t.Fatalf("departmentId = %v, want %v", a["departmentId"], wardID)
	}
	if len(detail["movements"].([]any)) < 2 {
		t.Fatalf("expected receipt + transfer movements, got %v", detail["movements"])
	}

	// Status: in_use → damaged (auditable) → disposed.
	for _, status := range []string{"in_use", "damaged"} {
		rr := doJSON(t, http.MethodPost, "/api/v1/assets/"+assetID+"/status", storeTok, map[string]any{
			"status": status, "reason": "usage and damage note",
		})
		if rr.Code != http.StatusCreated {
			t.Fatalf("status -> %s got %d, body=%s", status, rr.Code, rr.Body.String())
		}
	}

	detail = getAsset(t, storeTok, assetID)
	history := detail["statusHistory"].([]any)
	last := history[0].(map[string]any)
	if last["toStatus"] != "damaged" {
		t.Fatalf("latest status change = %v, want damaged", last["toStatus"])
	}

	// Damage is auditable: an audit entry exists for the status change.
	rr = doJSON(t, http.MethodGet, "/api/v1/admin/audit-logs", superToken, nil)
	if !bytes.Contains(rr.Body.Bytes(), []byte("asset.status_change")) {
		t.Fatalf("audit log missing asset.status_change: %s", rr.Body.String())
	}

	// Disposed is terminal: further changes are rejected.
	doJSON(t, http.MethodPost, "/api/v1/assets/"+assetID+"/status", storeTok, map[string]any{"status": "disposed", "reason": "end of life"})
	rr = doJSON(t, http.MethodPost, "/api/v1/assets/"+assetID+"/status", storeTok, map[string]any{"status": "available"})
	if rr.Code != http.StatusConflict {
		t.Fatalf("transition from disposed status = %d, want 409", rr.Code)
	}
}

func TestAssetQuantityAdjustAndCount(t *testing.T) {
	_, storeTok := seedRoleUser(t, "p6-store2", "storekeeper", "E-402")

	consumables := assetCategoryID(t, storeTok, "consumables")
	asset := createAssetAPI(t, storeTok, map[string]any{
		"name": "Disposable Gloves", "categoryId": consumables, "quantityOnHand": 100,
	})
	assetID := asset["id"].(string)
	if asset["tracking"] != "quantity" {
		t.Fatalf("tracking = %v, want quantity", asset["tracking"])
	}

	// Adjust -5 → 95.
	rr := doJSON(t, http.MethodPost, "/api/v1/assets/"+assetID+"/adjust", storeTok, map[string]any{
		"quantity": -5, "reason": "damaged packs",
	})
	if rr.Code != http.StatusNoContent {
		t.Fatalf("adjust status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// Physical count: counted 92 → variance -3.
	rr = doJSON(t, http.MethodPost, "/api/v1/assets/counts", storeTok, map[string]any{
		"assetId": assetID, "countedQuantity": 92,
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("count status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var count map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &count)
	if count["variance"].(float64) != -3 {
		t.Fatalf("variance = %v, want -3", count["variance"])
	}

	detail := getAsset(t, storeTok, assetID)
	if a := detail["asset"].(map[string]any); a["quantityOnHand"].(float64) != 92 {
		t.Fatalf("quantityOnHand = %v, want 92", a["quantityOnHand"])
	}
	movements := detail["movements"].([]any)
	if movements[0].(map[string]any)["movementType"] != "count_variance" {
		t.Fatalf("latest movement = %v, want count_variance", movements[0])
	}

	// Over-adjustment is rejected.
	rr = doJSON(t, http.MethodPost, "/api/v1/assets/"+assetID+"/adjust", storeTok, map[string]any{
		"quantity": -200, "reason": "too much",
	})
	if rr.Code != http.StatusConflict {
		t.Fatalf("over-adjust status = %d, want 409", rr.Code)
	}

	// Unit-tracked assets cannot be adjusted.
	unit := createAssetAPI(t, storeTok, map[string]any{
		"name": "Scalpel", "categoryId": assetCategoryID(t, storeTok, "instruments"),
	})
	rr = doJSON(t, http.MethodPost, "/api/v1/assets/"+unit["id"].(string)+"/adjust", storeTok, map[string]any{
		"quantity": -1, "reason": "nope",
	})
	if rr.Code != http.StatusConflict {
		t.Fatalf("unit adjust status = %d, want 409", rr.Code)
	}
}

func TestMaintenanceWorkflow(t *testing.T) {
	_, storeTok := seedRoleUser(t, "p6-store3", "storekeeper", "E-403")

	equipment := assetCategoryID(t, storeTok, "medical_equipment")
	asset := createAssetAPI(t, storeTok, map[string]any{
		"name": "Autoclave A1", "categoryId": equipment, "serialNumber": "AC-2024-1",
	})
	assetID := asset["id"].(string)

	// Service provider.
	rr := doJSON(t, http.MethodPost, "/api/v1/maintenance/service-providers", storeTok, map[string]any{
		"name": "SterilTech Ltd", "contactPhone": "555-0100",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create provider status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var provider map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &provider)
	providerID := provider["id"].(string)

	// Schedule: 30-day service cycle starting tomorrow.
	rr = doJSON(t, http.MethodPost, "/api/v1/maintenance/schedules", storeTok, map[string]any{
		"assetId": assetID, "serviceType": "sterilization cycle", "frequencyDays": 30,
		"nextServiceDate": "2030-01-01",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create schedule status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var schedule map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &schedule)
	scheduleID := schedule["id"].(string)

	// Take the equipment under maintenance, then complete the work.
	doJSON(t, http.MethodPost, "/api/v1/assets/"+assetID+"/status", storeTok, map[string]any{
		"status": "under_maintenance", "reason": "scheduled service",
	})
	rr = doJSON(t, http.MethodPost, "/api/v1/assets/"+assetID+"/maintenance", storeTok, map[string]any{
		"scheduleId": scheduleID, "serviceProviderId": providerID, "serviceType": "sterilization cycle",
		"description": "full cycle", "serviceDate": "2030-01-01", "downtimeHours": 4, "cost": 250,
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("create record status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var record map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &record)
	if record["nextServiceDate"] != "2030-01-31" {
		t.Fatalf("nextServiceDate = %v, want 2030-01-31", record["nextServiceDate"])
	}

	// Serviced asset leaves under_maintenance.
	detail := getAsset(t, storeTok, assetID)
	if a := detail["asset"].(map[string]any); a["status"] != "available" {
		t.Fatalf("status after maintenance = %v, want available", a["status"])
	}

	// Maintenance history exists.
	rr = doJSON(t, http.MethodGet, "/api/v1/assets/"+assetID+"/maintenance", storeTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list maintenance status = %d", rr.Code)
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte("sterilization cycle")) {
		t.Fatalf("maintenance history missing record: %s", rr.Body.String())
	}

	// Due schedules: a past-due schedule surfaces with dueOnly.
	doJSON(t, http.MethodPost, "/api/v1/maintenance/schedules", storeTok, map[string]any{
		"assetId": assetID, "serviceType": "inspection", "frequencyDays": 7,
		"nextServiceDate": "2020-01-01",
	})
	rr = doJSON(t, http.MethodGet, "/api/v1/maintenance/schedules?dueOnly=true", storeTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("due schedules status = %d", rr.Code)
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte("inspection")) {
		t.Fatalf("due schedules missing inspection: %s", rr.Body.String())
	}
}

func TestAssetPermissions(t *testing.T) {
	_, receptionistTok := seedRoleUser(t, "p6-recep1", "receptionist", "E-404")

	rr := doJSON(t, http.MethodPost, "/api/v1/assets", receptionistTok, map[string]any{
		"name": "Denied", "categoryId": "00000000-0000-0000-0000-000000000000",
	})
	if rr.Code != http.StatusForbidden {
		t.Fatalf("receptionist create asset status = %d, want 403", rr.Code)
	}
	rr = doJSON(t, http.MethodGet, "/api/v1/assets", receptionistTok, nil)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("receptionist list assets status = %d, want 403", rr.Code)
	}
}
