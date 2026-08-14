-- Reverse of 0011_general_inventory.up.sql.
DROP TABLE IF EXISTS maintenance_records;
DROP TABLE IF EXISTS maintenance_schedules;
DROP TABLE IF EXISTS service_providers;
DROP TABLE IF EXISTS asset_stock_counts;
DROP TABLE IF EXISTS asset_status_changes;
DROP TABLE IF EXISTS asset_transfers;
DROP TABLE IF EXISTS asset_movements;
DROP TABLE IF EXISTS assets;
DROP SEQUENCE IF EXISTS assets_no_seq;
DROP TABLE IF EXISTS asset_categories;
