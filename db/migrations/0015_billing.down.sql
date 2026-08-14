-- Reverse of 0015_billing.up.sql.
DROP SEQUENCE IF EXISTS refunds_no_seq;
DROP TABLE IF EXISTS refunds;
DROP TABLE IF EXISTS refund_requests;
DROP SEQUENCE IF EXISTS refund_requests_no_seq;
DROP TABLE IF EXISTS receipt_shares;
DROP TABLE IF EXISTS receipts;
DROP SEQUENCE IF EXISTS receipts_no_seq;
DROP TRIGGER IF EXISTS payments_append_only ON payments;
DROP TABLE IF EXISTS payments;
DROP FUNCTION IF EXISTS payments_no_mutation();
DROP SEQUENCE IF EXISTS payments_no_seq;
DROP TABLE IF EXISTS cashier_shifts;
DROP SEQUENCE IF EXISTS cashier_shifts_no_seq;
DROP TABLE IF EXISTS invoice_items;
DROP TABLE IF EXISTS invoices;
DROP SEQUENCE IF EXISTS invoices_no_seq;
DROP TABLE IF EXISTS price_list_items;
DROP TABLE IF EXISTS price_lists;
