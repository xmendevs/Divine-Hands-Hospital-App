-- License keys gate access to the desktop client. The hospital issues keys
-- and hands them to authorized staff; the desktop app presents the key at
-- login and the API validates it. If no license keys exist, licensing is
-- disabled (backwards compatible) - see store.ValidateLicense.
CREATE TABLE license_keys (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key        TEXT NOT NULL UNIQUE,
    label      TEXT NOT NULL DEFAULT '',
    active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
