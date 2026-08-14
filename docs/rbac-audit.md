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

## Endpoints

See `apps/go-api/README.md` and the OpenAPI contract in
`packages/api-contracts/`.
