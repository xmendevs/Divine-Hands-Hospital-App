# Notifications & Governed Internal Communications (Phase 11)

Staff coordination without covert surveillance: in-app/email notifications,
direct messages, department and shift channels, announcements, and a policy
that makes retention and audit explicit to every user.

## Notifications

Notifications are persisted rows fanning out to specific users, to a channel's
members, or to every active user. Each has a `category`, a delivery `channel`
(`in_app`, `email`, `both`), and an `email_status`.

- `GET /api/v1/notifications` — the caller's notifications (`?category=`,
  `?unread=true`, paged).
- `GET /api/v1/notifications/unread-count` — unread count.
- `POST /api/v1/notifications/{id}/read` — mark one read.
- `POST /api/v1/notifications/read-all` — mark all read.
- `POST /api/v1/notifications` (`notifications.send`) — send an alert to
  specific users. This is the endpoint other modules (stock, payments, roster,
  lab criticals) use to emit `stock`, `payment`, `roster`, `reminder`,
  `critical_clinical`, etc. alerts.

Direct messages and announcements automatically fan out in-app notifications;
email channels are recorded as `pending` so a mail transport worker can pick
them up (no SMTP transport is wired in the core service yet).

## Channels & messaging

- Channels are either `department` or `shift` scoped
  (`POST/GET /api/v1/communications/channels`, `GET .../{id}`), with members
  managed via `POST/DELETE .../{id}/members` (`comms.manage`).
- Direct messages: `POST /api/v1/communications/messages` +
  `GET .../messages?recipientId=` (thread between two users).
- Channel messages: `POST/GET /api/v1/communications/channels/{id}/messages`
  — sending and reading require membership; a non-member is rejected (403)
  unless they hold `comms.admin`, in which case the read is audited.
- Announcements: `POST /api/v1/communications/announcements` (global or
  `channelId`-scoped) + `GET .../announcements`. Announcements fan out an
  `announcement` notification to the recipients.

Message attachments are recorded as metadata (`fileName`, `mimeType`,
`sizeBytes`, `storageRef`) and validated against the attachment policy
(`comms.attachment_max_bytes`). Binary upload to object storage is a follow-up;
the contract already carries the storage reference.

## Governance (no covert surveillance)

- No call/message interception exists anywhere in the codebase. The only ways
  to read another user's communications are the two audited, permission-gated
  search endpoints below.
- **Explicit notice** — `GET /api/v1/communications/policy` returns the
  hospital-owned retention/audit notice and whether the caller has
  acknowledged it; `POST .../policy/acknowledge` records acknowledgement.
- **Restricted + audited access** — `GET /api/v1/communications/admin/messages`
  (`comms.admin`) and `GET /api/v1/communications/compliance/search`
  (`comms.audit`) search across senders, recipients, channels, text, and dates.
  Every call writes an audit entry (`communications.admin_access` /
  `communications.compliance_search`) recording the filters used.
- **Retention** — `comms.retention_days` (default 365) excludes expired
  messages from listing, and `POST /api/v1/communications/retention/run`
  (`comms.admin`) hard-deletes expired messages and notifications, logging
  `communications.retention_run`.

Settings:

| Key                          | Default           | Purpose                                     |
| ---------------------------- | ----------------- | ------------------------------------------- |
| `comms.policy_notice`        | built-in notice   | Policy text shown to users                  |
| `comms.retention_days`       | `365`             | Retention window for messages/notifications |
| `comms.attachment_max_bytes` | `5242880` (5 MiB) | Attachment size cap                         |

## Permissions

See `docs/rbac-audit.md`. In short: everyone with a staff role can read their
notifications and message peers; matrons/admins send alerts, manage channels,
and announce; only admins hold `comms.admin` and only auditors hold
`comms.audit`.
