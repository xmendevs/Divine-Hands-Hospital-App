-- Automatic roster planning & approval (Phase 10).

ALTER TABLE staff_shifts ADD COLUMN is_night BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE staff_unavailability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (staff_id, work_date)
);

CREATE TABLE staff_shift_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    shift_id UUID NOT NULL REFERENCES staff_shifts(id) ON DELETE CASCADE,
    rank INTEGER NOT NULL CHECK (rank >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (staff_id, shift_id)
);

CREATE SEQUENCE roster_plans_no_seq;

CREATE TABLE roster_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_no TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    department_id UUID NOT NULL REFERENCES departments(id),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    max_hours_per_week NUMERIC(6,2) NOT NULL DEFAULT 40,
    max_consecutive_shifts INTEGER NOT NULL DEFAULT 6,
    min_rest_hours NUMERIC(6,2) NOT NULL DEFAULT 11,
    max_consecutive_nights INTEGER NOT NULL DEFAULT 3,
    shift_requirements JSONB NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected')),
    version INTEGER NOT NULL DEFAULT 1,
    amended_from UUID REFERENCES roster_plans(id),
    created_by UUID NOT NULL REFERENCES users(id),
    submitted_by UUID REFERENCES users(id),
    submitted_at TIMESTAMPTZ,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    rejected_reason TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_date >= start_date)
);

-- A staff member may hold at most one assignment per date within a plan,
-- which prevents conflicting shifts.
CREATE TABLE roster_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES roster_plans(id) ON DELETE CASCADE,
    staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    shift_id UUID NOT NULL REFERENCES staff_shifts(id) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (plan_id, staff_id, work_date)
);
