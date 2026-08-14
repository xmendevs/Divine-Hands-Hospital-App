# Coding conventions

## Go

- Standard library preferred unless a dependency is clearly justified.
- `gofmt` for formatting, `go vet` for static checks.
- Errors handled explicitly; no ignored errors without justification.

## TypeScript / React

- ESLint (typescript-eslint + react-hooks) for linting, Prettier for formatting.
- Strict TypeScript (`strict: true`).
- Shared UI components live in `packages/ui`.

## Python

- ruff for linting/formatting, 100-char line length.
- Type hints on public functions.

## Git

- Small, focused commits with descriptive messages.
- Never commit secrets, credentials, or build artifacts.
