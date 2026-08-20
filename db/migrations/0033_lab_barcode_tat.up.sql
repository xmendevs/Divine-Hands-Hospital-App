-- Lab & Pathology upgrade (Fix #8):
-- 1. Barcode specimen accessioning: unique machine-readable barcode per
--    specimen plus the pre-analytical origin location (ward / OPD).
-- 2. Instrument / analyzer integration: analyser registry + append-only
--    interface log queue for HL7-style inbound/outbound messages.

-- Barcode column on lab_specimens. The barcode is a compact Code128-style
-- alphanumeric generated at collection time (unique per specimen).
ALTER TABLE lab_specimens
    ADD COLUMN barcode TEXT NOT NULL DEFAULT '',
    ADD COLUMN origin_location TEXT NOT NULL DEFAULT '';

-- Unique barcode (empty string is never generated; specimens without a
-- barcode (legacy rows) are allowed to share the default '').
CREATE UNIQUE INDEX idx_lab_specimens_barcode ON lab_specimens (barcode) WHERE barcode <> '';

-- Analyzer / instrument registry (integration-ready for clinical chemistry
-- and haematology analysers).
CREATE TABLE lab_instruments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    instrument_type TEXT NOT NULL DEFAULT 'chemistry'
        CHECK (instrument_type IN ('chemistry','haematology','immunology','microbiology','coagulation','urinalysis','other')),
    manufacturer TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'offline'
        CHECK (status IN ('online','offline','maintenance','retired')),
    last_connected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only interface log queue: one row per inbound/outbound message
-- exchanged with an analyser (order download, sample query, result upload,
-- acknowledgement). Queued rows with status 'queued' act as the outbound
-- queue; inbound results arrive as 'received' and are processed by the
-- result entry workflow.
CREATE TABLE lab_instrument_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instrument_id UUID NOT NULL REFERENCES lab_instruments(id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
    message_type TEXT NOT NULL CHECK (message_type IN ('order','sample','result','query','ack','error')),
    payload JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','received','processed','failed')),
    error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ
);
CREATE INDEX idx_lab_instrument_logs_instrument ON lab_instrument_logs (instrument_id, created_at DESC);
CREATE INDEX idx_lab_instrument_logs_status ON lab_instrument_logs (status);
