package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

// ---- clinical decision support (CDS) ----

// CheckCDS evaluates allergy + critical-vitals warnings for a proposed
// medication. Alerts are advisory; they never block the prescription.
func (s *Store) CheckCDS(ctx context.Context, patientID, medication string) ([]domain.CDSAlert, error) {
	alerts := make([]domain.CDSAlert, 0)

	// 1. Severe allergy check: match medication tokens against recorded allergy
	// summaries (case-insensitive substring on each allergy line).
	if medication != "" {
		rows, err := s.pool.Query(ctx, `
			SELECT summary FROM patient_clinical_entries
			WHERE patient_id = $1::uuid AND section = 'allergy' AND summary <> ''
			ORDER BY created_at DESC`, patientID)
		if err != nil {
			return nil, err
		}
		var allergies []string
		for rows.Next() {
			var summary string
			if err := rows.Scan(&summary); err != nil {
				rows.Close()
				return nil, err
			}
			allergies = append(allergies, summary)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}

		med := strings.ToLower(medication)
		for _, a := range allergies {
			low := strings.ToLower(a)
			if strings.Contains(low, med) || strings.Contains(med, low) {
				alerts = append(alerts, domain.CDSAlert{
					Severity: domain.CDSAlertCritical,
					Category: "allergy",
					Message:  "Severe allergy on record: " + a + " — this medication may trigger a reaction.",
				})
				break
			}
		}
	}

	// 2. Critical vitals check from the most recent vitals record.
	var measurements []byte
	err := s.pool.QueryRow(ctx, `
		SELECT measurements FROM patient_observations
		WHERE patient_id = $1::uuid AND category = 'vitals'
		ORDER BY recorded_at DESC LIMIT 1`, patientID).Scan(&measurements)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if err == nil {
		var m map[string]any
		if json.Unmarshal(measurements, &m) == nil {
			alerts = append(alerts, checkVitalsCDS(m)...)
		}
	}

	if len(alerts) == 0 {
		return []domain.CDSAlert{}, nil
	}
	return alerts, nil
}

// checkVitalsCDS evaluates the latest vitals against critical thresholds.
func checkVitalsCDS(m map[string]any) []domain.CDSAlert {
	alerts := make([]domain.CDSAlert, 0)

	// BP: systolic/diastolic from "120/80" strings.
	if bp, ok := m["bp"].(string); ok {
		if parts := strings.Split(bp, "/"); len(parts) == 2 {
			sys, sysOK := parseFloat(parts[0])
			dia, diaOK := parseFloat(parts[1])
			if sysOK && diaOK {
				if sys >= 180 || dia >= 120 {
					alerts = append(alerts, domain.CDSAlert{
						Severity: domain.CDSAlertCritical,
						Category: "vitals",
						Message:  "Hypertensive crisis: BP " + bp + " (≥180/120). Consider re-check and urgent care.",
					})
				} else if sys >= 140 || dia >= 90 {
					alerts = append(alerts, domain.CDSAlert{
						Severity: domain.CDSAlertWarning,
						Category: "vitals",
						Message:  "Elevated BP: " + bp + " (≥140/90).",
					})
				}
			}
		}
	}
	// Temperature.
	if t, ok := numAny(m["temperature"]); ok {
		if t >= 39.0 {
			alerts = append(alerts, domain.CDSAlert{
				Severity: domain.CDSAlertCritical,
				Category: "vitals",
				Message:  "High fever: " + formatNum(t) + "°C (≥39°C).",
			})
		} else if t <= 35.0 {
			alerts = append(alerts, domain.CDSAlert{
				Severity: domain.CDSAlertCritical,
				Category: "vitals",
				Message:  "Hypothermia: " + formatNum(t) + "°C (≤35°C).",
			})
		} else if t >= 38.0 {
			alerts = append(alerts, domain.CDSAlert{
				Severity: domain.CDSAlertWarning,
				Category: "vitals",
				Message:  "Fever: " + formatNum(t) + "°C.",
			})
		}
	}
	// Oxygen saturation.
	if spo2, ok := numAny(m["oxygenSaturation"]); ok && spo2 <= 90 {
		alerts = append(alerts, domain.CDSAlert{
			Severity: domain.CDSAlertCritical,
			Category: "vitals",
			Message:  "Low oxygen saturation: " + formatNum(spo2) + "% (≤90%).",
		})
	}
	// Pulse.
	if p, ok := numAny(m["pulse"]); ok && p != 0 {
		if p >= 120 {
			alerts = append(alerts, domain.CDSAlert{
				Severity: domain.CDSAlertCritical,
				Category: "vitals",
				Message:  "Tachycardia: pulse " + formatNum(p) + " bpm (≥120).",
			})
		} else if p <= 50 {
			alerts = append(alerts, domain.CDSAlert{
				Severity: domain.CDSAlertCritical,
				Category: "vitals",
				Message:  "Bradycardia: pulse " + formatNum(p) + " bpm (≤50).",
			})
		}
	}
	// Respiratory rate.
	if rr, ok := numAny(m["respiratoryRate"]); ok && rr != 0 {
		if rr >= 25 {
			alerts = append(alerts, domain.CDSAlert{
				Severity: domain.CDSAlertCritical,
				Category: "vitals",
				Message:  "Tachypnea: respiratory rate " + formatNum(rr) + " brpm (≥25).",
			})
		} else if rr <= 10 {
			alerts = append(alerts, domain.CDSAlert{
				Severity: domain.CDSAlertCritical,
				Category: "vitals",
				Message:  "Bradypnea: respiratory rate " + formatNum(rr) + " brpm (≤10).",
			})
		}
	}
	return alerts
}

