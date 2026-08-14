# Logging and error handling

## Structured logging

- Go and FastAPI both emit JSON logs to stdout.
- Log level is configurable (`LOG_LEVEL`).
- Never log secrets, credentials, or unnecessary clinical data.

## Correlation IDs

- Every request carries an `X-Request-ID` header (generated when absent).
- The ID is echoed on the response and included in logs and error responses.

## Error response format

All errors use a single envelope:

```json
{ "error": { "code": "not_found", "message": "resource not found", "requestId": "..." } }
```

- `code` — stable, machine-readable identifier.
- `message` — human-readable description.
- `requestId` — links the error to the request log line.

## Conventions

- Unhandled errors return `500` with code `internal_error`.
- Validation errors return `422` with code `validation_error`.
- Unmatched routes return `404` with code `not_found`.
