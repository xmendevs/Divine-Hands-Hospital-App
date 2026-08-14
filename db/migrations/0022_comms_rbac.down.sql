DELETE FROM role_permissions rp USING permissions p
WHERE rp.permission_id = p.id AND p.code IN (
    'notifications.view','notifications.send','comms.send','comms.view',
    'comms.manage','comms.announce','comms.admin','comms.audit'
);

DELETE FROM permissions WHERE code IN (
    'notifications.view','notifications.send','comms.send','comms.view',
    'comms.manage','comms.announce','comms.admin','comms.audit'
);
