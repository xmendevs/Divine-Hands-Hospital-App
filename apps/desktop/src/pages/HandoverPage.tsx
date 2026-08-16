import { useCallback, useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { apiFetch } from "../api/client";

interface Handover {
  id: string;
  handoverNo: string;
  outgoingStaffName: string;
  departmentName: string;
  shiftName: string;
  patientIds: string[];
  currentCondition: string;
  medications: string;
  pendingInvestigations: string;
  pendingOrders: string;
  importantObservations: string;
  tasks: string;
  incidents: string;
  instructions: string;
  status: string;
  acknowledgedByName: string;
  acknowledgedAt?: string;
  createdAt: string;
}

const EMPTY_FORM = {
  currentCondition: "",
  medications: "",
  pendingInvestigations: "",
  pendingOrders: "",
  importantObservations: "",
  tasks: "",
  incidents: "",
  instructions: "",
  patientIds: "",
};

export default function HandoverPage() {
  const [handovers, setHandovers] = useState<Handover[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const results = await apiFetch<Handover[]>("/handovers");
      setHandovers(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load handovers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.currentCondition.trim()) {
      setError("A summary of the current patient condition is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiFetch<unknown>("/handovers", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          patientIds: form.patientIds
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      setForm(EMPTY_FORM);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the handover.");
    } finally {
      setSaving(false);
    }
  }

  async function acknowledge(h: Handover) {
    setError("");
    try {
      await apiFetch<unknown>(`/handovers/${h.id}/acknowledge`, { method: "POST" });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not acknowledge the handover.");
    }
  }

  return (
    <div style={{ maxWidth: "1100px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0f172a", margin: 0 }}>✍️ Shift Handover Log</h2>
          <p style={{ color: "#64748b", margin: "0.2rem 0 0 0" }}>
            Manage clinical and administrative shift transitions securely across hospital units.
          </p>
        </div>
        <span style={{ fontSize: "0.75rem", background: "#e0f2fe", color: "#0369a1", padding: "0.3rem 0.75rem", borderRadius: "20px", fontWeight: 700 }}>
          Active Shift Portal
        </span>
      </div>

      {error && (
        <p role="alert" style={{ margin: "0 0 1rem 0", fontSize: "0.85rem", color: "#b91c1c" }}>
          {error}
        </p>
      )}

      {/* New Handover Form */}
      <div style={{ background: "#fff", padding: "1.5rem", borderRadius: "10px", border: "1px solid #e2e8f0", marginBottom: "2rem", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
        <h3 style={{ fontSize: "1.05rem", fontWeight: 700, color: "#1e293b", marginBottom: "1rem" }}>Submit New Shift Handover</h3>
        <form onSubmit={handleSubmit} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <FormField label="Patient IDs (comma-separated, optional)">
            <input type="text" value={form.patientIds} onChange={(e) => setForm({ ...form, patientIds: e.target.value })} placeholder="e.g. patient-uuid-1, patient-uuid-2" style={input} />
          </FormField>
          <FormField label="Medications (optional)">
            <input type="text" value={form.medications} onChange={(e) => setForm({ ...form, medications: e.target.value })} placeholder="e.g. IV Ceftriaxone 1g BD" style={input} />
          </FormField>
          <div style={{ gridColumn: "span 2" }}>
            <FormField label="Current patient condition & critical notes *">
              <textarea rows={3} required value={form.currentCondition} onChange={(e) => setForm({ ...form, currentCondition: e.target.value })} placeholder="Summarize patient conditions, critical care steps taken..." style={{ ...input, resize: "vertical" }} />
            </FormField>
          </div>
          <FormField label="Pending investigations">
            <input type="text" value={form.pendingInvestigations} onChange={(e) => setForm({ ...form, pendingInvestigations: e.target.value })} placeholder="e.g. Pending lab reports" style={input} />
          </FormField>
          <FormField label="Pending orders">
            <input type="text" value={form.pendingOrders} onChange={(e) => setForm({ ...form, pendingOrders: e.target.value })} placeholder="e.g. Pending pharmacy orders" style={input} />
          </FormField>
          <FormField label="Important observations">
            <input type="text" value={form.importantObservations} onChange={(e) => setForm({ ...form, importantObservations: e.target.value })} style={input} />
          </FormField>
          <FormField label="Outstanding tasks">
            <input type="text" value={form.tasks} onChange={(e) => setForm({ ...form, tasks: e.target.value })} style={input} />
          </FormField>
          <FormField label="Incidents">
            <input type="text" value={form.incidents} onChange={(e) => setForm({ ...form, incidents: e.target.value })} style={input} />
          </FormField>
          <FormField label="Instructions for incoming shift">
            <input type="text" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} style={input} />
          </FormField>
          <div style={{ gridColumn: "span 2", display: "flex", justifyContent: "flex-end" }}>
            <button type="submit" disabled={saving} style={{ padding: "0.65rem 1.5rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 700, cursor: "pointer" }}>
              {saving ? "Saving…" : "Save & Sign Handover"}
            </button>
          </div>
        </form>
      </div>

      {/* Handover Logs List */}
      <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#1e293b", marginBottom: "1rem" }}>Recorded Shift Handovers</h3>
      {loading ? (
        <p style={{ color: "#64748b", fontSize: "0.9rem" }}>Loading handovers…</p>
      ) : handovers.length === 0 ? (
        <p style={{ color: "#64748b", fontSize: "0.9rem" }}>No handovers recorded yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {handovers.map((h) => (
            <div key={h.id} style={{ background: "#fff", borderRadius: "10px", border: "1px solid #e2e8f0", padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", borderBottom: "1px solid #f1f5f9", paddingBottom: "0.5rem" }}>
                <div>
                  <span style={{ fontWeight: 800, color: "#0f172a", fontSize: "0.95rem" }}>{h.handoverNo}</span>
                  <span style={{ marginLeft: "1rem", fontSize: "0.8rem", color: "#64748b" }}>
                    {h.shiftName ? `${h.shiftName} · ` : ""}{h.departmentName || "—"} · {new Date(h.createdAt).toLocaleString()}
                  </span>
                </div>
                <span style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem", borderRadius: "4px", background: h.status === "acknowledged" ? "#dcfce7" : "#fef9c3", color: h.status === "acknowledged" ? "#166534" : "#854d0e", fontWeight: 700 }}>
                  {h.status.toUpperCase()}
                </span>
              </div>

              <div style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
                <strong>Outgoing:</strong> {h.outgoingStaffName || "—"}
                {h.acknowledgedByName && (
                  <span style={{ marginLeft: "1.5rem", color: "#16a34a" }}>
                    <strong>Acknowledged by:</strong> {h.acknowledgedByName}
                  </span>
                )}
              </div>

              <div style={{ background: "#f8fafc", padding: "0.75rem", borderRadius: "6px", fontSize: "0.85rem", marginBottom: "0.5rem" }}>
                <strong>Current Condition:</strong> {h.currentCondition || "—"}
              </div>

              {(h.medications || h.pendingInvestigations || h.pendingOrders || h.importantObservations || h.tasks || h.incidents || h.instructions) && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
                  {h.medications && <Detail label="Medications" value={h.medications} />}
                  {h.pendingInvestigations && <Detail label="Pending Investigations" value={h.pendingInvestigations} />}
                  {h.pendingOrders && <Detail label="Pending Orders" value={h.pendingOrders} />}
                  {h.importantObservations && <Detail label="Observations" value={h.importantObservations} />}
                  {h.tasks && <Detail label="Tasks" value={h.tasks} />}
                  {h.incidents && <Detail label="Incidents" value={h.incidents} />}
                  {h.instructions && <Detail label="Instructions" value={h.instructions} />}
                </div>
              )}

              {h.status !== "acknowledged" && (
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button onClick={() => acknowledge(h)} style={primaryBtn}>
                    Acknowledge Handover
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <strong>{label}:</strong> {value}
    </div>
  );
}

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "0.3rem" }}>{label}</label>
      {children}
    </div>
  );
}

const input: CSSProperties = { width: "100%", padding: "0.6rem", borderRadius: "6px", border: "1px solid #cbd5e1", boxSizing: "border-box" };
const primaryBtn: CSSProperties = { padding: "0.5rem 1rem", background: "#16a34a", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 700, cursor: "pointer", fontSize: "0.85rem" };
