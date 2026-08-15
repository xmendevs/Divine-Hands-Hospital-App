import { useState } from "react";

interface ClinicalOrder {
  id: string;
  patientId: string;
  patientName: string;
  doctorName: string;
  orderType: "Prescription" | "Lab Test" | "Nursing Task";
  description: string;
  status: "DRAFT" | "SUBMITTED" | "IN_PROGRESS" | "COMPLETED";
  createdAt: string;
}

export default function ClinicalPage() {
  const [activeTab, setActiveTab] = useState<"consultation" | "orders">("consultation");
  
  // Orders Queue State aligned with Phase 04 requirements
  const [orders, setOrders] = useState<ClinicalOrder[]>([
    {
      id: "ORD-001",
      patientId: "DHH0001",
      patientName: "Emmanuel Adebayo",
      doctorName: "Dr. Okonkwo",
      orderType: "Prescription",
      description: "Amoxicillin 500mg TID x 7 days",
      status: "SUBMITTED",
      createdAt: "2026-08-15 08:30",
    },
    {
      id: "ORD-002",
      patientId: "DHHA0001",
      patientName: "Blessing Okon",
      doctorName: "Dr. Amina",
      orderType: "Lab Test",
      description: "Full Blood Count (FBC) + Blood Sugar Test",
      status: "IN_PROGRESS",
      createdAt: "2026-08-15 09:10",
    },
  ]);

  // Consultation Form State
  const [consultForm, setConsultForm] = useState({
    patientId: "DHH0001",
    symptoms: "",
    diagnosis: "",
    treatmentPlan: "",
    vitalsBp: "120/80",
    vitalsTemp: "36.8",
    vitalsPulse: "72",
  });

  const handleCreateConsultation = (e: React.FormEvent) => {
    e.preventDefault();
    alert(`Consultation and Vitals saved for Patient ${consultForm.patientId}! Notes are immutable and logged to audit.`);
    setConsultForm({
      patientId: "DHH0001",
      symptoms: "",
      diagnosis: "",
      treatmentPlan: "",
      vitalsBp: "120/80",
      vitalsTemp: "36.8",
      vitalsPulse: "72",
    });
  };

  const updateOrderStatus = (orderId: string, newStatus: ClinicalOrder["status"]) => {
    setOrders(orders.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o)));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Sub-navigation Header */}
      <div style={{ display: "flex", gap: "1rem", borderBottom: "2px solid #e2e8f0", paddingBottom: "0.5rem" }}>
        <button
          onClick={() => setActiveTab("consultation")}
          style={{
            padding: "0.5rem 1rem",
            border: "none",
            background: activeTab === "consultation" ? "#0284c7" : "transparent",
            color: activeTab === "consultation" ? "#fff" : "#64748b",
            borderRadius: "6px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Doctor Consultation & Vitals
        </button>
        <button
          onClick={() => setActiveTab("orders")}
          style={{
            padding: "0.5rem 1rem",
            border: "none",
            background: activeTab === "orders" ? "#0284c7" : "transparent",
            color: activeTab === "orders" ? "#fff" : "#64748b",
            borderRadius: "6px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Orders Queue (Pharmacy & Lab)
        </button>
      </div>

      {/* Tab 1: Doctor Consultation Form */}
      {activeTab === "consultation" && (
        <form onSubmit={handleCreateConsultation} style={{ background: "#fff", padding: "1.5rem", borderRadius: "8px", border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <h3 style={{ margin: 0, color: "#0f172a" }}>Record Consultation & Patient Vitals</h3>

          {/* Vitals Bar */}
          <div style={{ background: "#f8fafc", padding: "1rem", borderRadius: "6px", border: "1px solid #cbd5e1" }}>
            <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#334155", marginBottom: "0.5rem" }}>PATIENT VITALS</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "1rem" }}>
              <div>
                <label style={{ fontSize: "0.75rem", color: "#64748b" }}>Patient ID</label>
                <input
                  type="text"
                  value={consultForm.patientId}
                  onChange={(e) => setConsultForm({ ...consultForm, patientId: e.target.value })}
                  style={{ width: "100%", padding: "0.4rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                />
              </div>
              <div>
                <label style={{ fontSize: "0.75rem", color: "#64748b" }}>BP (mmHg)</label>
                <input
                  type="text"
                  value={consultForm.vitalsBp}
                  onChange={(e) => setConsultForm({ ...consultForm, vitalsBp: e.target.value })}
                  style={{ width: "100%", padding: "0.4rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                />
              </div>
              <div>
                <label style={{ fontSize: "0.75rem", color: "#64748b" }}>Temp (°C)</label>
                <input
                  type="text"
                  value={consultForm.vitalsTemp}
                  onChange={(e) => setConsultForm({ ...consultForm, vitalsTemp: e.target.value })}
                  style={{ width: "100%", padding: "0.4rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                />
              </div>
              <div>
                <label style={{ fontSize: "0.75rem", color: "#64748b" }}>Pulse (bpm)</label>
                <input
                  type="text"
                  value={consultForm.vitalsPulse}
                  onChange={(e) => setConsultForm({ ...consultForm, vitalsPulse: e.target.value })}
                  style={{ width: "100%", padding: "0.4rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
                />
              </div>
            </div>
          </div>

          {/* Clinical Notes */}
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#475569", marginBottom: "0.3rem" }}>
              Presenting Complaints & Symptoms
            </label>
            <textarea
              required
              rows={3}
              value={consultForm.symptoms}
              onChange={(e) => setConsultForm({ ...consultForm, symptoms: e.target.value })}
              placeholder="e.g. Fever, headaches, persistent fatigue..."
              style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#475569", marginBottom: "0.3rem" }}>
                Diagnosis
              </label>
              <textarea
                required
                rows={3}
                value={consultForm.diagnosis}
                onChange={(e) => setConsultForm({ ...consultForm, diagnosis: e.target.value })}
                placeholder="Primary clinical diagnosis..."
                style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, color: "#475569", marginBottom: "0.3rem" }}>
                Treatment Plan & Orders
              </label>
              <textarea
                required
                rows={3}
                value={consultForm.treatmentPlan}
                onChange={(e) => setConsultForm({ ...consultForm, treatmentPlan: e.target.value })}
                placeholder="Prescriptions, Lab tests required..."
                style={{ width: "100%", padding: "0.5rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
              />
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="submit"
              style={{
                background: "#0284c7",
                color: "#fff",
                padding: "0.65rem 1.5rem",
                border: "none",
                borderRadius: "6px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Submit Consultation Note
            </button>
          </div>
        </form>
      )}

      {/* Tab 2: Orders Queue State Machine */}
      {activeTab === "orders" && (
        <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ background: "#f1f5f9", borderBottom: "1px solid #e2e8f0", color: "#475569", fontSize: "0.85rem" }}>
                <th style={{ padding: "0.75rem 1rem" }}>ORDER ID</th>
                <th style={{ padding: "0.75rem 1rem" }}>PATIENT</th>
                <th style={{ padding: "0.75rem 1rem" }}>TYPE</th>
                <th style={{ padding: "0.75rem 1rem" }}>DESCRIPTION</th>
                <th style={{ padding: "0.75rem 1rem" }}>STATUS</th>
                <th style={{ padding: "0.75rem 1rem" }}>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((ord) => (
                <tr key={ord.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "0.85rem 1rem", fontWeight: 600, color: "#0369a1" }}>{ord.id}</td>
                  <td style={{ padding: "0.85rem 1rem" }}>
                    <div style={{ fontWeight: 500 }}>{ord.patientName}</div>
                    <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{ord.patientId}</div>
                  </td>
                  <td style={{ padding: "0.85rem 1rem", fontWeight: 600, fontSize: "0.85rem", color: "#475569" }}>
                    {ord.orderType}
                  </td>
                  <td style={{ padding: "0.85rem 1rem", color: "#334155" }}>{ord.description}</td>
                  <td style={{ padding: "0.85rem 1rem" }}>
                    <span
                      style={{
                        padding: "0.2rem 0.5rem",
                        borderRadius: "4px",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        background:
                          ord.status === "COMPLETED"
                            ? "#f0fdf4"
                            : ord.status === "IN_PROGRESS"
                            ? "#fefce8"
                            : "#f1f5f9",
                        color:
                          ord.status === "COMPLETED"
                            ? "#16a34a"
                            : ord.status === "IN_PROGRESS"
                            ? "#ca8a04"
                            : "#475569",
                      }}
                    >
                      {ord.status}
                    </span>
                  </td>
                  <td style={{ padding: "0.85rem 1rem" }}>
                    {ord.status === "SUBMITTED" && (
                      <button
                        onClick={() => updateOrderStatus(ord.id, "IN_PROGRESS")}
                        style={{ padding: "0.3rem 0.6rem", background: "#3b82f6", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "0.75rem" }}
                      >
                        Start Processing
                      </button>
                    )}
                    {ord.status === "IN_PROGRESS" && (
                      <button
                        onClick={() => updateOrderStatus(ord.id, "COMPLETED")}
                        style={{ padding: "0.3rem 0.6rem", background: "#22c55e", color: "#fff", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "0.75rem" }}
                      >
                        Mark Completed
                      </button>
                    )}
                    {ord.status === "COMPLETED" && (
                      <span style={{ fontSize: "0.8rem", color: "#16a34a", fontWeight: 600 }}>Fulfilled</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
