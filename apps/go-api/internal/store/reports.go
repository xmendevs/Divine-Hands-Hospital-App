// Reporting, dashboards & exports (Phase 12). All metrics are computed from
// the authoritative transactional tables; nothing is stored redundantly.
package store

import (
	"context"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

// Dashboard computes the super-admin aggregate across all modules.
func (s *Store) Dashboard(ctx context.Context) (domain.Dashboard, error) {
	var d domain.Dashboard

	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*), COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)
		FROM patients`).Scan(&d.PatientRegistrations.Total, &d.PatientRegistrations.Today); err != nil {
		return d, err
	}

	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE status = 'admitted'),
		       COUNT(*) FILTER (WHERE status = 'discharged' AND discharged_at::date = CURRENT_DATE)
		FROM admissions`).Scan(&d.Admissions.Active, &d.Admissions.DischargedToday); err != nil {
		return d, err
	}

	if err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0) FROM payments WHERE received_at::date = CURRENT_DATE`).
		Scan(&d.Revenue.Collected); err != nil {
		return d, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(total_amount), 0) FROM invoices WHERE status <> 'voided'`).
		Scan(&d.Revenue.Invoiced); err != nil {
		return d, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(total_amount - amount_paid), 0)
		FROM invoices WHERE status IN ('issued','partially_paid')`).Scan(&d.Revenue.Outstanding); err != nil {
		return d, err
	}

	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM medicines WHERE active = TRUE`).Scan(&d.Pharmacy.MedicineCount); err != nil {
		return d, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(quantity_on_hand), 0) FROM medicine_batches WHERE status = 'active'`).
		Scan(&d.Pharmacy.StockOnHand); err != nil {
		return d, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM medicine_batches
		WHERE status = 'active' AND quantity_on_hand > 0
		  AND expiry_date IS NOT NULL AND expiry_date <= CURRENT_DATE + INTERVAL '30 days'`).
		Scan(&d.Pharmacy.ExpiringSoon); err != nil {
		return d, err
	}

	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE variance <> 0), COALESCE(SUM(ABS(variance)), 0)
		FROM stock_counts WHERE created_at::date = CURRENT_DATE`).
		Scan(&d.InventoryVariance.CountsWithVariance, &d.InventoryVariance.TotalVariance); err != nil {
		return d, err
	}

	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM attendance_records WHERE status = 'clocked_in'`).
		Scan(&d.Attendance.ClockedIn); err != nil {
		return d, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM staff_rosters sr
		WHERE sr.work_date = CURRENT_DATE
		  AND NOT EXISTS (
		      SELECT 1 FROM attendance_records ar
		      WHERE ar.staff_id = sr.staff_id AND ar.work_date = sr.work_date)`).
		Scan(&d.Attendance.Missed); err != nil {
		return d, err
	}

	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM staff_rosters WHERE work_date = CURRENT_DATE`).
		Scan(&d.RosterCoverage.Scheduled); err != nil {
		return d, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM((req ->> 'required')::int), 0)
		FROM roster_plans p, jsonb_array_elements(p.shift_requirements) req
		WHERE p.status = 'approved' AND p.start_date <= CURRENT_DATE AND p.end_date >= CURRENT_DATE`).
		Scan(&d.RosterCoverage.Required); err != nil {
		return d, err
	}
	d.RosterCoverage.CoveragePct = 100.0
	if d.RosterCoverage.Required > 0 {
		d.RosterCoverage.CoveragePct = float64(d.RosterCoverage.Scheduled) / float64(d.RosterCoverage.Required) * 100
	}

	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM lab_requests WHERE status <> 'cancelled' AND released_at IS NULL`).
		Scan(&d.LabWorkload.PendingRequests); err != nil {
		return d, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM lab_request_items
		WHERE result_entered_at IS NOT NULL AND result_verified_at IS NULL`).
		Scan(&d.LabWorkload.PendingVerification); err != nil {
		return d, err
	}

	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM lab_critical_notifications WHERE status = 'pending'`).
		Scan(&d.CriticalAlerts.Unacknowledged); err != nil {
		return d, err
	}

	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM security_events WHERE created_at >= now() - INTERVAL '24 hours'`).
		Scan(&d.SecurityEvents.Last24h); err != nil {
		return d, err
	}

	return d, nil
}

// DoctorReport returns the doctor-scoped workload report for userID.
func (s *Store) DoctorReport(ctx context.Context, userID string) (domain.DoctorReport, error) {
	var r domain.DoctorReport

	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM patient_assignments
		WHERE assignee_user_id = $1::uuid AND ended_at IS NULL`, userID).Scan(&r.AssignedPatients); err != nil {
		return r, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT patient_id) FROM clinical_notes
		WHERE author_user_id = $1::uuid AND created_at::date = CURRENT_DATE`, userID).
		Scan(&r.PatientsSeenToday); err != nil {
		return r, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT lr.id) FROM lab_requests lr
		JOIN patient_assignments pa ON pa.patient_id = lr.patient_id
		     AND pa.assignee_user_id = $1::uuid AND pa.ended_at IS NULL
		WHERE lr.status <> 'cancelled' AND lr.released_at IS NULL`, userID).Scan(&r.PendingResults); err != nil {
		return r, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM lab_critical_notifications lcn
		JOIN patient_assignments pa ON pa.patient_id = lcn.patient_id
		     AND pa.assignee_user_id = $1::uuid AND pa.ended_at IS NULL
		WHERE lcn.status = 'pending'`, userID).Scan(&r.PendingCriticalLabs); err != nil {
		return r, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM orders
		WHERE ordered_by = $1::uuid AND status NOT IN ('completed','cancelled')`, userID).
		Scan(&r.PendingOrders); err != nil {
		return r, err
	}

	// Active orders broken down by type.
	rows, err := s.pool.Query(ctx, `
		SELECT order_type, COUNT(*) FROM orders
		WHERE ordered_by = $1::uuid AND status NOT IN ('completed','cancelled')
		GROUP BY order_type ORDER BY COUNT(*) DESC`, userID)
	if err != nil {
		return r, err
	}
	defer rows.Close()
	r.ActiveOrdersByType = make([]domain.NameValue, 0)
	for rows.Next() {
		var nv domain.NameValue
		if err := rows.Scan(&nv.Name, &nv.Value); err != nil {
			return r, err
		}
		r.ActiveOrdersByType = append(r.ActiveOrdersByType, nv)
	}
	if err := rows.Err(); err != nil {
		return r, err
	}

	// Recently active assigned patients with their pending results/orders.
	actRows, err := s.pool.Query(ctx, `
		SELECT p.id::text, p.patient_no, p.first_name, p.last_name,
		       (SELECT COUNT(*) FROM lab_requests lr
		         WHERE lr.patient_id = p.id AND lr.status <> 'cancelled' AND lr.released_at IS NULL),
		       (SELECT COUNT(*) FROM orders o
		         WHERE o.patient_id = p.id AND o.status NOT IN ('completed','cancelled'))
		FROM patient_assignments pa
		JOIN patients p ON p.id = pa.patient_id
		WHERE pa.assignee_user_id = $1::uuid AND pa.ended_at IS NULL
		ORDER BY pa.created_at DESC
		LIMIT 10`, userID)
	if err != nil {
		return r, err
	}
	defer actRows.Close()
	r.RecentPatientActivity = make([]domain.DoctorActivity, 0)
	for actRows.Next() {
		var a domain.DoctorActivity
		if err := actRows.Scan(&a.PatientID, &a.PatientNo, &a.FirstName, &a.LastName, &a.PendingLabs, &a.ActiveOrders); err != nil {
			return r, err
		}
		r.RecentPatientActivity = append(r.RecentPatientActivity, a)
	}
	return r, actRows.Err()
}

