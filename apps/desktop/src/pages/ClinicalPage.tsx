import { useEffect, useState, type FormEvent } from "react";
import { theme, Button, Card, DataTable, EmptyState, FormField, Input, PageHeader, Select, StatusBadge, TabNav, Textarea, type StatusVariant } from "@hims/ui";
import { apiFetch } from "../api/client";

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
  authorRole: string;
  note: string;
  diagnosis: string;
  treatmentPlan: string;
  version: number;
  createdAt: string;
}

interface Order {
  id: string;
  orderNo: string;
  patientId: string;
  orderType: string;
  status: string;
  details: Record<string, unknown>;
  createdAt: string;
}

const ORDER_TYPES = ["prescription", "lab_request", "nursing_order", "referral"];

function orderStatusBadge(status: string): StatusVariant {
  if (status === "completed") return "approved";
  if (status === "in_progress" || status === "accepted") return "running";
  return "draft";
}

export default function ClinicalPage() {
  const [activeTab, setActiveTab] = useState<"consultation" | "orders">("consultation");

  // Patient selection (shared by both tabs).
  const [search, setSearch] = useState("");
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientSummary | null>(null);

  // Consultation form.
  const [symptoms, setSymptoms] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [treatmentPlan, setTreatmentPlan] = useState("");
  const [vitals, setVitals] = useState({ bp: "120/80", temperature: "36.8", pulse: "72" });

  // Notes history for the selected patient.
  const [notes, setNotes] = useState<ClinicalNote[]>([]);

  // Orders.
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderType, setOrderType] = useState("prescription");
  const [orderMedication, setOrderMedication] = useState("");
  const [orderDosage, setOrderDosage] = useState("");
  const [orderFrequency, setOrderFrequency] = useState("");
  const [orderDuration, setOrderDuration] = useState("");
  const [orderDescription, setOrderDescription] = useState("");

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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

  function choosePatient(p: PatientSummary) {
    setSelectedPatient(p);
    setSearch("");
    setPatients([]);
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
      await apiFetch<unknown>(`/patients/${selectedPatient.id}/observations`, {
        method: "POST",
        body: JSON.stringify({
          category: "vitals",
          measurements: vitals,
          notes: "",
        }),
      });
      setSymptoms("");
      setDiagnosis("");
      setTreatmentPlan("");
      await loadNotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save consultation.");
    } finally {
      setSaving(false);
    }
  }

  async function loadOrders() {
    setLoading(true);
    setError("");
    try {
      const results = await apiFetch<Order[]>("/orders/actionable");
      setOrders(results);
    } catch (err) {
      setOrders([]);
      setError(err instanceof Error ? err.message : "Could not load the orders queue.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab === "orders") void loadOrders();
  }, [activeTab]);

  async function handleCreateOrder(e: FormEvent) {
    e.preventDefault();
    if (!selectedPatient) {
      setError("Search for and select a patient first.");
      return;
    }
    const details: Record<string, unknown> = {};
    if (orderType === "prescription") {
      if (!orderMedication.trim()) {
        setError("Medication name is required for a prescription order.");
        return;
      }
      details.medication = orderMedication.trim();
      if (orderDosage.trim()) details.dosage = orderDosage.trim();
      if (orderFrequency.trim()) details.frequency = orderFrequency.trim();
      if (orderDuration.trim()) {
        const days = Number(orderDuration);
        if (Number.isFinite(days) && days > 0) details.durationDays = days;
      }
    } else {
      if (!orderDescription.trim()) {
        setError("Order description is required.");
        return;
      }
      details.description = orderDescription.trim();
    }

    setSaving(true);
    setError("");
    try {
      await apiFetch<unknown>(`/patients/${selectedPatient.id}/orders`, {
        method: "POST",
        body: JSON.stringify({ orderType, details, submit: true }),
      });
      setOrderMedication("");
      setOrderDosage("");
      setOrderFrequency("");
      setOrderDuration("");
      setOrderDescription("");
      await loadOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the order.");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the order.");
    }
  }

  function orderInstructions(o: Order): string {
    if (o.orderType === "prescription") {
      return [
        o.details.medication,
        o.details.dosage,
        o.details.frequency,
        o.details.durationDays ? `${o.details.durationDays} days` : "",
      ]
        .filter(Boolean)
        .join(" · ");
    }
    return String(o.details.description ?? "");
  }

  const orderColumns = [
    { key: "order", header: "Order No", render: (o: Order) => <strong style={{ color: theme.action.info }}>{o.orderNo}</strong> },
    {
      key: "patient",
      header: "Patient",
      render: (o: Order) => <span style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, fontFamily: "monospace" }}>{o.patientId}</span>,
    },
    {
      key: "type",
      header: "Type",
      render: (o: Order) => <strong style={{ fontSize: theme.fontSize.base, color: theme.text.secondary }}>{o.orderType.replace("_", " ").toUpperCase()}</strong>,
    },
    { key: "details", header: "Details", render: (o: Order) => orderInstructions(o) || "—" },
    { key: "status", header: "Status", render: (o: Order) => <StatusBadge variant={orderStatusBadge(o.status)} label={o.status.replace("_", " ")} /> },
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
            <Button size="sm" style={{ background: theme.action.success }} onClick={() => transitionOrder(o, "completed")}>
              Mark Completed
            </Button>
          )}
          {o.status === "completed" && (
            <span style={{ fontSize: theme.fontSize.base, color: theme.action.success, fontWeight: theme.fontWeight.semibold }}>
              Fulfilled
            </span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}>
      <PageHeader
        title="Orders & Clinical"
        description="Doctor consultation notes, patient vitals, and the orders queue."
      />

      <TabNav
        tabs={[
          { key: "consultation", label: "Doctor Consultation & Vitals" },
          { key: "orders", label: "Orders Queue (Pharmacy & Lab)" },
        ]}
        active={activeTab}
        onChange={(k) => setActiveTab(k as "consultation" | "orders")}
      />

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.danger }}>
          {error}
        </p>
      )}

      {/* Patient picker (shared) */}
      <Card bodyStyle={{ padding: theme.spacing["4"] }}>
        <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, fontWeight: theme.fontWeight.bold, marginBottom: theme.spacing["1"] }}>
          SELECT PATIENT
        </div>
        {selectedPatient ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: theme.spacing["2"], flexWrap: "wrap" }}>
            <div style={{ fontSize: theme.fontSize.base, fontWeight: theme.fontWeight.semibold, color: theme.text.primary }}>
              {selectedPatient.firstName} {selectedPatient.lastName}{" "}
              <span style={{ color: theme.action.info, fontWeight: theme.fontWeight.bold }}>({selectedPatient.patientNo})</span>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setSelectedPatient(null)}>
              Change patient
            </Button>
          </div>
        ) : (
          <div style={{ position: "relative" }}>
            <Input
              type="text"
              placeholder="Search patient by name or patient number..."
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
                    <strong style={{ color: theme.action.info }}>{p.patientNo}</strong> — {p.firstName}{" "}
                    {p.lastName} <span style={{ color: theme.text.muted }}>({p.gender})</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Tab 1: Doctor Consultation Form */}
      {activeTab === "consultation" && (
        <Card title="Record Consultation & Patient Vitals">
          <form onSubmit={handleSaveConsultation} style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}>
            <div
              style={{
                background: theme.surface.subtle,
                padding: theme.spacing["4"],
                borderRadius: theme.radius.md,
                border: `1px solid ${theme.surface.borderStrong}`,
              }}
            >
              <div style={{ fontSize: theme.fontSize.base, fontWeight: theme.fontWeight.bold, color: theme.text.secondary, marginBottom: theme.spacing["2"] }}>
                PATIENT VITALS
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: theme.spacing["4"] }}>
                <VitalInput label="BP (mmHg)" value={vitals.bp} onChange={(v) => setVitals({ ...vitals, bp: v })} />
                <VitalInput label="Temp (°C)" value={vitals.temperature} onChange={(v) => setVitals({ ...vitals, temperature: v })} />
                <VitalInput label="Pulse (bpm)" value={vitals.pulse} onChange={(v) => setVitals({ ...vitals, pulse: v })} />
              </div>
            </div>

            <FormField label="Presenting Complaints & Symptoms" required>
              <Textarea
                required
                value={symptoms}
                onChange={(e) => setSymptoms(e.target.value)}
                placeholder="e.g. Fever, headaches, persistent fatigue..."
                rows={3}
              />
            </FormField>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["4"] }}>
              <FormField label="Diagnosis">
                <Textarea
                  value={diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  placeholder="Primary clinical diagnosis..."
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
        <Card title="Recent Consultation Notes" bodyStyle={{ padding: 0 }}>
          {notes.length === 0 ? (
            <EmptyState icon="clipboard" description="No clinical notes recorded yet." />
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {notes.map((n) => (
                <li key={n.id} style={{ padding: `${theme.spacing["3"]} ${theme.spacing["4"]}`, borderBottom: `1px solid ${theme.surface.border}` }}>
                  <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                    <strong>{n.noteType.toUpperCase()}</strong> • v{n.version} • {n.authorRole} •{" "}
                    {new Date(n.createdAt).toLocaleString()}
                  </div>
                  <div style={{ fontSize: theme.fontSize.base, color: theme.text.secondary, marginTop: theme.spacing["1"] }}>
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
            <form onSubmit={handleCreateOrder} style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: theme.spacing["4"] }}>
                <FormField label="Order type">
                  <Select value={orderType} onChange={(e) => setOrderType(e.target.value)}>
                    {ORDER_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.replace("_", " ").toUpperCase()}
                      </option>
                    ))}
                  </Select>
                </FormField>
                {orderType === "prescription" ? (
                  <>
                    <FormField label="Medication" required>
                      <Input
                        value={orderMedication}
                        onChange={(e) => setOrderMedication(e.target.value)}
                        placeholder="e.g. Paracetamol 500mg"
                      />
                    </FormField>
                    <FormField label="Dosage">
                      <Input value={orderDosage} onChange={(e) => setOrderDosage(e.target.value)} placeholder="e.g. 1 tab q6h" />
                    </FormField>
                    <FormField label="Frequency">
                      <Input value={orderFrequency} onChange={(e) => setOrderFrequency(e.target.value)} placeholder="e.g. TDS" />
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
                ) : (
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
            {loading ? (
              <p style={{ padding: theme.spacing["4"], color: theme.text.muted, fontSize: theme.fontSize.base }}>Loading orders…</p>
            ) : orders.length === 0 ? (
              <EmptyState icon="clipboard" description="No orders awaiting action." />
            ) : (
              <DataTable columns={orderColumns} rows={orders} rowKey={(o) => o.id} dense />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function VitalInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>{label}</label>
      <Input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
