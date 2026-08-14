-- Staff rosters: schedule staff to shifts so missed shifts are identifiable (Phase 09).
CREATE TABLE staff_rosters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    shift_id UUID NOT NULL REFERENCES staff_shifts(id) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (staff_id, shift_id, work_date)
);
