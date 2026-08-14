// Report exports (Phase 12): tabular extractions rendered by the caller into
// CSV, XLSX or PDF. Only admins/super admins hold the export permission, and
// every export is audited at the handler.
package store

import (
	"context"
	"fmt"
)

// ExportTable is a tabular report ready for rendering.
type ExportTable struct {
	Title  string
	Header []string
	Rows   [][]string
}

// ExportReport extracts rows for the named report. from/to are inclusive
// YYYY-MM-DD bounds; empty means unbounded on that side. The kind must be one
// of the supported export kinds (validated by the caller).
func (s *Store) ExportReport(ctx context.Context, kind, from, to string) (*ExportTable, error) {
	var (
		title  string
		header []string
		query  string
		clause string
		args   []any
	)
	switch kind {
	case "patients":
		title, header = "Patient registrations", []string{"Patient No", "Name", "Gender", "Date of Birth", "Phone", "Status", "Registered At"}
		clause, args = dateRangeClause("created_at", from, to)
		query = `
			SELECT patient_no, last_name || ', ' || first_name, gender,
			       COALESCE(date_of_birth::text, ''), phone, status, created_at::text
			FROM patients ` + clause + ` ORDER BY created_at DESC`
	case "invoices":
		title, header = "Invoices", []string{"Invoice No", "Patient No", "Status", "Total", "Paid", "Balance", "Created At"}
		clause, args = dateRangeClause("i.created_at", from, to)
		query = `
			SELECT i.invoice_no, COALESCE(p.patient_no, ''), i.status,
			       i.total_amount::text, i.amount_paid::text,
			       (i.total_amount - i.amount_paid)::text, i.created_at::text
			FROM invoices i LEFT JOIN patients p ON p.id = i.patient_id ` + clause + `
			ORDER BY i.created_at DESC`
	case "payments":
		title, header = "Payments", []string{"Payment No", "Patient No", "Amount", "Method", "Reference", "Received By", "Received At"}
		clause, args = dateRangeClause("pm.received_at", from, to)
		query = `
			SELECT pm.payment_no, COALESCE(p.patient_no, ''), pm.amount::text, pm.method,
			       pm.reference, COALESCE(u.username, ''), pm.received_at::text
			FROM payments pm
			LEFT JOIN patients p ON p.id = pm.patient_id
			LEFT JOIN users u ON u.id = pm.received_by ` + clause + `
			ORDER BY pm.received_at DESC`
	case "dispensations":
		title, header = "Pharmacy dispensations", []string{"Dispensation No", "Patient No", "Total Amount", "Dispensed By", "Dispensed At"}
		clause, args = dateRangeClause("d.created_at", from, to)
		query = `
			SELECT d.dispensation_no, COALESCE(p.patient_no, ''), d.total_amount::text,
			       COALESCE(u.username, ''), d.created_at::text
			FROM dispensations d
			LEFT JOIN patients p ON p.id = d.patient_id
			LEFT JOIN users u ON u.id = d.dispensed_by ` + clause + `
			ORDER BY d.created_at DESC`
	case "lab_requests":
		title, header = "Laboratory requests", []string{"Request No", "Patient No", "Priority", "Status", "Requested At", "Released At"}
		clause, args = dateRangeClause("lr.requested_at", from, to)
		query = `
			SELECT lr.request_no, COALESCE(p.patient_no, ''), lr.priority, lr.status,
			       lr.requested_at::text, COALESCE(lr.released_at::text, '')
			FROM lab_requests lr LEFT JOIN patients p ON p.id = lr.patient_id ` + clause + `
			ORDER BY lr.requested_at DESC`
	case "attendance":
		title, header = "Staff attendance", []string{"Employee No", "Staff", "Work Date", "Shift", "Clock In", "Clock Out", "Status", "Late"}
		clause, args = dateRangeClause("ar.work_date", from, to)
		query = `
			SELECT st.employee_no, st.last_name || ', ' || st.first_name, ar.work_date::text,
			       COALESCE(sh.code, ''), ar.clock_in_at::text, COALESCE(ar.clock_out_at::text, ''),
			       ar.status, ar.is_late::text
			FROM attendance_records ar
			JOIN staff st ON st.id = ar.staff_id
			LEFT JOIN staff_shifts sh ON sh.id = ar.shift_id ` + clause + `
			ORDER BY ar.work_date DESC`
	case "medicines":
		title, header = "Medicine catalogue", []string{"Code", "Generic Name", "Brand", "Strength", "Category", "Reorder Level", "Active"}
		query = `
			SELECT code, generic_name, brand, strength, category, reorder_level::text, active::text
			FROM medicines ORDER BY code`
	case "refunds":
		title, header = "Refunds", []string{"Refund No", "Request No", "Payment No", "Amount", "Reason", "Processed By", "Processed At"}
		clause, args = dateRangeClause("rf.processed_at", from, to)
		query = `
			SELECT rf.refund_no, rr.refund_no, pm.payment_no, rf.amount::text, rf.reason,
			       COALESCE(u.username, ''), rf.processed_at::text
			FROM refunds rf
			JOIN refund_requests rr ON rr.id = rf.refund_request_id
			JOIN payments pm ON pm.id = rf.payment_id
			LEFT JOIN users u ON u.id = rf.processed_by ` + clause + `
			ORDER BY rf.processed_at DESC`
	default:
		return nil, fmt.Errorf("unsupported export kind %q", kind)
	}

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tbl := &ExportTable{Title: title, Header: header}
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		row := make([]string, len(vals))
		for i, v := range vals {
			if v != nil {
				row[i] = fmt.Sprint(v)
			}
		}
		tbl.Rows = append(tbl.Rows, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if tbl.Rows == nil {
		tbl.Rows = [][]string{}
	}
	return tbl, nil
}

// dateRangeClause builds an inclusive date-range WHERE clause. col is always
// a hardcoded column literal from the export switch above, never user input.
func dateRangeClause(col, from, to string) (string, []any) {
	switch {
	case from != "" && to != "":
		return fmt.Sprintf("WHERE %s BETWEEN $1::date AND $2::date", col), []any{from, to}
	case from != "":
		return fmt.Sprintf("WHERE %s >= $1::date", col), []any{from}
	case to != "":
		return fmt.Sprintf("WHERE %s <= $1::date", col), []any{to}
	}
	return "", nil
}
