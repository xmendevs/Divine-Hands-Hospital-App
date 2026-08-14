DELETE FROM role_permissions rp USING permissions p
WHERE rp.permission_id = p.id
  AND p.code IN ('attendance.clock','attendance.view','attendance.manage',
                 'handover.create','handover.view','handover.acknowledge',
                 'staff.leave_request','staff.leave_manage');

DELETE FROM permissions
WHERE code IN ('attendance.clock','attendance.view','attendance.manage',
               'handover.create','handover.view','handover.acknowledge',
               'staff.leave_request','staff.leave_manage');
