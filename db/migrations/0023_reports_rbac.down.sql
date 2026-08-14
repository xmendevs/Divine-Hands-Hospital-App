-- Remove only the grants added by this phase. doctor and matron already held
-- reports.view from Phase 04; everyone else received it here.
DELETE FROM role_permissions rp USING permissions p
WHERE rp.permission_id = p.id AND p.code IN ('reports.admin','reports.export');

DELETE FROM role_permissions rp USING permissions p, roles r
WHERE rp.permission_id = p.id AND p.code = 'reports.view'
  AND rp.role_id = r.id AND r.code IN (
    'nurse','pharmacist','lab_technician','lab_supervisor','storekeeper',
    'cashier','billing_officer','billing_supervisor','receptionist','admin'
);

-- Restore the Phase 04 reports.view identity (clinical module).
UPDATE permissions SET name = 'View clinical reports', module = 'clinical'
WHERE code = 'reports.view' AND module = 'reports';

DELETE FROM permissions WHERE code IN ('reports.admin','reports.export');