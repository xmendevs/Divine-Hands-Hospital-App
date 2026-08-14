-- Remove clinical roles and patient-module permissions.
DELETE FROM role_permissions
WHERE role_id IN (SELECT id FROM roles WHERE code IN ('receptionist','nurse','matron','doctor'));

DELETE FROM roles WHERE code IN ('receptionist','nurse','matron','doctor');

DELETE FROM permissions WHERE code IN (
    'patients.view','patients.create','patients.edit','patients.search','patients.amend',
    'clinical.view','clinical.edit',
    'families.view','families.create',
    'documents.view','documents.upload'
);
