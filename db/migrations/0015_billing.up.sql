-- Billing: price lists, invoices, payments, receipts, refunds, cashier shifts (Phase 08).
-- Money is stored as NUMERIC(12,2) and totals are computed in SQL, never in floating point.

CREATE TABLE price_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'NGN',
    description TEXT NOT NULL DEFAULT '',
    valid_from DATE,
    valid_to DATE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE price_list_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    price_list_id UUID NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    unit TEXT NOT NULL DEFAULT 'unit',
    price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (price_list_id, code)
);

CREATE SEQUENCE invoices_no_seq;

CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_no TEXT NOT NULL UNIQUE,
    patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
    price_list_id UUID REFERENCES price_lists(id),
    currency TEXT NOT NULL DEFAULT 'NGN',
    bill_to TEXT NOT NULL DEFAULT 'patient' CHECK (bill_to IN ('patient','insurance','corporate')),
    payer_name TEXT NOT NULL DEFAULT '',
    policy_number TEXT NOT NULL DEFAULT '',
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','partially_paid','paid','voided')),
    issued_by UUID REFERENCES users(id),
    issued_at TIMESTAMPTZ,
    void_reason TEXT NOT NULL DEFAULT '',
    voided_by UUID REFERENCES users(id),
    voided_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    price_list_item_id UUID REFERENCES price_list_items(id),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT 'unit',
    quantity NUMERIC(12,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price NUMERIC(12,2) NOT NULL,
    tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
    line_total NUMERIC(12,2) NOT NULL,
    tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE cashier_shifts_no_seq;

CREATE TABLE cashier_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_no TEXT NOT NULL UNIQUE,
    cashier_id UUID NOT NULL REFERENCES users(id),
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ,
    opening_cash NUMERIC(12,2) NOT NULL DEFAULT 0,
    closing_cash NUMERIC(12,2),
    expected_cash NUMERIC(12,2),
    variance NUMERIC(12,2),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE payments_no_seq;

-- Payments are append-only: posted transactions are reversed through refunds,
-- never updated or deleted.
CREATE FUNCTION payments_no_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'payments are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_no TEXT NOT NULL UNIQUE,
    invoice_id UUID NOT NULL REFERENCES invoices(id),
    patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
    shift_id UUID REFERENCES cashier_shifts(id) ON DELETE SET NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    method TEXT NOT NULL,
    reference TEXT NOT NULL DEFAULT '',
    received_by UUID NOT NULL REFERENCES users(id),
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER payments_append_only
    BEFORE UPDATE OR DELETE ON payments
    FOR EACH ROW EXECUTE FUNCTION payments_no_mutation();

CREATE SEQUENCE receipts_no_seq;

CREATE TABLE receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_no TEXT NOT NULL UNIQUE,
    payment_id UUID NOT NULL REFERENCES payments(id),
    invoice_id UUID NOT NULL REFERENCES invoices(id),
    patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
    amount NUMERIC(12,2) NOT NULL,
    method TEXT NOT NULL,
    reference TEXT NOT NULL DEFAULT '',
    issued_by UUID NOT NULL REFERENCES users(id),
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE receipt_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    share_via TEXT NOT NULL CHECK (share_via IN ('email','whatsapp')),
    recipient TEXT NOT NULL,
    shared_by UUID NOT NULL REFERENCES users(id),
    shared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE refund_requests_no_seq;

CREATE TABLE refund_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    refund_no TEXT NOT NULL UNIQUE,
    payment_id UUID NOT NULL REFERENCES payments(id),
    invoice_id UUID NOT NULL REFERENCES invoices(id),
    patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','processed')),
    requested_by UUID NOT NULL REFERENCES users(id),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT NOT NULL DEFAULT '',
    processed_by UUID REFERENCES users(id),
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    refund_no TEXT NOT NULL UNIQUE,
    refund_request_id UUID NOT NULL REFERENCES refund_requests(id),
    payment_id UUID NOT NULL REFERENCES payments(id),
    invoice_id UUID NOT NULL REFERENCES invoices(id),
    patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
    shift_id UUID REFERENCES cashier_shifts(id) ON DELETE SET NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    reason TEXT NOT NULL,
    processed_by UUID NOT NULL REFERENCES users(id),
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE refunds_no_seq;

-- Default price list with starter services, so billing works out of the box.
INSERT INTO price_lists (name, currency, description, status) VALUES
    ('Standard', 'NGN', 'Default hospital price list', 'active');

INSERT INTO price_list_items (price_list_id, code, name, category, unit, price, tax_rate)
SELECT id, 'CON-OFFICE', 'Consultation (Outpatient)', 'consultation', 'visit', 10000, 0 FROM price_lists WHERE name = 'Standard'
UNION ALL SELECT id, 'CON-ANC', 'Antenatal Consultation', 'consultation', 'visit', 15000, 0 FROM price_lists WHERE name = 'Standard'
UNION ALL SELECT id, 'LAB-FBC', 'Full Blood Count', 'laboratory', 'test', 5000, 0 FROM price_lists WHERE name = 'Standard'
UNION ALL SELECT id, 'PHARM-DISP', 'Pharmacy Dispensing Fee', 'pharmacy', 'unit', 1000, 0 FROM price_lists WHERE name = 'Standard'
UNION ALL SELECT id, 'WARD-STD', 'Standard Ward Stay (per night)', 'accommodation', 'night', 25000, 0 FROM price_lists WHERE name = 'Standard';
