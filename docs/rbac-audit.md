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
permissions.

## General inventory (Phase 06)

Phase 06 adds a `storekeeper` role holding the `assets.*` permissions
(`assets.view`, `assets.manage`, `assets.transfer`, `assets.adjust`,
`assets.count`, `assets.maintain`); `admin` holds `assets.view` only.
Super admin receives every permission automatically (see `docs/assets.md`). Nurses cannot edit prescriptions (no such endpoint + no
`orders.create`), and pharmacists hold no clinical permissions (cannot view
notes or alter diagnoses).

- Stock movements are append-only and every movement is audited.
- Price changes (`medicine.update`) record before/after values.
- Stock adjustments require a reason and, when
  `pharmacy.adjustment_approval_required` is `true`, go through a reusable
  `approval_requests` flow (`pending → approved/rejected`) with separation of
  duties (no self-approval). See `docs/pharmacy.md`.

## Laboratory (Phase 07)

Phase 07 adds six `lab.*` permissions (`lab.view`, `lab.order`, `lab.manage`,
`lab.analyze`, `lab.verify`, `lab.release`) and two system roles:

- **lab_technician** — `lab.view`, `lab.order`, `lab.manage`, `lab.analyze`
  (specimen custody, collection, reception, result entry).
- **lab_supervisor** — `lab.view`, `lab.analyze`, `lab.verify`,
  `lab.release` (verification, critical-result acknowledgement, release).

Existing roles are extended minimally: **doctor** gains `lab.view` +
`lab.order` (orders tests); **nurse** gains `lab.view` (reads results);
**storekeeper** and **pharmacist** gain nothing. Verification is separated
from entry — high-risk tests (`verification_required`) reject self-verification
(422), and technicians cannot verify at all (403). Every lab action is audited
(`lab.*` actions), specimen custody is append-only
(`lab_specimen_events`), and critical-result notifications record who was
notified, by whom they were acknowledged, and when.

## Billing, cashier, payments & receipts (Phase 08)

Phase 08 adds seven `billing.*` permissions (`billing.view`, `billing.create`,
`billing.manage`, `billing.collect`, `billing.refund`, `billing.approve`,
`billing.reconcile`) and three system roles:

- **cashier** — `billing.view`, `billing.collect`, `billing.refund`,
  `billing.reconcile` (opens/closes shifts, takes payments, processes
  approved refunds; cannot create invoices, edit price lists, or approve
  refunds).
- **billing_officer** — `billing.view`, `billing.create`, `billing.manage`,
  `billing.refund` (creates and issues invoices, maintains price lists).
- **billing_supervisor** — `billing.view`, `billing.refund`,
  `billing.approve`, `billing.reconcile` (approves/rejects refund requests;
  cannot create invoices or collect payments).

Existing roles are extended minimally: **doctor** gains `billing.view` +
`billing.create` (invoices for orders); **admin** gains `billing.view` only.
Cashier duties are separated from approval duties: approving your own refund
request is blocked (422 `self_approval`), and the cashier who received a
payment can never approve its refund (no `billing.approve`). Payments are
append-only (DB trigger rejects UPDATE/DELETE), refund processing requires an
open shift and reverses the invoice balance, and every billing action is
audited (`billing.*` actions). See `docs/billing.md`.

## Staff, attendance & handover (Phase 09)

Phase 09 adds eight permissions across three modules: `attendance.clock`,
`attendance.view`, `attendance.manage`; `handover.create`, `handover.view`,
`handover.acknowledge`; and `staff.leave_request`, `staff.leave_manage`.

- **nurse** — clocks in/out and creates/views/acknowledges handover.
- **doctor** — clocks in/out and creates/views handover.
- **matron** & **admin** — `attendance.view` + `attendance.manage` and
  `staff.leave_manage` (reporting and leave decisions).
- Every clinical/operational role gains `attendance.clock` +
  `staff.leave_request`.

Clock-in/out is self-service and bound to the caller's staff profile; methods
must be approved (`attendance.allowed_methods` setting). Duplicate/invalid
clock-ins are blocked by unique indexes, handover self-acknowledgement is
blocked (422 `self_acknowledgement`), and every action is audited
(`staff.*`, `attendance.*`, `handover.*`). See `docs/staff-attendance.md`.

## Automatic roster planning & approval (Phase 10)

Phase 10 adds `roster.view`, `roster.plan`, and `roster.approve`.

- **matron** & **admin** — `roster.view` + `roster.plan` (create, generate,
  edit, submit).
- **super_admin** — approves/rejects submitted rosters (holds every
  permission); a submitted roster cannot be approved by the planner who
  submitted it (matron/admin lack `roster.approve`).

Hard constraints (leave, unavailability, rest, hours, consecutive and night
limits) are enforced by the generator, a unique `(plan_id, staff_id,
work_date)` index prevents conflicting shifts, and published rosters are
immutable except through an amendment draft. Every plan/assignment/submission
/approval/rejection is audited with `roster.*` actions. See
`docs/roster-planning.md`.

## Notifications & governed communications (Phase 11)

Phase 11 adds eight permissions across two modules: `notifications.view`,
`notifications.send`; `comms.send`, `comms.view`, `comms.manage`,
`comms.announce`, `comms.admin`, `comms.audit`.

- Every clinical/operational role gains `notifications.view` + `comms.send` +
  `comms.view` (see their own alerts and message with peers).
- **matron** & **admin** additionally hold `notifications.send`,
  `comms.manage`, and `comms.announce` (alerts, channel management,
  announcements).
- **admin** holds `comms.admin` (restricted administrative access); **auditor**
  holds `comms.audit` (compliance investigations). super_admin holds all
  permissions.

Governance is explicit, not covert: no call/message interception exists. Users
are shown a retention/audit notice (`GET /communications/policy`) and must
acknowledge it. Administrative access (`GET /communications/admin/messages`)
and compliance searches (`GET /communications/compliance/search`) are both
locked behind separate permissions and audit the filters used
(`communications.admin_access`, `communications.compliance_search`). Retention
rules (`comms.retention_days`) are applied at read time and by an audited purge
(`communications.retention_run`); attachments are capped by
`comms.attachment_max_bytes`. See `docs/notifications-comms.md`.

## Reporting, dashboards & exports (Phase 12)

Phase 12 adds `reports.admin` and `reports.export`, and extends `reports.view`
(reused from Phase 04) to every operational role.

- Every operational role (`nurse`, `matron`, `doctor`, `pharmacist`,
  `lab_technician`, `lab_supervisor`, `storekeeper`, `cashier`,
  `billing_officer`, `billing_supervisor`, `receptionist`, `admin`) holds
  `reports.view` and sees a **role-scoped** report via
  `GET /api/v1/reports/my`.
- **admin** & **super_admin** hold `reports.admin` and see the aggregate
  dashboard via `GET /api/v1/reports/dashboard` (admin also gets the dashboard
  from `/reports/my`).
- **admin** & **super_admin** hold `reports.export`: CSV/XLSX/PDF exports
  (`GET /api/v1/reports/export`) of patients, invoices, payments,
  dispensations, lab requests, attendance, medicines, and refunds. Every
  export is audited with `reports.export` including report, format, date
  range and row count; dashboard views are audited with `reports.viewed`.

All metrics are computed live from the transactional tables (no stored
aggregates), so reports always reflect the authoritative state. See
`docs/reports.md`.

## Endpoints

See `apps/go-api/README.md` and the OpenAPI contract in
`packages/api-contracts/`.
