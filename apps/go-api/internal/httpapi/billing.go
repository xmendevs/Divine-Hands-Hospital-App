package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/pdf"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

// ---- price lists ----

type priceListResponse struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Currency    string  `json:"currency"`
	Description string  `json:"description,omitempty"`
	ValidFrom   *string `json:"validFrom,omitempty"`
	ValidTo     *string `json:"validTo,omitempty"`
	Status      string  `json:"status"`
	CreatedBy   *string `json:"createdBy,omitempty"`
	CreatedAt   string  `json:"createdAt"`
	UpdatedAt   string  `json:"updatedAt"`
}

func newPriceListResponse(p *domain.PriceList) priceListResponse {
	return priceListResponse{
		ID:          p.ID,
		Name:        p.Name,
		Currency:    p.Currency,
		Description: p.Description,
		ValidFrom:   p.ValidFrom,
		ValidTo:     p.ValidTo,
		Status:      p.Status,
		CreatedBy:   p.CreatedBy,
		CreatedAt:   p.CreatedAt.UTC().Format(timeRFC3339),
		UpdatedAt:   p.UpdatedAt.UTC().Format(timeRFC3339),
	}
}

type priceListItemResponse struct {
	ID          string  `json:"id"`
	PriceListID string  `json:"priceListId"`
	Code        string  `json:"code"`
	Name        string  `json:"name"`
	Category    string  `json:"category,omitempty"`
	Unit        string  `json:"unit,omitempty"`
	Price       float64 `json:"price"`
	TaxRate     float64 `json:"taxRate"`
	Active      bool    `json:"active"`
	CreatedAt   string  `json:"createdAt"`
	UpdatedAt   string  `json:"updatedAt"`
}

func newPriceListItemResponse(i *domain.PriceListItem) priceListItemResponse {
	return priceListItemResponse{
		ID:          i.ID,
		PriceListID: i.PriceListID,
		Code:        i.Code,
		Name:        i.Name,
		Category:    i.Category,
		Unit:        i.Unit,
		Price:       i.Price,
		TaxRate:     i.TaxRate,
		Active:      i.Active,
		CreatedAt:   i.CreatedAt.UTC().Format(timeRFC3339),
		UpdatedAt:   i.UpdatedAt.UTC().Format(timeRFC3339),
	}
}

func (s *server) handleListPriceLists(w http.ResponseWriter, r *http.Request) {
	lists, err := s.store.ListPriceLists(r.Context())
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]priceListResponse, 0, len(lists))
	for _, p := range lists {
		out = append(out, newPriceListResponse(&p))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *server) handleGetPriceList(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.GetPriceList(r.Context(), r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "price list not found")
		return
	}
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, newPriceListResponse(p))
}

type createPriceListRequest struct {
	Name        string `json:"name"`
	Currency    string `json:"currency"`
	Description string `json:"description"`
	ValidFrom   string `json:"validFrom"`
	ValidTo     string `json:"validTo"`
}

func (s *server) handleCreatePriceList(w http.ResponseWriter, r *http.Request) {
	var req createPriceListRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Name == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "name is required")
		return
	}
	actor := userFromContext(r.Context())
	p, err := s.store.CreatePriceList(r.Context(), store.CreatePriceListParams{
		Name:        req.Name,
		Currency:    req.Currency,
		Description: req.Description,
		ValidFrom:   req.ValidFrom,
		ValidTo:     req.ValidTo,
		CreatedBy:   actor.ID,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionBillingPriceListCreate, "price_list", p.ID, nil, map[string]any{
		"name": p.Name, "currency": p.Currency,
	})
	writeJSON(w, http.StatusCreated, newPriceListResponse(p))
}

type updatePriceListRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	ValidFrom   string `json:"validFrom"`
	ValidTo     string `json:"validTo"`
	Status      string `json:"status"`
}

func (s *server) handleUpdatePriceList(w http.ResponseWriter, r *http.Request) {
	var req updatePriceListRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Name == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "name is required")
		return
	}
	switch req.Status {
	case domain.BillingPriceListActive, domain.BillingPriceListInactive:
	default:
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "status must be active or inactive")
		return
	}
	id := r.PathValue("id")
	if err := s.store.UpdatePriceList(r.Context(), id, store.UpdatePriceListParams{
		Name:        req.Name,
		Description: req.Description,
		ValidFrom:   req.ValidFrom,
		ValidTo:     req.ValidTo,
		Status:      req.Status,
	}); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "price list not found")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionBillingPriceListUpdate, "price_list", id, nil, map[string]any{"name": req.Name})
	writeJSON(w, http.StatusOK, map[string]any{"id": id})
}

func (s *server) handleListPriceListItems(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.ListPriceListItems(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]priceListItemResponse, 0, len(items))
	for _, i := range items {
		out = append(out, newPriceListItemResponse(&i))
	}
	writeJSON(w, http.StatusOK, out)
}

