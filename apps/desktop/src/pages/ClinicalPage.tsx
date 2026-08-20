import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
  useToast,
  type StatusVariant,
} from "@hims/ui";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import ChargePatientModal from "../components/ChargePatientModal";
import ChargeConfirmationModal from "../components/ChargeConfirmationModal";

const currency = (val: number) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(val);

function invoiceStatusBadge(status: string): StatusVariant {
  if (status === "paid") return "approved";
  if (status === "issued") return "active";
  if (status === "partially_paid") return "running";
  if (status === "voided") return "error";
  return "draft";
}

interface PatientSummary {
  id: string;
  patientNo: string;
  registrationType: string;
  firstName: string;
  lastName: string;
  gender: string;
  dateOfBirth: string;
  phone: string;
}

interface ClinicalNote {
  id: string;
  groupId: string;
  patientId: string;
  noteType: string;
  authorUserId: string;
  authorName: string;
  authorRole: string;
  note: string;
  diagnosis: string;
  treatmentPlan: string;
  version: number;
  signedBy?: string;
  signedByName?: string;
  signedAt?: string;
  createdAt: string;
}

interface Order {
  id: string;
  orderNo: string;
  patientId: string;
  orderType: string;
  status: string;
  orderedByName: string;
  signedBy?: string;
  signedByName?: string;
  signedAt?: string;
  details: Record<string, unknown>;
  priority?: string;
  invoiceId?: string;
  createdAt: string;
}

interface DoctorWorkload {
  assignedPatients: number;
  patientsSeenToday: number;
  pendingResults: number;
  pendingCriticalLabs: number;
  pendingOrders: number;
  activeOrdersByType: { name: string; value: number }[];
  recentPatientActivity: {
    patientId: string;
    patientNo: string;
    firstName: string;
    lastName: string;
    pendingLabs: number;
    activeOrders: number;
  }[];
}

interface CDSAlert {
  severity: "warning" | "critical";
  category: string;
  message: string;
}

interface HistoryBundle {
  notes: ClinicalNote[];
  vitals: { id: string; measurements: Record<string, unknown>; recordedAt: string }[];
  lab: {
    id: string;
    requestNo: string;
    priority: string;
    status: string;
    requestedAt: string;
    releasedAt?: string;
    tests: string[];
    results: { testName: string; result: string; critical: boolean }[];
  }[];
  orders: Order[];
  allergies: { summary: string }[];
}

const ORDER_TYPES = [
  "prescription",
  "lab_investigation",
  "radiology_imaging",
  "nursing_procedure",
  "dietary_ward",
  "lab_request",
  "nursing_order",
  "referral",
];

const VITAL_FIELDS: { key: string; label: string; unit: string }[] = [
  { key: "bp", label: "BP", unit: "mmHg" },
  { key: "temperature", label: "Temp", unit: "°C" },
  { key: "pulse", label: "Pulse", unit: "bpm" },
  { key: "respiratoryRate", label: "Resp", unit: "brpm" },
  { key: "oxygenSaturation", label: "SpO₂", unit: "%" },
  { key: "weight", label: "Weight", unit: "kg" },
  { key: "height", label: "Height", unit: "cm" },
  { key: "bmi", label: "BMI", unit: "" },
];

function orderStatusBadge(status: string): StatusVariant {
  if (status === "completed") return "approved";
  if (status === "in_progress" || status === "accepted") return "running";
  return "draft";
}

function signedBadge(signedAt?: string): StatusVariant {
  return signedAt ? "approved" : "draft";
}

