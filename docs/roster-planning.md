# Automatic roster planning & approval (Phase 10)

Implemented in the Go core service. Builds on Phase 09 staff, shifts,
availability, and leave to auto-generate fair, constraint-aware rosters.

## Model overview

- **staff_shifts** (extended) — now carries an `is_night` flag so night-shift
  rules can be enforced explicitly. Defaults: Day 08:00–16:00, Afternoon
  16:00–00:00, Night 00:00–08:00 (all times configurable).
- **staff_unavailability** — a staff member marked unavailable for a whole day
  (one record per staff/date).
- **staff_shift_preferences** — ranked shift preferences used as a soft
  constraint (lower rank = more preferred).
- **roster_plans** — a planning session with the date range, department,
  constraints (`max_hours_per_week`, `max_consecutive_shifts`,
  `min_rest_hours`, `max_consecutive_nights`), per-shift `shift_requirements`
  (required staffing), a status and a version. `amended_from` links an
  amendment draft to the approved plan it amends.
- **roster_assignments** — the proposed/published assignment set. A unique
  `(plan_id, staff_id, work_date)` index guarantees no staff member holds two
  shifts on the same date.

## Workflow

```
draft ──submit──▶ submitted ──approve──▶ approved (published)
  ▲                  │                     │
  │                  └─────reject──────────┘
  └── amend (new draft copies an approved plan)
```

- A planner (matron/admin) creates a plan with parameters; the system
  generates a proposed roster.
- The planner reviews/edits (add, move, remove assignments; regenerate) while
  the plan is `draft`.
- The planner submits; a **super admin** approves (publishing the roster into
  the active `staff_rosters` table) or rejects with a reason.
- Once approved, the plan is immutable; changes go through a new amendment
  draft (`POST /roster/plans/{id}/amend`).

## Generation algorithm

A deterministic greedy scheduler fills each shift requirement, date by date,
in shift start order. Each staff member is considered against **hard**
constraints:

- active and in the plan's department;
- not on approved leave or marked unavailable that date;
- no conflicting shift (at most one assignment per date);
- minimum rest between the previous shift end and the next start;
- maximum consecutive shifts;
- maximum hours per week;
- maximum consecutive night shifts.

Among eligible staff, the scheduler prefers (soft constraints): ranked shift
preference first, then lowest total assigned hours (fairness), then employee
number (determinism). When a requirement cannot be filled, the shortfall is
reported in the plan's `unmet` list — required staffing levels are evaluated,
not silently ignored.

## Permissions

- `roster.view`, `roster.plan`, `roster.approve`.
- **matron** and **admin** hold `roster.view` + `roster.plan`.
- **super_admin** approves/rejects (holds every permission).

## Audit

Every action is audited: `roster.plan_create`, `roster.generate`,
`roster.assignment_add`, `roster.assignment_remove`, `roster.submit`,
`roster.approve`, `roster.reject`, `roster.amend` — capturing who changed what
and the plan version.

## Endpoints

| Method | Path                                                   | Permission          |
| ------ | ------------------------------------------------------ | ------------------- |
| POST   | `/api/v1/roster/plans`                                 | `roster.plan`       |
| GET    | `/api/v1/roster/plans`                                 | `roster.view`       |
| GET    | `/api/v1/roster/plans/{id}`                            | `roster.view`       |
| POST   | `/api/v1/roster/plans/{id}/regenerate`                 | `roster.plan`       |
| POST   | `/api/v1/roster/plans/{id}/assignments`                | `roster.plan`       |
| DELETE | `/api/v1/roster/plans/{id}/assignments/{assignmentId}` | `roster.plan`       |
| POST   | `/api/v1/roster/plans/{id}/submit`                     | `roster.plan`       |
| POST   | `/api/v1/roster/plans/{id}/approve`                    | `roster.approve`    |
| POST   | `/api/v1/roster/plans/{id}/reject`                     | `roster.approve`    |
| POST   | `/api/v1/roster/plans/{id}/amend`                      | `roster.plan`       |
| POST   | `/api/v1/staff/unavailability`                         | `attendance.manage` |
| GET    | `/api/v1/staff/unavailability`                         | `attendance.view`   |
| DELETE | `/api/v1/staff/unavailability/{id}`                    | `attendance.manage` |

Shift preferences are set via `PATCH /api/v1/staff/{id}` (`shiftPreferences`)
and returned by `GET /api/v1/staff/{id}`.
