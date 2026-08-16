import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { apiFetch } from "../api/client";

interface LabTest {
  id: string;
  code: string;
  name: string;
  category: string;
  price: number;
  specimenType: string;
}

interface LabItem {
  id: string;
  testId: string;
  testCode: string;
  testName: string;
  specimenType: string;
  critical: boolean;
  resultText: string;
  resultVerifiedAt?: string;
}

interface LabRequest {
  id: string;
  requestNo: string;
  patientId?: string;
  patientNo?: string;
  patientName?: string;
  clientName?: string;
  orderedByName: string;
  priority: string;
  clinicalNotes: string;
  paymentStatus: string;
  status: string;
  requestedAt: string;
  releasedAt?: string;
  items: LabItem[];
}

interface LabCritical {
  id: string;
  requestId: string;
  notifiedToName: string;
  status: string;
  notifiedAt: string;
  acknowledgedAt?: string;
}

interface PatientSummary {
  id: string;
  patientNo: string;
  firstName: string;
  lastName: string;
  gender: string;
}

const PRIORITIES = ["routine", "urgent", "stat"];

export default function LabPage() {
  const [activeTab, setActiveTab] = useState<"queue" | "entry">("queue");
  const [filterStatus, setFilterStatus] = useState("ALL");

  const [requests, setRequests] = useState<LabRequest[]>([]);
  const [tests, setTests] = useState<LabTest[]>([]);
  const [critical, setCritical] = useState<LabCritical[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Result entry state.
  const [activeRequest, setActiveRequest] = useState<LabRequest | null>(null);
  const [resultValues, setResultValues] = useState<Record<string, string>>({});
  const [criticalFlags, setCriticalFlags] = useState<Record<string, boolean>>({});
  const [savingResults, setSavingResults] = useState(false);

  // New request form.
  const [patientSearch, setPatientSearch] = useState("");
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientSummary | null>(null);
  const [selectedTests, setSelectedTests] = useState<string[]>([]);
  const [priority, setPriority] = useState("routine");
  const [clinicalNotes, setClinicalNotes] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [reqRes, testsRes, critRes] = await Promise.allSettled([
      apiFetch<LabRequest[]>("/lab/requests"),
      apiFetch<LabTest[]>("/lab/tests"),
      apiFetch<LabCritical[]>("/lab/critical"),
    ]);
    const errors: string[] = [];
    if (reqRes.status === "fulfilled") {
      setRequests(reqRes.value);
    } else {
      errors.push(reqRes.reason instanceof Error ? reqRes.reason.message : "Could not load lab requests.");
    }
    if (testsRes.status === "fulfilled") {
      setTests(testsRes.value);
    } else {
      errors.push(testsRes.reason instanceof Error ? testsRes.reason.message : "Could not load the test catalogue.");
    }
    if (critRes.status === "fulfilled") {
      setCritical(critRes.value);
    } else {
      errors.push(critRes.reason instanceof Error ? critRes.reason.message : "Could not load critical notifications.");
    }
    setError(errors.join(" "));
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Debounced patient search for the new-request form.
  useEffect(() => {
    const q = patientSearch.trim();
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
  }, [patientSearch]);

  const filteredRequests = requests.filter((r) => filterStatus === "ALL" || r.status === filterStatus);

  async function apiAction(fn: () => Promise<unknown>, successMessage?: string) {
    setError("");
    try {
      await fn();
      await loadAll();
      if (successMessage) setError(successMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    }
  }

  function collectSpecimens(r: LabRequest) {
    const specimens = r.items.map((it) => ({ itemId: it.id, specimenType: it.specimenType }));
    return apiAction(() =>
      apiFetch<unknown>(`/lab/requests/${r.id}/collect`, { method: "POST", body: JSON.stringify({ specimens }) }),
    );
  }

  function beginAnalysis(r: LabRequest) {
    return apiAction(() =>
      apiFetch<unknown>(`/lab/requests/${r.id}/status`, { method: "POST", body: JSON.stringify({ status: "processing" }) }),
    );
  }

  function openEntry(r: LabRequest) {
    setActiveRequest(r);
    const values: Record<string, string> = {};
    const flags: Record<string, boolean> = {};
    for (const it of r.items) {
      values[it.id] = it.resultText ?? "";
      flags[it.id] = it.critical;
    }
    setResultValues(values);
    setCriticalFlags(flags);
    setActiveTab("entry");
  }

  async function verifyAndRelease(r: LabRequest) {
    setError("");
    try {
      for (const it of r.items) {
        await apiFetch<unknown>(`/lab/items/${it.id}/verify`, { method: "POST" });
      }
      await apiFetch<unknown>(`/lab/requests/${r.id}/release`, { method: "POST" });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed (note: you cannot verify results you entered yourself).");
    }
  }

  function releaseResults(r: LabRequest) {
    return apiAction(() => apiFetch<unknown>(`/lab/requests/${r.id}/release`, { method: "POST" }));
  }

  async function handleSaveResults(e: FormEvent) {
    e.preventDefault();
    if (!activeRequest) return;
    setSavingResults(true);
    setError("");
    try {
      const entries = activeRequest.items.map((it) => ({
        itemId: it.id,
        resultValue: resultValues[it.id] ?? "",
        resultText: resultValues[it.id] ?? "",
        critical: criticalFlags[it.id] ?? false,
      }));
      await apiFetch<unknown>(`/lab/requests/${activeRequest.id}/results`, {
        method: "POST",
        body: JSON.stringify({ entries }),
      });
      await loadAll();
      setActiveTab("queue");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save results.");
    } finally {
      setSavingResults(false);
    }
  }

  async function handleCreateRequest(e: FormEvent) {
    e.preventDefault();
    if (!selectedPatient) {
      setError("Select a patient for the lab request.");
      return;
    }
    if (selectedTests.length === 0) {
      setError("Select at least one test.");
      return;
    }
    setError("");
    try {
      await apiFetch<unknown>("/lab/requests", {
        method: "POST",
        body: JSON.stringify({
          patientId: selectedPatient.id,
          priority,
          clinicalNotes,
          testIds: selectedTests,
        }),
      });
      setSelectedPatient(null);
      setPatientSearch("");
      setSelectedTests([]);
      setClinicalNotes("");
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the lab request.");
    }
  }

  async function acknowledgeCritical(n: LabCritical) {
    await apiAction(() =>
      apiFetch<unknown>(`/lab/critical/${n.id}/acknowledge`, { method: "POST", body: JSON.stringify({ notes: "" }) }),
    );
  }

  const pendingCount = requests.filter((r) => r.status === "requested" || r.status === "payment").length;
  const inAnalysisCount = requests.filter((r) => r.status === "processing" || r.status === "specimen_collected" || r.status === "received").length;
  const statCount = requests.filter((r) => r.priority === "stat" || r.priority === "urgent").length;
  const verifiedCount = requests.filter((r) => r.status === "verified" || r.status === "released").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Top Controls & KPI Bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
        <Kpi label="PENDING SAMPLES" value={pendingCount} color="#d97706" />
        <Kpi label="IN ANALYSIS" value={inAnalysisCount} color="#2563eb" />
        <Kpi label="CRITICAL / STAT" value={statCount} color="#dc2626" />
        <Kpi label="VERIFIED / RELEASED" value={verifiedCount} color="#16a34a" />
      </div>

      {/* Navigation Tabs */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "2px solid #e2e8f0", paddingBottom: "0.5rem" }}>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button onClick={() => setActiveTab("queue")} style={tabStyle(activeTab === "queue")}>
            Laboratory Work Queue
          </button>
          <button onClick={() => setActiveTab("entry")} style={tabStyle(activeTab === "entry")}>
            Diagnostic Result Entry & Signoff
          </button>
        </div>

        {activeTab === "queue" && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}>
            <span style={{ color: "#64748b", fontWeight: 600 }}>Status Filter:</span>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ padding: "0.3rem 0.6rem", borderRadius: "4px", border: "1px solid #cbd5e1" }}>
              <option value="ALL">All Statuses</option>
              {["requested", "payment", "specimen_collected", "received", "processing", "result_entered", "verified", "released"].map((s) => (
                <option key={s} value={s}>{s.replace("_", " ").toUpperCase()}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: "0.85rem", color: "#b91c1c" }}>
          {error}
        </p>
      )}

      {/* Critical notifications strip */}
      {critical.length > 0 && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "8px", padding: "1rem" }}>
          <div style={{ fontSize: "0.75rem", color: "#991b1b", fontWeight: 700, marginBottom: "0.5rem" }}>
            CRITICAL RESULTS — {critical.filter((c) => c.status === "pending").length} UNACKNOWLEDGED
          </div>
          {critical.filter((c) => c.status === "pending").map((c) => (
            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.85rem", color: "#7f1d1d", padding: "0.25rem 0" }}>
              <span>Notified to {c.notifiedToName} on {new Date(c.notifiedAt).toLocaleString()}</span>
              <button onClick={() => acknowledgeCritical(c)} style={actionBtn("#dc2626")}>
                Acknowledge
              </button>
            </div>
          ))}
        </div>
      )}

      {loading && <p style={{ margin: 0, fontSize: "0.9rem", color: "#64748b" }}>Loading laboratory data…</p>}

      {/* Tab 1: Work Queue */}
      {!loading && activeTab === "queue" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {/* New request form */}
          <form onSubmit={handleCreateRequest} style={{ background: "#fff", padding: "1.25rem", borderRadius: "8px", border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: "1rem" }}>
            <h3 style={{ margin: 0, color: "#0f172a", fontSize: "1rem" }}>New Lab Request</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>
              <div>
                <FieldLabel>Patient</FieldLabel>
                {selectedPatient ? (
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "#0f172a" }}>
                      {selectedPatient.firstName} {selectedPatient.lastName} ({selectedPatient.patientNo})
                    </span>
                    <button type="button" onClick={() => setSelectedPatient(null)} style={ghostBtn}>×</button>
                  </div>
                ) : (
                  <input
                    type="text"
                    placeholder="Search patient..."
                    value={patientSearch}
                    onChange={(e) => setPatientSearch(e.target.value)}
                    style={input}
                  />
                )}
                {patients.length > 0 && !selectedPatient && (
                  <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "6px", marginTop: "0.25rem", overflow: "hidden" }}>
                    {patients.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setSelectedPatient(p);
                          setPatients([]);
                          setPatientSearch("");
                        }}
                        style={{ display: "block", width: "100%", textAlign: "left", padding: "0.5rem 0.75rem", border: "none", borderBottom: "1px solid #f1f5f9", background: "#fff", cursor: "pointer", fontSize: "0.85rem" }}
                      >
                        <strong style={{ color: "#0369a1" }}>{p.patientNo}</strong> — {p.firstName} {p.lastName}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <FieldLabel>Priority</FieldLabel>
                <select value={priority} onChange={(e) => setPriority(e.target.value)} style={input}>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>{p.toUpperCase()}</option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel>Clinical notes</FieldLabel>
                <input value={clinicalNotes} onChange={(e) => setClinicalNotes(e.target.value)} placeholder="e.g. Suspected malaria" style={input} />
              </div>
            </div>
            <div>
              <FieldLabel>Tests (select one or more)</FieldLabel>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {tests.map((t) => (
                  <label
                    key={t.id}
                    style={{
                      padding: "0.35rem 0.7rem",
                      borderRadius: "999px",
                      border: selectedTests.includes(t.id) ? "1px solid #0284c7" : "1px solid #cbd5e1",
                      background: selectedTests.includes(t.id) ? "#e0f2fe" : "#fff",
                      color: selectedTests.includes(t.id) ? "#0369a1" : "#475569",
                      fontWeight: 600,
                      fontSize: "0.8rem",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedTests.includes(t.id)}
                      onChange={(e) =>
                        setSelectedTests((prev) => (e.target.checked ? [...prev, t.id] : prev.filter((x) => x !== t.id)))
                      }
                      style={{ display: "none" }}
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="submit" style={primaryBtn}>Create Lab Request</button>
            </div>
          </form>

          {/* Requests table */}
          <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                  <th style={{ padding: "0.75rem 1rem" }}>REQUEST NO</th>
                  <th style={{ padding: "0.75rem 1rem" }}>PATIENT / CLIENT</th>
                  <th style={{ padding: "0.75rem 1rem" }}>TESTS</th>
                  <th style={{ padding: "0.75rem 1rem" }}>PRIORITY</th>
                  <th style={{ padding: "0.75rem 1rem" }}>STATUS</th>
                  <th style={{ padding: "0.75rem 1rem" }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {filteredRequests.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: "1.5rem", textAlign: "center", color: "#64748b" }}>
                      No lab requests match this filter.
                    </td>
                  </tr>
                )}
                {filteredRequests.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "0.85rem 1rem", fontWeight: 700, color: "#0369a1" }}>{r.requestNo}</td>
                    <td style={{ padding: "0.85rem 1rem" }}>
                      <div style={{ fontWeight: 600, color: "#0f172a" }}>{r.patientName || r.clientName || "—"}</div>
                      <div style={{ fontSize: "0.75rem", color: "#64748b" }}>Ordered by {r.orderedByName}</div>
                    </td>
                    <td style={{ padding: "0.85rem 1rem", color: "#334155" }}>
                      {r.items.map((it) => it.testName).join(", ")}
                    </td>
                    <td style={{ padding: "0.85rem 1rem" }}>
                      <PriorityBadge priority={r.priority} />
                    </td>
                    <td style={{ padding: "0.85rem 1rem" }}>
                      <StatusBadge status={r.status} />
                    </td>
                    <td style={{ padding: "0.85rem 1rem" }}>
                      {(r.status === "requested" || r.status === "payment") && (
                        <button onClick={() => collectSpecimens(r)} style={actionBtn("#0284c7")}>
                          Collect Specimens
                        </button>
                      )}
                      {(r.status === "specimen_collected" || r.status === "received") && (
                        <button onClick={() => beginAnalysis(r)} style={actionBtn("#2563eb")}>
                          Begin Analysis
                        </button>
                      )}
                      {r.status === "processing" && (
                        <button onClick={() => openEntry(r)} style={actionBtn("#d97706")}>
                          Enter Results
                        </button>
                      )}
                      {r.status === "result_entered" && (
                        <button onClick={() => verifyAndRelease(r)} style={actionBtn("#16a34a")}>
                          Verify & Release
                        </button>
                      )}
                      {r.status === "verified" && (
                        <button onClick={() => releaseResults(r)} style={actionBtn("#16a34a")}>
                          Release Results
                        </button>
                      )}
                      {(r.status === "released" || r.status === "cancelled") && (
                        <span style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 600 }}>
                          {r.status === "released" ? "Released" : "Cancelled"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Result Entry */}
      {activeTab === "entry" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {requests.map((r) => (
              <button
                key={r.id}
                onClick={() => openEntry(r)}
                style={{
                  padding: "0.4rem 0.8rem",
                  borderRadius: "6px",
                  border: activeRequest?.id === r.id ? "1px solid #0284c7" : "1px solid #cbd5e1",
                  background: activeRequest?.id === r.id ? "#e0f2fe" : "#fff",
                  color: activeRequest?.id === r.id ? "#0369a1" : "#475569",
                  fontWeight: 600,
                  fontSize: "0.8rem",
                  cursor: "pointer",
                }}
              >
                {r.requestNo}
              </button>
            ))}
          </div>

          {activeRequest ? (
            <form onSubmit={handleSaveResults} style={{ background: "#fff", padding: "1.5rem", borderRadius: "8px", border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", background: "#f8fafc", padding: "1rem", borderRadius: "6px", border: "1px solid #cbd5e1" }}>
                <div>
                  <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "#0f172a" }}>{activeRequest.requestNo}</div>
                  <div style={{ fontSize: "0.8rem", color: "#64748b" }}>
                    Patient: <strong>{activeRequest.patientName || "—"}</strong> • Ordered by {activeRequest.orderedByName}
                  </div>
                  {activeRequest.clinicalNotes && (
                    <div style={{ fontSize: "0.8rem", color: "#1e40af", marginTop: "0.2rem" }}>Notes: {activeRequest.clinicalNotes}</div>
                  )}
                </div>
                <StatusBadge status={activeRequest.status} />
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ background: "#f1f5f9", borderBottom: "1px solid #cbd5e1", color: "#475569" }}>
                    <th style={{ padding: "0.6rem 0.8rem" }}>TEST</th>
                    <th style={{ padding: "0.6rem 0.8rem" }}>SPECIMEN</th>
                    <th style={{ padding: "0.6rem 0.8rem" }}>RESULT</th>
                    <th style={{ padding: "0.6rem 0.8rem" }}>CRITICAL</th>
                    <th style={{ padding: "0.6rem 0.8rem" }}>VERIFIED</th>
                  </tr>
                </thead>
                <tbody>
                  {activeRequest.items.map((it) => (
                    <tr key={it.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "0.6rem 0.8rem", fontWeight: 600, color: "#334155" }}>
                        {it.testName}
                        <div style={{ fontSize: "0.7rem", color: "#64748b", fontWeight: 400 }}>{it.testCode}</div>
                      </td>
                      <td style={{ padding: "0.6rem 0.8rem", color: "#64748b" }}>{it.specimenType}</td>
                      <td style={{ padding: "0.6rem 0.8rem" }}>
                        <input
                          type="text"
                          value={resultValues[it.id] ?? ""}
                          onChange={(e) => setResultValues((prev) => ({ ...prev, [it.id]: e.target.value }))}
                          placeholder="Enter result"
                          style={{ padding: "0.4rem", borderRadius: "4px", border: "1px solid #cbd5e1", width: "100%", boxSizing: "border-box" }}
                        />
                      </td>
                      <td style={{ padding: "0.6rem 0.8rem" }}>
                        <input
                          type="checkbox"
                          checked={criticalFlags[it.id] ?? false}
                          onChange={(e) => setCriticalFlags((prev) => ({ ...prev, [it.id]: e.target.checked }))}
                        />
                      </td>
                      <td style={{ padding: "0.6rem 0.8rem", fontSize: "0.8rem", color: it.resultVerifiedAt ? "#16a34a" : "#94a3b8", fontWeight: 600 }}>
                        {it.resultVerifiedAt ? "Yes" : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
                <button type="button" onClick={() => setActiveTab("queue")} style={ghostBtn}>
                  Back to Queue
                </button>
                <button type="submit" disabled={savingResults} style={primaryBtn}>
                  {savingResults ? "Saving…" : "Save Results"}
                </button>
              </div>
            </form>
          ) : (
            <p style={{ color: "#64748b", fontSize: "0.9rem" }}>Select a lab request to enter results.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: "#fff", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
      <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function FieldLabel({ children }: { children: string }) {
  return <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "0.2rem" }}>{children}</label>;
}

function PriorityBadge({ priority }: { priority: string }) {
  const stat = priority === "stat";
  const urgent = priority === "urgent";
  const background = stat ? "#fef2f2" : urgent ? "#fffbeb" : "#f1f5f9";
  const color = stat ? "#dc2626" : urgent ? "#d97706" : "#475569";
  return (
    <span style={{ padding: "0.2rem 0.5rem", borderRadius: "4px", fontSize: "0.7rem", fontWeight: 700, background, color, border: stat ? "1px solid #fca5a5" : "none" }}>
      {priority.toUpperCase()}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    released: ["#f0fdf4", "#16a34a"],
    verified: ["#f0fdf4", "#16a34a"],
    result_entered: ["#eff6ff", "#2563eb"],
    processing: ["#eff6ff", "#2563eb"],
    received: ["#fefce8", "#ca8a04"],
    specimen_collected: ["#fefce8", "#ca8a04"],
    payment: ["#fefce8", "#ca8a04"],
    requested: ["#f1f5f9", "#475569"],
    cancelled: ["#fef2f2", "#dc2626"],
  };
  const [background, color] = map[status] ?? ["#f1f5f9", "#475569"];
  return (
    <span style={{ padding: "0.25rem 0.5rem", borderRadius: "4px", fontSize: "0.75rem", fontWeight: 600, background, color }}>
      {status.replace("_", " ").toUpperCase()}
    </span>
  );
}

function tabStyle(active: boolean): CSSProperties {
  return {
    padding: "0.5rem 1.2rem",
    border: "none",
    background: active ? "#0284c7" : "transparent",
    color: active ? "#fff" : "#64748b",
    borderRadius: "6px",
    fontWeight: 600,
    cursor: "pointer",
  };
}

const input: CSSProperties = { width: "100%", padding: "0.4rem", borderRadius: "4px", border: "1px solid #cbd5e1", boxSizing: "border-box" };
const primaryBtn: CSSProperties = { padding: "0.6rem 1.5rem", background: "#16a34a", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 700, cursor: "pointer" };
const ghostBtn: CSSProperties = { padding: "0.5rem 1.2rem", background: "transparent", border: "1px solid #cbd5e1", color: "#64748b", borderRadius: "6px", fontWeight: 600, cursor: "pointer" };
const actionBtn = (bg: string): CSSProperties => ({ padding: "0.35rem 0.75rem", background: bg, color: "#fff", border: "none", borderRadius: "4px", fontWeight: 600, cursor: "pointer", fontSize: "0.75rem" });