export default function ClinicalPage() {
  const { me } = useAuth();
  const [activeTab, setActiveTab] = useState<"workload" | "consultation" | "orders" | "bills">(
    "consultation",
  );

  // Patient selection (shared by all tabs).
  const [search, setSearch] = useState("");
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientSummary | null>(null);

  // Consultation form.
  const [symptoms, setSymptoms] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [treatmentPlan, setTreatmentPlan] = useState("");
  const [vitals, setVitals] = useState({
    bp: "120/80",
    temperature: "36.8",
    pulse: "72",
    respiratoryRate: "16",
    oxygenSaturation: "98",
    weight: "",
    height: "",
  });

  // CDS alerts (allergies + critical vitals).
  const [cdsAlerts, setCdsAlerts] = useState<CDSAlert[]>([]);
  const [cdsMedication, setCdsMedication] = useState("");

  // History timeline drawer.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryBundle | null>(null);
  const [historyTab, setHistoryTab] = useState<"notes" | "vitals" | "lab">("notes");

  // Digital signature modal.
  const [signTarget, setSignTarget] = useState<{ kind: "note" | "order"; id: string } | null>(
    null,
  );
  const [signPassword, setSignPassword] = useState("");
  const [signing, setSigning] = useState(false);

  // Doctor workload dashboard.
  const [workload, setWorkload] = useState<DoctorWorkload | null>(null);

  // Notes history for the selected patient.
  const [notes, setNotes] = useState<ClinicalNote[]>([]);

  // Orders.
  const [orders, setOrders] = useState<Order[]>([]);
  const [lastSync, setLastSync] = useState<string>("");
  const [orderType, setOrderType] = useState("prescription");
  const [orderMedication, setOrderMedication] = useState("");
  const [orderDosage, setOrderDosage] = useState("");
  const [orderFrequency, setOrderFrequency] = useState("");
  const [orderDuration, setOrderDuration] = useState("");
  const [orderTest, setOrderTest] = useState("");
  const [orderSpecimen, setOrderSpecimen] = useState("");
  const [orderPriority, setOrderPriority] = useState("routine");
  const [orderModality, setOrderModality] = useState("X-ray");
  const [orderRegion, setOrderRegion] = useState("");

  // Inventory suggestions
  const [pharmacyMedicines, setPharmacyMedicines] = useState<{id:string;genericName:string;brand:string;strength:string;dosageForm:string;category:string}[]>([]);
  const [labTests, setLabTests] = useState<{id:string;name:string;category:string;specimenType:string}[]>([]);
  const [medSuggOpen, setMedSuggOpen] = useState(false);
  const [testSuggOpen, setTestSuggOpen] = useState(false);
  const [orderProcedure, setOrderProcedure] = useState("");
  const [orderDiet, setOrderDiet] = useState("Regular diet");
  const [orderNotes, setOrderNotes] = useState("");

  // Charge confirmation modal
  const [chargeConfirmOpen, setChargeConfirmOpen] = useState(false);
  const [chargeOrderId, setChargeOrderId] = useState("");
  const [chargeOrderDetails, setChargeOrderDetails] = useState<Record<string, unknown>>({});
  const [orderDescription, setOrderDescription] = useState("");

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  const cdsTimer = useRef<number | undefined>(undefined);

  // My patients bills
  const [bills, setBills] = useState<Record<string, unknown>[]>([]);
  const [loadingBills, setLoadingBills] = useState(false);

  // Charge patient modal
  const [showCharge, setShowCharge] = useState(false);

  // Auto-computed BMI from weight (kg) / height (cm).
  const bmi = useMemo(() => {
    const w = Number(vitals.weight);
    const h = Number(vitals.height);
    if (!(w > 0) || !(h > 0)) return null;
    return Math.round((w / ((h / 100) * (h / 100))) * 10) / 10;
  }, [vitals.weight, vitals.height]);

  // Debounced patient search.
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setPatients([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const results = await apiFetch<PatientSummary[]>(
          `/patients/search?q=${encodeURIComponent(q)}`,
        );
        if (!cancelled) setPatients(results);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Patient search failed.");
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search]);

  // CDS alerts: vitals-only when a patient is selected, plus medication when
  // a prescription is being written.
  useEffect(() => {
    if (!selectedPatient) {
      setCdsAlerts([]);
      return;
    }
    let cancelled = false;
    window.clearTimeout(cdsTimer.current);
    cdsTimer.current = window.setTimeout(async () => {
      try {
        const med = cdsMedication.trim() ? `&medication=${encodeURIComponent(cdsMedication.trim())}` : "";
        const res = await apiFetch<{ alerts: CDSAlert[] }>(
          `/patients/${selectedPatient.id}/cds-alerts?${med.replace(/^&/, "")}`,
        );
        if (!cancelled) setCdsAlerts(res.alerts ?? []);
      } catch {
        if (!cancelled) setCdsAlerts([]);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(cdsTimer.current);
    };
  }, [selectedPatient, cdsMedication]);

  function choosePatient(p: PatientSummary) {
    setSelectedPatient(p);
    setSearch("");
    setPatients([]);
    setCdsAlerts([]);
  }

  async function loadNotes() {
    if (!selectedPatient) return;
    setError("");
    try {
      const results = await apiFetch<ClinicalNote[]>(`/patients/${selectedPatient.id}/notes`);
      setNotes(results);
    } catch (err) {
      setNotes([]);
      setError(err instanceof Error ? err.message : "Could not load clinical notes.");
    }
  }

  useEffect(() => {
    if (activeTab !== "consultation" || !selectedPatient) return;
    let cancelled = false;
    (async () => {
      try {
        const results = await apiFetch<ClinicalNote[]>(`/patients/${selectedPatient.id}/notes`);
        if (!cancelled) setNotes(results);
      } catch (err) {
        if (!cancelled) {
          setNotes([]);
          setError(err instanceof Error ? err.message : "Could not load clinical notes.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedPatient]);

  async function loadWorkload() {
    setLoading(true);
    setError("");
    try {
      const report = await apiFetch<DoctorWorkload>("/reports/doctor");
      setWorkload(report);
    } catch (err) {
      setWorkload(null);
      setError(err instanceof Error ? err.message : "Could not load workload metrics.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab === "workload") void loadWorkload();
    if (activeTab === "bills") {
      setLoadingBills(true);
      apiFetch<Record<string, unknown>[]>("/billing/my-patients-bills")
        .then(setBills)
        .catch(() => setBills([]))
        .finally(() => setLoadingBills(false));
    }
  }, [activeTab]);

  async function handleSaveConsultation(e: FormEvent) {
    e.preventDefault();
    if (!selectedPatient) {
      setError("Search for and select a patient first.");
      return;
    }
    if (!symptoms.trim()) {
      setError("Presenting complaints are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiFetch<unknown>(`/patients/${selectedPatient.id}/notes`, {
        method: "POST",
        body: JSON.stringify({
          noteType: "consultation",
          note: symptoms,
          diagnosis,
          treatmentPlan,
        }),
      });
      const measurements: Record<string, unknown> = { ...vitals };
      if (bmi !== null) measurements.bmi = bmi;
      await apiFetch<unknown>(`/patients/${selectedPatient.id}/observations`, {
        method: "POST",
        body: JSON.stringify({
          category: "vitals",
          measurements,
          notes: "",
        }),
      });
      setSymptoms("");
      setDiagnosis("");
      setTreatmentPlan("");
      await loadNotes();
      toast.success("Consultation note and vitals saved.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save consultation.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  // ---- Live order queue sync: reload every 5s while the orders tab is open ----
  const loadOrders = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const results = await apiFetch<Order[]>("/orders/actionable");
      setOrders(results);
      setLastSync(new Date().toLocaleTimeString());
    } catch (err) {
      if (!silent) {
        setOrders([]);
        setError(err instanceof Error ? err.message : "Could not load the orders queue.");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== "orders") return;
    void loadOrders();
    const interval = window.setInterval(() => void loadOrders(true), 5000);
    return () => window.clearInterval(interval);
  }, [activeTab, loadOrders]);

  // Load pharmacy medicines and lab tests for order suggestions
  useEffect(() => {
    void (async () => {
      try {
        const [meds, tests] = await Promise.allSettled([
          apiFetch<{id:string;genericName:string;brand:string;strength:string;dosageForm:string;category:string}[]>("/pharmacy/medicines"),
          apiFetch<{id:string;name:string;category:string;specimenType:string}[]>("/lab/tests"),
        ]);
        if (meds.status === "fulfilled") setPharmacyMedicines(meds.value);
        if (tests.status === "fulfilled") setLabTests(tests.value);
      } catch { /* silent */ }
    })();
  }, []);

  function buildOrderDetails(): Record<string, unknown> | null {
    switch (orderType) {
      case "prescription":
        if (!orderMedication.trim()) return null;
        return {
          medication: orderMedication.trim(),
          dosage: orderDosage.trim(),
          frequency: orderFrequency.trim(),
          durationDays: orderDuration.trim() ? Number(orderDuration) : undefined,
        };
      case "lab_investigation":
        if (!orderTest.trim()) return null;
        return {
          test: orderTest.trim(),
          specimenType: orderSpecimen.trim(),
          priority: orderPriority,
        };
      case "radiology_imaging":
        if (!orderRegion.trim()) return null;
        return {
          modality: orderModality,
          region: orderRegion.trim(),
          clinicalIndication: orderNotes.trim(),
        };
      case "nursing_procedure":
        if (!orderProcedure.trim()) return null;
        return {
          procedure: orderProcedure.trim(),
          instructions: orderNotes.trim(),
          frequency: orderFrequency.trim(),
        };
      case "dietary_ward":
        return {
          dietType: orderDiet,
          instructions: orderNotes.trim(),
        };
      default:
        if (!orderDescription.trim()) return null;
        return { description: orderDescription.trim() };
    }
  }

  async function handleCreateOrder(e: FormEvent) {
    e.preventDefault();
    if (!selectedPatient) {
      setError("Search for and select a patient first.");
      return;
    }
    const details = buildOrderDetails();
    if (!details) {
      setError("Complete the required fields for this order type.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const newOrder = await apiFetch<{id: string}>(`/patients/${selectedPatient.id}/orders`, {
        method: "POST",
        body: JSON.stringify({ orderType, details, submit: true, priority: orderPriority }),
      });
      setOrderMedication("");
      setOrderDosage("");
      setOrderFrequency("");
      setOrderDuration("");
      setOrderTest("");
      setOrderSpecimen("");
      setOrderRegion("");
      setOrderProcedure("");
      setOrderNotes("");
      setOrderDescription("");
      await loadOrders();
      toast.success("Order submitted — it now appears in the pharmacy/lab queue.");

      // Show charge confirmation for billable order types
      const billableTypes = ["prescription", "lab_request", "lab_investigation", "radiology_imaging"];
      if (billableTypes.includes(orderType)) {
        setChargeOrderId(newOrder.id);
        setChargeOrderDetails(details || {});
        setChargeConfirmOpen(true);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not create the order.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function transitionOrder(order: Order, status: string) {
    setError("");
    try {
      await apiFetch<unknown>(`/orders/${order.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      await loadOrders();
      toast.success(`Order ${order.orderNo} moved to ${status.replace("_", " ")}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not update the order.";
      setError(msg);
      toast.error(msg);
    }
  }

  // ---- Digital signature / attestation ----
  async function submitSignature() {
    if (!signTarget) return;
    if (!signPassword) {
      setError("Enter your password to attest.");
      return;
    }
    setSigning(true);
    setError("");
    try {
      const path =
        signTarget.kind === "note"
          ? `/notes/${signTarget.id}/sign`
          : `/orders/${signTarget.id}/sign`;
      const res = await apiFetch<{ signedByName: string; signedAt: string }>(path, {
        method: "POST",
        body: JSON.stringify({ password: signPassword }),
      });
      toast.success(`Attested by ${res.signedByName} at ${new Date(res.signedAt).toLocaleString()}.`);
      setSignPassword("");
      setSignTarget(null);
      if (signTarget.kind === "note") await loadNotes();
      else await loadOrders();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Attestation failed.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSigning(false);
    }
  }

  // ---- History timeline drawer ----
  async function openHistory() {
    if (!selectedPatient) {
      toast.error("Select a patient first.");
      return;
    }
    setHistoryOpen(true);
    setError("");
    try {
      const bundle = await apiFetch<HistoryBundle>(`/patients/${selectedPatient.id}/history`);
      setHistory(bundle);
    } catch (err) {
      setHistory(null);
      setError(err instanceof Error ? err.message : "Could not load patient history.");
    }
  }

  function orderInstructions(o: Order): string {
    const d = o.details;
    switch (o.orderType) {
      case "prescription":
        return [d.medication, d.dosage, d.frequency, d.durationDays ? `${d.durationDays} days` : ""]
          .filter(Boolean)
          .join(" · ");
      case "lab_investigation":
        return [d.test, d.specimenType, d.priority].filter(Boolean).join(" · ");
      case "radiology_imaging":
        return [d.modality, d.region].filter(Boolean).join(" · ");
      case "nursing_procedure":
        return [d.procedure, d.instructions].filter(Boolean).join(" · ");
      case "dietary_ward":
        return [d.dietType, d.instructions].filter(Boolean).join(" · ");
      default:
        return String(d.description ?? "");
    }
  }

  const orderColumns = [
    {
      key: "order",
      header: "Order No",
      render: (o: Order) => <strong style={{ color: theme.action.info }}>{o.orderNo}</strong>,
    },
    {
      key: "type",
      header: "Type",
      render: (o: Order) => (
        <strong style={{ fontSize: theme.fontSize.base, color: theme.text.secondary }}>
          {o.orderType.replace(/_/g, " ").toUpperCase()}
        </strong>
      ),
    },
    {
      key: "priority",
      header: "Priority",
      render: (o: Order) => {
        const p = o.priority || "routine";
        const colors: Record<string, string> = { routine: "#34d399", urgent: "#fbbf24", stat: "#f87171" };
        return (
          <span style={{ fontSize: theme.fontSize.xs, padding: "2px 8px", borderRadius: 4, background: colors[p] + "22", color: colors[p], fontWeight: 600, textTransform: "uppercase" }}>
            {p}
          </span>
        );
      },
    },
    { key: "details", header: "Details", render: (o: Order) => orderInstructions(o) || "—" },
    {
      key: "orderedBy",
      header: "Ordered By",
      render: (o: Order) => (
        <span style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
          {o.orderedByName || "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (o: Order) => (
        <StatusBadge variant={orderStatusBadge(o.status)} label={o.status.replace("_", " ")} />
      ),
    },
    {
      key: "attestation",
      header: "Attestation",
      render: (o: Order) => (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["1"] }}>
          <StatusBadge variant={signedBadge(o.signedAt)} label={o.signedAt ? "Signed" : "Unsigned"} />
          {o.signedAt && (
            <span style={{ fontSize: theme.fontSize.xs, color: theme.text.muted }}>
              {o.signedByName || "—"} · {new Date(o.signedAt).toLocaleString()}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "action",
      header: "Action",
      render: (o: Order) => (
        <div style={{ display: "flex", gap: theme.spacing["2"], flexWrap: "wrap" }}>
          {(o.status === "submitted" || o.status === "accepted") && (
            <Button size="sm" variant="outline" onClick={() => transitionOrder(o, "in_progress")}>
              Start Processing
            </Button>
          )}
          {o.status === "in_progress" && (
            <Button
              size="sm"
              style={{ background: theme.action.success }}
              onClick={() => transitionOrder(o, "completed")}
            >
              Mark Completed
            </Button>
          )}
          {!o.signedAt && (
            <Button size="sm" variant="ghost" onClick={() => setSignTarget({ kind: "order", id: o.id })}>
              Sign Off
            </Button>
          )}
        </div>
      ),
    },
  ];

  function CDSBanner() {
    if (cdsAlerts.length === 0) return null;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["2"] }}>
        {cdsAlerts.map((a, i) => (
          <div
            key={i}
            role="alert"
            style={{
              display: "flex",
              gap: theme.spacing["2"],
              alignItems: "flex-start",
              padding: theme.spacing["3"],
              borderRadius: theme.radius.md,
              fontSize: theme.fontSize.base,
              background:
                a.severity === "critical" ? theme.surface.error : theme.surface.warning,
              border: `1px solid ${
                a.severity === "critical" ? theme.surface.errorBorder : theme.surface.warningBorder
              }`,
              color: a.severity === "critical" ? theme.text.dangerStrong : theme.text.warning,
            }}
          >
            <strong style={{ flexShrink: 0 }}>
              {a.severity === "critical" ? "⚠ CRITICAL" : "⚠ WARNING"}:
            </strong>
            <span>{a.message}</span>
          </div>
        ))}
      </div>
    );
  }

  function WorkloadStat({
    label,
    value,
    hint,
  }: {
    label: string;
    value: number | string;
    hint?: string;
  }) {
    return (
      <div
        style={{
          background: theme.surface.subtle,
          border: `1px solid ${theme.surface.borderStrong}`,
          borderRadius: theme.radius.md,
          padding: `${theme.spacing["3"]} ${theme.spacing["4"]}`,
        }}
      >
        <div
          style={{
            fontSize: theme.fontSize["2xl"],
            fontWeight: theme.fontWeight.bold,
            color: theme.text.primary,
            lineHeight: 1,
          }}
        >
          {value}
        </div>
        <div
          style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, marginTop: theme.spacing["1"] }}
        >
          {label}
        </div>
        {hint && (
          <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginTop: 2 }}>
            {hint}
          </div>
        )}
      </div>
    );
  }

  const canAttest = useMemo(() => {
    if (!me) return false;
    return me.roles.some((r) => r.code === "doctor" || r.code === "super_admin");
  }, [me]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}>
      <PageHeader
        title="Orders & Clinical"
        description="Doctor workload, consultation notes, structured vitals, and the granular orders queue."
        actions={
          <Button variant="outline" onClick={() => setShowCharge(true)}>
            Charge Patient
          </Button>
        }
      />

      <TabNav
        tabs={[
          { key: "workload", label: "Doctor Workload" },
          { key: "consultation", label: "Consultation & Vitals" },
          { key: "orders", label: "Orders Queue" },
          { key: "bills", label: "My Patients' Bills" },
        ]}
        active={activeTab}
        onChange={(k) => setActiveTab(k as "workload" | "consultation" | "orders" | "bills")}
      />

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.danger }}>
          {error}
        </p>
      )}

      {/* Tab 0: Doctor Workload dashboard */}
      {activeTab === "workload" && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}>
          <Card title="Doctor Workload & Pending Results">
            {loading ? (
              <p style={{ color: theme.text.muted, fontSize: theme.fontSize.base }}>Loading…</p>
            ) : workload ? (
              <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: theme.spacing["4"],
                  }}
                >
                  <WorkloadStat label="Assigned patients" value={workload.assignedPatients} />
                  <WorkloadStat label="Patients seen today" value={workload.patientsSeenToday} />
                  <WorkloadStat
                    label="Pending lab results"
                    value={workload.pendingResults}
                    hint="Awaiting release for your patients"
                  />
                  <WorkloadStat
                    label="Critical labs"
                    value={workload.pendingCriticalLabs}
                    hint="Pending acknowledgement"
                  />
                  <WorkloadStat
                    label="Active orders"
                    value={workload.pendingOrders}
                    hint="Not yet completed or cancelled"
                  />
                </div>

                {workload.activeOrdersByType.length > 0 && (
                  <div>
                    <div
                      style={{
                        fontSize: theme.fontSize.sm,
                        color: theme.text.muted,
                        fontWeight: theme.fontWeight.bold,
                        marginBottom: theme.spacing["2"],
                      }}
                    >
                      ACTIVE ORDERS BY TYPE
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: theme.spacing["2"] }}>
                      {workload.activeOrdersByType.map((t) => (
                        <span
                          key={t.name}
                          style={{
                            background: theme.surface.subtle,
                            border: `1px solid ${theme.surface.borderStrong}`,
                            borderRadius: theme.radius.full,
                            padding: `${theme.spacing["1"]} ${theme.spacing["3"]}`,
                            fontSize: theme.fontSize.sm,
                            color: theme.text.secondary,
                          }}
                        >
                          <strong style={{ color: theme.action.info }}>{t.value}</strong>{" "}
                          {t.name.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {workload.recentPatientActivity.length > 0 && (
                  <div>
                    <div
                      style={{
                        fontSize: theme.fontSize.sm,
                        color: theme.text.muted,
                        fontWeight: theme.fontWeight.bold,
                        marginBottom: theme.spacing["2"],
                      }}
                    >
                      RECENT PATIENT ACTIVITY
                    </div>
                    <Card bodyStyle={{ padding: 0 }}>
                      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                        {workload.recentPatientActivity.map((a) => (
                          <li
                            key={a.patientId}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              gap: theme.spacing["2"],
                              padding: `${theme.spacing["2"]} ${theme.spacing["4"]}`,
                              borderBottom: `1px solid ${theme.surface.border}`,
                              flexWrap: "wrap",
                            }}
                          >
                            <span style={{ fontSize: theme.fontSize.base }}>
                              <strong style={{ color: theme.action.info }}>{a.patientNo}</strong>{" "}
                              {a.firstName} {a.lastName}
                            </span>
                            <span style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                              {a.pendingLabs} pending lab{a.pendingLabs === 1 ? "" : "s"} ·{" "}
                              {a.activeOrders} active order{a.activeOrders === 1 ? "" : "s"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  </div>
                )}
              </div>
            ) : (
              <EmptyState
                icon="clipboard"
                description="Doctor workload is available to doctors and super-admins."
              />
            )}
          </Card>
        </div>
      )}

      {/* Patient picker (shared) */}
      <Card bodyStyle={{ padding: theme.spacing["4"] }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: theme.spacing["2"],
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              fontSize: theme.fontSize.sm,
              color: theme.text.muted,
              fontWeight: theme.fontWeight.bold,
            }}
          >
            SELECT PATIENT
          </div>
          <Button size="sm" variant="outline" onClick={openHistory} disabled={!selectedPatient}>
            Patient History Timeline
          </Button>
        </div>
        {selectedPatient ? (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: theme.spacing["2"],
              flexWrap: "wrap",
              marginTop: theme.spacing["2"],
            }}
          >
            <div
              style={{
                fontSize: theme.fontSize.base,
                fontWeight: theme.fontWeight.semibold,
                color: theme.text.primary,
              }}
            >
              {selectedPatient.firstName} {selectedPatient.lastName}{" "}
              <span style={{ color: theme.action.info, fontWeight: theme.fontWeight.bold }}>
                ({selectedPatient.patientNo})
              </span>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setSelectedPatient(null)}>
              Change patient
            </Button>
          </div>
        ) : (
          <div style={{ position: "relative", marginTop: theme.spacing["2"] }}>
            <Input
              type="text"
              placeholder="Search patient by name, patient number, or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%" }}
            />
            {patients.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  right: 0,
                  background: theme.surface.card,
                  border: `1px solid ${theme.surface.border}`,
                  borderRadius: theme.radius.md,
                  boxShadow: theme.shadow.popover,
                  zIndex: 10,
                  overflow: "hidden",
                }}
              >
                {patients.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => choosePatient(p)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: `${theme.spacing["2"]} ${theme.spacing["3"]}`,
                      border: "none",
                      borderBottom: `1px solid ${theme.surface.border}`,
                      background: theme.surface.card,
                      cursor: "pointer",
                      fontSize: theme.fontSize.base,
                    }}
                  >
                    <strong style={{ color: theme.action.info }}>{p.patientNo}</strong> —{" "}
                    {p.firstName} {p.lastName}{" "}
                    <span style={{ color: theme.text.muted }}>({p.gender})</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* CDS alert banners (shown on consultation + order tabs) */}
      {(activeTab === "consultation" || activeTab === "orders") && <CDSBanner />}

      {/* Tab 1: Doctor Consultation Form */}
      {activeTab === "consultation" && (
        <Card title="Record Consultation & Structured Patient Vitals">
          <form
            onSubmit={handleSaveConsultation}
            style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}
          >
            <div
              style={{
                background: theme.surface.subtle,
                padding: theme.spacing["4"],
                borderRadius: theme.radius.md,
                border: `1px solid ${theme.surface.borderStrong}`,
              }}
            >
              <div
                style={{
                  fontSize: theme.fontSize.base,
                  fontWeight: theme.fontWeight.bold,
                  color: theme.text.secondary,
                  marginBottom: theme.spacing["3"],
                }}
              >
                PATIENT VITALS
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: theme.spacing["4"],
                }}
              >
                <VitalInput
                  label="BP (mmHg)"
                  value={vitals.bp}
                  onChange={(v) => setVitals({ ...vitals, bp: v })}
                />
                <VitalInput
                  label="Temp (°C)"
                  value={vitals.temperature}
                  onChange={(v) => setVitals({ ...vitals, temperature: v })}
                />
                <VitalInput
                  label="Pulse (bpm)"
                  value={vitals.pulse}
                  onChange={(v) => setVitals({ ...vitals, pulse: v })}
                />
                <VitalInput
                  label="Resp. rate (brpm)"
                  value={vitals.respiratoryRate}
                  onChange={(v) => setVitals({ ...vitals, respiratoryRate: v })}
                />
                <VitalInput
                  label="SpO₂ (%)"
                  value={vitals.oxygenSaturation}
                  onChange={(v) => setVitals({ ...vitals, oxygenSaturation: v })}
                />
                <VitalInput
                  label="Weight (kg)"
                  value={vitals.weight}
                  onChange={(v) => setVitals({ ...vitals, weight: v })}
                />
                <VitalInput
                  label="Height (cm)"
                  value={vitals.height}
                  onChange={(v) => setVitals({ ...vitals, height: v })}
                />
                <div>
                  <label style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                    BMI (auto)
                  </label>
                  <div
                    style={{
                      fontSize: theme.fontSize.base,
                      fontWeight: theme.fontWeight.semibold,
                      color: bmi === null ? theme.text.muted : theme.action.info,
                      border: `1px solid ${theme.surface.borderStrong}`,
                      borderRadius: theme.radius.md,
                      padding: "0.55rem 0.75rem",
                      background: theme.surface.card,
                      minHeight: "2.4rem",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    {bmi === null ? "—" : bmi.toFixed(1)}
                  </div>
                </div>
              </div>
            </div>

            <FormField label="Presenting Complaints & Symptoms" required>
              <Textarea
                required
                value={symptoms}
                onChange={(e) => setSymptoms(e.target.value)}
                placeholder="e.g. Fever, headaches, persistent fatigue... (also saved as the patient's current complaint)"
                rows={3}
              />
            </FormField>
            <div
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["4"] }}
            >
              <FormField label="Diagnosis">
                <Textarea
                  value={diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  placeholder="Primary clinical diagnosis... (linked to this visit's vitals)"
                  rows={3}
                />
              </FormField>
              <FormField label="Treatment Plan">
                <Textarea
                  value={treatmentPlan}
                  onChange={(e) => setTreatmentPlan(e.target.value)}
                  placeholder="Prescriptions, lab tests required..."
                  rows={3}
                />
              </FormField>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button type="submit" loading={saving} disabled={!selectedPatient}>
                Submit Consultation Note
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Tab 1b: Recent notes for the selected patient */}
      {activeTab === "consultation" && selectedPatient && (
        <Card title="Recent Consultation Notes (Audit Trail)" bodyStyle={{ padding: 0 }}>
          {notes.length === 0 ? (
            <EmptyState icon="clipboard" description="No clinical notes recorded yet." />
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {notes.map((n) => (
                <li
                  key={n.id}
                  style={{
                    padding: `${theme.spacing["3"]} ${theme.spacing["4"]}`,
                    borderBottom: `1px solid ${theme.surface.border}`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: theme.spacing["2"],
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                      <strong>{n.noteType.toUpperCase()}</strong> • v{n.version} •{" "}
                      <span style={{ color: theme.text.secondary }}>
                        {n.authorName || "Unknown"} ({n.authorRole})
                      </span>{" "}
                      • {new Date(n.createdAt).toLocaleString()}
                    </div>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: theme.spacing["2"] }}
                    >
                      <StatusBadge
                        variant={signedBadge(n.signedAt)}
                        label={n.signedAt ? "Signed" : "Unsigned"}
                      />
                      {!n.signedAt && canAttest && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSignTarget({ kind: "note", id: n.id })}
                        >
                          Sign Off
                        </Button>
                      )}
                    </div>
                  </div>
                  {n.signedAt && (
                    <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted }}>
                      ✍ Attested by {n.signedByName || "—"} on{" "}
                      {new Date(n.signedAt).toLocaleString()}
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: theme.fontSize.base,
                      color: theme.text.secondary,
                      marginTop: theme.spacing["1"],
                    }}
                  >
                    {n.note}
                  </div>
                  {n.diagnosis && (
                    <div style={{ fontSize: theme.fontSize.base, color: theme.text.secondary }}>
                      <strong>Dx:</strong> {n.diagnosis}
                    </div>
                  )}
                  {n.treatmentPlan && (
                    <div style={{ fontSize: theme.fontSize.base, color: theme.text.secondary }}>
                      <strong>Plan:</strong> {n.treatmentPlan}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* Tab 2: Orders Queue */}
      {activeTab === "orders" && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}>
          {/* New order form */}
          <Card title="New Order" bodyStyle={{ padding: theme.spacing["4"] }}>
            <form
              onSubmit={handleCreateOrder}
              style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: theme.spacing["4"],
                  alignItems: "start",
                }}
              >
                <FormField label="Order type">
                  <Select value={orderType} onChange={(e) => setOrderType(e.target.value)}>
                    {ORDER_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.replace(/_/g, " ").toUpperCase()}
                      </option>
                    ))}
                  </Select>
                </FormField>

                {orderType === "prescription" && (
                  <>
                    <FormField label="Medication" required>
                      <div style={{ position: "relative" }}>
                        <Input
                          value={orderMedication}
                          onChange={(e) => {
                            setOrderMedication(e.target.value);
                            setCdsMedication(e.target.value);
                            setMedSuggOpen(e.target.value.length > 0);
                          }}
                          onFocus={() => { if (orderMedication.length > 0) setMedSuggOpen(true); }}
                          onBlur={() => setTimeout(() => setMedSuggOpen(false), 200)}
                          placeholder="e.g. Paracetamol 500mg"
                        />
                        {medSuggOpen && orderMedication.length > 0 && (
                          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: theme.surface.card, border: `1px solid ${theme.surface.border}`, borderRadius: theme.radius.md, maxHeight: "12rem", overflowY: "auto", zIndex: 50 }}>
                            {pharmacyMedicines
                              .filter((m) => m.genericName.toLowerCase().includes(orderMedication.toLowerCase()) || m.brand.toLowerCase().includes(orderMedication.toLowerCase()))
                              .slice(0, 8)
                              .map((m) => (
                                <div key={m.id} style={{ padding: theme.spacing["2"], cursor: "pointer", borderBottom: `1px solid ${theme.surface.border}` }}
                                  onMouseDown={() => {
                                    setOrderMedication(`${m.genericName} ${m.strength}`.trim());
                                    setCdsMedication(`${m.genericName} ${m.strength}`.trim());
                                    setMedSuggOpen(false);
                                  }}>
                                  <div style={{ fontWeight: theme.fontWeight.semibold, fontSize: theme.fontSize.sm }}>{m.genericName} {m.strength}</div>
                                  <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted }}>{m.brand} | {m.dosageForm} | {m.category}</div>
                                </div>
                              ))}
                            {pharmacyMedicines.filter((m) => m.genericName.toLowerCase().includes(orderMedication.toLowerCase()) || m.brand.toLowerCase().includes(orderMedication.toLowerCase())).length === 0 && (
                              <div style={{ padding: theme.spacing["2"], fontSize: theme.fontSize.sm, color: theme.text.muted }}>No matching medicines in inventory</div>
                            )}
                          </div>
                        )}
                      </div>
                    </FormField>
                    <FormField label="Dosage">
                      <Input
                        value={orderDosage}
                        onChange={(e) => setOrderDosage(e.target.value)}
                        placeholder="e.g. 1 tab q6h"
                      />
                    </FormField>
                    <FormField label="Frequency">
                      <Input
                        value={orderFrequency}
                        onChange={(e) => setOrderFrequency(e.target.value)}
                        placeholder="e.g. TDS"
                      />
                    </FormField>
                    <FormField label="Duration (days)">
                      <Input
                        type="number"
                        min={1}
                        value={orderDuration}
                        onChange={(e) => setOrderDuration(e.target.value)}
                      />
                    </FormField>
                  </>
                )}

                {orderType === "lab_investigation" && (
                  <>
                    <FormField label="Investigation / Test" required>
                      <div style={{ position: "relative" }}>
                        <Input
                          value={orderTest}
                          onChange={(e) => { setOrderTest(e.target.value); setTestSuggOpen(e.target.value.length > 0); }}
                          onFocus={() => { if (orderTest.length > 0) setTestSuggOpen(true); }}
                          onBlur={() => setTimeout(() => setTestSuggOpen(false), 200)}
                          placeholder="e.g. FBC, Malaria parasite, LFT"
                        />
                        {testSuggOpen && orderTest.length > 0 && (
                          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: theme.surface.card, border: `1px solid ${theme.surface.border}`, borderRadius: theme.radius.md, maxHeight: "12rem", overflowY: "auto", zIndex: 50 }}>
                            {labTests
                              .filter((t) => t.name.toLowerCase().includes(orderTest.toLowerCase()) || t.category.toLowerCase().includes(orderTest.toLowerCase()))
                              .slice(0, 8)
                              .map((t) => (
                                <div key={t.id} style={{ padding: theme.spacing["2"], cursor: "pointer", borderBottom: `1px solid ${theme.surface.border}` }}
                                  onMouseDown={() => {
                                    setOrderTest(t.name);
                                    if (t.specimenType) setOrderSpecimen(t.specimenType);
                                    setTestSuggOpen(false);
                                  }}>
                                  <div style={{ fontWeight: theme.fontWeight.semibold, fontSize: theme.fontSize.sm }}>{t.name}</div>
                                  <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted }}>{t.category}{t.specimenType ? ` | Specimen: ${t.specimenType}` : ""}</div>
                                </div>
                              ))}
                            {labTests.filter((t) => t.name.toLowerCase().includes(orderTest.toLowerCase()) || t.category.toLowerCase().includes(orderTest.toLowerCase())).length === 0 && (
                              <div style={{ padding: theme.spacing["2"], fontSize: theme.fontSize.sm, color: theme.text.muted }}>No matching tests in catalogue</div>
                            )}
                          </div>
                        )}
                      </div>
                    </FormField>
                    <FormField label="Specimen type">
                      <Input
                        value={orderSpecimen}
                        onChange={(e) => setOrderSpecimen(e.target.value)}
                        placeholder="e.g. Whole blood, Urine, Stool"
                      />
                    </FormField>
                    <FormField label="Priority">
                      <Select value={orderPriority} onChange={(e) => setOrderPriority(e.target.value)}>
                        <option value="routine">Routine</option>
                        <option value="urgent">Urgent</option>
                        <option value="stat">STAT</option>
                      </Select>
                    </FormField>
                  </>
                )}

                {orderType === "radiology_imaging" && (
                  <>
                    <FormField label="Modality" required>
                      <Select value={orderModality} onChange={(e) => setOrderModality(e.target.value)}>
                        {["X-ray", "Ultrasound", "CT scan", "MRI", "ECG", "Echocardiogram"].map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                    <FormField label="Region / Body part" required>
                      <Input
                        value={orderRegion}
                        onChange={(e) => setOrderRegion(e.target.value)}
                        placeholder="e.g. Chest PA, Right ankle, Abdomen"
                      />
                    </FormField>
                    <FormField label="Clinical indication">
                      <Input
                        value={orderNotes}
                        onChange={(e) => setOrderNotes(e.target.value)}
                        placeholder="Why is this imaging needed?"
                      />
                    </FormField>
                  </>
                )}

                {orderType === "nursing_procedure" && (
                  <>
                    <FormField label="Procedure" required>
                      <Input
                        value={orderProcedure}
                        onChange={(e) => setOrderProcedure(e.target.value)}
                        placeholder="e.g. Insert IV line, Wound dressing"
                      />
                    </FormField>
                    <FormField label="Frequency">
                      <Input
                        value={orderFrequency}
                        onChange={(e) => setOrderFrequency(e.target.value)}
                        placeholder="e.g. 8-hourly, once"
                      />
                    </FormField>
                    <FormField label="Instructions">
                      <Input
                        value={orderNotes}
                        onChange={(e) => setOrderNotes(e.target.value)}
                        placeholder="Additional nursing instructions"
                      />
                    </FormField>
                  </>
                )}

                {orderType === "dietary_ward" && (
                  <>
                    <FormField label="Diet type" required>
                      <Select value={orderDiet} onChange={(e) => setOrderDiet(e.target.value)}>
                        {[
                          "Regular diet",
                          "Diabetic diet",
                          "Low-salt diet",
                          "High-protein diet",
                          "Soft diet",
                          "Fluid only",
                          "NPO (nil by mouth)",
                        ].map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                    <FormField label="Ward instructions">
                      <Input
                        value={orderNotes}
                        onChange={(e) => setOrderNotes(e.target.value)}
                        placeholder="e.g. Serve warm, monitor intake"
                      />
                    </FormField>
                  </>
                )}

                {(orderType === "lab_request" ||
                  orderType === "nursing_order" ||
                  orderType === "referral") && (
                  <div style={{ gridColumn: "span 2" }}>
                    <FormField label="Description" required>
                      <Input
                        value={orderDescription}
                        onChange={(e) => setOrderDescription(e.target.value)}
                        placeholder="What should be done?"
                      />
                    </FormField>
                  </div>
                )}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Button type="submit" loading={saving} disabled={!selectedPatient}>
                  Submit Order
                </Button>
              </div>
            </form>
          </Card>

          {/* Actionable orders */}
          <Card bodyStyle={{ padding: 0 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: `${theme.spacing["3"]} ${theme.spacing["4"]}`,
                borderBottom: `1px solid ${theme.surface.border}`,
                fontSize: theme.fontSize.sm,
                color: theme.text.muted,
              }}
            >
              <span>
                <strong>LIVE QUEUE</strong> — refreshes automatically every 5s
              </span>
              <span>
                Last sync: {lastSync || "—"} ·{" "}
                <Button size="sm" variant="ghost" onClick={() => void loadOrders()}>
                  Refresh now
                </Button>
              </span>
            </div>
            {loading ? (
              <p
                style={{
                  padding: theme.spacing["4"],
                  color: theme.text.muted,
                  fontSize: theme.fontSize.base,
                }}
              >
                Loading orders…
              </p>
            ) : orders.length === 0 ? (
              <EmptyState icon="clipboard" description="No orders awaiting action." />
            ) : (
              <DataTable columns={orderColumns} rows={orders} rowKey={(o) => o.id} dense />
            )}
          </Card>
        </div>
      )}

      {/* History timeline drawer */}
      <Modal
        open={historyOpen}
        title="Patient History Timeline"
        onClose={() => setHistoryOpen(false)}
        width={720}
        footer={
          <Button variant="outline" onClick={() => setHistoryOpen(false)}>
            Close
          </Button>
        }
      >
        {selectedPatient && (
          <div style={{ marginBottom: theme.spacing["3"], color: theme.text.secondary }}>
            <strong style={{ color: theme.action.info }}>{selectedPatient.patientNo}</strong>{" "}
            {selectedPatient.firstName} {selectedPatient.lastName}
          </div>
        )}
        <TabNav
          tabs={[
            { key: "notes", label: "Consultations" },
            { key: "vitals", label: "Vitals Trend" },
            { key: "lab", label: "Lab Results" },
          ]}
          active={historyTab}
          onChange={(k) => setHistoryTab(k as "notes" | "vitals" | "lab")}
        />
        {!history ? (
          <p style={{ color: theme.text.muted, fontSize: theme.fontSize.base, marginTop: theme.spacing["3"] }}>
            Loading history…
          </p>
        ) : (
          <div style={{ marginTop: theme.spacing["3"] }}>
            {historyTab === "notes" && (
              <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["3"] }}>
                {history.notes.length === 0 && (
                  <EmptyState icon="clipboard" description="No consultations on record." />
                )}
                {history.notes.map((n) => (
                  <div
                    key={n.id}
                    style={{
                      border: `1px solid ${theme.surface.border}`,
                      borderRadius: theme.radius.md,
                      padding: theme.spacing["3"],
                    }}
                  >
                    <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                      <strong>{n.noteType.toUpperCase()}</strong> • v{n.version} •{" "}
                      {n.authorName || "Unknown"} • {new Date(n.createdAt).toLocaleString()}
                      {n.signedAt && (
                        <span style={{ color: theme.action.success }}>
                          {" "}
                          • ✍ Signed by {n.signedByName || "—"}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: theme.fontSize.base, marginTop: theme.spacing["1"] }}>
                      {n.note}
                    </div>
                    {n.diagnosis && (
                      <div style={{ fontSize: theme.fontSize.base, color: theme.text.secondary }}>
                        <strong>Dx:</strong> {n.diagnosis}
                      </div>
                    )}
                    {n.treatmentPlan && (
                      <div style={{ fontSize: theme.fontSize.base, color: theme.text.secondary }}>
                        <strong>Plan:</strong> {n.treatmentPlan}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {historyTab === "vitals" && (
              <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["3"] }}>
                {history.vitals.length === 0 && (
                  <EmptyState icon="clock" description="No vitals recorded yet." />
                )}
                {history.vitals.map((v) => (
                  <div
                    key={v.id}
                    style={{
                      border: `1px solid ${theme.surface.border}`,
                      borderRadius: theme.radius.md,
                      padding: theme.spacing["3"],
                    }}
                  >
                    <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                      {new Date(v.recordedAt).toLocaleString()}
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                        gap: theme.spacing["2"],
                        marginTop: theme.spacing["2"],
                      }}
                    >
                      {VITAL_FIELDS.map((f) => {
                        const raw = v.measurements[f.key];
                        if (raw === undefined || raw === null || raw === "") return null;
                        return (
                          <div key={f.key} style={{ fontSize: theme.fontSize.sm }}>
                            <span style={{ color: theme.text.muted }}>{f.label}: </span>
                            <strong style={{ color: theme.text.primary }}>
                              {String(raw)}
                              {f.unit ? ` ${f.unit}` : ""}
                            </strong>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {historyTab === "lab" && (
              <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["3"] }}>
                {history.lab.length === 0 && (
                  <EmptyState icon="flask" description="No released lab results on record." />
                )}
                {history.lab.map((l) => (
                  <div
                    key={l.id}
                    style={{
                      border: `1px solid ${theme.surface.border}`,
                      borderRadius: theme.radius.md,
                      padding: theme.spacing["3"],
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: theme.spacing["2"],
                        flexWrap: "wrap",
                      }}
                    >
                      <strong style={{ color: theme.action.info }}>{l.requestNo}</strong>
                      <StatusBadge variant="approved" label="Released" />
                    </div>
                    <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                      {l.tests.join(", ")} • Released{" "}
                      {l.releasedAt ? new Date(l.releasedAt).toLocaleString() : ""}
                    </div>
                    {l.results.some((r) => r.result) && (
                      <div style={{ marginTop: theme.spacing["2"] }}>
                        {l.results
                          .filter((r) => r.result)
                          .map((r, i) => (
                            <div key={i} style={{ fontSize: theme.fontSize.base }}>
                              <strong>{r.testName}:</strong> {r.result}
                              {r.critical && (
                                <span style={{ color: theme.action.danger, marginLeft: theme.spacing["1"] }}>
                                  (critical)
                                </span>
                              )}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Signature / attestation modal */}
      <Modal
        open={signTarget !== null}
        title="Digital Sign-off & Attestation"
        onClose={() => {
          setSignTarget(null);
          setSignPassword("");
        }}
        width={440}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setSignTarget(null);
                setSignPassword("");
              }}
            >
              Cancel
            </Button>
            <Button onClick={submitSignature} loading={signing}>
              Attest with Password
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["3"] }}>
          <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.secondary }}>
            Re-enter your password to cryptographically attest this{" "}
            {signTarget?.kind === "note" ? "consultation note" : "order"} with your verified
            credentials. The attestation is hashed, stored, and logged to the audit trail for
            compliance.
          </p>
          <FormField label="Password" required>
            <Input
              type="password"
              value={signPassword}
              onChange={(e) => setSignPassword(e.target.value)}
              placeholder="Your password"
            />
          </FormField>
        </div>
      </Modal>

      {/* ── My Patients' Bills Tab ── */}
      {activeTab === "bills" && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
          <Card title="My Patients' Bills" bodyStyle={{ padding: 0 }}>
            {loadingBills && (
              <p style={{ padding: theme.spacing["4"], color: theme.text.muted, fontSize: theme.fontSize.base }}>
                Loading bills...
              </p>
            )}
            {!loadingBills && bills.length === 0 && (
              <div style={{ padding: theme.spacing["6"], textAlign: "center" }}>
                <p style={{ color: theme.text.muted, fontSize: theme.fontSize.base }}>
                  No bills found for your patients.
                </p>
              </div>
            )}
            {!loadingBills && bills.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: theme.fontSize.base }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${theme.surface.border}` }}>
                      {[
                        "Patient",
                        "Patient No",
                        "Invoice No",
                        "Total Charged",
                        "Paid",
                        "Balance",
                        "Status",
                        "Date",
                      ].map((h) => (
                        <th
                          key={h}
                          style={{
                            padding: `${theme.spacing["2"]} ${theme.spacing["3"]}`,
                            textAlign: "left",
                            fontWeight: theme.fontWeight.semibold,
                            color: theme.text.muted,
                            borderBottom: `1px solid ${theme.surface.border}`,
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bills.map((bill, idx) => {
                      const total = Number(bill.totalAmount) || 0;
                      const paid = Number(bill.amountPaid) || 0;
                      const bal = Number(bill.balanceDue) || 0;
                      return (
                        <tr
                          key={String(bill.invoiceId || idx)}
                          style={{ borderBottom: `1px solid ${theme.surface.border}` }}
                        >
                          <td style={{ padding: `${theme.spacing["2"]} ${theme.spacing["3"]}`, fontWeight: theme.fontWeight.semibold }}>
                            {String(bill.patientName)}
                          </td>
                          <td style={{ padding: `${theme.spacing["2"]} ${theme.spacing["3"]}` }}>
                            {String(bill.patientNo)}
                          </td>
                          <td style={{ padding: `${theme.spacing["2"]} ${theme.spacing["3"]}`, color: theme.action.info }}>
                            {String(bill.invoiceNo)}
                          </td>
                          <td style={{ padding: `${theme.spacing["2"]} ${theme.spacing["3"]}` }}>
                            {currency(total)}
                          </td>
                          <td style={{ padding: `${theme.spacing["2"]} ${theme.spacing["3"]}`, color: theme.action.success }}>
                            {currency(paid)}
                          </td>
                          <td
                            style={{
                              padding: `${theme.spacing["2"]} ${theme.spacing["3"]}`,
                              fontWeight: theme.fontWeight.bold,
                              color: bal > 0 ? theme.action.danger : theme.action.success,
                            }}
                          >
                            {currency(bal)}
                          </td>
                          <td style={{ padding: `${theme.spacing["2"]} ${theme.spacing["3"]}` }}>
                            <StatusBadge variant={invoiceStatusBadge(String(bill.status))} label={String(bill.status).replace("_", " ")} />
                          </td>
                          <td style={{ padding: `${theme.spacing["2"]} ${theme.spacing["3"]}`, color: theme.text.muted }}>
                            {bill.createdAt ? new Date(String(bill.createdAt)).toLocaleDateString() : "--"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      <ChargeConfirmationModal
        open={chargeConfirmOpen}
        onClose={() => setChargeConfirmOpen(false)}
        onConfirmed={() => void loadOrders()}
        orderId={chargeOrderId}
        orderType={orderType}
        orderDetails={chargeOrderDetails}
        patientName={selectedPatient ? `${selectedPatient.firstName} ${selectedPatient.lastName}` : ""}
        patientNo={selectedPatient?.patientNo || ""}
      />

      <ChargePatientModal
        open={showCharge}
        onClose={() => setShowCharge(false)}
        onCharged={() => { /* bills will refresh on next tab switch */ }}
      />
    </div>
  );
}

function VitalInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>{label}</label>
      <Input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
