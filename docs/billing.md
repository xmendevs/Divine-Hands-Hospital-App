# Billing, cashier, payments & receipts (Phase 08)

Implemented in the Go core service. Covers price lists, invoices (billable
orders), cashier shift reconciliation, payments with receipts, and an
approval-controlled refund workflow. Money is stored as `NUMERIC(12,2)` and
all totals are computed in SQL — no client-supplied arithmetic.

## Model overview

- **price_lists** — named, versioned service catalogues with a currency
  (from setting `billing.currency`, default `NGN`), validity window and
  `active | inactive` status. One default list, **Standard (NGN)**, is seeded
  with five common services (consultation, antenatal, lab FBC, pharmacy
  dispensing, ward stay).
- **price_list_items** — billable services (`code`, name, category, unit,
  price, tax rate, active flag). Prices are **snapshotted into the invoice**
  at creation time, so later edits never rewrite history.
- **invoices** — the billable order (`invoice_no` business ID, `INV000001`).
  Status: `draft → issued → partially_paid/paid → voided`. `bill_to` is
  `patient | insurance | corporate` with optional payer name and policy
  number. Discounts are applied at creation (`billing.manage`); totals are
  recomputed in SQL on issue.
- **invoice_items** — line items with the price snapshot, quantity,
  line total and tax amount.
- **payments** — append-only (a DB trigger rejects `UPDATE`/`DELETE`).
  Methods: `cash`, `transfer`, `pos`, `card`, `online`, `insurance`,
  `corporate`, plus any custom methods listed in setting
  `billing.custom_payment_methods` (JSON array). Each payment is bound to the
  cashier's **open shift** and its reference number (`PAY000001`).
- **receipts** — one per payment (`RCP000001`), printable as server-rendered
  HTML (`GET /receipts/{id}/html`, auto `window.print()`).
  `receipt_shares` records attributable user-initiated shares
  (`shareVia: email | whatsapp`); transport itself is frontend-driven.
- **refund_requests** — `pending → approved/rejected → processed`
  (`RNF000001`). Requested by the cashier, approved by a supervisor — no
  self-approval (422). When setting `billing.refund_approval_required` is
  `false`, requests auto-approve.
- **refunds** — the posted refund (`RFN000001`), processed against an open
  shift; processing reverses the invoice balance in SQL
  (`GREATEST(amount_paid - refund, 0)`) and recomputes the status.
- **cashier_shifts** — one open shift per cashier (`SFT000001`).
  `expected_cash = opening_cash + Σcash payments − Σcash refunds` (a refund
  keeps the method of its payment), `variance = closing_cash − expected_cash`.

## Workflow

```
draft ──issue──▶ issued ──payments──▶ partially_paid ──▶ paid
  │                │                          ▲
  └──void──▶ voided┘                          └──refund process──┘
```

- Payments require an **open shift** (409 `shift_required`); overpayments are
  rejected (422), as are unsupported methods. Draft invoices cannot be paid.
- Voiding requires a reason and only works on `draft`/`issued` invoices with
  zero `amount_paid`.
- Refund requests cap at the payment minus already-processed/reserved
  refunds (422); processing requires approval, an open shift, and reverses
  the balance. A `billing_supervisor` (or `admin` with `billing.approve`)
  approves; the requesting cashier cannot.
- Closing a shift is restricted to the shift's cashier (403) and reconciles
  declared cash against expected cash; a closed shift cannot be re-closed
  (409) and no further payments can be taken without a new shift.

## Steps (endpoints under `/api/v1/billing`)

| Step                       | Endpoint                                   | Notes                        |
| -------------------------- | ------------------------------------------ | ---------------------------- |
| Price lists                | `GET/POST /price-lists`, `GET/PATCH /price-lists/{id}` | `billing.manage` writes |
| Services                   | `GET/POST /price-lists/{id}/items`, `PATCH /price-list-items/{id}` | price snapshot at invoice time |
| Create invoice             | `POST /invoices`                           | `billing.create`; draft      |
| Issue / void               | `POST /invoices/{id}/issue`, `/void`       | issue recomputes totals      |
| Open shift                 | `POST /shifts`                             | one per cashier; `SFT000001` |
| Receive payment            | `POST /invoices/{id}/payments`             | `billing.collect`; creates payment + receipt |
| Receipts                   | `GET /receipts`, `GET /receipts/{id}`, `GET /receipts/{id}/html`, `POST /receipts/{id}/share` | HTML is printable |
| Request refund             | `POST /payments/{id}/refunds`              | `billing.refund`; pending    |
| Approve / reject           | `POST /refunds/{id}/approve`, `/reject`    | `billing.approve`; no self-approval |
| Process refund             | `POST /refunds/{id}/process`               | needs open shift; reverses balance |
| Reconcile                  | `POST /shifts/{id}/close`, `GET /shifts`, `GET /shifts/{id}` | expected vs declared cash |

Lists support `limit`/`offset` (and `status`, `patientId`, `invoiceId`,
`shiftId`, `method` filters where relevant).

## Patient timeline

Issuing an invoice appends `billing_invoice_issued`; the first payment on an
invoice appends `billing_payment_received`. Both record the actor.

## Permissions & roles

- **cashier** — `billing.view`, `billing.collect`, `billing.refund`,
  `billing.reconcile` (payments, shifts, processing approved refunds).
- **billing_officer** — `billing.view`, `billing.create`, `billing.manage`,
  `billing.refund` (invoices, price lists).
- **billing_supervisor** — `billing.view`, `billing.refund`,
  `billing.approve`, `billing.reconcile` (refund approval, reconciliation).
- **doctor** — adds `billing.view`, `billing.create`; **admin** — adds
  `billing.view`. `super_admin` holds everything. See `docs/rbac-audit.md`.

## Audit & controls

Every billing mutation is audited with `billing.*` actions (invoice
create/issue/void/view, payment receive, receipt share, refund
request/approve/reject/process, shift open/close). Payments are
append-only at the database level; posted transactions are corrected only
through the audited refund workflow.
