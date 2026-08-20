import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  theme,
  Button,
  Card,
  Checkbox,
  DataTable,
  EmptyState,
  FormField,
  Input,
  Modal,
  PageHeader,
  Select,
  StatusBadge,
  TabNav,
  Textarea,
  useConfirm,
  useToast,
} from "@hims/ui";
import { apiFetch } from "../api/client";
import ChargePatientModal from "../components/ChargePatientModal";

interface PatientSummary {
  id: string;
  patientNo: string;
  registrationType: string;
  firstName: string;
  lastName: string;
  gender: string;
  dateOfBirth: string;
  phone: string;
  email?: string;
}

interface ClinicalEntry {
  id: string;
  section: string;
  summary: string;
  details: Record<string, unknown>;
  recordedBy?: string;
  createdAt: string;
  updatedAt: string;
}

interface DocumentMeta {
  id: string;
  documentType: string;
  title: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  uploadedBy?: string;
  createdAt: string;
}

interface TimelineEvent {
  id: string;
  eventType: string;
  summary: string;
  occurredAt: string;
}

interface PatientReport {
  id: string;
  reportType: string;
  title: string;
  content: string;
  authorId: string;
  departmentId?: string;
  createdAt: string;
}

interface PatientDetail extends PatientSummary {
  middleName: string;
  bloodGroup: string;
  genotype: string;
  maritalStatus: string;
  occupation: string;
  alternatePhone: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  identificationType: string;
  identificationNumber: string;
  nextOfKinName: string;
  nextOfKinRelationship: string;
  nextOfKinPhone: string;
  nextOfKinAddress: string;
  photoData?: string;
  photoContentType?: string;
  consentGiven: boolean;
  consentDate?: string;
  privacyNotes: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  clinical?: ClinicalEntry[];
}

const REGISTRATION_TYPES = [
  { value: "normal", label: "Normal" },
  { value: "antenatal", label: "Antenatal" },
  { value: "emergency", label: "Emergency" },
];

const BLOOD_GROUPS = ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const GENOTYPES = ["", "AA", "AS", "SS", "AC", "SC", "CC"];
const ID_TYPES = [
  "",
  "National ID",
  "Driver's License",
  "Passport",
  "Voter's Card",
  "NHIS Card",
  "Birth Certificate",
  "Other",
];

// Clinical-history sections captured at registration; stored via
// patient_clinical_entries (same sections the Clinical page uses).
const CLINICAL_SECTIONS = [
  { key: "chief_complaint", label: "Current Complaint", short: "Current complaint" },
  { key: "allergy", label: "Known Allergies", short: "Allergies" },
  { key: "medical_history", label: "Medical History", short: "Medical history" },
  { key: "surgical_history", label: "Surgical History", short: "Surgical history" },
  { key: "chronic_condition", label: "Chronic Conditions", short: "Chronic conditions" },
  { key: "medication", label: "Current Medications", short: "Current medications" },
  { key: "family_history", label: "Family History", short: "Family history" },
  { key: "social_history", label: "Social History", short: "Social history" },
];

const SECTION_LABELS: Record<string, string> = Object.fromEntries(
  CLINICAL_SECTIONS.map((s) => [s.key, s.short]),
);

const REPORT_TYPES = ["", "clinical", "progress", "discharge", "referral", "other"];

function regBadge(type: string) {
  if (type === "emergency") return <StatusBadge variant="error" label={type} />;
  if (type === "antenatal") return <StatusBadge variant="submitted" label={type} />;
  return <StatusBadge variant="approved" label={type} />;
}

function fullNameOf(p: { firstName: string; lastName: string; middleName?: string }) {
  return `${p.firstName} ${p.middleName ? p.middleName + " " : ""}${p.lastName}`.trim();
}

function emptyForm() {
  return {
    registrationType: "normal",
    firstName: "",
    lastName: "",
    middleName: "",
    gender: "Male",
    dateOfBirth: "",
    bloodGroup: "",
    genotype: "",
    maritalStatus: "",
    occupation: "",
    phone: "",
    alternatePhone: "",
    email: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
    identificationType: "",
    identificationNumber: "",
    nextOfKinName: "",
    nextOfKinRelationship: "",
    nextOfKinPhone: "",
    nextOfKinAddress: "",
    photoData: "",
    photoContentType: "",
    consentGiven: false,
    privacyNotes: "",
    clinical: Object.fromEntries(CLINICAL_SECTIONS.map((s) => [s.key, ""])),
  };
}

type FormState = ReturnType<typeof emptyForm>;

type RecordTab = "overview" | "complaint" | "clinical" | "reports" | "documents" | "timeline";

