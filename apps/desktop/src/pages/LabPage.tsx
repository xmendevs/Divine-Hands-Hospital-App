import { useState } from "react";

export type LabStatus = "REQUESTED" | "SAMPLE_COLLECTED" | "IN_ANALYSIS" | "VERIFIED";

export interface LabParameter {
  id: string;
  paramName: string;
  value: string;
  unit: string;
  refRange: string;
  isAbnormal?: boolean;
}

export interface LabOrder {
  id: string;
  patientId: string;
  patientName: string;
  gender: "M" | "F";
  age: number;
  doctorName: string;
  testCategory: string;
  testName: string;
  sampleType: string;
  specimenBarcode: string;
  status: LabStatus;
  urgency: "ROUTINE" | "URGENT" | "STAT";
  createdAt: string;
  collectedAt?: string;
  analyzedAt?: string;
  verifiedBy?: string;
  parameters: LabParameter[];
  clinicalNotes?: string;
}

export default function LabPage() {
  const [activeTab, setActiveTab] = useState<"queue" | "entry" | "audit">("queue");
  const [filterUrgency, setFilterUrgency] = useState<string>("ALL");

  // Initial Enterprise Lab State
  const [orders, setOrders] = useState<LabOrder[]>([
    {
      id: "LAB-2026-0891",
      patientId: "DHHA0001",
      patientName: "Blessing Okon",
      gender: "F",
      age: 29,
      doctorName: "Dr. Amina",
      testCategory: "Haematology",
      testName: "Full Blood Count (FBC)",
      sampleType: "Whole Blood (EDTA - Purple Top)",
      specimenBarcode: "SMP-99201-B",
      status: "REQUESTED",
      urgency: "URGENT",
      createdAt: "2026-08-15 08:15",
      parameters: [
        { id: "p1", paramName: "Haemoglobin (Hb)", value: "", unit: "g/dL", refRange: "12.0 - 15.5" },
        { id: "p2", paramName: "White Blood Cells (WBC)", value: "", unit: "x10^9/L", refRange: "4.5 - 11.0" },
        { id: "p3", paramName: "Platelets", value: "", unit: "x10^9/L", refRange: "150 - 450" },
      ],
      clinicalNotes: "Suspected severe malaria / anaemia.",
    },
    {
      id: "LAB-2026-0890",
      patientId: "DHH0001",
      patientName: "Emmanuel Adebayo",
      gender: "M",
      age: 42,
      doctorName: "Dr. A. Okonkwo",
      testCategory: "Chemical Pathology",
      testName: "Fasting Blood Sugar (FBS)",
      sampleType: "Fluoride Plasma (Grey Top)",
      specimenBarcode: "SMP-99188-A",
      status: "IN_ANALYSIS",
      urgency: "ROUTINE",
      createdAt: "2026-08-15 07:45",
      collectedAt: "2026-08-15 08:00",
      parameters: [
        { id: "p4", paramName: "Fasting Glucose", value: "7.8", unit: "mmol/L", refRange: "3.9 - 5.6", isAbnormal: true },
      ],
      clinicalNotes: "Routine diabetes screening.",
    },
    {
      id: "LAB-2026-0885",
      patientId: "DHH0005",
      patientName: "Chidi Nnamdi",
      gender: "M",
      age: 35,
      doctorName: "Dr. A. Okonkwo",
      testCategory: "Microbiology",
      testName: "Urinalysis & Microscopy",
      sampleType: "Mid-Stream Urine",
      specimenBarcode: "SMP-99100-U",
      status: "VERIFIED",
      urgency: "STAT",
      createdAt: "2026-08-14 14:20",
      collectedAt: "2026-08-14 14:35",
      analyzedAt: "2026-08-14 15:10",
      verifiedBy: "Dr. K. Balogun (Consultant Pathologist)",
      parameters: [
        { id: "p5", paramName: "Protein", value: "Trace", unit: "-", refRange: "Negative" },
        { id: "p6", paramName: "Pus Cells", value: "8-10", unit: "/hpf", refRange: "0 - 5", isAbnormal: true },
      ],
      clinicalNotes: "Dysuria and dyspnea.",
    },
  ]);

  const [activeOrderId, setActiveOrderId] = useState<string>("LAB-2026-0890");

  const selectedOrder = orders.find((o) => o.id === activeOrderId);

  // Workflow Handlers
  const handleCollectSample = (id: string) => {
    const timeNow = new Date().toISOString().replace("T", " ").substring(0, 16);
    setOrders(
      orders.map((o) =>
        o.id === id ? { ...o, status: "SAMPLE_COLLECTED", collectedAt: timeNow } : o
      )
    );
  };

  const handleStartAnalysis = (id: string) => {
    setOrders(orders.map((o) => (o.id === id ? { ...o, status: "IN_ANALYSIS" } : o)));
    setActiveOrderId(id);
    setActiveTab("entry");
  };

  const handleUpdateParamValue = (paramId: string, val: string, isAbnormal: boolean) => {
    if (!selectedOrder) return;
    const updatedParams = selectedOrder.parameters.map((p) =>
      p.id === paramId ? { ...p, value: val, isAbnormal } : p
    );
    setOrders(orders.map((o) => (o.id === selectedOrder.id ? { ...o, parameters: updatedParams } : o)));
  };

  const handlePublishResults = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder) return;
    const timeNow = new Date().toISOString().replace("T", " ").substring(0, 16);

    setOrders(
      orders.map((o) =>
        o.id === selectedOrder.id
          ? {
              ...o,
              status: "VERIFIED",
              analyzedAt: timeNow,
              verifiedBy: "Dr. K. Balogun (Lab Director)",
            }
          : o
      )
    );
    alert(`Diagnostic Report ${selectedOrder.id} successfully verified, signed, and published to patient EMR!`);
    setActiveTab("queue");
  };

  const filteredOrders = orders.filter(
    (o) => filterUrgency === "ALL" || o.urgency === filterUrgency
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Top Controls & KPI Bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
        <div style={{ background: "#fff", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700 }}>PENDING SAMPLES</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#d97706" }}>
            {orders.filter((o) => o.status === "REQUESTED").length}
          </div>
        </div>
        <div style={{ background: "#fff", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700 }}>IN ANALYSIS</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#2563eb" }}>
            {orders.filter((o) => o.status === "IN_ANALYSIS").length}
          </div>
        </div>
        <div style={{ background: "#fff", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700 }}>CRITICAL / STAT</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#dc2626" }}>
            {orders.filter((o) => o.urgency === "STAT" || o.urgency === "URGENT").length}
          </div>
        </div>
        <div style={{ background: "#fff", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700 }}>VERIFIED TODAY</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#16a34a" }}>
            {orders.filter((o) => o.status === "VERIFIED").length}
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "2px solid #e2e8f0", paddingBottom: "0.5rem" }}>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button
            onClick={() => setActiveTab("queue")}
            style={{
              padding: "0.5rem 1.2rem",
              border: "none",
              background: activeTab === "queue" ? "#0284c7" : "transparent",
              color: activeTab === "queue" ? "#fff" : "#64748b",
              borderRadius: "6px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Laboratory Work Queue
          </button>
          <button
            onClick={() => setActiveTab("entry")}
            style={{
              padding: "0.5rem 1.2rem",
              border: "none",
              background: activeTab === "entry" ? "#0284c7" : "transparent",
              color: activeTab === "entry" ? "#fff" : "#64748b",
              borderRadius: "6px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Diagnostic Result Entry & Signoff
          </button>
        </div>

        {activeTab === "queue" && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
            <span style={{ color: "#64748b", fontWeight: 600 }}>Urgency Filter:</span>
            <select
              value={filterUrgency}
              onChange={(e) => setFilterUrgency(e.target.value)}
              style={{ padding: "0.3rem 0.6rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}
            >
              <option value="ALL">All Priorities</option>
              <option value="STAT">STAT (Critical Emergency)</option>
              <option value="URGENT">Urgent</option>
              <option value="ROUTINE">Routine</option>
            </select>
          </div>
        )}
      </div>

      {/* Tab 1: Work Queue Table */}
      {activeTab === "queue" && (
        <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                <th style={{ padding: "0.75rem 1rem" }}>ORDER ID / BARCODE</th>
                <th style={{ padding: "0.75rem 1rem" }}>PATIENT</th>
                <th style={{ padding: "0.75rem 1rem" }}>TEST NAME & CATEGORY</th>
                <th style={{ padding: "0.75rem 1rem" }}>SPECIMEN</th>
                <th style={{ padding: "0.75rem 1rem" }}>PRIORITY</th>
                <th style={{ padding: "0.75rem 1rem" }}>STATUS</th>
                <th style={{ padding: "0.75rem 1rem" }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((ord) => (
                <tr key={ord.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "0.85rem 1rem" }}>
                    <div style={{ fontWeight: 700, color: "#0369a1" }}>{ord.id}</div>
                    <div style={{ fontSize: "0.75rem", fontFamily: "monospace", color: "#64748b" }}>{ord.specimenBarcode}</div>
                  </td>
                  <td style={{ padding: "0.85rem 1rem" }}>
                    <div style={{ fontWeight: 600, color: "#0f172a" }}>{ord.patientName}</div>
                    <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{ord.patientId} • {ord.gender}/{ord.age}Y</div>
                  </td>
                  <td style={{ padding: "0.85rem 1rem" }}>
                    <div style={{ fontWeight: 600, color: "#334155" }}>{ord.testName}</div>
                    <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{ord.testCategory}</div>
                  </td>
                  <td style={{ padding: "0.85rem 1rem", color: "#475569", fontSize: "0.8rem" }}>
                    {ord.sampleType}
                  </td>
                  <td style={{ padding: "0.85rem 1rem" }}>
                    <span
                      style={{
                        padding: "0.2rem 0.5rem",
                        borderRadius: "4px",
                        fontSize: "0.7rem",
                        fontWeight: 700,
                        background: ord.urgency === "STAT" ? "#fef2f2" : ord.urgency === "URGENT" ? "#fffbebe" : "#f1f5f9",
                        color: ord.urgency === "STAT" ? "#dc2626" : ord.urgency === "URGENT" ? "#d97706" : "#475569",
                        border: ord.urgency === "STAT" ? "1px solid #fca5a5" : "none"
                      }}
                    >
                      {ord.urgency}
                    </span>
                  </td>
                  <td style={{ padding: "0.85rem 1rem" }}>
                    <span
                      style={{
                        padding: "0.25rem 0.5rem",
                        borderRadius: "4px",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        background:
                          ord.status === "VERIFIED" ? "#f0fdf4" :
                          ord.status === "IN_ANALYSIS" ? "#eff6ff" :
                          ord.status === "SAMPLE_COLLECTED" ? "#fefce8" : "#f1f5f9",
                        color:
                          ord.status === "VERIFIED" ? "#16a34a" :
                          ord.status === "IN_ANALYSIS" ? "#2563eb" :
                          ord.status === "SAMPLE_COLLECTED" ? "#ca8a04" : "#475569",
                      }}
                    >
                      {ord.status.replace("_", " ")}
                    </span>
                  </td>
                  <td style={{ padding: "0.85rem 1rem" }}>
                    {ord.status === "REQUESTED" && (
                      <button
                        onClick={() => handleCollectSample(ord.id)}
                        style={{ padding: "0.35rem 0.75rem", background: "#0284c7", color: "#fff", border: "none", borderRadius: "4px", fontWeight: 600, cursor: "pointer", fontSize: "0.75rem" }}
                      >
                        Collect Sample
                      </button>
                    )}
                    {ord.status === "SAMPLE_COLLECTED" && (
                      <button
                        onClick={() => handleStartAnalysis(ord.id)}
                        style={{ padding: "0.35rem 0.75rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: "4px", fontWeight: 600, cursor: "pointer", fontSize: "0.75rem" }}
                      >
                        Begin Analysis
                      </button>
                    )}
                    {ord.status === "IN_ANALYSIS" && (
                      <button
                        onClick={() => {
                          setActiveOrderId(ord.id);
                          setActiveTab("entry");
                        }}
                        style={{ padding: "0.35rem 0.75rem", background: "#d97706", color: "#fff", border: "none", borderRadius: "4px", fontWeight: 600, cursor: "pointer", fontSize: "0.75rem" }}
                      >
                        Enter Results
                      </button>
                    )}
                    {ord.status === "VERIFIED" && (
                      <button
                        onClick={() => {
                          setActiveOrderId(ord.id);
                          setActiveTab("entry");
                        }}
                        style={{ padding: "0.35rem 0.75rem", background: "#16a34a", color: "#fff", border: "none", borderRadius: "4px", fontWeight: 600, cursor: "pointer", fontSize: "0.75rem" }}
                      >
                        View Report
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 2: Enterprise Result Entry & Verification Sheet */}
      {activeTab === "entry" && selectedOrder && (
        <form onSubmit={handlePublishResults} style={{ background: "#fff", padding: "1.5rem", borderRadius: "8px", border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          
          {/* Header Metadata Block */}
          <div style={{ display: "flex", justifyContent: "space-between", background: "#f8fafc", padding: "1rem", borderRadius: "6px", border: "1px solid #cbd5e1" }}>
            <div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#0f172a" }}>{selectedOrder.testName}</div>
              <div style={{ fontSize: "0.8rem", color: "#64748b" }}>Category: <strong>{selectedOrder.testCategory}</strong> | Order ID: <strong>{selectedOrder.id}</strong></div>
              <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: "0.2rem" }}>Specimen: <strong>{selectedOrder.sampleType}</strong> ({selectedOrder.specimenBarcode})</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "#334155" }}>Patient: {selectedOrder.patientName}</div>
              <div style={{ fontSize: "0.8rem", color: "#64748b" }}>MRN: {selectedOrder.patientId} | Doctor: {selectedOrder.doctorName}</div>
              <div style={{ marginTop: "0.4rem" }}>
                <span style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", borderRadius: "4px", background: "#e2e8f0", color: "#334155", fontWeight: 700 }}>
                  STATUS: {selectedOrder.status}
                </span>
              </div>
            </div>
          </div>

          {/* Clinical Context Note */}
          {selectedOrder.clinicalNotes && (
            <div style={{ background: "#eff6ff", borderLeft: "4px solid #3b82f6", padding: "0.75rem 1rem", borderRadius: "0 6px 6px 0", fontSize: "0.85rem", color: "#1e40af" }}>
              <strong>Ordering Clinical Note:</strong> {selectedOrder.clinicalNotes}
            </div>
          )}

          {/* Structured Parameter Matrix */}
          <div>
            <h4 style={{ margin: "0 0 0.75rem 0", color: "#1e293b" }}>Test Parameter Findings</h4>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ background: "#f1f5f9", borderBottom: "1px solid #cbd5e1", color: "#475569" }}>
                  <th style={{ padding: "0.6rem 0.8rem" }}>PARAMETER</th>
                  <th style={{ padding: "0.6rem 0.8rem" }}>OBSERVED VALUE</th>
                  <th style={{ padding: "0.6rem 0.8rem" }}>UNIT</th>
                  <th style={{ padding: "0.6rem 0.8rem" }}>REFERENCE RANGE</th>
                  <th style={{ padding: "0.6rem 0.8rem" }}>ABNORMAL FLAG</th>
                </tr>
              </thead>
              <tbody>
                {selectedOrder.parameters.map((p) => (
                  <tr key={p.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "0.6rem 0.8rem", fontWeight: 600, color: "#334155" }}>{p.paramName}</td>
                    <td style={{ padding: "0.6rem 0.8rem" }}>
                      {selectedOrder.status === "VERIFIED" ? (
                        <span style={{ fontWeight: 700, color: p.isAbnormal ? "#dc2626" : "#0f172a" }}>{p.value}</span>
                      ) : (
                        <input
                          type="text"
                          value={p.value}
                          onChange={(e) => handleUpdateParamValue(p.id, e.target.value, p.isAbnormal || false)}
                          placeholder="Enter metric"
                          style={{
                            padding: "0.4rem",
                            borderRadius: "4px",
                            border: "1px solid #cbd5e1",
                            fontWeight: 600,
                            color: p.isAbnormal ? "#dc2626" : "#0f172a",
                          }}
                        />
                      )}
                    </td>
                    <td style={{ padding: "0.6rem 0.8rem", color: "#64748b" }}>{p.unit}</td>
                    <td style={{ padding: "0.6rem 0.8rem", color: "#64748b", fontFamily: "monospace" }}>{p.refRange}</td>
                    <td style={{ padding: "0.6rem 0.8rem" }}>
                      {selectedOrder.status === "VERIFIED" ? (
                        p.isAbnormal && <span style={{ background: "#fef2f2", color: "#dc2626", padding: "0.2rem 0.5rem", borderRadius: "4px", fontWeight: 700, fontSize: "0.75rem" }}>ABNORMAL / HIGH</span>
                      ) : (
                        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", fontSize: "0.8rem", color: "#dc2626", fontWeight: 600 }}>
                          <input
                            type="checkbox"
                            checked={p.isAbnormal || false}
                            onChange={(e) => handleUpdateParamValue(p.id, p.value, e.target.checked)}
                          />
                          Flag Abnormal
                        </label>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Dual Signoff Footer */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #e2e8f0", paddingTop: "1rem" }}>
            <div style={{ fontSize: "0.8rem", color: "#64748b" }}>
              {selectedOrder.verifiedBy ? (
                <div>Signed & Verified By: <strong style={{ color: "#16a34a" }}>{selectedOrder.verifiedBy}</strong> on {selectedOrder.analyzedAt}</div>
              ) : (
                <div>Awaiting Consultant Pathologist Signoff</div>
              )}
            </div>

            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button
                type="button"
                onClick={() => setActiveTab("queue")}
                style={{ padding: "0.6rem 1.2rem", background: "transparent", border: "1px solid #cbd5e1", color: "#64748b", borderRadius: "6px", fontWeight: 600, cursor: "pointer" }}
              >
                Back to Queue
              </button>
              {selectedOrder.status !== "VERIFIED" && (
                <button
                  type="submit"
                  style={{ padding: "0.6rem 1.5rem", background: "#16a34a", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 700, cursor: "pointer" }}
                >
                  Verify, Sign & Publish to EMR
                </button>
              )}
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
