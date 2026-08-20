package httpapi

import (
	"log/slog"
	"net/http"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/backup"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/config"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/store"
)

// Option customizes server construction.
type Option func(*server)

// WithChecks overrides the default readiness checks.
func WithChecks(checks map[string]Checker) Option {
	return func(s *server) {
		s.checks = checks
	}
}

// WithBackupManager attaches the backup & DR manager. When nil (the
// default), backup endpoints report backup_not_configured. Passing a manager
// here opts out of the settings-driven rebuild in NewRouter.
func WithBackupManager(m *backup.Manager) Option {
	return func(s *server) {
		s.backupMgr = m
		s.backupMgrExplicit = true
	}
}

// NewRouter builds the fully-wired HTTP handler: middleware chain plus all
// routes. Health and readiness are unversioned; business endpoints live under
// the versioned /api/v1 prefix. st may be nil for tests that only exercise
// unauthenticated endpoints.
func NewRouter(cfg config.Config, logger *slog.Logger, st *store.Store, opts ...Option) http.Handler {
	s := newServer(cfg, logger, st)
	for _, opt := range opts {
		opt(s)
	}

	mux := http.NewServeMux()

	// Public / unversioned.
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("GET /ready", s.handleReady)
	mux.HandleFunc("GET /api/v1/version", s.handleVersion)

	// Public authentication.
	mux.HandleFunc("POST /api/v1/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/v1/auth/password-reset/request", s.handlePasswordResetRequest)
	mux.HandleFunc("POST /api/v1/auth/password-reset/confirm", s.handlePasswordResetConfirm)

	// Authenticated downloads (installer is served only when APP_INSTALLER_PATH is set).
	mux.Handle("GET /api/v1/downloads/installer", s.requireAuth(http.HandlerFunc(s.handleDownloadInstaller)))

	// Authenticated.
	mux.Handle("GET /api/v1/auth/me", s.requireAuth(http.HandlerFunc(s.handleMe)))
	mux.Handle("POST /api/v1/auth/logout", s.requireAuth(http.HandlerFunc(s.handleLogout)))
	mux.Handle("POST /api/v1/auth/change-password", s.requireAuth(http.HandlerFunc(s.handleChangePassword)))
	mux.Handle("POST /api/v1/auth/mfa/setup", s.requireAuth(http.HandlerFunc(s.handleMFASetup)))
	mux.Handle("POST /api/v1/auth/mfa/confirm", s.requireAuth(http.HandlerFunc(s.handleMFAConfirm)))

	// Admin (authenticated + permission-checked).
	mux.Handle("GET /api/v1/admin/users", s.admin("users.view", s.handleListUsers))
	mux.Handle("POST /api/v1/admin/users", s.admin("users.create", s.handleCreateUser))
	mux.Handle("GET /api/v1/admin/users/{id}", s.admin("users.view", s.handleGetUser))
	mux.Handle("PATCH /api/v1/admin/users/{id}", s.admin("users.edit", s.handleUpdateUser))
	mux.Handle("POST /api/v1/admin/users/{id}/suspend", s.admin("users.edit", s.handleSuspendUser))
	mux.Handle("POST /api/v1/admin/users/{id}/activate", s.admin("users.edit", s.handleActivateUser))
	mux.Handle("PUT /api/v1/admin/users/{id}/roles", s.admin("roles.assign", s.handleAssignRoles))

	mux.Handle("GET /api/v1/admin/roles", s.admin("roles.view", s.handleListRoles))
	mux.Handle("POST /api/v1/admin/roles", s.admin("roles.create", s.handleCreateRole))
	mux.Handle("PATCH /api/v1/admin/roles/{id}", s.admin("roles.edit", s.handleUpdateRole))
	mux.Handle("PUT /api/v1/admin/roles/{id}/permissions", s.admin("roles.edit", s.handleSetRolePermissions))
	mux.Handle("GET /api/v1/admin/permissions", s.admin("roles.view", s.handleListPermissions))

	mux.Handle("GET /api/v1/admin/departments", s.admin("departments.view", s.handleListDepartments))
	mux.Handle("POST /api/v1/admin/departments", s.admin("departments.create", s.handleCreateDepartment))

	mux.Handle("GET /api/v1/admin/audit-logs", s.admin("audit.view", s.handleListAuditLogs))

	mux.Handle("GET /api/v1/admin/settings", s.admin("settings.view", s.handleListSettings))
	mux.Handle("PUT /api/v1/admin/settings/{key}", s.admin("settings.edit", s.handleSetSetting))

	// Patients & families (authenticated + permission-checked).
	mux.Handle("POST /api/v1/patients", s.perm("patients.create", s.handleRegisterPatient))
	mux.Handle("GET /api/v1/patients", s.perm("patients.view", s.handleListPatients))
	mux.Handle("GET /api/v1/patients/search", s.perm("patients.search", s.handleSearchPatients))
	mux.Handle("GET /api/v1/patients/{id}", s.perm("patients.view", s.handleGetPatient))
	mux.Handle("PATCH /api/v1/patients/{id}", s.perm("patients.edit", s.handleUpdatePatient))
	mux.Handle("POST /api/v1/patients/{id}/amend", s.perm("patients.amend", s.handleAmendPatient))
	mux.Handle("GET /api/v1/patients/{id}/clinical", s.perm("clinical.view", s.handleListClinical))
	mux.Handle("POST /api/v1/patients/{id}/clinical", s.perm("clinical.edit", s.handleAddClinical))
	mux.Handle("PATCH /api/v1/patients/{id}/clinical/{entryId}", s.perm("patients.amend", s.handleAmendClinical))
	mux.Handle("GET /api/v1/patients/{id}/timeline", s.perm("patients.view", s.handleListTimeline))
	mux.Handle("GET /api/v1/patients/{id}/documents", s.perm("documents.view", s.handleListDocuments))
	mux.Handle("POST /api/v1/patients/{id}/documents", s.perm("documents.upload", s.handleAddDocument))

	mux.Handle("POST /api/v1/families", s.perm("families.create", s.handleCreateFamily))
	mux.Handle("GET /api/v1/families/{id}", s.perm("families.view", s.handleGetFamily))

	// Orders.
	mux.Handle("POST /api/v1/patients/{id}/orders", s.perm("orders.create", s.handleCreateOrder))
	mux.Handle("GET /api/v1/patients/{id}/orders", s.perm("orders.view", s.handleListPatientOrders))
	mux.Handle("GET /api/v1/orders/actionable", s.perm("orders.view", s.handleListActionableOrders))
	mux.Handle("POST /api/v1/orders/{id}/submit", s.perm("orders.create", s.handleSubmitOrder))
	mux.Handle("POST /api/v1/orders/{id}/cancel", s.perm("orders.create", s.handleCancelOrder))
	mux.Handle("POST /api/v1/orders/{id}/status", s.perm("orders.manage", s.handleTransitionOrder))
	mux.Handle("POST /api/v1/orders/{id}/sign", s.perm("orders.create", s.handleSignOrder))

	// Notes (immutable versions).
	mux.Handle("POST /api/v1/patients/{id}/notes", s.perm("notes.write", s.handleCreateNote))
	mux.Handle("GET /api/v1/patients/{id}/notes", s.perm("notes.view", s.handleListNotes))
	mux.Handle("GET /api/v1/patients/{id}/notes/{groupId}", s.perm("notes.view", s.handleListNoteVersions))
	mux.Handle("POST /api/v1/patients/{id}/notes/{groupId}/versions", s.perm("notes.write", s.handleAddNoteVersion))
	mux.Handle("POST /api/v1/notes/{id}/sign", s.perm("notes.write", s.handleSignNote))

	// Observations & vitals.
	mux.Handle("POST /api/v1/patients/{id}/observations", s.perm("vitals.record", s.handleAddObservation))
	mux.Handle("GET /api/v1/patients/{id}/observations", s.perm("vitals.view", s.handleListObservations))

	// Clinical decision support + patient history timeline.
	mux.Handle("GET /api/v1/patients/{id}/cds-alerts", s.perm("clinical.view", s.handleCDSAlerts))
	mux.Handle("GET /api/v1/patients/{id}/history", s.perm("patients.view", s.handlePatientHistory))

	// Medication administration records (MAR).
	mux.Handle("POST /api/v1/patients/{id}/administrations", s.perm("mar.record", s.handleAddAdministration))
	mux.Handle("GET /api/v1/patients/{id}/administrations", s.perm("mar.view", s.handleListAdministrations))

	// Tasks.
	mux.Handle("POST /api/v1/tasks", s.perm("tasks.create", s.handleCreateTask))
	mux.Handle("GET /api/v1/tasks", s.perm("tasks.view", s.handleListTasks))
	mux.Handle("POST /api/v1/tasks/{id}/complete", s.perm("tasks.complete", s.handleCompleteTask))
	mux.Handle("GET /api/v1/patients/{id}/tasks", s.perm("tasks.view", s.handleListPatientTasks))

	// Admissions.
	mux.Handle("POST /api/v1/patients/{id}/admissions", s.perm("admissions.manage", s.handleAdmitPatient))
	mux.Handle("GET /api/v1/patients/{id}/admissions", s.perm("admissions.view", s.handleListAdmissions))
	mux.Handle("POST /api/v1/patients/{id}/admissions/{admissionId}/discharge", s.perm("admissions.manage", s.handleDischargePatient))

	// Reports.
	mux.Handle("POST /api/v1/patients/{id}/reports", s.perm("reports.write", s.handleCreateReport))
	mux.Handle("GET /api/v1/patients/{id}/reports", s.perm("reports.view", s.handleListReports))

	// Emergency triage + queue & assignments.
	mux.Handle("POST /api/v1/clinical/triage", s.perm("triage.manage", s.handleTriage))
	mux.Handle("GET /api/v1/clinical/queue", s.perm("assignments.view", s.handleMyQueue))
	mux.Handle("POST /api/v1/patients/{id}/assignments", s.perm("assignments.manage", s.handleAssignPatient))

	// Pharmacy & inventory.
	mux.Handle("GET /api/v1/pharmacy/medicines", s.perm("medicines.view", s.handleListMedicines))
	mux.Handle("POST /api/v1/pharmacy/medicines", s.perm("medicines.manage", s.handleCreateMedicine))
	mux.Handle("GET /api/v1/pharmacy/medicines/{id}", s.perm("medicines.view", s.handleGetMedicine))
	mux.Handle("PATCH /api/v1/pharmacy/medicines/{id}", s.perm("medicines.manage", s.handleUpdateMedicine))
	mux.Handle("DELETE /api/v1/pharmacy/medicines/{id}", s.perm("medicines.manage", s.handleDeleteMedicine))
	mux.Handle("GET /api/v1/pharmacy/medicines/{id}/batches", s.perm("medicines.view", s.handleListBatches))
	mux.Handle("POST /api/v1/pharmacy/receipts", s.perm("inventory.receive", s.handleReceiveStock))
	mux.Handle("POST /api/v1/pharmacy/dispense", s.perm("inventory.dispense", s.handleDispense))
	mux.Handle("GET /api/v1/pharmacy/dispensations", s.perm("medicines.view", s.handleListDispensations))
	mux.Handle("GET /api/v1/pharmacy/dispensations/{id}", s.perm("medicines.view", s.handleGetDispensation))
	mux.Handle("POST /api/v1/pharmacy/adjustments", s.perm("inventory.adjust", s.handleCreateAdjustment))
	mux.Handle("GET /api/v1/pharmacy/adjustments", s.perm("medicines.view", s.handleListAdjustments))
	mux.Handle("GET /api/v1/approvals", s.perm("inventory.approve", s.handleListApprovals))
	mux.Handle("POST /api/v1/approvals/{id}/approve", s.perm("inventory.approve", s.handleApproveApproval))
	mux.Handle("POST /api/v1/approvals/{id}/reject", s.perm("inventory.approve", s.handleRejectApproval))
	mux.Handle("POST /api/v1/pharmacy/batches/{id}/return", s.perm("inventory.receive", s.handleReturnStock))
	mux.Handle("POST /api/v1/pharmacy/batches/{id}/damage", s.perm("inventory.adjust", s.handleDamageStock))
	mux.Handle("POST /api/v1/pharmacy/batches/{id}/quarantine", s.perm("inventory.adjust", s.handleQuarantineBatch))
	mux.Handle("POST /api/v1/pharmacy/transfers", s.perm("inventory.transfer", s.handleTransferStock))
	mux.Handle("POST /api/v1/pharmacy/counts", s.perm("inventory.count", s.handleStockCount))
	mux.Handle("GET /api/v1/pharmacy/movements", s.perm("medicines.view", s.handleListMovements))
	mux.Handle("GET /api/v1/pharmacy/alerts", s.perm("medicines.view", s.handleGetAlerts))

	// Lab consumables
	mux.Handle("GET /api/v1/lab-consumables", s.perm("medicines.view", s.handleListLabConsumables))
	mux.Handle("POST /api/v1/lab-consumables", s.perm("medicines.manage", s.handleCreateLabConsumable))
	mux.Handle("GET /api/v1/lab-consumables/{id}", s.perm("medicines.view", s.handleGetLabConsumable))
	mux.Handle("PATCH /api/v1/lab-consumables/{id}", s.perm("medicines.manage", s.handleUpdateLabConsumable))
	mux.Handle("DELETE /api/v1/lab-consumables/{id}", s.perm("medicines.manage", s.handleDeleteLabConsumable))
	mux.Handle("GET /api/v1/pharmacy/check-allergies", s.perm("medicines.view", s.handleCheckAllergies))
	mux.Handle("GET /api/v1/pharmacy/check-interactions", s.perm("medicines.view", s.handleCheckInteractions))
	mux.Handle("PATCH /api/v1/pharmacy/dispensations/{id}/status", s.perm("inventory.dispense", s.handleUpdateDispenseStatus))
	mux.Handle("GET /api/v1/pharmacy/medicines/{id}/batches/fifo", s.perm("medicines.view", s.handleListBatchesFifo))
	mux.Handle("POST /api/v1/pharmacy/dispense/enhanced", s.perm("inventory.dispense", s.handleEnhancedDispense))

	// General inventory, instruments, equipment & maintenance (Phase 06).
	mux.Handle("GET /api/v1/assets/categories", s.perm("assets.view", s.handleListAssetCategories))
	mux.Handle("GET /api/v1/assets", s.perm("assets.view", s.handleListAssets))
	mux.Handle("POST /api/v1/assets", s.perm("assets.manage", s.handleCreateAsset))
	mux.Handle("GET /api/v1/assets/movements", s.perm("assets.view", s.handleListAssetMovements))
	mux.Handle("POST /api/v1/assets/counts", s.perm("assets.count", s.handleAssetCount))
	mux.Handle("GET /api/v1/assets/{id}", s.perm("assets.view", s.handleGetAsset))
	mux.Handle("PATCH /api/v1/assets/{id}", s.perm("assets.manage", s.handleUpdateAsset))
	mux.Handle("POST /api/v1/assets/{id}/status", s.perm("assets.adjust", s.handleChangeAssetStatus))
	mux.Handle("POST /api/v1/assets/{id}/transfer", s.perm("assets.transfer", s.handleTransferAsset))
	mux.Handle("POST /api/v1/assets/{id}/adjust", s.perm("assets.adjust", s.handleAdjustAsset))
	mux.Handle("GET /api/v1/assets/{id}/maintenance", s.perm("assets.view", s.handleListMaintenanceRecords))
	mux.Handle("POST /api/v1/assets/{id}/maintenance", s.perm("assets.maintain", s.handleCreateMaintenanceRecord))
	mux.Handle("GET /api/v1/maintenance/schedules", s.perm("assets.view", s.handleListMaintenanceSchedules))
	mux.Handle("POST /api/v1/maintenance/schedules", s.perm("assets.maintain", s.handleCreateMaintenanceSchedule))
	mux.Handle("GET /api/v1/maintenance/service-providers", s.perm("assets.view", s.handleListServiceProviders))
	mux.Handle("POST /api/v1/maintenance/service-providers", s.perm("assets.maintain", s.handleCreateServiceProvider))

	// Laboratory information system (Phase 07).
	mux.Handle("GET /api/v1/lab/tests", s.perm("lab.view", s.handleListLabTests))
	mux.Handle("POST /api/v1/lab/tests", s.perm("lab.manage", s.handleCreateLabTest))
	mux.Handle("GET /api/v1/lab/tests/{id}", s.perm("lab.view", s.handleGetLabTest))
	mux.Handle("PATCH /api/v1/lab/tests/{id}", s.perm("lab.manage", s.handleUpdateLabTest))
	mux.Handle("GET /api/v1/lab/clients", s.perm("lab.view", s.handleListLabClients))
	mux.Handle("POST /api/v1/lab/clients", s.perm("lab.manage", s.handleCreateLabClient))
	mux.Handle("GET /api/v1/lab/clients/{id}", s.perm("lab.view", s.handleGetLabClient))
	mux.Handle("POST /api/v1/lab/requests", s.perm("lab.order", s.handleCreateLabRequest))
	mux.Handle("GET /api/v1/lab/requests", s.perm("lab.view", s.handleListLabRequests))
	mux.Handle("GET /api/v1/lab/requests/{id}", s.perm("lab.view", s.handleGetLabRequest))
	mux.Handle("POST /api/v1/lab/requests/{id}/status", s.perm("lab.manage", s.handleTransitionLabRequest))
	mux.Handle("POST /api/v1/lab/requests/{id}/cancel", s.perm("lab.manage", s.handleCancelLabRequest))
	mux.Handle("POST /api/v1/lab/requests/{id}/collect", s.perm("lab.manage", s.handleCollectSpecimens))
	mux.Handle("POST /api/v1/lab/requests/{id}/results", s.perm("lab.analyze", s.handleEnterResults))
	mux.Handle("POST /api/v1/lab/requests/{id}/release", s.perm("lab.release", s.handleReleaseRequest))
	mux.Handle("POST /api/v1/lab/specimens/{id}/receive", s.perm("lab.manage", s.handleReceiveSpecimen))
	mux.Handle("POST /api/v1/lab/specimens/{id}/reject", s.perm("lab.manage", s.handleRejectSpecimen))
	mux.Handle("POST /api/v1/lab/items/{id}/verify", s.perm("lab.verify", s.handleVerifyItem))
	mux.Handle("GET /api/v1/lab/critical", s.perm("lab.verify", s.handleListCriticalNotifications))
	mux.Handle("POST /api/v1/lab/critical/{id}/acknowledge", s.perm("lab.verify", s.handleAcknowledgeCritical))
	mux.Handle("GET /api/v1/lab/tat", s.perm("lab.view", s.handleLabTAT))
	mux.Handle("GET /api/v1/lab/instruments", s.perm("lab.view", s.handleListInstruments))
	mux.Handle("POST /api/v1/lab/instruments", s.perm("lab.manage", s.handleCreateInstrument))
	mux.Handle("POST /api/v1/lab/instruments/{id}/status", s.perm("lab.manage", s.handleSetInstrumentStatus))
	mux.Handle("GET /api/v1/lab/instruments/{id}/logs", s.perm("lab.view", s.handleListInstrumentLogs))
	mux.Handle("POST /api/v1/lab/instruments/{id}/logs", s.perm("lab.manage", s.handleQueueInstrumentLog))

	// Billing, cashier, payments & receipts (Phase 08).
	mux.Handle("GET /api/v1/billing/price-lists", s.perm("billing.view", s.handleListPriceLists))
	mux.Handle("POST /api/v1/billing/price-lists", s.perm("billing.manage", s.handleCreatePriceList))
	mux.Handle("GET /api/v1/billing/price-lists/{id}", s.perm("billing.view", s.handleGetPriceList))
	mux.Handle("PATCH /api/v1/billing/price-lists/{id}", s.perm("billing.manage", s.handleUpdatePriceList))
	mux.Handle("GET /api/v1/billing/price-lists/{id}/items", s.perm("billing.view", s.handleListPriceListItems))
	mux.Handle("POST /api/v1/billing/price-lists/{id}/items", s.perm("billing.manage", s.handleCreatePriceListItem))
	mux.Handle("PATCH /api/v1/billing/price-list-items/{id}", s.perm("billing.manage", s.handleUpdatePriceListItem))
	mux.Handle("POST /api/v1/billing/invoices", s.perm("billing.create", s.handleCreateInvoice))
	mux.Handle("GET /api/v1/billing/invoices", s.perm("billing.view", s.handleListInvoices))
	mux.Handle("GET /api/v1/billing/invoices/{id}", s.perm("billing.view", s.handleGetInvoice))
	mux.Handle("POST /api/v1/billing/invoices/{id}/issue", s.perm("billing.create", s.handleIssueInvoice))
	mux.Handle("POST /api/v1/billing/invoices/{id}/void", s.perm("billing.manage", s.handleVoidInvoice))
	mux.Handle("POST /api/v1/billing/invoices/{id}/payments", s.perm("billing.collect", s.handleReceivePayment))
	mux.Handle("GET /api/v1/billing/payments", s.perm("billing.view", s.handleListPayments))
	mux.Handle("GET /api/v1/billing/payments/{id}", s.perm("billing.view", s.handleGetPayment))
	mux.Handle("GET /api/v1/billing/receipts", s.perm("billing.view", s.handleListReceipts))
	mux.Handle("GET /api/v1/billing/receipts/{id}", s.perm("billing.view", s.handleGetReceipt))
	mux.Handle("GET /api/v1/billing/receipts/{id}/html", s.perm("billing.view", s.handleReceiptHTML))
	mux.Handle("GET /api/v1/billing/receipts/{id}/pdf", s.perm("billing.view", s.handleReceiptPDF))
	mux.Handle("POST /api/v1/billing/receipts/{id}/share", s.perm("billing.view", s.handleShareReceipt))
	mux.Handle("POST /api/v1/billing/payments/{id}/refunds", s.perm("billing.refund", s.handleRequestRefund))
	mux.Handle("GET /api/v1/billing/refunds", s.perm("billing.view", s.handleListRefundRequests))
	mux.Handle("GET /api/v1/billing/refunds/{id}", s.perm("billing.view", s.handleGetRefundRequest))
	mux.Handle("POST /api/v1/billing/refunds/{id}/approve", s.perm("billing.approve", s.handleApproveRefund))
	mux.Handle("POST /api/v1/billing/refunds/{id}/reject", s.perm("billing.approve", s.handleRejectRefund))
	mux.Handle("POST /api/v1/billing/refunds/{id}/process", s.perm("billing.refund", s.handleProcessRefund))
	mux.Handle("POST /api/v1/billing/shifts", s.perm("billing.collect", s.handleOpenShift))
	mux.Handle("POST /api/v1/billing/shifts/{id}/close", s.perm("billing.reconcile", s.handleCloseShift))
	mux.Handle("GET /api/v1/billing/shifts", s.perm("billing.view", s.handleListShifts))
	mux.Handle("GET /api/v1/billing/shifts/{id}", s.perm("billing.view", s.handleGetShift))
	mux.Handle("POST /api/v1/billing/invoices/{id}/validate", s.superAdmin(s.handleValidateInvoice))
	mux.Handle("PATCH /api/v1/billing/invoices/{id}", s.superAdmin(s.handleUpdateInvoice))
	mux.Handle("GET /api/v1/billing/patients/{id}/balance", s.perm("billing.view", s.handleGetPatientBalance))
	mux.Handle("GET /api/v1/billing/my-patients-bills", s.perm("billing.view", s.handleGetDoctorsPatientsBills))
	mux.Handle("POST /api/v1/billing/auto-invoice/order/{id}", s.perm("billing.create", s.handleAutoInvoiceFromOrder))

	// Staff, attendance, clock-in/out & handover (Phase 09).
	mux.Handle("GET /api/v1/staff", s.perm("staff.view", s.handleListStaff))
	mux.Handle("GET /api/v1/staff/{id}", s.perm("staff.view", s.handleGetStaff))
	mux.Handle("PATCH /api/v1/staff/{id}", s.perm("staff.edit", s.handleUpdateStaff))
	mux.Handle("POST /api/v1/staff/leave", s.perm("staff.leave_request", s.handleRequestLeave))
	mux.Handle("GET /api/v1/staff/leave", s.perm("staff.leave_request", s.handleListLeave))
	mux.Handle("POST /api/v1/staff/leave/{id}/approve", s.perm("staff.leave_manage", s.handleApproveLeave))
	mux.Handle("POST /api/v1/staff/leave/{id}/reject", s.perm("staff.leave_manage", s.handleRejectLeave))
	mux.Handle("POST /api/v1/staff/unavailability", s.perm("attendance.manage", s.handleMarkUnavailable))
	mux.Handle("GET /api/v1/staff/unavailability", s.perm("attendance.view", s.handleListUnavailability))
	mux.Handle("DELETE /api/v1/staff/unavailability/{id}", s.perm("attendance.manage", s.handleDeleteUnavailability))

	mux.Handle("POST /api/v1/attendance/shifts", s.perm("attendance.manage", s.handleCreateShift))
	mux.Handle("GET /api/v1/attendance/shifts", s.perm("attendance.view", s.handleListStaffShifts))
	mux.Handle("POST /api/v1/attendance/clock-in", s.perm("attendance.clock", s.handleClockIn))
	mux.Handle("POST /api/v1/attendance/clock-out", s.perm("attendance.clock", s.handleClockOut))
	mux.Handle("GET /api/v1/attendance", s.attendanceAdmin(s.handleListAttendance))
	mux.Handle("GET /api/v1/attendance/report", s.attendanceAdmin(s.handleAttendanceReport))
	mux.Handle("POST /api/v1/attendance/rosters", s.perm("attendance.manage", s.handleAssignRoster))
	mux.Handle("GET /api/v1/attendance/rosters", s.perm("attendance.view", s.handleListRoster))
	mux.Handle("DELETE /api/v1/attendance/rosters/{id}", s.perm("attendance.manage", s.handleDeleteRoster))

	// Enterprise attendance endpoints (Phase 18).
	mux.Handle("GET /api/v1/attendance/dashboard", s.attendanceAdmin(s.handleAttendanceDashboard))
	mux.Handle("GET /api/v1/attendance/export", s.attendanceAdmin(s.handleExportAttendance))
	mux.Handle("POST /api/v1/attendance/leave", s.perm("staff.leave_request", s.handleCreateLeaveRequest))
	mux.Handle("GET /api/v1/attendance/leave", s.perm("staff.leave_request", s.handleListLeaveRequests))
	mux.Handle("PATCH /api/v1/attendance/leave/{id}", s.perm("attendance.manage", s.handleReviewLeaveRequest))

	mux.Handle("POST /api/v1/handovers", s.perm("handover.create", s.handleCreateHandover))
	mux.Handle("GET /api/v1/handovers", s.perm("handover.view", s.handleListHandovers))
	mux.Handle("GET /api/v1/handovers/{id}", s.perm("handover.view", s.handleGetHandover))
	mux.Handle("POST /api/v1/handovers/{id}/acknowledge", s.perm("handover.acknowledge", s.handleAcknowledgeHandover))

	// Automatic roster planning & approval (Phase 10).
	mux.Handle("POST /api/v1/roster/plans", s.perm("roster.plan", s.handleCreateRosterPlan))
	mux.Handle("GET /api/v1/roster/plans", s.perm("roster.view", s.handleListRosterPlans))
	mux.Handle("POST /api/v1/roster/plans/{id}/publish", s.superAdmin(s.handleValidateAndPublish))
	mux.Handle("GET /api/v1/roster/plans/{id}", s.perm("roster.view", s.handleGetRosterPlan))
	mux.Handle("POST /api/v1/roster/plans/{id}/regenerate", s.perm("roster.plan", s.handleRegenerateRoster))
	mux.Handle("POST /api/v1/roster/plans/{id}/assignments", s.perm("roster.plan", s.handleUpsertRosterAssignment))
	mux.Handle("POST /api/v1/roster/plans/{id}/assignments/manual", s.perm("roster.plan", s.handleManualAssignment))
	mux.Handle("POST /api/v1/roster/plans/{id}/assignments/remove", s.perm("roster.plan", s.handleDeleteAssignmentByStaffDate))
	mux.Handle("DELETE /api/v1/roster/plans/{id}/assignments/{assignmentId}", s.perm("roster.plan", s.handleDeleteRosterAssignment))
	mux.Handle("POST /api/v1/roster/plans/{id}/submit", s.perm("roster.plan", s.handleSubmitRoster))
	mux.Handle("POST /api/v1/roster/plans/{id}/approve", s.perm("roster.approve", s.handleApproveRoster))
	mux.Handle("POST /api/v1/roster/plans/{id}/reject", s.perm("roster.approve", s.handleRejectRoster))
	mux.Handle("POST /api/v1/roster/plans/{id}/amend", s.perm("roster.plan", s.handleAmendRoster))

	// Enterprise roster endpoints.
	mux.Handle("POST /api/v1/shifts", s.attendanceAdmin(s.handleCreateRosterShift))
	mux.Handle("GET /api/v1/shifts", s.perm("attendance.view", s.handleListRosterShifts))
	mux.Handle("PUT /api/v1/shifts/{id}", s.attendanceAdmin(s.handleUpdateRosterShift))
	mux.Handle("DELETE /api/v1/shifts/{id}", s.attendanceAdmin(s.handleDeleteRosterShift))
	mux.Handle("GET /api/v1/roster/dashboard", s.attendanceAdmin(s.handleRosterDashboardStats))
	mux.Handle("GET /api/v1/roster/calendar", s.perm("attendance.view", s.handleRosterCalendarView))
	mux.Handle("GET /api/v1/roster/my-shift", s.perm("attendance.view", s.handleMyAssignedShift))
	mux.Handle("GET /api/v1/roster/export", s.attendanceAdmin(s.handleRosterExportCSV))
	mux.Handle("GET /api/v1/staff/availability", s.perm("attendance.view", s.handleListStaffAvailability))
	mux.Handle("POST /api/v1/staff/availability", s.perm("attendance.manage", s.handleSetStaffAvailability))

	// Notifications & governed internal communications (Phase 11).
	mux.Handle("GET /api/v1/notifications", s.perm("notifications.view", s.handleListNotifications))
	mux.Handle("POST /api/v1/notifications", s.perm("notifications.send", s.handleSendNotification))
	mux.Handle("GET /api/v1/notifications/unread-count", s.perm("notifications.view", s.handleUnreadNotificationCount))
	mux.Handle("POST /api/v1/notifications/read-all", s.perm("notifications.view", s.handleMarkAllNotificationsRead))
	mux.Handle("POST /api/v1/notifications/{id}/read", s.perm("notifications.view", s.handleMarkNotificationRead))

	mux.Handle("GET /api/v1/communications/policy", s.requireAuth(http.HandlerFunc(s.handleGetCommsPolicy)))
	mux.Handle("POST /api/v1/communications/policy/acknowledge", s.requireAuth(http.HandlerFunc(s.handleAcknowledgeCommsPolicy)))
	mux.Handle("POST /api/v1/communications/channels", s.perm("comms.manage", s.handleCreateChannel))
	mux.Handle("GET /api/v1/communications/channels", s.perm("comms.view", s.handleListChannels))
	mux.Handle("GET /api/v1/communications/channels/{id}", s.perm("comms.view", s.handleGetChannel))
	mux.Handle("POST /api/v1/communications/channels/{id}/members", s.perm("comms.manage", s.handleAddChannelMember))
	mux.Handle("DELETE /api/v1/communications/channels/{id}/members/{userId}", s.perm("comms.manage", s.handleRemoveChannelMember))
	mux.Handle("POST /api/v1/communications/channels/{id}/messages", s.perm("comms.send", s.handleSendChannelMessage))
	mux.Handle("GET /api/v1/communications/channels/{id}/messages", s.perm("comms.view", s.handleListChannelMessages))
	mux.Handle("POST /api/v1/communications/messages", s.perm("comms.send", s.handleSendDirectMessage))
	mux.Handle("GET /api/v1/communications/messages", s.perm("comms.view", s.handleListDirectMessages))
	mux.Handle("POST /api/v1/communications/announcements", s.perm("comms.announce", s.handleCreateAnnouncement))
	mux.Handle("GET /api/v1/communications/announcements", s.perm("comms.view", s.handleListAnnouncements))
	mux.Handle("GET /api/v1/communications/admin/messages", s.perm("comms.admin", s.handleAdminSearchMessages))
	mux.Handle("GET /api/v1/communications/compliance/search", s.perm("comms.audit", s.handleComplianceSearch))
	mux.Handle("POST /api/v1/communications/retention/run", s.perm("comms.admin", s.handleRunRetention))

	// Enterprise comms: read receipts, typing, search, threading, notifications.
	mux.Handle("POST /api/v1/communications/messages/read", s.perm("comms.view", s.handleMarkMessagesRead))
	mux.Handle("POST /api/v1/communications/conversations/read", s.perm("comms.view", s.handleMarkConversationRead))
	mux.Handle("POST /api/v1/communications/channels/{id}/read", s.perm("comms.view", s.handleMarkChannelRead))
	mux.Handle("GET /api/v1/communications/unread", s.perm("comms.view", s.handleGetUnreadCounts))
	mux.Handle("POST /api/v1/communications/typing", s.perm("comms.send", s.handleSetTypingIndicator))
	mux.Handle("GET /api/v1/communications/typing", s.perm("comms.view", s.handleGetTypingIndicators))
	mux.Handle("PATCH /api/v1/communications/messages/{id}", s.perm("comms.send", s.handleEditMessage))
	mux.Handle("DELETE /api/v1/communications/messages/{id}", s.perm("comms.send", s.handleDeleteMessage))
	mux.Handle("GET /api/v1/communications/messages/{id}/thread", s.perm("comms.view", s.handleGetThreadReplies))
	mux.Handle("GET /api/v1/communications/search", s.perm("comms.view", s.handleSearchMessages))
	mux.Handle("GET /api/v1/communications/notifications/prefs", s.perm("comms.view", s.handleGetNotificationPrefs))
	mux.Handle("PUT /api/v1/communications/notifications/prefs", s.perm("comms.view", s.handleUpdateNotificationPrefs))

	// Call logs.
	mux.Handle("POST /api/v1/communications/calls", s.perm("comms.send", s.handleStartCall))
	mux.Handle("PATCH /api/v1/communications/calls/{id}", s.perm("comms.send", s.handleUpdateCall))
	mux.Handle("GET /api/v1/communications/calls", s.perm("comms.view", s.handleListCallLogs))

	// Reporting, dashboards & exports (Phase 12).
	mux.Handle("GET /api/v1/reports/dashboard", s.perm("reports.admin", s.handleReportDashboard))
	mux.Handle("GET /api/v1/reports/my", s.perm("reports.view", s.handleMyReport))
	mux.Handle("GET /api/v1/reports/doctor", s.perm("reports.view", s.handleDoctorReport))
	mux.Handle("GET /api/v1/reports/export", s.perm("reports.export", s.handleExportReport))

	// Backup & disaster recovery (Phase 13, Super Admin).
	mux.Handle("GET /api/v1/backups/status", s.admin("backups.view", s.handleBackupStatus))
	mux.Handle("GET /api/v1/backups/jobs", s.admin("backups.view", s.handleBackupJobs))
	mux.Handle("POST /api/v1/backups/run", s.admin("backups.run", s.handleBackupRun))
	mux.Handle("POST /api/v1/backups/verify", s.admin("backups.verify", s.handleBackupVerify))
	mux.Handle("POST /api/v1/backups/test-neon", s.admin("backups.view", s.handleBackupTestNeon))

	// Build the backup manager from DB settings so the Super Admin can manage
	// cloud backup from the app. Backups stay disabled until configured. An
	// explicitly-attached manager (tests, embedded deployments) is kept as-is.
	if !s.backupMgrExplicit {
		s.rebuildBackupMgr(true)
	}

	return withMiddleware(mux, logger)
}
