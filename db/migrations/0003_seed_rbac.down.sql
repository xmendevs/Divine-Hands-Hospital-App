DELETE FROM role_permissions
WHERE role_id IN (SELECT id FROM roles WHERE code IN ('super_admin','admin','auditor'));

DELETE FROM roles WHERE code IN ('super_admin','admin','auditor');

DELETE FROM permissions WHERE code IN (
    'users.view','users.create','users.edit','users.suspend','users.reset_password',
    'staff.view','staff.create','staff.edit',
    'roles.view','roles.create','roles.edit','roles.assign',
    'departments.view','departments.create','departments.edit',
    'audit.view','settings.view','settings.edit'
);
