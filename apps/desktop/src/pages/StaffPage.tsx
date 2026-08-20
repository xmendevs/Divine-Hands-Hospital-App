import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  theme,
  Button,
  Card,
  DataTable,
  EmptyState,
  FormField,
  Input,
  Modal,
  PageHeader,
  Select,
  StatusBadge,
  TabNav,
  Textarea,
  useConfirm,
  useToast,
  type StatusVariant,
} from "@hims/ui";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface StaffMember {
  id: string;
  userId: string;
  username?: string;
  departmentId?: string;
  departmentName?: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  jobTitle?: string;
  contactPhone?: string;
  contactEmail?: string;
  employmentStatus: string;
  availability?: string;
  skills?: string[];
  certifications?: string[];
  hireDate?: string;
  roles?: string[];
}

interface LeaveRequest {
  id: string;
  staffId: string;
  staffName?: string;
  employeeNo?: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason?: string;
  status: string;
  requestedBy: string;
  approvedBy?: string;
  decidedAt?: string;
  createdAt: string;
}

interface Department {
  id: string;
  name: string;
}

interface AuditLog {
  id: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  actorName?: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

const LEAVE_TYPES = ["annual", "sick", "maternity", "paternity", "unpaid", "study", "bereavement"];

const ROLE_OPTIONS = [
  { code: "super_admin", label: "Super Admin" },
  { code: "doctor", label: "Doctor" },
  { code: "nurse", label: "Nurse" },
  { code: "matron", label: "Matron" },
  { code: "pharmacist", label: "Pharmacist" },
  { code: "lab_technician", label: "Lab Technician" },
  { code: "lab_supervisor", label: "Lab Supervisor" },
  { code: "cashier", label: "Cashier" },
  { code: "receptionist", label: "Receptionist" },
];

const CONTACT_FIELDS = [
  { label: "Contact Number 2", key: "contactPhone2" },
  { label: "Contact Number 3", key: "contactPhone3" },
  { label: "Contact Number 4", key: "contactPhone4" },
  { label: "WhatsApp Number", key: "whatsappNumber" },
];

function statusVariant(status: string): StatusVariant {
  switch (status) {
    case "active":
      return "approved";
    case "on_leave":
      return "running";
    case "suspended":
      return "error";
    case "terminated":
      return "inactive";
    case "approved":
      return "approved";
    case "rejected":
      return "error";
    default:
      return "draft";
  }
}

function initials(first: string, last: string): string {
  return `${(first[0] ?? "").toUpperCase()}${(last[0] ?? "").toUpperCase()}` || "\u2014";
}

function initialsColor(name: string): string {
  const palette = [
    theme.action.primary,
    theme.action.info,
    "#6d28d9",
    "#0d9488",
    "#c2410c",
    "#be185d",
    "#4d7c0f",
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

export default function StaffPage() {
  const [activeTab, setActiveTab] = useState<"directory" | "leave" | "audit">("directory");
  const { me } = useAuth();
  const isSuperAdmin = me?.roles?.some((r: { code: string }) => r.code === "super_admin") ?? false;

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [leave, setLeave] = useState<LeaveRequest[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");

  const [selected, setSelected] = useState<StaffMember | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [leaveForm, setLeaveForm] = useState({
    staffId: "",
    leaveType: "annual",
    startDate: "",
    endDate: "",
    reason: "",
  });
  const [leaveModal, setLeaveModal] = useState(false);
  const [savingLeave, setSavingLeave] = useState(false);

  // Create staff state
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    username: "",
    email: "",
    password: "",
    firstName: "",
    lastName: "",
    employeeNo: "",
    jobTitle: "",
    departmentId: "",
    roleCode: "doctor",
    hireDate: "",
    salary: "",
    salaryType: "monthly",
  });
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [showOptionalContacts, setShowOptionalContacts] = useState(false);
  const [optionalContacts, setOptionalContacts] = useState({
    contactPhone2: "",
    contactPhone3: "",
    contactPhone4: "",
    whatsappNumber: "",
  });
  const [cvFileName, setCvFileName] = useState("");

  // Auto-generate employee number
  function generateEmployeeNo(): string {
    const nextNum = staff.length + 1;
    return `EMP${String(nextNum).padStart(5, "0")}`;
  }

  // Delete staff state
  const [deleteTarget, setDeleteTarget] = useState<StaffMember | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Edit role state
  const [editRoleTarget, setEditRoleTarget] = useState<StaffMember | null>(null);
  const [editRoleCode, setEditRoleCode] = useState("");
  const [savingRole, setSavingRole] = useState(false);

  // Approval notification state
  const [approvalNotification, setApprovalNotification] = useState<{
    open: boolean;
    title: string;
    message: string;
  }>({ open: false, title: "", message: "" });

  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    const [staffRes, leaveRes, deptRes] = await Promise.allSettled([
      apiFetch<StaffMember[]>("/staff"),
      apiFetch<LeaveRequest[]>("/staff/leave"),
      isSuperAdmin ? apiFetch<Department[]>("/admin/departments") : Promise.resolve([]),
    ]);
    const errors: string[] = [];
    if (staffRes.status === "fulfilled") {
      setStaff(staffRes.value);
    } else {
      errors.push(
        staffRes.reason instanceof Error ? staffRes.reason.message : "Could not load staff.",
      );
    }
    if (leaveRes.status === "fulfilled") {
      setLeave(leaveRes.value);
    } else {
      errors.push(
        leaveRes.reason instanceof Error
          ? leaveRes.reason.message
          : "Could not load leave requests.",
      );
    }
    if (deptRes.status === "fulfilled") {
      setDepartments(deptRes.value);
    }
    setError(errors.join(" "));
    setLoading(false);
  }, [isSuperAdmin]);

