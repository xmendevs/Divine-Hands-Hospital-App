-- Staff workforce, attendance, clock-in/out & handover (Phase 09).

ALTER TABLE staff
    ADD COLUMN contact_phone TEXT NOT NULL DEFAULT '',
    ADD COLUMN contact_email TEXT NOT NULL DEFAULT '',
    ADD COLUMN employment_status TEXT NOT NULL DEFAULT 'active'
        CHECK (employment_status IN ('active','on_leave','terminated','suspended')),
    ADD COLUMN availability TEXT NOT NULL DEFAULT 'full_time',
    ADD COLUMN skills TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN certifications TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN hire_date DATE;

CREATE TABLE staff_leave (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    leave_type TEXT NOT NULL DEFAULT 'annual',
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    requested_by UUID NOT NULL REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_date >= start_date)
);

CREATE TABLE staff_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    late_grace_minutes INTEGER NOT NULL DEFAULT 15 CHECK (late_grace_minutes >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    shift_id UUID NOT NULL REFERENCES staff_shifts(id),
    work_date DATE NOT NULL,
    clock_in_at TIMESTAMPTZ NOT NULL,
    clock_out_at TIMESTAMPTZ,
    clock_in_method TEXT NOT NULL,
    clock_out_method TEXT,
    clock_in_device TEXT NOT NULL DEFAULT '',
    clock_out_device TEXT NOT NULL DEFAULT '',
    is_late BOOLEAN NOT NULL DEFAULT FALSE,
    is_early_leave BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'clocked_in' CHECK (status IN ('clocked_in','completed')),
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (clock_out_at IS NULL OR clock_out_at > clock_in_at)
);

-- Prevent duplicate/invalid clock-ins: at most one open record per staff, and
-- at most one record per staff per shift per day.
CREATE UNIQUE INDEX attendance_one_open_per_staff
    ON attendance_records (staff_id) WHERE clock_out_at IS NULL;
CREATE UNIQUE INDEX attendance_one_per_staff_shift_date
    ON attendance_records (staff_id, shift_id, work_date);

CREATE SEQUENCE handover_no_seq;

CREATE TABLE handover_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    handover_no TEXT NOT NULL UNIQUE,
    outgoing_staff_id UUID NOT NULL REFERENCES staff(id),
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    shift_id UUID REFERENCES staff_shifts(id) ON DELETE SET NULL,
    patients TEXT[] NOT NULL DEFAULT '{}',
    current_condition TEXT NOT NULL DEFAULT '',
    medications TEXT NOT NULL DEFAULT '',
    pending_investigations TEXT NOT NULL DEFAULT '',
    pending_orders TEXT NOT NULL DEFAULT '',
    important_observations TEXT NOT NULL DEFAULT '',
    tasks TEXT NOT NULL DEFAULT '',
    incidents TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','acknowledged')),
    created_by UUID NOT NULL REFERENCES users(id),
    acknowledged_by UUID REFERENCES users(id),
    acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
