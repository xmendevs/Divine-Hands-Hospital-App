package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

// ---- turnaround time (TAT) monitoring ----

// TAT quality indicator targets (minutes), aligned with common laboratory
// quality indicators. These are the thresholds the dashboard highlights as
// bottlenecks when exceeded.
const (
	tatPreAnalyticalTarget  = 30  // collection -> lab receipt
	tatAnalyticalTarget     = 120 // receipt -> result entered
	tatPostAnalyticalTarget = 30  // result verified -> released
)

// LabTATReport computes the TAT dashboard: per-phase aggregates across
// completed/partial requests plus one entry per request.
func (s *Store) LabTATReport(ctx context.Context, limit int) (*domain.LabTATReport, error) {
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx, `
		SELECT r.id::text, r.request_no,
		       COALESCE(p.first_name || ' ' || p.last_name, ''), COALESCE(p.patient_no, ''),
		       r.priority, r.status,
		       r.requested_at, r.released_at,
		       MIN(sp.collected_at), MAX(sp.received_at),
		       MAX(i.result_entered_at), MAX(i.result_verified_at)
		FROM lab_requests r
		LEFT JOIN patients p ON p.id = r.patient_id
		LEFT JOIN lab_specimens sp ON sp.request_id = r.id
		LEFT JOIN lab_request_items i ON i.request_id = r.id
		WHERE r.status <> 'cancelled'
		GROUP BY r.id, r.request_no, p.first_name, p.last_name, p.patient_no,
		         r.priority, r.status, r.requested_at, r.released_at, r.created_at
		ORDER BY r.created_at DESC
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type row struct {
		req       domain.LabTATEntry
		requested time.Time
		released  *time.Time
		collected *time.Time
		received  *time.Time
		entered   *time.Time
		verified  *time.Time
	}
	report := &domain.LabTATReport{
		Summary:  make([]domain.LabTATSummary, 0, 3),
		Requests: make([]domain.LabTATEntry, 0),
	}
	pre := make([]float64, 0)
	ana := make([]float64, 0)
	post := make([]float64, 0)

	for rows.Next() {
		var r row
		if err := rows.Scan(&r.req.RequestID, &r.req.RequestNo, &r.req.PatientName, &r.req.PatientNo,
			&r.req.Priority, &r.req.Status, &r.requested, &r.released,
			&r.collected, &r.received, &r.entered, &r.verified); err != nil {
			return nil, err
		}
		// Pre-analytical: collection -> receipt (falls back to requested_at if
		// the specimen was never tracked as collected).
		if r.collected != nil {
			base := *r.collected
			if r.received != nil {
				m := r.received.Sub(base).Minutes()
				r.req.PreAnalytical = &m
			}
		} else if r.received != nil {
			m := r.received.Sub(r.requested).Minutes()
			r.req.PreAnalytical = &m
		}
		// Analytical: receipt -> result entered (or verified).
		if r.received != nil {
			var end time.Time
			if r.entered != nil {
				end = *r.entered
			} else if r.verified != nil {
				end = *r.verified
			}
			if !end.IsZero() && end.After(*r.received) {
				m := end.Sub(*r.received).Minutes()
				r.req.Analytical = &m
			}
		}
		// Post-analytical: verified -> released.
		if r.verified != nil && r.released != nil && r.released.After(*r.verified) {
			m := r.released.Sub(*r.verified).Minutes()
			r.req.PostAnalytical = &m
		}
		// Total: requested -> released.
		if r.released != nil && r.released.After(r.requested) {
			m := r.released.Sub(r.requested).Minutes()
			r.req.Total = &m
		}
		if r.req.PreAnalytical != nil {
			pre = append(pre, *r.req.PreAnalytical)
		}
		if r.req.Analytical != nil {
			ana = append(ana, *r.req.Analytical)
		}
		if r.req.PostAnalytical != nil {
			post = append(post, *r.req.PostAnalytical)
		}
		report.Requests = append(report.Requests, r.req)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	report.Summary = append(report.Summary,
		summarizeTAT("pre_analytical", "Pre-analytical (collection → lab receipt)", pre, tatPreAnalyticalTarget),
		summarizeTAT("analytical", "Analytical (receipt → result entered)", ana, tatAnalyticalTarget),
		summarizeTAT("post_analytical", "Post-analytical (verified → released)", post, tatPostAnalyticalTarget),
	)
	return report, nil
}

func summarizeTAT(phase, label string, values []float64, target int) domain.LabTATSummary {
	out := domain.LabTATSummary{Phase: phase, Label: label, TargetMinutes: target}
	if len(values) == 0 {
		return out
	}
	var sum float64
	var within int
	for _, v := range values {
		sum += v
		if v <= float64(target) {
			within++
		}
		if v > float64(target) {
			out.BottleneckHits++
		}
	}
	out.Completed = len(values)
	out.AvgMinutes = sum / float64(len(values))
	out.P95Minutes = p95(values)
	out.WithinTarget = float64(within) / float64(len(values)) * 100
	out.Bottleneck = out.AvgMinutes > float64(target)
	return out
}

func p95(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	// Simple insertion-sort clone (small n, avoids extra deps).
	sorted := make([]float64, len(values))
	copy(sorted, values)
	for i := 1; i < len(sorted); i++ {
		for j := i; j > 0 && sorted[j] < sorted[j-1]; j-- {
			sorted[j], sorted[j-1] = sorted[j-1], sorted[j]
		}
	}
	idx := int(float64(len(sorted)) * 0.95)
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}

// ---- instrument / analyzer interface ----

// CreateInstrument registers a lab analyser.
func (s *Store) CreateInstrument(ctx context.Context, p domain.LabInstrument) (*domain.LabInstrument, error) {
	var out domain.LabInstrument
	err := s.pool.QueryRow(ctx, `
		INSERT INTO lab_instruments (code, name, instrument_type, manufacturer, model, status)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id::text, code, name, instrument_type, manufacturer, model, status,
		          last_connected_at, created_at, updated_at`,
		p.Code, p.Name, p.InstrumentType, p.Manufacturer, p.Model, p.Status).
		Scan(&out.ID, &out.Code, &out.Name, &out.InstrumentType, &out.Manufacturer, &out.Model,
			&out.Status, &out.LastConnectedAt, &out.CreatedAt, &out.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// ListInstruments returns all registered analysers.
func (s *Store) ListInstruments(ctx context.Context) ([]domain.LabInstrument, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, code, name, instrument_type, manufacturer, model, status,
		       last_connected_at, created_at, updated_at
		FROM lab_instruments ORDER BY name ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.LabInstrument, 0)
	for rows.Next() {
		var it domain.LabInstrument
		if err := rows.Scan(&it.ID, &it.Code, &it.Name, &it.InstrumentType, &it.Manufacturer, &it.Model,
			&it.Status, &it.LastConnectedAt, &it.CreatedAt, &it.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// SetInstrumentStatus updates an analyser's status (online/offline/...).
func (s *Store) SetInstrumentStatus(ctx context.Context, id, status string) (*domain.LabInstrument, error) {
	var out domain.LabInstrument
	err := s.pool.QueryRow(ctx, `
		UPDATE lab_instruments SET status = $2, updated_at = now(),
		       last_connected_at = CASE WHEN $2 = 'online' THEN now() ELSE last_connected_at END
		WHERE id = $1::uuid
		RETURNING id::text, code, name, instrument_type, manufacturer, model, status,
		          last_connected_at, created_at, updated_at`, id, status).
		Scan(&out.ID, &out.Code, &out.Name, &out.InstrumentType, &out.Manufacturer, &out.Model,
			&out.Status, &out.LastConnectedAt, &out.CreatedAt, &out.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &out, nil
}

// QueueInstrumentLog appends a message to an instrument's interface queue.
// Outbound messages start as 'queued' (awaiting transmission); inbound
// messages start as 'received'.
func (s *Store) QueueInstrumentLog(ctx context.Context, instrumentID, direction, messageType string, payload []byte) (*domain.LabInstrumentLog, error) {
	status := "queued"
	if direction == "inbound" {
		status = "received"
	}
	var out domain.LabInstrumentLog
	err := s.pool.QueryRow(ctx, `
		INSERT INTO lab_instrument_logs (instrument_id, direction, message_type, payload, status)
		VALUES ($1::uuid, $2, $3, $4::jsonb, $5)
		RETURNING id::text, instrument_id::text, direction, message_type, payload, status, error,
		          created_at, processed_at`,
		instrumentID, direction, messageType, string(payload), status).
		Scan(&out.ID, &out.InstrumentID, &out.Direction, &out.MessageType, &out.Payload,
			&out.Status, &out.Error, &out.CreatedAt, &out.ProcessedAt)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// ListInstrumentLogs returns the interface log queue for an instrument.
func (s *Store) ListInstrumentLogs(ctx context.Context, instrumentID string, status string, limit int) ([]domain.LabInstrumentLog, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := `
		SELECT id::text, instrument_id::text, direction, message_type, payload, status, error,
		       created_at, processed_at
		FROM lab_instrument_logs WHERE instrument_id = $1::uuid`
	args := []any{instrumentID}
	if status != "" && status != "ALL" {
		q += ` AND status = $2`
		args = append(args, status)
	}
	q += ` ORDER BY created_at DESC LIMIT ` + itoa(limit)
	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.LabInstrumentLog, 0)
	for rows.Next() {
		var l domain.LabInstrumentLog
		if err := rows.Scan(&l.ID, &l.InstrumentID, &l.Direction, &l.MessageType, &l.Payload,
			&l.Status, &l.Error, &l.CreatedAt, &l.ProcessedAt); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}
