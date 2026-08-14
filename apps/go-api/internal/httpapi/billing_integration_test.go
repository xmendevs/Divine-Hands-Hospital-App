//go:build integration

package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

// ---- shared helpers ----

func billingPriceList(t *testing.T, token string) map[string]any {
	t.Helper()
	rr := doJSON(t, http.MethodGet, "/api/v1/billing/price-lists", token, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list price lists status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var lists []map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &lists)
	if len(lists) == 0 {
		t.Fatal("no seeded price list")
	}
	return lists[0]
}

func billingItems(t *testing.T, token, priceListID string) []map[string]any {
	t.Helper()
	rr := doJSON(t, http.MethodGet, "/api/v1/billing/price-lists/"+priceListID+"/items", token, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("list price list items status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var items []map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &items)
	return items
}

func createBillingInvoice(t *testing.T, token string, body map[string]any) map[string]any {
	t.Helper()
	rr := doJSON(t, http.MethodPost, "/api/v1/billing/invoices", token, body)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create invoice status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	return resp
}

func issueInvoice(t *testing.T, token, id string) {
	t.Helper()
	rr := doJSON(t, http.MethodPost, "/api/v1/billing/invoices/"+id+"/issue", token, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("issue invoice status = %d, body=%s", rr.Code, rr.Body.String())
	}
}

func openShift(t *testing.T, token string, openingCash float64) map[string]any {
	t.Helper()
	rr := doJSON(t, http.MethodPost, "/api/v1/billing/shifts", token, map[string]any{"openingCash": openingCash})
	if rr.Code != http.StatusCreated {
		t.Fatalf("open shift status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	return resp
}

func payInvoice(t *testing.T, token, invoiceID string, body map[string]any) map[string]any {
	t.Helper()
	rr := doJSON(t, http.MethodPost, "/api/v1/billing/invoices/"+invoiceID+"/payments", token, body)
	if rr.Code != http.StatusCreated {
		t.Fatalf("pay invoice status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	return resp
}

func getInvoice(t *testing.T, token, id string) map[string]any {
	t.Helper()
	rr := doJSON(t, http.MethodGet, "/api/v1/billing/invoices/"+id, token, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("get invoice status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	return resp
}

// ---- lifecycle ----

func TestBillingInvoiceLifecycle(t *testing.T) {
	_, officerTok := seedRoleUser(t, "p8-officer1", "billing_officer", "E-480")
	_, cashierTok := seedRoleUser(t, "p8-cashier1", "cashier", "E-481")

	patient := registerPatient(t, superToken, map[string]any{
		"firstName": "Billing", "lastName": "Patient", "gender": "female",
		"dateOfBirth": "1990-01-01", "phone": "08090001111", "email": "billing-patient@test",
	})
	patientID := patient["id"].(string)
	patientNo := patient["patientNo"].(string)

	pl := billingPriceList(t, officerTok)
	plID := pl["id"].(string)
	items := billingItems(t, officerTok, plID)
	if len(items) < 2 {
		t.Fatalf("seeded price list has %d items, want >= 2", len(items))
	}
	itemA := items[0]["id"].(string)
	itemB := items[1]["id"].(string)

	// Draft invoice, totals computed from the price list.
	inv := createBillingInvoice(t, officerTok, map[string]any{
		"patientId": patientID, "priceListId": plID,
		"billTo": "insurance", "payerName": "HMO Prime", "policyNumber": "POL-8812",
		"items": []map[string]any{
			{"priceListItemId": itemA, "quantity": 2},
			{"priceListItemId": itemB, "quantity": 1},
		},
	})
	invoiceID := inv["id"].(string)
	if !strings.HasPrefix(inv["invoiceNo"].(string), "INV") {
		t.Fatalf("invoiceNo = %q, want INV prefix", inv["invoiceNo"])
	}
	if inv["status"] != "draft" {
		t.Fatalf("status = %v, want draft", inv["status"])
	}
	subtotal := inv["subtotal"].(float64)
	total := inv["totalAmount"].(float64)
	if total <= 0 || subtotal <= 0 {
		t.Fatalf("totals not computed: subtotal=%v total=%v", subtotal, total)
	}
	if len(inv["items"].([]any)) != 2 {
		t.Fatalf("invoice items = %v", inv["items"])
	}

	// Cannot pay a draft invoice.
	rr := doJSON(t, http.MethodPost, "/api/v1/billing/invoices/"+invoiceID+"/payments", cashierTok, map[string]any{
		"amount": total, "method": "cash",
	})
	if rr.Code != http.StatusConflict {
		t.Fatalf("pay draft status = %d, want 409", rr.Code)
	}

	issueInvoice(t, officerTok, invoiceID)

	// Payment without an open shift is blocked.
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/invoices/"+invoiceID+"/payments", cashierTok, map[string]any{
		"amount": total, "method": "cash",
	})
	if rr.Code != http.StatusConflict {
		t.Fatalf("pay without shift status = %d, want 409", rr.Code)
	}

	shift := openShift(t, cashierTok, 2000)
	shiftID := shift["id"].(string)
	if !strings.HasPrefix(shift["shiftNo"].(string), "SFT") {
		t.Fatalf("shiftNo = %q, want SFT prefix", shift["shiftNo"])
	}
	if shift["status"] != "open" {
		t.Fatalf("shift status = %v, want open", shift["status"])
	}

	// A second open shift for the same cashier is rejected.
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/shifts", cashierTok, map[string]any{"openingCash": 0})
	if rr.Code != http.StatusConflict {
		t.Fatalf("duplicate shift status = %d, want 409", rr.Code)
	}

	// Unsupported payment method rejected.
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/invoices/"+invoiceID+"/payments", cashierTok, map[string]any{
		"amount": 100, "method": "bitcoin",
	})
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("bad method status = %d, want 422", rr.Code)
	}

	// Partial cash payment produces a payment, a receipt and a balance.
	partial := total / 2
	resp := payInvoice(t, cashierTok, invoiceID, map[string]any{"amount": partial, "method": "cash"})
	payment := resp["payment"].(map[string]any)
	receipt := resp["receipt"].(map[string]any)
	paymentID := payment["id"].(string)
	receiptID := receipt["id"].(string)
	if !strings.HasPrefix(payment["paymentNo"].(string), "PAY") {
		t.Fatalf("paymentNo = %q, want PAY prefix", payment["paymentNo"])
	}
	if !strings.HasPrefix(receipt["receiptNo"].(string), "RCP") {
		t.Fatalf("receiptNo = %q, want RCP prefix", receipt["receiptNo"])
	}
	if receipt["invoiceNo"] != inv["invoiceNo"] {
		t.Fatalf("receipt invoiceNo = %v, want %v", receipt["invoiceNo"], inv["invoiceNo"])
	}
	if payment["shiftId"] != shiftID {
		t.Fatalf("payment shiftId = %v, want %v", payment["shiftId"], shiftID)
	}

	inv = getInvoice(t, officerTok, invoiceID)
	if inv["status"] != "partially_paid" {
		t.Fatalf("status = %v, want partially_paid", inv["status"])
	}
	if inv["amountPaid"].(float64) != partial {
		t.Fatalf("amountPaid = %v, want %v", inv["amountPaid"], partial)
	}
	if inv["balanceDue"].(float64) != total-partial {
		t.Fatalf("balanceDue = %v, want %v", inv["balanceDue"], total-partial)
	}

	// Overpayment rejected.
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/invoices/"+invoiceID+"/payments", cashierTok, map[string]any{
		"amount": total, "method": "cash",
	})
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("overpay status = %d, want 422", rr.Code)
	}

	// Second payment (transfer) clears the balance.
	resp2 := payInvoice(t, cashierTok, invoiceID, map[string]any{
		"amount": total - partial, "method": "transfer", "reference": "TRF-7788",
	})
	receipt2 := resp2["receipt"].(map[string]any)
	inv = getInvoice(t, officerTok, invoiceID)
	if inv["status"] != "paid" {
		t.Fatalf("status = %v, want paid", inv["status"])
	}
	if inv["balanceDue"].(float64) != 0 {
		t.Fatalf("balanceDue = %v, want 0", inv["balanceDue"])
	}

	// Voiding a paid invoice is rejected.
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/invoices/"+invoiceID+"/void", officerTok, map[string]any{
		"reason": "oops",
	})
	if rr.Code != http.StatusConflict {
		t.Fatalf("void paid status = %d, want 409", rr.Code)
	}

	// Printable HTML receipt.
	rr = doJSON(t, http.MethodGet, "/api/v1/billing/receipts/"+receiptID+"/html", cashierTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("receipt html status = %d", rr.Code)
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte(receipt["receiptNo"].(string))) {
		t.Fatal("HTML receipt does not contain the receipt number")
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte("window.print")) {
		t.Fatal("HTML receipt is not printable")
	}

	// Record a WhatsApp share.
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/receipts/"+receiptID+"/share", cashierTok, map[string]any{
		"shareVia": "whatsapp", "recipient": "08090001111",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("share receipt status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var share map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &share)
	if share["shareVia"] != "whatsapp" || share["recipient"] != "08090001111" {
		t.Fatalf("share = %v", share)
	}

	// Payments and receipts are listable by invoice.
	rr = doJSON(t, http.MethodGet, "/api/v1/billing/payments?invoiceId="+invoiceID, cashierTok, nil)
	if rr.Code != http.StatusOK || len(rr.Body.Bytes()) == 0 {
		t.Fatalf("list payments status = %d", rr.Code)
	}
	rr = doJSON(t, http.MethodGet, "/api/v1/billing/receipts?invoiceId="+invoiceID, cashierTok, nil)
	if rr.Code != http.StatusOK || len(rr.Body.Bytes()) == 0 {
		t.Fatalf("list receipts status = %d", rr.Code)
	}
	_ = receipt2

	// Patient timeline records the invoice issue and the payment.
	rr = doJSON(t, http.MethodGet, "/api/v1/patients/"+patientID+"/timeline", superToken, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("timeline status = %d", rr.Code)
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte("billing_invoice_issued")) {
		t.Fatal("timeline missing billing_invoice_issued")
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte("billing_payment_received")) {
		t.Fatal("timeline missing billing_payment_received")
	}

	// Payments are append-only: UPDATE must be blocked.
	conn, err := pgx.Connect(context.Background(), testDBURL)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(context.Background())
	if _, err := conn.Exec(context.Background(), `UPDATE payments SET amount = 1 WHERE id = $1`, paymentID); err == nil {
		t.Fatal("expected UPDATE on payments to be blocked")
	}
	_ = patientNo
}

