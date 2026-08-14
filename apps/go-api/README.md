# go-api

Go core service for the Divine Hands HMS: identity, RBAC, sessions, and audit.

## Endpoints

| Method | Path                                       | Auth / permission          |
| ------ | ------------------------------------------ | -------------------------- |
| GET    | `/health`, `/ready`                        | public                     |
| GET    | `/api/v1/version`                          | public                     |
| POST   | `/api/v1/auth/login`                       | public                     |
| POST   | `/api/v1/auth/password-reset/request`      | public                     |
| POST   | `/api/v1/auth/password-reset/confirm`      | public                     |
| GET    | `/api/v1/auth/me`                          | session                    |
| POST   | `/api/v1/auth/logout`                      | session                    |
| POST   | `/api/v1/auth/change-password`             | session                    |
| POST   | `/api/v1/auth/mfa/setup`, `.../confirm`    | session                    |
| *      | `/api/v1/admin/users...`                   | `users.*` / `roles.assign` |
| *      | `/api/v1/admin/roles...`                   | `roles.*`                  |
| *      | `/api/v1/admin/permissions`                | `roles.view`               |
| *      | `/api/v1/admin/departments...`             | `departments.*`            |
| GET    | `/api/v1/admin/audit-logs`                 | `audit.view`               |
| *      | `/api/v1/admin/settings...`                | `settings.*`               |
| POST   | `/api/v1/patients`                         | `patients.create`          |
| GET    | `/api/v1/patients/search`                  | `patients.search`          |
| GET    | `/api/v1/patients/{id}`                    | `patients.view`            |
| PATCH  | `/api/v1/patients/{id}`                    | `patients.edit`            |
| POST   | `/api/v1/patients/{id}/amend`              | `patients.amend`           |
| GET    | `/api/v1/patients/{id}/clinical`           | `clinical.view`            |
| POST   | `/api/v1/patients/{id}/clinical`           | `clinical.edit`            |
| PATCH  | `/api/v1/patients/{id}/clinical/{entryId}` | `patients.amend`           |
| GET    | `/api/v1/patients/{id}/timeline`           | `patients.view`            |
| GET    | `/api/v1/patients/{id}/documents`          | `documents.view`           |
| POST   | `/api/v1/patients/{id}/documents`          | `documents.upload`         |
| POST   | `/api/v1/families`                         | `families.create`          |
| GET    | `/api/v1/families/{id}`                    | `families.view`            |

Authentication uses `Authorization: Bearer <token>`. See `docs/rbac-audit.md`
for the model and `packages/api-contracts/` for the OpenAPI spec.

## Run

```bash
go run ./cmd/migrate -command up   # apply migrations
SEED_SUPERADMIN_PASSWORD=... go run ./cmd/seed   # create super admin
go run ./cmd/server                # start the API
```

## Test

```bash
go test ./...                                   # unit tests
TEST_DATABASE_URL=postgres://... go test -tags integration ./...   # integration
```
