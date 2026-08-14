# Database Migrations

Versioned, ordered database migrations for PostgreSQL.

## Naming

```
db/migrations/
  0001_<description>.up.sql
  0001_<description>.down.sql
  0002_<description>.up.sql
  ...
```

- Sequential, zero-padded, never renumbered once applied to any environment.
- Every `up` migration has a matching, tested `down` migration.
- No destructive changes without an explicit, reviewed plan.

The migration tool (e.g. golang-migrate, goose, or similar) is selected in the
database/identity phase. Migration files are authored starting there.
