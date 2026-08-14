# Environment configuration

- Configuration is read from environment variables (with `.env` support).
- `.env.example` documents every variable; real values are never committed.
- `.env` is git-ignored.

## Key variables

- `APP_TIMEZONE` — display timezone (UTC storage is enforced regardless).
- `LOG_LEVEL` — `debug | info | warn | error`.
- `POSTGRES_HOST` / `POSTGRES_PORT`, `REDIS_HOST` / `REDIS_PORT` — dependency addresses.
- `S3_*` — S3-compatible storage credentials (MinIO in development).

## Secrets

- Use a secrets manager in production (chosen in a later phase).
- Never put secrets in code, in committed config, or in logs.
