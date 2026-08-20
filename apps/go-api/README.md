# go-api

Go core service for the Divine Hands HMS: identity, RBAC, sessions, and audit.

## Endpoints

| Method | Path                                                       | Auth / permission          |
| ------ | ---------------------------------------------------------- | -------------------------- |
| GET    | `/health`, `/ready`                                        | public                     |
| GET    | `/api/v1/version`                                          | public                     |
| POST   | `/api/v1/auth/login`                                       | public                     |
| POST   | `/api/v1/auth/password-reset/request`                      | public                     |
| POST   | `/api/v1/auth/password-reset/confirm`                      | public                     |
| GET    | `/api/v1/auth/me`                                          | session                    |
| POST   | `/api/v1/auth/logout`                                      | session                    |
| POST   | `/api/v1/auth/change-password`                             | session                    |
| POST   | `/api/v1/auth/mfa/setup`, `.../confirm`                    | session                    |
| *      | `/api/v1/admin/users...`                                   | `users.*` / `roles.assign` |
| *      | `/api/v1/admin/roles...`                                   | `roles.*`                  |
| *      | `/api/v1/admin/permissions`                                | `roles.view`               |
| *      | `/api/v1/admin/departments...`                             | `departments.*`            |
| GET    | `/api/v1/admin/audit-logs`                                 | `audit.view`               |
| *      | `/api/v1/admin/settings...`                                | `settings.*`               |
| POST   | `/api/v1/patients`                                         | `patients.create`          |
| GET    | `/api/v1/patients`                                         | `patients.view`            |
| GET    | `/api/v1/patients/search`                                  | `patients.search`          |
| GET    | `/api/v1/patients/{id}`                                    | `patients.view`            |
| PATCH  | `/api/v1/patients/{id}`                                    | `patients.edit`            |
| POST   | `/api/v1/patients/{id}/amend`                              | `patients.amend`           |
| GET    | `/api/v1/patients/{id}/clinical`                           | `clinical.view`            |
| POST   | `/api/v1/patients/{id}/clinical`                           | `clinical.edit`            |
| PATCH  | `/api/v1/patients/{id}/clinical/{entryId}`                 | `patients.amend`           |
| GET    | `/api/v1/patients/{id}/timeline`                           | `patients.view`            |
| GET    | `/api/v1/patients/{id}/documents`                          | `documents.view`           |
| POST   | `/api/v1/patients/{id}/documents`                          | `documents.upload`         |     | POST | `/api/v1/families`                  | `families.create`    |
| GET    | `/api/v1/families/{id}`                                    | `families.view`            |
| POST   | `/api/v1/patients/{id}/orders`                             | `orders.create`            |
| GET    | `/api/v1/patients/{id}/orders`                             | `orders.view`              |
| GET    | `/api/v1/orders/actionable`                                | `orders.manage`            |
| POST   | `/api/v1/orders/{id}/submit`                               | `orders.create`            |
| POST   | `/api/v1/orders/{id}/cancel`                               | `orders.create`            |
| POST   | `/api/v1/orders/{id}/status`                               | `orders.manage`            |
| POST   | `/api/v1/patients/{id}/notes`                              | `notes.write`              |
| GET    | `/api/v1/patients/{id}/notes`                              | `notes.view`               |
| GET    | `/api/v1/patients/{id}/notes/{groupId}`                    | `notes.view`               |
| POST   | `/api/v1/patients/{id}/notes/{groupId}/versions`           | `notes.write`              |
| POST   | `/api/v1/patients/{id}/observations`                       | `vitals.record`            |
| GET    | `/api/v1/patients/{id}/observations`                       | `vitals.view`              |
| POST   | `/api/v1/patients/{id}/administrations`                    | `mar.record`               |
| GET    | `/api/v1/patients/{id}/administrations`                    | `mar.view`                 |
| POST   | `/api/v1/tasks`                                            | `tasks.create`             |
| GET    | `/api/v1/tasks`                                            | `tasks.view`               |
| POST   | `/api/v1/tasks/{id}/complete`                              | `tasks.complete`           |
| POST   | `/api/v1/patients/{id}/admissions`                         | `admissions.manage`        |
| GET    | `/api/v1/patients/{id}/admissions`                         | `admissions.view`          |
| POST   | `/api/v1/patients/{id}/admissions/{admissionId}/discharge` | `admissions.manage`        |
| POST   | `/api/v1/patients/{id}/reports`                            | `reports.write`            |
| GET    | `/api/v1/patients/{id}/reports`                            | `reports.view`             |
| POST   | `/api/v1/clinical/triage`                                  | `triage.manage`            |
| GET    | `/api/v1/clinical/queue`                                   | `assignments.view`         |     | POST | `/api/v1/patients/{id}/assignments` | `assignments.manage` |
| GET    | `/api/v1/pharmacy/medicines`                               | `medicines.view`           |
| POST   | `/api/v1/pharmacy/medicines`                               | `medicines.manage`         |
| GET    | `/api/v1/pharmacy/medicines/{id}`                          | `medicines.view`           |
| PATCH  | `/api/v1/pharmacy/medicines/{id}`                          | `medicines.manage`         |
| POST   | `/api/v1/pharmacy/receipts`                                | `inventory.receive`        |
| POST   | `/api/v1/pharmacy/dispense`                                | `inventory.dispense`       |
| POST   | `/api/v1/pharmacy/adjustments`                             | `inventory.adjust`         |
| GET    | `/api/v1/approvals`                                        | `inventory.approve`        |
| POST   | `/api/v1/approvals/{id}/approve`                           | `inventory.approve`        |
| POST   | `/api/v1/approvals/{id}/reject`                            | `inventory.approve`        |
| POST   | `/api/v1/pharmacy/batches/{id}/return`                     | `inventory.receive`        |
| POST   | `/api/v1/pharmacy/batches/{id}/damage`                     | `inventory.adjust`         |
| POST   | `/api/v1/pharmacy/batches/{id}/quarantine`                 | `inventory.adjust`         |
| POST   | `/api/v1/pharmacy/transfers`                               | `inventory.transfer`       |
| POST   | `/api/v1/pharmacy/counts`                                  | `inventory.count`          |
| GET    | `/api/v1/pharmacy/movements`                               | `medicines.view`           |
| GET    | `/api/v1/pharmacy/alerts`                                  | `medicines.view`           |

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