type createPriceListItemRequest struct {
	Code     string  `json:"code"`
	Name     string  `json:"name"`
	Category string  `json:"category"`
	Unit     string  `json:"unit"`
	Price    float64 `json:"price"`
	TaxRate  float64 `json:"taxRate"`
}

func (s *server) handleCreatePriceListItem(w http.ResponseWriter, r *http.Request) {
	var req createPriceListItemRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Code == "" || req.Name == "" || req.Price < 0 {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "code, name and a non-negative price are required")
		return
	}
	id := r.PathValue("id")
	item, err := s.store.CreatePriceListItem(r.Context(), store.CreatePriceListItemParams{
		PriceListID: id,
		Code:        req.Code,
		Name:        req.Name,
		Category:    req.Category,
		Unit:        req.Unit,
		Price:       req.Price,
		TaxRate:     req.TaxRate,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionBillingItemCreate, "price_list_item", item.ID, nil, map[string]any{
		"code": item.Code, "name": item.Name, "priceListId": id,
	})
	writeJSON(w, http.StatusCreated, newPriceListItemResponse(item))
}

type updatePriceListItemRequest struct {
	Code     string  `json:"code"`
	Name     string  `json:"name"`
	Category string  `json:"category"`
	Unit     string  `json:"unit"`
	Price    float64 `json:"price"`
	TaxRate  float64 `json:"taxRate"`
	Active   bool    `json:"active"`
}

func (s *server) handleUpdatePriceListItem(w http.ResponseWriter, r *http.Request) {
	var req updatePriceListItemRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Code == "" || req.Name == "" || req.Price < 0 {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "code, name and a non-negative price are required")
		return
	}
	id := r.PathValue("id")
	if err := s.store.UpdatePriceListItem(r.Context(), id, store.UpdatePriceListItemParams{
		Code:     req.Code,
		Name:     req.Name,
		Category: req.Category,
		Unit:     req.Unit,
		Price:    req.Price,
		TaxRate:  req.TaxRate,
		Active:   req.Active,
	}); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "price list item not found")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionBillingItemUpdate, "price_list_item", id, nil, map[string]any{"code": req.Code})
	writeJSON(w, http.StatusOK, map[string]any{"id": id})
}

// ---- invoices ----

type invoiceItemResponse struct {
	ID              string  `json:"id"`
	InvoiceID       string  `json:"invoiceId"`
	PriceListItemID *string `json:"priceListItemId,omitempty"`
	Code            string  `json:"code"`
	Name            string  `json:"name"`
	Category        string  `json:"category,omitempty"`
	Unit            string  `json:"unit,omitempty"`
	Quantity        float64 `json:"quantity"`
	UnitPrice       float64 `json:"unitPrice"`
	TaxRate         float64 `json:"taxRate"`
	LineTotal       float64 `json:"lineTotal"`
	TaxAmount       float64 `json:"taxAmount"`
}

func newInvoiceItemResponse(i *domain.InvoiceItem) invoiceItemResponse {
	return invoiceItemResponse{
		ID:              i.ID,
		InvoiceID:       i.InvoiceID,
		PriceListItemID: i.PriceListItemID,
		Code:            i.Code,
		Name:            i.Name,
		Category:        i.Category,
		Unit:            i.Unit,
		Quantity:        i.Quantity,
		UnitPrice:       i.UnitPrice,
		TaxRate:         i.TaxRate,
		LineTotal:       i.LineTotal,
		TaxAmount:       i.TaxAmount,
	}
}

type invoiceResponse struct {
	ID             string                `json:"id"`
	InvoiceNo      string                `json:"invoiceNo"`
	PatientID      *string               `json:"patientId,omitempty"`
	PatientNo      string                `json:"patientNo,omitempty"`
	PatientName    string                `json:"patientName,omitempty"`
	PriceListID    *string               `json:"priceListId,omitempty"`
	Currency       string                `json:"currency"`
	BillTo         string                `json:"billTo"`
	PayerName      string                `json:"payerName,omitempty"`
	PolicyNumber   string                `json:"policyNumber,omitempty"`
	Subtotal       float64               `json:"subtotal"`
	DiscountAmount float64               `json:"discountAmount"`
	TaxAmount      float64               `json:"taxAmount"`
	TotalAmount    float64               `json:"totalAmount"`
	AmountPaid     float64               `json:"amountPaid"`
	BalanceDue     float64               `json:"balanceDue"`
	Status         string                `json:"status"`
	IssuedBy       *string               `json:"issuedBy,omitempty"`
	IssuedAt       *string               `json:"issuedAt,omitempty"`
	VoidReason     string                `json:"voidReason,omitempty"`
	VoidedBy       *string               `json:"voidedBy,omitempty"`
	VoidedAt       *string               `json:"voidedAt,omitempty"`
	CreatedAt      string                `json:"createdAt"`
	UpdatedAt      string                `json:"updatedAt"`
	Items          []invoiceItemResponse `json:"items,omitempty"`
}

