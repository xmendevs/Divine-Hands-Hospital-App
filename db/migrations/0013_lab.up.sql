-- Laboratory information system: lab clients, test catalogue, requests,
-- specimens with chain of custody, structured results, critical results.

-- External / referral lab clients carry their own identifier (LBC000001) and a
-- complete demographic record. Hospital patients reference the patients table.
CREATE SEQUENCE lab_clients_no_seq START 1;
CREATE TABLE lab_clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_no TEXT NOT NULL UNIQUE,
    client_type TEXT NOT NULL CHECK (client_type IN ('external','referral')),
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL DEFAULT '',
    gender TEXT NOT NULL DEFAULT '',
    date_of_birth DATE,
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    address_line1 TEXT NOT NULL DEFAULT '',
    address_line2 TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    referring_facility TEXT NOT NULL DEFAULT '',
    referring_physician TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lab_clients_name ON lab_clients (last_name, first_name);

-- Test catalogue. verification_required marks high-risk tests whose results
-- must be verified by a different user than the one entering them.
CREATE TABLE lab_tests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    price NUMERIC(12,2) NOT NULL DEFAULT 0,
    specimen_type TEXT NOT NULL DEFAULT '',
    container TEXT NOT NULL DEFAULT '',
    turnaround_minutes INTEGER NOT NULL DEFAULT 60,
    units TEXT NOT NULL DEFAULT '',
    reference_ranges JSONB NOT NULL DEFAULT '{}',
    verification_required BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lab_tests_active ON lab_tests (active);

-- Lab requests: REQUESTED → PAYMENT/PREAUTH → SPECIMEN_COLLECTED → RECEIVED →
-- PROCESSING → RESULT_ENTERED → VERIFIED → RELEASED (or CANCELLED).
CREATE SEQUENCE lab_requests_no_seq START 1;
CREATE TABLE lab_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_no TEXT NOT NULL UNIQUE,
    patient_id UUID REFERENCES patients(id) ON DELETE RESTRICT,
    client_id UUID REFERENCES lab_clients(id) ON DELETE RESTRICT,
    ordered_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    priority TEXT NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine','urgent','stat')),
    clinical_notes TEXT NOT NULL DEFAULT '',
    payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','preauthorized','paid','waived')),
    status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN (
        'requested','payment','specimen_collected','received','processing',
        'result_entered','verified','released','cancelled'
    )),
    cancel_reason TEXT NOT NULL DEFAULT '',
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    released_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((patient_id IS NOT NULL) <> (client_id IS NOT NULL))
);
CREATE INDEX idx_lab_requests_status ON lab_requests (status);
CREATE INDEX idx_lab_requests_patient ON lab_requests (patient_id);
CREATE INDEX idx_lab_requests_client ON lab_requests (client_id);

-- Request line items: one per test, with the price snapshot and structured
-- result. specimen_id is added after lab_specimens exists.
CREATE TABLE lab_request_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES lab_requests(id) ON DELETE CASCADE,
    test_id UUID NOT NULL REFERENCES lab_tests(id) ON DELETE RESTRICT,
    price NUMERIC(12,2) NOT NULL DEFAULT 0,
    result_value JSONB NOT NULL DEFAULT '{}',
    result_text TEXT NOT NULL DEFAULT '',
    critical BOOLEAN NOT NULL DEFAULT FALSE,
    result_entered_by UUID REFERENCES users(id) ON DELETE SET NULL,
    result_entered_at TIMESTAMPTZ,
    result_verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
    result_verified_at TIMESTAMPTZ,
    UNIQUE (request_id, test_id)
);
CREATE INDEX idx_lab_items_request ON lab_request_items (request_id);

-- Specimens with chain of custody: collector, receiver, condition, storage.
CREATE SEQUENCE lab_specimens_no_seq START 1;
CREATE TABLE lab_specimens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    specimen_no TEXT NOT NULL UNIQUE,
    request_id UUID NOT NULL REFERENCES lab_requests(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES lab_request_items(id) ON DELETE CASCADE,
    specimen_type TEXT NOT NULL,
    collected_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    received_by UUID REFERENCES users(id) ON DELETE SET NULL,
    received_at TIMESTAMPTZ,
    condition TEXT NOT NULL DEFAULT '',
    storage_location TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'collected' CHECK (status IN ('collected','received','rejected')),
    rejection_reason TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lab_specimens_request ON lab_specimens (request_id);
CREATE INDEX idx_lab_specimens_item ON lab_specimens (item_id);

-- Wire the circular item ↔ specimen reference.
ALTER TABLE lab_request_items
    ADD COLUMN specimen_id UUID REFERENCES lab_specimens(id) ON DELETE SET NULL;

-- Append-only chain-of-custody events per specimen.
CREATE TABLE lab_specimen_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    specimen_id UUID NOT NULL REFERENCES lab_specimens(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('collected','received','stored','transferred','rejected')),
    actor UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lab_spec_events_spec ON lab_specimen_events (specimen_id, created_at DESC);

-- Critical results: controlled notification to the responsible clinician with
-- optional acknowledgement.
CREATE TABLE lab_critical_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES lab_request_items(id) ON DELETE CASCADE,
    request_id UUID NOT NULL REFERENCES lab_requests(id) ON DELETE CASCADE,
    patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
    client_id UUID REFERENCES lab_clients(id) ON DELETE SET NULL,
    notified_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    notified_to_name TEXT NOT NULL DEFAULT '',
    notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
    acknowledged_at TIMESTAMPTZ,
    acknowledgement_notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','acknowledged')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lab_critical_status ON lab_critical_notifications (status);
