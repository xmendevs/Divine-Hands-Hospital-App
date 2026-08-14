# Identity, RBAC & audit

## Model

- **users** — internal UUID primary key; `username`/`email` are human-readable
  business identifiers. Status is `pending | active | suspended`.
- **staff** — human profile linked to a user; `employee_no` is the business ID.
- **roles** — named permission sets; `super_admin` holds every permission.
- **permissions** — codes of the form `<module>.<verb>` (e.g. `users.view`,
  `users.create`, `billing.approve`). Verbs include view, create, edit, approve,
  reverse, export.
- **user_roles / role_permissions** — many-to-many assignment tables.
- **departments** — organizational grouping for staff.
- **sessions** — opaque bearer tokens, stored hashed; revocable and expiring.
- **security_events** — authentication lifecycle events (login, logout, reset).
- **audit_logs** — append-only record of privileged/sensitive actions.
- **system_settings** — runtime configuration (key → JSON value).
- **patients / families / patient_clinical_entries / patient_amendments /
  patient_timeline / patient_documents** — the patient master record (Phase 03;
  see `docs/patients.md`).

## Passwords & MFA

- Passwords are hashed with **Argon2id** (PHC string format).
- MFA is **TOTP** via authenticator apps; secrets are encrypted at rest with
  AES-256-GCM (key from `MFA_ENCRYPTION_KEY`).
- Roles flagged `mfa_required` (e.g. `super_admin`) force MFA at login.

## Authorization

- Every protected endpoint enforces permissions **server-side**; the frontend
  never gates access on its own.
- Requests without a valid session return `401`; valid sessions without the
  required permission return `403`.
- `super_admin` bypasses permission checks (it is granted every permission).

## Audit

- Privileged mutations (user/role/permission/settings changes) and sensitive
  reads (user listing, audit viewing) append `audit_logs` entries.
- `audit_logs` is append-only: a database trigger rejects `UPDATE`/`DELETE`.
- Entries carry actor, target, action, request ID, and source IP.

## Clinical roles & patient permissions

Phase 03 adds patient-module permissions (`patients.*`, `clinical.*`,
`families.*`, `documents.*`) and four system roles:

- **receptionist** — register + demographics + search + families (no clinical).
- **nurse** — receptionist surface + `clinical.view`/`clinical.edit` + documents.
- **matron** — nurse surface + `patients.amend` (record corrections).
- **doctor** — clinical care + `patients.amend`, no staff administration.

Clinical data (`clinical.view`) is never exposed to roles that lack it —
server-side, regardless of the frontend.

## Patient audit & amendments

- Sensitive patient actions append audit entries: `patient.create`,
  `patient.update`, `patient.amend`, `clinical.add`, `clinical.amend`,
  `clinical.viewed`, `patient.viewed`, `family.create`, `document.add`.
- Clinical corrections write an append-only `patient_amendments` record with
  before/after values and a reason; clinical information is never silently
  overwritten. See `docs/patients.md`.

## Clinical workflows (Phase 04)

Phase 04 adds clinical permissions (`orders.*`, `notes.*`, `vitals.*`,
`mar.*`, `tasks.*`, `admissions.*`, `reports.*`, `triage.manage`,
`assignments.*`) and grants them to the clinical roles:

- **doctor** — create orders, write notes, view vitals/MAR, create/view tasks,
  admit/discharge, write/view reports, manage assignments.
- **nurse** — view/manage orders, write notes, record vitals/MAR, view/complete
  tasks.
- **matron** — nurse surface plus task creation, assignments, and report view.
- **receptionist** — emergency triage + assignment view.

Critical clinical actions (`order.*`, `note.*`, `medication.administered`,
`admission.*`, `task.*`, `triage.create`, `assignment.create`) append audit
entries. Order ownership (doctor submit/cancel own orders) is enforced
server-side. See `docs/clinical.md`.

## Pharmacy (Phase 05)

Phase 05 adds a `pharmacist` role holding `medicines.*` and `inventory.*`
permissions. Nurses cannot edit prescriptions (no such endpoint + no
`orders.create`), and pharmacists hold no clinical permissions (cannot view
notes or alter diagnoses).

- Stock movements are append-only and every movement is audited.
- Price changes (`medicine.update`) record before/after values.
- Stock adjustments require a reason and, when
  `pharmacy.adjustment_approval_required` is `true`, go through a reusable
  `approval_requests` flow (`pending → approved/rejected`) with separation of
  duties (no self-approval). See `docs/pharmacy.md`.

## Endpoints

See `apps/go-api/README.md` and the OpenAPI contract in
`packages/api-contracts/`.
