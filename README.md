# Divine Hands Hospital — Hospital Management System

Production-grade Hospital Information Management System (HIMS) for desktop use.

## Stack

| Concern          | Technology                                    |
| ---------------- | --------------------------------------------- |
| Desktop client   | Tauri + React + TypeScript                    |
| Core services    | Go (high-throughput / core domain)            |
| Python services  | FastAPI (analytics, reporting, docs, ML)      |
| Database         | PostgreSQL                                    |
| Cache / queues   | Redis                                         |
| Object storage   | S3-compatible (MinIO for development)         |
| API contracts    | OpenAPI (versioned under `contracts/`)        |
| Migrations       | Versioned SQL under `db/migrations/`          |
| CI/CD            | GitHub Actions                                |
| Containers       | Docker / Docker Compose                       |

## Layout

```
apps/desktop         Tauri + React + TypeScript desktop client
services/core        Go core / high-throughput service
services/analytics   FastAPI analytics & reporting service
contracts/           Versioned OpenAPI contracts (single source of truth)
db/migrations/       Versioned PostgreSQL migrations
infra/compose/       Docker Compose for development services
.github/workflows/   CI/CD
docs/                Project documentation
```

See `docs/architecture.md` for the canonical domain model and cross-cutting
constraints (no conflicting Go/FastAPI business rules, security, backup).

## Prerequisites

- Node.js >= 20, pnpm 10
- Rust toolchain (for Tauri; see https://tauri.app/start/prerequisites/)
- Go >= 1.26
- Python >= 3.12 with [uv](https://docs.astral.sh/uv/)
- Docker + Docker Compose

## Development

```bash
# 1. Start backing services (PostgreSQL, Redis, MinIO)
docker compose --env-file .env -f infra/compose/docker-compose.yml up

# 2. Desktop client
cd apps/desktop && pnpm install && pnpm tauri dev

# 3. Core service
cd services/core && go run ./cmd/server

# 4. Analytics service
cd services/analytics && uv sync && uv run uvicorn app.main:app --reload
```

## Status

Scaffold baseline: repository structure and buildable service skeletons.
Business logic, migrations, API contracts, and security are implemented phase
by phase per the Master Implementation Plan.
