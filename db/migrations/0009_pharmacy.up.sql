-- Pharmacy: medicine master, batch inventory, stock movements, dispensing,
-- adjustments + reusable approval requests, stock counts.

-- Medicine master.
CREATE SEQUENCE medicines_no_seq START 1;
CREATE TABLE medicines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    generic_name TEXT NOT NULL,
    brand TEXT NOT NULL DEFAULT '',
    strength TEXT NOT NULL DEFAULT '',
    dosage_form TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    supplier TEXT NOT NULL DEFAULT '',
    reorder_level NUMERIC(12,2) NOT NULL DEFAULT 0,
    storage_location TEXT NOT NULL DEFAULT '',
    unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
    selling_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_medicines_active ON medicines (active);
CREATE INDEX idx_medicines_name ON medicines (generic_name);

-- Batch inventory.
CREATE TABLE medicine_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medicine_id UUID NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
    batch_number TEXT NOT NULL,
    manufacturing_date DATE,
    expiry_date DATE,
    quantity_on_hand NUMERIC(12,2) NOT NULL DEFAULT 0,
    purchase_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
    selling_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    supplier TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','quarantined')),
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (medicine_id, batch_number)
);
CREATE INDEX idx_batches_medicine ON medicine_batches (medicine_id);
CREATE INDEX idx_batches_expiry ON medicine_batches (expiry_date);

-- Every stock movement: user, time, medicine, batch, before/after, reason, ref.
CREATE TABLE stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medicine_id UUID NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
    batch_id UUID REFERENCES medicine_batches(id) ON DELETE CASCADE,
    movement_type TEXT NOT NULL CHECK (movement_type IN (
        'receipt','dispense','return','adjustment','damage',
        'transfer_in','transfer_out','count_variance'
    )),
    quantity NUMERIC(12,2) NOT NULL,
    quantity_before NUMERIC(12,2) NOT NULL,
    quantity_after NUMERIC(12,2) NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    reference_type TEXT NOT NULL DEFAULT '',
    reference_id UUID,
    performed_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_movements_medicine ON stock_movements (medicine_id, created_at DESC);
CREATE INDEX idx_movements_batch ON stock_movements (batch_id);

-- Reusable approval requests (used now for stock adjustments; later for
-- roster, billing reversals, etc.).
CREATE TABLE approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_type TEXT NOT NULL,
    subject_id UUID NOT NULL,
    action TEXT NOT NULL DEFAULT '',
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    details JSONB NOT NULL DEFAULT '{}',
    reason TEXT NOT NULL DEFAULT '',
    decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_approvals_status ON approval_requests (status);
CREATE INDEX idx_approvals_subject ON approval_requests (subject_type, subject_id);

-- Stock adjustments (signed deltas) that may require approval.
CREATE TABLE stock_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medicine_id UUID NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
    batch_id UUID NOT NULL REFERENCES medicine_batches(id) ON DELETE CASCADE,
    quantity NUMERIC(12,2) NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    approval_request_id UUID REFERENCES approval_requests(id) ON DELETE SET NULL,
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_adjustments_status ON stock_adjustments (status);

-- Dispensing transactions (header + line items). One dispensation per
-- prescription order (single fill).
CREATE SEQUENCE dispensations_no_seq START 1;
CREATE TABLE dispensations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispensation_no TEXT NOT NULL UNIQUE,
    prescription_order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    dispensed_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_disp_patient ON dispensations (patient_id, created_at DESC);
CREATE UNIQUE INDEX idx_disp_order ON dispensations (prescription_order_id);

CREATE TABLE dispensation_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispensation_id UUID NOT NULL REFERENCES dispensations(id) ON DELETE CASCADE,
    medicine_id UUID NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
    batch_id UUID NOT NULL REFERENCES medicine_batches(id) ON DELETE CASCADE,
    quantity NUMERIC(12,2) NOT NULL,
    unit_price NUMERIC(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX idx_disp_items_disp ON dispensation_items (dispensation_id);

-- Stock counts: physical count vs system quantity, with variance.
CREATE TABLE stock_counts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medicine_id UUID NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
    batch_id UUID NOT NULL REFERENCES medicine_batches(id) ON DELETE CASCADE,
    system_quantity NUMERIC(12,2) NOT NULL,
    counted_quantity NUMERIC(12,2) NOT NULL,
    variance NUMERIC(12,2) NOT NULL,
    counted_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_counts_batch ON stock_counts (batch_id, created_at DESC);
