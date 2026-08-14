# Database migrations & rollback strategy

Migrations live in `db/migrations/` and are applied with
[golang-migrate](https://github.com/golang-migrate/migrate) via the `go-api`
service.

## Commands

```bash
cd apps/go-api
go run ./cmd/migrate -command up       # apply pending migrations
go run ./cmd/migrate -command down     # roll back one migration
go run ./cmd/migrate -command version  # show current version + dirty flag
```

Override the database with `DATABASE_URL` and the migrations directory with
`MIGRATIONS_DIR` or `-dir`.

## Naming & ordering

- Files are `NNNN_<title>.up.sql` / `NNNN_<title>.down.sql`, sequentially numbered.
- Numbers are never renumbered once a migration has been applied anywhere.

## Rules

- Every `up` migration has a matching, tested `down` migration.
- Schema changes and seed/reference data are separate migrations.
- Migrations run once, before the service starts serving traffic.
- Rollback = `down` one step at a time, then redeploy the matching code version.
- Destructive changes require an explicit, reviewed plan and a verified backup.
- Local setup applies migrations and seeds the super admin (see root README).

## Verification

- Integration tests reset a dedicated schema and apply `up` from scratch, then
  exercise the full API against the migrated schema.
- `cmd/migrate version` reports the current version and dirty flag for
  operational visibility.
