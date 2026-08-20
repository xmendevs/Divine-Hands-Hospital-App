-- Lab consumables: reagents, test kits, collection materials, PPE, glassware.
-- Separate from pharmacy medicines; tracks lab-specific stock with batch/lot
-- numbers, packaging units, storage locations, and reorder thresholds.

CREATE SEQUENCE lab_consumables_no_seq START 1;

CREATE TABLE lab_consumables (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_code       TEXT NOT NULL UNIQUE,          -- e.g. LAB-CON-001
    name            TEXT NOT NULL,                 -- e.g. EDTA Vacutainer Tubes
    category        TEXT NOT NULL DEFAULT '',       -- Phlebotomy, Reagents, Consumables & PPE, Glassware
    packaging_unit  TEXT NOT NULL DEFAULT '',       -- Box of 100, Pack of 50, Kit, Vial, Carton
    batch_lot_number TEXT NOT NULL DEFAULT '',      -- Manufacturer lot reference
    reorder_level   NUMERIC(12,2) NOT NULL DEFAULT 0,
    unit_cost       NUMERIC(12,2) NOT NULL DEFAULT 0,
    quantity_on_hand NUMERIC(12,2) NOT NULL DEFAULT 0,
    storage_location TEXT NOT NULL DEFAULT '',      -- Main Lab, Cold Storage Room, etc.
    supplier        TEXT NOT NULL DEFAULT '',
    expiry_date     DATE,                          -- Optional; for reagents/kits
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    notes           TEXT NOT NULL DEFAULT '',
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lab_consumables_category ON lab_consumables (category);
CREATE INDEX idx_lab_consumables_name ON lab_consumables (name);
