#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "== Frontend: format, lint, typecheck, build, test =="
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test

echo "== Go: format, build, vet, test =="
(
  cd apps/go-api
  if [ -n "$(gofmt -l .)" ]; then
    echo "gofmt required on:" >&2
    gofmt -l . >&2
    exit 1
  fi
  go build ./...
  go vet ./...
  go test ./...
)

if [ -n "${TEST_DATABASE_URL:-}" ]; then
  echo "== Go: integration tests =="
  (cd apps/go-api && go test -tags integration ./...)
fi

echo "== FastAPI: ruff, pytest =="
(cd apps/fastapi && uv run ruff check . && uv run pytest -q)

echo "All checks passed."
