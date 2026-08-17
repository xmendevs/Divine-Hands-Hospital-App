import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import {
  theme,
  Button,
  Card,
  DataTable,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  Select,
  StatusBadge,
  TabNav,
  useToast,
  type StatusVariant,
} from "@hims/ui";
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

function statusVariant(status: string): StatusVariant {
  if (status === "released" || status === "verified") return "approved";
  if (status === "result_entered" || status === "processing") return "active";
  if (status === "received" || status === "specimen_collected" || status === "payment")
    return "running";
  if (status === "cancelled") return "error";
  return "draft";
}

function priorityVariant(priority: string): StatusVariant {
  if (priority === "stat") return "error";
  if (priority === "urgent") return "running";
  return "draft";
}

export default function LabPage() {
  const [activeTab, setActiveTab] = useState<"queue" | "entry">("queue");
  const [filterStatus, setFilterStatus] = useState("ALL");

  const [requests, setRequests] = useState<LabRequest[]>([]);
  const [tests, setTests] = useState<LabTest[]>([]);
  const [critical, setCritical] = useState<LabCritical[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const toast = useToast();

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
      errors.push(
        reqRes.reason instanceof Error ? reqRes.reason.message : "Could not load lab requests.",
      );
    }
    if (testsRes.status === "fulfilled") {
      setTests(testsRes.value);
    } else {
      errors.push(
        testsRes.reason instanceof Error
          ? testsRes.reason.message
          : "Could not load the test catalogue.",
      );
    }
    if (critRes.status === "fulfilled") {
      setCritical(critRes.value);
    } else {
      errors.push(
        critRes.reason instanceof Error
          ? critRes.reason.message
          : "Could not load critical notifications.",
      );
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
  }, [patientSearch]);

  const filteredRequests = requests.filter(
    (r) => filterStatus === "ALL" || r.status === filterStatus,
  );

  async function apiAction(fn: () => Promise<unknown>, successMessage?: string) {
    setError("");
    try {
      await fn();
      await loadAll();
      if (successMessage) {
        setError(successMessage);
        toast.success(successMessage);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Request failed.";
      setError(msg);
      toast.error(msg);
    }
  }

  function collectSpecimens(r: LabRequest) {
    const specimens = r.items.map((it) => ({ itemId: it.id, specimenType: it.specimenType }));
    return apiAction(() =>
      apiFetch<unknown>(`/lab/requests/${r.id}/collect`, {
        method: "POST",
        body: JSON.stringify({ specimens }),
      }),
    );
  }

  function beginAnalysis(r: LabRequest) {
    return apiAction(() =>
      apiFetch<unknown>(`/lab/requests/${r.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status: "processing" }),
      }),
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
      toast.success(`Request ${r.requestNo} verified and released.`);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Verification failed (note: you cannot verify results you entered yourself).";
      setError(msg);
      toast.error(msg);
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
      toast.success(`Results saved for ${activeRequest.requestNo}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save results.";
      setError(msg);
      toast.error(msg);
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
      toast.success("Lab request created.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not create the lab request.";
      setError(msg);
      toast.error(msg);
    }
  }

  async function acknowledgeCritical(n: LabCritical) {
    await apiAction(() =>
      apiFetch<unknown>(`/lab/critical/${n.id}/acknowledge`, {
        method: "POST",
        body: JSON.stringify({ notes: "" }),
      }),
    );
  }

  const pendingCount = requests.filter(
    (r) => r.status === "requested" || r.status === "payment",
  ).length;
  const inAnalysisCount = requests.filter(
    (r) =>
      r.status === "processing" || r.status === "specimen_collected" || r.status === "received",
  ).length;
  const statCount = requests.filter((r) => r.priority === "stat" || r.priority === "urgent").length;
  const verifiedCount = requests.filter(
    (r) => r.status === "verified" || r.status === "released",
  ).length;

  const requestColumns = [
    {
      key: "no",
      header: "Request No",
      render: (r: LabRequest) => (
        <strong style={{ color: theme.action.info }}>{r.requestNo}</strong>
      ),
    },
    {
      key: "patient",
      header: "Patient / Client",
      render: (r: LabRequest) => (
        <div>
          <div style={{ fontWeight: theme.fontWeight.semibold, color: theme.text.primary }}>
            {r.patientName || r.clientName || "—"}
          </div>
          <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
            Ordered by {r.orderedByName}
          </div>
        </div>
      ),
    },
    {
      key: "tests",
      header: "Tests",
      render: (r: LabRequest) => r.items.map((it) => it.testName).join(", "),
    },
    {
      key: "priority",
      header: "Priority",
      render: (r: LabRequest) => (
        <StatusBadge variant={priorityVariant(r.priority)} label={r.priority} />
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r: LabRequest) => (
        <StatusBadge variant={statusVariant(r.status)} label={r.status.replace("_", " ")} />
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (r: LabRequest) => (
        <div style={{ display: "flex", gap: theme.spacing["2"], flexWrap: "wrap" }}>
          {(r.status === "requested" || r.status === "payment") && (
            <Button size="sm" variant="outline" onClick={() => collectSpecimens(r)}>
              Collect Specimens
            </Button>
          )}
          {(r.status === "specimen_collected" || r.status === "received") && (
            <Button size="sm" onClick={() => beginAnalysis(r)}>
              Begin Analysis
            </Button>
          )}
          {r.status === "processing" && (
            <Button
              size="sm"
              style={{ background: theme.action.warning }}
              onClick={() => openEntry(r)}
            >
              Enter Results
            </Button>
          )}
          {r.status === "result_entered" && (
            <Button
              size="sm"
              style={{ background: theme.action.success }}
              onClick={() => verifyAndRelease(r)}
            >
              Verify & Release
            </Button>
          )}
          {r.status === "verified" && (
            <Button
              size="sm"
              style={{ background: theme.action.success }}
              onClick={() => releaseResults(r)}
            >
              Release Results
            </Button>
          )}
          {(r.status === "released" || r.status === "cancelled") && (
            <span
              style={{
                fontSize: theme.fontSize.base,
                color: theme.text.muted,
                fontWeight: theme.fontWeight.semibold,
              }}
            >
              {r.status === "released" ? "Released" : "Cancelled"}
            </span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}>
      <PageHeader
        title="Lab & Pathology"
        description="Laboratory work queue, result entry, and critical value notifications."
      />

      {/* KPI Bar */}
      <div
        style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: theme.spacing["4"] }}
      >
        <Kpi label="Pending Samples" value={pendingCount} color={theme.action.warning} />
        <Kpi label="In Analysis" value={inAnalysisCount} color={theme.action.primary} />
        <Kpi label="Critical / Stat" value={statCount} color={theme.action.danger} />
        <Kpi label="Verified / Released" value={verifiedCount} color={theme.action.success} />
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: theme.spacing["4"],
          flexWrap: "wrap",
        }}
      >
        <TabNav
          tabs={[
            { key: "queue", label: "Laboratory Work Queue" },
            { key: "entry", label: "Diagnostic Result Entry & Signoff" },
          ]}
          active={activeTab}
          onChange={(k) => setActiveTab(k as "queue" | "entry")}
        />
        {activeTab === "queue" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: theme.spacing["2"],
              fontSize: theme.fontSize.base,
            }}
          >
            <span style={{ color: theme.text.muted, fontWeight: theme.fontWeight.semibold }}>
              Status Filter:
            </span>
            <Select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={{ padding: "0.3rem 0.6rem" }}
            >
              <option value="ALL">All Statuses</option>
              {[
                "requested",
                "payment",
                "specimen_collected",
                "received",
                "processing",
                "result_entered",
                "verified",
                "released",
              ].map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ").toUpperCase()}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {error && (
        <p
          role="alert"
          style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.danger }}
        >
          {error}
        </p>
      )}

      {/* Critical notifications strip */}
      {critical.length > 0 && (
        <div
          style={{
            background: theme.surface.error,
            border: `1px solid ${theme.surface.errorBorder}`,
            borderRadius: theme.radius.lg,
            padding: theme.spacing["4"],
          }}
        >
          <div
            style={{
              fontSize: theme.fontSize.sm,
              color: theme.text.dangerStrong,
              fontWeight: theme.fontWeight.bold,
              marginBottom: theme.spacing["2"],
            }}
          >
            CRITICAL RESULTS — {critical.filter((c) => c.status === "pending").length}{" "}
            UNACKNOWLEDGED
          </div>
          {critical
            .filter((c) => c.status === "pending")
            .map((c) => (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: theme.spacing["4"],
                  fontSize: theme.fontSize.base,
                  color: theme.text.dangerStrong,
                  padding: "0.25rem 0",
                }}
              >
                <span>
                  Notified to {c.notifiedToName} on {new Date(c.notifiedAt).toLocaleString()}
                </span>
                <Button size="sm" variant="danger" onClick={() => acknowledgeCritical(c)}>
                  Acknowledge
                </Button>
              </div>
            ))}
        </div>
      )}

      {loading && (
        <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>
          Loading laboratory data…
        </p>
      )}

      {/* Tab 1: Work Queue */}
      {!loading && activeTab === "queue" && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}>
          {/* New request form */}
          <Card title="New Lab Request" bodyStyle={{ padding: theme.spacing["4"] }}>
            <form
              onSubmit={handleCreateRequest}
              style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: theme.spacing["4"],
                }}
              >
                <div>
                  <FormField label="Patient">
                    {selectedPatient ? (
                      <div
                        style={{ display: "flex", gap: theme.spacing["2"], alignItems: "center" }}
                      >
                        <span
                          style={{
                            fontSize: theme.fontSize.base,
                            fontWeight: theme.fontWeight.semibold,
                            color: theme.text.primary,
                          }}
                        >
                          {selectedPatient.firstName} {selectedPatient.lastName} (
                          {selectedPatient.patientNo})
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedPatient(null)}
                        >
                          ×
                        </Button>
                      </div>
                    ) : (
                      <div style={{ position: "relative" }}>
                        <Input
                          type="text"
                          placeholder="Search patient..."
                          value={patientSearch}
                          onChange={(e) => setPatientSearch(e.target.value)}
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
                                type="button"
                                onClick={() => {
                                  setSelectedPatient(p);
                                  setPatients([]);
                                  setPatientSearch("");
                                }}
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
                                <strong style={{ color: theme.action.info }}>{p.patientNo}</strong>{" "}
                                — {p.firstName} {p.lastName}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </FormField>
                </div>
                <FormField label="Priority">
                  <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p.toUpperCase()}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Clinical notes">
                  <Input
                    value={clinicalNotes}
                    onChange={(e) => setClinicalNotes(e.target.value)}
                    placeholder="e.g. Suspected malaria"
                  />
                </FormField>
              </div>
              <div>
                <span
                  style={{
                    fontSize: theme.fontSize.base,
                    fontWeight: theme.fontWeight.semibold,
                    color: theme.text.secondary,
                  }}
                >
                  Tests (select one or more)
                </span>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: theme.spacing["2"],
                    marginTop: theme.spacing["1"],
                  }}
                >
                  {tests.map((t) => {
                    const selected = selectedTests.includes(t.id);
                    return (
                      <label
                        key={t.id}
                        style={{
                          padding: "0.35rem 0.7rem",
                          borderRadius: theme.radius.full,
                          border: `1px solid ${selected ? theme.action.primary : theme.surface.borderStrong}`,
                          background: selected ? theme.badge.aft.bg : theme.surface.card,
                          color: selected ? theme.badge.aft.text : theme.text.secondary,
                          fontWeight: theme.fontWeight.semibold,
                          fontSize: theme.fontSize.base,
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(e) =>
                            setSelectedTests((prev) =>
                              e.target.checked ? [...prev, t.id] : prev.filter((x) => x !== t.id),
                            )
                          }
                          style={{ display: "none" }}
                        />
                        {t.name}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <Button type="submit">Create Lab Request</Button>
              </div>
            </form>
          </Card>

          {/* Requests table */}
          <Card bodyStyle={{ padding: 0 }}>
            {filteredRequests.length === 0 ? (
              <EmptyState icon="flask" description="No lab requests match this filter." />
            ) : (
              <DataTable
                columns={requestColumns}
                rows={filteredRequests}
                rowKey={(r) => r.id}
                dense
              />
            )}
          </Card>
        </div>
      )}

      {/* Tab 2: Result Entry */}
      {activeTab === "entry" && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
          <div style={{ display: "flex", gap: theme.spacing["2"], flexWrap: "wrap" }}>
            {requests.map((r) => (
              <button
                key={r.id}
                onClick={() => openEntry(r)}
                style={{
                  padding: "0.4rem 0.8rem",
                  borderRadius: theme.radius.md,
                  border: `1px solid ${activeRequest?.id === r.id ? theme.action.primary : theme.surface.borderStrong}`,
                  background: activeRequest?.id === r.id ? theme.badge.aft.bg : theme.surface.card,
                  color: activeRequest?.id === r.id ? theme.badge.aft.text : theme.text.secondary,
                  fontWeight: theme.fontWeight.semibold,
                  fontSize: theme.fontSize.base,
                  cursor: "pointer",
                }}
              >
                {r.requestNo}
              </button>
            ))}
          </div>

          {activeRequest ? (
            <Card>
              <form
                onSubmit={handleSaveResults}
                style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: theme.spacing["4"],
                    background: theme.surface.subtle,
                    padding: theme.spacing["4"],
                    borderRadius: theme.radius.md,
                    border: `1px solid ${theme.surface.borderStrong}`,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: theme.fontSize.lg,
                        fontWeight: theme.fontWeight.bold,
                        color: theme.text.primary,
                      }}
                    >
                      {activeRequest.requestNo}
                    </div>
                    <div style={{ fontSize: theme.fontSize.base, color: theme.text.muted }}>
                      Patient: <strong>{activeRequest.patientName || "—"}</strong> • Ordered by{" "}
                      {activeRequest.orderedByName}
                    </div>
                    {activeRequest.clinicalNotes && (
                      <div
                        style={{
                          fontSize: theme.fontSize.base,
                          color: theme.action.primary,
                          marginTop: "0.2rem",
                        }}
                      >
                        Notes: {activeRequest.clinicalNotes}
                      </div>
                    )}
                  </div>
                  <StatusBadge
                    variant={statusVariant(activeRequest.status)}
                    label={activeRequest.status.replace("_", " ")}
                  />
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      textAlign: "left",
                      fontSize: theme.fontSize.base,
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          background: theme.surface.subtle,
                          borderBottom: `1px solid ${theme.surface.borderStrong}`,
                          color: theme.text.secondary,
                        }}
                      >
                        <th style={th}>Test</th>
                        <th style={th}>Specimen</th>
                        <th style={th}>Result</th>
                        <th style={th}>Critical</th>
                        <th style={th}>Verified</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeRequest.items.map((it) => (
                        <tr
                          key={it.id}
                          style={{ borderBottom: `1px solid ${theme.surface.border}` }}
                        >
                          <td
                            style={{
                              ...td,
                              fontWeight: theme.fontWeight.semibold,
                              color: theme.text.secondary,
                            }}
                          >
                            {it.testName}
                            <div
                              style={{
                                fontSize: theme.fontSize.sm,
                                color: theme.text.muted,
                                fontWeight: theme.fontWeight.normal,
                              }}
                            >
                              {it.testCode}
                            </div>
                          </td>
                          <td style={{ ...td, color: theme.text.muted }}>{it.specimenType}</td>
                          <td style={td}>
                            <Input
                              type="text"
                              value={resultValues[it.id] ?? ""}
                              onChange={(e) =>
                                setResultValues((prev) => ({ ...prev, [it.id]: e.target.value }))
                              }
                              placeholder="Enter result"
                            />
                          </td>
                          <td style={td}>
                            <input
                              type="checkbox"
                              checked={criticalFlags[it.id] ?? false}
                              onChange={(e) =>
                                setCriticalFlags((prev) => ({ ...prev, [it.id]: e.target.checked }))
                              }
                              style={{ accentColor: theme.action.primary }}
                            />
                          </td>
                          <td
                            style={{
                              ...td,
                              fontSize: theme.fontSize.base,
                              color: it.resultVerifiedAt ? theme.action.success : theme.text.muted,
                              fontWeight: theme.fontWeight.semibold,
                            }}
                          >
                            {it.resultVerifiedAt ? "Yes" : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div
                  style={{ display: "flex", justifyContent: "flex-end", gap: theme.spacing["3"] }}
                >
                  <Button type="button" variant="ghost" onClick={() => setActiveTab("queue")}>
                    Back to Queue
                  </Button>
                  <Button type="submit" loading={savingResults}>
                    Save Results
                  </Button>
                </div>
              </form>
            </Card>
          ) : (
            <p style={{ color: theme.text.muted, fontSize: theme.fontSize.base }}>
              Select a lab request to enter results.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card bodyStyle={{ padding: theme.spacing["4"] }}>
      <div
        style={{
          fontSize: theme.fontSize.sm,
          color: theme.text.muted,
          fontWeight: theme.fontWeight.bold,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "1.5rem", fontWeight: theme.fontWeight.bold, color }}>{value}</div>
    </Card>
  );
}

const th: CSSProperties = {
  padding: "0.6rem 0.8rem",
  fontWeight: theme.fontWeight.semibold,
  fontSize: theme.fontSize.sm,
};
const td: CSSProperties = {
  padding: "0.6rem 0.8rem",
  color: theme.text.secondary,
  verticalAlign: "top",
};
