-- General inventory: asset categories, assets, auditable movements, transfers,
-- status history, stock counts, service providers, and maintenance.

-- Asset categories. `tracking` decides how an asset is counted:
--   unit     — one unique item (instrument, equipment; serial-numbered)
--   quantity — pooled consumable stock (PPE, ward/cleaning/office supplies)
CREATE TABLE asset_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    tracking TEXT NOT NULL CHECK (tracking IN ('unit','quantity')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO asset_categories (code, name, tracking) VALUES
    ('instruments', 'Instruments', 'unit'),
    ('medical_equipment', 'Medical equipment', 'unit'),
    ('consumables', 'Consumables', 'quantity'),
    ('ppe', 'PPE', 'quantity'),
    ('ward_supplies', 'Ward supplies', 'quantity'),
    ('cleaning_supplies', 'Cleaning supplies', 'quantity'),
    ('office_supplies', 'Office supplies', 'quantity');

-- Asset master. asset_no is the human-readable business ID (AST000001).
CREATE SEQUENCE assets_no_seq START 1;
CREATE TABLE assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_no TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category_id UUID NOT NULL REFERENCES asset_categories(id) ON DELETE RESTRICT,
    tracking TEXT NOT NULL CHECK (tracking IN ('unit','quantity')),
    serial_number TEXT NOT NULL DEFAULT '',
    manufacturer TEXT NOT NULL DEFAULT '',
    supplier TEXT NOT NULL DEFAULT '',
    purchase_date DATE,
    cost NUMERIC(14,2) NOT NULL DEFAULT 0,
    location TEXT NOT NULL DEFAULT '',
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    custodian_id UUID REFERENCES users(id) ON DELETE SET NULL,
    condition TEXT NOT NULL DEFAULT 'good' CHECK (condition IN ('new','good','fair','poor')),
    warranty_expiry DATE,
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN (
        'available','in_use','under_maintenance','damaged','lost','disposed'
    )),
    quantity_on_hand NUMERIC(12,2) NOT NULL DEFAULT 1,
    notes TEXT NOT NULL DEFAULT '',
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (tracking = 'unit' OR quantity_on_hand >= 0),
    CHECK (tracking = 'quantity' OR quantity_on_hand = 1)
);
CREATE INDEX idx_assets_category ON assets (category_id);
CREATE INDEX idx_assets_status ON assets (status);
CREATE INDEX idx_assets_department ON assets (department_id);
CREATE INDEX idx_assets_name ON assets (name);

-- Append-only asset movement ledger (same principles as stock_movements).
CREATE TABLE asset_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    movement_type TEXT NOT NULL CHECK (movement_type IN (
        'receipt','adjustment','count_variance','transfer_in','transfer_out','dispose'
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
CREATE INDEX idx_asset_movements_asset ON asset_movements (asset_id, created_at DESC);

-- Transfers: relocation and/or reassignment of custody, recorded explicitly.
CREATE TABLE asset_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    quantity NUMERIC(12,2) NOT NULL DEFAULT 1,
    from_department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    to_department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    from_location TEXT NOT NULL DEFAULT '',
    to_location TEXT NOT NULL DEFAULT '',
    from_custodian_id UUID REFERENCES users(id) ON DELETE SET NULL,
    to_custodian_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reason TEXT NOT NULL DEFAULT '',
    transferred_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_asset_transfers_asset ON asset_transfers (asset_id, created_at DESC);

-- Append-only status history: loss/damage/disposal is always attributable.
CREATE TABLE asset_status_changes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    from_status TEXT NOT NULL,
    to_status TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    changed_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_asset_status_changes_asset ON asset_status_changes (asset_id, created_at DESC);

-- Physical stock counts for quantity-tracked assets, with variance.
CREATE TABLE asset_stock_counts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    system_quantity NUMERIC(12,2) NOT NULL,
    counted_quantity NUMERIC(12,2) NOT NULL,
    variance NUMERIC(12,2) NOT NULL,
    counted_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_asset_counts_asset ON asset_stock_counts (asset_id, created_at DESC);

-- Maintenance service providers.
CREATE TABLE service_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    contact_phone TEXT NOT NULL DEFAULT '',
    contact_email TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recurring maintenance schedules: next_service_date is advanced when a
-- maintenance record is completed against the schedule.
CREATE TABLE maintenance_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    service_type TEXT NOT NULL,
    frequency_days INTEGER NOT NULL CHECK (frequency_days > 0),
    next_service_date DATE NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_maint_schedules_due ON maintenance_schedules (next_service_date);

-- Completed maintenance work: provider, downtime, cost, next service date.
CREATE TABLE maintenance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    schedule_id UUID REFERENCES maintenance_schedules(id) ON DELETE SET NULL,
    service_provider_id UUID REFERENCES service_providers(id) ON DELETE SET NULL,
    service_type TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    service_date DATE NOT NULL DEFAULT CURRENT_DATE,
    downtime_hours NUMERIC(6,2) NOT NULL DEFAULT 0,
    cost NUMERIC(14,2) NOT NULL DEFAULT 0,
    next_service_date DATE,
    performed_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_maint_records_asset ON maintenance_records (asset_id, service_date DESC);