func newInvoiceResponse(i *domain.Invoice) invoiceResponse {
	out := invoiceResponse{
		ID:             i.ID,
		InvoiceNo:      i.InvoiceNo,
		PatientID:      i.PatientID,
		PatientNo:      i.PatientNo,
		PatientName:    i.PatientName,
		PriceListID:    i.PriceListID,
		Currency:       i.Currency,
		BillTo:         i.BillTo,
		PayerName:      i.PayerName,
		PolicyNumber:   i.PolicyNumber,
		Subtotal:       i.Subtotal,
		DiscountAmount: i.DiscountAmount,
		TaxAmount:      i.TaxAmount,
		TotalAmount:    i.TotalAmount,
		AmountPaid:     i.AmountPaid,
		BalanceDue:     i.TotalAmount - i.AmountPaid,
		Status:         i.Status,
		IssuedBy:       i.IssuedBy,
		VoidReason:     i.VoidReason,
		VoidedBy:       i.VoidedBy,
		CreatedAt:      i.CreatedAt.UTC().Format(timeRFC3339),
		UpdatedAt:      i.UpdatedAt.UTC().Format(timeRFC3339),
	}
	if i.IssuedAt != nil {
		v := i.IssuedAt.UTC().Format(timeRFC3339)
		out.IssuedAt = &v
	}
	if i.VoidedAt != nil {
		v := i.VoidedAt.UTC().Format(timeRFC3339)
		out.VoidedAt = &v
	}
	out.Items = make([]invoiceItemResponse, 0, len(i.Items))
	for idx := range i.Items {
		out.Items = append(out.Items, newInvoiceItemResponse(&i.Items[idx]))
	}
	return out
}

type createInvoiceRequest struct {
	PatientID      string  `json:"patientId"`
	PriceListID    string  `json:"priceListId"`
	BillTo         string  `json:"billTo"`
	PayerName      string  `json:"payerName"`
	PolicyNumber   string  `json:"policyNumber"`
	DiscountAmount float64 `json:"discountAmount"`
	Items          []struct {
		PriceListItemID string  `json:"priceListItemId"`
		Quantity        float64 `json:"quantity"`
	} `json:"items"`
}

func (s *server) handleCreateInvoice(w http.ResponseWriter, r *http.Request) {
	var req createInvoiceRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.PriceListID == "" || len(req.Items) == 0 {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "priceListId and at least one item are required")
		return
	}
	switch req.BillTo {
	case "", domain.BillingBillToPatient:
		req.BillTo = domain.BillingBillToPatient
	case domain.BillingBillToInsurance, domain.BillingBillToCorporate:
	default:
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "billTo must be patient, insurance or corporate")
		return
	}
	inputs := make([]store.InvoiceItemInput, 0, len(req.Items))
	for _, it := range req.Items {
		if it.PriceListItemID == "" {
			writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "every item needs a priceListItemId")
			return
		}
		if it.Quantity <= 0 {
			writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "quantity must be positive")
			return
		}
		inputs = append(inputs, store.InvoiceItemInput{PriceListItemID: it.PriceListItemID, Quantity: it.Quantity})
	}
	if req.DiscountAmount < 0 {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "discountAmount cannot be negative")
		return
	}
	actor := userFromContext(r.Context())
	var patientID *string
	if req.PatientID != "" {
		patientID = &req.PatientID
	}
	inv, err := s.store.CreateInvoice(r.Context(), store.CreateInvoiceParams{
		PatientID:      patientID,
		PriceListID:    req.PriceListID,
		BillTo:         req.BillTo,
		PayerName:      req.PayerName,
		PolicyNumber:   req.PolicyNumber,
		DiscountAmount: req.DiscountAmount,
		Items:          inputs,
		CreatedBy:      actor.ID,
	})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "price list or item not found")
			return
		}
		if errors.Is(err, store.ErrInvalidBillingTransition) {
			writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "price list is inactive")
			return
		}
		if errors.Is(err, store.ErrDiscountExceedsSubtotal) {
			writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "discount cannot exceed subtotal")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionBillingInvoiceCreate, "invoice", inv.ID, nil, map[string]any{
		"invoiceNo": inv.InvoiceNo, "total": inv.TotalAmount, "currency": inv.Currency,
	})
	writeJSON(w, http.StatusCreated, newInvoiceResponse(inv))
}

func (s *server) handleListInvoices(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)
	invoices, err := s.store.ListInvoices(r.Context(), store.ListInvoicesParams{
		Status:  r.URL.Query().Get("status"),
		Patient: r.URL.Query().Get("patientId"),
		Limit:   limit,
		Offset:  offset,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]invoiceResponse, 0, len(invoices))
	for _, inv := range invoices {
		out = append(out, newInvoiceResponse(&inv))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *server) handleGetInvoice(w http.ResponseWriter, r *http.Request) {
	inv, err := s.store.GetInvoice(r.Context(), r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "invoice not found")
		return
	}
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionBillingViewed, "invoice", inv.ID, nil, map[string]any{"invoiceNo": inv.InvoiceNo})
	writeJSON(w, http.StatusOK, newInvoiceResponse(inv))
}

