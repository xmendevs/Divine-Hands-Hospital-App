# Google Stitch UI generation prompt

Copy everything below the `---` line into Google Stitch. If Stitch supports
file uploads, also attach `packages/api-contracts/openapi/v1/go-api.openapi.yaml`
(the full machine-readable API contract).

---

You are building the complete front-end for "Divine Hands Hospital", a hospital
management system (HIMS) that runs as a desktop app. Generate the full
React + TypeScript source code as a set of files.

## Hard technical constraints (do not deviate)

- React 19 + TypeScript, built with Vite, running inside a Tauri 2 desktop shell.
  This is a pure client-side SPA: there is NO Node.js backend and NO SSR.
- Use ONLY plain `fetch` for HTTP. Do NOT use axios or any HTTP library.
- Keep dependencies minimal: React, ReactDOM, and nothing else unless strictly
  needed. If you need navigation, use simple state-based navigation (a
  `view` state variable) — do not add react-router.
- Strict TypeScript. All API responses must be typed.
- Store two things in `localStorage`: the session token (`hims_token`) and the
  server base URL (`hims_server_url`).

## Server connection

- The app calls a Go REST API. Base URL is configurable at runtime and defaults
  to `http://127.0.0.1:8080`. Every request is `<base>/api/v1/...`.
- There must be a Settings screen where the user edits and saves the server URL
  (e.g. `http://192.168.1.10:8080` for the main PC on the LAN).
- Create one typed API client module (`api/client.ts`) that reads the base URL
  from localStorage and attaches `Authorization: Bearer <token>` to every
  request when a token exists.

## Authentication

- `POST /api/v1/auth/login`
  - Request body: `{ "username": string, "password": string, "totpCode"?: string, "deviceName"?: string }`
  - 200 response: `{ "token": string, "expiresAt": string, "mustChangePassword": boolean, "user": { "id": string, "username": string, "email": string, "status": string } }`
  - If the server returns 401 with `error.code === "mfa_required"`, show a
    6-digit TOTP code input and re-submit the same credentials plus `totpCode`.
  - If `mustChangePassword` is true, force a change-password screen after login.
- On success, store the token and call `GET /api/v1/auth/me` to load the user's
  roles and permissions; use these to drive navigation (hide menu items the
  user cannot access).
- `GET /api/v1/auth/me` returns:
  `{ "id": string, "username": string, "email": string, "status": string, "mustChangePassword": boolean, "mfaEnabled": boolean, "staff": object|null, "roles": [{ "id": string, "code": string, "name": string }], "permissions": string[] }`
- `POST /api/v1/auth/logout` (204). `POST /api/v1/auth/change-password`
  body `{ "currentPassword": string, "newPassword": string }` (min 8 chars).
- `POST /api/v1/auth/mfa/setup` → `{ "secret": string, "otpauthUrl": string }`;
  render the QR/otpauth URL. `POST /api/v1/auth/mfa/confirm` body `{ "code": string }`.
- On app start, if a token exists, call `/auth/me` to restore the session;
  if it returns 401, clear the token and show the login screen.

## Error handling (important)

Every non-2xx response has this shape:
`{ "error": { "code": string, "message": string, "requestId": string } }`.
Always show `error.message` to the user (inline or as a toast). On 401, redirect
to login. On 403, show "insufficient permissions". Show a loading state for
every list, and an empty state when a list is empty.

## Conventions

- IDs are UUID strings. Timestamps are RFC3339 UTC strings.
- Patient identifiers use the format `E-<number>` (e.g. `E-1201`).
- All JSON field names are camelCase.
- Lists support search where the endpoint provides a `q` query parameter.

## Screens to build

Build one screen per module below. Use a sidebar layout with grouped sections.
Show/hide each section based on the permissions from `/auth/me`.

1. **Login** — username, password, optional TOTP code, device name; handles
   `mfa_required`, invalid credentials, and suspended account messages.

2. **Dashboard** — `GET /api/v1/reports/dashboard` (admin summary) and
   `GET /api/v1/reports/my` (staff summary). Show cards/statistics.

3. **Patients** — `GET /api/v1/patients/search?q=`, `POST /api/v1/patients`,
   `GET /api/v1/patients/{id}`, `PATCH /api/v1/patients/{id}`,
   `POST /api/v1/patients/{id}/amend`. Detail view with tabs for:
   - Clinical: `GET/POST /api/v1/patients/{id}/clinical`, `PATCH .../clinical/{entryId}`
   - Timeline: `GET /api/v1/patients/{id}/timeline`
   - Documents: `GET/POST /api/v1/patients/{id}/documents` (file upload)
   - Orders: `POST/GET /api/v1/patients/{id}/orders`
   - Notes: `GET/POST /api/v1/patients/{id}/notes` and versions
   - Vitals: `GET/POST /api/v1/patients/{id}/observations`
   - MAR: `GET/POST /api/v1/patients/{id}/administrations`
   - Admissions: `GET/POST /api/v1/patients/{id}/admissions`, discharge action
   - Tasks: `GET /api/v1/patients/{id}/tasks`

4. **Orders & Tasks** — `GET /api/v1/orders/actionable`, submit/cancel/status
   actions; `GET/POST /api/v1/tasks`, complete action.

5. **Triage & Queue** — `POST /api/v1/clinical/triage`,
   `GET /api/v1/clinical/queue`, assign patients.

6. **Pharmacy** — medicines CRUD (`/api/v1/pharmacy/medicines`), batches,
   receive stock, dispense, adjustments, approvals (approve/reject), returns,
   damage, quarantine, transfers, stock counts, movements, low-stock alerts.

7. **Laboratory** — tests CRUD, clients CRUD, requests workflow
   (`/api/v1/lab/requests` + status/cancel/collect/results/release), specimen
   receive/reject, verify items, critical results list + acknowledge.

8. **Billing & Cashier** — price lists, invoices (create/issue/void), payments,
   receipts (view HTML/PDF, share), refunds workflow, cashier shifts.

9. **Inventory & Assets** — categories, assets CRUD, movements, counts, status,
   transfer, adjust, maintenance records and schedules, service providers.

10. **Staff & Attendance** — staff list/detail/edit, leave requests, clock-in/
    clock-out, attendance list and report, shift rosters.

11. **Handovers** — create/list/view/acknowledge handover notes.

12. **Roster Planning** — plans list/create/regenerate, assignment editing,
    submit/approve/reject/amend workflow.

13. **Notifications** — `GET /api/v1/notifications`, unread count badge,
    mark-read / read-all, compose notification.

14. **Communications** — channels, members, channel + direct messages,
    announcements, admin message search, compliance search.

15. **Admin** — users (list/create/edit/suspend/activate/assign roles), roles
    and permissions, departments, audit logs, settings.

16. **Backups** (admin/super_admin) — `GET /api/v1/backups/status`,
    `GET /api/v1/backups/jobs`, manual run and verify actions.

17. **Settings** — server URL editor (required), change password, MFA setup,
    logout.

## UX & design

- Professional medical/clinical theme: clean, high contrast, accessible,
  left sidebar navigation, consistent tables with search + actions, modal or
  slide-over forms, toasts for success/error.
- Every destructive action (void, discharge, refund, cancel) asks for
  confirmation.
- Respect the permissions list everywhere: a user without a permission should
  never see the button or screen for it.
- Handle the offline case gracefully: if `fetch` fails (network error), show a
  clear "Cannot reach the server at <url>. Check the main PC is on and the
  address is correct in Settings." banner and do not crash.

Output: complete, runnable TypeScript/TSX files (client, types, components,
screens, and the entry point wiring them together), ready to drop into a
Vite + React 19 project.
