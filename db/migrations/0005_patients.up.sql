-- Patient master record: families, patients, clinical entries, amendments,
-- timeline, documents, and transactional business-ID generation.

-- Counters for human-readable business IDs, one row per prefix.
-- Normal DHH, Family DHHF, Antenatal DHHA, Emergency DHHE.
CREATE TABLE patient_id_counters (
    prefix TEXT PRIMARY KEY,
    last_value BIGINT NOT NULL DEFAULT 0
);
INSERT INTO patient_id_counters (prefix) VALUES ('DHH'), ('DHHF'), ('DHHA'), ('DHHE');

-- Atomically increment a counter and return the formatted business ID.
-- The row lock on patient_id_counters serializes concurrent registrations so a
-- business ID is generated transactionally and never duplicated.
CREATE FUNCTION next_patient_id(p_prefix TEXT) RETURNS TEXT AS $$
DECLARE
    v_seq BIGINT;
BEGIN
    UPDATE patient_id_counters
       SET last_value = last_value + 1
     WHERE prefix = p_prefix
    RETURNING last_value INTO v_seq;

    IF v_seq IS NULL THEN
        RAISE EXCEPTION 'unknown patient id prefix: %', p_prefix;
    END IF;

    RETURN p_prefix || lpad(v_seq::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

CREATE TABLE families (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_no TEXT NOT NULL UNIQUE,
    family_name TEXT NOT NULL DEFAULT '',
    head_patient_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE patient_registration_type AS ENUM ('normal', 'antenatal', 'emergency');
CREATE TYPE patient_status AS ENUM ('active', 'inactive', 'deceased', 'merged');

CREATE TABLE patients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_no TEXT NOT NULL UNIQUE,
    registration_type patient_registration_type NOT NULL,
    family_id UUID REFERENCES families(id) ON DELETE SET NULL,

    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    middle_name TEXT NOT NULL DEFAULT '',
    gender TEXT NOT NULL DEFAULT '',
    date_of_birth DATE,
    blood_group TEXT NOT NULL DEFAULT '',
    genotype TEXT NOT NULL DEFAULT '',
    marital_status TEXT NOT NULL DEFAULT '',
    occupation TEXT NOT NULL DEFAULT '',

    phone TEXT NOT NULL DEFAULT '',
    alternate_phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    address_line1 TEXT NOT NULL DEFAULT '',
    address_line2 TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT '',
    postal_code TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',

    identification_type TEXT NOT NULL DEFAULT '',
    identification_number TEXT NOT NULL DEFAULT '',

    next_of_kin_name TEXT NOT NULL DEFAULT '',
    next_of_kin_relationship TEXT NOT NULL DEFAULT '',
    next_of_kin_phone TEXT NOT NULL DEFAULT '',

    consent_given BOOLEAN NOT NULL DEFAULT FALSE,
    consent_date TIMESTAMPTZ,
    privacy_notes TEXT NOT NULL DEFAULT '',

    status patient_status NOT NULL DEFAULT 'active',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_patients_name ON patients (last_name, first_name);
CREATE INDEX idx_patients_dob ON patients (date_of_birth);
CREATE INDEX idx_patients_phone ON patients (phone);
CREATE INDEX idx_patients_ident ON patients (identification_number);
-- Hard duplicate safeguard: a non-empty identification number is unique.
CREATE UNIQUE INDEX idx_patients_ident_unique
    ON patients (identification_number) WHERE identification_number <> '';

ALTER TABLE families ADD CONSTRAINT families_head_patient_fk
    FOREIGN KEY (head_patient_id) REFERENCES patients(id) ON DELETE SET NULL;

-- Clinical sections are append-oriented; corrections go through
-- patient_amendments (never silent overwrites).
CREATE TABLE patient_clinical_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    section TEXT NOT NULL CHECK (section IN (
        'allergy','medical_history','surgical_history','chronic_condition',
        'medication','family_history','social_history'
    )),
    summary TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}',
    recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_clinical_patient ON patient_clinical_entries (patient_id, section);

-- Append-only amendment/correction records capturing before/after values.
CREATE TABLE patient_amendments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    section TEXT NOT NULL,
    entry_id UUID REFERENCES patient_clinical_entries(id) ON DELETE SET NULL,
    field_name TEXT NOT NULL DEFAULT '',
    previous_value JSONB NOT NULL DEFAULT 'null',
    new_value JSONB NOT NULL DEFAULT 'null',
    reason TEXT NOT NULL,
    amended_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_amendments_patient ON patient_amendments (patient_id);

-- Major events in the patient's journey. Later phases append visits, vitals,
-- notes, orders, prescriptions, lab activity, and billing events here.
CREATE TABLE patient_timeline (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL DEFAULT '{}',
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_timeline_patient ON patient_timeline (patient_id, occurred_at DESC);

-- Document metadata. Binary upload lands with the object-storage phase.
CREATE TABLE patient_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    file_name TEXT NOT NULL DEFAULT '',
    content_type TEXT NOT NULL DEFAULT '',
    file_size BIGINT NOT NULL DEFAULT 0,
    storage_key TEXT NOT NULL DEFAULT '',
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_documents_patient ON patient_documents (patient_id);
