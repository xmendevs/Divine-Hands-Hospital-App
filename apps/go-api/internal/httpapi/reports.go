// Reporting, dashboards & exports (Phase 12).
package httpapi

import (
	"fmt"
	"net/http"
	"regexp"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/export"
	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/pdf"
)

var dateRangeRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// exportKinds lists the supported report exports. The permission to export is
// held only by admins/super admins, and every export is audited below.
var exportKinds = map[string]bool{
	"patients":      true,
	"invoices":      true,
	"payments":      true,
	"dispensations": true,
	"lab_requests":  true,
	"attendance":    true,
	"medicines":     true,
	"refunds":       true,
}

// handleReportDashboard returns the super-admin aggregate dashboard.
func (s *server) handleReportDashboard(w http.ResponseWriter, r *http.Request) {
	d, err := s.store.Dashboard(r.Context())
	if err != nil {
		s.logger.Error("dashboard failed", "error", err)
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionReportViewed, "reports.dashboard", "", nil, map[string]any{"scope": "all"})
	writeJSON(w, http.StatusOK, d)
}

// handleMyReport returns the caller's role-scoped report.
func (s *server) handleMyReport(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	roles, err := s.store.GetUserRoles(r.Context(), actor.ID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	if len(roles) == 0 {
		writeError(w, r, http.StatusForbidden, "forbidden", "no report is available for this account")
		return
	}

	// Super admin / admin see the aggregate dashboard.
	if admin, err := s.store.UserHasPermission(r.Context(), actor.ID, "reports.admin"); err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	} else if admin {
		d, err := s.store.Dashboard(r.Context())
		if err != nil {
			s.logger.Error("dashboard failed", "error", err)
			writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
			return
		}
		s.recordAudit(r, domain.ActionReportViewed, "reports.dashboard", "", nil, map[string]any{"scope": "all"})
		writeJSON(w, http.StatusOK, d)
		return
	}

	switch roles[0].Code {
	case "doctor":
		rep, err := s.store.DoctorReport(r.Context(), actor.ID)
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
			return
		}
		writeJSON(w, http.StatusOK, rep)
	case "nurse", "matron":
		rep, err := s.store.NursingReport(r.Context(), actor.ID)
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
			return
		}
		writeJSON(w, http.StatusOK, rep)
	case "pharmacist":
		rep, err := s.store.PharmacyReport(r.Context())
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
			return
		}
		writeJSON(w, http.StatusOK, rep)
	case "lab_technician", "lab_supervisor":
		rep, err := s.store.LabReport(r.Context())
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
			return
		}
		writeJSON(w, http.StatusOK, rep)
	case "cashier", "billing_officer", "billing_supervisor":
		rep, err := s.store.CashierReport(r.Context())
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
			return
		}
		writeJSON(w, http.StatusOK, rep)
	case "storekeeper":
		rep, err := s.store.InventoryReport(r.Context())
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
			return
		}
		writeJSON(w, http.StatusOK, rep)
	case "receptionist":
		rep, err := s.store.ReceptionReport(r.Context())
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
			return
		}
		writeJSON(w, http.StatusOK, rep)
	default:
		writeError(w, r, http.StatusForbidden, "forbidden", "no report is available for this role")
	}
	s.recordAudit(r, domain.ActionReportViewed, "reports.my", "", nil, map[string]any{"role": roles[0].Code})
}

// handleDoctorReport returns the doctor workload report for the caller. It is
// available to doctors and super-admins (who can access everything), so the
// Clinical page's workload dashboard works for the super-admin too.
func (s *server) handleDoctorReport(w http.ResponseWriter, r *http.Request) {
	actor := userFromContext(r.Context())
	roles, err := s.store.GetUserRoles(r.Context(), actor.ID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	allowed := false
	for _, rl := range roles {
		if rl.Code == "doctor" || rl.Code == "super_admin" {
			allowed = true
			break
		}
	}
	if !allowed {
		writeError(w, r, http.StatusForbidden, "forbidden", "doctor workload is available to doctors and super-admins")
		return
	}
	rep, err := s.store.DoctorReport(r.Context(), actor.ID)
	if err != nil {
		s.logger.Error("doctor report failed", "error", err)
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}
	s.recordAudit(r, domain.ActionReportViewed, "reports.doctor", "", nil, map[string]any{"role": "doctor"})
	writeJSON(w, http.StatusOK, rep)
}

// handleExportReport streams a permission-controlled report export. Sensitive
// exports are audited with the report, format and row count.
func (s *server) handleExportReport(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	kind := q.Get("report")
	format := q.Get("format")
	from, to := q.Get("from"), q.Get("to")

	if !exportKinds[kind] {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "unsupported report; choose one of patients, invoices, payments, dispensations, lab_requests, attendance, medicines, refunds")
		return
	}
	if format == "" {
		format = "csv"
	}
	if format != "csv" && format != "pdf" && format != "xlsx" {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "unsupported format; choose csv, xlsx or pdf")
		return
	}
	for _, d := range []string{from, to} {
		if d != "" && !dateRangeRe.MatchString(d) {
			writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "from/to must be YYYY-MM-DD")
			return
		}
	}
	if from != "" && to != "" && from > to {
		writeError(w, r, http.StatusUnprocessableEntity, "validation_error", "from cannot be after to")
		return
	}

	tbl, err := s.store.ExportReport(r.Context(), kind, from, to)
	if err != nil {
		s.logger.Error("export failed", "report", kind, "error", err)
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}

	var (
		content     []byte
		contentType string
		ext         string
	)
	switch format {
	case "csv":
		content, err = export.CSV(tbl.Header, tbl.Rows)
		contentType = "text/csv; charset=utf-8"
		ext = "csv"
	case "xlsx":
		content, err = export.XLSX(tbl.Header, tbl.Rows)
		contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
		ext = "xlsx"
	case "pdf":
		content, err = pdf.Report(tbl.Title, tbl.Header, tbl.Rows)
		contentType = "application/pdf"
		ext = "pdf"
	}
	if err != nil {
		s.logger.Error("render export failed", "report", kind, "format", format, "error", err)
		writeError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
		return
	}

	filename := fmt.Sprintf("%s_%s_%s.%s", kind, orDefault(from, "all"), orDefault(to, "all"), ext)

	s.recordAudit(r, domain.ActionReportExport, "reports.export", kind, nil, map[string]any{
		"report": kind,
		"format": format,
		"from":   from,
		"to":     to,
		"rows":   len(tbl.Rows),
	})

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(content)
}

func orDefault(s, d string) string {
	if s == "" {
		return d
	}
	return s
}
