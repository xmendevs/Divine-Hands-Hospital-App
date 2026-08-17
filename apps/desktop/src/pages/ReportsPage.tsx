import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  theme,
  Button,
  Card,
  FormField,
  Icon,
  PageHeader,
  Select,
  StatusBadge,
  useToast,
} from "@hims/ui";
import { apiFetch, getBaseUrl, getToken } from "../api/client";

interface DashboardData {
  patientRegistrations: { total: number; today: number };
  admissions: { active: number; dischargedToday: number };
  revenue: { collected: number; invoiced: number; outstanding: number };
  pharmacy: { medicineCount: number; stockOnHand: number; expiringSoon: number };
  inventoryVariance: { countsWithVariance: number; totalVariance: number };
  attendance: { clockedIn: number; missed: number };
  rosterCoverage: { scheduled: number; required: number; coveragePct: number };
  labWorkload: { pendingRequests: number; pendingVerification: number };
  criticalAlerts: { unacknowledged: number };
  securityEvents: { last24h: number };
}

const EXPORT_KINDS = [
  { value: "patients", label: "Patients" },
  { value: "invoices", label: "Invoices" },
  { value: "payments", label: "Payments" },
  { value: "dispensations", label: "Dispensations" },
  { value: "lab_requests", label: "Lab Requests" },
  { value: "attendance", label: "Attendance" },
  { value: "medicines", label: "Medicines" },
  { value: "refunds", label: "Refunds" },
];

