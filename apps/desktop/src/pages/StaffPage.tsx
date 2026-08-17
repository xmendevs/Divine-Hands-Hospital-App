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

const LEAVE_TYPES = ["annual", "sick", "maternity", "paternity", "unpaid", "study", "bereavement"];

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
  return `${(first[0] ?? "").toUpperCase()}${(last[0] ?? "").toUpperCase()}` || "—";
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
  const [activeTab, setActiveTab] = useState<"directory" | "leave">("directory");

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [leave, setLeave] = useState<LeaveRequest[]>([]);

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

  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    const [staffRes, leaveRes] = await Promise.allSettled([
      apiFetch<StaffMember[]>("/staff"),
      apiFetch<LeaveRequest[]>("/staff/leave"),
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
    setError(errors.join(" "));
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const departments = useMemo(
    () => Array.from(new Set(staff.map((s) => s.departmentName).filter(Boolean))) as string[],
    [staff],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return staff.filter((s) => {
      if (q) {
        const haystack =
          `${s.firstName} ${s.lastName} ${s.employeeNo} ${s.jobTitle ?? ""} ${s.contactEmail ?? ""}`.toLowerCase();
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
    { key: "role", header: "Role", render: (s: StaffMember) => s.jobTitle || "—" },
    {
      key: "department",
      header: "Department",
      render: (s: StaffMember) => s.departmentName || "—",
    },
    {
      key: "contact",
      header: "Contact",
      render: (s: StaffMember) => s.contactEmail || s.contactPhone || "—",
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
        <Button size="sm" variant="outline" onClick={() => openProfile(s)}>
          View Profile
        </Button>
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
      render: (l: LeaveRequest) => `${l.startDate} → ${l.endDate}`,
    },
    { key: "reason", header: "Reason", render: (l: LeaveRequest) => l.reason || "—" },
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
            {l.decidedAt ? `decided ${new Date(l.decidedAt).toLocaleDateString()}` : "—"}
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
        ]}
        active={activeTab}
        onChange={(k) => setActiveTab(k as "directory" | "leave")}
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
          {/* Filters toolbar */}
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
                    placeholder="Search staff by name, employee no or email..."
                  />
                </FormField>
              </div>
              <div style={{ minWidth: 180 }}>
                <FormField label="Department">
                  <Select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
                    <option value="all">All departments</option>
                    {departments.map((d) => (
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
                Loading staff…
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
                Loading leave requests…
              </p>
            ) : leave.length === 0 ? (
              <EmptyState icon="calendar" description="No leave requests yet." />
            ) : (
              <DataTable columns={leaveColumns} rows={leave} rowKey={(l) => l.id} dense />
            )}
          </Card>
        </div>
      )}

      {/* Staff profile modal */}
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
                  {selected.jobTitle || "No role assigned"} · {selected.employeeNo}
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
                Loading full profile…
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
                      {r.replace("_", " ")}
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

      {/* Request leave modal */}
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
              <option value="">Select staff member…</option>
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
      <div style={{ color: value ? theme.text.secondary : theme.text.muted }}>{value || "—"}</div>
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
