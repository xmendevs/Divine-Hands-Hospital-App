# Laboratory information system (Phase 07)

Implemented in the Go core service. Covers lab clients, the test catalogue,
specimen chain of custody, the request workflow from ordering to release,
structured results with mandatory secondary verification, and critical-result
notification.

## Model overview

- **lab_clients** — external and referral clients with a full demographic
  record (`client_no` business ID, `LBC000001`). Hospital patients are served
  through the `patients` table instead; a request references **exactly one** of
  `patient_id` or `client_id` (enforced in the schema).
- **lab_tests** — catalogue entries: `code` (user-supplied, e.g. `FBC`),
  name, category, price, specimen type/container, turnaround minutes, units,
  reference ranges (JSONB), and `verification_required` (high-risk flag that
  forces a second, different user to verify the result).
- **lab_requests** — the order (`request_no` business ID, `LAB000001`),
  priority (`routine | urgent | stat`), clinical notes, ordering user, payment
  status, and workflow status.
- **lab_request_items** — one row per requested test with the **price
  snapshot** taken at order time and the structured result
  (`result_value` JSONB + `result_text`), plus entered/verified by/at stamps.
- **lab_specimens** — per-item specimens (`specimen_no`, `SPC000001`) with
  collector, collection time, receiver, condition, storage location, and
  status.
- **lab_specimen_events** — append-only chain of custody: collected,
  received, stored, transferred, rejected (actor + notes + timestamp).
- **lab_critical_notifications** — created when a critical result is entered
  and `lab.critical_acknowledgement_required` (default `true`) is set; notified
  party is the ordering user (patient requests) or the client's referring
  physician (external/referral requests).

## Workflow

```
requested → payment → specimen_collected → received → processing
         → result_entered → verified → released
```

- `cancelled` is terminal and reachable from any non-terminal state (reason
  required). `received → specimen_collected` is allowed for recollection after
  a specimen rejection.
- The request **auto-advances**: to `received` once every non-rejected
  specimen is received, to `result_entered` once every item has a result, and
  to `verified` once every item is verified.
- Disallowed transitions return `409` (`invalid_transition`).

## Steps (endpoints under `/api/v1/lab`)

| Step                   | Endpoint                                           | Notes                             |
| ---------------------- | -------------------------------------------------- | --------------------------------- |
| Order                  | `POST /requests`                                   | patient or client + `testIds`     |
| Payment / preauth      | `POST /requests/{id}/status`                       | also sets `paymentStatus`         |
| Collect                | `POST /requests/{id}/collect`                      | per item, records collector/time  |
| Receive / reject       | `POST /specimens/{id}/receive` `/reject`           | rejection returns request to work |
| Begin work             | `POST /requests/{id}/status`                       | to `processing`                   |
| Enter results          | `POST /requests/{id}/results`                      | `lab.analyze`; critical flag here |
| Verify results         | `POST /items/{id}/verify`                          | `lab.verify`; see verification    |
| Release                | `POST /requests/{id}/release`                      | `lab.release`; timestamps release |
| Critical notifications | `GET /critical`, `POST /critical/{id}/acknowledge` | pending → acknowledged            |

Catalogue and clients are managed via `GET/POST /lab/tests`,
`GET/PATCH /lab/tests/{id}`, `GET/POST /lab/clients`, `GET /lab/clients/{id}`;
requests are listed with `GET /lab/requests` (filter by `status`,
`patientId`, `clientId`).

## Verification & critical results

- Entry (`lab.analyze`) and verification (`lab.verify`) are **distinct users'
  actions**; the entered/verified by/at stamps are both recorded per item.
- High-risk tests (`verification_required = true`) reject **self-verification**
  with `422` (`self_verification`); technicians hold no `lab.verify` at all
  (`403`).
- Entering a result with `critical: true` creates a
  `lab_critical_notifications` row when the setting is enabled. The list
  (`GET /lab/critical`) shows pending notifications; acknowledging requires
  `lab.verify` and records who/when.
- The request must be `verified` before release; releasing a patient request
  appends `lab_released` to the patient timeline (`lab_requested` is appended
  at order time).

## Billing

Prices are snapshotted per item at order time and `payment_status` tracks
`pending | preauthorized | paid | waived`. The finance module will settle
these charges in a later phase; there is no live accounting link yet.

## Permissions & roles

- **lab_technician** — `lab.view`, `lab.order`, `lab.manage`, `lab.analyze`.
- **lab_supervisor** — `lab.view`, `lab.analyze`, `lab.verify`, `lab.release`.
- **doctor** — `lab.view`, `lab.order` (extends Phase 03/04 grants).
- **nurse** — `lab.view` (extends Phase 03/04 grants).
- `super_admin` holds everything automatically. See `docs/rbac-audit.md`.

All lab mutations are audited (`lab.*` actions); every specimen event and
critical notification is attributable.