func numAny(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case string:
		return parseFloat(n)
	}
	return 0, false
}

func parseFloat(s string) (float64, bool) {
	f, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	return f, err == nil
}

func formatNum(f float64) string {
	return strconv.FormatFloat(f, 'f', -1, 64)
}

// ---- patient history bundle ----

// PatientHistory returns the one-call timeline snapshot for a patient:
// consultations (notes), vitals trend, released lab results, and orders.
func (s *Store) PatientHistory(ctx context.Context, patientID string) (*domain.PatientHistoryBundle, error) {
	b := &domain.PatientHistoryBundle{
		Notes:     make([]domain.ClinicalNote, 0),
		Vitals:    make([]domain.Observation, 0),
		Lab:       make([]domain.LabRequest, 0),
		Orders:    make([]domain.Order, 0),
		Allergies: make([]domain.ClinicalEntry, 0),
	}

	// Consultations (latest version of each note group), newest first.
	notes, err := s.ListNotes(ctx, patientID)
	if err != nil {
		return nil, err
	}
	b.Notes = notes

	// Vitals trend, oldest first.
	vRows, err := s.pool.Query(ctx, `
		SELECT id::text, patient_id::text, category, measurements, notes, recorded_by::text, recorded_at
		FROM patient_observations
		WHERE patient_id = $1::uuid AND category = 'vitals'
		ORDER BY recorded_at ASC`, patientID)
	if err != nil {
		return nil, err
	}
	for vRows.Next() {
		var o domain.Observation
		if err := vRows.Scan(&o.ID, &o.PatientID, &o.Category, &o.Measurements, &o.Notes, &o.RecordedBy, &o.RecordedAt); err != nil {
			vRows.Close()
			return nil, err
		}
		b.Vitals = append(b.Vitals, o)
	}
	vRows.Close()
	if err := vRows.Err(); err != nil {
		return nil, err
	}

	// Released lab results for this patient.
	lab, err := s.ListLabRequests(ctx, ListLabRequestsParams{Patient: patientID, Limit: 100})
	if err != nil {
		return nil, err
	}
	for i := range lab {
		if lab[i].Status == domain.LabStatusReleased {
			b.Lab = append(b.Lab, lab[i])
		}
	}

	// Orders, newest first.
	orders, err := s.ListPatientOrders(ctx, patientID)
	if err != nil {
		return nil, err
	}
	b.Orders = orders

	// Allergies (for the CDS summary in the drawer).
	aRows, err := s.pool.Query(ctx, `
		SELECT id::text, patient_id::text, section, summary, details, recorded_by::text, created_at, updated_at
		FROM patient_clinical_entries
		WHERE patient_id = $1::uuid AND section = 'allergy' AND summary <> ''
		ORDER BY created_at DESC`, patientID)
	if err != nil {
		return nil, err
	}
	for aRows.Next() {
		var e domain.ClinicalEntry
		if err := aRows.Scan(&e.ID, &e.PatientID, &e.Section, &e.Summary, &e.Details, &e.RecordedBy, &e.CreatedAt, &e.UpdatedAt); err != nil {
			aRows.Close()
			return nil, err
		}
		b.Allergies = append(b.Allergies, e)
	}
	aRows.Close()
	if err := aRows.Err(); err != nil {
		return nil, err
	}
	return b, nil
}

// ---- digital signatures & attestation ----

// SignNote records an attending physician's attestation on a clinical note.
func (s *Store) SignNote(ctx context.Context, noteID, signerID, signatureHash string) (*domain.ClinicalNote, error) {
	n, err := scanNote(s.pool.QueryRow(ctx, `
		UPDATE clinical_notes SET signed_by = $2::uuid, signed_at = now(), signature_hash = $3
		WHERE id = $1::uuid
		RETURNING `+noteCols, noteID, signerID, signatureHash))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return n, nil
}

// SignOrder records an attending physician's attestation on an order.
func (s *Store) SignOrder(ctx context.Context, orderID, signerID, signatureHash string) (*domain.Order, error) {
	o, err := scanOrder(s.pool.QueryRow(ctx, `
		UPDATE orders SET signed_by = $2::uuid, signed_at = now(), signature_hash = $3
		WHERE id = $1::uuid
		RETURNING `+orderCols, orderID, signerID, signatureHash))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return o, nil
}

// ComputeSignatureHash derives the audit signature for a record: a SHA-256
// over the record id, signer, timestamp, and the signer's password hash
// (server-side credential proof — the password itself is never stored).
func ComputeSignatureHash(recordID, signerID, signerPasswordHash string, signedAt time.Time) string {
	payload := recordID + "|" + signerID + "|" + signedAt.UTC().Format(time.RFC3339Nano) + "|" + signerPasswordHash
	sum := sha256.Sum256([]byte(payload))
	return hex.EncodeToString(sum[:])
}