function naira(amount: number): string {
  return `₦${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmt(n: number): string {
  return n.toLocaleString();
}

function KpiCard({
  label,
  value,
  sub,
  accent,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: string;
  icon: string;
}) {
  return (
    <Card bodyStyle={{ padding: theme.spacing["4"] }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: theme.spacing["2"],
        }}
      >
        <span
          style={{
            fontSize: theme.fontSize.sm,
            fontWeight: theme.fontWeight.bold,
            color: theme.text.muted,
            textTransform: "uppercase",
            letterSpacing: "0.03em",
          }}
        >
          {label}
        </span>
        <Icon name={icon as never} size={20} color={accent} />
      </div>
      <div
        style={{
          fontSize: theme.fontSize["2xl"],
          fontWeight: theme.fontWeight.bold,
          color: theme.text.primary,
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontSize: theme.fontSize.sm,
            color: accent,
            fontWeight: theme.fontWeight.semibold,
            marginTop: theme.spacing["1"],
          }}
        >
          {sub}
        </div>
      )}
    </Card>
  );
}

export default function ReportsPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [myReport, setMyReport] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [exportKind, setExportKind] = useState("patients");
  const [exportFormat, setExportFormat] = useState("csv");
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState("");

  const toast = useToast();

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    const [dashRes, myRes] = await Promise.allSettled([
      apiFetch<DashboardData>("/reports/dashboard"),
      apiFetch<Record<string, unknown>>("/reports/my"),
    ]);
    const errors: string[] = [];
    if (dashRes.status === "fulfilled") {
      setDashboard(dashRes.value);
    } else {
      errors.push(
        dashRes.reason instanceof Error ? dashRes.reason.message : "Could not load the dashboard.",
      );
    }
    if (myRes.status === "fulfilled") {
      setMyReport(myRes.value);
    } else if (myRes.reason instanceof Error && myRes.reason.message) {
      // role-scoped report may be unavailable; the aggregate dashboard is the fallback
      setMyReport(null);
    }
    setError(errors.join(" "));
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const kpis = useMemo(() => {
    if (!dashboard)
      return [] as { label: string; value: string; sub?: string; accent: string; icon: string }[];
    const d = dashboard;
    return [
      {
        label: "Revenue Collected Today",
        value: naira(d.revenue.collected),
        sub: `Invoiced ${naira(d.revenue.invoiced)}`,
        accent: theme.action.success,
        icon: "cash",
      },
      {
        label: "Outstanding Balance",
        value: naira(d.revenue.outstanding),
        sub: "Open invoices",
        accent: theme.action.warning,
        icon: "warning",
      },
      {
        label: "Patient Registrations",
        value: fmt(d.patientRegistrations.total),
        sub: `+${fmt(d.patientRegistrations.today)} today`,
        accent: theme.action.primary,
        icon: "users",
      },
      {
        label: "Active Admissions",
        value: fmt(d.admissions.active),
        sub: `${fmt(d.admissions.dischargedToday)} discharged today`,
        accent: theme.action.info,
        icon: "clipboard",
      },
      {
        label: "Staff Clocked In",
        value: fmt(d.attendance.clockedIn),
        sub: `${fmt(d.attendance.missed)} missed roster shifts`,
        accent: theme.action.secondary,
        icon: "calendar",
      },
      {
        label: "Roster Coverage",
        value: `${d.rosterCoverage.coveragePct.toFixed(0)}%`,
        sub: `${fmt(d.rosterCoverage.scheduled)} scheduled of ${fmt(d.rosterCoverage.required)} required`,
        accent: theme.action.primary,
        icon: "users",
      },
      {
        label: "Pharmacy Stock",
        value: fmt(Math.round(d.pharmacy.stockOnHand)),
        sub: `${fmt(d.pharmacy.medicineCount)} medicines · ${fmt(d.pharmacy.expiringSoon)} expiring soon`,
        accent: theme.action.info,
        icon: "pill",
      },
      {
        label: "Lab Workload",
        value: fmt(d.labWorkload.pendingRequests),
        sub: `${fmt(d.labWorkload.pendingVerification)} awaiting verification`,
        accent: theme.action.warning,
        icon: "flask",
      },
    ];
  }, [dashboard]);

  const alerts = useMemo(() => {
    if (!dashboard) return [] as { label: string; value: number; accent: string }[];
    return [
      {
        label: "Critical alerts unacknowledged",
        value: dashboard.criticalAlerts.unacknowledged,
        accent: theme.action.danger,
      },
      {
        label: "Security events (24h)",
        value: dashboard.securityEvents.last24h,
        accent: theme.action.secondary,
      },
      {
        label: "Inventory counts w/ variance today",
        value: dashboard.inventoryVariance.countsWithVariance,
        accent: theme.action.warning,
      },
    ];
  }, [dashboard]);

  async function handleExport() {
    setExporting(true);
    setExportMsg("");
    setError("");
    try {
      const base = getBaseUrl();
      const token = getToken();
      const params = new URLSearchParams({
        report: exportKind,
        format: exportFormat,
      });
      if (exportFrom) params.set("from", exportFrom);
      if (exportTo) params.set("to", exportTo);
      const res = await fetch(`${base}/api/v1/reports/export?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const text = await res.text();
        let message = `Export failed (${res.status})`;
        try {
          const env = JSON.parse(text) as { error?: { message?: string } };
          message = env.error?.message || message;
        } catch {
          // keep generic message
        }
        throw new Error(message);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = /filename="([^"]+)"/.exec(disposition);
      a.href = url;
      a.download = match?.[1] || `${exportKind}_export.${exportFormat}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      const msg = `Exported ${exportKind.replace("_", " ")} as ${exportFormat.toUpperCase()}.`;
      setExportMsg(msg);
      toast.success(msg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Export failed.";
      setError(msg);
      toast.error(msg);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}>
      <PageHeader
        title="Reports & Dashboard"
        description="System-wide operational metrics, role-scoped workload, and data exports."
        badge={dashboard ? <StatusBadge variant="approved" label="Live" /> : undefined}
      />

      {error && (
        <p
          role="alert"
          style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.danger }}
        >
          {error}
        </p>
      )}
      {exportMsg && (
        <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.action.success }}>
          {exportMsg}
        </p>
      )}

      {loading ? (
        <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>
          Loading dashboard…
        </p>
      ) : !dashboard ? (
        <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>
          The dashboard requires administrator access. Your role-scoped report is shown below if
          available.
        </p>
      ) : (
        <>
          {/* KPI grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: theme.spacing["4"],
            }}
          >
            {kpis.map((k) => (
              <KpiCard key={k.label} {...k} />
            ))}
          </div>

          {/* Alerts strip */}
          <Card title="Needs Attention" bodyStyle={{ padding: theme.spacing["4"] }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: theme.spacing["4"] }}>
              {alerts.map((a) => (
                <div
                  key={a.label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: theme.spacing["2"],
                    fontSize: theme.fontSize.base,
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minWidth: 28,
                      height: 28,
                      borderRadius: theme.radius.full,
                      background: `${a.accent}1a`,
                      color: a.accent,
                      fontWeight: theme.fontWeight.bold,
                      fontSize: theme.fontSize.base,
                      padding: `0 ${theme.spacing["2"]}`,
                    }}
                  >
                    {fmt(a.value)}
                  </span>
                  <span style={{ color: theme.text.secondary }}>{a.label}</span>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {/* Role-scoped report */}
      {myReport && Object.keys(myReport).length > 0 && (
        <Card title="My Report" hint="Role-scoped workload summary for your account.">
          <div style={kpiGrid}>
            {Object.entries(myReport).map(([key, value]) => (
              <div key={key} style={kpiCell}>
                <div
                  style={{
                    fontSize: theme.fontSize.sm,
                    fontWeight: theme.fontWeight.bold,
                    color: theme.text.muted,
                    textTransform: "capitalize",
                  }}
                >
                  {key.replace(/([A-Z])/g, " $1")}
                </div>
                <div
                  style={{
                    fontSize: theme.fontSize.xl,
                    fontWeight: theme.fontWeight.bold,
                    color: theme.text.primary,
                  }}
                >
                  {typeof value === "number"
                    ? Array.isArray(value)
                      ? JSON.stringify(value)
                      : value.toLocaleString()
                    : String(value ?? "—")}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Exports */}
      <Card
        title="Data Exports"
        hint="Download a snapshot of a report as CSV, XLSX or PDF (administrator permission)."
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: theme.spacing["3"],
            alignItems: "flex-end",
          }}
        >
          <div style={{ minWidth: 200 }}>
            <FormField label="Report">
              <Select value={exportKind} onChange={(e) => setExportKind(e.target.value)}>
                {EXPORT_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <div style={{ minWidth: 140 }}>
            <FormField label="Format">
              <Select value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}>
                <option value="csv">CSV</option>
                <option value="xlsx">XLSX</option>
                <option value="pdf">PDF</option>
              </Select>
            </FormField>
          </div>
          <div style={{ minWidth: 160 }}>
            <FormField label="From (optional)">
              <input
                type="date"
                value={exportFrom}
                onChange={(e) => setExportFrom(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  borderRadius: theme.radius.md,
                  border: `1px solid ${theme.surface.borderStrong}`,
                  fontSize: theme.fontSize.base,
                  background: theme.surface.card,
                  color: theme.text.primary,
                  outline: "none",
                }}
              />
            </FormField>
          </div>
          <div style={{ minWidth: 160 }}>
            <FormField label="To (optional)">
              <input
                type="date"
                value={exportTo}
                onChange={(e) => setExportTo(e.target.value)}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  borderRadius: theme.radius.md,
                  border: `1px solid ${theme.surface.borderStrong}`,
                  fontSize: theme.fontSize.base,
                  background: theme.surface.card,
                  color: theme.text.primary,
                  outline: "none",
                }}
              />
            </FormField>
          </div>
          <div>
            <Button onClick={() => void handleExport()} loading={exporting}>
              Export
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

const kpiGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
  gap: theme.spacing["4"],
};

const kpiCell: CSSProperties = {
  background: theme.surface.subtle,
  borderRadius: theme.radius.md,
  padding: theme.spacing["3"],
};