func (s *server) handleIssueInvoice(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	id := r.PathValue("id")
	if err := s.store.IssueInvoice(r.Context(), id, actor.ID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "invoice not found")
			return
		}
		if errors.Is(err, store.ErrInvalidBillingTransition) {
			writeError(w, r, http.StatusConflict, "invalid_transition", "only draft invoices can be issued")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionBillingInvoiceIssue, "invoice", id, nil, nil)
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": domain.BillingInvoiceStatusIssued})
}

type voidInvoiceRequest struct {
	Reason string `json:"reason"`
}

func (s *server) handleVoidInvoice(w http.ResponseWriter, r *http.Request) {
	var req voidInvoiceRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Reason == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "reason is required")
		return
	}
	actor := userFromContext(r.Context())
	id := r.PathValue("id")
	if err := s.store.VoidInvoice(r.Context(), id, req.Reason, actor.ID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "invoice not found")
			return
		}
		if errors.Is(err, store.ErrInvalidBillingTransition) {
			writeError(w, r, http.StatusConflict, "invalid_transition", "invoice cannot be voided (paid or already voided)")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionBillingInvoiceVoid, "invoice", id, nil, map[string]any{"reason": req.Reason})
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": domain.BillingInvoiceStatusVoided})
}

// ---- payments & receipts ----

type paymentResponse struct {
	ID          string  `json:"id"`
	PaymentNo   string  `json:"paymentNo"`
	InvoiceID   string  `json:"invoiceId"`
	InvoiceNo   string  `json:"invoiceNo,omitempty"`
	PatientID   *string `json:"patientId,omitempty"`
	PatientName string  `json:"patientName,omitempty"`
	ShiftID     *string `json:"shiftId,omitempty"`
	Amount      float64 `json:"amount"`
	Method      string  `json:"method"`
	Reference   string  `json:"reference,omitempty"`
	ReceivedBy  string  `json:"receivedBy"`
	ReceivedAt  string  `json:"receivedAt"`
	Notes       string  `json:"notes,omitempty"`
}

func newPaymentResponse(p *domain.Payment) paymentResponse {
	return paymentResponse{
		ID:          p.ID,
		PaymentNo:   p.PaymentNo,
		InvoiceID:   p.InvoiceID,
		InvoiceNo:   p.InvoiceNo,
		PatientID:   p.PatientID,
		PatientName: p.PatientName,
		ShiftID:     p.ShiftID,
		Amount:      p.Amount,
		Method:      p.Method,
		Reference:   p.Reference,
		ReceivedBy:  p.ReceivedBy,
		ReceivedAt:  p.ReceivedAt.UTC().Format(timeRFC3339),
		Notes:       p.Notes,
	}
}

type receivePaymentRequest struct {
	Amount    float64 `json:"amount"`
	Method    string  `json:"method"`
	Reference string  `json:"reference"`
	Notes     string  `json:"notes"`
}

func (s *server) handleReceivePayment(w http.ResponseWriter, r *http.Request) {
	var req receivePaymentRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Amount <= 0 || req.Method == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "amount and method are required")
		return
	}
	actor := userFromContext(r.Context())
	payment, receipt, err := s.store.ReceivePayment(r.Context(), store.ReceivePaymentParams{
		InvoiceID:  r.PathValue("id"),
		Amount:     req.Amount,
		Method:     req.Method,
		Reference:  req.Reference,
		Notes:      req.Notes,
		ReceivedBy: actor.ID,
	})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "invoice not found")
			return
		}
		if errors.Is(err, store.ErrShiftRequired) {
			writeError(w, r, http.StatusConflict, "shift_required", "open a cashier shift first")
			return
		}
		if errors.Is(err, store.ErrInvalidBillingTransition) {
			writeError(w, r, http.StatusConflict, "invalid_transition", "invoice is not payable")
			return
		}
		if errors.Is(err, store.ErrOverpayment) {
			writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "payment exceeds balance due")
			return
		}
		if errors.Is(err, store.ErrInvalidPaymentMethod) {
			writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "unsupported payment method")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionBillingPaymentReceive, "payment", payment.ID, nil, map[string]any{
		"paymentNo": payment.PaymentNo, "amount": payment.Amount, "method": payment.Method,
	})
	writeJSON(w, http.StatusCreated, map[string]any{
		"payment": newPaymentResponse(payment),
		"receipt": newReceiptResponse(receipt),
	})
}

func (s *server) handleListPayments(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)
	payments, err := s.store.ListPayments(r.Context(), store.ListPaymentsParams{
		InvoiceID: r.URL.Query().Get("invoiceId"),
		ShiftID:   r.URL.Query().Get("shiftId"),
		Method:    r.URL.Query().Get("method"),
		Patient:   r.URL.Query().Get("patientId"),
		Limit:     limit,
		Offset:    offset,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]paymentResponse, 0, len(payments))
	for _, p := range payments {
		out = append(out, newPaymentResponse(&p))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *server) handleGetPayment(w http.ResponseWriter, r *http.Request) {
	p, err := s.store.GetPayment(r.Context(), r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "payment not found")
		return
	}
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, newPaymentResponse(p))
}

