-- Reverse of 0010_assets_rbac.up.sql.
DELETE FROM role_permissions
WHERE permission_id IN (SELECT id FROM permissions WHERE module = 'assets');

DELETE FROM permissions WHERE module = 'assets';

DELETE FROM roles WHERE code = 'storekeeper';
