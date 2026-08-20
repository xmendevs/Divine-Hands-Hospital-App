import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import {
  theme,
  Button,
  Card,
  EmptyState,
  FormField,
  Icon,
  Input,
  PageHeader,
  Select,
  StatusBadge,
  TabNav,
  useConfirm,
  useToast,
  type IconName,
  type StatusVariant,
} from "@hims/ui";
import { apiFetch } from "../api/client";

/* ── Types ───────────────────────────────────────────────────────────────── */

interface StaffShift {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  lateGraceMinutes: number;
  isNight: boolean;
}

interface RosterAssignment {
  id: string;
  staffId: string;
  staffName: string;
  employeeNo: string;
  shiftId: string;
  shiftName: string;
  shiftCode: string;
  workDate: string;
}

interface RosterPlan {
  id: string;
  planNo: string;
  name: string;
  departmentName: string;
  startDate: string;
  endDate: string;
  status: string;
  version: number;
  rejectedReason: string;
  isPublished: boolean;
  shiftRequirements: { shiftId: string; required: number }[];
  assignments: RosterAssignment[];
  unmet: { shiftName: string; required: number; missing: number }[];
}

interface Department {
  id: string;
  code: string;
  name: string;
}

interface RosterDashboard {
  totalStaff: number;
  shiftCount: number;
  activePlans: number;
  approvedPlans: number;
  pendingPlans: number;
  todayAssignments: number;
  shiftBreakdown: { shiftId: string; shiftName: string; assigned: number }[];
}

interface CalendarEvent {
  id: string;
  staffId: string;
  staffName: string;
  employeeNo: string;
  shiftId: string;
  shiftName: string;
  shiftCode: string;
  workDate: string;
  color: string;
}

interface AvailabilityItem {
  staffId: string;
  staffName: string;
  employeeNo: string;
  shiftPreferences: { shiftId: string; shiftName: string; rank: number }[];
  unavailability: { id: string; staffId: string; workDate: string; reason: string }[];
}

type TabKey = "dashboard" | "shifts" | "calendar" | "plans" | "generator" | "availability";

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function monthEnd() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

function planBadge(status: string): StatusVariant {
  if (status === "approved") return "approved";
  if (status === "submitted") return "submitted";
  if (status === "rejected") return "error";
  return "draft";
}

function StatCard({ icon, label, value, color }: { icon: IconName; label: string; value: string | number; color?: string }) {
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: theme.spacing["3"] }}>
        <div style={{ width: 44, height: 44, borderRadius: theme.radius.md, background: `${color || theme.action.primary}18`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name={icon} size={20} style={{ color: color || theme.action.primary }} />
        </div>
        <div>
          <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, fontWeight: theme.fontWeight.medium }}>{label}</div>
          <div style={{ fontSize: theme.fontSize.xl, fontWeight: theme.fontWeight.bold, color: theme.text.primary, lineHeight: 1.2 }}>{value}</div>
        </div>
      </div>
    </Card>
  );
}

/* ── Roster Matrix Grid (Staff x Days) ───────────────────────────────────── */

const SHIFT_STYLE: Record<string, { bg: string; border: string; fg: string; label: string }> = {
  Morning: { bg: "#dcfce7", border: "#22c55e", fg: "#166534", label: "M" },
  Afternoon: { bg: "#dbeafe", border: "#3b82f6", fg: "#1e40af", label: "A" },
  Night: { bg: "#f3e8ff", border: "#8b5cf6", fg: "#6b21a8", label: "N" },
};
const OFF_CELL = { bg: "#f8fafc", border: "#e2e8f0", fg: "#94a3b8", label: "OFF" };
const CELL_W = 40;
const CELL_H = 32;

