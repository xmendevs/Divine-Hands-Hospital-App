import React, { useState } from "react";

export default function HandoverPage() {
  const [handovers, setHandovers] = useState([
    {
      id: 1,
      shift: "Morning Shift (07:00 - 15:00)",
      outgoingOfficer: "Dr. Adebayo (ICU)",
      incomingOfficer: "Dr. Chioma (Evening)",
      date: "2026-08-15",
      criticalNotes: "Patient in Bed 4 stabilized post-resuscitation. Ventilator check completed at 13:00.",
      pendingTasks: "Awaiting lab results for Patient in Bed 2 (Electrolytes panel).",
      status: "Completed"
    },
    {
      id: 2,
      shift: "Night Shift (23:00 - 07:00)",
      outgoingOfficer: "Nurse Tunde",
      incomingOfficer: "Nurse Chinyere",
      date: "2026-08-15",
      criticalNotes: "Admitted 2 emergency trauma cases from expressway accident. Transferred to Ward A.",
      pendingTasks: "Pharmacy restock needed for intravenous antibiotics (Ceftriaxone).",
      status: "Acknowledged"
    }
  ]);

  const [newShift, setNewShift] = useState("Morning Shift (07:00 - 15:00)");
  const [outgoing, setOutgoing] = useState("");
  const [incoming, setIncoming] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!outgoing || !incoming || !notes) return;

    const entry = {
      id: Date.now(),
      shift: newShift,
      outgoingOfficer: outgoing,
      incomingOfficer: incoming,
      date: new Date().toISOString().split("T")[0],
      criticalNotes: notes,
      pendingTasks: pending || "None",
      status: "Submitted"
    };

    setHandovers([entry, ...handovers]);
    setOutgoing("");
    setIncoming("");
    setNotes("");
    setPending("");
  };

  return (
    <div style={{ padding: "2rem", maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0f172a", margin: 0 }}>✍️ Shift Handover Log</h2>
          <p style={{ color: "#64748b", margin: "0.2rem 0 0 0" }}>Manage clinical and administrative shift transitions securely across hospital units.</p>
        </div>
        <span style={{ fontSize: "0.75rem", background: "#e0f2fe", color: "#0369a1", padding: "0.3rem 0.75rem", borderRadius: "20px", fontWeight: 700 }}>
          Active Shift Portal
        </span>
      </div>

      {/* New Handover Form */}
      <div style={{ background: "#fff", padding: "1.5rem", borderRadius: "10px", border: "1px solid #e2e8f0", marginBottom: "2rem", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
        <h3 style={{ fontSize: "1.05rem", fontWeight: 700, color: "#1e293b", marginBottom: "1rem" }}>Submit New Shift Handover</h3>
        <form onSubmit={handleSubmit} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "0.3rem" }}>Shift Period</label>
            <select value={newShift} onChange={(e) => setNewShift(e.target.value)} style={{ width: "100%", padding: "0.6rem", borderRadius: "6px", border: "1px solid #cbd5e1" }}>
              <option>Morning Shift (07:00 - 15:00)</option>
              <option>Evening Shift (15:00 - 23:00)</option>
              <option>Night Shift (23:00 - 07:00)</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "0.3rem" }}>Date</label>
            <input type="text" disabled value={new Date().toISOString().split("T")[0]} style={{ width: "100%", padding: "0.6rem", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#f1f5f9" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "0.3rem" }}>Outgoing Officer</label>
            <input type="text" placeholder="e.g., Dr. Adebayo" value={outgoing} onChange={(e) => setOutgoing(e.target.value)} style={{ width: "100%", padding: "0.6rem", borderRadius: "6px", border: "1px solid #cbd5e1" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "0.3rem" }}>Incoming Officer</label>
            <input type="text" placeholder="e.g., Dr. Chioma" value={incoming} onChange={(e) => setIncoming(e.target.value)} style={{ width: "100%", padding: "0.6rem", borderRadius: "6px", border: "1px solid #cbd5e1" }} />
          </div>
          <div style={{ gridColumn: "span 2" }}>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "0.3rem" }}>Critical Patient Notes & Updates</label>
            <textarea rows={2} placeholder="Summarize patient conditions, critical care steps taken..." value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: "100%", padding: "0.6rem", borderRadius: "6px", border: "1px solid #cbd5e1" }} />
          </div>
          <div style={{ gridColumn: "span 2" }}>
            <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "0.3rem" }}>Pending Tasks & Follow-ups</label>
            <input type="text" placeholder="e.g., Pending lab reports, equipment maintenance checks" value={pending} onChange={(e) => setPending(e.target.value)} style={{ width: "100%", padding: "0.6rem", borderRadius: "6px", border: "1px solid #cbd5e1" }} />
          </div>
          <div style={{ gridColumn: "span 2", display: "flex", justifyContent: "flex-end" }}>
            <button type="submit" style={{ padding: "0.65rem 1.5rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 700, cursor: "pointer" }}>
              Save & Sign Handover
            </button>
          </div>
        </form>
      </div>

      {/* Handover Logs List */}
      <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#1e293b", marginBottom: "1rem" }}>Recorded Shift Handovers</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {handovers.map((h) => (
          <div key={h.id} style={{ background: "#fff", borderRadius: "10px", border: "1px solid #e2e8f0", padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", borderBottom: "1px solid #f1f5f9", paddingBottom: "0.5rem" }}>
              <div>
                <span style={{ fontWeight: 800, color: "#0f172a", fontSize: "0.95rem" }}>{h.shift}</span>
                <span style={{ marginLeft: "1rem", fontSize: "0.8rem", color: "#64748b" }}>Date: {h.date}</span>
              </div>
              <span style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem", borderRadius: "4px", background: h.status === "Completed" ? "#dcfce7" : "#fef9c3", color: h.status === "Completed" ? "#166534" : "#854d0e", fontWeight: 700 }}>
                {h.status}
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
              <div><strong>Outgoing:</strong> {h.outgoingOfficer}</div>
              <div><strong>Incoming:</strong> {h.incomingOfficer}</div>
            </div>

            <div style={{ background: "#f8fafc", padding: "0.75rem", borderRadius: "6px", fontSize: "0.85rem", marginBottom: "0.5rem" }}>
              <strong>Critical Notes:</strong> {h.criticalNotes}
            </div>

            <div style={{ background: "#fef2f2", padding: "0.75rem", borderRadius: "6px", fontSize: "0.85rem", color: "#991b1b" }}>
              <strong>Pending Tasks:</strong> {h.pendingTasks}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
