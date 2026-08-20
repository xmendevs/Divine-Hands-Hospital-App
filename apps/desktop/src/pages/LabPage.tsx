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
import ChargePatientModal from "../components/ChargePatientModal";

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
  resultEnteredByName?: string;
  resultVerifiedByName?: string;
  resultEnteredAt?: string;
  resultVerifiedAt?: string;
}

interface LabSpecimen {
  id: string;
  specimenNo: string;
  barcode: string;
  itemId?: string;
  specimenType: string;
  originLocation?: string;
  status: string;
  collectedAt: string;
  receivedAt?: string;
}

interface LabRequest {
  id: string;
  requestNo: string;
  patientId?: string;
  patientNo?: string;
  patientName?: string;
  clientName?: string;
  orderId?: string;
  orderedByName: string;
  priority: string;
  clinicalNotes: string;
  paymentStatus: string;
  status: string;
  requestedAt: string;
  releasedAt?: string;
  items: LabItem[];
  specimens?: LabSpecimen[];
}

interface LabTATPhase {
  phase: string;
  label: string;
  completed: number;
  avgMinutes: number;
  p95Minutes: number;
  targetMinutes: number;
  withinTargetPct: number;
  bottleneck: boolean;
  bottleneckHits: number;
}

interface LabTATRequest {
  requestId: string;
  requestNo: string;
  patientName?: string;
  patientNo?: string;
  priority: string;
  status: string;
  preAnalyticalMin?: number;
  analyticalMin?: number;
  postAnalyticalMin?: number;
  totalMin?: number;
}

interface LabTATReport {
  summary: LabTATPhase[];
  requests: LabTATRequest[];
}

interface LabInstrument {
  id: string;
  code: string;
  name: string;
  instrumentType: string;
  manufacturer: string;
  model: string;
  status: string;
  lastConnectedAt?: string;
}

interface LabInstrumentLog {
  id: string;
  instrumentId: string;
  direction: string;
  messageType: string;
  payload: Record<string, unknown>;
  status: string;
  createdAt: string;
}

interface DoctorOrder {
  id: string;
  orderNo: string;
  orderType: string;
  status: string;
  details: Record<string, unknown>;
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
  const [activeTab, setActiveTab] = useState<"queue" | "entry" | "tat">("queue");
  const [filterStatus, setFilterStatus] = useState("ALL");

