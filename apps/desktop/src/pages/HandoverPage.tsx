import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  theme,
  Button,
  Card,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  StatusBadge,
  Textarea,
  useToast,
} from "@hims/ui";
import { apiFetch } from "../api/client";

interface Handover {
  id: string;
  handoverNo: string;
  outgoingStaffName: string;
  departmentName: string;
  shiftName: string;
  patientIds: string[];
  currentCondition: string;
  medications: string;
  pendingInvestigations: string;
  pendingOrders: string;
  importantObservations: string;
  tasks: string;
  incidents: string;
  instructions: string;
  status: string;
  acknowledgedByName: string;
  acknowledgedAt?: string;
  createdAt: string;
}

const EMPTY_FORM = {
  currentCondition: "",
  medications: "",
  pendingInvestigations: "",
  pendingOrders: "",
  importantObservations: "",
  tasks: "",
  incidents: "",
  instructions: "",
  patientIds: "",
};

export default function HandoverPage() {
  const [handovers, setHandovers] = useState<Handover[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const results = await apiFetch<Handover[]>("/handovers");
      setHandovers(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load handovers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.currentCondition.trim()) {
      setError("A summary of the current patient condition is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiFetch<unknown>("/handovers", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          patientIds: form.patientIds
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      setForm(EMPTY_FORM);
      await loadAll();
      toast.success("Handover submitted and signed.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save the handover.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function acknowledge(h: Handover) {
    setError("");
    try {
      await apiFetch<unknown>(`/handovers/${h.id}/acknowledge`, { method: "POST" });
      await loadAll();
      toast.success(`Handover ${h.handoverNo} acknowledged.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not acknowledge the handover.";
      setError(msg);
      toast.error(msg);
    }
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      <PageHeader
        title="Shift Handover Log"
        description="Manage clinical and administrative shift transitions securely across hospital units."
        badge={<StatusBadge variant="submitted" label="Active Shift Portal" />}
      />

      {error && (
        <p
          role="alert"
          style={{
            margin: `0 0 ${theme.spacing["4"]}`,
            fontSize: theme.fontSize.base,
            color: theme.text.danger,
          }}
        >
          {error}
        </p>
      )}

      {/* New Handover Form */}
      <Card title="Submit New Shift Handover" style={{ marginBottom: theme.spacing["8"] }}>
        <form
          onSubmit={handleSubmit}
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["4"] }}
        >
          <FormField label="Patient IDs (comma-separated, optional)">
            <Input
              type="text"
              value={form.patientIds}
              onChange={(e) => setForm({ ...form, patientIds: e.target.value })}
              placeholder="e.g. patient-uuid-1, patient-uuid-2"
            />
          </FormField>
          <FormField label="Medications (optional)">
            <Input
              type="text"
              value={form.medications}
              onChange={(e) => setForm({ ...form, medications: e.target.value })}
              placeholder="e.g. IV Ceftriaxone 1g BD"
            />
          </FormField>
          <div style={{ gridColumn: "span 2" }}>
            <FormField label="Current patient condition & critical notes" required>
              <Textarea
                rows={3}
                required
                value={form.currentCondition}
                onChange={(e) => setForm({ ...form, currentCondition: e.target.value })}
                placeholder="Summarize patient conditions, critical care steps taken..."
              />
            </FormField>
          </div>
          <FormField label="Pending investigations">
            <Input
              type="text"
              value={form.pendingInvestigations}
              onChange={(e) => setForm({ ...form, pendingInvestigations: e.target.value })}
              placeholder="e.g. Pending lab reports"
            />
          </FormField>
          <FormField label="Pending orders">
            <Input
              type="text"
              value={form.pendingOrders}
              onChange={(e) => setForm({ ...form, pendingOrders: e.target.value })}
              placeholder="e.g. Pending pharmacy orders"
            />
          </FormField>
          <FormField label="Important observations">
            <Input
              type="text"
              value={form.importantObservations}
              onChange={(e) => setForm({ ...form, importantObservations: e.target.value })}
            />
          </FormField>
          <FormField label="Outstanding tasks">
            <Input
              type="text"
              value={form.tasks}
              onChange={(e) => setForm({ ...form, tasks: e.target.value })}
            />
          </FormField>
          <FormField label="Incidents">
            <Input
              type="text"
              value={form.incidents}
              onChange={(e) => setForm({ ...form, incidents: e.target.value })}
            />
          </FormField>
          <FormField label="Instructions for incoming shift">
            <Input
              type="text"
              value={form.instructions}
              onChange={(e) => setForm({ ...form, instructions: e.target.value })}
            />
          </FormField>
          <div style={{ gridColumn: "span 2", display: "flex", justifyContent: "flex-end" }}>
            <Button type="submit" loading={saving} style={{ background: theme.action.success }}>
              Save & Sign Handover
            </Button>
          </div>
        </form>
      </Card>

      {/* Handover Logs List */}
      <h3
        style={{
          margin: `0 0 ${theme.spacing["4"]}`,
          fontSize: theme.fontSize.lg,
          fontWeight: theme.fontWeight.bold,
          color: theme.text.primary,
        }}
      >
        Recorded Shift Handovers
      </h3>
      {loading ? (
        <p style={{ color: theme.text.muted, fontSize: theme.fontSize.base }}>Loading handovers…</p>
      ) : handovers.length === 0 ? (
        <EmptyState icon="book" description="No handovers recorded yet." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
          {handovers.map((h) => (
            <Card key={h.id}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: theme.spacing["3"],
                  borderBottom: `1px solid ${theme.surface.border}`,
                  paddingBottom: theme.spacing["2"],
                  flexWrap: "wrap",
                  gap: theme.spacing["2"],
                }}
              >
                <div>
                  <span
                    style={{
                      fontWeight: theme.fontWeight.bold,
                      color: theme.text.primary,
                      fontSize: theme.fontSize.base,
                    }}
                  >
                    {h.handoverNo}
                  </span>
                  <span
                    style={{
                      marginLeft: theme.spacing["4"],
                      fontSize: theme.fontSize.base,
                      color: theme.text.muted,
                    }}
                  >
                    {h.shiftName ? `${h.shiftName} · ` : ""}
                    {h.departmentName || "—"} · {new Date(h.createdAt).toLocaleString()}
                  </span>
                </div>
                <StatusBadge
                  variant={h.status === "acknowledged" ? "approved" : "running"}
                  label={h.status}
                />
              </div>

              <div style={{ fontSize: theme.fontSize.base, marginBottom: theme.spacing["3"] }}>
                <strong>Outgoing:</strong> {h.outgoingStaffName || "—"}
                {h.acknowledgedByName && (
                  <span style={{ marginLeft: "1.5rem", color: theme.action.success }}>
                    <strong>Acknowledged by:</strong> {h.acknowledgedByName}
                  </span>
                )}
              </div>

              <div
                style={{
                  background: theme.surface.subtle,
                  padding: theme.spacing["3"],
                  borderRadius: theme.radius.md,
                  fontSize: theme.fontSize.base,
                  marginBottom: theme.spacing["2"],
                }}
              >
                <strong>Current Condition:</strong> {h.currentCondition || "—"}
              </div>

              {(h.medications ||
                h.pendingInvestigations ||
                h.pendingOrders ||
                h.importantObservations ||
                h.tasks ||
                h.incidents ||
                h.instructions) && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: theme.spacing["2"],
                    fontSize: theme.fontSize.base,
                    marginBottom: theme.spacing["2"],
                  }}
                >
                  {h.medications && <Detail label="Medications" value={h.medications} />}
                  {h.pendingInvestigations && (
                    <Detail label="Pending Investigations" value={h.pendingInvestigations} />
                  )}
                  {h.pendingOrders && <Detail label="Pending Orders" value={h.pendingOrders} />}
                  {h.importantObservations && (
                    <Detail label="Observations" value={h.importantObservations} />
                  )}
                  {h.tasks && <Detail label="Tasks" value={h.tasks} />}
                  {h.incidents && <Detail label="Incidents" value={h.incidents} />}
                  {h.instructions && <Detail label="Instructions" value={h.instructions} />}
                </div>
              )}

              {h.status !== "acknowledged" && (
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button
                    size="sm"
                    style={{ background: theme.action.success }}
                    onClick={() => acknowledge(h)}
                  >
                    Acknowledge Handover
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <strong>{label}:</strong> {value}
    </div>
  );
}