// NursingReport returns the nursing-scoped report for userID.
func (s *Store) NursingReport(ctx context.Context, userID string) (domain.NursingReport, error) {
	var r domain.NursingReport

	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM admissions WHERE status = 'admitted'`).Scan(&r.AdmittedPatients); err != nil {
		return r, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM handover_notes WHERE created_by = $1::uuid AND created_at::date = CURRENT_DATE`, userID).
		Scan(&r.Handovers); err != nil {
		return r, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM handover_notes WHERE status = 'created'`).Scan(&r.UnacknowledgedHandovers); err != nil {
		return r, err
	}
	// Staff clocked in today who share the caller's department (or the caller
	// alone when they have no department).
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM attendance_records ar
		JOIN staff st ON st.id = ar.staff_id
		WHERE ar.work_date = CURRENT_DATE
		  AND st.department_id = (SELECT department_id FROM staff WHERE user_id = $1::uuid)`, userID).
		Scan(&r.OnDutyToday); err != nil {
		return r, err
	}
	return r, nil
}

// PharmacyReport returns the pharmacy-scoped report.
func (s *Store) PharmacyReport(ctx context.Context) (domain.PharmacyReport, error) {
	var r domain.PharmacyReport

	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*), COALESCE(SUM(total_amount), 0)
		FROM dispensations WHERE created_at::date = CURRENT_DATE`).
		Scan(&r.DispensedToday, &r.DispensedValueToday); err != nil {
		return r, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM medicines m
		WHERE m.active AND COALESCE((
		    SELECT SUM(b.quantity_on_hand) FROM medicine_batches b
		    WHERE b.medicine_id = m.id AND b.status = 'active'), 0) <= m.reorder_level`).
		Scan(&r.LowStock); err != nil {
		return r, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(quantity_on_hand), 0) FROM medicine_batches WHERE status = 'active'`).
		Scan(&r.StockOnHand); err != nil {
		return r, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM medicine_batches
		WHERE status = 'active' AND quantity_on_hand > 0
		  AND expiry_date IS NOT NULL AND expiry_date <= CURRENT_DATE + INTERVAL '30 days'`).
		Scan(&r.ExpiringSoon); err != nil {
		return r, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM stock_adjustments WHERE created_at >= now() - INTERVAL '30 days'`).
		Scan(&r.RecentAdjustments); err != nil {
		return r, err
	}
	return r, nil
}

// LabReport returns the laboratory-scoped report.
func (s *Store) LabReport(ctx context.Context) (domain.LabReport, error) {
	var r domain.LabReport

	rows, err := s.pool.Query(ctx, `
		SELECT status, COUNT(*) FROM lab_requests GROUP BY status ORDER BY COUNT(*) DESC, status`)
	if err != nil {
		return r, err
	}
	defer rows.Close()
	for rows.Next() {
		var nv domain.NameValue
		if err := rows.Scan(&nv.Name, &nv.Value); err != nil {
			return r, err
		}
		r.RequestsByStatus = append(r.RequestsByStatus, nv)
	}
	if err := rows.Err(); err != nil {
		return r, err
	}
	if r.RequestsByStatus == nil {
		r.RequestsByStatus = []domain.NameValue{}
	}

	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM lab_request_items
		WHERE result_entered_at IS NOT NULL AND result_verified_at IS NULL`).
		Scan(&r.PendingVerification); err != nil {
		return r, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (released_at - requested_at)) / 60.0), 0)
		FROM lab_requests WHERE released_at IS NOT NULL`).Scan(&r.AvgTurnaroundMinutes); err != nil {
		return r, err
	}
	return r, nil
}

// CashierReport returns the cashier-scoped report.
func (s *Store) CashierReport(ctx context.Context) (domain.CashierReport, error) {
	var r domain.CashierReport

	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*), COALESCE(SUM(amount), 0) FROM payments WHERE received_at::date = CURRENT_DATE`).
		Scan(&r.PaymentsToday, &r.CollectedToday); err != nil {
		return r, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(total_amount - amount_paid), 0)
		FROM invoices WHERE status IN ('issued','partially_paid')`).Scan(&r.Outstanding); err != nil {
		return r, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0) FROM refunds WHERE processed_at::date = CURRENT_DATE`).
		Scan(&r.RefundedToday); err != nil {
		return r, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM cashier_shifts WHERE status = 'open'`).Scan(&r.OpenShifts); err != nil {
		return r, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(variance), 0) FROM cashier_shifts WHERE status = 'closed' AND variance IS NOT NULL`).
		Scan(&r.ShiftVariance); err != nil {
		return r, err
	}
	return r, nil
}

