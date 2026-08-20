# Order Flows Spec — Prescription, Lab Investigation & Auto-Billing

**Date:** 2026-08-19
**Status:** Draft — pending user approval
**Scope:** All order types: prescription, lab_request, lab_investigation, radiology_imaging, nursing_order, nursing_procedure, dietary_ward, referral

---

## 1. Current State — Root Cause Analysis

### 1.1 Prescription Flow — BROKEN

**Current flow:**
1. Doctor creates prescription order (status: submitted)
2. Order appears in pharmacy queue
3. Pharmacist clicks "Dispense" → **FAILS with "insufficient permissions"**

**Root cause:** Pharmacist role only has `orders.view` permission. The `POST /orders/{id}/status` endpoint requires `orders.manage` permission, which pharmacist does not have. The dispensing endpoint (`POST /pharmacy/dispense`) requires `inventory.dispense` which pharmacist does have — but the order status transition blocks the flow before dispensing can happen.

**Also affected:** The enhanced dispense endpoint checks order status in the store layer and requires the order to be `submitted` or `accepted` or `in_progress`. Since the pharmacist can't transition the order to `accepted`, the store-level check fails.

### 1.2 Lab Investigation Flow — BROKEN

**Current flow:**
1. Doctor creates lab investigation order (status: submitted)
2. Order appears in lab queue
3. Lab technician attempts to transition order → **FAILS with "insufficient permissions"**

**Root cause:** Lab technician role only has `orders.view`. Same `orders.manage` permission issue as pharmacy.

### 1.3 Missing Features

