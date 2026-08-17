import { useEffect, useState, type FormEvent } from "react";
import { theme, Button, Card, DataTable, EmptyState, FormField, Input, Modal, PageHeader, Select, StatusBadge } from "@hims/ui";
import { apiFetch } from "../api/client";

interface PatientSummary {
  id: string;
  patientNo: string;
  registrationType: string;
  firstName: string;
  lastName: string;
  gender: string;
  dateOfBirth: string;
  phone: string;
}

interface TimelineEvent {
  id: string;
  eventType: string;
  summary: string;
  occurredAt: string;
}

const REGISTRATION_TYPES = [
  { value: "normal", label: "Normal" },
  { value: "antenatal", label: "Antenatal" },
  { value: "emergency", label: "Emergency" },
];

function regBadge(type: string) {
  if (type === "emergency") return <StatusBadge variant="error" label={type} />;
  if (type === "antenatal") return <StatusBadge variant="submitted" label={type} />;
  return <StatusBadge variant="approved" label={type} />;
}

export default function PatientsPage() {
  const [search, setSearch] = useState("");
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [selected, setSelected] = useState<PatientSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    gender: "Male",
    dateOfBirth: "",
    phone: "",
    registrationType: "normal",
  });

  // Debounced search against the real endpoint.
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setPatients([]);
      setError("");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const results = await apiFetch<PatientSummary[]>(
          `/patients/search?q=${encodeURIComponent(q)}`,
        );
        if (!cancelled) setPatients(results);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Search failed.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search, reload]);

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await apiFetch<unknown>("/patients", {
        method: "POST",
        body: JSON.stringify(formData),
      });
      setShowModal(false);
      setFormData({
        firstName: "",
        lastName: "",
        gender: "Male",
        dateOfBirth: "",
        phone: "",
        registrationType: "normal",
      });
      setReload((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not register patient.");
    } finally {
      setSaving(false);
    }
  }

  async function openEmr(p: PatientSummary) {
    setSelected(p);
    setTimeline([]);
    setError("");
    try {
      const events = await apiFetch<TimelineEvent[]>(`/patients/${p.id}/timeline`);
      setTimeline(events);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load timeline.");
    }
  }

  function fullName(p: PatientSummary) {
    return `${p.firstName} ${p.lastName}`.trim();
  }

  const columns = [
    { key: "no", header: "Patient No", render: (p: PatientSummary) => <strong style={{ color: theme.action.info }}>{p.patientNo}</strong> },
    { key: "name", header: "Full Name", render: (p: PatientSummary) => fullName(p) },
    { key: "type", header: "Type", render: (p: PatientSummary) => regBadge(p.registrationType) },
    {
      key: "gender",
      header: "Gender / DOB",
      render: (p: PatientSummary) => (p.dateOfBirth ? `${p.gender}, ${p.dateOfBirth}` : p.gender),
    },
    { key: "phone", header: "Phone", render: (p: PatientSummary) => p.phone || "—" },
    {
      key: "action",
      header: "Action",
      render: (p: PatientSummary) => (
        <Button size="sm" variant="outline" onClick={() => openEmr(p)}>
          View EMR
        </Button>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}>
      <PageHeader
        title="Patients Directory"
        description="Search the patient register and open electronic medical records."
        actions={<Button onClick={() => setShowModal(true)} icon={<span style={{ fontWeight: "bold" }}>+</span>}>Register Patient</Button>}
      />

      <div style={{ display: "flex", gap: theme.spacing["2"], alignItems: "center" }}>
        <Input
          type="text"
          placeholder="Search patient by name or patient number (e.g. E-1201)..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, maxWidth: 560 }}
        />
      </div>

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.danger }}>
          {error}
        </p>
      )}

      <Card>
        {!search.trim() && !loading ? (
          <EmptyState icon="search" description="Type at least one character to search patients." />
        ) : search.trim() && loading ? (
          <EmptyState icon="refresh" description="Searching…" />
        ) : search.trim() && !loading && patients.length === 0 && !error ? (
          <EmptyState icon="search" description={`No patients match “${search}”.`} />
        ) : (
          <DataTable columns={columns} rows={patients} rowKey={(p) => p.id} />
        )}
      </Card>

      <Modal
        open={showModal}
        title="Register New Patient"
        onClose={() => setShowModal(false)}
        width={520}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button type="submit" form="register-patient-form" loading={saving}>
              Save Registration
            </Button>
          </>
        }
      >
        <form id="register-patient-form" onSubmit={handleRegister} style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
          <FormField label="First name" required>
            <Input
              required
              value={formData.firstName}
              onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
            />
          </FormField>
          <FormField label="Last name" required>
            <Input
              required
              value={formData.lastName}
              onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
            />
          </FormField>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}>
            <FormField label="Registration type">
              <Select
                value={formData.registrationType}
                onChange={(e) => setFormData({ ...formData, registrationType: e.target.value })}
              >
                {REGISTRATION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Gender">
              <Select
                value={formData.gender}
                onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
              >
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </Select>
            </FormField>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}>
            <FormField label="Date of birth (YYYY-MM-DD)">
              <Input
                type="date"
                value={formData.dateOfBirth}
                onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
              />
            </FormField>
            <FormField label="Phone number">
              <Input
                type="text"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </FormField>
          </div>
        </form>
      </Modal>

      {selected && (
        <Card
          title={`Patient EMR Timeline — ${fullName(selected)} (${selected.patientNo})`}
          toolbar={
            <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
              Close
            </Button>
          }
        >
          {timeline.length === 0 ? (
            <EmptyState icon="file-text" description="No timeline events recorded yet." />
          ) : (
            <ul
              style={{
                margin: 0,
                paddingLeft: "1.25rem",
                display: "flex",
                flexDirection: "column",
                gap: theme.spacing["2"],
              }}
            >
              {timeline.map((ev) => (
                <li key={ev.id} style={{ fontSize: theme.fontSize.base, color: theme.text.secondary }}>
                  <strong>{ev.eventType}</strong> — {ev.summary}{" "}
                  <span style={{ color: theme.text.muted, fontSize: theme.fontSize.sm }}>
                    {new Date(ev.occurredAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