  const loadAuditLogs = useCallback(async () => {
    if (!isSuperAdmin) return;
    try {
      const logs = await apiFetch<AuditLog[]>("/admin/audit-logs?limit=50");
      setAuditLogs(logs);
    } catch {
      // silent
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (activeTab === "audit" && isSuperAdmin) {
      void loadAuditLogs();
    }
  }, [activeTab, isSuperAdmin, loadAuditLogs]);

  const departmentList = useMemo(
    () => departments.map((d) => d.name),
    [departments],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return staff.filter((s) => {
      if (q) {
        const haystack =
          `${s.firstName} ${s.lastName} ${s.employeeNo} ${s.jobTitle ?? ""} ${s.contactEmail ?? ""} ${s.contactPhone ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (statusFilter !== "all" && s.employmentStatus !== statusFilter) return false;
      if (deptFilter !== "all" && s.departmentName !== deptFilter) return false;
      return true;
    });
  }, [staff, query, statusFilter, deptFilter]);

  async function openProfile(member: StaffMember) {
    setSelected(member);
    setProfileLoading(true);
    try {
      const full = await apiFetch<StaffMember>(`/staff/${member.id}`);
      setSelected(full);
    } catch {
      // keep the list-level row data; profile still renders with what we have
    } finally {
      setProfileLoading(false);
    }
  }

  async function leaveAction(id: string, action: "approve" | "reject") {
    if (action === "reject") {
      const ok = await confirm({
        title: "Reject leave request?",
        message: "The staff member will be notified that this leave request was not approved.",
        confirmLabel: "Reject",
        danger: true,
        icon: "warning",
      });
      if (!ok) return;
    }
    setBusyId(id);
    setError("");
    try {
      await apiFetch<unknown>(`/staff/leave/${id}/${action}`, { method: "POST" });
      await loadAll();
      toast.success(action === "approve" ? "Leave request approved." : "Leave request rejected.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : `Could not ${action} the leave request.`;
      setError(msg);
      toast.error(msg);
    } finally {
      setBusyId(null);
    }
  }

  async function handleRequestLeave(e: FormEvent) {
    e.preventDefault();
    if (!leaveForm.staffId || !leaveForm.startDate || !leaveForm.endDate) {
      setError("Staff member, start date and end date are required.");
      return;
    }
    setSavingLeave(true);
    setError("");
    try {
      await apiFetch<unknown>("/staff/leave", {
        method: "POST",
        body: JSON.stringify(leaveForm),
      });
      setLeaveModal(false);
      setLeaveForm({ staffId: "", leaveType: "annual", startDate: "", endDate: "", reason: "" });
      await loadAll();
      toast.success("Leave request submitted.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not submit the leave request.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSavingLeave(false);
    }
  }

  // --- Create staff handler ---
  async function handleCreateStaff(e: FormEvent) {
    e.preventDefault();
    if (!createForm.username || !createForm.email || !createForm.password || !createForm.firstName || !createForm.lastName || !createForm.employeeNo) {
      setError("All required fields must be filled.");
      return;
    }
    if (createForm.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setCreatingStaff(true);
    setError("");
    try {
      const empNo = createForm.employeeNo || generateEmployeeNo();
      await apiFetch<{ id: string }>("/admin/users", {
        method: "POST",
        body: JSON.stringify({
          username: createForm.username,
          email: createForm.email,
          password: createForm.password,
          firstName: createForm.firstName,
          lastName: createForm.lastName,
          employeeNo: empNo,
          jobTitle: createForm.jobTitle || ROLE_OPTIONS.find((r) => r.code === createForm.roleCode)?.label || "",
          departmentId: createForm.departmentId,
          roleCodes: [createForm.roleCode],
          hireDate: createForm.hireDate || undefined,
          salary: createForm.salary ? parseFloat(createForm.salary) : undefined,
          salaryType: createForm.salaryType || undefined,
          cvFileName: cvFileName || undefined,
        }),
      });
      setCreateOpen(false);
      setCreateForm({
        username: "",
        email: "",
        password: "",
        firstName: "",
        lastName: "",
        employeeNo: "",
        jobTitle: "",
        departmentId: "",
        roleCode: "doctor",
        hireDate: "",
        salary: "",
        salaryType: "monthly",
      });
      setOptionalContacts({ contactPhone2: "", contactPhone3: "", contactPhone4: "", whatsappNumber: "" });
      setCvFileName("");
      setShowOptionalContacts(false);
      await loadAll();
      toast.success("Staff account created successfully. They will be prompted to change their password on first login.");

      // Show approval notification
      setApprovalNotification({
        open: true,
        title: "Staff Account Created",
        message: `${createForm.firstName} ${createForm.lastName} has been created with the role of ${ROLE_OPTIONS.find((r) => r.code === createForm.roleCode)?.label || createForm.roleCode}. Employee No: ${empNo}. The staff member will need to change their password on first login.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not create staff account.";
      setError(msg);
      toast.error(msg);
    } finally {
      setCreatingStaff(false);
    }
  }

  // --- Delete staff handler ---
  async function handleDeleteStaff() {
    if (!deleteTarget) return;
    const ok = await confirm({
      title: "Delete staff account?",
      message: `Are you sure you want to delete ${deleteTarget.firstName} ${deleteTarget.lastName}? This action cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
      icon: "warning",
    });
    if (!ok) return;

    setDeleting(true);
    setError("");
    try {
      await apiFetch<unknown>(`/admin/users/${deleteTarget.userId || deleteTarget.id}/suspend`, {
        method: "POST",
      });
      setDeleteTarget(null);
      await loadAll();
      toast.success(`${deleteTarget.firstName} ${deleteTarget.lastName} has been removed.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not delete staff account.";
      setError(msg);
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  }

  // --- Edit role handler ---
  async function handleSaveRole() {
    if (!editRoleTarget || !editRoleCode) return;
    setSavingRole(true);
    setError("");
    try {
      await apiFetch<unknown>(`/admin/users/${editRoleTarget.userId || editRoleTarget.id}/roles`, {
        method: "PUT",
        body: JSON.stringify({ roleCodes: [editRoleCode] }),
      });

      // Optimistic update: immediately reflect the new role in local state
      const targetId = editRoleTarget.id;
      setStaff((prev) =>
        prev.map((s) =>
          s.id === targetId
            ? { ...s, roles: [editRoleCode], jobTitle: ROLE_OPTIONS.find((r) => r.code === editRoleCode)?.label || editRoleCode }
            : s,
        ),
      );

      setEditRoleTarget(null);
      setEditRoleCode("");

      // Also refresh from server to ensure consistency
      await loadAll();
      toast.success(`Role updated to ${ROLE_OPTIONS.find((r) => r.code === editRoleCode)?.label || editRoleCode}.`);

      setApprovalNotification({
        open: true,
        title: "Role Changed",
        message: `${editRoleTarget.firstName} ${editRoleTarget.lastName}'s role has been updated to ${ROLE_OPTIONS.find((r) => r.code === editRoleCode)?.label || editRoleCode}. All associated permissions have been applied.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not update role.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSavingRole(false);
    }
  }

  // --- Role display helper ---
  function getRoleDisplay(s: StaffMember): string {
    if (s.roles && s.roles.length > 0) {
      const roleLabels = s.roles.map((r) => {
        const found = ROLE_OPTIONS.find((opt) => opt.code === r);
        return found ? found.label : r.replace(/_/g, " ");
      });
      return roleLabels.join(", ");
    }
    return s.jobTitle || "\u2014";
  }

  // First super admin cannot be edited or deleted
  function isFirstSuperAdmin(s: StaffMember): boolean {
    return (s.username === "superadmin" || s.username === me?.username) &&
      (s.roles?.includes("super_admin") ?? false);
  }

  const directoryColumns = [
    {
      key: "member",
      header: "Staff Member",
      render: (s: StaffMember) => (
        <div style={{ display: "flex", alignItems: "center", gap: theme.spacing["3"] }}>
          {" "}
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: theme.radius.full,
              background: initialsColor(`${s.firstName} ${s.lastName}`),
              color: theme.text.inverse,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: theme.fontSize.sm,
              fontWeight: theme.fontWeight.bold,
              flexShrink: 0,
            }}
          >
            {initials(s.firstName, s.lastName)}
          </div>
          <div>
            <div style={{ fontWeight: theme.fontWeight.semibold, color: theme.action.info }}>
              {s.firstName} {s.lastName}
            </div>
            <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
              {s.employeeNo}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (s: StaffMember) => (
        <div style={{ display: "flex", alignItems: "center", gap: theme.spacing["2"] }}>
          <span>{getRoleDisplay(s)}</span>
          {isSuperAdmin && !isFirstSuperAdmin(s) && (
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                setEditRoleTarget(s);
                setEditRoleCode(s.roles?.[0] || "doctor");
              }}
              style={{ padding: "0.1rem 0.4rem", fontSize: theme.fontSize.xs }}
            >
              Edit
            </Button>
          )}
        </div>
      ),
    },
    {
      key: "department",
      header: "Department",
      render: (s: StaffMember) => s.departmentName || "\u2014",
    },
    {
      key: "email",
      header: "Email",
      render: (s: StaffMember) => (
        <span style={{ fontSize: theme.fontSize.sm }}>{s.contactEmail || "\u2014"}</span>
      ),
    },
    {
      key: "phone",
      header: "Phone",
      render: (s: StaffMember) => (
        <span style={{ fontSize: theme.fontSize.sm }}>{s.contactPhone || "\u2014"}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (s: StaffMember) => (
        <StatusBadge
          variant={statusVariant(s.employmentStatus)}
          label={s.employmentStatus.replace("_", " ")}
        />
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (s: StaffMember) => (
        <div style={{ display: "flex", gap: theme.spacing["2"], alignItems: "center" }}>
          <Button size="sm" variant="outline" onClick={() => openProfile(s)}>
            View
          </Button>
          {isSuperAdmin && !isFirstSuperAdmin(s) && (
            <Button
              size="sm"
              variant="danger"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteTarget(s);
              }}
            >
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  const leaveColumns = [
    {
      key: "staff",
      header: "Staff",
      render: (l: LeaveRequest) => (
        <strong style={{ color: theme.text.primary }}>{l.staffName || l.staffId}</strong>
      ),
    },
    { key: "type", header: "Type", render: (l: LeaveRequest) => <strong>{l.leaveType}</strong> },
    {
      key: "dates",
      header: "Dates",
      render: (l: LeaveRequest) => `${l.startDate} \u2192 ${l.endDate}`,
    },
    { key: "reason", header: "Reason", render: (l: LeaveRequest) => l.reason || "\u2014" },
    {
      key: "status",
      header: "Status",
      render: (l: LeaveRequest) => (
        <StatusBadge variant={statusVariant(l.status)} label={l.status} />
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (l: LeaveRequest) =>
        l.status === "pending" ? (
          <div style={{ display: "flex", gap: theme.spacing["2"] }}>
            <Button
              size="sm"
              loading={busyId === l.id}
              style={{ background: theme.action.success }}
              onClick={() => leaveAction(l.id, "approve")}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={busyId === l.id}
              onClick={() => leaveAction(l.id, "reject")}
            >
              Reject
            </Button>
          </div>
        ) : (
          <span style={{ fontSize: theme.fontSize.base, color: theme.text.muted }}>
            {l.decidedAt ? `decided ${new Date(l.decidedAt).toLocaleDateString()}` : "\u2014"}
          </span>
        ),
    },
  ];

  const auditColumns = [
    {
      key: "timestamp",
      header: "Timestamp",
      render: (a: AuditLog) => (
        <span style={{ fontSize: theme.fontSize.sm }}>
          {new Date(a.createdAt).toLocaleString()}
        </span>
      ),
    },
    { key: "action", header: "Action", render: (a: AuditLog) => <strong>{a.action}</strong> },
    { key: "resourceType", header: "Resource", render: (a: AuditLog) => a.resourceType },
    { key: "actorName", header: "Actor", render: (a: AuditLog) => a.actorName || "\u2014" },
    {
      key: "details",
      header: "Details",
      render: (a: AuditLog) => (
        <span style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
          {a.details ? JSON.stringify(a.details).slice(0, 80) : "\u2014"}
        </span>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}>
      <PageHeader
        title="Staff Management"
        description="Manage healthcare professional profiles, department assignments, and leave requests."
        badge={<StatusBadge variant="approved" label={`${staff.length} staff`} />}
      />

      <TabNav
        tabs={[
          { key: "directory", label: "Staff Directory" },
          { key: "leave", label: "Leave Requests" },
          ...(isSuperAdmin ? [{ key: "audit", label: "Audit Log" }] : []),
        ]}
        active={activeTab}
        onChange={(k) => setActiveTab(k as "directory" | "leave" | "audit")}
      />

      {error && (
        <p
          role="alert"
          style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.danger }}
        >
          {error}
        </p>
      )}

      {activeTab === "directory" && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
          {/* Filters toolbar + Create button */}
          <Card bodyStyle={{ padding: theme.spacing["4"] }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: theme.spacing["3"],
                alignItems: "flex-end",
              }}
            >
              <div style={{ flex: 1, minWidth: 240 }}>
                <FormField label="Search">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search staff by name, employee no, email, phone..."
                  />
                </FormField>
              </div>
              <div style={{ minWidth: 180 }}>
                <FormField label="Department">
                  <Select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
                    <option value="all">All departments</option>
                    {departmentList.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </div>
              <div style={{ minWidth: 160 }}>
                <FormField label="Status">
                  <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="on_leave">On leave</option>
                    <option value="suspended">Suspended</option>
                    <option value="terminated">Terminated</option>
                  </Select>
                </FormField>
              </div>
              {isSuperAdmin && (
                <Button
                  onClick={() => setCreateOpen(true)}
                  style={{ background: theme.action.success, marginBottom: 2 }}
                >
                  + Create New Staff
                </Button>
              )}
            </div>
          </Card>

          <Card bodyStyle={{ padding: 0 }}>
            {loading ? (
              <p
                style={{
                  padding: theme.spacing["4"],
                  color: theme.text.muted,
                  fontSize: theme.fontSize.base,
                }}
              >
                Loading staff...
              </p>
            ) : filtered.length === 0 ? (
              <EmptyState icon="users" description="No staff match the current filters." />
            ) : (
              <>
                <DataTable columns={directoryColumns} rows={filtered} rowKey={(s) => s.id} dense />
                <div
                  style={{
                    padding: `${theme.spacing["3"]} ${theme.spacing["4"]}`,
                    borderTop: `1px solid ${theme.surface.border}`,
                    fontSize: theme.fontSize.sm,
                    color: theme.text.muted,
                  }}
                >
                  Showing {filtered.length} of {staff.length} staff members
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      {activeTab === "leave" && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button onClick={() => setLeaveModal(true)}>+ Request Leave</Button>
          </div>
          <Card bodyStyle={{ padding: 0 }}>
            {loading ? (
              <p
                style={{
                  padding: theme.spacing["4"],
                  color: theme.text.muted,
                  fontSize: theme.fontSize.base,
                }}
              >
                Loading leave requests...
              </p>
            ) : leave.length === 0 ? (
              <EmptyState icon="calendar" description="No leave requests yet." />
            ) : (
              <DataTable columns={leaveColumns} rows={leave} rowKey={(l) => l.id} dense />
            )}
          </Card>
        </div>
      )}

      {activeTab === "audit" && isSuperAdmin && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
          <Card bodyStyle={{ padding: 0 }}>
            {auditLogs.length === 0 ? (
              <EmptyState icon="book" description="No audit logs yet." />
            ) : (
              <DataTable columns={auditColumns} rows={auditLogs} rowKey={(a) => a.id} dense />
            )}
          </Card>
        </div>
      )}

      {/* ============= CREATE NEW STAFF MODAL ============= */}
      <Modal
        open={createOpen}
        title="Create New Staff"
        onClose={() => setCreateOpen(false)}
        width={640}
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="create-staff-form"
              loading={creatingStaff}
              style={{ background: theme.action.success }}
            >
              Create Staff Account
            </Button>
          </>
        }
      >
        <form
          id="create-staff-form"
          onSubmit={handleCreateStaff}
          style={{ display: "flex", flexDirection: "column", gap: theme.spacing["3"] }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}>
            <FormField label="First Name" required>
              <Input
                required
                value={createForm.firstName}
                onChange={(e) => setCreateForm({ ...createForm, firstName: e.target.value })}
                placeholder="e.g. John"
              />
            </FormField>
            <FormField label="Last Name" required>
              <Input
                required
                value={createForm.lastName}
                onChange={(e) => setCreateForm({ ...createForm, lastName: e.target.value })}
                placeholder="e.g. Doe"
              />
            </FormField>
          </div>

          <FormField label="Username" required>
            <Input
              required
              value={createForm.username}
              onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
              placeholder="e.g. john.doe"
            />
          </FormField>

          <FormField label="Email" required>
            <Input
              type="email"
              required
              value={createForm.email}
              onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
              placeholder="e.g. john.doe@hospital.com"
            />
          </FormField>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}>
            <FormField label="Employee Number (auto-generated)">
              <Input
                value={createForm.employeeNo || generateEmployeeNo()}
                onChange={(e) => setCreateForm({ ...createForm, employeeNo: e.target.value })}
                placeholder="Auto-generated if empty"
              />
            </FormField>
            <FormField label="Hire Date" required>
              <Input
                type="date"
                required
                value={createForm.hireDate}
                onChange={(e) => setCreateForm({ ...createForm, hireDate: e.target.value })}
              />
            </FormField>
          </div>

          <FormField label="Password" required>
            <Input
              type="password"
              required
              minLength={8}
              value={createForm.password}
              onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
              placeholder="Minimum 8 characters"
            />
          </FormField>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}>
            <FormField label="Role" required>
              <Select
                required
                value={createForm.roleCode}
                onChange={(e) => setCreateForm({ ...createForm, roleCode: e.target.value })}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Department">
              <Select
                value={createForm.departmentId}
                onChange={(e) => setCreateForm({ ...createForm, departmentId: e.target.value })}
              >
                <option value="">Select department...</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          <FormField label="Job Title / Designation">
            <Input
              value={createForm.jobTitle}
              onChange={(e) => setCreateForm({ ...createForm, jobTitle: e.target.value })}
              placeholder="e.g. Senior Consultant"
            />
          </FormField>

          {/* Salary section */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: theme.spacing["3"] }}>
            <FormField label="Salary (₦)">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={createForm.salary}
                onChange={(e) => setCreateForm({ ...createForm, salary: e.target.value })}
                placeholder="e.g. 150000"
              />
            </FormField>
            <FormField label="Salary Type">
              <Select
                value={createForm.salaryType}
                onChange={(e) => setCreateForm({ ...createForm, salaryType: e.target.value })}
              >
                <option value="hourly">Per Hour</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </Select>
            </FormField>
          </div>

          {/* CV Upload */}
          <FormField label="Upload CV">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: theme.spacing["2"],
              }}
            >
              <label
                htmlFor="cv-upload"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: theme.spacing["2"],
                  padding: `${theme.spacing["2"]} ${theme.spacing["3"]}`,
                  border: `1px dashed ${theme.surface.border}`,
                  borderRadius: theme.radius.md,
                  cursor: "pointer",
                  fontSize: theme.fontSize.sm,
                  color: theme.text.secondary,
                  background: theme.surface.subtle,
                  transition: "all 0.15s",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Choose file...
              </label>
              <input
                id="cv-upload"
                type="file"
                accept=".pdf,.doc,.docx"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setCvFileName(file.name);
                  }
                }}
              />
              {cvFileName && (
                <span style={{ fontSize: theme.fontSize.sm, color: theme.action.success }}>
                  {cvFileName}
                </span>
              )}
            </div>
          </FormField>

          {/* Optional contact fields */}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowOptionalContacts(!showOptionalContacts)}
            >
              {showOptionalContacts ? "Hide" : "Show"} Optional Contact Fields
            </Button>
          </div>

          {showOptionalContacts && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}>
              {CONTACT_FIELDS.map((field) => (
                <FormField key={field.key} label={field.label}>
                  <Input
                    value={optionalContacts[field.key as keyof typeof optionalContacts]}
                    onChange={(e) =>
                      setOptionalContacts({ ...optionalContacts, [field.key]: e.target.value })
                    }
                    placeholder={`Enter ${field.label.toLowerCase()}`}
                  />
                </FormField>
              ))}
            </div>
          )}

          <div
            style={{
              padding: theme.spacing["3"],
              background: theme.badge.submitted.bg,
              borderRadius: theme.radius.md,
              fontSize: theme.fontSize.sm,
              color: theme.badge.submitted.text,
              border: `1px solid ${theme.badge.submitted.border}`,
            }}
          >
            The staff member will be prompted to change their password on first login. All role-based
            permissions will be applied immediately based on the selected role.
          </div>
        </form>
      </Modal>

      {/* ============= DELETE STAFF CONFIRMATION MODAL ============= */}
      <Modal
        open={deleteTarget !== null}
        title="Delete Staff Account"
        onClose={() => setDeleteTarget(null)}
        width={480}
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              loading={deleting}
              onClick={handleDeleteStaff}
              style={{ background: theme.text.danger }}
            >
              Yes, Delete
            </Button>
          </>
        }
      >
        {deleteTarget && (
          <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["3"] }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: theme.spacing["3"],
                padding: theme.spacing["3"],
                background: "#fef2f2",
                borderRadius: theme.radius.md,
                border: "1px solid #fecaca",
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: theme.radius.full,
                  background: theme.text.danger,
                  color: theme.text.inverse,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: theme.fontSize.lg,
                  fontWeight: theme.fontWeight.bold,
                  flexShrink: 0,
                }}
              >
                !
              </div>
              <div>
                <div style={{ fontWeight: theme.fontWeight.bold, color: theme.text.primary }}>
                  {deleteTarget.firstName} {deleteTarget.lastName}
                </div>
                <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                  {getRoleDisplay(deleteTarget)} | {deleteTarget.employeeNo}
                </div>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.secondary }}>
              Are you sure you want to delete this staff account? This will suspend their account and
              revoke all active sessions. This action cannot be undone.
            </p>
          </div>
        )}
      </Modal>

      {/* ============= EDIT ROLE MODAL ============= */}
      <Modal
        open={editRoleTarget !== null}
        title="Edit Staff Role"
        onClose={() => {
          setEditRoleTarget(null);
          setEditRoleCode("");
        }}
        width={480}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setEditRoleTarget(null);
                setEditRoleCode("");
              }}
            >
              Cancel
            </Button>
            <Button
              loading={savingRole}
              onClick={handleSaveRole}
              style={{ background: theme.action.primary }}
            >
              Save Role
            </Button>
          </>
        }
      >
        {editRoleTarget && (
          <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["3"] }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: theme.spacing["3"],
                padding: theme.spacing["3"],
                background: theme.surface.subtle,
                borderRadius: theme.radius.md,
                border: `1px solid ${theme.surface.border}`,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: theme.radius.full,
                  background: initialsColor(`${editRoleTarget.firstName} ${editRoleTarget.lastName}`),
                  color: theme.text.inverse,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: theme.fontSize.sm,
                  fontWeight: theme.fontWeight.bold,
                  flexShrink: 0,
                }}
              >
                {initials(editRoleTarget.firstName, editRoleTarget.lastName)}
              </div>
              <div>
                <div style={{ fontWeight: theme.fontWeight.bold, color: theme.text.primary }}>
                  {editRoleTarget.firstName} {editRoleTarget.lastName}
                </div>
                <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                  Current role: {getRoleDisplay(editRoleTarget)}
                </div>
              </div>
            </div>

            <FormField label="New Role" required>
              <Select
                required
                value={editRoleCode}
                onChange={(e) => setEditRoleCode(e.target.value)}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </FormField>

            <div
              style={{
                padding: theme.spacing["3"],
                background: theme.badge.submitted.bg,
                borderRadius: theme.radius.md,
                fontSize: theme.fontSize.sm,
                color: theme.badge.submitted.text,
                border: `1px solid ${theme.badge.submitted.border}`,
              }}
            >
              Changing a role will update all associated permissions immediately. The staff member's
              access to modules and features will change based on the new role's permission set.
            </div>
          </div>
        )}
      </Modal>

      {/* ============= STAFF PROFILE MODAL ============= */}
      <Modal
        open={selected !== null}
        title="Staff Profile"
        onClose={() => setSelected(null)}
        width={560}
        footer={
          <Button variant="outline" onClick={() => setSelected(null)}>
            Close
          </Button>
        }
      >
        {selected && (
          <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
            <div style={{ display: "flex", alignItems: "center", gap: theme.spacing["4"] }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: theme.radius.full,
                  background: initialsColor(`${selected.firstName} ${selected.lastName}`),
                  color: theme.text.inverse,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: theme.fontSize.xl,
                  fontWeight: theme.fontWeight.bold,
                  flexShrink: 0,
                }}
              >
                {initials(selected.firstName, selected.lastName)}
              </div>
              <div>
                <div
                  style={{
                    fontSize: theme.fontSize.lg,
                    fontWeight: theme.fontWeight.bold,
                    color: theme.text.primary,
                  }}
                >
                  {selected.firstName} {selected.lastName}
                </div>
                <div style={{ fontSize: theme.fontSize.base, color: theme.text.muted }}>
                  {getRoleDisplay(selected)} | {selected.employeeNo}
                </div>
                <div style={{ marginTop: theme.spacing["1"] }}>
                  <StatusBadge
                    variant={statusVariant(selected.employmentStatus)}
                    label={selected.employmentStatus.replace("_", " ")}
                  />
                </div>
              </div>
            </div>

            {profileLoading && (
              <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>
                Loading full profile...
              </p>
            )}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: theme.spacing["3"],
                fontSize: theme.fontSize.base,
              }}
            >
              <ProfileField label="Department" value={selected.departmentName} />
              <ProfileField label="Username" value={selected.username} />
              <ProfileField label="Email" value={selected.contactEmail} />
              <ProfileField label="Phone" value={selected.contactPhone} />
              <ProfileField label="Hire date" value={selected.hireDate} />
              <ProfileField label="Availability" value={selected.availability} />
            </div>

            {selected.roles && selected.roles.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: theme.fontSize.sm,
                    fontWeight: theme.fontWeight.bold,
                    color: theme.text.muted,
                    marginBottom: theme.spacing["1"],
                  }}
                >
                  ROLES
                </div>
                <div style={{ display: "flex", gap: theme.spacing["2"], flexWrap: "wrap" }}>
                  {selected.roles.map((r) => (
                    <span
                      key={r}
                      style={{
                        padding: "0.15rem 0.6rem",
                        borderRadius: theme.radius.full,
                        background: theme.badge.submitted.bg,
                        color: theme.badge.submitted.text,
                        border: `1px solid ${theme.badge.submitted.border}`,
                        fontSize: theme.fontSize.sm,
                        fontWeight: theme.fontWeight.semibold,
                      }}
                    >
                      {r.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {(selected.skills?.length ?? 0) > 0 && (
              <ProfileChips label="SKILLS" values={selected.skills ?? []} />
            )}
            {(selected.certifications?.length ?? 0) > 0 && (
              <ProfileChips label="CERTIFICATIONS" values={selected.certifications ?? []} />
            )}
          </div>
        )}
      </Modal>

      {/* ============= REQUEST LEAVE MODAL ============= */}
      <Modal
        open={leaveModal}
        title="Request Leave"
        onClose={() => setLeaveModal(false)}
        width={520}
        footer={
          <>
            <Button variant="outline" onClick={() => setLeaveModal(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="leave-form"
              loading={savingLeave}
              style={{ background: theme.action.success }}
            >
              Submit Request
            </Button>
          </>
        }
      >
        <form
          id="leave-form"
          onSubmit={handleRequestLeave}
          style={{ display: "flex", flexDirection: "column", gap: theme.spacing["3"] }}
        >
          <FormField label="Staff member" required>
            <Select
              required
              value={leaveForm.staffId}
              onChange={(e) => setLeaveForm({ ...leaveForm, staffId: e.target.value })}
            >
              <option value="">Select staff member...</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.firstName} {s.lastName} ({s.employeeNo})
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Leave type" required>
            <Select
              required
              value={leaveForm.leaveType}
              onChange={(e) => setLeaveForm({ ...leaveForm, leaveType: e.target.value })}
            >
              {LEAVE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </Select>
          </FormField>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}>
            <FormField label="Start date" required>
              <Input
                type="date"
                required
                value={leaveForm.startDate}
                onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })}
              />
            </FormField>
            <FormField label="End date" required>
              <Input
                type="date"
                required
                value={leaveForm.endDate}
                onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })}
              />
            </FormField>
          </div>
          <FormField label="Reason">
            <Textarea
              rows={2}
              value={leaveForm.reason}
              onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
              placeholder="Optional note for the approver..."
            />
          </FormField>
        </form>
      </Modal>

      {/* ============= APPROVAL NOTIFICATION MODAL ============= */}
      <Modal
        open={approvalNotification.open}
        title={approvalNotification.title}
        onClose={() => setApprovalNotification({ open: false, title: "", message: "" })}
        width={480}
        footer={
          <Button
            onClick={() => setApprovalNotification({ open: false, title: "", message: "" })}
            style={{ background: theme.action.success }}
          >
            Acknowledged
          </Button>
        }
      >
        <div
          style={{
            padding: theme.spacing["3"],
            background: theme.badge.approved.bg,
            borderRadius: theme.radius.md,
            fontSize: theme.fontSize.base,
            color: theme.badge.approved.text,
            border: `1px solid ${theme.badge.approved.border}`,
          }}
        >
          {approvalNotification.message}
        </div>
      </Modal>

      {confirmDialog}
    </div>
  );
}

function ProfileField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div
        style={{
          fontSize: theme.fontSize.sm,
          fontWeight: theme.fontWeight.bold,
          color: theme.text.muted,
        }}
      >
        {label.toUpperCase()}
      </div>
      <div style={{ color: value ? theme.text.secondary : theme.text.muted }}>{value || "\u2014"}</div>
    </div>
  );
}

function ProfileChips({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <div
        style={{
          fontSize: theme.fontSize.sm,
          fontWeight: theme.fontWeight.bold,
          color: theme.text.muted,
          marginBottom: theme.spacing["1"],
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", gap: theme.spacing["2"], flexWrap: "wrap" }}>
        {values.map((v) => (
          <span
            key={v}
            style={{
              padding: "0.15rem 0.6rem",
              borderRadius: theme.radius.full,
              background: theme.surface.subtle,
              color: theme.text.secondary,
              border: `1px solid ${theme.surface.border}`,
              fontSize: theme.fontSize.sm,
            }}
          >
            {v}
          </span>
        ))}
      </div>
    </div>
  );
}
