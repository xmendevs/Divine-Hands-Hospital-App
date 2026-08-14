-- Reverse of 0013_lab.up.sql.
DROP TABLE IF EXISTS lab_critical_notifications;
DROP TABLE IF EXISTS lab_specimen_events;
ALTER TABLE IF EXISTS lab_request_items DROP CONSTRAINT IF EXISTS lab_request_items_specimen_id_fkey;
DROP TABLE IF EXISTS lab_specimens;
DROP TABLE IF EXISTS lab_request_items;
DROP TABLE IF EXISTS lab_requests;
DROP TABLE IF EXISTS lab_tests;
DROP TABLE IF EXISTS lab_clients;
DROP SEQUENCE IF EXISTS lab_specimens_no_seq;
DROP SEQUENCE IF EXISTS lab_requests_no_seq;
DROP SEQUENCE IF EXISTS lab_clients_no_seq;