// ---- refund workflow ----

func TestBillingRefundWorkflow(t *testing.T) {
	_, officerTok := seedRoleUser(t, "p8-officer2", "billing_officer", "E-482")
	_, cashierTok := seedRoleUser(t, "p8-cashier2", "cashier", "E-483")
	_, supervisorTok := seedRoleUser(t, "p8-super1", "billing_supervisor", "E-484")

	patient := registerPatient(t, superToken, map[string]any{
		"firstName": "Refund", "lastName": "Patient", "gender": "male",
		"dateOfBirth": "1985-05-05", "phone": "08090002222",
	})
	patientID := patient["id"].(string)

	pl := billingPriceList(t, officerTok)
	items := billingItems(t, officerTok, pl["id"].(string))
	inv := createBillingInvoice(t, officerTok, map[string]any{
		"patientId": patientID, "priceListId": pl["id"].(string),
		"items": []map[string]any{{"priceListItemId": items[0]["id"].(string), "quantity": 1}},
	})
	invoiceID := inv["id"].(string)
	total := inv["totalAmount"].(float64)
	issueInvoice(t, officerTok, invoiceID)
	openShift(t, cashierTok, 0)

	payResp := payInvoice(t, cashierTok, invoiceID, map[string]any{"amount": total, "method": "pos"})
	paymentID := payResp["payment"].(map[string]any)["id"].(string)

	// Request a refund of the full payment.
	rr := doJSON(t, http.MethodPost, "/api/v1/billing/payments/"+paymentID+"/refunds", cashierTok, map[string]any{
		"amount": total, "reason": "service not provided",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("request refund status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var req map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &req)
	refundRequestID := req["id"].(string)
	if !strings.HasPrefix(req["refundNo"].(string), "RNF") {
		t.Fatalf("refundNo = %q, want RNF prefix", req["refundNo"])
	}
	if req["status"] != "pending" {
		t.Fatalf("refund status = %v, want pending", req["status"])
	}

	// Cashier has no approve permission: 403 before the self-approval rule.
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/refunds/"+refundRequestID+"/approve", cashierTok, nil)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("cashier approve status = %d, want 403", rr.Code)
	}

	// Requesting more than the refundable amount is blocked.
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/payments/"+paymentID+"/refunds", cashierTok, map[string]any{
		"amount": total, "reason": "again",
	})
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("excess refund status = %d, want 422", rr.Code)
	}

	// Supervisor approves.
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/refunds/"+refundRequestID+"/approve", supervisorTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("approve refund status = %d, body=%s", rr.Code, rr.Body.String())
	}

	// Approving twice is rejected.
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/refunds/"+refundRequestID+"/approve", supervisorTok, nil)
	if rr.Code != http.StatusConflict {
		t.Fatalf("approve twice status = %d, want 409", rr.Code)
	}

	// Process the refund; the invoice balance is restored.
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/refunds/"+refundRequestID+"/process", cashierTok, nil)
	if rr.Code != http.StatusCreated {
		t.Fatalf("process refund status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var refund map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &refund)
	if !strings.HasPrefix(refund["refundNo"].(string), "RFN") {
		t.Fatalf("refundNo = %q, want RFN prefix", refund["refundNo"])
	}

	inv = getInvoice(t, officerTok, invoiceID)
	if inv["amountPaid"].(float64) != 0 {
		t.Fatalf("amountPaid after refund = %v, want 0", inv["amountPaid"])
	}
	if inv["status"] != "issued" {
		t.Fatalf("status after refund = %v, want issued", inv["status"])
	}

	// Refund list reflects the processed request.
	rr = doJSON(t, http.MethodGet, "/api/v1/billing/refunds?status=processed", supervisorTok, nil)
	if rr.Code != http.StatusOK || !bytes.Contains(rr.Body.Bytes(), []byte(refundRequestID)) {
		t.Fatalf("list processed refunds status = %d", rr.Code)
	}

	// Self-approval is blocked for a user with approve permission.
	// Re-pay, then the supervisor requests the refund and tries to approve it.
	payResp2 := payInvoice(t, cashierTok, invoiceID, map[string]any{"amount": total, "method": "cash"})
	paymentID2 := payResp2["payment"].(map[string]any)["id"].(string)
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/payments/"+paymentID2+"/refunds", supervisorTok, map[string]any{
		"amount": total, "reason": "self approval check",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("supervisor request refund status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var selfReq map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &selfReq)
	selfReqID := selfReq["id"].(string)
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/refunds/"+selfReqID+"/approve", supervisorTok, nil)
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("self approve status = %d, want 422", rr.Code)
	}

	// A second supervisor approves instead.
	_, supervisor2Tok := seedRoleUser(t, "p8-super4", "billing_supervisor", "E-494")
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/refunds/"+selfReqID+"/approve", supervisor2Tok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("second supervisor approve status = %d, body=%s", rr.Code, rr.Body.String())
	}
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/refunds/"+selfReqID+"/process", cashierTok, nil)
	if rr.Code != http.StatusCreated {
		t.Fatalf("process self-request refund status = %d", rr.Code)
	}

	// Reject path: a fresh payment, a rejected request cannot be processed.
	payResp3 := payInvoice(t, cashierTok, invoiceID, map[string]any{"amount": total, "method": "cash"})
	paymentID3 := payResp3["payment"].(map[string]any)["id"].(string)
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/payments/"+paymentID3+"/refunds", cashierTok, map[string]any{
		"amount": total, "reason": "cancel",
	})
	var req2 map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &req2)
	rejectID := req2["id"].(string)

	rr = doJSON(t, http.MethodPost, "/api/v1/billing/refunds/"+rejectID+"/reject", supervisorTok, map[string]any{
		"reason": "not eligible",
	})
	if rr.Code != http.StatusOK {
		t.Fatalf("reject refund status = %d, body=%s", rr.Code, rr.Body.String())
	}
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/refunds/"+rejectID+"/process", cashierTok, nil)
	if rr.Code != http.StatusConflict {
		t.Fatalf("process rejected status = %d, want 409", rr.Code)
	}
	_ = paymentID2
}

