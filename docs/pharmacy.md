# Pharmacy, prescriptions & medicine inventory (Phase 05)

Implemented in the Go core service, built on the prescription orders from
Phase 04.

## Model overview

- **medicines** — medicine master: generic name, brand, strength, dosage form,
  category, supplier, reorder level, storage location, unit cost, selling
  price, active/inactive. `code` is a generated business ID (`MED000001`).
- **medicine_batches** — per-batch inventory: batch number, manufacturing date,
  expiry date, quantity on hand, purchase cost, selling price, supplier, and
  status (`active` / `quarantined`).
- **stock_movements** — append-only ledger of every movement. Each row records
  user, time, medicine, batch, quantity (signed), quantity before/after,
  reason, and a related transaction reference.
- **dispensations** + **dispensation_items** — dispensing transactions; one
  dispensation per prescription order (single fill).
- **stock_adjustments** — signed stock deltas with reason; may require approval.
- **approval_requests** — reusable approval records (`pending → approved /
rejected`) used by stock adjustments now and by later phases (roster,
  billing reversals).
- **stock_counts** — physical counts with system vs counted quantity and
  variance.

## Dispensing (FEFO)

`POST /api/v1/pharmacy/dispense` receives an authorized prescription order and
a list of `{ medicineId, quantity }` items. Stock is selected **FEFO** (earliest
expiry first, then earliest receipt) across dispensable batches, dispensing
movements are recorded, the dispensation is created, and the order is marked
`completed`. A prescription can be dispensed once (`409 already_dispensed`).

Only **active** medicines and **active, non-expired** batches are dispensable.
Expired or quarantined stock cannot be dispensed normally.

## Stock controls

| Movement         | Endpoint                                        | Direction |
| ---------------- | ----------------------------------------------- | --------- |
| Purchase/receipt | `POST /api/v1/pharmacy/receipts`                | in        |
| Dispense         | `POST /api/v1/pharmacy/dispense`                | out       |
| Return           | `POST /api/v1/pharmacy/batches/{id}/return`     | in        |
| Adjustment       | `POST /api/v1/pharmacy/adjustments`             | signed    |
| Damage           | `POST /api/v1/pharmacy/batches/{id}/damage`     | out       |
| Quarantine       | `POST /api/v1/pharmacy/batches/{id}/quarantine` | status    |
| Transfer         | `POST /api/v1/pharmacy/transfers`               | out + in  |
| Stock count      | `POST /api/v1/pharmacy/counts`                  | variance  |

Every movement is recorded in `stock_movements` with before/after quantities,
reason, and reference, and audited in `audit_logs`.

## Adjustments & approval

- Adjustments require a reason.
- When `pharmacy.adjustment_approval_required` is `true` (default), an
  adjustment is created `pending` with a linked `approval_requests` record;
  a **different** pharmacist (or super admin) approves or rejects it
  (`inventory.approve`). Separation of duties is enforced — you cannot approve
  your own request (`403`).
- When the setting is `false`, adjustments apply immediately.

## Alerts

`GET /api/v1/pharmacy/alerts` returns:

- **low stock** — active medicines whose total on-hand quantity is at or below
  their reorder level.
- **expiring** — batches expiring within the configured window
  (`pharmacy.expiry_alert_days`, default 30).
- **expired** — batches whose expiry date has passed.

## Security

- **Nurses cannot edit prescriptions** — there is no prescription-edit
  endpoint, and nurses lack `orders.create`.
- **Pharmacists cannot alter clinical diagnosis** — pharmacists hold no
  `notes.*` / clinical permissions.
- **Price changes are audited** — `medicine.update` audit entries capture
  before/after unit cost and selling price.

## Permissions

`pharmacist` (and `super_admin`) hold `medicines.*` and `inventory.*`. No other
role has pharmacy access.

## Endpoints

| Method | Path                                       | Permission           |
| ------ | ------------------------------------------ | -------------------- |
| GET    | `/api/v1/pharmacy/medicines`               | `medicines.view`     |
| POST   | `/api/v1/pharmacy/medicines`               | `medicines.manage`   |
| GET    | `/api/v1/pharmacy/medicines/{id}`          | `medicines.view`     |
| PATCH  | `/api/v1/pharmacy/medicines/{id}`          | `medicines.manage`   |
| GET    | `/api/v1/pharmacy/medicines/{id}/batches`  | `medicines.view`     |
| POST   | `/api/v1/pharmacy/receipts`                | `inventory.receive`  |
| POST   | `/api/v1/pharmacy/dispense`                | `inventory.dispense` |
| GET    | `/api/v1/pharmacy/dispensations`           | `medicines.view`     |
| GET    | `/api/v1/pharmacy/dispensations/{id}`      | `medicines.view`     |
| POST   | `/api/v1/pharmacy/adjustments`             | `inventory.adjust`   |
| GET    | `/api/v1/pharmacy/adjustments`             | `medicines.view`     |
| GET    | `/api/v1/approvals`                        | `inventory.approve`  |
| POST   | `/api/v1/approvals/{id}/approve`           | `inventory.approve`  |
| POST   | `/api/v1/approvals/{id}/reject`            | `inventory.approve`  |
| POST   | `/api/v1/pharmacy/batches/{id}/return`     | `inventory.receive`  |
| POST   | `/api/v1/pharmacy/batches/{id}/damage`     | `inventory.adjust`   |
| POST   | `/api/v1/pharmacy/batches/{id}/quarantine` | `inventory.adjust`   |
| POST   | `/api/v1/pharmacy/transfers`               | `inventory.transfer` |
| POST   | `/api/v1/pharmacy/counts`                  | `inventory.count`    |
| GET    | `/api/v1/pharmacy/movements`               | `medicines.view`     |
| GET    | `/api/v1/pharmacy/alerts`                  | `medicines.view`     |

See `packages/api-contracts/openapi/v1/go-api.openapi.yaml` for the full
contract.
