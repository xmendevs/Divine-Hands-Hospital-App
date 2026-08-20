-- Restore the original order type constraint.
ALTER TABLE orders DROP CONSTRAINT orders_order_type_check;
ALTER TABLE orders ADD CONSTRAINT orders_order_type_check CHECK (
    order_type IN ('prescription', 'lab_request', 'nursing_order', 'referral')
);