export default function PatientsPage() {
  const [search, setSearch] = useState("");
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [selected, setSelected] = useState<PatientDetail | null>(null);
  const [recordTab, setRecordTab] = useState<RecordTab>("overview");
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [reports, setReports] = useState<PatientReport[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [reload, setReload] = useState(0);
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();

  const [formData, setFormData] = useState<FormState>(emptyForm());
  const [editOpen, setEditOpen] = useState(false);
  const [editData, setEditData] = useState<FormState>(emptyForm());

  // Charge patient modal
  const [showCharge, setShowCharge] = useState(false);

  // Report form state.
  const [reportType, setReportType] = useState("");
  const [reportTitle, setReportTitle] = useState("");
  const [reportContent, setReportContent] = useState("");

  const set = (patch: Partial<FormState>) => setFormData((f) => ({ ...f, ...patch }));

  // Load all patients on mount; search narrows via the search endpoint.
  const loadDirectory = useCallback(async () => {
    const q = search.trim();
    setLoading(true);
    setError("");
    try {
      const results = await apiFetch<PatientSummary[]>(
        q ? `/patients/search?q=${encodeURIComponent(q)}` : "/patients?limit=200&offset=0",
      );
      setPatients(results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load patients.");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const timer = window.setTimeout(loadDirectory, search.trim() ? 300 : 0);
    return () => window.clearTimeout(timer);
    // loadDirectory is derived from search; listing search explicitly keeps the
    // effect dependency lint happy.
  }, [loadDirectory, reload, search]);

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const clinical = CLINICAL_SECTIONS.map((s) => ({
      section: s.key,
      summary: (formData.clinical[s.key] as string).trim(),
    })).filter((c) => c.summary !== "");
    try {
      const payload = { ...formData, clinical };
      await apiFetch<unknown>("/patients", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setShowModal(false);
      setFormData(emptyForm());
      setReload((n) => n + 1);
      toast.success("Patient registered.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not register patient.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function openProfile(p: PatientSummary) {
    setSelected(null);
    setRecordTab("overview");
    setDetailLoading(true);
    setError("");
    setDocuments([]);
    setTimeline([]);
    setReports([]);
    try {
      const [detail, docs, events, rep] = await Promise.all([
        apiFetch<PatientDetail>(`/patients/${p.id}`),
        apiFetch<DocumentMeta[]>(`/patients/${p.id}/documents`).catch(() => [] as DocumentMeta[]),
        apiFetch<TimelineEvent[]>(`/patients/${p.id}/timeline`).catch(() => [] as TimelineEvent[]),
        apiFetch<PatientReport[]>(`/patients/${p.id}/reports`).catch(() => [] as PatientReport[]),
      ]);
      setSelected(detail);
      setDocuments(docs ?? []);
      setTimeline(events ?? []);
      setReports(rep ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load patient record.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function openEdit() {
    if (!selected) return;
    const c = selected.clinical ?? [];
    const clinical = Object.fromEntries(
      CLINICAL_SECTIONS.map((s) => {
        const entry = c.find((e) => e.section === s.key);
        return [s.key, entry ? entry.summary : ""];
      }),
    );
    setEditData({
      registrationType: selected.registrationType,
      firstName: selected.firstName,
      lastName: selected.lastName,
      middleName: selected.middleName,
      gender: selected.gender,
      dateOfBirth: selected.dateOfBirth,
      bloodGroup: selected.bloodGroup,
      genotype: selected.genotype,
      maritalStatus: selected.maritalStatus,
      occupation: selected.occupation,
      phone: selected.phone,
      alternatePhone: selected.alternatePhone,
      email: selected.email,
      addressLine1: selected.addressLine1,
      addressLine2: selected.addressLine2,
      city: selected.city,
      state: selected.state,
      postalCode: selected.postalCode,
      country: selected.country,
      identificationType: selected.identificationType,
      identificationNumber: selected.identificationNumber,
      nextOfKinName: selected.nextOfKinName,
      nextOfKinRelationship: selected.nextOfKinRelationship,
      nextOfKinPhone: selected.nextOfKinPhone,
      nextOfKinAddress: selected.nextOfKinAddress,
      photoData: selected.photoData ?? "",
      photoContentType: selected.photoContentType ?? "",
      consentGiven: selected.consentGiven,
      privacyNotes: selected.privacyNotes,
      clinical,
    });
    setEditOpen(true);
  }

  const setEdit = (patch: Partial<FormState>) => setEditData((f) => ({ ...f, ...patch }));

  async function handleEdit(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    setError("");
    // Send every section (including cleared ones) so clearing a field in the
    // form empties it on the record; the form is pre-filled from current data.
    const clinical = CLINICAL_SECTIONS.map((s) => ({
      section: s.key,
      summary: (editData.clinical[s.key] as string).trim(),
    }));
    try {
      await apiFetch<unknown>(`/patients/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...editData, clinical }),
      });
      setEditOpen(false);
      toast.success("Patient record updated.");
      await openProfile(selected);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not update patient.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddReport(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    if (!reportTitle.trim() || !reportContent.trim()) {
      setError("Report title and content are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiFetch<unknown>(`/patients/${selected.id}/reports`, {
        method: "POST",
        body: JSON.stringify({
          reportType,
          title: reportTitle.trim(),
          content: reportContent.trim(),
        }),
      });
      setReportTitle("");
      setReportContent("");
      setReportType("");
      const rep = await apiFetch<PatientReport[]>(`/patients/${selected.id}/reports`);
      setReports(rep ?? []);
      toast.success("Report added.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not add report.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleSendToDoctor() {
    if (!selected) return;
    const ok = await confirm({
      title: `Send ${selected.patientNo} to doctor?`,
      message:
        "A review request with the patient's details will be sent to the doctor's task queue.",
      confirmLabel: "Send to Doctor",
      icon: "send",
    });
    if (!ok) return;
    setSending(true);
    setError("");
    const details = [
      `${fullNameOf(selected)} (${selected.patientNo})`,
      selected.gender ? `Gender: ${selected.gender}` : "",
      selected.dateOfBirth ? `DOB: ${selected.dateOfBirth}` : "",
      selected.phone ? `Phone: ${selected.phone}` : "",
      selected.email ? `Email: ${selected.email}` : "",
      selected.bloodGroup ? `Blood group: ${selected.bloodGroup}` : "",
      selected.genotype ? `Genotype: ${selected.genotype}` : "",
      (selected.clinical ?? [])
        .filter((c) => c.summary)
        .map((c) => `${SECTION_LABELS[c.section] || c.section}: ${c.summary}`)
        .join("\n"),
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await apiFetch<unknown>("/tasks", {
        method: "POST",
        body: JSON.stringify({
          patientId: selected.id,
          title: `Patient review requested: ${fullNameOf(selected)} (${selected.patientNo})`,
          description: `Patient details forwarded for review:\n${details}`,
        }),
      });
      toast.success("Patient details sent to the doctor's queue.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not send to doctor.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSending(false);
    }
  }

  const columns = [
    {
      key: "no",
      header: "Patient No",
      render: (p: PatientSummary) => (
        <strong style={{ color: theme.action.info }}>{p.patientNo}</strong>
      ),
    },
    { key: "name", header: "Full Name", render: (p: PatientSummary) => fullNameOf(p) },
    { key: "type", header: "Type", render: (p: PatientSummary) => regBadge(p.registrationType) },
    {
      key: "gender",
      header: "Gender / DOB",
      render: (p: PatientSummary) => (p.dateOfBirth ? `${p.gender}, ${p.dateOfBirth}` : p.gender),
    },
    { key: "phone", header: "Phone", render: (p: PatientSummary) => p.phone || "—" },
    { key: "email", header: "Email", render: (p: PatientSummary) => p.email || "—" },
    {
      key: "action",
      header: "Action",
      render: (p: PatientSummary) => (
        <Button size="sm" variant="outline" onClick={() => openProfile(p)}>
          View Record
        </Button>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}>
      <PageHeader
        title="Patients Directory"
        description="All registered patients. Search by name, email, phone, or patient number."
        actions={
          <Button
            onClick={() => setShowModal(true)}
            icon={<span style={{ fontWeight: "bold" }}>+</span>}
          >
            Register Patient
          </Button>
        }
      />

      <div style={{ display: "flex", gap: theme.spacing["2"], alignItems: "center" }}>
        <Input
          type="text"
          placeholder="Search by full name, email, phone, or patient number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, maxWidth: 560 }}
        />
        {search.trim() && (
          <Button size="sm" variant="ghost" onClick={() => setSearch("")}>
            Clear
          </Button>
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

      <Card>
        {loading ? (
          <EmptyState icon="refresh" description="Loading patients…" />
        ) : patients.length === 0 ? (
          <EmptyState
            icon="search"
            description={
              search.trim()
                ? `No patients match “${search}”.`
                : "No patients registered yet — click Register Patient to add the first one."
            }
          />
        ) : (
          <DataTable columns={columns} rows={patients} rowKey={(p) => p.id} />
        )}
      </Card>

      {/* Full intake registration modal */}
      <Modal
        open={showModal}
        title="Register New Patient"
        onClose={() => setShowModal(false)}
        width={880}
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
        <form
          id="register-patient-form"
          onSubmit={handleRegister}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: theme.spacing["4"],
            maxHeight: "60vh",
            overflowY: "auto",
            paddingRight: theme.spacing["1"],
          }}
        >
          <SectionTitle>Photo</SectionTitle>
          <PhotoPicker
            data={formData.photoData}
            contentType={formData.photoContentType}
            onChange={(data, contentType) =>
              set({ photoData: data, photoContentType: contentType })
            }
          />

          <SectionTitle>Personal Details</SectionTitle>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: theme.spacing["3"] }}
          >
            <FormField label="First name" required>
              <Input
                required
                value={formData.firstName}
                onChange={(e) => set({ firstName: e.target.value })}
              />
            </FormField>
            <FormField label="Middle name">
              <Input
                value={formData.middleName}
                onChange={(e) => set({ middleName: e.target.value })}
              />
            </FormField>
            <FormField label="Last name" required>
              <Input
                required
                value={formData.lastName}
                onChange={(e) => set({ lastName: e.target.value })}
              />
            </FormField>
          </div>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: theme.spacing["3"] }}
          >
            <FormField label="Registration type">
              <Select
                value={formData.registrationType}
                onChange={(e) => set({ registrationType: e.target.value })}
              >
                {REGISTRATION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Gender">
              <Select value={formData.gender} onChange={(e) => set({ gender: e.target.value })}>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </Select>
            </FormField>
            <FormField label="Date of birth">
              <Input
                type="date"
                value={formData.dateOfBirth}
                onChange={(e) => set({ dateOfBirth: e.target.value })}
              />
            </FormField>
          </div>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: theme.spacing["3"] }}
          >
            <FormField label="Blood group">
              <Select
                value={formData.bloodGroup}
                onChange={(e) => set({ bloodGroup: e.target.value })}
              >
                {BLOOD_GROUPS.map((b) => (
                  <option key={b || "none"} value={b}>
                    {b || "— select —"}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Genotype">
              <Select value={formData.genotype} onChange={(e) => set({ genotype: e.target.value })}>
                {GENOTYPES.map((g) => (
                  <option key={g || "none"} value={g}>
                    {g || "— select —"}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Marital status">
              <Select
                value={formData.maritalStatus}
                onChange={(e) => set({ maritalStatus: e.target.value })}
              >
                <option value="">— select —</option>
                <option value="Single">Single</option>
                <option value="Married">Married</option>
                <option value="Divorced">Divorced</option>
                <option value="Widowed">Widowed</option>
              </Select>
            </FormField>
          </div>
          <FormField label="Occupation">
            <Input
              value={formData.occupation}
              onChange={(e) => set({ occupation: e.target.value })}
            />
          </FormField>

          <SectionTitle>Contact &amp; Address</SectionTitle>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: theme.spacing["3"] }}
          >
            <FormField label="Phone number">
              <Input value={formData.phone} onChange={(e) => set({ phone: e.target.value })} />
            </FormField>
            <FormField label="Alternate phone">
              <Input
                value={formData.alternatePhone}
                onChange={(e) => set({ alternatePhone: e.target.value })}
              />
            </FormField>
            <FormField label="Email">
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => set({ email: e.target.value })}
              />
            </FormField>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}>
            <FormField label="Residential address (line 1)">
              <Input
                value={formData.addressLine1}
                onChange={(e) => set({ addressLine1: e.target.value })}
              />
            </FormField>
            <FormField label="Line 2">
              <Input
                value={formData.addressLine2}
                onChange={(e) => set({ addressLine2: e.target.value })}
              />
            </FormField>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr 1fr",
              gap: theme.spacing["3"],
            }}
          >
            <FormField label="City">
              <Input value={formData.city} onChange={(e) => set({ city: e.target.value })} />
            </FormField>
            <FormField label="State">
              <Input value={formData.state} onChange={(e) => set({ state: e.target.value })} />
            </FormField>
            <FormField label="Postal code">
              <Input
                value={formData.postalCode}
                onChange={(e) => set({ postalCode: e.target.value })}
              />
            </FormField>
            <FormField label="Country">
              <Input value={formData.country} onChange={(e) => set({ country: e.target.value })} />
            </FormField>
          </div>

          <SectionTitle>Identification</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}>
            <FormField label="Identification type">
              <Select
                value={formData.identificationType}
                onChange={(e) => set({ identificationType: e.target.value })}
              >
                {ID_TYPES.map((t) => (
                  <option key={t || "none"} value={t}>
                    {t || "— select —"}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Identification number">
              <Input
                value={formData.identificationNumber}
                onChange={(e) => set({ identificationNumber: e.target.value })}
              />
            </FormField>
          </div>

          <SectionTitle>Clinical History</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}>
            {CLINICAL_SECTIONS.map((s) => (
              <FormField key={s.key} label={s.label}>
                <Textarea
                  value={formData.clinical[s.key] as string}
                  onChange={(e) =>
                    set({ clinical: { ...formData.clinical, [s.key]: e.target.value } })
                  }
                  placeholder={s.short}
                />
              </FormField>
            ))}
          </div>

          <SectionTitle>Next of Kin / Emergency Contact</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}>
            <FormField label="Full name">
              <Input
                value={formData.nextOfKinName}
                onChange={(e) => set({ nextOfKinName: e.target.value })}
              />
            </FormField>
            <FormField label="Relationship">
              <Input
                value={formData.nextOfKinRelationship}
                onChange={(e) => set({ nextOfKinRelationship: e.target.value })}
              />
            </FormField>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}>
            <FormField label="Phone number">
              <Input
                value={formData.nextOfKinPhone}
                onChange={(e) => set({ nextOfKinPhone: e.target.value })}
              />
            </FormField>
            <FormField label="Address">
              <Input
                value={formData.nextOfKinAddress}
                onChange={(e) => set({ nextOfKinAddress: e.target.value })}
              />
            </FormField>
          </div>

          <SectionTitle>Consent &amp; Privacy</SectionTitle>
          <Checkbox
            label="Patient consents to treatment and to the storage of their records in this system."
            checked={formData.consentGiven}
            onChange={(e) => set({ consentGiven: e.target.checked })}
          />
          <FormField label="Privacy / consent notes">
            <Textarea
              value={formData.privacyNotes}
              onChange={(e) => set({ privacyNotes: e.target.value })}
              placeholder="e.g. consent limitations, data-sharing preferences, who may access this record"
            />
          </FormField>
        </form>
      </Modal>

      {/* Edit patient modal */}
      <Modal
        open={editOpen}
        title={selected ? `Edit Patient — ${selected.patientNo}` : "Edit Patient"}
        onClose={() => setEditOpen(false)}
        width={880}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="edit-patient-form" loading={saving}>
              Save Changes
            </Button>
          </>
        }
      >
        <form
          id="edit-patient-form"
          onSubmit={handleEdit}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: theme.spacing["4"],
            maxHeight: "60vh",
            overflowY: "auto",
            paddingRight: theme.spacing["1"],
          }}
        >
          <SectionTitle>Photo</SectionTitle>
          <PhotoPicker
            data={editData.photoData}
            contentType={editData.photoContentType}
            onChange={(data, contentType) =>
              setEdit({ photoData: data, photoContentType: contentType })
            }
          />

          <SectionTitle>Personal Details</SectionTitle>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: theme.spacing["3"] }}
          >
            <FormField label="First name" required>
              <Input
                required
                value={editData.firstName}
                onChange={(e) => setEdit({ firstName: e.target.value })}
              />
            </FormField>
            <FormField label="Middle name">
              <Input
                value={editData.middleName}
                onChange={(e) => setEdit({ middleName: e.target.value })}
              />
            </FormField>
            <FormField label="Last name" required>
              <Input
                required
                value={editData.lastName}
                onChange={(e) => setEdit({ lastName: e.target.value })}
              />
            </FormField>
          </div>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: theme.spacing["3"] }}
          >
            <FormField label="Gender">
              <Select value={editData.gender} onChange={(e) => setEdit({ gender: e.target.value })}>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </Select>
            </FormField>
            <FormField label="Date of birth">
              <Input
                type="date"
                value={editData.dateOfBirth}
                onChange={(e) => setEdit({ dateOfBirth: e.target.value })}
              />
            </FormField>
            <FormField label="Marital status">
              <Select
                value={editData.maritalStatus}
                onChange={(e) => setEdit({ maritalStatus: e.target.value })}
              >
                <option value="">— select —</option>
                <option value="Single">Single</option>
                <option value="Married">Married</option>
                <option value="Divorced">Divorced</option>
                <option value="Widowed">Widowed</option>
              </Select>
            </FormField>
          </div>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: theme.spacing["3"] }}
          >
            <FormField label="Blood group">
              <Select
                value={editData.bloodGroup}
                onChange={(e) => setEdit({ bloodGroup: e.target.value })}
              >
                {BLOOD_GROUPS.map((b) => (
                  <option key={b || "none"} value={b}>
                    {b || "— select —"}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Genotype">
              <Select
                value={editData.genotype}
                onChange={(e) => setEdit({ genotype: e.target.value })}
              >
                {GENOTYPES.map((g) => (
                  <option key={g || "none"} value={g}>
                    {g || "— select —"}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Occupation">
              <Input
                value={editData.occupation}
                onChange={(e) => setEdit({ occupation: e.target.value })}
              />
            </FormField>
          </div>

          <SectionTitle>Contact &amp; Address</SectionTitle>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: theme.spacing["3"] }}
          >
            <FormField label="Phone number">
              <Input value={editData.phone} onChange={(e) => setEdit({ phone: e.target.value })} />
            </FormField>
            <FormField label="Alternate phone">
              <Input
                value={editData.alternatePhone}
                onChange={(e) => setEdit({ alternatePhone: e.target.value })}
              />
            </FormField>
            <FormField label="Email">
              <Input
                type="email"
                value={editData.email}
                onChange={(e) => setEdit({ email: e.target.value })}
              />
            </FormField>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}>
            <FormField label="Residential address (line 1)">
              <Input
                value={editData.addressLine1}
                onChange={(e) => setEdit({ addressLine1: e.target.value })}
              />
            </FormField>
            <FormField label="Line 2">
              <Input
                value={editData.addressLine2}
                onChange={(e) => setEdit({ addressLine2: e.target.value })}
              />
            </FormField>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr 1fr",
              gap: theme.spacing["3"],
            }}
          >
            <FormField label="City">
              <Input value={editData.city} onChange={(e) => setEdit({ city: e.target.value })} />
            </FormField>
            <FormField label="State">
              <Input value={editData.state} onChange={(e) => setEdit({ state: e.target.value })} />
            </FormField>
            <FormField label="Postal code">
              <Input
                value={editData.postalCode}
                onChange={(e) => setEdit({ postalCode: e.target.value })}
              />
            </FormField>
            <FormField label="Country">
              <Input
                value={editData.country}
                onChange={(e) => setEdit({ country: e.target.value })}
              />
            </FormField>
          </div>

          <SectionTitle>Identification</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}>
            <FormField label="Identification type">
              <Select
                value={editData.identificationType}
                onChange={(e) => setEdit({ identificationType: e.target.value })}
              >
                {ID_TYPES.map((t) => (
                  <option key={t || "none"} value={t}>
                    {t || "— select —"}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Identification number">
              <Input
                value={editData.identificationNumber}
                onChange={(e) => setEdit({ identificationNumber: e.target.value })}
              />
            </FormField>
          </div>

          <SectionTitle>Clinical History</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}>
            {CLINICAL_SECTIONS.map((s) => (
              <FormField key={s.key} label={s.label}>
                <Textarea
                  value={editData.clinical[s.key] as string}
                  onChange={(e) =>
                    setEdit({ clinical: { ...editData.clinical, [s.key]: e.target.value } })
                  }
                  placeholder={s.short}
                />
              </FormField>
            ))}
          </div>

          <SectionTitle>Next of Kin / Emergency Contact</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}>
            <FormField label="Full name">
              <Input
                value={editData.nextOfKinName}
                onChange={(e) => setEdit({ nextOfKinName: e.target.value })}
              />
            </FormField>
            <FormField label="Relationship">
              <Input
                value={editData.nextOfKinRelationship}
                onChange={(e) => setEdit({ nextOfKinRelationship: e.target.value })}
              />
            </FormField>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}>
            <FormField label="Phone number">
              <Input
                value={editData.nextOfKinPhone}
                onChange={(e) => setEdit({ nextOfKinPhone: e.target.value })}
              />
            </FormField>
            <FormField label="Address">
              <Input
                value={editData.nextOfKinAddress}
                onChange={(e) => setEdit({ nextOfKinAddress: e.target.value })}
              />
            </FormField>
          </div>

          <SectionTitle>Consent &amp; Privacy</SectionTitle>
          <Checkbox
            label="Patient consents to treatment and to the storage of their records in this system."
            checked={editData.consentGiven}
            onChange={(e) => setEdit({ consentGiven: e.target.checked })}
          />
          <FormField label="Privacy / consent notes">
            <Textarea
              value={editData.privacyNotes}
              onChange={(e) => setEdit({ privacyNotes: e.target.value })}
            />
          </FormField>
        </form>
      </Modal>

      {/* Patient record view */}
      {selected && (
        <Modal
          open={true}
          title={`${fullNameOf(selected)} — ${selected.patientNo}`}
          onClose={() => setSelected(null)}
          width={940}
          footer={
            <div
              style={{
                display: "flex",
                gap: theme.spacing["2"],
                width: "100%",
                justifyContent: "flex-end",
              }}
            >
              <Button variant="outline" onClick={() => setSelected(null)}>
                Close
              </Button>
              <Button variant="outline" onClick={() => setShowCharge(true)}>
                Check Balance / Charge
              </Button>
              <Button variant="outline" onClick={openEdit}>
                Edit Patient
              </Button>
              <Button onClick={handleSendToDoctor} loading={sending}>
                Send to Doctor
              </Button>
            </div>
          }
        >
          {detailLoading ? (
            <EmptyState icon="refresh" description="Loading patient record…" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
              <div style={{ display: "flex", gap: theme.spacing["3"], alignItems: "center" }}>
                {selected.photoData ? (
                  <img
                    src={`data:${selected.photoContentType || "image/jpeg"};base64,${selected.photoData}`}
                    alt={`${fullNameOf(selected)} photo`}
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: "50%",
                      objectFit: "cover",
                      border: `2px solid ${theme.surface.borderStrong}`,
                      flexShrink: 0,
                    }}
                  />
                ) : null}
                <div style={{ display: "flex", gap: theme.spacing["2"], alignItems: "center" }}>
                  {regBadge(selected.registrationType)}
                  <StatusBadge
                    variant={selected.status === "active" ? "approved" : "error"}
                    label={selected.status}
                  />
                </div>
              </div>

              <TabNav
                tabs={[
                  { key: "overview", label: "Overview" },
                  { key: "complaint", label: "Current Complaint" },
                  { key: "clinical", label: "Clinical History" },
                  { key: "reports", label: "Reports & Notes" },
                  { key: "documents", label: "Documents" },
                  { key: "timeline", label: "Timeline" },
                ]}
                active={recordTab}
                onChange={(k) => setRecordTab(k as RecordTab)}
              />

              {recordTab === "overview" && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: theme.spacing["4"],
                    maxHeight: "60vh",
                    overflowY: "auto",
                    paddingRight: theme.spacing["1"],
                  }}
                >
                  <SectionTitle>Demographics</SectionTitle>
                  <InfoGrid
                    rows={[
                      ["Gender", selected.gender],
                      ["Date of birth", selected.dateOfBirth || "—"],
                      ["Blood group", selected.bloodGroup || "—"],
                      ["Genotype", selected.genotype || "—"],
                      ["Marital status", selected.maritalStatus || "—"],
                      ["Occupation", selected.occupation || "—"],
                    ]}
                  />
                  <SectionTitle>Contact</SectionTitle>
                  <InfoGrid
                    rows={[
                      ["Phone", selected.phone || "—"],
                      ["Alternate phone", selected.alternatePhone || "—"],
                      ["Email", selected.email || "—"],
                      [
                        "Address",
                        [
                          selected.addressLine1,
                          selected.addressLine2,
                          [selected.city, selected.state].filter(Boolean).join(", "),
                          [selected.postalCode, selected.country].filter(Boolean).join(" "),
                        ]
                          .filter(Boolean)
                          .join(", ") || "—",
                      ],
                    ]}
                  />
                  <SectionTitle>Identification</SectionTitle>
                  <InfoGrid
                    rows={[
                      ["Type", selected.identificationType || "—"],
                      ["Number", selected.identificationNumber || "—"],
                    ]}
                  />
                  <SectionTitle>Next of Kin / Emergency Contact</SectionTitle>
                  <InfoGrid
                    rows={[
                      ["Name", selected.nextOfKinName || "—"],
                      ["Relationship", selected.nextOfKinRelationship || "—"],
                      ["Phone", selected.nextOfKinPhone || "—"],
                      ["Address", selected.nextOfKinAddress || "—"],
                    ]}
                  />
                  <SectionTitle>Consent &amp; Privacy</SectionTitle>
                  <InfoGrid
                    rows={[
                      [
                        "Consent given",
                        selected.consentGiven
                          ? `Yes${selected.consentDate ? ` (${new Date(selected.consentDate).toLocaleDateString()})` : ""}`
                          : "No",
                      ],
                      ["Privacy notes", selected.privacyNotes || "—"],
                    ]}
                  />
                </div>
              )}

              {recordTab === "complaint" && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: theme.spacing["3"],
                    maxHeight: "60vh",
                    overflowY: "auto",
                    paddingRight: theme.spacing["1"],
                  }}
                >
                  <ClinicalEntries
                    entries={(selected.clinical ?? []).filter(
                      (c) => c.section === "chief_complaint",
                    )}
                    emptyText="No current complaint recorded for this patient."
                  />
                </div>
              )}

              {recordTab === "clinical" && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: theme.spacing["4"],
                    maxHeight: "60vh",
                    overflowY: "auto",
                    paddingRight: theme.spacing["1"],
                  }}
                >
                  {CLINICAL_SECTIONS.filter((s) => s.key !== "chief_complaint").map((s) => (
                    <div key={s.key}>
                      <SectionTitle>{s.label}</SectionTitle>
                      <ClinicalEntries
                        entries={(selected.clinical ?? []).filter((c) => c.section === s.key)}
                        emptyText={`No ${s.short.toLowerCase()} recorded.`}
                      />
                    </div>
                  ))}
                </div>
              )}

              {recordTab === "reports" && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: theme.spacing["4"],
                    maxHeight: "60vh",
                    overflowY: "auto",
                    paddingRight: theme.spacing["1"],
                  }}
                >
                  <Card title="Add Report / Note">
                    <form
                      onSubmit={handleAddReport}
                      style={{ display: "flex", flexDirection: "column", gap: theme.spacing["3"] }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: theme.spacing["3"],
                        }}
                      >
                        <FormField label="Report type">
                          <Select
                            value={reportType}
                            onChange={(e) => setReportType(e.target.value)}
                          >
                            {REPORT_TYPES.map((t) => (
                              <option key={t || "none"} value={t}>
                                {t || "— select —"}
                              </option>
                            ))}
                          </Select>
                        </FormField>
                        <FormField label="Title" required>
                          <Input
                            required
                            value={reportTitle}
                            onChange={(e) => setReportTitle(e.target.value)}
                            placeholder="e.g. Progress note, Referral summary"
                          />
                        </FormField>
                      </div>
                      <FormField label="Content / additional information" required>
                        <Textarea
                          required
                          rows={4}
                          value={reportContent}
                          onChange={(e) => setReportContent(e.target.value)}
                          placeholder="Write the report or additional notes here…"
                        />
                      </FormField>
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <Button type="submit" loading={saving}>
                          Add Report
                        </Button>
                      </div>
                    </form>
                  </Card>

                  <SectionTitle>Reports &amp; Notes</SectionTitle>
                  {reports.length === 0 ? (
                    <p
                      style={{ margin: 0, color: theme.text.muted, fontSize: theme.fontSize.base }}
                    >
                      No reports yet — add the first one above.
                    </p>
                  ) : (
                    <div
                      style={{ display: "flex", flexDirection: "column", gap: theme.spacing["3"] }}
                    >
                      {reports.map((r) => (
                        <Card key={r.id}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              gap: theme.spacing["2"],
                              flexWrap: "wrap",
                            }}
                          >
                            <strong style={{ color: theme.text.primary }}>{r.title}</strong>
                            <span style={{ color: theme.text.muted, fontSize: theme.fontSize.sm }}>
                              {r.reportType ? `${r.reportType} · ` : ""}
                              {new Date(r.createdAt).toLocaleString()}
                            </span>
                          </div>
                          <p
                            style={{
                              margin: `${theme.spacing["2"]} 0 0`,
                              whiteSpace: "pre-wrap",
                              color: theme.text.secondary,
                            }}
                          >
                            {r.content}
                          </p>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {recordTab === "documents" && (
                <div
                  style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: theme.spacing["1"] }}
                >
                  {documents.length === 0 ? (
                    <p
                      style={{ margin: 0, color: theme.text.muted, fontSize: theme.fontSize.base }}
                    >
                      No documents attached. (Scanned IDs / referral papers are attached here once
                      uploaded.)
                    </p>
                  ) : (
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: "1.25rem",
                        display: "flex",
                        flexDirection: "column",
                        gap: theme.spacing["1"],
                      }}
                    >
                      {documents.map((d) => (
                        <li
                          key={d.id}
                          style={{ fontSize: theme.fontSize.base, color: theme.text.secondary }}
                        >
                          <strong>{d.title}</strong>
                          {d.documentType ? ` (${d.documentType})` : ""} — {d.fileName || "—"}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {recordTab === "timeline" && (
                <div
                  style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: theme.spacing["1"] }}
                >
                  {timeline.length === 0 ? (
                    <p
                      style={{ margin: 0, color: theme.text.muted, fontSize: theme.fontSize.base }}
                    >
                      No timeline events yet.
                    </p>
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
                        <li
                          key={ev.id}
                          style={{ fontSize: theme.fontSize.base, color: theme.text.secondary }}
                        >
                          <strong>{ev.eventType}</strong> — {ev.summary}{" "}
                          <span style={{ color: theme.text.muted, fontSize: theme.fontSize.sm }}>
                            {new Date(ev.occurredAt).toLocaleString()}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {confirmDialog}

      <ChargePatientModal
        open={showCharge}
        onClose={() => setShowCharge(false)}
        preselectedPatient={selected ? { id: selected.id, patientNo: selected.patientNo, firstName: selected.firstName, lastName: selected.lastName } : null}
      />
    </div>
  );
}

function ClinicalEntries({ entries, emptyText }: { entries: ClinicalEntry[]; emptyText: string }) {
  if (entries.length === 0) {
    return (
      <p style={{ margin: 0, color: theme.text.muted, fontSize: theme.fontSize.base }}>
        {emptyText}
      </p>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["3"] }}>
      {entries.map((c) => (
        <Card key={c.id}>
          <p style={{ margin: 0, whiteSpace: "pre-wrap", color: theme.text.secondary }}>
            {c.summary}
          </p>
          <div
            style={{
              marginTop: theme.spacing["1"],
              fontSize: theme.fontSize.sm,
              color: theme.text.muted,
            }}
          >
            {new Date(c.createdAt).toLocaleString()}
          </div>
        </Card>
      ))}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        margin: 0,
        fontSize: theme.fontSize.base,
        fontWeight: theme.fontWeight.bold,
        color: theme.action.primary,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        borderBottom: `1px solid ${theme.surface.border}`,
        paddingBottom: theme.spacing["1"],
      }}
    >
      {children}
    </h3>
  );
}

function InfoGrid({ rows }: { rows: [string, string][] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["2"] }}>
      {rows.map(([label, value]) => (
        <div key={label} style={{ fontSize: theme.fontSize.base }}>
          <span style={{ color: theme.text.muted }}>{label}: </span>
          <span style={{ color: theme.text.primary }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Snap-or-upload photo control. Reads an image file (or camera capture),
 * downsizes it on a canvas to keep the stored payload small, and returns
 * base64 data plus its content type.
 */
function PhotoPicker({
  data,
  contentType,
  onChange,
}: {
  data: string;
  contentType: string;
  onChange: (data: string, contentType: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { dataUrl, mime } = await readImage(file);
      onChange(dataUrl, mime);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the image.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: theme.spacing["3"], flexWrap: "wrap" }}
    >
      {data ? (
        <img
          src={`data:${contentType || "image/jpeg"};base64,${data}`}
          alt="Patient photo preview"
          style={{
            width: 88,
            height: 88,
            borderRadius: "50%",
            objectFit: "cover",
            border: `2px solid ${theme.surface.borderStrong}`,
            flexShrink: 0,
          }}
        />
      ) : (
        <div
          style={{
            width: 88,
            height: 88,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: `2px dashed ${theme.surface.borderStrong}`,
            color: theme.text.muted,
            fontSize: theme.fontSize.sm,
            flexShrink: 0,
          }}
        >
          No photo
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["2"] }}>
        <div style={{ display: "flex", gap: theme.spacing["2"], flexWrap: "wrap" }}>
          <Button
            size="sm"
            variant="outline"
            loading={busy}
            onClick={() => fileRef.current?.click()}
          >
            Upload Image
          </Button>
          <Button
            size="sm"
            variant="outline"
            loading={busy}
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = "image/*";
              input.capture = "user"; // opens the camera where available
              input.onchange = () => handleFile(input.files?.[0]);
              input.click();
            }}
          >
            Take Photo
          </Button>
          {data ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onChange("", "")}>
              Remove
            </Button>
          ) : null}
        </div>
        <span style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
          Snap or upload a passport-style photo. Images are downscaled automatically.
        </span>
        {error ? (
          <span role="alert" style={{ fontSize: theme.fontSize.sm, color: theme.action.danger }}>
            {error}
          </span>
        ) : null}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
    </div>
  );
}

/** Reads an image file, downscales to at most 600px, and returns a JPEG/PNG base64 data URL. */
function readImage(file: File): Promise<{ dataUrl: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the image file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("The selected file is not a valid image."));
      img.onload = () => {
        const MAX = 600;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas is not supported here."));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
        const dataUrl = canvas.toDataURL(mime, 0.85).split(",")[1] ?? "";
        if (!dataUrl) {
          reject(new Error("Could not encode the image."));
          return;
        }
        resolve({ dataUrl, mime });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