type receiptItemResponse struct {
	Code      string  `json:"code"`
	Name      string  `json:"name"`
	Quantity  float64 `json:"quantity"`
	UnitPrice float64 `json:"unitPrice"`
	LineTotal float64 `json:"lineTotal"`
}

type receiptResponse struct {
	ID          string                `json:"id"`
	ReceiptNo   string                `json:"receiptNo"`
	PaymentID   string                `json:"paymentId"`
	InvoiceID   string                `json:"invoiceId"`
	InvoiceNo   string                `json:"invoiceNo"`
	PatientID   *string               `json:"patientId,omitempty"`
	PatientName string                `json:"patientName,omitempty"`
	BillTo      string                `json:"billTo"`
	PayerName   string                `json:"payerName,omitempty"`
	Amount      float64               `json:"amount"`
	Method      string                `json:"method"`
	Reference   string                `json:"reference,omitempty"`
	Currency    string                `json:"currency"`
	ReceivedBy  string                `json:"receivedBy"`
	IssuedBy    string                `json:"issuedBy"`
	IssuedAt    string                `json:"issuedAt"`
	TotalAmount float64               `json:"totalAmount"`
	AmountPaid  float64               `json:"amountPaid"`
	Items       []receiptItemResponse `json:"items,omitempty"`
}

func newReceiptResponse(re *domain.Receipt) receiptResponse {
	out := receiptResponse{
		ID:          re.ID,
		ReceiptNo:   re.ReceiptNo,
		PaymentID:   re.PaymentID,
		InvoiceID:   re.InvoiceID,
		InvoiceNo:   re.InvoiceNo,
		PatientID:   re.PatientID,
		PatientName: re.PatientName,
		BillTo:      re.BillTo,
		PayerName:   re.PayerName,
		Amount:      re.Amount,
		Method:      re.Method,
		Reference:   re.Reference,
		Currency:    re.Currency,
		ReceivedBy:  re.ReceivedBy,
		IssuedBy:    re.IssuedBy,
		IssuedAt:    re.IssuedAt.UTC().Format(timeRFC3339),
		TotalAmount: re.TotalAmount,
		AmountPaid:  re.AmountPaid,
	}
	out.Items = make([]receiptItemResponse, 0, len(re.Items))
	for _, it := range re.Items {
		out.Items = append(out.Items, receiptItemResponse{
			Code: it.Code, Name: it.Name, Quantity: it.Quantity,
			UnitPrice: it.UnitPrice, LineTotal: it.LineTotal,
		})
	}
	return out
}

func (s *server) handleListReceipts(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)
	receipts, err := s.store.ListReceipts(r.Context(), store.ListReceiptsParams{
		InvoiceID: r.URL.Query().Get("invoiceId"),
		Limit:     limit,
		Offset:    offset,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]receiptResponse, 0, len(receipts))
	for _, re := range receipts {
		out = append(out, newReceiptResponse(&re))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *server) handleGetReceipt(w http.ResponseWriter, r *http.Request) {
	re, err := s.store.GetReceipt(r.Context(), r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "receipt not found")
		return
	}
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, newReceiptResponse(re))
}

func escapeHTML(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;")
	return r.Replace(s)
}