// ---- reconciliation ----

func TestBillingReconciliation(t *testing.T) {
	_, officerTok := seedRoleUser(t, "p8-officer3", "billing_officer", "E-485")
	_, cashierTok := seedRoleUser(t, "p8-cashier3", "cashier", "E-486")
	_, cashier2Tok := seedRoleUser(t, "p8-cashier4", "cashier", "E-487")
	_, supervisorTok := seedRoleUser(t, "p8-super2", "billing_supervisor", "E-488")

	pl := billingPriceList(t, officerTok)
	item := billingItems(t, officerTok, pl["id"].(string))[0]["id"].(string)

	patient := registerPatient(t, superToken, map[string]any{
		"firstName": "Recon", "lastName": "Patient", "gender": "female",
		"dateOfBirth": "1978-03-03", "phone": "08090003333",
	})
	patientID := patient["id"].(string)

	inv := createBillingInvoice(t, officerTok, map[string]any{
		"patientId": patientID, "priceListId": pl["id"].(string),
		"items": []map[string]any{{"priceListItemId": item, "quantity": 1}},
	})
	invoiceID := inv["id"].(string)
	total := inv["totalAmount"].(float64)
	issueInvoice(t, officerTok, invoiceID)

	shift := openShift(t, cashierTok, 5000)
	shiftID := shift["id"].(string)

	// Cash + transfer income (split so both fit within the balance), then a
	// refund of the transfer payment.
	half := total / 2
	payInvoice(t, cashierTok, invoiceID, map[string]any{"amount": half, "method": "cash"})
	payResp := payInvoice(t, cashierTok, invoiceID, map[string]any{
		"amount": half, "method": "transfer", "reference": "TRF-9911",
	})
	paymentID := payResp["payment"].(map[string]any)["id"].(string)

	rr := doJSON(t, http.MethodPost, "/api/v1/billing/payments/"+paymentID+"/refunds", cashierTok, map[string]any{
		"amount": half, "reason": "duplicate charge",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("request refund status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var req map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &req)
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/refunds/"+req["id"].(string)+"/approve", supervisorTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("approve refund status = %d", rr.Code)
	}
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/refunds/"+req["id"].(string)+"/process", cashierTok, nil)
	if rr.Code != http.StatusCreated {
		t.Fatalf("process refund status = %d", rr.Code)
	}

	// The shift totals break down per method.
	rr = doJSON(t, http.MethodGet, "/api/v1/billing/shifts/"+shiftID, cashierTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("get shift status = %d", rr.Code)
	}
	var sh map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &sh)
	if len(sh["payments"].([]any)) != 2 || len(sh["refunds"].([]any)) != 1 {
		t.Fatalf("shift transactions = payments:%v refunds:%v", sh["payments"], sh["refunds"])
	}
	totals := map[string]map[string]float64{}
	for _, m := range sh["totals"].([]any) {
		entry := m.(map[string]any)
		totals[entry["method"].(string)] = map[string]float64{
			"payments": entry["payments"].(float64),
			"refunds":  entry["refunds"].(float64),
		}
	}
	if totals["cash"]["payments"] != half {
		t.Fatalf("cash payments = %v, want %v", totals["cash"], half)
	}
	if totals["transfer"]["payments"] != half {
		t.Fatalf("transfer payments = %v, want %v", totals["transfer"], half)
	}
	if totals["cash"]["refunds"] != 0 {
		t.Fatalf("cash refunds = %v, want 0", totals["cash"]["refunds"])
	}
	if totals["transfer"]["refunds"] != half {
		t.Fatalf("transfer refunds = %v, want %v", totals["transfer"]["refunds"], half)
	}

	// Only the shift owner can close it.
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/shifts/"+shiftID+"/close", cashier2Tok, map[string]any{
		"closingCash": 0,
	})
	if rr.Code != http.StatusForbidden {
		t.Fatalf("close by non-owner status = %d, want 403", rr.Code)
	}

	// Close: expected = opening + cash payments - cash refunds = 5000 + half - 0.
	expected := 5000 + half
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/shifts/"+shiftID+"/close", cashierTok, map[string]any{
		"closingCash": expected + 500,
	})
	if rr.Code != http.StatusOK {
		t.Fatalf("close shift status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var closed map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &closed)
	if closed["status"] != "closed" {
		t.Fatalf("status = %v, want closed", closed["status"])
	}
	if closed["expectedCash"].(float64) != expected {
		t.Fatalf("expectedCash = %v, want %v", closed["expectedCash"], expected)
	}
	if closed["variance"].(float64) != 500 {
		t.Fatalf("variance = %v, want 500", closed["variance"])
	}

	// Closing again is rejected.
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/shifts/"+shiftID+"/close", cashierTok, map[string]any{
		"closingCash": expected,
	})
	if rr.Code != http.StatusConflict {
		t.Fatalf("close twice status = %d, want 409", rr.Code)
	}

	// No payments can be collected after the shift closes.
	inv2 := createBillingInvoice(t, officerTok, map[string]any{
		"patientId": patientID, "priceListId": pl["id"].(string),
		"items": []map[string]any{{"priceListItemId": item, "quantity": 1}},
	})
	issueInvoice(t, officerTok, inv2["id"].(string))
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/invoices/"+inv2["id"].(string)+"/payments", cashierTok, map[string]any{
		"amount": total, "method": "cash",
	})
	if rr.Code != http.StatusConflict {
		t.Fatalf("pay with closed shift status = %d, want 409", rr.Code)
	}
}

