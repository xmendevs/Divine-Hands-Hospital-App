DELETE FROM role_permissions rp USING permissions p
WHERE rp.permission_id = p.id AND p.code IN ('roster.view','roster.plan','roster.approve');

DELETE FROM permissions WHERE code IN ('roster.view','roster.plan','roster.approve');