  const [requests, setRequests] = useState<LabRequest[]>([]);
  const [tests, setTests] = useState<LabTest[]>([]);
  const [critical, setCritical] = useState<LabCritical[]>([]);
  const [tat, setTat] = useState<LabTATReport | null>(null);
  const [instruments, setInstruments] = useState<LabInstrument[]>([]);
  const [instrumentLogs, setInstrumentLogs] = useState<Record<string, LabInstrumentLog[]>>({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const toast = useToast();

  // Charge patient modal
  const [showCharge, setShowCharge] = useState(false);

  // Patient lab-record state for the new-request form.
  const [patientLabCount, setPatientLabCount] = useState<number | null>(null);
  const [patientLabLoading, setPatientLabLoading] = useState(false);

  // Specimen collection dialog (replaces window.prompt, which is unavailable in WebView2).
  const [collectTarget, setCollectTarget] = useState<LabRequest | null>(null);
  const [collectOrigin, setCollectOrigin] = useState("OPD Ward 2");

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
  const [customTests, setCustomTests] = useState<{ name: string; specimenType: string }[]>([]);
  const [customTestName, setCustomTestName] = useState("");
  const [customTestSpecimen, setCustomTestSpecimen] = useState("");
  const [testSearch, setTestSearch] = useState("");
  const [priority, setPriority] = useState("routine");
  const [clinicalNotes, setClinicalNotes] = useState("");
  const [doctorOrders, setDoctorOrders] = useState<DoctorOrder[]>([]);
  const [linkedOrderId, setLinkedOrderId] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [reqRes, testsRes, critRes, tatRes, instRes] = await Promise.allSettled([
      apiFetch<LabRequest[]>("/lab/requests"),
      apiFetch<LabTest[]>("/lab/tests"),
      apiFetch<LabCritical[]>("/lab/critical"),
      apiFetch<LabTATReport>("/lab/tat"),
      apiFetch<LabInstrument[]>("/lab/instruments"),
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
    if (tatRes.status === "fulfilled") {
      setTat(tatRes.value);
    }
    if (instRes.status === "fulfilled") {
      setInstruments(instRes.value);
      // Load the log queue for each instrument (lazy, up to 4).
      for (const inst of instRes.value.slice(0, 4)) {
        void apiFetch<LabInstrumentLog[]>(`/lab/instruments/${inst.id}/logs`)
          .then((logs) => setInstrumentLogs((prev) => ({ ...prev, [inst.id]: logs })))
          .catch(() => undefined);
      }
    }
    setError(errors.join(" "));
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Load the selected patient's pending lab orders so the request can be
  // linked to the doctor's order (real-time queue sync), and their existing
  // lab records so the form can state whether they have any.
  useEffect(() => {
    if (!selectedPatient) {
      setDoctorOrders([]);
      setLinkedOrderId("");
      setPatientLabCount(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setPatientLabLoading(true);
      try {
        const orders = await apiFetch<DoctorOrder[]>(`/patients/${selectedPatient.id}/orders`);
        if (!cancelled) {
          const labOrders = orders.filter(
            (o) =>
              (o.orderType === "lab_request" || o.orderType === "lab_investigation") &&
              o.status !== "completed" &&
              o.status !== "cancelled",
          );
          setDoctorOrders(labOrders);
        }
      } catch {
        if (!cancelled) setDoctorOrders([]);
      }
      try {
        const lab = await apiFetch<LabRequest[]>(`/lab/requests?patientId=${selectedPatient.id}`);
        if (!cancelled) setPatientLabCount(Array.isArray(lab) ? lab.length : 0);
      } catch {
        if (!cancelled) setPatientLabCount(0);
      } finally {
        if (!cancelled) setPatientLabLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPatient]);

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
    setCollectTarget(r);
    setCollectOrigin("OPD Ward 2");
  }

  async function confirmCollect() {
    const r = collectTarget;
    if (!r) return;
    const origin = collectOrigin.trim();
    const specimens = (r.items || []).map((it) => ({
      itemId: it.id,
      specimenType: it.specimenType,
      originLocation: origin,
    }));
    setCollectTarget(null);
    await apiAction(
      () =>
        apiFetch<unknown>(`/lab/requests/${r.id}/collect`, {
          method: "POST",
          body: JSON.stringify({ specimens }),
        }),
      "Specimens collected — barcodes assigned.",
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
      for (const it of r.items || []) {
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
      const entries = (activeRequest.items || []).map((it) => ({
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

  function addCustomTest() {
    const name = customTestName.trim();
    if (!name) return;
    if (customTests.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      setError("That test is already in the list.");
      return;
    }
    setCustomTests((prev) => [
      ...prev,
      { name, specimenType: customTestSpecimen.trim() },
    ]);
    setCustomTestName("");
    setCustomTestSpecimen("");
    setError("");
  }

  async function handleCreateRequest(e: FormEvent) {
    e.preventDefault();
    if (!selectedPatient) {
      setError("Select a patient for the lab request.");
      return;
    }
    if (selectedTests.length === 0 && customTests.length === 0) {
      setError("Select or type at least one test.");
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
          customTests: customTests.map((c) => ({ name: c.name, specimenType: c.specimenType })),
          orderId: linkedOrderId || undefined,
        }),
      });
      setSelectedPatient(null);
      setPatientSearch("");
      setSelectedTests([]);
      setCustomTests([]);
      setCustomTestName("");
      setCustomTestSpecimen("");
      setTestSearch("");
      setClinicalNotes("");
      setLinkedOrderId("");
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
      header: "Tests / Specimens",
      render: (r: LabRequest) => (
        <div>
          <div style={{ color: theme.text.secondary }}>
            {(r.items || []).map((it) => it.testName).join(", ") || "—"}
          </div>
          {(r.specimens || []).map((s) => (
            <div
              key={s.id}
              style={{
                fontSize: theme.fontSize.sm,
                color: theme.action.info,
                fontWeight: theme.fontWeight.semibold,
                marginTop: 2,
              }}
            >
              ◧ {s.barcode || s.specimenNo}
              {s.originLocation ? ` · ${s.originLocation}` : ""}
              <span style={{ color: theme.text.muted, fontWeight: theme.fontWeight.normal }}>
                {" "}({s.status})
              </span>
            </div>
          ))}
        </div>
      ),
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
          {r.orderId && (
            <span
              style={{
                fontSize: theme.fontSize.xs,
                color: theme.action.info,
                fontWeight: theme.fontWeight.semibold,
              }}
            >
              ⚡ Linked to doctor's order
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
        actions={
          <Button variant="outline" onClick={() => setShowCharge(true)}>
            Charge Patient
          </Button>
        }
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
            { key: "entry", label: "Result Entry & Sign-off" },
            { key: "tat", label: "TAT Monitoring & Analyzers" },
          ]}
          active={activeTab}
          onChange={(k) => setActiveTab(k as "queue" | "entry" | "tat")}
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
                {selectedPatient && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    {patientLabLoading ? (
                      <p style={{ margin: 0, fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                        Checking this patient's lab records…
                      </p>
                    ) : patientLabCount !== null && patientLabCount === 0 ? (
                      <p
                        style={{
                          margin: 0,
                          fontSize: theme.fontSize.sm,
                          color: theme.action.warning,
                          fontWeight: theme.fontWeight.semibold,
                        }}
                      >
                        ⚠ No lab records on file for this patient yet — this will be their first.
                      </p>
                    ) : patientLabCount !== null ? (
                      <p
                        style={{
                          margin: 0,
                          fontSize: theme.fontSize.sm,
                          color: theme.text.muted,
                        }}
                      >
                        {patientLabCount} prior lab record{patientLabCount === 1 ? "" : "s"} on file
                        for this patient.
                      </p>
                    ) : null}
                  </div>
                )}
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
                {selectedPatient && doctorOrders.length > 0 && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <FormField label="Link to doctor's order (optional)">
                      <Select
                        value={linkedOrderId}
                        onChange={(e) => setLinkedOrderId(e.target.value)}
                      >
                        <option value="">No link — standalone lab request</option>
                        {doctorOrders.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.orderNo} — {o.orderType.replace(/_/g, " ").toUpperCase()}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                    <p style={{ margin: 0, fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                      Releasing this request will automatically complete the linked doctor order
                      (Ordered → Verified/Released).
                    </p>
                  </div>
                )}
              </div>
              <div>
                <span
                  style={{
                    fontSize: theme.fontSize.base,
                    fontWeight: theme.fontWeight.semibold,
                    color: theme.text.secondary,
                  }}
                >
                  Tests ({selectedTests.length + customTests.length} selected)
                </span>

                {/* Manual test entry */}
                <div
                  style={{
                    display: "flex",
                    gap: theme.spacing["2"],
                    marginTop: theme.spacing["2"],
                    flexWrap: "wrap",
                    alignItems: "center",
                    background: theme.surface.subtle,
                    border: `1px dashed ${theme.surface.borderStrong}`,
                    borderRadius: theme.radius.md,
                    padding: theme.spacing["3"],
                  }}
                >
                  <span style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                    ✍️ Type a test not in the list:
                  </span>
                  <Input
                    type="text"
                    placeholder="e.g. Serum Ferritin, Sputum AFB..."
                    value={customTestName}
                    onChange={(e) => setCustomTestName(e.target.value)}
                    style={{ flex: "1 1 200px" }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCustomTest();
                      }
                    }}
                  />
                  <Input
                    type="text"
                    placeholder="Specimen (optional)"
                    value={customTestSpecimen}
                    onChange={(e) => setCustomTestSpecimen(e.target.value)}
                    style={{ flex: "0 1 160px" }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCustomTest();
                      }
                    }}
                  />
                  <Button type="button" size="sm" onClick={addCustomTest}>
                    + Add test
                  </Button>
                </div>

                {/* Typed custom test chips */}
                {customTests.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: theme.spacing["2"],
                      marginTop: theme.spacing["2"],
                    }}
                  >
                    {customTests.map((c, i) => (
                      <span
                        key={`${c.name}-${i}`}
                        style={{
                          padding: "0.35rem 0.7rem",
                          borderRadius: theme.radius.full,
                          border: `1px solid ${theme.action.primary}`,
                          background: theme.badge.aft.bg,
                          color: theme.badge.aft.text,
                          fontWeight: theme.fontWeight.semibold,
                          fontSize: theme.fontSize.base,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: theme.spacing["2"],
                        }}
                      >
                        {c.name}
                        {c.specimenType && (
                          <span style={{ fontWeight: theme.fontWeight.normal, opacity: 0.85 }}>
                            ({c.specimenType})
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setCustomTests((prev) => prev.filter((_, x) => x !== i))
                          }
                          style={{
                            border: "none",
                            background: "transparent",
                            color: "inherit",
                            cursor: "pointer",
                            fontSize: theme.fontSize.base,
                            lineHeight: 1,
                          }}
                          aria-label={`Remove ${c.name}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Catalogue search + chips */}
                <Input
                  type="text"
                  placeholder="Filter catalogue (e.g. blood, liver, malaria)..."
                  value={testSearch}
                  onChange={(e) => setTestSearch(e.target.value)}
                  style={{ marginTop: theme.spacing["2"] }}
                />
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: theme.spacing["2"],
                    marginTop: theme.spacing["1"],
                  }}
                >
                  {tests
                    .filter((t) =>
                      testSearch.trim()
                        ? (t.name + " " + t.category + " " + t.code)
                            .toLowerCase()
                            .includes(testSearch.trim().toLowerCase())
                        : true,
                    )
                    .map((t) => {
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
                          <span style={{ fontWeight: theme.fontWeight.normal, opacity: 0.8 }}>
                            {" "}({t.category})
                          </span>
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
                        <th style={th}>Test / Barcode</th>
                        <th style={th}>Specimen</th>
                        <th style={th}>Result</th>
                        <th style={th}>Critical</th>
                        <th style={th}>Entered by</th>
                        <th style={th}>Verified by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(activeRequest.items || []).map((it) => (
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
                              {activeRequest.specimens?.find((s) => s.itemId === it.id)?.barcode && (
                                <span style={{ color: theme.action.info, fontWeight: theme.fontWeight.semibold }}>
                                  {" "}· ◧{" "}
                                  {activeRequest.specimens?.find((s) => s.itemId === it.id)?.barcode}
                                </span>
                              )}
                            </div>
                          </td>
                          <td style={{ ...td, color: theme.text.muted }}>
                            {it.specimenType}
                            {activeRequest.specimens?.find((s) => s.itemId === it.id)
                              ?.originLocation && (
                              <div style={{ fontSize: theme.fontSize.sm }}>
                                {activeRequest.specimens?.find((s) => s.itemId === it.id)
                                  ?.originLocation}
                              </div>
                            )}
                          </td>
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
                              color: it.resultEnteredAt ? theme.text.secondary : theme.text.muted,
                              fontWeight: theme.fontWeight.semibold,
                            }}
                          >
                            {it.resultEnteredByName || "—"}
                          </td>
                          <td
                            style={{
                              ...td,
                              fontSize: theme.fontSize.base,
                              color: it.resultVerifiedAt ? theme.action.success : theme.text.muted,
                              fontWeight: theme.fontWeight.semibold,
                            }}
                          >
                            {it.resultVerifiedAt ? it.resultVerifiedByName || "Verified" : "Pending sign-off"}
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

      {/* Tab 3: TAT Monitoring & Analyzer Integration */}
      {activeTab === "tat" && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}>
          <Card title="Turnaround Time (TAT) Monitoring">
            {tat && tat.summary.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: theme.spacing["4"],
                  }}
                >
                  {tat.summary.map((s) => (
                    <div
                      key={s.phase}
                      style={{
                        background: s.bottleneck ? theme.surface.warning : theme.surface.subtle,
                        border: `1px solid ${s.bottleneck ? theme.surface.warningBorder : theme.surface.borderStrong}`,
                        borderRadius: theme.radius.lg,
                        padding: theme.spacing["4"],
                      }}
                    >
                      <div
                        style={{
                          fontSize: theme.fontSize.sm,
                          color: s.bottleneck ? theme.text.warning : theme.text.muted,
                          fontWeight: theme.fontWeight.bold,
                        }}
                      >
                        {s.label.toUpperCase()}
                        {s.bottleneck && " ⚠"}
                      </div>
                      <div
                        style={{
                          fontSize: "1.4rem",
                          fontWeight: theme.fontWeight.bold,
                          color: theme.text.primary,
                          margin: "0.3rem 0",
                        }}
                      >
                        {s.completed > 0 ? `${s.avgMinutes.toFixed(1)} min avg` : "—"}
                      </div>
                      <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                        {s.completed} completed · p95 {s.p95Minutes.toFixed(1)} min · target{" "}
                        {s.targetMinutes} min
                      </div>
                      <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                        Within target: {s.withinTargetPct.toFixed(0)}%{" "}
                        {s.bottleneckHits > 0 && `· ${s.bottleneckHits} over target`}
                      </div>
                    </div>
                  ))}
                </div>
                <p style={{ margin: 0, fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                  Quality indicator targets: pre-analytical ≤30 min (collection → lab receipt),
                  analytical ≤120 min (receipt → result entered), post-analytical ≤30 min (verified →
                  released). Phases flagged ⚠ are processing bottlenecks.
                </p>
                <Card title="Per-request TAT" bodyStyle={{ padding: 0 }}>
                  {tat.requests.length === 0 ? (
                    <EmptyState
                      icon="clock"
                      description="No lab requests to measure turnaround time yet."
                    />
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: theme.surface.subtle }}>
                            {["Request", "Patient", "Priority", "Pre", "Analytical", "Post", "Total"].map(
                              (h) => (
                                <th key={h} style={th}>
                                  {h}
                                </th>
                              ),
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {tat.requests.map((r) => (
                            <tr
                              key={r.requestId}
                              style={{ borderBottom: `1px solid ${theme.surface.border}` }}
                            >
                              <td style={{ ...td, fontWeight: theme.fontWeight.semibold }}>
                                {r.requestNo}
                              </td>
                              <td style={{ ...td, color: theme.text.muted }}>
                                {r.patientName || "—"}
                                {r.patientNo && (
                                  <div style={{ fontSize: theme.fontSize.sm }}>{r.patientNo}</div>
                                )}
                              </td>
                              <td style={td}>
                                <StatusBadge variant={priorityVariant(r.priority)} label={r.priority} />
                              </td>
                              <td style={td}>{fmtTAT(r.preAnalyticalMin)}</td>
                              <td style={td}>{fmtTAT(r.analyticalMin)}</td>
                              <td style={td}>{fmtTAT(r.postAnalyticalMin)}</td>
                              <td style={{ ...td, fontWeight: theme.fontWeight.semibold }}>
                                {fmtTAT(r.totalMin)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>
            ) : (
              <EmptyState
                icon="clock"
                description="TAT data will appear once lab requests pass through the workflow."
              />
            )}
          </Card>

          <Card title="Instrument / Analyzer Integration" bodyStyle={{ padding: 0 }}>
            {instruments.length === 0 ? (
              <EmptyState
                icon="flask"
                description="No analyzers registered yet. Interface-ready: order/sample/result message queues are created per instrument."
              />
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {instruments.map((inst) => (
                  <div
                    key={inst.id}
                    style={{
                      padding: theme.spacing["4"],
                      borderBottom: `1px solid ${theme.surface.border}`,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: theme.spacing["3"],
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontWeight: theme.fontWeight.bold,
                          color: theme.text.primary,
                        }}
                      >
                        {inst.name}{" "}
                        <span style={{ color: theme.text.muted, fontWeight: theme.fontWeight.normal }}>
                          ({inst.code})
                        </span>
                      </div>
                      <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                        {inst.instrumentType} · {inst.manufacturer} {inst.model} ·{" "}
                        {(instrumentLogs[inst.id] || []).length} queued messages
                      </div>
                      {(instrumentLogs[inst.id] || []).length > 0 && (
                        <div
                          style={{
                            marginTop: theme.spacing["2"],
                            display: "flex",
                            flexWrap: "wrap",
                            gap: theme.spacing["2"],
                          }}
                        >
                          {(instrumentLogs[inst.id] || []).slice(0, 4).map((log) => (
                            <span
                              key={log.id}
                              style={{
                                fontSize: theme.fontSize.xs,
                                background: theme.surface.subtle,
                                border: `1px solid ${theme.surface.borderStrong}`,
                                borderRadius: theme.radius.full,
                                padding: "0.2rem 0.6rem",
                                color: theme.text.secondary,
                              }}
                            >
                              {log.direction} {log.messageType} · {log.status}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <StatusBadge
                      variant={inst.status === "online" ? "approved" : inst.status === "maintenance" ? "running" : "draft"}
                      label={inst.status}
                    />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Specimen collection origin dialog (in-app replacement for window.prompt) */}
      {collectTarget && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={() => setCollectTarget(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: theme.surface.card,
              border: `1px solid ${theme.surface.border}`,
              borderRadius: theme.radius.lg,
              boxShadow: theme.shadow.popover,
              padding: theme.spacing["5"],
              width: "min(420px, 92vw)",
            }}
          >
            <div style={{ fontSize: theme.fontSize.lg, fontWeight: theme.fontWeight.bold, color: theme.text.primary }}>
              Collect Specimens — {collectTarget.requestNo}
            </div>
            <p style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, marginTop: theme.spacing["1"] }}>
              Barcodes will be generated for {collectTarget.items?.length ?? 0} specimen(s). Enter the collection origin
              (ward / OPD):
            </p>
            <div style={{ marginTop: theme.spacing["4"] }}>
              <FormField label="Collection origin">
                <Input
                  type="text"
                  placeholder="e.g. OPD Ward 2, Male Medical Ward..."
                  value={collectOrigin}
                  onChange={(e) => setCollectOrigin(e.target.value)}
                  autoFocus
                />
              </FormField>
            </div>
            <div style={{ display: "flex", gap: theme.spacing["2"], justifyContent: "flex-end", marginTop: theme.spacing["4"] }}>
              <Button type="button" variant="ghost" onClick={() => setCollectTarget(null)}>
                Cancel
              </Button>
              <Button type="button" onClick={confirmCollect}>
                Collect Specimens
              </Button>
            </div>
          </div>
        </div>
      )}

      <ChargePatientModal
        open={showCharge}
        onClose={() => setShowCharge(false)}
        onCharged={() => void loadAll()}
      />
    </div>
  );
}

function fmtTAT(mins?: number): string {
  if (mins === undefined || mins === null) return "—";
  if (mins < 60) return `${mins.toFixed(1)} min`;
  return `${(mins / 60).toFixed(1)} h`;
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
