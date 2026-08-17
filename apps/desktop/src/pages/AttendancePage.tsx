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
  type StatusVariant,
} from "@hims/ui";
import { apiFetch } from "../api/client";

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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtTime(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function statusVariant(status: string): StatusVariant {
  if (status === "clocked_in") return "running";
  if (status === "completed") return "approved";
  return "draft";
}

export default function AttendancePage() {
  const [activeTab, setActiveTab] = useState<"clock" | "records" | "report">("clock");

  const [shifts, setShifts] = useState<StaffShift[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [reportRows, setReportRows] = useState<ReportRow[]>([]);

  const [selectedShift, setSelectedShift] = useState("");
  const [workDate, setWorkDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [filterDate, setFilterDate] = useState(today());
  const [reportDate, setReportDate] = useState(today());

  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const openRecord = useMemo(() => records.find((r) => r.status === "clocked_in"), [records]);

  const loadShifts = useCallback(async () => {
    try {
      const results = await apiFetch<StaffShift[]>("/attendance/shifts");
      setShifts(results);
      setSelectedShift((prev) => prev || results[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load shift definitions.");
    }
  }, []);

  const loadRecords = useCallback(async () => {
    try {
      const results = await apiFetch<AttendanceRecord[]>(
        `/attendance?date=${encodeURIComponent(filterDate)}`,
      );
      setRecords(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load attendance records.");
    }
  }, [filterDate]);

  const loadReport = useCallback(async () => {
    try {
      const results = await apiFetch<ReportRow[]>(
        `/attendance/report?date=${encodeURIComponent(reportDate)}`,
      );
      setReportRows(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the attendance report.");
    }
  }, [reportDate]);

  useEffect(() => {
    setLoading(true);
    void (async () => {
      await Promise.allSettled([loadShifts(), loadRecords(), loadReport()]);
      setLoading(false);
    })();
  }, [loadShifts, loadRecords, loadReport]);

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
        body: JSON.stringify({
          shiftId: selectedShift,
          workDate,
          method: "manual",
          device: "desktop",
          notes: notes.trim(),
        }),
      });
      setNotes("");
      await loadRecords();
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
      await loadRecords();
      toast.success("Clocked out successfully.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not clock out.";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  const recordsColumns = [
    {
      key: "staff",
      header: "Staff",
      render: (r: AttendanceRecord) => (
        <strong style={{ color: theme.text.primary }}>{r.staffName || r.staffId}</strong>
      ),
    },
    {
      key: "shift",
      header: "Shift",
      render: (r: AttendanceRecord) => r.shiftName || r.shiftCode || "—",
    },
    {
      key: "department",
      header: "Department",
      render: (r: AttendanceRecord) => r.departmentName || "—",
    },
    { key: "in", header: "Clock In", render: (r: AttendanceRecord) => fmtTime(r.clockInAt) },
    { key: "out", header: "Clock Out", render: (r: AttendanceRecord) => fmtTime(r.clockOutAt) },
    {
      key: "flags",
      header: "Flags",
      render: (r: AttendanceRecord) => (
        <div style={{ display: "flex", gap: theme.spacing["1"], flexWrap: "wrap" }}>
          {r.isLate && <StatusBadge variant="running" label="Late" />}
          {r.isEarlyLeave && <StatusBadge variant="draft" label="Early" />}
          {!r.isLate && !r.isEarlyLeave && <span style={{ color: theme.text.muted }}>—</span>}
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

  const reportColumns = [
    { key: "staff", header: "Staff", render: (r: ReportRow) => <strong>{r.staffName}</strong> },
    { key: "no", header: "Employee No", render: (r: ReportRow) => r.employeeNo || "—" },
    { key: "department", header: "Department", render: (r: ReportRow) => r.department || "—" },
    { key: "shift", header: "Shift", render: (r: ReportRow) => r.shiftName || "—" },
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}>
      <PageHeader
        title="Attendance & Clock In/Out"
        description="Staff clock-in/out, daily attendance records, and the per-day attendance report."
        badge={openRecord ? <StatusBadge variant="running" label="Clocked In" /> : undefined}
      />

      <TabNav
        tabs={[
          { key: "clock", label: "Clock In / Out" },
          { key: "records", label: "Attendance Records" },
          { key: "report", label: "Daily Report" },
        ]}
        active={activeTab}
        onChange={(k) => setActiveTab(k as "clock" | "records" | "report")}
      />

      {error && (
        <p
          role="alert"
          style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.danger }}
        >
          {error}
        </p>
      )}

      {activeTab === "clock" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: theme.spacing["4"],
            maxWidth: 960,
          }}
        >
          <Card
            title={openRecord ? "You are clocked in" : "Clock In"}
            hint={
              openRecord
                ? `Opened at ${fmtTime(openRecord.clockInAt)} · ${openRecord.shiftName || openRecord.shiftCode || ""}`
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
                  <Textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Notes for this shift..."
                  />
                </FormField>
                <div>
                  <Button
                    loading={busy}
                    style={{ background: theme.action.danger }}
                    onClick={() => void handleClockOut()}
                  >
                    Clock Out
                  </Button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["3"] }}>
                <FormField label="Shift" required>
                  <Select
                    required
                    value={selectedShift}
                    onChange={(e) => setSelectedShift(e.target.value)}
                  >
                    <option value="">Select shift…</option>
                    {shifts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.startTime}–{s.endTime}){s.isNight ? " · Night" : ""}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Work date">
                  <Input
                    type="date"
                    value={workDate}
                    onChange={(e) => setWorkDate(e.target.value)}
                  />
                </FormField>
                <FormField label="Notes (optional)">
                  <Textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Notes for this shift..."
                  />
                </FormField>
                <div>
                  <Button
                    loading={busy}
                    style={{ background: theme.action.success }}
                    onClick={() => void handleClockIn()}
                  >
                    Clock In
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <Card title="Available Shifts" hint="Shift definitions used for clock-in.">
            {loading ? (
              <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>
                Loading shifts…
              </p>
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
                      <span
                        style={{
                          marginLeft: theme.spacing["2"],
                          color: theme.text.muted,
                          fontSize: theme.fontSize.sm,
                        }}
                      >
                        {s.code}
                      </span>
                    </div>
                    <span style={{ color: theme.text.secondary }}>
                      {s.startTime}–{s.endTime}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {activeTab === "records" && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
          <Card bodyStyle={{ padding: theme.spacing["4"] }}>
            <div
              style={{
                display: "flex",
                gap: theme.spacing["3"],
                alignItems: "flex-end",
                maxWidth: 320,
              }}
            >
              <FormField label="Filter by date">
                <Input
                  type="date"
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                />
              </FormField>
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
                Loading attendance…
              </p>
            ) : records.length === 0 ? (
              <EmptyState icon="calendar" description="No attendance records for this date." />
            ) : (
              <DataTable columns={recordsColumns} rows={records} rowKey={(r) => r.id} dense />
            )}
          </Card>
        </div>
      )}

      {activeTab === "report" && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
          <Card bodyStyle={{ padding: theme.spacing["4"] }}>
            <div
              style={{
                display: "flex",
                gap: theme.spacing["3"],
                alignItems: "flex-end",
                maxWidth: 320,
              }}
            >
              <FormField label="Report date">
                <Input
                  type="date"
                  value={reportDate}
                  onChange={(e) => setReportDate(e.target.value)}
                />
              </FormField>
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
                Loading report…
              </p>
            ) : reportRows.length === 0 ? (
              <EmptyState icon="file-text" description="No attendance report rows for this date." />
            ) : (
              <DataTable
                columns={reportColumns}
                rows={reportRows}
                rowKey={(r) => r.staffId}
                dense
              />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
