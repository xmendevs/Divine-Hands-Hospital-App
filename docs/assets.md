# General inventory, instruments, equipment & maintenance (Phase 06)

Implemented in the Go core service. Manages non-pharmacy hospital assets and
consumables: instruments, medical equipment, PPE, and ward/cleaning/office
supplies, plus maintenance planning and history.

## Model overview

- **asset_categories** — seeded categories with a `tracking` mode:
  - `unit` — one unique, serial-numbered item (instruments, medical equipment).
  - `quantity` — pooled consumable stock (PPE, ward/cleaning/office supplies).
- **assets** — the asset master: `asset_no` business ID (`AST000001`), name,
  category, serial number, manufacturer, supplier, purchase date, cost,
  location, department, custodian, condition (`new | good | fair | poor`),
  warranty expiry, and status.
- **asset_movements** — append-only ledger mirroring pharmacy `stock_movements`
  (receipt, adjustment, count variance, transfer in/out). Every registration
  records an opening `receipt` movement.
- **asset_transfers** — explicit relocation and/or custody reassignment with
  from/to department, location, custodian, quantity, and reason.
- **asset_status_changes** — append-only, attributable status history, so
  loss/damage/disposal is always auditable.
- **asset_stock_counts** — physical counts for quantity-tracked assets with
  system vs counted quantity and variance (reconciled like pharmacy counts).
- **service_providers** — maintenance vendors.
- **maintenance_schedules** — recurring service plans; `next_service_date` is
  advanced when work is completed against the schedule.
- **maintenance_records** — completed work with provider, downtime hours,
  cost, and next service date. Recording work takes an asset out of
  `under_maintenance`.

## Statuses

`available → in_use → under_maintenance → damaged → lost → disposed` with
guarded transitions: `available`/`in_use`/`under_maintenance` may move to any
state; `damaged` may go to `under_maintenance` or `disposed`; `lost` only to
`disposed`; `disposed` is terminal. Disallowed transitions return `409`.

## Stock control

Quantity-tracked assets behave like pharmacy stock:

| Movement     | Endpoint                            | Direction |
| ------------ | ----------------------------------- | --------- |
| Registration | `POST /api/v1/assets`               | in        |
| Adjustment   | `POST /api/v1/assets/{id}/adjust`   | signed    |
| Transfer     | `POST /api/v1/assets/{id}/transfer` | out + in  |
| Stock count  | `POST /api/v1/assets/counts`        | variance  |

Every movement is recorded in `asset_movements` with before/after quantities,
reason, and reference, and audited in `audit_logs`. Unit-tracked assets are
tracked by serial number; quantity is always `1` and transfers move the unit.

## Maintenance

- `POST /api/v1/maintenance/schedules` plans recurring work (frequency in
  days); `GET /api/v1/maintenance/schedules?dueOnly=true` surfaces past-due
  service.
- `POST /api/v1/assets/{id}/maintenance` records completed work and, when a
  schedule is referenced, advances its `next_service_date` by the frequency.
- Service providers are registered once and referenced by maintenance records.

## Permissions

`storekeeper` (and `super_admin`) hold the `assets.*` permissions; `admin`
holds `assets.view`. No other role has asset access.

## Endpoints

| Method | Path                                    | Permission        |
| ------ | --------------------------------------- | ----------------- |
| GET    | `/api/v1/assets/categories`             | `assets.view`     |
| GET    | `/api/v1/assets`                        | `assets.view`     |
| POST   | `/api/v1/assets`                        | `assets.manage`   |
| GET    | `/api/v1/assets/movements`              | `assets.view`     |
| POST   | `/api/v1/assets/counts`                 | `assets.count`    |
| GET    | `/api/v1/assets/{id}`                   | `assets.view`     |
| PATCH  | `/api/v1/assets/{id}`                   | `assets.manage`   |
| POST   | `/api/v1/assets/{id}/status`            | `assets.adjust`   |
| POST   | `/api/v1/assets/{id}/transfer`          | `assets.transfer` |
| POST   | `/api/v1/assets/{id}/adjust`            | `assets.adjust`   |
| GET    | `/api/v1/assets/{id}/maintenance`       | `assets.view`     |
| POST   | `/api/v1/assets/{id}/maintenance`       | `assets.maintain` |
| GET    | `/api/v1/maintenance/schedules`         | `assets.view`     |
| POST   | `/api/v1/maintenance/schedules`         | `assets.maintain` |
| GET    | `/api/v1/maintenance/service-providers` | `assets.view`     |
| POST   | `/api/v1/maintenance/service-providers` | `assets.maintain` |

See `packages/api-contracts/openapi/v1/go-api.openapi.yaml` for the full
contract.