// handleReceiptHTML serves a printable HTML receipt.
func (s *server) handleReceiptHTML(w http.ResponseWriter, r *http.Request) {
	re, err := s.store.GetReceipt(r.Context(), r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "receipt not found")
		return
	}
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}

	var itemsHTML strings.Builder
	for _, it := range re.Items {
		fmt.Fprintf(&itemsHTML,
			`<tr><td>%s</td><td class="r">%s x %.2f</td><td class="r">%s %.2f</td></tr>`,
			escapeHTML(it.Name), escapeHTML(it.Code), it.Quantity, escapeHTML(re.Currency), it.LineTotal)
	}
	patientName := re.PatientName
	if patientName == "" {
		patientName = re.PayerName
	}
	if patientName == "" {
		patientName = "Walk-in"
	}

	doc := fmt.Sprintf(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Receipt %s</title>
<style>
  body { font-family: "Segoe UI", Arial, sans-serif; margin: 40px; color: #111; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .muted { color: #666; font-size: 12px; }
  table { width: 100%%; border-collapse: collapse; margin: 16px 0; }
  th, td { border-bottom: 1px solid #ddd; padding: 6px 8px; text-align: left; font-size: 13px; }
  th { background: #f5f5f5; }
  .r { text-align: right; }
  .totals td { border: none; font-size: 13px; }
  .grand { font-weight: 700; font-size: 15px; }
  .paid { margin-top: 12px; border-top: 2px solid #111; }
  @media print { body { margin: 12px; } }
</style></head><body>
<h1>Divine Hands Hospital</h1>
<div class="muted">Official Payment Receipt</div>
<p class="muted">Receipt No: %s &middot; Invoice: %s &middot; Date: %s<br>Received from: %s &middot; Payer: %s</p>
<table>
  <thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Amount</th></tr></thead>
  <tbody>%s</tbody>
</table>
<table class="totals">
  <tr><td>Invoice total</td><td class="r">%s %.2f</td></tr>
  <tr><td>Amount paid</td><td class="r">%s %.2f</td></tr>
  <tr class="grand"><td>Paid by %s (%s)</td><td class="r">%s %.2f</td></tr>
</table>
<p class="paid muted">Received by %s &middot; Ref: %s</p>
<script>window.print();</script>
</body></html>`,
		escapeHTML(re.ReceiptNo), escapeHTML(re.ReceiptNo), escapeHTML(re.InvoiceNo),
		escapeHTML(re.IssuedAt.UTC().Format("2006-01-02 15:04")), escapeHTML(patientName),
		escapeHTML(strings.ToUpper(re.BillTo)), itemsHTML.String(),
		escapeHTML(re.Currency), re.TotalAmount, escapeHTML(re.Currency), re.AmountPaid,
		escapeHTML(strings.ToUpper(re.Method)), escapeHTML(re.Reference), escapeHTML(re.Currency), re.Amount,
		escapeHTML(re.ReceivedBy), escapeHTML(re.Reference))

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(doc))
}

// handleReceiptPDF serves a downloadable PDF receipt.
func (s *server) handleReceiptPDF(w http.ResponseWriter, r *http.Request) {
	re, err := s.store.GetReceipt(r.Context(), r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "receipt not found")
		return
	}
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	b, err := pdf.Receipt(re)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename="receipt-%s.pdf"`, re.ReceiptNo))
	w.Header().Set("Content-Length", strconv.Itoa(len(b)))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(b)
}

type shareReceiptRequest struct {
	ShareVia  string `json:"shareVia"`
	Recipient string `json:"recipient"`
}

func (s *server) handleShareReceipt(w http.ResponseWriter, r *http.Request) {
	var req shareReceiptRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.ShareVia != domain.ReceiptShareEmail && req.ShareVia != domain.ReceiptShareWhatsApp {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "shareVia must be email or whatsapp")
		return
	}
	if req.Recipient == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "recipient is required")
		return
	}
	actor := userFromContext(r.Context())
	share, err := s.store.RecordReceiptShare(r.Context(), r.PathValue("id"), req.ShareVia, req.Recipient, actor.ID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "receipt not found")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionBillingReceiptShare, "receipt", share.ReceiptID, nil, map[string]any{
		"shareVia": share.ShareVia, "recipient": share.Recipient,
	})
	writeJSON(w, http.StatusCreated, map[string]any{
		"id": share.ID, "receiptId": share.ReceiptID, "shareVia": share.ShareVia,
		"recipient": share.Recipient, "sharedAt": share.SharedAt.UTC().Format(timeRFC3339),
	})
}

// ---- refunds ----

type refundRequestResponse struct {
	ID              string  `json:"id"`
	RefundNo        string  `json:"refundNo"`
	PaymentID       string  `json:"paymentId"`
	PaymentNo       string  `json:"paymentNo,omitempty"`
	InvoiceID       string  `json:"invoiceId"`
	InvoiceNo       string  `json:"invoiceNo,omitempty"`
	PatientID       *string `json:"patientId,omitempty"`
	PatientName     string  `json:"patientName,omitempty"`
	Amount          float64 `json:"amount"`
	Reason          string  `json:"reason"`
	Status          string  `json:"status"`
	RequestedBy     string  `json:"requestedBy"`
	RequestedAt     string  `json:"requestedAt"`
	ApprovedBy      *string `json:"approvedBy,omitempty"`
	ApprovedAt      *string `json:"approvedAt,omitempty"`
	RejectionReason string  `json:"rejectionReason,omitempty"`
	ProcessedBy     *string `json:"processedBy,omitempty"`
	ProcessedAt     *string `json:"processedAt,omitempty"`
}

func newRefundRequestResponse(rr *domain.RefundRequest) refundRequestResponse {
	out := refundRequestResponse{
		ID:              rr.ID,
		RefundNo:        rr.RefundNo,
		PaymentID:       rr.PaymentID,
		PaymentNo:       rr.PaymentNo,
		InvoiceID:       rr.InvoiceID,
		InvoiceNo:       rr.InvoiceNo,
		PatientID:       rr.PatientID,
		PatientName:     rr.PatientName,
		Amount:          rr.Amount,
		Reason:          rr.Reason,
		Status:          rr.Status,
		RequestedBy:     rr.RequestedBy,
		RequestedAt:     rr.RequestedAt.UTC().Format(timeRFC3339),
		ApprovedBy:      rr.ApprovedBy,
		RejectionReason: rr.RejectionReason,
		ProcessedBy:     rr.ProcessedBy,
	}
	if rr.ApprovedAt != nil {
		v := rr.ApprovedAt.UTC().Format(timeRFC3339)
		out.ApprovedAt = &v
	}
	if rr.ProcessedAt != nil {
		v := rr.ProcessedAt.UTC().Format(timeRFC3339)
		out.ProcessedAt = &v
	}
	return out
}

