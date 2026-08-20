-- Extend order types to cover granular clinical categories:
-- laboratory investigations, radiology/imaging, nursing procedures, and
-- dietary/ward instructions (in addition to the original four).
ALTER TABLE orders DROP CONSTRAINT orders_order_type_check;
ALTER TABLE orders ADD CONSTRAINT orders_order_type_check CHECK (
    order_type IN (
        'prescription',
        'lab_request',
        'lab_investigation',
        'radiology_imaging',
        'nursing_order',
        'nursing_procedure',
        'dietary_ward',
        'referral'
    )
);
