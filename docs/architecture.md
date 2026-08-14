# Architecture

Repository layout and the cross-cutting constraints that govern all services.
Detailed per-phase architecture is documented in each build phase.

## Layout

```
apps/desktop          Tauri + React + TypeScript desktop client
apps/go-api           Go core / high-throughput service
apps/fastapi          FastAPI analytics, reporting, document processing, ML
packages/api-contracts Versioned OpenAPI contracts (single source of truth)
packages/ui           Shared React components
db/migrations/        Versioned PostgreSQL migrations
db/seeds/             Idempotent development/test seed data
infra/docker/         Docker Compose development stack
infra/backup/         Backup & disaster recovery (Phase 12)
scripts/              Developer scripts (bootstrap, up/down, verify)
docs/                 Project documentation
.github/workflows/    CI/CD
```

## Canonical domain model

Go and FastAPI **must not** independently implement conflicting business
rules. Service boundaries are defined explicitly, and shared data contracts are
versioned under `packages/api-contracts/`.

## Non-negotiables (from the Master Implementation Plan)

- Least privilege; role- and permission-based access.
- MFA for privileged accounts; encryption in transit and at rest.
- Immutable/auditable critical events; no silent clinical record overwrites.
- No arbitrary financial edits; separation of duties.
- Approval workflows for high-risk actions.
- Secure backup/restore following a 3-2-1-oriented strategy; never claim a
  backup succeeded until integrity verification completes.
- Explicit, policy-governed staff communications; no covert surveillance.