type refundResponse struct {
	ID              string  `json:"id"`
	RefundNo        string  `json:"refundNo"`
	RefundRequestID string  `json:"refundRequestId"`
	PaymentID       string  `json:"paymentId"`
	PaymentNo       string  `json:"paymentNo,omitempty"`
	InvoiceID       string  `json:"invoiceId"`
	InvoiceNo       string  `json:"invoiceNo,omitempty"`
	PatientID       *string `json:"patientId,omitempty"`
	PatientName     string  `json:"patientName,omitempty"`
	ShiftID         *string `json:"shiftId,omitempty"`
	Amount          float64 `json:"amount"`
	Reason          string  `json:"reason"`
	ProcessedBy     string  `json:"processedBy"`
	ProcessedAt     string  `json:"processedAt"`
}

func newRefundResponse(ref *domain.Refund) refundResponse {
	return refundResponse{
		ID:              ref.ID,
		RefundNo:        ref.RefundNo,
		RefundRequestID: ref.RefundRequestID,
		PaymentID:       ref.PaymentID,
		PaymentNo:       ref.PaymentNo,
		InvoiceID:       ref.InvoiceID,
		InvoiceNo:       ref.InvoiceNo,
		PatientID:       ref.PatientID,
		PatientName:     ref.PatientName,
		ShiftID:         ref.ShiftID,
		Amount:          ref.Amount,
		Reason:          ref.Reason,
		ProcessedBy:     ref.ProcessedBy,
		ProcessedAt:     ref.ProcessedAt.UTC().Format(timeRFC3339),
	}
}

type requestRefundRequest struct {
	Amount float64 `json:"amount"`
	Reason string  `json:"reason"`
}

func (s *server) handleRequestRefund(w http.ResponseWriter, r *http.Request) {
	var req requestRefundRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Amount <= 0 || req.Reason == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "amount and reason are required")
		return
	}
	actor := userFromContext(r.Context())
	rr, err := s.store.RequestRefund(r.Context(), r.PathValue("id"), req.Reason, req.Amount, actor.ID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "payment not found")
			return
		}
		if errors.Is(err, store.ErrRefundLimit) {
			writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "refund exceeds refundable amount")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionBillingRefundRequest, "refund_request", rr.ID, nil, map[string]any{
		"refundNo": rr.RefundNo, "amount": rr.Amount, "paymentId": rr.PaymentID,
	})
	writeJSON(w, http.StatusCreated, newRefundRequestResponse(rr))
}

func (s *server) handleListRefundRequests(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)
	refunds, err := s.store.ListRefundRequests(r.Context(), r.URL.Query().Get("status"), limit, offset)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]refundRequestResponse, 0, len(refunds))
	for _, rr := range refunds {
		out = append(out, newRefundRequestResponse(&rr))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *server) handleGetRefundRequest(w http.ResponseWriter, r *http.Request) {
	rr, err := s.store.GetRefundRequest(r.Context(), r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "refund request not found")
		return
	}
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, newRefundRequestResponse(rr))
}

func (s *server) handleApproveRefund(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	id := r.PathValue("id")
	if err := s.store.ApproveRefund(r.Context(), id, actor.ID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "refund request not found")
			return
		}
		if errors.Is(err, store.ErrSelfApproval) {
			writeError(w, r, http.StatusUnprocessableEntity, "self_approval", "cannot approve your own refund request")
			return
		}
		if errors.Is(err, store.ErrInvalidBillingTransition) {
			writeError(w, r, http.StatusConflict, "invalid_transition", "refund request is not pending")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionBillingRefundApprove, "refund_request", id, nil, nil)
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": domain.BillingRefundStatusApproved})
}

type rejectRefundRequest struct {
	Reason string `json:"reason"`
}

func (s *server) handleRejectRefund(w http.ResponseWriter, r *http.Request) {
	var req rejectRefundRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.Reason == "" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "reason is required")
		return
	}
	actor := userFromContext(r.Context())
	id := r.PathValue("id")
	if err := s.store.RejectRefund(r.Context(), id, req.Reason, actor.ID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "refund request not found")
			return
		}
		if errors.Is(err, store.ErrInvalidBillingTransition) {
			writeError(w, r, http.StatusConflict, "invalid_transition", "refund request is not pending")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionBillingRefundReject, "refund_request", id, nil, map[string]any{"reason": req.Reason})
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": domain.BillingRefundStatusRejected})
}

func (s *server) handleProcessRefund(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	id := r.PathValue("id")
	ref, err := s.store.ProcessRefund(r.Context(), id, actor.ID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "refund request not found")
			return
		}
		if errors.Is(err, store.ErrShiftRequired) {
			writeError(w, r, http.StatusConflict, "shift_required", "open a cashier shift first")
			return
		}
		if errors.Is(err, store.ErrInvalidBillingTransition) {
			writeError(w, r, http.StatusConflict, "invalid_transition", "refund request must be approved before processing")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionBillingRefundProcess, "refund", ref.ID, nil, map[string]any{
		"refundNo": ref.RefundNo, "amount": ref.Amount,
	})
	writeJSON(w, http.StatusCreated, newRefundResponse(ref))
}

