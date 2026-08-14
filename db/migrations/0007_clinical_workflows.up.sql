-- Clinical workflows: assignments, notes, orders, MAR, observations, tasks,
-- admissions, reports, triage.

-- Patient ↔ staff assignment drives each clinician's patient queue.
CREATE TABLE patient_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    assignee_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ
);
CREATE INDEX idx_assignments_assignee ON patient_assignments (assignee_user_id) WHERE ended_at IS NULL;
CREATE INDEX idx_assignments_patient ON patient_assignments (patient_id);

-- Immutable, versioned clinical notes. A note group shares group_id; each edit
-- appends a new version. The highest version in a group is the current note.
CREATE TABLE clinical_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    note_type TEXT NOT NULL CHECK (note_type IN ('consultation','nursing','progress')),
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    author_role TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL,
    diagnosis TEXT NOT NULL DEFAULT '',
    treatment_plan TEXT NOT NULL DEFAULT '',
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notes_group ON clinical_notes (group_id);
CREATE INDEX idx_notes_patient ON clinical_notes (patient_id, created_at DESC);
CREATE UNIQUE INDEX idx_notes_group_version ON clinical_notes (group_id, version);

-- Unified doctor orders with a shared lifecycle:
-- draft → submitted → accepted → in_progress → completed | cancelled.
CREATE SEQUENCE orders_no_seq START 1;
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_no TEXT NOT NULL UNIQUE,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    order_type TEXT NOT NULL CHECK (order_type IN ('prescription','lab_request','nursing_order','referral')),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','submitted','accepted','in_progress','completed','cancelled')),
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    ordered_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    details JSONB NOT NULL DEFAULT '{}',
    clinical_note_id UUID REFERENCES clinical_notes(id) ON DELETE SET NULL,
    acted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
    cancel_reason TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    submitted_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_patient ON orders (patient_id, created_at DESC);
CREATE INDEX idx_orders_status ON orders (status);
CREATE INDEX idx_orders_ordered_by ON orders (ordered_by);

-- Medication administration records (nurse administered). Dispensing is
-- recorded by the pharmacy service in a later phase.
CREATE TABLE medication_administrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    medication TEXT NOT NULL,
    dose TEXT NOT NULL DEFAULT '',
    route TEXT NOT NULL DEFAULT '',
    administered_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    administered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mar_order ON medication_administrations (order_id);
CREATE INDEX idx_mar_patient ON medication_administrations (patient_id, administered_at DESC);

-- Patient observations and vitals (hospital-configurable measurements).
CREATE TABLE patient_observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    category TEXT NOT NULL DEFAULT 'vitals' CHECK (category IN ('vitals','observation')),
    measurements JSONB NOT NULL DEFAULT '{}',
    notes TEXT NOT NULL DEFAULT '',
    recorded_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_obs_patient ON patient_observations (patient_id, recorded_at DESC);

-- Department tasks (nursing orders may auto-create a task).
CREATE TABLE department_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','in_progress','completed','cancelled')),
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    completed_by UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_tasks_status ON department_tasks (status);
CREATE INDEX idx_tasks_patient ON department_tasks (patient_id);

-- Admissions: ward, room, bed, attending doctor, diagnosis, discharge.
CREATE TABLE admissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    ward TEXT NOT NULL DEFAULT '',
    room TEXT NOT NULL DEFAULT '',
    bed TEXT NOT NULL DEFAULT '',
    admitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attending_doctor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    admission_reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'admitted' CHECK (status IN ('admitted','discharged')),
    discharged_at TIMESTAMPTZ,
    discharge_summary TEXT NOT NULL DEFAULT '',
    follow_up_instructions TEXT NOT NULL DEFAULT '',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_admissions_patient ON admissions (patient_id, admitted_at DESC);
-- At most one active admission per patient.
CREATE UNIQUE INDEX idx_admissions_active ON admissions (patient_id) WHERE status = 'admitted';

-- Clinical reports.
CREATE TABLE clinical_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    report_type TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reports_patient ON clinical_reports (patient_id, created_at DESC);

-- Emergency triage records.
CREATE TABLE triage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    triage_level TEXT NOT NULL DEFAULT '',
    chief_complaint TEXT NOT NULL DEFAULT '',
    measurements JSONB NOT NULL DEFAULT '{}',
    triaged_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_triage_patient ON triage (patient_id, created_at DESC);
