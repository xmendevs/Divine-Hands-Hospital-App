DELETE FROM role_permissions rp USING permissions p
WHERE rp.permission_id = p.id AND p.code IN ('backups.view','backups.run','backups.verify');

DELETE FROM permissions WHERE code IN ('backups.view','backups.run','backups.verify');