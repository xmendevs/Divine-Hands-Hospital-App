# API Contracts

Single source of truth for shared API contracts. Both the Go core service and
the FastAPI analytics service must consume and emit these contracts so they
never implement conflicting business rules (see `docs/architecture.md`).

## Layout

```
openapi/
  v1/
    go-api.openapi.yaml
    fastapi.openapi.yaml
src/
  generated/           # TypeScript types generated from the specs
```

## Versioning

- **Breaking changes** require a new major version directory (`v2/`).
- **Non-breaking, additive changes** are made in place within the current major
  version.
- Every contract change is reviewed against the shared domain model to keep
  cross-service consistency.

## Codegen

Types for the desktop client are generated from the specs with
[openapi-typescript](https://openapi-ts.dev/):

```bash
pnpm --filter @hims/api-contracts generate
```

Generated files are committed so consumers can depend on them without running
codegen. Keep them in sync by re-running `generate` whenever a spec changes.
