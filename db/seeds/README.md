# Seed Data

Idempotent, deterministic seed data for local development and tests.

## Convention

- Seeds are versioned alongside migrations and must be safe to re-run.
- Seed data is development/test-only; production data is never seeded from here.
- Secrets are never committed — use environment variables or generated values.

Seed files are authored in the database/identity phase (Phase 2).