// ---- cashier shifts ----

type shiftResponse struct {
	ID           string               `json:"id"`
	ShiftNo      string               `json:"shiftNo"`
	CashierID    string               `json:"cashierId"`
	OpenedAt     string               `json:"openedAt"`
	ClosedAt     *string              `json:"closedAt,omitempty"`
	OpeningCash  float64              `json:"openingCash"`
	ClosingCash  *float64             `json:"closingCash,omitempty"`
	ExpectedCash *float64             `json:"expectedCash,omitempty"`
	Variance     *float64             `json:"variance,omitempty"`
	Status       string               `json:"status"`
	Payments     []paymentResponse    `json:"payments,omitempty"`
	Refunds      []refundResponse     `json:"refunds,omitempty"`
	Totals       []domain.ShiftTotals `json:"totals,omitempty"`
}

func newShiftResponse(sh *domain.CashierShift) shiftResponse {
	out := shiftResponse{
		ID:           sh.ID,
		ShiftNo:      sh.ShiftNo,
		CashierID:    sh.CashierID,
		OpenedAt:     sh.OpenedAt.UTC().Format(timeRFC3339),
		OpeningCash:  sh.OpeningCash,
		ClosingCash:  sh.ClosingCash,
		ExpectedCash: sh.ExpectedCash,
		Variance:     sh.Variance,
		Status:       sh.Status,
	}
	if sh.ClosedAt != nil {
		v := sh.ClosedAt.UTC().Format(timeRFC3339)
		out.ClosedAt = &v
	}
	out.Payments = make([]paymentResponse, 0, len(sh.Payments))
	for i := range sh.Payments {
		out.Payments = append(out.Payments, newPaymentResponse(&sh.Payments[i]))
	}
	out.Refunds = make([]refundResponse, 0, len(sh.Refunds))
	for i := range sh.Refunds {
		out.Refunds = append(out.Refunds, newRefundResponse(&sh.Refunds[i]))
	}
	out.Totals = store.ShiftTotalsByMethod(sh)
	return out
}

type openShiftRequest struct {
	OpeningCash float64 `json:"openingCash"`
}

func (s *server) handleOpenShift(w http.ResponseWriter, r *http.Request) {
	var req openShiftRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	if req.OpeningCash < 0 {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "openingCash cannot be negative")
		return
	}
	actor := userFromContext(r.Context())
	sh, err := s.store.OpenShift(r.Context(), actor.ID, req.OpeningCash)
	if err != nil {
		if errors.Is(err, store.ErrShiftOpen) {
			writeError(w, r, http.StatusConflict, "shift_open", "cashier already has an open shift")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionBillingShiftOpen, "cashier_shift", sh.ID, nil, map[string]any{
		"shiftNo": sh.ShiftNo, "openingCash": sh.OpeningCash,
	})
	writeJSON(w, http.StatusCreated, newShiftResponse(sh))
}

type closeShiftRequest struct {
	ClosingCash float64 `json:"closingCash"`
}

func (s *server) handleCloseShift(w http.ResponseWriter, r *http.Request) {
	var req closeShiftRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "invalid request body")
		return
	}
	actor := userFromContext(r.Context())
	id := r.PathValue("id")
	sh, err := s.store.CloseShift(r.Context(), id, actor.ID, req.ClosingCash)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, r, http.StatusNotFound, "not_found", "shift not found")
			return
		}
		if errors.Is(err, store.ErrNotShiftOwner) {
			writeError(w, r, http.StatusForbidden, "forbidden", "only the shift cashier can close this shift")
			return
		}
		if errors.Is(err, store.ErrInvalidBillingTransition) {
			writeError(w, r, http.StatusConflict, "invalid_transition", "shift is already closed")
			return
		}
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionBillingShiftClose, "cashier_shift", id, nil, map[string]any{
		"shiftNo": sh.ShiftNo, "closingCash": req.ClosingCash, "expectedCash": sh.ExpectedCash, "variance": sh.Variance,
	})
	writeJSON(w, http.StatusOK, newShiftResponse(sh))
}

func (s *server) handleListShifts(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)
	shifts, err := s.store.ListShifts(r.Context(), store.ListShiftsParams{
		Status:  r.URL.Query().Get("status"),
		Cashier: r.URL.Query().Get("cashierId"),
		Limit:   limit,
		Offset:  offset,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	out := make([]shiftResponse, 0, len(shifts))
	for _, sh := range shifts {
		out = append(out, newShiftResponse(&sh))
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *server) handleGetShift(w http.ResponseWriter, r *http.Request) {
	sh, err := s.store.GetShift(r.Context(), r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "not_found", "shift not found")
		return
	}
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	writeJSON(w, http.StatusOK, newShiftResponse(sh))
}