function RosterMatrixGrid({ plan, shifts: allShifts, onCellClick }: { plan: RosterPlan; shifts: StaffShift[]; onCellClick?: (staffId: string, shiftId: string, workDate: string) => void }) {
  const assignments = plan.assignments ?? [];

  const days = useMemo(() => {
    const r: string[] = [];
    const s = new Date(plan.startDate + "T00:00:00");
    const e = new Date(plan.endDate + "T00:00:00");
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) r.push(d.toISOString().slice(0, 10));
    return r;
  }, [plan.startDate, plan.endDate]);

  const staffList = useMemo(() => {
    const m = new Map<string, { name: string; employeeNo: string }>();
    for (const a of assignments) if (!m.has(a.staffId)) m.set(a.staffId, { name: a.staffName, employeeNo: a.employeeNo });
    return Array.from(m.entries()).sort(([, a], [, b]) => a.name.localeCompare(b.name));
  }, [assignments]);

  const lookup = useMemo(() => {
    const m = new Map<string, RosterAssignment>();
    for (const a of assignments) m.set(`${a.staffId}|${a.workDate}`, a);
    return m;
  }, [assignments]);

  function isWE(d: string) { const w = new Date(d + "T00:00:00").getDay(); return w === 0 || w === 6; }
  function dl(d: string) {
    const dt = new Date(d + "T00:00:00");
    return { wk: dt.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 2), dd: dt.getDate(), mm: dt.toLocaleDateString("en-US", { month: "short" }).slice(0, 3) };
  }

  if (staffList.length === 0) return <p style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>No assignments generated yet.</p>;

  // Cycle through shifts: current -> next -> OFF -> first shift
  function cycleShift(staffId: string, workDate: string) {
    if (!onCellClick || !allShifts.length) return;
    const key = `${staffId}|${workDate}`;
    const cur = lookup.get(key);
    if (!cur) {
      // OFF -> assign first shift
      onCellClick(staffId, allShifts[0].id, workDate);
    } else {
      const idx = allShifts.findIndex((s) => s.id === cur.shiftId);
      const nextIdx = idx + 1;
      if (nextIdx < allShifts.length) {
        onCellClick(staffId, allShifts[nextIdx].id, workDate);
      } else {
        // last shift -> remove (go to OFF)
        onCellClick(staffId, "__OFF__", workDate);
      }
    }
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
        <Icon name="chat" size={14} /> Click any cell to cycle shift (Morning → Afternoon → Night → OFF)
      </div>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: theme.fontSize.xs }}>
        <thead>
          <tr>
            <th style={{ position: "sticky", left: 0, zIndex: 2, background: theme.surface.card, padding: "6px 8px", textAlign: "left", fontWeight: 600, color: theme.text.primary, borderBottom: `2px solid ${theme.surface.border}`, minWidth: 150 }}>Staff</th>
            {days.map((d) => {
              const l = dl(d); const we = isWE(d);
              return (
                <th key={d} style={{ padding: "4px 2px", textAlign: "center", fontWeight: 600, color: we ? "#b45309" : theme.text.secondary, borderBottom: `2px solid ${theme.surface.border}`, minWidth: CELL_W, background: we ? "#fef3c7" : theme.surface.card }}>
                  <div style={{ lineHeight: 1.1 }}>{l.wk}</div>
                  <div style={{ lineHeight: 1.1, fontSize: 12 }}>{l.dd}</div>
                  <div style={{ lineHeight: 1.1, fontSize: 9, color: theme.text.muted }}>{l.mm}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {staffList.map(([sid, st]) => (
            <tr key={sid}>
              <td style={{ position: "sticky", left: 0, zIndex: 1, background: theme.surface.card, padding: "4px 8px", borderBottom: `1px solid ${theme.surface.border}`, fontWeight: 500, color: theme.text.primary }}>
                <div style={{ whiteSpace: "nowrap" }}>{st.name}</div>
                <div style={{ fontSize: 10, color: theme.text.muted }}>{st.employeeNo}</div>
              </td>
              {days.map((d) => {
                const a = lookup.get(`${sid}|${d}`);
                const we = isWE(d);
                if (a) {
                  const s = SHIFT_STYLE[a.shiftName] || { bg: "#f1f5f9", border: "#94a3b8", fg: "#475569", label: "?" };
                  return (
                    <td key={d} style={{ padding: 2, textAlign: "center", borderBottom: `1px solid ${theme.surface.border}`, background: we ? "#fef3c7" : undefined }}>
                      <div title={`${a.shiftName} (${a.shiftCode}) — click to change`} onClick={() => cycleShift(sid, d)} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: CELL_W - 8, height: CELL_H - 4, borderRadius: 4, background: s.bg, border: `1px solid ${s.border}50`, color: s.fg, fontWeight: 700, fontSize: 13, cursor: onCellClick ? "pointer" : "default" }}>{s.label}</div>
                    </td>
                  );
                }
                return (
                  <td key={d} style={{ padding: 2, textAlign: "center", borderBottom: `1px solid ${theme.surface.border}`, background: we ? "#fef3c7" : undefined }}>
                    <div onClick={() => cycleShift(sid, d)} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: CELL_W - 8, height: CELL_H - 4, borderRadius: 4, background: OFF_CELL.bg, border: `1px solid ${OFF_CELL.border}50`, color: OFF_CELL.fg, fontSize: 9, cursor: onCellClick ? "pointer" : "default" }}>OFF</div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {/* Legend */}
      <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
        {Object.entries(SHIFT_STYLE).map(([n, s]) => (
          <div key={n} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
            <div style={{ width: 22, height: 18, borderRadius: 4, background: s.bg, border: `1px solid ${s.border}50`, display: "flex", alignItems: "center", justifyContent: "center", color: s.fg, fontWeight: 700, fontSize: 11 }}>{s.label}</div>
            <span style={{ color: theme.text.secondary }}>{n}</span>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
          <div style={{ width: 22, height: 18, borderRadius: 4, background: OFF_CELL.bg, border: `1px solid ${OFF_CELL.border}50`, display: "flex", alignItems: "center", justifyContent: "center", color: OFF_CELL.fg, fontSize: 9 }}>OFF</div>
          <span style={{ color: theme.text.secondary }}>Off Duty</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
          <div style={{ width: 22, height: 18, borderRadius: 4, background: "#fef3c7", border: "1px solid #fcd34d50", display: "flex", alignItems: "center", justifyContent: "center", color: "#92400e", fontSize: 9 }}>W</div>
          <span style={{ color: theme.text.secondary }}>Weekend</span>
        </div>
      </div>
    </div>
  );
}

/* ── Manual Adjust Section ───────────────────────────────────────────────── */

function ManualAdjustSection({ plan, shifts, allStaff, onDone }: {
  plan: RosterPlan; shifts: StaffShift[];
  allStaff: { id: string; firstName: string; lastName: string; employeeNo: string; departmentName: string; shiftTag: string }[];
  onDone: () => void;
}) {
  const [staffId, setStaffId] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [workDate, setWorkDate] = useState(plan.startDate);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function handleAdjust() {
    if (!staffId || !shiftId || !workDate) { toast.error("Select staff, shift, and date."); return; }
    setSaving(true);
    try {
      await apiFetch(`/roster/plans/${plan.id}/assignments/manual`, { method: "POST", body: JSON.stringify({ staffId, shiftId, workDate }) });
      toast.success("Shift adjusted.");
      onDone();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Adjust failed."); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ marginTop: 12, padding: "12px 16px", background: theme.surface.subtle, borderRadius: theme.radius.md, border: `1px solid ${theme.surface.border}` }}>
      <div style={{ fontSize: theme.fontSize.sm, fontWeight: 600, color: theme.text.secondary, marginBottom: 8 }}>Manual Shift Adjustment</div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 150 }}><div style={{ fontSize: 10, color: theme.text.muted, marginBottom: 2 }}>Staff</div><Select value={staffId} onChange={(e) => setStaffId(e.target.value)} style={{ width: "100%" }}><option value="">Select staff...</option>{allStaff.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>)}</Select></div>
        <div style={{ flex: 1, minWidth: 150 }}><div style={{ fontSize: 10, color: theme.text.muted, marginBottom: 2 }}>Shift</div><Select value={shiftId} onChange={(e) => setShiftId(e.target.value)} style={{ width: "100%" }}><option value="">Select shift...</option>{shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.startTime}-{s.endTime})</option>)}</Select></div>
        <div style={{ flex: 1, minWidth: 130 }}><div style={{ fontSize: 10, color: theme.text.muted, marginBottom: 2 }}>Date</div><Input type="date" min={plan.startDate} max={plan.endDate} value={workDate} onChange={(e) => setWorkDate(e.target.value)} /></div>
        <Button size="sm" loading={saving} onClick={() => void handleAdjust()}>Apply</Button>
      </div>
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────────────────────── */

export default function RosterPage() {
  const { me } = useAuth();
  const isAdmin = useMemo(() => me?.roles?.some((r) => r.code === "super_admin" || r.code === "admin" || r.code === "matron" || r.code === "billing_supervisor" || r.code === "lab_supervisor" || r.code === "storekeeper") ?? false, [me]);
  const isSuperAdmin = useMemo(() => me?.roles?.some((r) => r.code === "super_admin") ?? false, [me]);

  const [activeTab, setActiveTab] = useState<TabKey>(isAdmin ? "dashboard" : "calendar");

  const [plans, setPlans] = useState<RosterPlan[]>([]);
  const [shifts, setShifts] = useState<StaffShift[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [dashboard, setDashboard] = useState<RosterDashboard | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [availability, setAvailability] = useState<AvailabilityItem[]>([]);
  const [allStaff, setAllStaff] = useState<{ id: string; firstName: string; lastName: string; employeeNo: string; departmentName: string; shiftTag: string }[]>([]);

  const [calFrom, setCalFrom] = useState(monthStart());
  const [calTo, setCalTo] = useState(monthEnd());

  const EMPTY_FORM = { name: "", departmentId: "", startDate: "", endDate: "", requirements: [] as { shiftId: string; required: string }[] };
  const [planForm, setPlanForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [shiftForm, setShiftForm] = useState({ code: "", name: "", startTime: "08:00", endTime: "16:00", lateGraceMinutes: 15, isNight: false });
  const [editingShift, setEditingShift] = useState<string | null>(null);

  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [selectedShiftScopes, setSelectedShiftScopes] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();

  /* ── Data loading ────────────────────────────────────────────────────── */

  const loadAll = useCallback(async () => {
    setLoading(true);
    const tasks: Promise<void>[] = [];
    if (isAdmin) {
      tasks.push(
        apiFetch<RosterPlan[]>("/roster/plans").then(setPlans).catch(() => {}),
        apiFetch<RosterDashboard>("/roster/dashboard").then(setDashboard).catch(() => {}),
        apiFetch<StaffShift[]>("/shifts").then(setShifts).catch(() => {}),
        apiFetch<Department[]>("/admin/departments").then((d) => setDepartments(d ?? [])).catch(() => {}),
        apiFetch<{ id: string; firstName: string; lastName: string; employeeNo: string; departmentName: string; shiftTag: string }[]>("/staff").then(setAllStaff).catch(() => {}),
      );
    } else {
      tasks.push(apiFetch<StaffShift[]>("/shifts").then(setShifts).catch(() => {}));
    }
    await Promise.allSettled(tasks);
    setLoading(false);
  }, [isAdmin]);

  const loadCalendar = useCallback(async () => {
    try { setCalendarEvents(await apiFetch<CalendarEvent[]>(`/roster/calendar?from=${calFrom}&to=${calTo}`)); } catch { /* */ }
  }, [calFrom, calTo]);

  const loadAvailability = useCallback(async () => {
    try { setAvailability(await apiFetch<AvailabilityItem[]>("/staff/availability")); } catch { /* */ }
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);
  useEffect(() => { if (activeTab === "calendar") void loadCalendar(); }, [activeTab, loadCalendar]);
  useEffect(() => { if (activeTab === "availability") void loadAvailability(); }, [activeTab, loadAvailability]);

  /* When Plans tab is active, enrich each plan with full assignments for the matrix grid */
  useEffect(() => {
    if (activeTab !== "plans" || !isAdmin || plans.length === 0) return;
    let cancelled = false;
    (async () => {
      const enriched = await Promise.all(
        plans.map(async (p) => {
          if (p.assignments && p.assignments.length > 0) return p; // already loaded
          try {
            const full = await apiFetch<RosterPlan>(`/roster/plans/${p.id}`);
            return full;
          } catch { return p; }
        })
      );
      if (!cancelled) setPlans(enriched);
    })();
    return () => { cancelled = true; };
  }, [activeTab, isAdmin, plans.length]);

  /* ── Plan actions ────────────────────────────────────────────────────── */

  async function planAction(plan: RosterPlan, fn: (id: string) => Promise<unknown>, msg?: string) {
    setBusyId(plan.id); setError("");
    try { await fn(plan.id); await loadAll(); if (msg) toast.success(msg); }
    catch (err) { const m = err instanceof Error ? err.message : "Action failed."; setError(m); toast.error(m); }
    finally { setBusyId(null); }
  }

  async function rejectPlan(plan: RosterPlan) {
    const ok = await confirm({ title: `Reject ${plan.planNo}?`, message: "The plan will be returned to draft.", confirmLabel: "Reject", danger: true, icon: "warning" });
    if (!ok) return;
    const reason = window.prompt(`Reason for rejecting ${plan.planNo}?`)?.trim();
    if (!reason) return;
    await planAction(plan, (id) => apiFetch(`/roster/plans/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }), `${plan.planNo} rejected.`);
  }

  async function handleCreatePlan(e: FormEvent) {
    e.preventDefault();
    const reqs = planForm.requirements.map((r) => ({ shiftId: r.shiftId, required: Number(r.required) })).filter((r) => r.shiftId && r.required > 0);
    if (reqs.length === 0) { setError("Add at least one shift requirement."); return; }
    if (!planForm.departmentId) { setError("Select a department."); return; }
    setSaving(true); setError("");
    try {
      await apiFetch("/roster/plans", { method: "POST", body: JSON.stringify({ name: planForm.name || `Roster ${planForm.startDate}`, departmentId: planForm.departmentId, startDate: planForm.startDate, endDate: planForm.endDate, shiftRequirements: reqs }) });
      setPlanForm(EMPTY_FORM); await loadAll(); setActiveTab("plans"); toast.success("Roster plan generated.");
    } catch (err) { const m = err instanceof Error ? err.message : "Could not create plan."; setError(m); toast.error(m); }
    finally { setSaving(false); }
  }

  async function handleSaveShift() {
    if (!shiftForm.code || !shiftForm.name) { setError("Code and name are required."); return; }
    try {
      if (editingShift) { await apiFetch(`/shifts/${editingShift}`, { method: "PUT", body: JSON.stringify(shiftForm) }); toast.success("Shift updated."); }
      else { await apiFetch("/shifts", { method: "POST", body: JSON.stringify(shiftForm) }); toast.success("Shift created."); }
      setShiftForm({ code: "", name: "", startTime: "08:00", endTime: "16:00", lateGraceMinutes: 15, isNight: false }); setEditingShift(null); await loadAll();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Shift save failed."); }
  }

  function editShift(sh: StaffShift) { setEditingShift(sh.id); setShiftForm({ code: sh.code, name: sh.name, startTime: sh.startTime, endTime: sh.endTime, lateGraceMinutes: sh.lateGraceMinutes, isNight: sh.isNight }); }

  /* ── Calendar helpers ────────────────────────────────────────────────── */

  function getCalendarDays() {
    const [y, m] = calFrom.split("-").map(Number);
    const firstDay = new Date(y, m - 1, 1).getDay();
    const daysInMonth = new Date(y, m, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }

  function eventsForDay(day: number) {
    const [y, m] = calFrom.split("-").map(Number);
    const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return calendarEvents.filter((e) => e.workDate === dateStr);
  }

  /* ── Render: Dashboard ───────────────────────────────────────────────── */
  function renderDashboard() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <StatCard icon="users" label="Total Staff" value={dashboard?.totalStaff ?? "\u2014"} color={theme.action.primary} />
          <StatCard icon="clock" label="Shifts Defined" value={dashboard?.shiftCount ?? 0} color="#06b6d4" />
          <StatCard icon="calendar" label="Active Plans" value={dashboard?.activePlans ?? 0} color="#f59e0b" />
          <StatCard icon="check" label="Approved Plans" value={dashboard?.approvedPlans ?? 0} color={theme.action.success} />
          <StatCard icon="clipboard" label="Today's Assignments" value={dashboard?.todayAssignments ?? 0} color="#8b5cf6" />
        </div>
        {dashboard && dashboard.shiftBreakdown.length > 0 && (
          <Card title="Shift Coverage (Today)">
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {dashboard.shiftBreakdown.map((sb) => (
                <div key={sb.shiftId} style={{ padding: 12, background: theme.surface.subtle, borderRadius: theme.radius.md, minWidth: 140, textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: theme.text.muted }}>{sb.shiftName}</div>
                  <div style={{ fontSize: theme.fontSize.xl, fontWeight: 700, color: theme.text.primary }}>{sb.assigned}</div>
                  <div style={{ fontSize: 10, color: theme.text.muted }}>staff assigned</div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    );
  }

  /* ── Render: Shifts ──────────────────────────────────────────────────── */
  function renderShifts() {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, maxWidth: 960 }}>
        <Card title={editingShift ? "Edit Shift" : "Create Shift"}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <FormField label="Code" required><Input value={shiftForm.code} onChange={(e) => setShiftForm({ ...shiftForm, code: e.target.value })} placeholder="e.g. MOR" /></FormField>
              <FormField label="Name" required><Input value={shiftForm.name} onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })} placeholder="e.g. Morning" /></FormField>
              <FormField label="Start Time" required><Input type="time" value={shiftForm.startTime} onChange={(e) => setShiftForm({ ...shiftForm, startTime: e.target.value })} /></FormField>
              <FormField label="End Time" required><Input type="time" value={shiftForm.endTime} onChange={(e) => setShiftForm({ ...shiftForm, endTime: e.target.value })} /></FormField>
              <FormField label="Late Grace (min)"><Input type="number" min={0} value={shiftForm.lateGraceMinutes} onChange={(e) => setShiftForm({ ...shiftForm, lateGraceMinutes: Number(e.target.value) })} /></FormField>
              <FormField label="Night Shift"><div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 6 }}><input type="checkbox" checked={shiftForm.isNight} onChange={(e) => setShiftForm({ ...shiftForm, isNight: e.target.checked })} /><span style={{ fontSize: 12, color: theme.text.secondary }}>Mark as night shift</span></div></FormField>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button onClick={() => void handleSaveShift()}>{editingShift ? "Update Shift" : "Create Shift"}</Button>
              {editingShift && <Button variant="outline" onClick={() => { setEditingShift(null); setShiftForm({ code: "", name: "", startTime: "08:00", endTime: "16:00", lateGraceMinutes: 15, isNight: false }); }}>Cancel</Button>}
            </div>
          </div>
        </Card>
        <Card title="Defined Shifts" hint={`${shifts.length} shifts`}>
          {shifts.length === 0 ? <EmptyState icon="clock" description="No shifts defined yet." /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {shifts.map((sh) => (
                <div key={sh.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderRadius: theme.radius.md, border: `1px solid ${theme.surface.border}`, background: theme.surface.subtle }}>
                  <div><strong style={{ color: theme.text.primary }}>{sh.name}</strong><span style={{ marginLeft: 8, color: theme.text.muted, fontSize: 12 }}>{sh.code}</span>{sh.isNight && <StatusBadge variant="error" label="Night" />}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ color: theme.text.secondary, fontSize: 12 }}>{sh.startTime}-{sh.endTime}</span><Button size="sm" variant="outline" onClick={() => editShift(sh)}>Edit</Button></div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    );
  }

  /* ── Render: Calendar ────────────────────────────────────────────────── */
  function renderCalendar() {
    const days = getCalendarDays();
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Card bodyStyle={{ padding: 12 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
            <FormField label="From"><Input type="date" value={calFrom} onChange={(e) => setCalFrom(e.target.value)} /></FormField>
            <FormField label="To"><Input type="date" value={calTo} onChange={(e) => setCalTo(e.target.value)} /></FormField>
            <Button size="sm" onClick={() => void loadCalendar()}>Load</Button>
          </div>
        </Card>
        <Card title="Roster Calendar" hint={`${calendarEvents.length} assignments`}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
            {dayNames.map((d) => <div key={d} style={{ padding: 4, textAlign: "center", fontSize: 10, fontWeight: 600, color: theme.text.muted }}>{d}</div>)}
            {days.map((day, i) => {
              const events = day ? eventsForDay(day) : [];
              return (
                <div key={i} style={{ minHeight: 80, padding: 4, border: `1px solid ${theme.surface.border}`, borderRadius: theme.radius.sm, background: day ? theme.surface.card : theme.surface.subtle }}>
                  {day && (<>
                    <div style={{ fontSize: 10, fontWeight: 700, color: theme.text.primary, marginBottom: 2 }}>{day}</div>
                    {events.slice(0, 3).map((ev) => <div key={ev.id} style={{ fontSize: 9, padding: "1px 4px", borderRadius: 3, background: `${ev.color}22`, color: ev.color, borderLeft: `3px solid ${ev.color}`, marginBottom: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.staffName} ({ev.shiftCode})</div>)}
                    {events.length > 3 && <div style={{ fontSize: 9, color: theme.text.muted }}>+{events.length - 3} more</div>}
                  </>)}
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    );
  }

  /* ── Render: Plans (with matrix grid) ────────────────────────────────── */
  function renderPlans() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {plans.length === 0 && <EmptyState icon="calendar" description="No roster plans yet. Use the Generator to create one." />}
        {plans.map((p) => (
          <Card key={p.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <div>
                <span style={{ fontWeight: 700, color: theme.text.primary, fontSize: theme.fontSize.lg }}>{p.name}</span>
                <span style={{ marginLeft: 12, fontSize: theme.fontSize.base, color: theme.text.muted }}>{p.planNo} v{p.version} {p.departmentName || ""}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <StatusBadge variant={planBadge(p.status)} label={p.status} />
                {p.isPublished && <StatusBadge variant="approved" label="Published" />}
                <span style={{ fontSize: theme.fontSize.base, color: theme.text.muted }}>{p.startDate} to {p.endDate}</span>
              </div>
            </div>
            {p.rejectedReason && <p style={{ margin: "0 0 12px", fontSize: theme.fontSize.base, color: theme.action.warning, background: theme.surface.warning, padding: "8px 12px", borderRadius: theme.radius.md }}>Rejected: {p.rejectedReason}</p>}

            {/* Unmet requirements */}
            {(p.unmet ?? []).length > 0 && (
              <div style={{ background: theme.surface.error, border: `1px solid ${theme.surface.errorBorder}`, borderRadius: theme.radius.md, padding: "8px 12px", fontSize: theme.fontSize.base, color: theme.text.dangerStrong, marginBottom: 12 }}>
                <strong>Unmet requirements: </strong>{(p.unmet ?? []).slice(0, 10).map((u) => `${u.shiftName || "shift"} missing ${u.missing}`).join(", ")}{(p.unmet ?? []).length > 10 ? ` ...and ${p.unmet.length - 10} more` : ""}
              </div>
            )}

            {/* Matrix Grid */}
            <div style={{ marginBottom: 12 }}>
              <RosterMatrixGrid plan={p} shifts={shifts} onCellClick={(staffId, shiftId, workDate) => { void (async () => { try { if (shiftId === "__OFF__") { await apiFetch(`/roster/plans/${p.id}/assignments/remove`, { method: "POST", body: JSON.stringify({ staffId, workDate }) }); } else { await apiFetch(`/roster/plans/${p.id}/assignments/manual`, { method: "POST", body: JSON.stringify({ staffId, shiftId, workDate }) }); } await loadAll(); } catch (err) { toast.error(err instanceof Error ? err.message : "Update failed."); } })(); }} />
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", borderTop: `1px solid ${theme.surface.border}`, paddingTop: 12 }}>
              {p.status === "draft" && (<>
                <Button size="sm" variant="outline" loading={busyId === p.id} onClick={() => planAction(p, (id) => apiFetch(`/roster/plans/${id}/regenerate`, { method: "POST" }), "Regenerated.")}>Regenerate</Button>
                <Button size="sm" loading={busyId === p.id} style={{ background: "#f59e0b" }} onClick={() => planAction(p, (id) => apiFetch(`/roster/plans/${id}/submit`, { method: "POST" }), "Submitted for approval.")}>Submit for Approval</Button>
              </>)}
              {p.status === "submitted" && isSuperAdmin && (<>
                <Button size="sm" loading={busyId === p.id} style={{ background: theme.action.success }} onClick={() => planAction(p, (id) => apiFetch(`/roster/plans/${id}/approve`, { method: "POST" }), "Approved.")}>Approve</Button>
                <Button size="sm" variant="danger" loading={busyId === p.id} onClick={() => void rejectPlan(p)}>Reject</Button>
              </>)}
              {p.status === "approved" && !p.isPublished && isSuperAdmin && (
                <Button size="sm" loading={busyId === p.id} style={{ background: theme.action.primary }} onClick={() => planAction(p, (id) => apiFetch(`/roster/plans/${id}/publish`, { method: "POST" }), "Validated & Published.")}>Validate & Publish</Button>
              )}
              {p.status === "approved" && (
                <Button size="sm" variant="outline" loading={busyId === p.id} onClick={() => planAction(p, (id) => apiFetch(`/roster/plans/${id}/amend`, { method: "POST" }), "Amended - new draft.")}>Amend</Button>
              )}
            </div>

            {/* Manual adjust for matron/superadmin */}
            {p.status === "approved" && (isSuperAdmin || me?.roles?.some((r) => r.code === "matron")) && (
              <ManualAdjustSection plan={p} shifts={shifts} allStaff={allStaff} onDone={() => void loadAll()} />
            )}
          </Card>
        ))}
      </div>
    );
  }

  /* ── Render: Generator ───────────────────────────────────────────────── */
  function renderGenerator() {
    return (
      <Card style={{ maxWidth: 900 }}>
        <form onSubmit={(e) => void handleCreatePlan(e)} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <h3 style={{ margin: 0, fontSize: theme.fontSize.lg, color: theme.text.primary }}>Monthly Roster Generator</h3>
          <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>Creates a draft plan enforcing rest periods, coverage, and staff shift tags.</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <FormField label="Plan name"><Input value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} placeholder="e.g. September Nursing Roster" /></FormField>
            <FormField label="Department" required><Select required value={planForm.departmentId} onChange={(e) => setPlanForm({ ...planForm, departmentId: e.target.value })}><option value="">Select department...</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></FormField>
            <FormField label="Start date" required><Input type="date" required value={planForm.startDate} onChange={(e) => setPlanForm({ ...planForm, startDate: e.target.value })} /></FormField>
            <FormField label="End date" required><Input type="date" required value={planForm.endDate} onChange={(e) => setPlanForm({ ...planForm, endDate: e.target.value })} /></FormField>
          </div>
          {/* Staff filter */}
          <div>
            <div style={{ fontSize: theme.fontSize.base, fontWeight: 600, color: theme.text.secondary, marginBottom: 8 }}>Staff Filter (leave empty for all staff in department)</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {allStaff.map((st) => (
                <label key={st.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, padding: "4px 8px", borderRadius: theme.radius.sm, border: `1px solid ${selectedStaffIds.includes(st.id) ? theme.action.primary : theme.surface.border}`, background: selectedStaffIds.includes(st.id) ? `${theme.action.primary}10` : theme.surface.subtle, cursor: "pointer" }}>
                  <input type="checkbox" checked={selectedStaffIds.includes(st.id)} onChange={(e) => { setSelectedStaffIds((prev) => e.target.checked ? [...prev, st.id] : prev.filter((id) => id !== st.id)); }} />
                  <span>{st.firstName} {st.lastName}</span>
                  <span style={{ fontSize: 10, color: theme.text.muted }}>({st.shiftTag})</span>
                  {st.departmentName && <span style={{ fontSize: 10, color: theme.action.primary }}>[{st.departmentName}]</span>}
                </label>
              ))}
            </div>
          </div>
          {/* Shift scope */}
          <div>
            <div style={{ fontSize: theme.fontSize.base, fontWeight: 600, color: theme.text.secondary, marginBottom: 8 }}>Shift Scope (leave empty for all)</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {shifts.map((sh) => (
                <label key={sh.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, padding: "4px 8px", borderRadius: theme.radius.sm, border: `1px solid ${selectedShiftScopes.includes(sh.id) ? theme.action.primary : theme.surface.border}`, background: selectedShiftScopes.includes(sh.id) ? `${theme.action.primary}10` : theme.surface.subtle, cursor: "pointer" }}>
                  <input type="checkbox" checked={selectedShiftScopes.includes(sh.id)} onChange={(e) => { setSelectedShiftScopes((prev) => e.target.checked ? [...prev, sh.id] : prev.filter((id) => id !== sh.id)); }} />
                  <span>{sh.name} ({sh.startTime}-{sh.endTime})</span>
                </label>
              ))}
            </div>
          </div>
          {/* Shift requirements */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: theme.fontSize.base, fontWeight: 600, color: theme.text.secondary }}>Shift requirements (staff needed per shift per day)</span>
              <Button type="button" size="sm" variant="outline" onClick={() => setPlanForm((prev) => ({ ...prev, requirements: [...prev.requirements, { shiftId: "", required: "1" }] }))}>+ Add Requirement</Button>
            </div>
            {planForm.requirements.map((r, idx) => (
              <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <Select value={r.shiftId} onChange={(e) => setPlanForm((prev) => ({ ...prev, requirements: prev.requirements.map((x, i) => i === idx ? { ...x, shiftId: e.target.value } : x) }))} style={{ flex: 1 }}>
                  <option value="">Select shift...</option>{shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.startTime}-{s.endTime})</option>)}
                </Select>
                <Input type="number" min={1} value={r.required} onChange={(e) => setPlanForm((prev) => ({ ...prev, requirements: prev.requirements.map((x, i) => i === idx ? { ...x, required: e.target.value } : x) }))} style={{ width: "5rem" }} />
                <Button type="button" variant="ghost" onClick={() => setPlanForm((prev) => ({ ...prev, requirements: prev.requirements.filter((_, i) => i !== idx) }))} aria-label="Remove">X</Button>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}><Button type="submit" loading={saving} style={{ background: theme.action.success }}>Generate Roster</Button></div>
        </form>
      </Card>
    );
  }

  /* ── Render: Availability ────────────────────────────────────────────── */
  function renderAvailability() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {availability.length === 0 ? <EmptyState icon="users" description="No staff availability data." /> : availability.map((item) => (
          <Card key={item.staffId}>
            <div style={{ marginBottom: 8 }}><strong style={{ color: theme.text.primary }}>{item.staffName}</strong><span style={{ marginLeft: 8, color: theme.text.muted, fontSize: 12 }}>{item.employeeNo}</span></div>
            {item.shiftPreferences.length > 0 ? (<div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, color: theme.text.muted, marginBottom: 4 }}>Preferred Shifts</div><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{item.shiftPreferences.map((sp) => <StatusBadge key={sp.shiftId} variant="submitted" label={`#${sp.rank} ${sp.shiftName}`} />)}</div></div>) : <p style={{ margin: 0, fontSize: 12, color: theme.text.muted }}>No shift preferences set.</p>}
            {item.unavailability.length > 0 && <div><div style={{ fontSize: 10, color: theme.text.muted, marginBottom: 4 }}>Unavailability</div><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{item.unavailability.map((u) => <span key={u.id} style={{ fontSize: 10, padding: "2px 8px", borderRadius: theme.radius.sm, background: `${theme.action.danger}15`, color: theme.action.danger }}>{u.workDate}{u.reason ? ` - ${u.reason}` : ""}</span>)}</div></div>}
          </Card>
        ))}
      </div>
    );
  }

  /* ── Main render ─────────────────────────────────────────────────────── */
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PageHeader
        title="Roster & Shifts"
        description={isAdmin ? "Enterprise roster management: scheduling, calendar, plans, and staff availability." : "View your shift schedule and set your availability preferences."}
        badge={dashboard ? <StatusBadge variant="running" label={`${dashboard.todayAssignments} assignments today`} /> : undefined}
      />
      <TabNav
        tabs={isAdmin ? [{ key: "dashboard", label: "Dashboard" }, { key: "shifts", label: "Shift Management" }, { key: "calendar", label: "Calendar View" }, { key: "plans", label: "Roster Plans" }, { key: "generator", label: "Generator" }, { key: "availability", label: "Availability" }] : [{ key: "calendar", label: "My Schedule" }, { key: "availability", label: "My Availability" }]}
        active={activeTab}
        onChange={(k) => { const next = k as TabKey; if (!isAdmin && (next === "dashboard" || next === "shifts" || next === "plans" || next === "generator")) return; setActiveTab(next); }}
      />
      {error && <p role="alert" style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.danger }}>{error}</p>}
      {loading && <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>Loading...</p>}
      {!loading && activeTab === "dashboard" && isAdmin && renderDashboard()}
      {!loading && activeTab === "shifts" && isAdmin && renderShifts()}
      {!loading && activeTab === "calendar" && renderCalendar()}
      {!loading && activeTab === "plans" && isAdmin && renderPlans()}
      {!loading && activeTab === "generator" && isAdmin && renderGenerator()}
      {!loading && activeTab === "availability" && renderAvailability()}
      {confirmDialog}
    </div>
  );
}
