import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
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

interface TimelineEvent {
  id: string;
  eventType: string;
  summary: string;
  occurredAt: string;
}

const REGISTRATION_TYPES = [
  { value: "normal", label: "Normal" },
  { value: "antenatal", label: "Antenatal" },
  { value: "emergency", label: "Emergency" },
];

export default function PatientsPage() {
  const [search, setSearch] = useState("");
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [selected, setSelected] = useState<PatientSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    gender: "Male",
    dateOfBirth: "",
    phone: "",
    registrationType: "normal",
  });

  // Debounced search against the real endpoint.
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setPatients([]);
      setError("");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const results = await apiFetch<PatientSummary[]>(`/patients/search?q=${encodeURIComponent(q)}`);
        if (!cancelled) setPatients(results);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Search failed.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search, reload]);

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await apiFetch<unknown>("/patients", {
        method: "POST",
        body: JSON.stringify(formData),
      });
      setShowModal(false);
      setFormData({ firstName: "", lastName: "", gender: "Male", dateOfBirth: "", phone: "", registrationType: "normal" });
      setReload((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not register patient.");
    } finally {
      setSaving(false);
    }
  }

  async function openEmr(p: PatientSummary) {
    setSelected(p);
    setTimeline([]);
    setError("");
    try {
      const events = await apiFetch<TimelineEvent[]>(`/patients/${p.id}/timeline`);
      setTimeline(events);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load timeline.");
    }
  }

  function fullName(p: PatientSummary) {
    return `${p.firstName} ${p.lastName}`.trim();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
        <input
          type="text"
          placeholder="Search patient by name or patient number (e.g. E-1201)..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, padding: "0.6rem 1rem", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "0.95rem" }}
        />
        <button onClick={() => setShowModal(true)} style={primaryBtn}>
          + Register Patient
        </button>
      </div>

      {error && <p role="alert" style={{ margin: 0, fontSize: "0.85rem", color: "#b91c1c" }}>{error}</p>}

      <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
          <thead>
            <tr style={{ background: "#f1f5f9", borderBottom: "1px solid #e2e8f0", color: "#475569", fontSize: "0.85rem" }}>
              <th style={th}>PATIENT NO</th>
              <th style={th}>FULL NAME</th>
              <th style={th}>TYPE</th>
              <th style={th}>GENDER / DOB</th>
              <th style={th}>PHONE</th>
              <th style={th}>ACTION</th>
            </tr>
          </thead>
          <tbody>
            {!search.trim() && !loading && (
              <tr>
                <td colSpan={6} style={{ padding: "1.5rem", textAlign: "center", color: "#64748b" }}>
                  Type at least one character to search patients.
                </td>
              </tr>
            )}
            {search.trim() && loading && (
              <tr>
                <td colSpan={6} style={{ padding: "1.5rem", textAlign: "center", color: "#64748b" }}>
                  Searching…
                </td>
              </tr>
            )}
            {search.trim() && !loading && patients.length === 0 && !error && (
              <tr>
                <td colSpan={6} style={{ padding: "1.5rem", textAlign: "center", color: "#64748b" }}>
                  No patients match “{search}”.
                </td>
              </tr>
            )}
            {patients.map((p) => (
              <tr key={p.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ ...td, fontWeight: 600, color: "#0369a1" }}>{p.patientNo}</td>
                <td style={{ ...td, fontWeight: 500 }}>{fullName(p)}</td>
                <td style={td}>
                  <span style={badge(p.registrationType)}>{p.registrationType}</span>
                </td>
                <td style={{ ...td, color: "#64748b" }}>
                  {p.gender}
                  {p.dateOfBirth ? `, ${p.dateOfBirth}` : ""}
                </td>
                <td style={{ ...td, color: "#64748b" }}>{p.phone || "—"}</td>
                <td style={td}>
                  <button onClick={() => openEmr(p)} style={viewBtn}>
                    View EMR
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div style={modalBackdrop}>
          <div style={{ background: "#fff", width: "450px", borderRadius: "8px", padding: "1.5rem", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)" }}>
            <h3 style={{ margin: "0 0 1rem 0", color: "#0f172a" }}>Register New Patient</h3>
            <form onSubmit={handleRegister} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <Field label="First name">
                <input required value={formData.firstName} onChange={(e) => setFormData({ ...formData, firstName: e.target.value })} style={input} />
              </Field>
              <Field label="Last name">
                <input required value={formData.lastName} onChange={(e) => setFormData({ ...formData, lastName: e.target.value })} style={input} />
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <Field label="Registration type">
                  <select value={formData.registrationType} onChange={(e) => setFormData({ ...formData, registrationType: e.target.value })} style={input}>
                    {REGISTRATION_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Gender">
                  <select value={formData.gender} onChange={(e) => setFormData({ ...formData, gender: e.target.value })} style={input}>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </Field>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <Field label="Date of birth (YYYY-MM-DD)">
                  <input type="date" value={formData.dateOfBirth} onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })} style={input} />
                </Field>
                <Field label="Phone number">
                  <input type="text" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} style={input} />
                </Field>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
                <button type="button" onClick={() => setShowModal(false)} style={cancelBtn}>
                  Cancel
                </button>
                <button type="submit" disabled={saving} style={primaryBtn}>
                  {saving ? "Saving…" : "Save Registration"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selected && (
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", padding: "1.25rem", borderRadius: "8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, color: "#0f172a" }}>
              Patient EMR Timeline — {fullName(selected)} ({selected.patientNo})
            </h3>
            <button onClick={() => setSelected(null)} style={cancelBtn}>
              Close
            </button>
          </div>
          <hr style={{ border: "none", borderTop: "1px solid #e2e8f0", margin: "0.75rem 0 1rem 0" }} />
          {timeline.length === 0 ? (
            <p style={{ color: "#64748b", fontSize: "0.9rem" }}>No timeline events recorded yet.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {timeline.map((ev) => (
                <li key={ev.id} style={{ fontSize: "0.9rem", color: "#334155" }}>
                  <strong>{ev.eventType}</strong> — {ev.summary}{" "}
                  <span style={{ color: "#94a3b8", fontSize: "0.8rem" }}>{new Date(ev.occurredAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "0.2rem" }}>{label}</label>
      {children}
    </div>
  );
}

function badge(registrationType: string): CSSProperties {
  const emergency = registrationType === "emergency";
  const antenatal = registrationType === "antenatal";
  return {
    padding: "0.2rem 0.5rem",
    borderRadius: "4px",
    fontSize: "0.75rem",
    fontWeight: 600,
    background: emergency ? "#fef2f2" : antenatal ? "#fdf4ff" : "#f0fdf4",
    color: emergency ? "#dc2626" : antenatal ? "#c026d3" : "#16a34a",
  };
}

const th: CSSProperties = { padding: "0.75rem 1rem" };
const td: CSSProperties = { padding: "0.85rem 1rem" };
const input: CSSProperties = { width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid #cbd5e1" };
const primaryBtn: CSSProperties = {
  background: "#0284c7",
  color: "#fff",
  padding: "0.65rem 1.25rem",
  border: "none",
  borderRadius: "6px",
  cursor: "pointer",
  fontWeight: 600,
};
const cancelBtn: CSSProperties = { padding: "0.5rem 1rem", border: "none", background: "#e2e8f0", borderRadius: "4px", cursor: "pointer" };
const viewBtn: CSSProperties = {
  padding: "0.35rem 0.75rem",
  background: "#f1f5f9",
  border: "1px solid #cbd5e1",
  borderRadius: "4px",
  cursor: "pointer",
  fontSize: "0.8rem",
};
const modalBackdrop: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
