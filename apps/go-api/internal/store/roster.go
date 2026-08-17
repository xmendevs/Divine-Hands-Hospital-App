package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/xmendevs/divine-hands-hospital-app/apps/go-api/internal/domain"
)

// Roster errors.
var (
	ErrRosterNotDraft     = errors.New("roster is not editable in this state")
	ErrRosterNotSubmitted = errors.New("roster is not pending approval")
	ErrRosterRequirements = errors.New("shift requirements are required")
	ErrRosterConflict     = errors.New("staff already assigned on this date")
)

// ---- plan persistence ----

const rosterPlanCols = `rp.id::text, rp.plan_no, rp.name, rp.department_id::text, COALESCE(d.name, ''),
	rp.start_date::text, rp.end_date::text, rp.max_hours_per_week, rp.max_consecutive_shifts,
	rp.min_rest_hours, rp.max_consecutive_nights, rp.shift_requirements,
	rp.status::text, rp.version, rp.amended_from::text,
	rp.created_by::text, rp.submitted_by::text, rp.submitted_at,
	rp.approved_by::text, rp.approved_at, rp.rejected_reason,
	rp.created_at, rp.updated_at`

const rosterPlanFrom = ` FROM roster_plans rp LEFT JOIN departments d ON d.id = rp.department_id`

