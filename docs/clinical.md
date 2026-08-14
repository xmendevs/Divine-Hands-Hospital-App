# Clinical workflows, doctor orders & nursing (Phase 04)

Implemented in the Go core service, built on the patient master record from
Phase 03.

## Model overview

- **patient_assignments** — patient ↔ clinician links; each clinician's
  "assigned patient queue" is their active assignments.
- **clinical_notes** — immutable, versioned notes (consultation, nursing,
  progress). A note group shares a `group_id`; every edit appends a new
  version. Each version records author, role snapshot, timestamp, department,
  version number, diagnosis, and treatment plan.
- **orders** — unified doctor orders (`prescription`, `lab_request`,
  `nursing_order`, `referral`) with a shared lifecycle and per-type `details`
  (JSONB). Human-readable `order_no` (`ORD000001`) via a sequence.
- **medication_administrations** — MAR: nurse-recorded administrations linked
  to a prescription order.
- **patient_observations** — vitals and observations with hospital-configurable
  JSONB measurements.
- **department_tasks** — department/patient tasks; a submitted nursing order
  auto-creates a linked task.
- **admissions** — ward/room/bed, attending doctor, admission reason, discharge
  summary and follow-up. A partial unique index allows at most one active
  admission per patient.
- **clinical_reports** — doctor-authored reports.
- **triage** — emergency triage records.

## Orders

Lifecycle:

```
draft → submitted → accepted → in_progress → completed
          └──────────┴──────────┴─────────────→ cancelled
```

- `draft`/`submitted` → the **ordering doctor** may submit or cancel (ownership
  enforced server-side).
- `submitted → accepted → in_progress → completed` → **nursing** action
  (`orders.manage`).

### Prescription lifecycle

A prescription is not the same as dispensing or administration:

1. **Doctor prescribed** — a `prescription` order is created.
2. **Pharmacy dispensed** — recorded by the pharmacy service (Phase 05).
3. **Nurse administered** — a `medication_administrations` row linked to the
   order.

Each step is a separate record, so the full chain is traceable.

## Notes

Notes cannot be silently overwritten: editing appends a new immutable version.
The current note is the highest `version` in its `group_id`; the full history is
retrievable. Each version captures author, role, timestamp, department, and
version number.

## Admission / discharge

`POST /api/v1/patients/{id}/admissions` admits (ward/room/bed, attending
doctor, reason); `POST /api/v1/patients/{id}/admissions/{admissionId}/discharge`
records the discharge summary and follow-up. A second admission while one is
active returns `409 already_admitted`.

## Emergency

`POST /api/v1/clinical/triage` creates an emergency patient (minimal
demographics, `DHHE…` ID) and a triage record in one call — urgent treatment is
not blocked by full registration.

## Permissions

| Role         | Clinical surface                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| doctor       | orders (create), notes, vitals view, MAR view, tasks (create/view), admit/discharge, reports, assignments |
| nurse        | orders (view/manage), notes, vitals record, MAR record, tasks (view/complete)                             |
| matron       | nurse surface + tasks create, assignments, report view                                                    |
| receptionist | emergency triage + assignment view                                                                        |

Authorization is enforced server-side on every endpoint; the frontend never
gates access on its own. `super_admin` holds every permission.

## Audit

Critical actions append `audit_logs` entries: `order.create`, `order.submit`,
`order.status_change`, `order.cancel`, `note.create`, `note.version`,
`observation.recorded`, `medication.administered`, `task.create`,
`task.complete`, `admission.create`, `admission.discharge`, `report.create`,
`triage.create`, `assignment.create`.

## Endpoints

| Method | Path                                                       | Permission           |
| ------ | ---------------------------------------------------------- | -------------------- |
| POST   | `/api/v1/patients/{id}/orders`                             | `orders.create`      |
| GET    | `/api/v1/patients/{id}/orders`                             | `orders.view`        |
| GET    | `/api/v1/orders/actionable`                                | `orders.manage`      |
| POST   | `/api/v1/orders/{id}/submit`                               | `orders.create`      |
| POST   | `/api/v1/orders/{id}/cancel`                               | `orders.create`      |
| POST   | `/api/v1/orders/{id}/status`                               | `orders.manage`      |
| POST   | `/api/v1/patients/{id}/notes`                              | `notes.write`        |
| GET    | `/api/v1/patients/{id}/notes`                              | `notes.view`         |
| GET    | `/api/v1/patients/{id}/notes/{groupId}`                    | `notes.view`         |
| POST   | `/api/v1/patients/{id}/notes/{groupId}/versions`           | `notes.write`        |
| POST   | `/api/v1/patients/{id}/observations`                       | `vitals.record`      |
| GET    | `/api/v1/patients/{id}/observations`                       | `vitals.view`        |
| POST   | `/api/v1/patients/{id}/administrations`                    | `mar.record`         |
| GET    | `/api/v1/patients/{id}/administrations`                    | `mar.view`           |
| POST   | `/api/v1/tasks`                                            | `tasks.create`       |
| GET    | `/api/v1/tasks`                                            | `tasks.view`         |
| POST   | `/api/v1/tasks/{id}/complete`                              | `tasks.complete`     |
| GET    | `/api/v1/patients/{id}/tasks`                              | `tasks.view`         |
| POST   | `/api/v1/patients/{id}/admissions`                         | `admissions.manage`  |
| GET    | `/api/v1/patients/{id}/admissions`                         | `admissions.view`    |
| POST   | `/api/v1/patients/{id}/admissions/{admissionId}/discharge` | `admissions.manage`  |
| POST   | `/api/v1/patients/{id}/reports`                            | `reports.write`      |
| GET    | `/api/v1/patients/{id}/reports`                            | `reports.view`       |
| POST   | `/api/v1/clinical/triage`                                  | `triage.manage`      |
| GET    | `/api/v1/clinical/queue`                                   | `assignments.view`   |
| POST   | `/api/v1/patients/{id}/assignments`                        | `assignments.manage` |

Shift handover is deferred to Phase 09 (staff, attendance & shift handover).
See `packages/api-contracts/openapi/v1/go-api.openapi.yaml` for the full
contract.
