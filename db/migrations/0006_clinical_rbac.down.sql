-- Remove clinical-workflow permissions (cascades to role_permissions).
DELETE FROM permissions WHERE code IN (
    'orders.view','orders.create','orders.manage',
    'notes.view','notes.write',
    'vitals.view','vitals.record',
    'mar.view','mar.record',
    'tasks.view','tasks.create','tasks.complete',
    'admissions.view','admissions.manage',
    'reports.view','reports.write',
    'triage.manage',
    'assignments.view','assignments.manage'
);