func scanRosterPlan(r pgx.Row) (*domain.RosterPlan, error) {
	var p domain.RosterPlan
	var reqs []byte
	err := r.Scan(&p.ID, &p.PlanNo, &p.Name, &p.DepartmentID, &p.DepartmentName,
		&p.StartDate, &p.EndDate, &p.MaxHoursPerWeek, &p.MaxConsecutiveShifts,
		&p.MinRestHours, &p.MaxConsecutiveNights, &reqs,
		&p.Status, &p.Version, &p.AmendedFrom,
		&p.CreatedBy, &p.SubmittedBy, &p.SubmittedAt,
		&p.ApprovedBy, &p.ApprovedAt, &p.RejectedReason,
		&p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if len(reqs) > 0 {
		_ = json.Unmarshal(reqs, &p.ShiftRequirements)
	}
	return &p, nil
}

// getRosterPlanBase returns a plan without assignments or unmet requirements.
func (s *Store) getRosterPlanBase(ctx context.Context, id string) (*domain.RosterPlan, error) {
	p, err := scanRosterPlan(s.pool.QueryRow(ctx, `SELECT `+rosterPlanCols+rosterPlanFrom+` WHERE rp.id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

// CreateRosterPlanParams carries the planning parameters.
type CreateRosterPlanParams struct {
	Name                 string
	DepartmentID         string
	StartDate            string
	EndDate              string
	MaxHoursPerWeek      float64
	MaxConsecutiveShifts int
	MinRestHours         float64
	MaxConsecutiveNights int
	ShiftRequirements    []domain.RosterShiftRequirement
	CreatedBy            string
}

// CreateRosterPlan creates a draft plan and generates its proposed roster.
func (s *Store) CreateRosterPlan(ctx context.Context, p CreateRosterPlanParams) (*domain.RosterPlan, error) {
	if len(p.ShiftRequirements) == 0 {
		return nil, ErrRosterRequirements
	}
	reqs, _ := json.Marshal(p.ShiftRequirements)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var seq int64
	if err := tx.QueryRow(ctx, `SELECT nextval('roster_plans_no_seq')`).Scan(&seq); err != nil {
		return nil, err
	}
	planNo := "RST" + lpadInt(seq, 6)

	var id string
	if err := tx.QueryRow(ctx, `
		INSERT INTO roster_plans (plan_no, name, department_id, start_date, end_date,
		                          max_hours_per_week, max_consecutive_shifts, min_rest_hours,
		                          max_consecutive_nights, shift_requirements, created_by)
		VALUES ($1, $2, $3::uuid, $4::date, $5::date, $6, $7, $8, $9, $10::jsonb, $11::uuid)
		RETURNING id::text`,
		planNo, p.Name, p.DepartmentID, p.StartDate, p.EndDate,
		p.MaxHoursPerWeek, p.MaxConsecutiveShifts, p.MinRestHours,
		p.MaxConsecutiveNights, reqs, p.CreatedBy).Scan(&id); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	if err := s.generateRoster(ctx, id); err != nil {
		return nil, err
	}
	return s.GetRosterPlan(ctx, id)
}

// ListRosterPlansParams filters plans.
type ListRosterPlansParams struct {
	Status     string
	Department string
	Limit      int
	Offset     int
}

// ListRosterPlans returns plans, newest first.
func (s *Store) ListRosterPlans(ctx context.Context, p ListRosterPlansParams) ([]domain.RosterPlan, error) {
	q := `SELECT ` + rosterPlanCols + rosterPlanFrom + ` WHERE true`
	args := []any{}
	if p.Status != "" {
		args = append(args, p.Status)
		q += ` AND rp.status = $` + itoa(len(args))
	}
	if p.Department != "" {
		args = append(args, p.Department)
		q += ` AND rp.department_id = $` + itoa(len(args)) + `::uuid`
	}
	q += ` ORDER BY rp.created_at DESC LIMIT $` + itoa(len(args)+1) + ` OFFSET $` + itoa(len(args)+2)
	args = append(args, p.Limit, p.Offset)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.RosterPlan, 0)
	for rows.Next() {
		p, err := scanRosterPlan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

const rosterAssignmentCols = `ra.id::text, ra.plan_id::text, ra.staff_id::text, ra.shift_id::text,
	ra.work_date::text, ra.created_by::text, ra.created_at,
	COALESCE(st.first_name || ' ' || st.last_name, ''), COALESCE(st.employee_no, ''),
	COALESCE(sh.name, ''), COALESCE(sh.code, '')`

const rosterAssignmentFrom = ` FROM roster_assignments ra
	JOIN staff st ON st.id = ra.staff_id
	JOIN staff_shifts sh ON sh.id = ra.shift_id`

func scanRosterAssignment(r pgx.Row) (*domain.RosterAssignment, error) {
	var a domain.RosterAssignment
	err := r.Scan(&a.ID, &a.PlanID, &a.StaffID, &a.ShiftID,
		&a.WorkDate, &a.CreatedBy, &a.CreatedAt,
		&a.StaffName, &a.EmployeeNo, &a.ShiftName, &a.ShiftCode)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func (s *Store) loadRosterAssignments(ctx context.Context, planID string) ([]domain.RosterAssignment, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+rosterAssignmentCols+rosterAssignmentFrom+` WHERE ra.plan_id = $1::uuid ORDER BY ra.work_date ASC, ra.created_at ASC`, planID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.RosterAssignment, 0)
	for rows.Next() {
		a, err := scanRosterAssignment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// GetRosterPlan returns a plan with assignments and unmet requirements.
func (s *Store) GetRosterPlan(ctx context.Context, id string) (*domain.RosterPlan, error) {
	p, err := s.getRosterPlanBase(ctx, id)
	if err != nil {
		return nil, err
	}
	assignments, err := s.loadRosterAssignments(ctx, id)
	if err != nil {
		return nil, err
	}
	p.Assignments = assignments
	p.Unmet = computeUnmet(p, assignments)
	return p, nil
}

// computeUnmet reports per-shift-per-date staffing shortfalls.
func computeUnmet(plan *domain.RosterPlan, assignments []domain.RosterAssignment) []domain.UnmetRequirement {
	counts := map[string]int{}
	for _, a := range assignments {
		counts[a.ShiftID+"|"+a.WorkDate]++
	}
	start, err1 := time.Parse("2006-01-02", plan.StartDate)
	end, err2 := time.Parse("2006-01-02", plan.EndDate)
	if err1 != nil || err2 != nil {
		return nil
	}
	out := make([]domain.UnmetRequirement, 0)
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		ds := d.Format("2006-01-02")
		for _, req := range plan.ShiftRequirements {
			if req.Required <= 0 {
				continue
			}
			have := counts[req.ShiftID+"|"+ds]
			if have < req.Required {
				out = append(out, domain.UnmetRequirement{
					ShiftID:  req.ShiftID,
					WorkDate: ds,
					Missing:  req.Required - have,
				})
			}
		}
	}
	return out
}

// ---- generation ----

type rosterShift struct {
	ID      string
	Code    string
	Name    string
	Start   int // minutes since midnight
	EndAbs  int // minutes since midnight; overnight shifts end the next day
	IsNight bool
	Dur     int // minutes
}

type rosterStaff struct {
	ID          string
	EmployeeNo  string
	Name        string
	Unavailable map[string]bool // ISO date -> true
	PrefRank    map[string]int  // shiftID -> rank
}

func parseHHMM(s string) (int, error) {
	t, err := time.Parse("15:04", s)
	if err != nil {
		return 0, err
	}
	return t.Hour()*60 + t.Minute(), nil
}

func (s *Store) loadRosterShifts(ctx context.Context, plan *domain.RosterPlan) (map[string]rosterShift, error) {
	rows, err := s.pool.Query(ctx, `SELECT id::text, code, name, to_char(start_time, 'HH24:MI'), to_char(end_time, 'HH24:MI'), is_night FROM staff_shifts`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string]rosterShift{}
	for rows.Next() {
		var sh rosterShift
		var start, end string
		if err := rows.Scan(&sh.ID, &sh.Code, &sh.Name, &start, &end, &sh.IsNight); err != nil {
			return nil, err
		}
		sh.Start, err = parseHHMM(start)
		if err != nil {
			return nil, err
		}
		endMin, err := parseHHMM(end)
		if err != nil {
			return nil, err
		}
		if endMin <= sh.Start {
			endMin += 24 * 60 // overnight
		}
		sh.EndAbs = endMin
		sh.Dur = sh.EndAbs - sh.Start
		out[sh.ID] = sh
	}
	return out, rows.Err()
}

func (s *Store) loadRosterStaff(ctx context.Context, plan *domain.RosterPlan) ([]rosterStaff, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, employee_no, first_name || ' ' || last_name
		FROM staff WHERE department_id = $1::uuid AND employment_status = 'active'
		ORDER BY employee_no ASC`, plan.DepartmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	staff := []rosterStaff{}
	byID := map[string]*rosterStaff{}
	for rows.Next() {
		var st rosterStaff
		if err := rows.Scan(&st.ID, &st.EmployeeNo, &st.Name); err != nil {
			return nil, err
		}
		st.Unavailable = map[string]bool{}
		st.PrefRank = map[string]int{}
		staff = append(staff, st)
		byID[st.ID] = &staff[len(staff)-1]
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Approved leave dates within range.
	lrows, err := s.pool.Query(ctx, `
		SELECT sl.staff_id::text, g::date::text
		FROM staff_leave sl, generate_series(sl.start_date, sl.end_date, '1 day') AS g
		WHERE sl.status = 'approved' AND sl.start_date <= $2::date AND sl.end_date >= $1::date`,
		plan.StartDate, plan.EndDate)
	if err != nil {
		return nil, err
	}
	defer lrows.Close()
	for lrows.Next() {
		var staffID, date string
		if err := lrows.Scan(&staffID, &date); err != nil {
			return nil, err
		}
		if st, ok := byID[staffID]; ok {
			st.Unavailable[date] = true
		}
	}
	if err := lrows.Err(); err != nil {
		return nil, err
	}

	// Unavailability dates within range.
	urows, err := s.pool.Query(ctx, `
		SELECT staff_id::text, work_date::text FROM staff_unavailability
		WHERE work_date BETWEEN $1::date AND $2::date`, plan.StartDate, plan.EndDate)
	if err != nil {
		return nil, err
	}
	defer urows.Close()
	for urows.Next() {
		var staffID, date string
		if err := urows.Scan(&staffID, &date); err != nil {
			return nil, err
		}
		if st, ok := byID[staffID]; ok {
			st.Unavailable[date] = true
		}
	}
	if err := urows.Err(); err != nil {
		return nil, err
	}

	// Shift preferences.
	prows, err := s.pool.Query(ctx, `SELECT staff_id::text, shift_id::text, rank FROM staff_shift_preferences`)
	if err != nil {
		return nil, err
	}
	defer prows.Close()
	for prows.Next() {
		var staffID, shiftID string
		var rank int
		if err := prows.Scan(&staffID, &shiftID, &rank); err != nil {
			return nil, err
		}
		if st, ok := byID[staffID]; ok {
			st.PrefRank[shiftID] = rank
		}
	}
	if err := prows.Err(); err != nil {
		return nil, err
	}

	return staff, nil
}

type assignmentInput struct {
	StaffID  string
	ShiftID  string
	WorkDate string
}

type staffState struct {
	info        rosterStaff
	totalHours  float64
	lastDate    time.Time
	lastEndAbs  int
	consecutive int
	nightRun    int
	weekHours   map[string]float64
}

func weekKey(t time.Time) string {
	y, w := t.ISOWeek()
	return fmt.Sprintf("%04d-%02d", y, w)
}

// generateAssignments runs a deterministic greedy scheduler over the plan.
func generateAssignments(plan *domain.RosterPlan, shifts map[string]rosterShift, staff []rosterStaff) []assignmentInput {
	// Order requirements by shift start time for stable slot filling.
	reqs := make([]domain.RosterShiftRequirement, 0, len(plan.ShiftRequirements))
	for _, r := range plan.ShiftRequirements {
		if r.Required > 0 {
			if _, ok := shifts[r.ShiftID]; ok {
				reqs = append(reqs, r)
			}
		}
	}
	sort.Slice(reqs, func(i, j int) bool { return shifts[reqs[i].ShiftID].Start < shifts[reqs[j].ShiftID].Start })

	start, _ := time.Parse("2006-01-02", plan.StartDate)
	end, _ := time.Parse("2006-01-02", plan.EndDate)

	states := make([]*staffState, 0, len(staff))
	for i := range staff {
		states = append(states, &staffState{
			info:      staff[i],
			weekHours: map[string]float64{},
		})
	}

	type candidate struct {
		st              *staffState
		rank            int
		nextConsecutive int
		nextNight       int
	}

	out := make([]assignmentInput, 0)
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		ds := d.Format("2006-01-02")
		for _, req := range reqs {
			sh := shifts[req.ShiftID]
			need := req.Required

			var candidates []candidate
			for _, st := range states {
				if st.info.Unavailable[ds] {
					continue
				}
				nextConsecutive := 1
				if !st.lastDate.IsZero() && d.Equal(st.lastDate.AddDate(0, 0, 1)) {
					nextConsecutive = st.consecutive + 1
				}
				if nextConsecutive > plan.MaxConsecutiveShifts {
					continue
				}
				if !st.lastDate.IsZero() {
					// Minimum rest between the previous shift end and this start.
					rest := int(d.Sub(st.lastDate).Hours()*60) + sh.Start - st.lastEndAbs
					if rest < int(plan.MinRestHours*60) {
						continue
					}
				}
				if st.weekHours[weekKey(d)]+float64(sh.Dur)/60 > plan.MaxHoursPerWeek {
					continue
				}
				nextNight := 0
				if sh.IsNight {
					if !st.lastDate.IsZero() && d.Equal(st.lastDate.AddDate(0, 0, 1)) {
						nextNight = st.nightRun + 1
					} else {
						nextNight = 1
					}
					if nextNight > plan.MaxConsecutiveNights {
						continue
					}
				}
				rank := st.info.PrefRank[sh.ID]
				if rank == 0 {
					rank = 1 << 20 // no preference: least attractive
				}
				candidates = append(candidates, candidate{st: st, rank: rank, nextConsecutive: nextConsecutive, nextNight: nextNight})
			}
			sort.Slice(candidates, func(i, j int) bool {
				a, b := candidates[i], candidates[j]
				if a.rank != b.rank {
					return a.rank < b.rank
				}
				if a.st.totalHours != b.st.totalHours {
					return a.st.totalHours < b.st.totalHours
				}
				return a.st.info.EmployeeNo < b.st.info.EmployeeNo
			})

			for i := 0; i < need && i < len(candidates); i++ {
				c := candidates[i]
				st := c.st
				out = append(out, assignmentInput{StaffID: st.info.ID, ShiftID: sh.ID, WorkDate: ds})
				st.totalHours += float64(sh.Dur) / 60
				st.lastDate = d
				st.lastEndAbs = sh.EndAbs
				st.consecutive = c.nextConsecutive
				st.nightRun = c.nextNight
				st.weekHours[weekKey(d)] += float64(sh.Dur) / 60
			}
		}
	}
	return out
}

// generateRoster replaces a plan's assignments with a fresh generation.
func (s *Store) generateRoster(ctx context.Context, planID string) error {
	plan, err := s.getRosterPlanBase(ctx, planID)
	if err != nil {
		return err
	}
	if plan.Status != domain.RosterStatusDraft {
		return ErrRosterNotDraft
	}
	shifts, err := s.loadRosterShifts(ctx, plan)
	if err != nil {
		return err
	}
	staff, err := s.loadRosterStaff(ctx, plan)
	if err != nil {
		return err
	}
	inputs := generateAssignments(plan, shifts, staff)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, `DELETE FROM roster_assignments WHERE plan_id = $1::uuid`, planID); err != nil {
		return err
	}
	for _, in := range inputs {
		if _, err := tx.Exec(ctx, `
			INSERT INTO roster_assignments (plan_id, staff_id, shift_id, work_date)
			VALUES ($1::uuid, $2::uuid, $3::uuid, $4::date)
			ON CONFLICT (plan_id, staff_id, work_date) DO UPDATE SET shift_id = EXCLUDED.shift_id`,
			planID, in.StaffID, in.ShiftID, in.WorkDate); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE roster_plans SET version = version + 1, updated_at = now() WHERE id = $1::uuid`, planID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// RegenerateRoster regenerates a draft plan's assignments.
func (s *Store) RegenerateRoster(ctx context.Context, planID string) error {
	if err := s.generateRoster(ctx, planID); err != nil {
		return err
	}
	return nil
}

// UpsertRosterAssignment adds or moves a single assignment (draft only).
func (s *Store) UpsertRosterAssignment(ctx context.Context, planID, staffID, shiftID, workDate, createdBy string) (*domain.RosterAssignment, error) {
	plan, err := s.getRosterPlanBase(ctx, planID)
	if err != nil {
		return nil, err
	}
	if plan.Status != domain.RosterStatusDraft {
		return nil, ErrRosterNotDraft
	}
	var id string
	if err := s.pool.QueryRow(ctx, `
		INSERT INTO roster_assignments (plan_id, staff_id, shift_id, work_date, created_by)
		VALUES ($1::uuid, $2::uuid, $3::uuid, $4::date, $5::uuid)
		ON CONFLICT (plan_id, staff_id, work_date) DO UPDATE SET shift_id = EXCLUDED.shift_id
		RETURNING id::text`,
		planID, staffID, shiftID, workDate, nullableUUID(&createdBy)).Scan(&id); err != nil {
		return nil, err
	}
	a, err := scanRosterAssignment(s.pool.QueryRow(ctx, `SELECT `+rosterAssignmentCols+rosterAssignmentFrom+` WHERE ra.id = $1::uuid`, id))
	if err != nil {
		return nil, err
	}
	return a, nil
}

// DeleteRosterAssignment removes an assignment (draft only).
func (s *Store) DeleteRosterAssignment(ctx context.Context, planID, assignmentID string) error {
	plan, err := s.getRosterPlanBase(ctx, planID)
	if err != nil {
		return err
	}
	if plan.Status != domain.RosterStatusDraft {
		return ErrRosterNotDraft
	}
	ct, err := s.pool.Exec(ctx, `DELETE FROM roster_assignments WHERE id = $1::uuid AND plan_id = $2::uuid`, assignmentID, planID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// SubmitRoster moves a draft plan to submitted.
func (s *Store) SubmitRoster(ctx context.Context, planID, submittedBy string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var status string
	if err := tx.QueryRow(ctx, `SELECT status::text FROM roster_plans WHERE id = $1::uuid FOR UPDATE`, planID).
		Scan(&status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if status != domain.RosterStatusDraft {
		return ErrRosterNotDraft
	}
	if _, err := tx.Exec(ctx, `
		UPDATE roster_plans SET status = 'submitted', submitted_by = $2::uuid, submitted_at = now(), updated_at = now()
		WHERE id = $1::uuid`, planID, submittedBy); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ApproveRoster approves a submitted plan and publishes it to the active roster.
func (s *Store) ApproveRoster(ctx context.Context, planID, approvedBy string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var status string
	if err := tx.QueryRow(ctx, `SELECT status::text FROM roster_plans WHERE id = $1::uuid FOR UPDATE`, planID).
		Scan(&status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if status != domain.RosterStatusSubmitted {
		return ErrRosterNotSubmitted
	}
	if _, err := tx.Exec(ctx, `
		UPDATE roster_plans SET status = 'approved', approved_by = $2::uuid, approved_at = now(), updated_at = now()
		WHERE id = $1::uuid`, planID, approvedBy); err != nil {
		return err
	}
	// Publish assignments to the active staff_rosters table (upsert).
	if _, err := tx.Exec(ctx, `
		INSERT INTO staff_rosters (staff_id, shift_id, work_date, notes, created_by)
		SELECT ra.staff_id, ra.shift_id, ra.work_date, 'published roster', $2::uuid
		FROM roster_assignments ra WHERE ra.plan_id = $1::uuid
		ON CONFLICT (staff_id, shift_id, work_date) DO NOTHING`, planID, approvedBy); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// RejectRoster rejects a submitted plan with a reason.
func (s *Store) RejectRoster(ctx context.Context, planID, rejectedBy, reason string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var status string
	if err := tx.QueryRow(ctx, `SELECT status::text FROM roster_plans WHERE id = $1::uuid FOR UPDATE`, planID).
		Scan(&status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if status != domain.RosterStatusSubmitted {
		return ErrRosterNotSubmitted
	}
	if _, err := tx.Exec(ctx, `
		UPDATE roster_plans SET status = 'rejected', rejected_reason = $2, updated_at = now()
		WHERE id = $1::uuid`, planID, reason); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// AmendRoster creates a new draft plan copying an approved plan (amendment).
func (s *Store) AmendRoster(ctx context.Context, planID, createdBy string) (*domain.RosterPlan, error) {
	src, err := s.getRosterPlanBase(ctx, planID)
	if err != nil {
		return nil, err
	}
	if src.Status != domain.RosterStatusApproved {
		return nil, ErrRosterNotSubmitted
	}
	reqs, _ := json.Marshal(src.ShiftRequirements)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var seq int64
	if err := tx.QueryRow(ctx, `SELECT nextval('roster_plans_no_seq')`).Scan(&seq); err != nil {
		return nil, err
	}
	planNo := "RST" + lpadInt(seq, 6)

	var id string
	if err := tx.QueryRow(ctx, `
		INSERT INTO roster_plans (plan_no, name, department_id, start_date, end_date,
		                          max_hours_per_week, max_consecutive_shifts, min_rest_hours,
		                          max_consecutive_nights, shift_requirements, amended_from, created_by)
		VALUES ($1, $2, $3::uuid, $4::date, $5::date, $6, $7, $8, $9, $10::jsonb, $11::uuid, $12::uuid)
		RETURNING id::text`,
		planNo, src.Name+" (amendment)", src.DepartmentID, src.StartDate, src.EndDate,
		src.MaxHoursPerWeek, src.MaxConsecutiveShifts, src.MinRestHours,
		src.MaxConsecutiveNights, reqs, src.ID, createdBy).Scan(&id); err != nil {
		return nil, err
	}
	// Copy assignments into the new draft.
	if _, err := tx.Exec(ctx, `
		INSERT INTO roster_assignments (plan_id, staff_id, shift_id, work_date, created_by)
		SELECT $1::uuid, ra.staff_id, ra.shift_id, ra.work_date, $2::uuid
		FROM roster_assignments ra WHERE ra.plan_id = $3::uuid`,
		id, createdBy, planID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.GetRosterPlan(ctx, id)
}