| Feature | Status |
|---------|--------|
| Auto-invoice creation from orders | Not implemented |
| Doctor charge confirmation before billing | Not implemented |
| Payment verification before lab processing | Not implemented |
| Doctor notification when results ready | Not implemented |
| Doctor notification when prescription dispensed | Not implemented |
| Priority/urgency tracking on orders | Partial (lab has priority, orders don't) |
| Patient order summary | Not implemented |

---

## 2. Proposed Flow — Prescription Order

### 2.1 End-to-End Flow

```
DOCTOR                          SYSTEM                          PHARMACY
  |                               |                               |
  |-- Create Prescription ------->|                               |
  |   (select medication from     |                               |
  |    inventory suggestions)     |                               |
  |                               |-- Auto-create invoice ------->|
  |<-- Invoice preview modal -----|   (draft status)              |
  |                               |                               |
  |-- Confirm/Edit Charge ------->|                               |
  |   (review line items,         |                               |
  |    quantities, prices)        |                               |
  |                               |-- Create invoice (issued) -->|
  |                               |   (linked to patient)         |
  |                               |                               |
  |                               |-- Status: submitted -------->|
  |                               |                               |
  |                               |                    Pharmacy sees
  |                               |                    in dispensing queue
  |                               |                               |
  |                               |                    Pharmacist selects
  |                               |                    batch (FIFO)
  |                               |                    enters quantity
  |                               |                    confirms allergy
  |                               |                    & interaction check
  |                               |                               |
  |                               |                    Clicks "Dispense"
  |                               |                               |
  |                               |<-- Stock deducted ------------|
  |                               |   Status: accepted            |
  |                               |                               |
  |                               |-- Notification to doctor --->|
  |                               |   "Prescription dispensed"    |
  |                               |                               |
  |                               |                    Patient picks up
  |                               |                    Status: completed
  |                               |                               |
  |                               |                    Cashier receives
  |                               |                    payment
  |                               |                               |
  |                               |<-- Invoice status: paid ------|
  |                               |                               |
  |                               |-- Super admin validates ----->|
  |                               |   Receipt shareable           |
```

### 2.2 Status Transitions

| From | To | Trigger | Actor |
|------|----|---------|-------|
| draft | submitted | Doctor creates + confirms | Doctor |
| submitted | accepted | Pharmacist begins processing | Pharmacist |
| accepted | in_progress | Pharmacist dispenses | Pharmacist |
| in_progress | completed | Patient picks up (or auto-complete after full dispense) | Pharmacist/System |
| any | cancelled | Doctor cancels with reason | Doctor |

### 2.3 Permission Changes Required

| Role | Current | Proposed |
|------|---------|----------|
| pharmacist | orders.view | orders.manage (to transition prescription orders) |
| nurse | orders.manage | orders.manage (no change) |
| matron | orders.manage | orders.manage (no change) |
| lab_technician | orders.view | orders.manage (to transition lab orders) |
| lab_supervisor | orders.view | orders.manage (to transition lab orders) |
| doctor | orders.create, orders.view | orders.create, orders.view (no change) |

---

## 3. Proposed Flow — Lab Investigation

### 3.1 End-to-End Flow

```
DOCTOR                          SYSTEM                         LAB TEAM
  |                               |                               |
  |-- Create Lab Investigation ->|                               |
  |   (select test from          |                               |
  |    69-test catalogue)        |                               |
  |                               |                               |
  |<-- Invoice preview modal -----|                               |
  |-- Confirm/Edit Charge ------->|                               |
  |                               |-- Auto-create invoice ------>|
  |                               |   (draft status)              |
  |                               |                               |
  |                               |-- Status: submitted -------->|
  |                               |                               |
  |                               |                    Lab sees request
  |                               |                    in work queue
  |                               |                               |
  |                               |         CASHIER VERIFIES PAYMENT
  |                               |         (must be paid before
  |                               |          lab can proceed)
  |                               |                               |
  |                               |<-- Payment confirmed ---------|
  |                               |   Status: specimen_collected  |
  |                               |                               |
  |                               |                    Lab collects
  |                               |                    specimen
  |                               |                    (barcode generated)
  |                               |                               |
  |                               |                    Status: received
  |                               |                    Status: processing
  |                               |                               |
  |                               |                    Lab enters results
  |                               |                               |
  |                               |                    Status: result_entered
  |                               |                               |
  |                               |                    Lab supervisor
  |                               |                    verifies results
  |                               |                               |
  |                               |                    Status: verified
  |                               |                               |
  |                               |-- Results released --------->|
  |                               |                               |
  |                               |-- Notification to doctor --->|
  |                               |   "Lab results ready"         |
  |                               |                               |
  |                               |-- Super admin validates ---->|
  |                               |   Receipt shareable           |
```

### 3.2 Status Transitions (Updated)

| From | To | Trigger | Actor |
|------|----|---------|-------|
| draft | submitted | Doctor creates + confirms | Doctor |
| submitted | payment | System auto-moves after invoice created | System |
| payment | specimen_collected | Cashier verifies payment | Cashier |
| specimen_collected | received | Lab receives specimen | Lab Tech |
| received | processing | Lab begins processing | Lab Tech |
| processing | result_entered | Lab enters results | Lab Tech |
| result_entered | verified | Lab supervisor verifies | Lab Supervisor |
| verified | released | Results released to doctor | Lab Supervisor |
| any | cancelled | Doctor cancels with reason | Doctor |

### 3.3 Payment Verification Step

- After doctor confirms charge, the invoice is created in `issued` status
- Lab technician sees the request in queue with "Payment Pending" badge
- Cashier can see the invoice in billing dashboard
- When payment is received and validated by super admin, the lab request status auto-advances to `specimen_collected`
- Alternative: Lab supervisor can manually advance to `specimen_collected` if payment is confirmed verbally (override with reason)

---

## 4. Proposed Flow — All Other Order Types

### 4.1 Auto-Billing by Order Type

| Order Type | Auto-Bill? | Price Source | Notes |
|------------|-----------|--------------|-------|
| prescription | YES | Pharmacy medicine selling price | Per-item billing based on dispensed quantity |
| lab_request | YES | Lab test catalogue price | Per-test billing |
| lab_investigation | YES | Lab test catalogue price | Per-test billing |
| radiology_imaging | YES | Price list (radiology category) | Manual entry if not in price list |
| nursing_order | NO | N/A | Usually no direct charge |
| nursing_procedure | YES (optional) | Price list (procedure category) | Some procedures are billable |
| dietary_ward | NO | N/A | Usually included in ward charges |
| referral | YES (optional) | Price list (referral category) | External referral fee if applicable |

### 4.2 Manual Billing Option

- When creating any order type, the doctor can check a "Bill to patient" checkbox
- If checked, the doctor can manually enter a custom item name and amount
- This creates a custom line item on the invoice (not tied to price list)
- Example: A custom procedure not in the standard price list

### 4.3 Doctor Charge Confirmation Flow

1. Doctor selects order type and fills in details
2. System shows invoice preview modal with:
   - Patient name and ID
   - Order type
   - Line items (from price list or custom entry)
   - Unit price, quantity, line total
   - Subtotal, discount (optional), tax, total
   - "Confirm & Create Invoice" button
3. Doctor can:
   - Edit quantities
   - Add/remove line items
   - Apply discount
   - Add custom line items
4. On confirmation:
   - Invoice created in `draft` status
   - Order created and linked to invoice
   - Order status set to `submitted`

---

## 5. Notification System

### 5.1 Prescription Notifications

| Event | Recipient | Channel | Message |
|-------|-----------|---------|---------|
| Prescription dispensed | Doctor | In-app | "Prescription [ORD000001] dispensed for [Patient Name]" |
| Prescription ready for pickup | Doctor | In-app | "Prescription [ORD000001] ready for pickup" |
| Prescription partially dispensed | Doctor | In-app | "Prescription [ORD000001] partially dispensed (2/3 items)" |

### 5.2 Lab Notifications

| Event | Recipient | Channel | Message |
|-------|-----------|---------|---------|
| Lab results ready | Doctor | In-app | "Lab results ready for [Patient Name] - [Test Name]" |
| Critical result | Doctor | In-app | "CRITICAL: [Test Name] result for [Patient Name] - Immediate review required" |
| Specimen collected | Doctor | In-app | "Specimen collected for [Patient Name] - [Test Name]" |
| Lab request cancelled | Doctor | In-app | "Lab request [LAB000001] cancelled - [Reason]" |

### 5.3 Billing Notifications

| Event | Recipient | Channel | Message |
|-------|-----------|---------|---------|
| Invoice created | Cashier | In-app | "New invoice [INV000001] created for [Patient Name] - [Amount]" |
| Payment received | Cashier | In-app | "Payment received for invoice [INV000001] - [Amount]" |
| Invoice validated | Cashier | In-app | "Invoice [INV000001] validated by Super Admin" |

---

## 6. Patient Order Summary

### 6.1 What to Show

On the patient detail view (or ClinicalPage when a patient is selected), show:

- **Active Orders**: Orders currently in progress (submitted/accepted/in_progress)
- **Completed Orders**: Orders that are done (completed/cancelled)
- **Order Timeline**: Chronological list of all orders with status badges
- **Order Details**: Click to expand and see order type, items, status, timestamps, who ordered, who acted

### 6.2 Location

- In ClinicalPage: Add an "Order History" tab next to "Doctor Workload", "Consultation & Vitals", "Orders Queue"
- In PatientsPage: Add an "Orders" tab in the patient detail modal

---

## 7. Priority/Urgency Tracking

### 7.1 Add Priority to All Order Types

Currently only lab requests have priority (routine/urgent/stat). Extend to all order types:

| Priority | Color | Meaning |
|----------|-------|---------|
| routine | Green | Standard processing |
| urgent | Orange | Process within 1 hour |
| stat | Red | Process immediately |

### 7.2 Priority Display

- Orders queue shows priority badges
- Urgent/stat orders appear at the top of the queue
- Critical results always show as stat priority

---

## 8. Database Changes (Migration 0039)

```sql
-- Add orders.manage to pharmacy and lab roles
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'orders.manage'
WHERE r.code IN ('pharmacist', 'lab_technician', 'lab_supervisor')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Add priority column to orders table
ALTER TABLE orders ADD COLUMN priority VARCHAR(20) DEFAULT 'routine'
    CHECK (priority IN ('routine', 'urgent', 'stat'));

-- Add invoice_id to orders for auto-billing link
ALTER TABLE orders ADD COLUMN invoice_id UUID REFERENCES invoices(id);
```

---

## 9. Files to Modify

| File | Change |
|------|--------|
| `db/migrations/0039_order_flow_fixes.up.sql` | New migration |
| `apps/go-api/internal/domain/domain.go` | Add priority to Order, update order flow |
| `apps/go-api/internal/store/orders.go` | Add priority to queries, update transition logic |
| `apps/go-api/internal/store/billing.go` | Auto-create invoice from order, payment verification |
| `apps/go-api/internal/httpapi/orders.go` | Priority on create/transition, notification on status change |
| `apps/go-api/internal/httpapi/billing.go` | Auto-invoice endpoint, payment verification |
| `apps/go-api/internal/httpapi/router.go` | New routes for auto-billing |
| `apps/desktop/src/pages/ClinicalPage.tsx` | Order History tab, priority selector, charge confirmation modal |
| `apps/desktop/src/pages/PharmacyPage.tsx` | Order status transitions, notifications |
| `apps/desktop/src/pages/LabPage.tsx` | Payment verification step, result notifications |
| `apps/desktop/src/pages/PatientsPage.tsx` | Order history in patient detail |
| `apps/desktop/src/components/ChargePatientModal.tsx` | Pre-fill from order, priority display |

---

## 10. Verification Checklist

- [ ] Pharmacist can transition prescription orders (orders.manage granted)
- [ ] Lab tech can transition lab orders (orders.manage granted)
- [ ] Lab supervisor can transition lab orders (orders.manage granted)
- [ ] Doctor creates prescription → invoice preview modal → confirms → invoice created
- [ ] Doctor creates lab investigation → invoice preview modal → confirms → invoice created
- [ ] Auto-invoice created for prescription orders with correct prices
- [ ] Auto-invoice created for lab investigation orders with correct prices
- [ ] Manual billing option works (custom item name + amount)
- [ ] Cashier verifies payment before lab processing
- [ ] Lab technician sees "Payment Pending" badge on unverified requests
- [ ] Doctor receives in-app notification when prescription dispensed
- [ ] Doctor receives in-app notification when lab results ready
- [ ] Critical lab results trigger stat notification to doctor
- [ ] Patient order summary shows active/completed orders
- [ ] Priority badges display on all order types
- [ ] Urgent/stat orders sorted to top of queue
- [ ] All roles can login and access their respective dashboards
- [ ] `go build` / `go vet` pass
- [ ] `tsc` / `vite build` pass
- [ ] Migration applied to live DB
