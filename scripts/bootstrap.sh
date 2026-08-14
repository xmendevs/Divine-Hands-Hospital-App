#!/usr/bin/env bash
set -euo pipefail

# One-time setup for a fresh checkout. Run from the repo root.
cd "$(dirname "$0")/.."

echo "Installing Node dependencies..."
pnpm install

echo "Installing Python dependencies (FastAPI)..."
(cd apps/fastapi && uv sync)

echo "Generating API contract types..."
pnpm --filter @hims/api-contracts generate

echo "Bootstrap complete. Start services with scripts/dev-up.sh"
