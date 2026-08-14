# go-api

Go core / high-throughput service for the Divine Hands HMS.

## Endpoints

| Method | Path              | Purpose                                  |
| ------ | ----------------- | ---------------------------------------- |
| GET    | `/health`         | Liveness                                 |
| GET    | `/ready`          | Readiness (PostgreSQL + Redis checks)    |
| GET    | `/api/v1/version` | Service metadata under the versioned API |

## Run

```bash
go run ./cmd/server
```

Configuration is via environment variables (see `.env.example` at the repo
root). Structured JSON logs go to stdout; every request carries an
`X-Request-ID` correlation ID. See `docs/` for logging and API conventions.
