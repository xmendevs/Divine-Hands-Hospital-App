# fastapi

Python-oriented service for the Divine Hands HMS (reporting, analytics,
document processing, ML-enabled features), built with FastAPI.

## Endpoints

| Method | Path              | Purpose                          |
| ------ | ----------------- | -------------------------------- |
| GET    | `/health`         | Liveness                         |
| GET    | `/ready`          | Readiness (PostgreSQL + Redis)   |
| GET    | `/api/v1/version` | Service metadata (versioned API) |

## Run

```bash
uv sync
uv run uvicorn app.main:app --reload
```

Configuration is via environment variables (see `.env.example` at the repo
root). Structured JSON logs go to stdout; every request carries an
`X-Request-ID` correlation ID. See `docs/` for logging and API conventions.
