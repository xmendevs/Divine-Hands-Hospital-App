# Reporting, Dashboards & Exports (Phase 12)

Role-specific operational and management intelligence, computed live from the
authoritative transactional tables — no stored aggregates, so every metric
always reflects current state.

## Permissions

| Permission       | Holder                | Access                                                            |
| ---------------- | --------------------- | ----------------------------------------------------------------- |
| `reports.view`   | all operational roles | `GET /api/v1/reports/my` — role-scoped report                     |
| `reports.admin`  | admin, super_admin    | `GET /api/v1/reports/dashboard` — aggregate dashboard             |
| `reports.export` | admin, super_admin    | `GET /api/v1/reports/export` — CSV / XLSX / PDF exports (audited) |

`reports.view` first appeared in Phase 04 for clinical (patient) reports; this
phase extends the same permission to role-scoped dashboards. Migration
`0023_reports_rbac` grants it to every operational role.

## Super admin dashboard

`GET /api/v1/reports/dashboard` returns the `Dashboard` aggregate:

- **patientRegistrations** — total and today (patients).
- **admissions** — active, discharged today.
- **revenue** — collected (payments today), invoiced (non-voided invoices),
  outstanding (issued/partially paid balances).
- **pharmacy** — active medicine count, stock on hand, batches expiring within
  30 days.
- **inventoryVariance** — today's stock counts with variance and total
  variance.
- **attendance** — currently clocked in; today's scheduled-but-missed shifts
  (approved rosters with no attendance record).
- **rosterCoverage** — scheduled vs required today and coverage %.
- **labWorkload** — open requests, results entered but not verified.
- **criticalAlerts** — unacknowledged critical lab notifications.
- **securityEvents** — security events in the last 24 hours.

## Role-scoped reports

`GET /api/v1/reports/my` dispatches on the caller's role:

| Role(s)                                      | Report          | Highlights                                                                            |
| -------------------------------------------- | --------------- | ------------------------------------------------------------------------------------- |
| doctor                                       | DoctorReport    | Assigned patients, pending lab results, pending orders                                |
| nurse, matron                                | NursingReport   | Active admissions, my handovers today, unacknowledged handovers, staff on duty today  |
| pharmacist                                   | PharmacyReport  | Dispensed today (+ value), low stock, stock on hand, expiring soon, adjustments (30d) |
| lab_technician, lab_supervisor               | LabReport       | Requests by status, pending verification, average turnaround                          |
| cashier, billing_officer, billing_supervisor | CashierReport   | Collected/payments today, outstanding, refunded today, open shifts, shift variance    |
| storekeeper                                  | InventoryReport | Low stock, expiring soon, stock on hand, today's count variance                       |
| receptionist                                 | ReceptionReport | Registered/admitted/discharged/triaged today                                          |
| admin, super_admin                           | Dashboard       | Same aggregate as the dashboard endpoint                                              |

Roles without a matching report receive `403` (e.g. auditor). Dashboard views
are audited (`reports.viewed`).

## Exports

`GET /api/v1/reports/export?report=<kind>&format=<fmt>&from=&to=`

- **report** — `patients`, `invoices`, `payments`, `dispensations`,
  `lab_requests`, `attendance`, `medicines`, `refunds`.
- **format** — `csv` (default), `xlsx`, `pdf`.
- **from/to** — inclusive `YYYY-MM-DD` bounds on the record timestamp;
  optional.

CSV uses the standard `encoding/csv` writer; XLSX is a minimal
dependency-free OOXML workbook (inline strings) opened directly by Excel and
LibreOffice; PDF renders a landscape A4 table via the existing `fpdf`
dependency (`internal/pdf/report.go`).

**Auditing** — every export is append-only audited (`reports.export`) with the
report kind, format, date range, and row count, so sensitive data exfiltration
attempts are always traceable. Export requests are permission-checked
(`reports.export`) before any data is read.

## Implementation notes

- Store: `apps/go-api/internal/store/reports.go` (dashboard + role reports),
  `apps/go-api/internal/store/export.go` (tabular extractions).
- Rendering: `apps/go-api/internal/export/export.go` (CSV, XLSX),
  `apps/go-api/internal/pdf/report.go` (PDF).
- Handlers & routes: `apps/go-api/internal/httpapi/reports.go`,
  `apps/go-api/internal/httpapi/router.go` (`/api/v1/reports/*`).
- All queries filter/aggregate directly on the phase tables (patients,
  admissions, invoices, payments, refunds, medicines, batches, stock counts,
  attendance, rosters, roster plans, lab requests, critical notifications,
  security events, handovers, orders, assignments).
