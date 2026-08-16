import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { apiFetch } from "../api/client";

interface RosterAssignment {
  id: string;
  staffId: string;
  staffName: string;
  employeeNo: string;
  shiftId: string;
  shiftName: string;
  shiftCode: string;
  workDate: string;
}

interface RosterPlan {
  id: string;
  planNo: string;
  name: string;
  departmentName: string;
  startDate: string;
  endDate: string;
  status: string;
  version: number;
  rejectedReason: string;
  assignments: RosterAssignment[];
  unmet: { shiftName: string; required: number; assigned: number }[];
}

interface StaffShift {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  isNight: boolean;
}

interface Department {
  id: string;
  code: string;
  name: string;
}

const EMPTY_PLAN_FORM = {
  name: "",
  departmentId: "",
  startDate: "",
  endDate: "",
  requirements: [] as { shiftId: string; required: string }[],
};

export default function RosterPage() {
  const [activeTab, setActiveTab] = useState<"plans" | "generator">("plans");

  const [plans, setPlans] = useState<RosterPlan[]>([]);
  const [shifts, setShifts] = useState<StaffShift[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [planForm, setPlanForm] = useState(EMPTY_PLAN_FORM);
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [plansRes, shiftsRes, deptsRes] = await Promise.allSettled([
      apiFetch<RosterPlan[]>("/roster/plans"),
      apiFetch<StaffShift[]>("/attendance/shifts"),
      apiFetch<Department[]>("/admin/departments"),
    ]);
    const errors: string[] = [];
    if (plansRes.status === "fulfilled") {
      setPlans(plansRes.value);
    } else {
      errors.push(plansRes.reason instanceof Error ? plansRes.reason.message : "Could not load roster plans.");
    }
    if (shiftsRes.status === "fulfilled") {
      setShifts(shiftsRes.value);
    } else {
      errors.push(shiftsRes.reason instanceof Error ? shiftsRes.reason.message : "Could not load shift definitions.");
    }
    if (deptsRes.status === "fulfilled") {
      setDepartments(deptsRes.value);
    } else {
      errors.push(deptsRes.reason instanceof Error ? deptsRes.reason.message : "Could not load departments.");
    }
    setError(errors.join(" "));
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function planAction(plan: RosterPlan, fn: (id: string) => Promise<unknown>) {
    setBusyId(plan.id);
    setError("");
    try {
      await fn(plan.id);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Roster action failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function rejectPlan(plan: RosterPlan) {
    const reason = window.prompt(`Reason for rejecting roster ${plan.planNo}?`)?.trim();
    if (!reason) return;
    await planAction(plan, (id) =>
      apiFetch<unknown>(`/roster/plans/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
    );
  }

  async function handleCreatePlan(e: FormEvent) {
    e.preventDefault();
    const reqs = planForm.requirements
      .map((r) => ({ shiftId: r.shiftId, required: Number(r.required) }))
      .filter((r) => r.shiftId && Number.isFinite(r.required) && r.required > 0);
    if (reqs.length === 0) {
      setError("Add at least one shift requirement with a positive count.");
      return;
    }
    if (!planForm.departmentId) {
      setError("Select a department.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiFetch<unknown>("/roster/plans", {
        method: "POST",
        body: JSON.stringify({
          name: planForm.name || `Roster ${planForm.startDate} → ${planForm.endDate}`,
          departmentId: planForm.departmentId,
          startDate: planForm.startDate,
          endDate: planForm.endDate,
          shiftRequirements: reqs,
        }),
      });
      setPlanForm(EMPTY_PLAN_FORM);
      await loadAll();
      setActiveTab("plans");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the roster plan.");
    } finally {
      setSaving(false);
    }
  }

  function setRequirement(idx: number, patch: Partial<{ shiftId: string; required: string }>) {
    setPlanForm((prev) => ({
      ...prev,
      requirements: prev.requirements.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    }));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 800, color: "#0f172a" }}>
          Monthly Roster Planning & Daily Shift Governance
        </h2>
        <p style={{ margin: "0.2rem 0 0 0", fontSize: "0.875rem", color: "#64748b" }}>
          Automated monthly scheduling with approval workflow and constraint enforcement.
        </p>
      </div>

      <div style={{ display: "flex", gap: "1rem", borderBottom: "2px solid #e2e8f0" }}>
        <button onClick={() => setActiveTab("plans")} style={tabStyle(activeTab === "plans")}>
          Roster Plans & Approvals
        </button>
        <button onClick={() => setActiveTab("generator")} style={tabStyle(activeTab === "generator")}>
          Monthly Generator Engine
        </button>
      </div>

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: "0.85rem", color: "#b91c1c" }}>
          {error}
        </p>
      )}

      {loading && <p style={{ margin: 0, fontSize: "0.9rem", color: "#64748b" }}>Loading roster data…</p>}

      {/* Plans list */}
      {!loading && activeTab === "plans" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {plans.length === 0 && (
            <p style={{ color: "#64748b", fontSize: "0.9rem" }}>
              No roster plans yet. Use the Monthly Generator Engine to create one.
            </p>
          )}
          {plans.map((p) => (
            <div key={p.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
                <div>
                  <span style={{ fontWeight: 800, color: "#0f172a", fontSize: "1rem" }}>{p.name}</span>
                  <span style={{ marginLeft: "0.75rem", fontSize: "0.8rem", color: "#64748b" }}>
                    {p.planNo} · v{p.version} · {p.departmentName || "—"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <StatusBadge status={p.status} />
                  <span style={{ fontSize: "0.8rem", color: "#64748b" }}>
                    {p.startDate} → {p.endDate}
                  </span>
                </div>
              </div>

              {p.rejectedReason && (
                <p style={{ margin: "0 0 0.75rem 0", fontSize: "0.8rem", color: "#b45309", background: "#fffbeb", padding: "0.5rem 0.75rem", borderRadius: "6px" }}>
                  Rejected: {p.rejectedReason}
                </p>
              )}

              {p.assignments.length === 0 ? (
                <p style={{ color: "#64748b", fontSize: "0.85rem" }}>No assignments generated yet.</p>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem", marginBottom: "0.75rem" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                      <th style={{ padding: "0.5rem" }}>STAFF</th>
                      <th style={{ padding: "0.5rem" }}>EMPLOYEE NO</th>
                      <th style={{ padding: "0.5rem" }}>WORK DATE</th>
                      <th style={{ padding: "0.5rem" }}>SHIFT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.assignments.map((a) => (
                      <tr key={a.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "0.5rem", fontWeight: 600 }}>{a.staffName || a.staffId}</td>
                        <td style={{ padding: "0.5rem", color: "#64748b" }}>{a.employeeNo || "—"}</td>
                        <td style={{ padding: "0.5rem" }}>{a.workDate}</td>
                        <td style={{ padding: "0.5rem" }}>
                          <span style={{ padding: "0.15rem 0.5rem", borderRadius: "4px", background: "#e0f2fe", color: "#0369a1", fontWeight: 600 }}>
                            {a.shiftName || a.shiftCode}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {p.unmet.length > 0 && (
                <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "6px", padding: "0.6rem 0.75rem", fontSize: "0.8rem", color: "#991b1b", marginBottom: "0.75rem" }}>
                  <strong>Unmet requirements:</strong>{" "}
                  {p.unmet.map((u) => `${u.shiftName || "shift"} (${u.assigned}/${u.required})`).join(", ")}
                </div>
              )}

              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                {p.status === "draft" && (
                  <>
                    <button disabled={busyId === p.id} onClick={() => planAction(p, (id) => apiFetch<unknown>(`/roster/plans/${id}/regenerate`, { method: "POST" }))} style={actionBtn("#2563eb")}>
                      {busyId === p.id ? "Working…" : "Regenerate"}
                    </button>
                    <button disabled={busyId === p.id} onClick={() => planAction(p, (id) => apiFetch<unknown>(`/roster/plans/${id}/submit`, { method: "POST" }))} style={actionBtn("#d97706")}>
                      Submit for Approval
                    </button>
                  </>
                )}
                {p.status === "submitted" && (
                  <>
                    <button disabled={busyId === p.id} onClick={() => planAction(p, (id) => apiFetch<unknown>(`/roster/plans/${id}/approve`, { method: "POST" }))} style={actionBtn("#16a34a")}>
                      Approve & Publish
                    </button>
                    <button disabled={busyId === p.id} onClick={() => rejectPlan(p)} style={actionBtn("#dc2626")}>
                      Reject
                    </button>
                  </>
                )}
                {p.status === "approved" && (
                  <button disabled={busyId === p.id} onClick={() => planAction(p, (id) => apiFetch<unknown>(`/roster/plans/${id}/amend`, { method: "POST" }))} style={actionBtn("#0284c7")}>
                    Amend (new draft)
                  </button>
                )}
                {p.status === "rejected" && (
                  <span style={{ fontSize: "0.8rem", color: "#64748b" }}>Rejected — create a new plan or amend.</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Generator */}
      {!loading && activeTab === "generator" && (
        <form onSubmit={handleCreatePlan} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "1.5rem", maxWidth: "800px", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#0f172a" }}>Automated Monthly Roster Generator</h3>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "#64748b" }}>
            Creates a draft plan and generates assignments while enforcing rest periods, night rotation, and coverage requirements.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <FieldLabel>Plan name</FieldLabel>
              <input value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} placeholder="e.g. September Nursing Roster" style={input} />
            </div>
            <div>
              <FieldLabel>Department *</FieldLabel>
              <select required value={planForm.departmentId} onChange={(e) => setPlanForm({ ...planForm, departmentId: e.target.value })} style={input}>
                <option value="">Select department…</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>Start date *</FieldLabel>
              <input type="date" required value={planForm.startDate} onChange={(e) => setPlanForm({ ...planForm, startDate: e.target.value })} style={input} />
            </div>
            <div>
              <FieldLabel>End date *</FieldLabel>
              <input type="date" required value={planForm.endDate} onChange={(e) => setPlanForm({ ...planForm, endDate: e.target.value })} style={input} />
            </div>
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <FieldLabel>Shift requirements (staff needed per shift)</FieldLabel>
              <button
                type="button"
                onClick={() => setPlanForm((prev) => ({ ...prev, requirements: [...prev.requirements, { shiftId: "", required: "1" }] }))}
                style={ghostBtn}
              >
                + Add Requirement
              </button>
            </div>
            {planForm.requirements.length === 0 && (
              <p style={{ margin: 0, fontSize: "0.8rem", color: "#64748b" }}>No shift requirements added yet.</p>
            )}
            {planForm.requirements.map((r, idx) => (
              <div key={idx} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.4rem" }}>
                <select value={r.shiftId} onChange={(e) => setRequirement(idx, { shiftId: e.target.value })} style={{ ...input, flex: 1 }}>
                  <option value="">Select shift…</option>
                  {shifts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.startTime}–{s.endTime})
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  value={r.required}
                  onChange={(e) => setRequirement(idx, { required: e.target.value })}
                  style={{ ...input, width: "5rem" }}
                  title="Required staff count"
                />
                <button
                  type="button"
                  onClick={() => setPlanForm((prev) => ({ ...prev, requirements: prev.requirements.filter((_, i) => i !== idx) }))}
                  style={ghostBtn}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="submit" disabled={saving} style={primaryBtn}>
              {saving ? "Generating…" : "Generate Roster Plan"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function FieldLabel({ children }: { children: string }) {
  return <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>{children}</label>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    approved: ["#f0fdf4", "#16a34a"],
    submitted: ["#fefce8", "#ca8a04"],
    draft: ["#f1f5f9", "#475569"],
    rejected: ["#fef2f2", "#dc2626"],
  };
  const [background, color] = map[status] ?? ["#f1f5f9", "#475569"];
  return (
    <span style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem", borderRadius: "6px", background, color, fontWeight: 700 }}>
      {status.toUpperCase()}
    </span>
  );
}

function tabStyle(active: boolean): CSSProperties {
  return {
    padding: "0.6rem 1rem",
    background: "none",
    border: "none",
    borderBottom: active ? "2px solid #2563eb" : "none",
    fontWeight: active ? 700 : 500,
    color: active ? "#2563eb" : "#64748b",
    cursor: "pointer",
  };
}

const input: CSSProperties = { width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #cbd5e1", boxSizing: "border-box" };
const primaryBtn: CSSProperties = { padding: "0.65rem 1.5rem", background: "#16a34a", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 700, cursor: "pointer" };
const ghostBtn: CSSProperties = { padding: "0.3rem 0.7rem", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: "4px", fontSize: "0.75rem", cursor: "pointer" };
const actionBtn = (bg: string): CSSProperties => ({ padding: "0.45rem 0.9rem", background: bg, color: "#fff", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "pointer", fontSize: "0.8rem" });
