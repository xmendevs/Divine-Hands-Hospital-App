-- Reverse of 0009_pharmacy.up.sql.
DROP TABLE IF EXISTS stock_counts;
DROP TABLE IF EXISTS dispensation_items;
DROP TABLE IF EXISTS dispensations;
DROP TABLE IF EXISTS stock_adjustments;
DROP TABLE IF EXISTS approval_requests;
DROP TABLE IF EXISTS stock_movements;
DROP TABLE IF EXISTS medicine_batches;
DROP TABLE IF EXISTS medicines;
DROP SEQUENCE IF EXISTS dispensations_no_seq;
DROP SEQUENCE IF EXISTS medicines_no_seq;
