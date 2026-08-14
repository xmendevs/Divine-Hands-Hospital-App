# API Contracts

Single source of truth for shared API contracts. Both the Go core service and
the FastAPI analytics service must consume and emit these contracts so they
never implement conflicting business rules.

## Versioning

Contracts are versioned by major version directory:

```
contracts/
  v1/
    core.openapi.yaml
    analytics.openapi.yaml
```

- **Breaking changes** require a new major version (`v2/`).
- **Non-breaking, additive changes** are made in place within the current
  major version.
- Every contract change is reviewed with the shared domain model (see
  `docs/architecture.md`) to keep cross-service consistency.

Contract files are authored in the next build phase (Phase 1: Foundation,
architecture, security baseline).
