# Architecture

Repository layout and the cross-cutting constraints that govern all services.
Detailed per-phase architecture is documented in each build phase.

## Layout

```
apps/desktop         Tauri + React + TypeScript desktop client
services/core        Go high-throughput / core domain service
services/analytics   FastAPI analytics, reporting, document processing, ML
contracts/           Versioned OpenAPI contracts (single source of truth)
db/migrations/       Versioned PostgreSQL migrations
infra/compose/       Docker Compose for development services
.github/workflows/   CI/CD
docs/                Project documentation
```

## Canonical domain model

Go and FastAPI **must not** independently implement conflicting business
rules. Service boundaries are defined explicitly, and shared data contracts
are versioned under `contracts/`.

## Non-negotiables (from the Master Implementation Plan)

- Least privilege; role- and permission-based access.
- MFA for privileged accounts; encryption in transit and at rest.
- Immutable/auditable critical events; no silent clinical record overwrites.
- No arbitrary financial edits; separation of duties.
- Approval workflows for high-risk actions.
- Secure backup/restore following a 3-2-1-oriented strategy; never claim a
  backup succeeded until integrity verification completes.
- Explicit, policy-governed staff communications; no covert surveillance.
