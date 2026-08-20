import { useCallback, useEffect, useMemo, useState } from "react";
import {
  theme,
  Button,
  Card,
  DataTable,
  EmptyState,
  FormField,
  Icon,
  Input,
  PageHeader,
  Select,
  StatusBadge,
  TabNav,
  Textarea,
  useToast,
  type IconName,
  type StatusVariant,
} from "@hims/ui";
import { apiFetch } from "../api/client";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface StaffShift {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  lateGraceMinutes: number;
  isNight: boolean;
}

interface AttendanceRecord {
  id: string;
  staffId: string;
  staffName?: string;
  employeeNo?: string;
  shiftId: string;
  shiftName?: string;
  shiftCode?: string;
  departmentName?: string;
  workDate: string;
  clockInAt: string;
  clockOutAt?: string;
  clockInMethod: string;
  clockOutMethod?: string;
  isLate: boolean;
  isEarlyLeave: boolean;
  overtimeMinutes?: number;
  status: string;
  notes?: string;
}

interface ReportRow {
  staffId: string;
  employeeNo?: string;
  staffName: string;
  department?: string;
  shiftId?: string;
  shiftName?: string;
  status: string;
  clockInAt?: string;
  clockOutAt?: string;
}

interface DashboardStats {
  totalStaff: number;
  clockedIn: number;
  absent: number;
  lateToday: number;
  overtimeHours: number;
  leavePending: number;
}

