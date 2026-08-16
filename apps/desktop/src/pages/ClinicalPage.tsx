import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
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
        const results = await apiFetch<PatientSummary[]>(`/patients/search?q=${encodeURIComponent(q)}`);
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
      return [o.details.medication, o.details.dosage, o.details.frequency, o.details.durationDays ? `${o.details.durationDays} days` : ""]
        .filter(Boolean)
        .join(" · ");
    }
    return String(o.details.description ?? "");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Sub-navigation Header */}
      <div style={{ display: "flex", gap: "1rem", borderBottom: "2px solid #e2e8f0", paddingBottom: "0.5rem" }}>
        <button
          onClick={() => setActiveTab("consultation")}
          style={tabStyle(activeTab === "consultation")}
        >
          Doctor Consultation & Vitals
        </button>
        <button
          onClick={() => setActiveTab("orders")}
          style={tabStyle(activeTab === "orders")}
        >
          Orders Queue (Pharmacy & Lab)
        </button>
      </div>

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: "0.85rem", color: "#b91c1c" }}>
          {error}
        </p>
      )}

      {/* Patient picker (shared) */}
      <div style={{ background: "#fff", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
        <label style={{ display: "block", fontSize: "0.75rem", color: "#64748b", fontWeight: 700, marginBottom: "0.3rem" }}>
          SELECT PATIENT
        </label>
        {selectedPatient ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#0f172a" }}>
              {selectedPatient.firstName} {selectedPatient.lastName}{" "}
              <span style={{ color: "#0369a1", fontWeight: 700 }}>({selectedPatient.patientNo})</span>
            </div>
            <button onClick={() => setSelectedPatient(null)} style={ghostBtn}>
              Change patient
            </button>
          </div>
        ) : (
          <div style={{ position: "relative" }}>
            <input
              type="text"
              placeholder="Search patient by name or patient number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%", padding: "0.5rem 0.75rem", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "0.9rem", boxSizing: "border-box" }}
            />
            {patients.length > 0 && (
              <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#fff", border: "1px solid #e2e8f0", borderRadius: "6px", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)", zIndex: 10, overflow: "hidden" }}>
                {patients.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => choosePatient(p)}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "0.6rem 0.75rem", border: "none", borderBottom: "1px solid #f1f5f9", background: "#fff", cursor: "pointer", fontSize: "0.85rem" }}
                  >
                    <strong style={{ color: "#0369a1" }}>{p.patientNo}</strong> — {p.firstName} {p.lastName}{" "}
                    <span style={{ color: "#64748b" }}>({p.gender})</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tab 1: Doctor Consultation Form */}
      {activeTab === "consultation" && (
        <form onSubmit={handleSaveConsultation} style={{ background: "#fff", padding: "1.5rem", borderRadius: "8px", border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <h3 style={{ margin: 0, color: "#0f172a" }}>Record Consultation & Patient Vitals</h3>

          <div style={{ background: "#f8fafc", padding: "1rem", borderRadius: "6px", border: "1px solid #cbd5e1" }}>
            <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#334155", marginBottom: "0.5rem" }}>PATIENT VITALS</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
              <VitalInput label="BP (mmHg)" value={vitals.bp} onChange={(v) => setVitals({ ...vitals, bp: v })} />
              <VitalInput label="Temp (°C)" value={vitals.temperature} onChange={(v) => setVitals({ ...vitals, temperature: v })} />
              <VitalInput label="Pulse (bpm)" value={vitals.pulse} onChange={(v) => setVitals({ ...vitals, pulse: v })} />
            </div>
          </div>

          <TextArea label="Presenting Complaints & Symptoms" required value={symptoms} onChange={setSymptoms} placeholder="e.g. Fever, headaches, persistent fatigue..." rows={3} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <TextArea label="Diagnosis" value={diagnosis} onChange={setDiagnosis} placeholder="Primary clinical diagnosis..." rows={3} />
            <TextArea label="Treatment Plan" value={treatmentPlan} onChange={setTreatmentPlan} placeholder="Prescriptions, lab tests required..." rows={3} />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="submit" disabled={saving || !selectedPatient} style={{ ...primaryBtn, opacity: !selectedPatient ? 0.5 : 1 }}>
              {saving ? "Saving…" : "Submit Consultation Note"}
            </button>
          </div>
        </form>
      )}

      {/* Tab 1b: Recent notes for the selected patient */}
      {activeTab === "consultation" && selectedPatient && (
        <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <div style={{ padding: "0.85rem 1rem", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontWeight: 700, color: "#334155", fontSize: "0.8rem" }}>
            RECENT CONSULTATION NOTES
          </div>
          {notes.length === 0 ? (
            <p style={{ margin: 0, padding: "1rem", color: "#64748b", fontSize: "0.85rem" }}>No clinical notes recorded yet.</p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {notes.map((n) => (
                <li key={n.id} style={{ padding: "0.85rem 1rem", borderBottom: "1px solid #f1f5f9" }}>
                  <div style={{ fontSize: "0.75rem", color: "#64748b" }}>
                    <strong>{n.noteType.toUpperCase()}</strong> • v{n.version} • {n.authorRole} • {new Date(n.createdAt).toLocaleString()}
                  </div>
                  <div style={{ fontSize: "0.9rem", color: "#334155", marginTop: "0.25rem" }}>{n.note}</div>
                  {n.diagnosis && <div style={{ fontSize: "0.8rem", color: "#475569" }}><strong>Dx:</strong> {n.diagnosis}</div>}
                  {n.treatmentPlan && <div style={{ fontSize: "0.8rem", color: "#475569" }}><strong>Plan:</strong> {n.treatmentPlan}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Tab 2: Orders Queue */}
      {activeTab === "orders" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {/* New order form */}
          <form onSubmit={handleCreateOrder} style={{ background: "#fff", padding: "1.25rem", borderRadius: "8px", border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: "1rem" }}>
            <h3 style={{ margin: 0, color: "#0f172a", fontSize: "1rem" }}>New Order</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
              <div>
                <FieldLabel>Order type</FieldLabel>
                <select value={orderType} onChange={(e) => setOrderType(e.target.value)} style={input}>
                  {ORDER_TYPES.map((t) => (
                    <option key={t} value={t}>{t.replace("_", " ").toUpperCase()}</option>
                  ))}
                </select>
              </div>
              {orderType === "prescription" ? (
                <>
                  <div>
                    <FieldLabel>Medication *</FieldLabel>
                    <input value={orderMedication} onChange={(e) => setOrderMedication(e.target.value)} placeholder="e.g. Paracetamol 500mg" style={input} />
                  </div>
                  <div>
                    <FieldLabel>Dosage</FieldLabel>
                    <input value={orderDosage} onChange={(e) => setOrderDosage(e.target.value)} placeholder="e.g. 1 tab q6h" style={input} />
                  </div>
                  <div>
                    <FieldLabel>Frequency</FieldLabel>
                    <input value={orderFrequency} onChange={(e) => setOrderFrequency(e.target.value)} placeholder="e.g. TDS" style={input} />
                  </div>
                  <div>
                    <FieldLabel>Duration (days)</FieldLabel>
                    <input type="number" min={1} value={orderDuration} onChange={(e) => setOrderDuration(e.target.value)} style={input} />
                  </div>
                </>
              ) : (
                <div style={{ gridColumn: "span 2" }}>
                  <FieldLabel>Description *</FieldLabel>
                  <input value={orderDescription} onChange={(e) => setOrderDescription(e.target.value)} placeholder="What should be done?" style={input} />
                </div>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="submit" disabled={saving || !selectedPatient} style={{ ...primaryBtn, opacity: !selectedPatient ? 0.5 : 1 }}>
                {saving ? "Creating…" : "Submit Order"}
              </button>
            </div>
          </form>

          {/* Actionable orders */}
          <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
            {loading ? (
              <p style={{ padding: "1rem", color: "#64748b", fontSize: "0.9rem" }}>Loading orders…</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                <thead>
                  <tr style={{ background: "#f1f5f9", borderBottom: "1px solid #e2e8f0", color: "#475569", fontSize: "0.85rem" }}>
                    <th style={{ padding: "0.75rem 1rem" }}>ORDER NO</th>
                    <th style={{ padding: "0.75rem 1rem" }}>PATIENT</th>
                    <th style={{ padding: "0.75rem 1rem" }}>TYPE</th>
                    <th style={{ padding: "0.75rem 1rem" }}>DETAILS</th>
                    <th style={{ padding: "0.75rem 1rem" }}>STATUS</th>
                    <th style={{ padding: "0.75rem 1rem" }}>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ padding: "1.5rem", textAlign: "center", color: "#64748b" }}>
                        No orders awaiting action.
                      </td>
                    </tr>
                  )}
                  {orders.map((o) => (
                    <tr key={o.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "0.85rem 1rem", fontWeight: 600, color: "#0369a1" }}>{o.orderNo}</td>
                      <td style={{ padding: "0.85rem 1rem" }}>
                        <div style={{ fontSize: "0.8rem", color: "#64748b", fontFamily: "monospace" }}>{o.patientId}</div>
                      </td>
                      <td style={{ padding: "0.85rem 1rem", fontWeight: 600, fontSize: "0.85rem", color: "#475569" }}>
                        {o.orderType.replace("_", " ").toUpperCase()}
                      </td>
                      <td style={{ padding: "0.85rem 1rem", color: "#334155", fontSize: "0.85rem" }}>{orderInstructions(o) || "—"}</td>
                      <td style={{ padding: "0.85rem 1rem" }}>
                        <StatusBadge status={o.status} />
                      </td>
                      <td style={{ padding: "0.85rem 1rem" }}>
                        {(o.status === "submitted" || o.status === "accepted") && (
                          <button onClick={() => transitionOrder(o, "in_progress")} style={actionBtn("#3b82f6")}>
                            Start Processing
                          </button>
                        )}
                        {o.status === "in_progress" && (
                          <button onClick={() => transitionOrder(o, "completed")} style={actionBtn("#22c55e")}>
                            Mark Completed
                          </button>
                        )}
                        {o.status === "completed" && (
                          <span style={{ fontSize: "0.8rem", color: "#16a34a", fontWeight: 600 }}>Fulfilled</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function VitalInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label style={{ fontSize: "0.75rem", color: "#64748b" }}>{label}</label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} style={input} />
    </div>
  );
}

function TextArea({ label, value, onChange, placeholder, rows, required }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; rows: number; required?: boolean }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#475569", marginBottom: "0.3rem" }}>{label}</label>
      <textarea
        required={required}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid #cbd5e1", boxSizing: "border-box" }}
      />
    </div>
  );
}

function FieldLabel({ children }: { children: string }) {
  return <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "0.2rem" }}>{children}</label>;
}

function StatusBadge({ status }: { status: string }) {
  const done = status === "completed";
  const inProgress = status === "in_progress" || status === "accepted";
  const background = done ? "#f0fdf4" : inProgress ? "#fefce8" : "#f1f5f9";
  const color = done ? "#16a34a" : inProgress ? "#ca8a04" : "#475569";
  return (
    <span style={{ padding: "0.2rem 0.5rem", borderRadius: "4px", fontSize: "0.75rem", fontWeight: 600, background, color }}>
      {status.replace("_", " ").toUpperCase()}
    </span>
  );
}

function tabStyle(active: boolean): CSSProperties {
  return {
    padding: "0.5rem 1rem",
    border: "none",
    background: active ? "#0284c7" : "transparent",
    color: active ? "#fff" : "#64748b",
    borderRadius: "6px",
    fontWeight: 600,
    cursor: "pointer",
  };
}

const input: CSSProperties = { width: "100%", padding: "0.4rem", borderRadius: "4px", border: "1px solid #cbd5e1", boxSizing: "border-box" };
const primaryBtn: CSSProperties = {
  background: "#0284c7",
  color: "#fff",
  padding: "0.65rem 1.5rem",
  border: "none",
  borderRadius: "6px",
  fontWeight: 600,
  cursor: "pointer",
};
const ghostBtn: CSSProperties = { padding: "0.4rem 0.8rem", border: "1px solid #cbd5e1", background: "#fff", borderRadius: "4px", cursor: "pointer", fontSize: "0.8rem", color: "#475569" };
const actionBtn = (bg: string): CSSProperties => ({ padding: "0.3rem 0.6rem", background: bg, color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "0.75rem" });
