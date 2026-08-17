import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  theme,
  Button,
  Card,
  DataTable,
  FormField,
  Input,
  PageHeader,
  Select,
  StatusBadge,
  TabNav,
  useConfirm,
  useToast,
  type StatusVariant,
} from "@hims/ui";
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

function planStatusBadge(status: string): StatusVariant {
  if (status === "approved") return "approved";
  if (status === "submitted") return "submitted";
  if (status === "rejected") return "error";
  return "draft";
}

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

  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();

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
      errors.push(
        plansRes.reason instanceof Error ? plansRes.reason.message : "Could not load roster plans.",
      );
    }
    if (shiftsRes.status === "fulfilled") {
      setShifts(shiftsRes.value);
    } else {
      errors.push(
        shiftsRes.reason instanceof Error
          ? shiftsRes.reason.message
          : "Could not load shift definitions.",
      );
    }
    if (deptsRes.status === "fulfilled") {
      setDepartments(deptsRes.value ?? []);
    } else {
      errors.push(
        deptsRes.reason instanceof Error ? deptsRes.reason.message : "Could not load departments.",
      );
    }
    setError(errors.join(" "));
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function planAction(
    plan: RosterPlan,
    fn: (id: string) => Promise<unknown>,
    successMessage?: string,
  ) {
    setBusyId(plan.id);
    setError("");
    try {
      await fn(plan.id);
      await loadAll();
      if (successMessage) toast.success(successMessage);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Roster action failed.";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusyId(null);
    }
  }

  async function rejectPlan(plan: RosterPlan) {
    const ok = await confirm({
      title: `Reject roster ${plan.planNo}?`,
      message:
        "The plan will be returned to draft with a rejection note. Staff shifts will not be published.",
      confirmLabel: "Reject",
      danger: true,
      icon: "warning",
    });
    if (!ok) return;
    const reason = window.prompt(`Reason for rejecting roster ${plan.planNo}?`)?.trim();
    if (!reason) return;
    await planAction(
      plan,
      (id) =>
        apiFetch<unknown>(`/roster/plans/${id}/reject`, {
          method: "POST",
          body: JSON.stringify({ reason }),
        }),
      `Roster ${plan.planNo} rejected.`,
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
      toast.success("Roster plan generated.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not create the roster plan.";
      setError(msg);
      toast.error(msg);
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

  const assignmentsColumns = [
    {
      key: "staff",
      header: "Staff",
      render: (a: RosterAssignment) => <strong>{a.staffName || a.staffId}</strong>,
    },
    { key: "no", header: "Employee No", render: (a: RosterAssignment) => a.employeeNo || "—" },
    { key: "date", header: "Work Date", render: (a: RosterAssignment) => a.workDate },
    {
      key: "shift",
      header: "Shift",
      render: (a: RosterAssignment) => (
        <StatusBadge variant="submitted" label={a.shiftName || a.shiftCode} />
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}>
      <PageHeader
        title="Monthly Roster Planning & Daily Shift Governance"
        description="Automated monthly scheduling with approval workflow and constraint enforcement."
      />

      <TabNav
        tabs={[
          { key: "plans", label: "Roster Plans & Approvals" },
          { key: "generator", label: "Monthly Generator Engine" },
        ]}
        active={activeTab}
        onChange={(k) => setActiveTab(k as "plans" | "generator")}
      />

      {error && (
        <p
          role="alert"
          style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.danger }}
        >
          {error}
        </p>
      )}

      {loading && (
        <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>
          Loading roster data…
        </p>
      )}

      {!loading && activeTab === "plans" && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
          {plans.length === 0 && (
            <p style={{ color: theme.text.muted, fontSize: theme.fontSize.base }}>
              No roster plans yet. Use the Monthly Generator Engine to create one.
            </p>
          )}
          {plans.map((p) => (
            <Card key={p.id}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: theme.spacing["3"],
                  flexWrap: "wrap",
                  gap: theme.spacing["2"],
                }}
              >
                <div>
                  <span
                    style={{
                      fontWeight: theme.fontWeight.bold,
                      color: theme.text.primary,
                      fontSize: theme.fontSize.lg,
                    }}
                  >
                    {p.name}
                  </span>
                  <span
                    style={{
                      marginLeft: theme.spacing["3"],
                      fontSize: theme.fontSize.base,
                      color: theme.text.muted,
                    }}
                  >
                    {p.planNo} · v{p.version} · {p.departmentName || "—"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: theme.spacing["2"], alignItems: "center" }}>
                  <StatusBadge variant={planStatusBadge(p.status)} label={p.status} />
                  <span style={{ fontSize: theme.fontSize.base, color: theme.text.muted }}>
                    {p.startDate} → {p.endDate}
                  </span>
                </div>
              </div>

              {p.rejectedReason && (
                <p
                  style={{
                    margin: `0 0 ${theme.spacing["3"]}`,
                    fontSize: theme.fontSize.base,
                    color: theme.action.warning,
                    background: theme.surface.warning,
                    padding: `${theme.spacing["2"]} ${theme.spacing["3"]}`,
                    borderRadius: theme.radius.md,
                  }}
                >
                  Rejected: {p.rejectedReason}
                </p>
              )}

              {p.assignments.length === 0 ? (
                <p style={{ color: theme.text.muted, fontSize: theme.fontSize.base }}>
                  No assignments generated yet.
                </p>
              ) : (
                <div style={{ marginBottom: theme.spacing["3"] }}>
                  <DataTable
                    columns={assignmentsColumns}
                    rows={p.assignments}
                    rowKey={(a) => a.id}
                    dense
                  />
                </div>
              )}

              {p.unmet.length > 0 && (
                <div
                  style={{
                    background: theme.surface.error,
                    border: `1px solid ${theme.surface.errorBorder}`,
                    borderRadius: theme.radius.md,
                    padding: `${theme.spacing["2"]} ${theme.spacing["3"]}`,
                    fontSize: theme.fontSize.base,
                    color: theme.text.dangerStrong,
                    marginBottom: theme.spacing["3"],
                  }}
                >
                  <strong>Unmet requirements:</strong>{" "}
                  {p.unmet
                    .map((u) => `${u.shiftName || "shift"} (${u.assigned}/${u.required})`)
                    .join(", ")}
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  gap: theme.spacing["2"],
                  justifyContent: "flex-end",
                  flexWrap: "wrap",
                }}
              >
                {p.status === "draft" && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      loading={busyId === p.id}
                      onClick={() =>
                        planAction(
                          p,
                          (id) =>
                            apiFetch<unknown>(`/roster/plans/${id}/regenerate`, { method: "POST" }),
                          `Roster ${p.planNo} regenerated.`,
                        )
                      }
                    >
                      Regenerate
                    </Button>
                    <Button
                      size="sm"
                      loading={busyId === p.id}
                      style={{ background: theme.action.warning }}
                      onClick={() =>
                        planAction(
                          p,
                          (id) =>
                            apiFetch<unknown>(`/roster/plans/${id}/submit`, { method: "POST" }),
                          `Roster ${p.planNo} submitted for approval.`,
                        )
                      }
                    >
                      Submit for Approval
                    </Button>
                  </>
                )}
                {p.status === "submitted" && (
                  <>
                    <Button
                      size="sm"
                      loading={busyId === p.id}
                      style={{ background: theme.action.success }}
                      onClick={() =>
                        planAction(
                          p,
                          (id) =>
                            apiFetch<unknown>(`/roster/plans/${id}/approve`, { method: "POST" }),
                          `Roster ${p.planNo} approved and published.`,
                        )
                      }
                    >
                      Approve & Publish
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      loading={busyId === p.id}
                      onClick={() => rejectPlan(p)}
                    >
                      Reject
                    </Button>
                  </>
                )}
                {p.status === "approved" && (
                  <Button
                    size="sm"
                    variant="outline"
                    loading={busyId === p.id}
                    onClick={() =>
                      planAction(
                        p,
                        (id) => apiFetch<unknown>(`/roster/plans/${id}/amend`, { method: "POST" }),
                        `Roster ${p.planNo} amended — new draft created.`,
                      )
                    }
                  >
                    Amend (new draft)
                  </Button>
                )}
                {p.status === "rejected" && (
                  <span style={{ fontSize: theme.fontSize.base, color: theme.text.muted }}>
                    Rejected — create a new plan or amend.
                  </span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {!loading && activeTab === "generator" && (
        <Card style={{ maxWidth: 800 }}>
          <form
            onSubmit={handleCreatePlan}
            style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}
          >
            <h3 style={{ margin: 0, fontSize: theme.fontSize.lg, color: theme.text.primary }}>
              Automated Monthly Roster Generator
            </h3>
            <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>
              Creates a draft plan and generates assignments while enforcing rest periods, night
              rotation, and coverage requirements.
            </p>

            <div
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["4"] }}
            >
              <FormField label="Plan name">
                <Input
                  value={planForm.name}
                  onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })}
                  placeholder="e.g. September Nursing Roster"
                />
              </FormField>
              <FormField label="Department" required>
                <Select
                  required
                  value={planForm.departmentId}
                  onChange={(e) => setPlanForm({ ...planForm, departmentId: e.target.value })}
                >
                  <option value="">Select department…</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Start date" required>
                <Input
                  type="date"
                  required
                  value={planForm.startDate}
                  onChange={(e) => setPlanForm({ ...planForm, startDate: e.target.value })}
                />
              </FormField>
              <FormField label="End date" required>
                <Input
                  type="date"
                  required
                  value={planForm.endDate}
                  onChange={(e) => setPlanForm({ ...planForm, endDate: e.target.value })}
                />
              </FormField>
            </div>

            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: theme.spacing["2"],
                }}
              >
                <span
                  style={{
                    fontSize: theme.fontSize.base,
                    fontWeight: theme.fontWeight.semibold,
                    color: theme.text.secondary,
                  }}
                >
                  Shift requirements (staff needed per shift)
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setPlanForm((prev) => ({
                      ...prev,
                      requirements: [...prev.requirements, { shiftId: "", required: "1" }],
                    }))
                  }
                >
                  + Add Requirement
                </Button>
              </div>
              {planForm.requirements.length === 0 && (
                <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>
                  No shift requirements added yet.
                </p>
              )}
              {planForm.requirements.map((r, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    gap: theme.spacing["2"],
                    marginBottom: theme.spacing["2"],
                  }}
                >
                  <Select
                    value={r.shiftId}
                    onChange={(e) => setRequirement(idx, { shiftId: e.target.value })}
                    style={{ flex: 1 }}
                  >
                    <option value="">Select shift…</option>
                    {shifts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.startTime}–{s.endTime})
                      </option>
                    ))}
                  </Select>
                  <Input
                    type="number"
                    min={1}
                    value={r.required}
                    onChange={(e) => setRequirement(idx, { required: e.target.value })}
                    style={{ width: "5rem" }}
                    title="Required staff count"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setPlanForm((prev) => ({
                        ...prev,
                        requirements: prev.requirements.filter((_, i) => i !== idx),
                      }))
                    }
                    aria-label={`Remove requirement ${idx + 1}`}
                  >
                    ✕
                  </Button>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button type="submit" loading={saving} style={{ background: theme.action.success }}>
                Generate Roster Plan
              </Button>
            </div>
          </form>
        </Card>
      )}

      {confirmDialog}
    </div>
  );
}