interface LeaveRequest {
  id: string;
  staffId: string;
  staffName?: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: string;
  reviewNotes?: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function fmtTime(iso?: string): string {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(iso?: string): string {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

function statusVariant(status: string): StatusVariant {
  if (status === "clocked_in" || status === "running") return "running";
  if (status === "completed" || status === "approved") return "approved";
  if (status === "pending") return "draft";
  if (status === "rejected") return "error";
  return "draft";
}

type TabKey = "dashboard" | "clock" | "leave" | "records" | "analytics" | "export";

/* ------------------------------------------------------------------ */
/*  Stat Card                                                          */
/* ------------------------------------------------------------------ */

function StatCard({
  icon,
  label,
  value,
  color,
  sub,
}: {
  icon: IconName;
  label: string;
  value: string | number;
  color?: string;
  sub?: string;
}) {
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: theme.spacing["3"] }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: theme.radius.md,
            background: color ? `${color}18` : `${theme.action.primary}18`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name={icon} size={20} style={{ color: color || theme.action.primary }} />
        </div>
        <div>
          <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, fontWeight: theme.fontWeight.medium }}>
            {label}
          </div>
          <div
            style={{
              fontSize: theme.fontSize.xl,
              fontWeight: theme.fontWeight.bold,
              color: theme.text.primary,
              lineHeight: 1.2,
            }}
          >
            {value}
          </div>
          {sub && (
            <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted }}>{sub}</div>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function AttendancePage() {
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");

  /* Shared state */
  const [shifts, setShifts] = useState<StaffShift[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [reportRows, setReportRows] = useState<ReportRow[]>([]);
  const [dashboard, setDashboard] = useState<DashboardStats | null>(null);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);

  const [selectedShift, setSelectedShift] = useState("");
  const [workDate, setWorkDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [filterDate, setFilterDate] = useState(today());
  const [reportDate, setReportDate] = useState(today());
  const [exportMonth, setExportMonth] = useState(currentMonth());

  /* Leave request form */
  const [leaveType, setLeaveType] = useState("annual");
  const [leaveStart, setLeaveStart] = useState(today());
  const [leaveEnd, setLeaveEnd] = useState(today());
  const [leaveReason, setLeaveReason] = useState("");

  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const openRecord = useMemo(() => records.find((r) => r.status === "clocked_in"), [records]);

  /* ---------------------------------------------------------------- */
  /*  Data loading                                                     */
  /* ---------------------------------------------------------------- */

  const loadShifts = useCallback(async () => {
    try {
      const results = await apiFetch<StaffShift[]>("/attendance/shifts");
      setShifts(results);
      setSelectedShift((prev) => prev || results[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load shifts.");
    }
  }, []);

  const loadDashboard = useCallback(async () => {
    try {
      const d = await apiFetch<DashboardStats>("/attendance/dashboard");
      setDashboard(d);
    } catch {
      /* non-critical */
    }
  }, []);

  const loadRecords = useCallback(async () => {
    try {
      const results = await apiFetch<AttendanceRecord[]>(
        `/attendance?date=${encodeURIComponent(filterDate)}`,
      );
      setRecords(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load records.");
    }
  }, [filterDate]);

  const loadReport = useCallback(async () => {
    try {
      const results = await apiFetch<ReportRow[]>(
        `/attendance/report?date=${encodeURIComponent(reportDate)}`,
      );
      setReportRows(results);
    } catch {
      /* non-critical */
    }
  }, [reportDate]);

  const loadLeaveRequests = useCallback(async () => {
    try {
      const results = await apiFetch<LeaveRequest[]>("/attendance/leave");
      setLeaveRequests(results);
    } catch {
      /* non-critical */
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void (async () => {
      await Promise.allSettled([loadShifts(), loadDashboard(), loadRecords(), loadReport(), loadLeaveRequests()]);
      setLoading(false);
    })();
  }, [loadShifts, loadDashboard, loadRecords, loadReport, loadLeaveRequests]);

  /* ---------------------------------------------------------------- */
  /*  Clock in / out                                                   */
  /* ---------------------------------------------------------------- */

  async function handleClockIn() {
    if (!selectedShift) {
      setError("Select a shift before clocking in.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiFetch<AttendanceRecord>("/attendance/clock-in", {
        method: "POST",
        body: JSON.stringify({ shiftId: selectedShift, workDate, method: "manual", device: "desktop", notes: notes.trim() }),
      });
      setNotes("");
      await Promise.all([loadRecords(), loadDashboard()]);
      toast.success("Clocked in successfully.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not clock in.";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleClockOut() {
    setBusy(true);
    setError("");
    try {
      await apiFetch<AttendanceRecord>("/attendance/clock-out", {
        method: "POST",
        body: JSON.stringify({ method: "manual", device: "desktop", notes: notes.trim() }),
      });
      setNotes("");
      await Promise.all([loadRecords(), loadDashboard()]);
      toast.success("Clocked out successfully.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not clock out.";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Leave request actions                                            */
  /* ---------------------------------------------------------------- */

  async function handleCreateLeaveRequest() {
    if (!leaveReason.trim()) {
      setError("Please provide a reason for the leave request.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiFetch("/attendance/leave", {
        method: "POST",
        body: JSON.stringify({ leaveType, startDate: leaveStart, endDate: leaveEnd, reason: leaveReason.trim() }),
      });
      setLeaveReason("");
      await loadLeaveRequests();
      toast.success("Leave request submitted.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not submit leave request.";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleReviewLeave(id: string, action: "approved" | "rejected") {
    try {
      await apiFetch(`/attendance/leave/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: action, reviewNotes: action === "approved" ? "Approved" : "Rejected" }),
      });
      await loadLeaveRequests();
      toast.success(`Leave request ${action}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not review leave request.");
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Export                                                           */
  /* ---------------------------------------------------------------- */

  async function handleExport() {
    try {
      const base = window.location.origin;
      const token = localStorage.getItem("hims_token") || "";
      const res = await fetch(`${base}/api/v1/attendance/export?month=${exportMonth}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `attendance-${exportMonth}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed.");
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Column definitions                                               */
  /* ---------------------------------------------------------------- */

  const recordsColumns = [
    {
      key: "staff",
      header: "Staff",
      render: (r: AttendanceRecord) => (
        <strong style={{ color: theme.text.primary }}>{r.staffName || r.staffId}</strong>
      ),
    },
    { key: "shift", header: "Shift", render: (r: AttendanceRecord) => r.shiftName || r.shiftCode || "\u2014" },
    { key: "dept", header: "Department", render: (r: AttendanceRecord) => r.departmentName || "\u2014" },
    { key: "in", header: "Clock In", render: (r: AttendanceRecord) => fmtTime(r.clockInAt) },
    { key: "out", header: "Clock Out", render: (r: AttendanceRecord) => fmtTime(r.clockOutAt) },
    {
      key: "flags",
      header: "Flags",
      render: (r: AttendanceRecord) => (
        <div style={{ display: "flex", gap: theme.spacing["1"], flexWrap: "wrap" }}>
          {r.isLate && <StatusBadge variant="running" label="Late" />}
          {r.isEarlyLeave && <StatusBadge variant="draft" label="Early" />}
          {(r.overtimeMinutes ?? 0) > 0 && (
            <StatusBadge variant="approved" label={`OT ${r.overtimeMinutes}m`} />
          )}
          {!r.isLate && !r.isEarlyLeave && (r.overtimeMinutes ?? 0) === 0 && (
            <span style={{ color: theme.text.muted }}>\u2014</span>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r: AttendanceRecord) => (
        <StatusBadge variant={statusVariant(r.status)} label={r.status.replace("_", " ")} />
      ),
    },
  ];

  const leaveColumns = [
    {
      key: "staff",
      header: "Staff",
      render: (r: LeaveRequest) => (
        <strong style={{ color: theme.text.primary }}>{r.staffName || r.staffId}</strong>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (r: LeaveRequest) => (
        <span style={{ textTransform: "capitalize" }}>{r.leaveType}</span>
      ),
    },
    { key: "start", header: "Start", render: (r: LeaveRequest) => fmtDate(r.startDate) },
    { key: "end", header: "End", render: (r: LeaveRequest) => fmtDate(r.endDate) },
    {
      key: "reason",
      header: "Reason",
      render: (r: LeaveRequest) => (
        <span style={{ color: theme.text.secondary, maxWidth: 200, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {r.reason}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r: LeaveRequest) => (
        <StatusBadge variant={statusVariant(r.status)} label={r.status} />
      ),
    },
    {
      key: "actions",
      header: "",
      render: (r: LeaveRequest) =>
        r.status === "pending" ? (
          <div style={{ display: "flex", gap: theme.spacing["1"] }}>
            <Button
              size="sm"
              style={{ background: theme.action.success, color: "#fff", fontSize: theme.fontSize.xs }}
              onClick={() => void handleReviewLeave(r.id, "approved")}
            >
              Approve
            </Button>
            <Button
              size="sm"
              style={{ background: theme.action.danger, color: "#fff", fontSize: theme.fontSize.xs }}
              onClick={() => void handleReviewLeave(r.id, "rejected")}
            >
              Reject
            </Button>
          </div>
        ) : (
          <span style={{ color: theme.text.muted, fontSize: theme.fontSize.xs }}>\u2014</span>
        ),
    },
  ];

  const reportColumns = [
    { key: "staff", header: "Staff", render: (r: ReportRow) => <strong>{r.staffName}</strong> },
    { key: "no", header: "Employee No", render: (r: ReportRow) => r.employeeNo || "\u2014" },
    { key: "dept", header: "Department", render: (r: ReportRow) => r.department || "\u2014" },
    { key: "shift", header: "Shift", render: (r: ReportRow) => r.shiftName || "\u2014" },
    { key: "in", header: "Clock In", render: (r: ReportRow) => fmtTime(r.clockInAt) },
    { key: "out", header: "Clock Out", render: (r: ReportRow) => fmtTime(r.clockOutAt) },
    {
      key: "status",
      header: "Status",
      render: (r: ReportRow) => (
        <StatusBadge variant={statusVariant(r.status)} label={r.status.replace("_", " ")} />
      ),
    },
  ];

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}>
      <PageHeader
        title="Attendance & Clock In/Out"
        description="Enterprise attendance management: clock in/out, leave requests, records, analytics, and export."
        badge={
          dashboard ? (
            <StatusBadge
              variant="running"
              label={`${dashboard.clockedIn} / ${dashboard.totalStaff} clocked in`}
            />
          ) : undefined
        }
      />

      <TabNav
        tabs={[
          { key: "dashboard", label: "Dashboard" },
          { key: "clock", label: "Clock In / Out" },
          { key: "leave", label: "Leave Requests" },
          { key: "records", label: "Records" },
          { key: "analytics", label: "Analytics" },
          { key: "export", label: "Export" },
        ]}
        active={activeTab}
        onChange={(k) => setActiveTab(k as TabKey)}
      />

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.danger }}>
          {error}
        </p>
      )}

      {/* ============================================================ */}
      {/*  TAB: Dashboard                                              */}
      {/* ============================================================ */}
      {activeTab === "dashboard" && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: theme.spacing["3"] }}>
            <StatCard icon="users" label="Total Staff" value={dashboard?.totalStaff ?? "\u2014"} color={theme.action.primary} />
            <StatCard
              icon="check"
              label="Clocked In"
              value={dashboard?.clockedIn ?? "\u2014"}
              color={theme.action.success}
              sub={dashboard ? `${Math.round((dashboard.clockedIn / Math.max(dashboard.totalStaff, 1)) * 100)}% attendance` : undefined}
            />
            <StatCard
              icon="close"
              label="Absent Today"
              value={dashboard?.absent ?? "\u2014"}
              color={theme.action.danger}
            />
            <StatCard
              icon="warning"
              label="Late Today"
              value={dashboard?.lateToday ?? "\u2014"}
              color="#f59e0b"
            />
            <StatCard
              icon="clock"
              label="Overtime Hours"
              value={dashboard?.overtimeHours ?? 0}
              color="#8b5cf6"
              sub="total this period"
            />
            <StatCard
              icon="book"
              label="Pending Leave"
              value={dashboard?.leavePending ?? 0}
              color="#06b6d4"
              sub="awaiting review"
            />
          </div>

          {/* Quick summary card */}
          <Card title="Today's Attendance Summary" hint={`${new Date().toLocaleDateString()}`}>
            {dashboard ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: theme.spacing["4"] }}>
                <div>
                  <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginBottom: 4 }}>Attendance Rate</div>
                  <div style={{ fontSize: theme.fontSize.lg, fontWeight: theme.fontWeight.bold, color: theme.action.success }}>
                    {dashboard.totalStaff > 0 ? Math.round((dashboard.clockedIn / dashboard.totalStaff) * 100) : 0}%
                  </div>
                  <div
                    style={{
                      height: 6,
                      borderRadius: 3,
                      background: theme.surface.border,
                      marginTop: 6,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${dashboard.totalStaff > 0 ? (dashboard.clockedIn / dashboard.totalStaff) * 100 : 0}%`,
                        background: theme.action.success,
                        borderRadius: 3,
                        transition: "width 0.3s",
                      }}
                    />
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginBottom: 4 }}>Punctuality</div>
                  <div style={{ fontSize: theme.fontSize.lg, fontWeight: theme.fontWeight.bold, color: dashboard.lateToday > 0 ? "#f59e0b" : theme.action.success }}>
                    {dashboard.totalStaff > 0 ? Math.round(((dashboard.totalStaff - dashboard.lateToday) / dashboard.totalStaff) * 100) : 100}%
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginBottom: 4 }}>Leave Requests</div>
                  <div style={{ fontSize: theme.fontSize.lg, fontWeight: theme.fontWeight.bold, color: theme.text.primary }}>
                    {dashboard.leavePending} pending
                  </div>
                </div>
              </div>
            ) : (
              <p style={{ margin: 0, color: theme.text.muted }}>Loading dashboard...</p>
            )}
          </Card>
        </div>
      )}

      {/* ============================================================ */}
      {/*  TAB: Clock In / Out                                         */}
      {/* ============================================================ */}
      {activeTab === "clock" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["4"], maxWidth: 960 }}>
          <Card
            title={openRecord ? "You are clocked in" : "Clock In"}
            hint={
              openRecord
                ? `Opened at ${fmtTime(openRecord.clockInAt)} \u00b7 ${openRecord.shiftName || openRecord.shiftCode || ""}`
                : "Select your shift for today, then clock in."
            }
          >
            {openRecord ? (
              <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["3"] }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: theme.spacing["2"],
                    color: theme.action.success,
                    fontSize: theme.fontSize.lg,
                    fontWeight: theme.fontWeight.semibold,
                  }}
                >
                  <Icon name="check" size={18} />
                  Active session
                </div>
                <FormField label="Notes (optional)">
                  <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes for this shift..." />
                </FormField>
                <div>
                  <Button loading={busy} style={{ background: theme.action.danger }} onClick={() => void handleClockOut()}>
                    Clock Out
                  </Button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["3"] }}>
                <FormField label="Shift" required>
                  <Select required value={selectedShift} onChange={(e) => setSelectedShift(e.target.value)}>
                    <option value="">Select shift\u2026</option>
                    {shifts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.startTime}\u2013{s.endTime}){s.isNight ? " \u00b7 Night" : ""}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Work date">
                  <Input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
                </FormField>
                <FormField label="Notes (optional)">
                  <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes for this shift..." />
                </FormField>
                <div>
                  <Button loading={busy} style={{ background: theme.action.success }} onClick={() => void handleClockIn()}>
                    Clock In
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <Card title="Available Shifts" hint="Shift definitions used for clock-in.">
            {loading ? (
              <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>Loading shifts\u2026</p>
            ) : shifts.length === 0 ? (
              <EmptyState icon="calendar" description="No shift definitions configured yet." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["2"] }}>
                {shifts.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: `${theme.spacing["2"]} ${theme.spacing["3"]}`,
                      borderRadius: theme.radius.md,
                      border: `1px solid ${theme.surface.border}`,
                      background: theme.surface.subtle,
                      fontSize: theme.fontSize.base,
                    }}
                  >
                    <div>
                      <strong style={{ color: theme.text.primary }}>{s.name}</strong>
                      <span style={{ marginLeft: theme.spacing["2"], color: theme.text.muted, fontSize: theme.fontSize.sm }}>{s.code}</span>
                    </div>
                    <span style={{ color: theme.text.secondary }}>
                      {s.startTime}\u2013{s.endTime}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ============================================================ */}
      {/*  TAB: Leave Requests                                         */}
      {/* ============================================================ */}
      {activeTab === "leave" && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
          <Card title="Request Leave" hint="Submit a new leave request for review.">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: theme.spacing["3"], maxWidth: 800 }}>
              <FormField label="Leave Type" required>
                <Select value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
                  <option value="annual">Annual Leave</option>
                  <option value="sick">Sick Leave</option>
                  <option value="maternity">Maternity Leave</option>
                  <option value="paternity">Paternity Leave</option>
                  <option value="compassionate">Compassionate Leave</option>
                  <option value="study">Study Leave</option>
                  <option value="other">Other</option>
                </Select>
              </FormField>
              <FormField label="Start Date" required>
                <Input type="date" value={leaveStart} onChange={(e) => setLeaveStart(e.target.value)} />
              </FormField>
              <FormField label="End Date" required>
                <Input type="date" value={leaveEnd} onChange={(e) => setLeaveEnd(e.target.value)} />
              </FormField>
            </div>
            <FormField label="Reason" required style={{ maxWidth: 800, marginTop: theme.spacing["3"] }}>
              <Textarea rows={3} value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)} placeholder="Describe the reason for your leave request..." />
            </FormField>
            <div style={{ marginTop: theme.spacing["3"] }}>
              <Button loading={busy} onClick={() => void handleCreateLeaveRequest()}>
                Submit Leave Request
              </Button>
            </div>
          </Card>

          <Card bodyStyle={{ padding: 0 }}>
            <div style={{ padding: `${theme.spacing["3"]} ${theme.spacing["4"]}`, borderBottom: `1px solid ${theme.surface.border}` }}>
              <strong style={{ color: theme.text.primary }}>Leave Requests</strong>
              <span style={{ marginLeft: theme.spacing["2"], color: theme.text.muted, fontSize: theme.fontSize.sm }}>
                ({leaveRequests.length} total)
              </span>
            </div>
            {loading ? (
              <p style={{ padding: theme.spacing["4"], color: theme.text.muted, fontSize: theme.fontSize.base }}>Loading leave requests\u2026</p>
            ) : leaveRequests.length === 0 ? (
              <EmptyState icon="book" description="No leave requests found." />
            ) : (
              <DataTable columns={leaveColumns} rows={leaveRequests} rowKey={(r) => r.id} dense />
            )}
          </Card>
        </div>
      )}

      {/* ============================================================ */}
      {/*  TAB: Records                                                */}
      {/* ============================================================ */}
      {activeTab === "records" && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
          <Card bodyStyle={{ padding: theme.spacing["4"] }}>
            <div style={{ display: "flex", gap: theme.spacing["3"], alignItems: "flex-end", maxWidth: 320 }}>
              <FormField label="Filter by date">
                <Input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} />
              </FormField>
            </div>
          </Card>
          <Card bodyStyle={{ padding: 0 }}>
            {loading ? (
              <p style={{ padding: theme.spacing["4"], color: theme.text.muted, fontSize: theme.fontSize.base }}>Loading attendance\u2026</p>
            ) : records.length === 0 ? (
              <EmptyState icon="calendar" description="No attendance records for this date." />
            ) : (
              <DataTable columns={recordsColumns} rows={records} rowKey={(r) => r.id} dense />
            )}
          </Card>
        </div>
      )}

      {/* ============================================================ */}
      {/*  TAB: Analytics                                              */}
      {/* ============================================================ */}
      {activeTab === "analytics" && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
          <Card title="Attendance Analytics" hint="Daily report and attendance patterns.">
            <div style={{ display: "flex", gap: theme.spacing["3"], alignItems: "flex-end", maxWidth: 320, marginBottom: theme.spacing["4"] }}>
              <FormField label="Report date">
                <Input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
              </FormField>
            </div>

            {/* Summary row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: theme.spacing["3"], marginBottom: theme.spacing["4"] }}>
              <div style={{ padding: theme.spacing["3"], background: `${theme.action.success}10`, borderRadius: theme.radius.md, textAlign: "center" }}>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted }}>Present</div>
                <div style={{ fontSize: theme.fontSize.xl, fontWeight: theme.fontWeight.bold, color: theme.action.success }}>
                  {reportRows.filter((r) => r.status === "clocked_in" || r.status === "completed").length}
                </div>
              </div>
              <div style={{ padding: theme.spacing["3"], background: `${theme.action.danger}10`, borderRadius: theme.radius.md, textAlign: "center" }}>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted }}>Absent</div>
                <div style={{ fontSize: theme.fontSize.xl, fontWeight: theme.fontWeight.bold, color: theme.action.danger }}>
                  {reportRows.filter((r) => r.status === "absent" || (!r.clockInAt && r.status !== "clocked_in")).length}
                </div>
              </div>
              <div style={{ padding: theme.spacing["3"], background: "#f59e0b15", borderRadius: theme.radius.md, textAlign: "center" }}>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted }}>Late</div>
                <div style={{ fontSize: theme.fontSize.xl, fontWeight: theme.fontWeight.bold, color: "#f59e0b" }}>
                  {reportRows.filter((r) => r.clockInAt && new Date(r.clockInAt).getHours() >= 9).length}
                </div>
              </div>
              <div style={{ padding: theme.spacing["3"], background: `${theme.action.primary}10`, borderRadius: theme.radius.md, textAlign: "center" }}>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted }}>Total</div>
                <div style={{ fontSize: theme.fontSize.xl, fontWeight: theme.fontWeight.bold, color: theme.action.primary }}>
                  {reportRows.length}
                </div>
              </div>
            </div>
          </Card>

          <Card bodyStyle={{ padding: 0 }}>
            <div style={{ padding: `${theme.spacing["3"]} ${theme.spacing["4"]}`, borderBottom: `1px solid ${theme.surface.border}` }}>
              <strong style={{ color: theme.text.primary }}>Daily Attendance Report</strong>
              <span style={{ marginLeft: theme.spacing["2"], color: theme.text.muted, fontSize: theme.fontSize.sm }}>
                \u2014 {fmtDate(reportDate)}
              </span>
            </div>
            {loading ? (
              <p style={{ padding: theme.spacing["4"], color: theme.text.muted }}>Loading report\u2026</p>
            ) : reportRows.length === 0 ? (
              <EmptyState icon="book" description="No attendance report data for this date." />
            ) : (
              <DataTable columns={reportColumns} rows={reportRows} rowKey={(r) => r.staffId} dense />
            )}
          </Card>
        </div>
      )}

      {/* ============================================================ */}
      {/*  TAB: Export                                                 */}
      {/* ============================================================ */}
      {activeTab === "export" && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"], maxWidth: 480 }}>
          <Card title="Export Attendance Data" hint="Download attendance records as a CSV file for a given month.">
            <FormField label="Month" required>
              <Input type="month" value={exportMonth} onChange={(e) => setExportMonth(e.target.value)} />
            </FormField>
            <div style={{ marginTop: theme.spacing["4"] }}>
              <Button loading={busy} onClick={() => void handleExport()}>
                <Icon name="clipboard" size={16} style={{ marginRight: theme.spacing["1"] }} />
                Export CSV
              </Button>
            </div>
            <p style={{ margin: 0, marginTop: theme.spacing["3"], fontSize: theme.fontSize.sm, color: theme.text.muted }}>
              The export includes staff name, employee number, department, shift, clock in/out times, status, late flag, overtime, and notes.
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}