// ---- permissions ----

func TestBillingPermissions(t *testing.T) {
	_, officerTok := seedRoleUser(t, "p8-officer4", "billing_officer", "E-489")
	_, cashierTok := seedRoleUser(t, "p8-cashier5", "cashier", "E-490")
	_, supervisorTok := seedRoleUser(t, "p8-super3", "billing_supervisor", "E-491")
	_, doctorTok := seedRoleUser(t, "p8-doctor1", "doctor", "E-492")
	_, receptionTok := seedRoleUser(t, "p8-reception1", "receptionist", "E-493")

	pl := billingPriceList(t, officerTok)
	item := billingItems(t, officerTok, pl["id"].(string))[0]["id"].(string)
	patient := registerPatient(t, superToken, map[string]any{
		"firstName": "Perm", "lastName": "Patient", "gender": "male",
		"dateOfBirth": "1999-09-09", "phone": "08090004444",
	})
	patientID := patient["id"].(string)

	// Cashier cannot create invoices (create is billing.create, cashier has collect only).
	rr := doJSON(t, http.MethodPost, "/api/v1/billing/invoices", cashierTok, map[string]any{
		"patientId": patientID, "priceListId": pl["id"].(string),
		"items": []map[string]any{{"priceListItemId": item, "quantity": 1}},
	})
	if rr.Code != http.StatusForbidden {
		t.Fatalf("cashier create invoice status = %d, want 403", rr.Code)
	}

	// Doctor (view+create) can create invoices.
	inv := createBillingInvoice(t, doctorTok, map[string]any{
		"patientId": patientID, "priceListId": pl["id"].(string),
		"items": []map[string]any{{"priceListItemId": item, "quantity": 1}},
	})
	invoiceID := inv["id"].(string)
	issueInvoice(t, doctorTok, invoiceID)

	// Doctor cannot collect payments.
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/invoices/"+invoiceID+"/payments", doctorTok, map[string]any{
		"amount": inv["totalAmount"].(float64), "method": "cash",
	})
	if rr.Code != http.StatusForbidden {
		t.Fatalf("doctor pay status = %d, want 403", rr.Code)
	}

	// Supervisor cannot collect or create, but can view and approve.
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/invoices/"+invoiceID+"/payments", supervisorTok, map[string]any{
		"amount": 100, "method": "cash",
	})
	if rr.Code != http.StatusForbidden {
		t.Fatalf("supervisor pay status = %d, want 403", rr.Code)
	}
	rr = doJSON(t, http.MethodGet, "/api/v1/billing/invoices/"+invoiceID, supervisorTok, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("supervisor view status = %d, want 200", rr.Code)
	}

	// Cashier cannot approve refunds.
	openShift(t, cashierTok, 0)
	payResp := payInvoice(t, cashierTok, invoiceID, map[string]any{"amount": inv["totalAmount"].(float64), "method": "cash"})
	paymentID := payResp["payment"].(map[string]any)["id"].(string)
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/payments/"+paymentID+"/refunds", cashierTok, map[string]any{
		"amount": 100, "reason": "overcharge",
	})
	if rr.Code != http.StatusCreated {
		t.Fatalf("request refund status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var req map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &req)
	rr = doJSON(t, http.MethodPost, "/api/v1/billing/refunds/"+req["id"].(string)+"/approve", cashierTok, nil)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("cashier approve status = %d, want 403", rr.Code)
	}

	// Receptionist has no billing permissions at all.
	for _, path := range []string{
		"/api/v1/billing/invoices",
		"/api/v1/billing/price-lists",
		"/api/v1/billing/payments",
	} {
		rr = doJSON(t, http.MethodGet, path, receptionTok, nil)
		if rr.Code != http.StatusForbidden {
			t.Fatalf("receptionist %s status = %d, want 403", path, rr.Code)
		}
	}

	// Unauthenticated access is rejected.
	rr = doJSON(t, http.MethodGet, "/api/v1/billing/invoices", "", nil)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("no token status = %d, want 401", rr.Code)
	}
}
