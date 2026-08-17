# Staff, attendance, clock-in/out & handover (Phase 09)

Implemented in the Go core service. Covers the workforce record, clock-in/out
attendance, leave, and nursing shift handover.

## Model overview

- **staff** (extended) — the `staff` profile from Phase 02 now also records
  contact phone/email, `employment_status` (`active | on_leave | terminated |
suspended`), availability, skills and certifications (text arrays), and an
  optional hire date.
- **staff_leave** — leave requests (`annual`, `sick`, etc.) with
  `pending → approved/rejected` status, decided by a manager.
- **staff_shifts** — named shift definitions (`code`, name, `start_time`,
  `end_time`, late grace in minutes) that attendance is measured against.
- **attendance_records** — one clock-in/out event per staff member per shift
  per day. Records the work date, clock-in/out timestamps, method and device.
  `is_late` is computed at clock-in (after shift start + grace);
  `is_early_leave` is computed at clock-out (before shift end).
- **staff_rosters** — staff scheduled to a shift on a date; the source of
  truth for who was expected to work.
- **handover_notes** — structured nursing handover authored by an outgoing
  nurse: patient list, current condition, medications, pending investigations,
  pending orders, important observations, tasks, incidents and instructions.
  An incoming nurse acknowledges receipt (`created → acknowledged`).

## Workflow

```
clock-in ──▶ clocked_in ──clock-out──▶ completed
                └── duplicate/invalid blocked (unique indexes)
```

- Clock-in/out is self-service: the authenticated user's staff profile is used.
  Method must be one of the base methods (`kiosk`, `biometric`, `mobile`,
  `manual`) or a custom method in setting `attendance.allowed_methods`.
- Duplicate or invalid clock-ins are prevented at the database level: at most
  one open record per staff (partial unique index) and at most one record per
  staff/shift/date.
- Handover self-acknowledgement is blocked (422 `self_acknowledgement`).

## Attendance report & roster

Staff are scheduled via the roster (`POST /attendance/rosters`, one staff per
shift per date). `GET /api/v1/attendance/report?date=YYYY-MM-DD` returns one
row per recorded attendance (`late`, `early`, `completed`, or `clocked_in`)
plus a `missed` row for every roster entry with no matching attendance that
day — or `on_leave` when the staff member has an approved leave covering the
date. This satisfies the late/early/missed identification requirement.

## Permissions

- `attendance.clock`, `attendance.view`, `attendance.manage`
- `handover.create`, `handover.view`, `handover.acknowledge`
- `staff.leave_request`, `staff.leave_manage` (plus existing `staff.*`)

Roles: **nurse** clocks in and creates/acknowledges handover; **doctor**
clocks in and creates/views handover; **matron** and **admin** hold
`attendance.view`/`attendance.manage` and `staff.leave_manage`. Every
clinical/operational role can clock in and request leave. See
`docs/rbac-audit.md`.

## Audit

Every mutation is audited: `staff.update`, `staff.leave_request`,
`staff.leave_approve`, `staff.leave_reject`, `attendance.shift_create`,
`attendance.clock_in`, `attendance.clock_out`, `handover.create`,
`handover.acknowledge`, `attendance.roster_assign`, `attendance.roster_remove`.

## Endpoints

| Method | Path                                 | Permission             |
| ------ | ------------------------------------ | ---------------------- |
| GET    | `/api/v1/staff`                      | `staff.view`           |
| GET    | `/api/v1/staff/{id}`                 | `staff.view`           |
| PATCH  | `/api/v1/staff/{id}`                 | `staff.edit`           |
| POST   | `/api/v1/staff/leave`                | `staff.leave_request`  |
| GET    | `/api/v1/staff/leave`                | `staff.leave_request`  |
| POST   | `/api/v1/staff/leave/{id}/approve`   | `staff.leave_manage`   |
| POST   | `/api/v1/staff/leave/{id}/reject`    | `staff.leave_manage`   |
| POST   | `/api/v1/attendance/shifts`          | `attendance.manage`    |
| GET    | `/api/v1/attendance/shifts`          | `attendance.view`      |
| POST   | `/api/v1/attendance/clock-in`        | `attendance.clock`     |
| POST   | `/api/v1/attendance/clock-out`       | `attendance.clock`     |
| GET    | `/api/v1/attendance`                 | `attendance.view`      |
| GET    | `/api/v1/attendance/report`          | `attendance.view`      |
| POST   | `/api/v1/attendance/rosters`         | `attendance.manage`    |
| GET    | `/api/v1/attendance/rosters`         | `attendance.view`      |
| DELETE | `/api/v1/attendance/rosters/{id}`    | `attendance.manage`    |
| POST   | `/api/v1/handovers`                  | `handover.create`      |
| GET    | `/api/v1/handovers`                  | `handover.view`        |
| GET    | `/api/v1/handovers/{id}`             | `handover.view`        |
| POST   | `/api/v1/handovers/{id}/acknowledge` | `handover.acknowledge` |
