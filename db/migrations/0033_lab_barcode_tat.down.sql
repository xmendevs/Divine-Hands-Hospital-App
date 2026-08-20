DROP TABLE IF EXISTS lab_instrument_logs;
DROP TABLE IF EXISTS lab_instruments;

DROP INDEX IF EXISTS idx_lab_specimens_barcode;
ALTER TABLE lab_specimens
    DROP COLUMN IF EXISTS barcode,
    DROP COLUMN IF EXISTS origin_location;
