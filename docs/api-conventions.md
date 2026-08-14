# API conventions

## Versioning

- Health/readiness endpoints are unversioned: `/health`, `/ready`.
- Business endpoints live under `/api/v1/...`.
- Breaking changes bump the major version (`/api/v2/...`).

## Contracts

OpenAPI specs live in `packages/api-contracts/openapi/v1/`. They are the single
source of truth; Go and FastAPI must not diverge (see `docs/architecture.md`).

## Errors

See `docs/logging-and-errors.md` for the shared error envelope.

## Time

- All timestamps are stored and logged in UTC.
- The display timezone is hospital-configurable via `APP_TIMEZONE`; conversion
  happens at the presentation layer, never in storage.
