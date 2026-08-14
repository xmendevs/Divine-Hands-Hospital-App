# Developer setup

## Prerequisites

- Node.js >= 20 and pnpm 10
- Go >= 1.26
- Python >= 3.12 with [uv](https://docs.astral.sh/uv/)
- Docker + Docker Compose
- Rust toolchain (only needed for `tauri dev` / `tauri build`)

## One-time setup

```bash
cp .env.example .env      # adjust values for your machine
scripts/bootstrap.sh      # pnpm install + uv sync + contract codegen
```

## Run the development stack

```bash
scripts/dev-up.sh         # PostgreSQL, Redis, MinIO
scripts/dev-down.sh       # stop them
```

## Run services

- Desktop: `cd apps/desktop && pnpm tauri dev` (or `pnpm dev` for browser-only)
- Go API: `cd apps/go-api && go run ./cmd/server`
- FastAPI: `cd apps/fastapi && uv run uvicorn app.main:app --reload`

## Verify

```bash
scripts/verify.sh
```