// InventoryReport returns the storekeeper-scoped report.
func (s *Store) InventoryReport(ctx context.Context) (domain.InventoryReport, error) {
	var r domain.InventoryReport

	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM medicines m
		WHERE m.active AND COALESCE((
		    SELECT SUM(b.quantity_on_hand) FROM medicine_batches b
		    WHERE b.medicine_id = m.id AND b.status = 'active'), 0) <= m.reorder_level`).
		Scan(&r.LowStock); err != nil {
		return r, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM medicine_batches
		WHERE status = 'active' AND quantity_on_hand > 0
		  AND expiry_date IS NOT NULL AND expiry_date <= CURRENT_DATE + INTERVAL '30 days'`).
		Scan(&r.ExpiringSoon); err != nil {
		return r, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(quantity_on_hand), 0) FROM medicine_batches WHERE status = 'active'`).
		Scan(&r.StockOnHand); err != nil {
		return r, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE variance <> 0), COALESCE(SUM(ABS(variance)), 0)
		FROM stock_counts WHERE created_at::date = CURRENT_DATE`).
		Scan(&r.CountsWithVariance, &r.TotalVariance); err != nil {
		return r, err
	}
	return r, nil
}

// ReceptionReport returns the receptionist-scoped report.
func (s *Store) ReceptionReport(ctx context.Context) (domain.ReceptionReport, error) {
	var r domain.ReceptionReport

	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM patients WHERE created_at::date = CURRENT_DATE`).Scan(&r.RegisteredToday); err != nil {
		return r, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM admissions WHERE admitted_at::date = CURRENT_DATE`).Scan(&r.AdmittedToday); err != nil {
		return r, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM admissions WHERE status = 'discharged' AND discharged_at::date = CURRENT_DATE`).
		Scan(&r.DischargedToday); err != nil {
		return r, err
	}
	if err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM triage WHERE created_at::date = CURRENT_DATE`).Scan(&r.TriageToday); err != nil {
		return r, err
	}
	return r, nil
}
