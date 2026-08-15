import React, { useState } from "react";

export default function CommunicationsPage() {
  const [messages, setMessages] = useState([
    { id: 1, sender: "Dr. Adebayo", role: "Chief Medical Director", time: "10:15 AM", text: "Please ensure all morning rounds are logged before the 12 PM handover." },
    { id: 2, sender: "Nurse Chinyere", role: "Head Nurse, Ward B", time: "10:32 AM", text: "Ward B is fully restocked with emergency IV fluids." }
  ]);
  const [newMsg, setNewMsg] = useState("");

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMsg.trim()) return;
    setMessages([...messages, { id: Date.now(), sender: "Super Admin", role: "Management", time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), text: newMsg }]);
    setNewMsg("");
  };

  return (
    <div style={{ padding: "2rem", maxWidth: "1000px", margin: "0 auto" }}>
      <h2 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0f172a", marginBottom: "0.5rem" }}>📢 Staff Communications & Broadcasts</h2>
      <p style={{ color: "#64748b", marginBottom: "1.5rem" }}>Secure internal messaging channel for hospital staff and departmental announcements.</p>

      <div style={{ background: "#fff", borderRadius: "10px", border: "1px solid #e2e8f0", padding: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
        <div style={{ height: "350px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1rem", paddingRight: "0.5rem" }}>
          {messages.map((m) => (
            <div key={m.id} style={{ background: "#f8fafc", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.3rem" }}>
                <span style={{ fontWeight: 700, color: "#1e293b", fontSize: "0.9rem" }}>{m.sender} <span style={{ fontWeight: 400, color: "#64748b", fontSize: "0.8rem" }}>({m.role})</span></span>
                <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>{m.time}</span>
              </div>
              <div style={{ color: "#334155", fontSize: "0.9rem" }}>{m.text}</div>
            </div>
          ))}
        </div>

        <form onSubmit={handleSend} style={{ display: "flex", gap: "0.75rem" }}>
          <input
            type="text"
            placeholder="Type a broadcast message to all departments..."
            value={newMsg}
            onChange={(e) => setNewMsg(e.target.value)}
            style={{ flex: 1, padding: "0.75rem", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "0.9rem" }}
          />
          <button type="submit" style={{ padding: "0.75rem 1.5rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 700, cursor: "pointer" }}>
            Broadcast
          </button>
        </form>
      </div>
    </div>
  );
}
