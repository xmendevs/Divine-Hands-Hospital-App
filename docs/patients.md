# Patient registration & master patient record (Phase 03)

The patient system is implemented in the Go core service. It is the shared
master patient record consumed by nursing, doctors, laboratory, pharmacy, and
billing.

## Business IDs

Patients carry a human-readable business ID generated **transactionally** so it
is never duplicated, plus an immutable internal UUID primary key.

| Registration type | Prefix | Example    |
| ----------------- | ------ | ---------- |
| Normal            | `DHH`  | `DHH0001`  |
| Family            | `DHHF` | `DHHF0001` |
| Antenatal         | `DHHA` | `DHHA0001` |
| Emergency         | `DHHE` | `DHHE0001` |

Generation uses a per-prefix counter table (`patient_id_counters`) and the
`next_patient_id(prefix)` function. The `UPDATE … RETURNING` row lock serializes
concurrent registrations, so two registrations can never receive the same ID.

## Model

- **patients** — demographics, contact, address, identification, next of kin,
  consent/privacy, and registration type. `patient_no` is unique.
- **families** — a family profile with its own `DHHF` ID; patients link via
  `family_id` (`head_patient_id` points at the head of the family).
- **patient_clinical_entries** — clinical sections: allergy, medical history,
  surgical history, chronic condition, medication, family history, social
  history. Section-specific fields live in a JSONB `details` column.
- **patient_amendments** — correction records capturing before/after values and
  a reason. Clinical information is **never silently overwritten**.
- **patient_timeline** — registration, amendments, clinical changes, and (in
  later phases) visits, vitals, notes, orders, prescriptions, lab activity, and
  billing events.
- **patient_documents** — document metadata; binary upload lands with the
  object-storage phase.

## Duplicate safeguards

- `patients.identification_number` has a **partial unique index**, so a
  non-empty national ID / identifier can never be registered twice.
- Before registration the service runs a soft duplicate check by identification
  number or name + date of birth and returns `409 duplicate_patient` with the
  candidate records. `force: true` bypasses the soft check; the database index
  still enforces the hard rule.

## Integrity & amendments

- Clinical entries are appended via `clinical.edit`; corrections go through the
  `patients.amend` permission.
- Every correction writes a `patient_amendments` row recording the previous and
  new values plus a reason, in the same transaction as the update.
- Patient-level clinical fields (e.g. blood group, genotype) are corrected via
  `POST /api/v1/patients/{id}/amend` with a whitelisted field set.
- Sensitive reads and mutations append `audit_logs` entries
  (`patient.create`, `patient.update`, `patient.amend`, `clinical.add`,
  `clinical.amend`, `clinical.viewed`, …).

## Permissions & roles

| Role         | Surface                                                     |
| ------------ | ----------------------------------------------------------- |
| receptionist | register, demographics, search, families (no clinical view) |
| nurse        | receptionist + clinical view/edit + documents               |
| matron       | nurse + `patients.amend` (corrections)                      |
| doctor       | clinical care + `patients.amend`, no staff administration   |

`super_admin` holds every permission. Clinical data is only returned to callers
holding `clinical.view`; authorization is enforced server-side on every
endpoint.

## Endpoints

| Method | Path                                       | Permission         |
| ------ | ------------------------------------------ | ------------------ |
| POST   | `/api/v1/patients`                         | `patients.create`  |
| GET    | `/api/v1/patients/search?q=…`              | `patients.search`  |
| GET    | `/api/v1/patients/{id}`                    | `patients.view`    |
| PATCH  | `/api/v1/patients/{id}`                    | `patients.edit`    |
| POST   | `/api/v1/patients/{id}/amend`              | `patients.amend`   |
| GET    | `/api/v1/patients/{id}/clinical`           | `clinical.view`    |
| POST   | `/api/v1/patients/{id}/clinical`           | `clinical.edit`    |
| PATCH  | `/api/v1/patients/{id}/clinical/{entryId}` | `patients.amend`   |
| GET    | `/api/v1/patients/{id}/timeline`           | `patients.view`    |
| GET    | `/api/v1/patients/{id}/documents`          | `documents.view`   |
| POST   | `/api/v1/patients/{id}/documents`          | `documents.upload` |
| POST   | `/api/v1/families`                         | `families.create`  |
| GET    | `/api/v1/families/{id}`                    | `families.view`    |

See `packages/api-contracts/openapi/v1/go-api.openapi.yaml` for the full
contract.
