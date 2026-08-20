import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  theme,
  Button,
  Card,
  DataTable,
  EmptyState,
  Input,
  PageHeader,
  StatusBadge,
  TabNav,
  useToast,
  type StatusVariant,
} from "@hims/ui";
import { apiFetch } from "../api/client";
import ChargePatientModal from "../components/ChargePatientModal";

// ---------- interfaces ----------

interface Medicine {
  id: string;
  code: string;
  genericName: string;
  brand: string;
  strength: string;
  dosageForm: string;
  category: string;
  supplier: string;
  reorderLevel: number;
  storageLocation: string;
  unitCost: number;
  sellingPrice: number;
  active: boolean;
}

interface Batch {
  id: string;
  medicineId: string;
  batchNumber: string;
  manufacturingDate?: string;
  expiryDate?: string;
  quantityOnHand: number;
  purchaseCost: number;
  sellingPrice: number;
  supplier: string;
  status: string;
  receivedAt: string;
}

interface BatchFifo extends Batch {
  fifoPriority: number;
  totalStock: number;
}

interface Order {
  id: string;
  orderNo: string;
  patientId: string;
  patientName?: string;
  patientNo?: string;
  orderType: string;
  status: string;
  details: Record<string, unknown>;
  priority?: string;
  createdAt: string;
}

interface Dispensation {
  id: string;
  dispensationNo: string;
  prescriptionOrderId: string;
  patientId: string;
  dispensedBy: string;
  totalAmount: number;
  notes?: string;
  dispenseStatus: string;
  counselingNotes?: string;
  allergyCheckPassed: boolean;
  interactionCheckPassed: boolean;
  signOffBy?: string;
  signOffAt?: string;
  createdAt: string;
  items?: { medicineId: string; batchId: string; quantity: number; unitPrice: number }[];
}

interface LowStockItem {
  medicine: Medicine;
  totalQuantity: number;
}

interface AlertBatch extends Batch {
  medicineName: string;
  medicineCode: string;
}

interface PharmacyAlerts {
  lowStock: LowStockItem[];
  expiring: AlertBatch[];
  expired: AlertBatch[];
}

interface MedicineDetail {
  medicine: Medicine;
  batches: Batch[];
}

interface AllergyAlert {
  allergyId: string;
  summary: string;
  severity: string;
}

interface InteractionAlert {
  existingMedication: string;
  existingDose: string;
  warning: string;
  severity: string;
}

// ---------- helpers ----------

function batchStatusBadge(status: string): StatusVariant {
  if (status === "available" || status === "active") return "approved";
  if (status === "quarantined") return "error";
  return "draft";
}

function dispenseStatusBadge(status: string): StatusVariant {
  if (status === "dispensed") return "approved";
  if (status === "ready_for_pickup") return "running";
  return "draft";
}

function dispenseStatusLabel(status: string): string {
  if (status === "pending_verification") return "Pending Verification";
  if (status === "ready_for_pickup") return "Ready for Pickup";
  if (status === "dispensed") return "Dispensed";
  return status;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function isExpired(dateStr?: string): boolean {
  return !!dateStr && dateStr < today();
}

function isExpiringSoon(dateStr?: string, days = 30): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  const diff = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return diff > 0 && diff <= days;
}

// ---------- main component ----------

export default function PharmacyPage() {
  const [activeTab, setActiveTab] = useState<"dispense" | "inventory" | "history">("dispense");

  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [queue, setQueue] = useState<Order[]>([]);
  const [dispensations, setDispensations] = useState<Dispensation[]>([]);
  const [alerts, setAlerts] = useState<PharmacyAlerts | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const toast = useToast();

  // Charge patient modal
  const [showCharge, setShowCharge] = useState(false);

  // Drawer state
  const [drawerOrder, setDrawerOrder] = useState<Order | null>(null);
  const [drawerMedicine, setDrawerMedicine] = useState<Medicine | null>(null);
  const [drawerBatches, setDrawerBatches] = useState<BatchFifo[]>([]);
  const [drawerAllergies, setDrawerAllergies] = useState<AllergyAlert[]>([]);
  const [drawerInteractions, setDrawerInteractions] = useState<InteractionAlert[]>([]);
  const [drawerQty, setDrawerQty] = useState("");
  const [drawerBatchId, setDrawerBatchId] = useState("");
  const [drawerCounseling, setDrawerCounseling] = useState("");
  const [drawerAllergyChecked, setDrawerAllergyChecked] = useState(false);
  const [drawerInteractionChecked, setDrawerInteractionChecked] = useState(false);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState("");

  // Inventory search
  const [inventorySearch, setInventorySearch] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [meds, queueRes, dispRes, alertsRes] = await Promise.allSettled([
      apiFetch<Medicine[]>("/pharmacy/medicines"),
      apiFetch<Order[]>("/orders/actionable"),
      apiFetch<Dispensation[]>("/pharmacy/dispensations"),
      apiFetch<PharmacyAlerts>("/pharmacy/alerts"),
    ]);

    const errors: string[] = [];
    if (meds.status === "fulfilled") {
      setMedicines(meds.value);
    } else {
      errors.push(meds.reason instanceof Error ? meds.reason.message : "Could not load medicines.");
    }
    if (queueRes.status === "fulfilled") {
      setQueue(queueRes.value.filter((o) => o.orderType === "prescription"));
    } else {
      errors.push(
        queueRes.reason instanceof Error
          ? queueRes.reason.message
          : "Could not load the dispensing queue.",
      );
    }
    if (dispRes.status === "fulfilled") {
      setDispensations(dispRes.value);
    } else {
      errors.push(
        dispRes.reason instanceof Error ? dispRes.reason.message : "Could not load dispensations.",
      );
    }
    if (alertsRes.status === "fulfilled") {
      setAlerts(alertsRes.value);
    } else {
      errors.push(
        alertsRes.reason instanceof Error
          ? alertsRes.reason.message
          : "Could not load stock alerts.",
      );
    }

    setError(errors.join(" "));
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // --- medicine lookup ---
  function findMedicine(medication: string): Medicine | undefined {
    const q = medication.trim().toLowerCase();
    if (!q) return undefined;
    return (
      medicines.find((m) => m.genericName.trim().toLowerCase() === q) ||
      medicines.find((m) => m.brand.trim().toLowerCase() === q) ||
      medicines.find((m) => m.genericName.trim().toLowerCase().includes(q)) ||
      medicines.find((m) => `${m.genericName} ${m.strength}`.trim().toLowerCase().includes(q))
    );
  }

  // --- open dispense drawer ---
  async function openDrawer(order: Order) {
    const medication = String(order.details?.medication ?? "").trim();
    const medicine = findMedicine(medication);
    if (!medicine) {
      toast.error(`No medicine master record matches "${medication}". Register it in the inventory tab first.`);
      return;
    }

    setDrawerOrder(order);
    setDrawerMedicine(medicine);
    setDrawerQty("");
    setDrawerBatchId("");
    setDrawerCounseling("");
    setDrawerAllergyChecked(false);
    setDrawerInteractionChecked(false);
    setDrawerError("");
    setDrawerBatches([]);
    setDrawerAllergies([]);
    setDrawerInteractions([]);
    setDrawerLoading(true);

    // Load batches, allergies, interactions in parallel
    const [batchRes, allergyRes, interactionRes] = await Promise.allSettled([
      apiFetch<BatchFifo[]>(`/pharmacy/medicines/${medicine.id}/batches/fifo`),
      apiFetch<{ allergies: AllergyAlert[]; count: number }>(`/pharmacy/check-allergies?patientId=${order.patientId}`),
      apiFetch<{ interactions: InteractionAlert[]; count: number }>(`/pharmacy/check-interactions?patientId=${order.patientId}&medication=${encodeURIComponent(medication)}`),
    ]);

    if (batchRes.status === "fulfilled") {
      setDrawerBatches(batchRes.value);
      if (batchRes.value.length > 0) {
        setDrawerBatchId(batchRes.value[0].id); // FIFO default
      }
    }
    if (allergyRes.status === "fulfilled") {
      setDrawerAllergies(allergyRes.value.allergies);
    }
    if (interactionRes.status === "fulfilled") {
      setDrawerInteractions(interactionRes.value.interactions);
    }

    setDrawerLoading(false);
  }

  function closeDrawer() {
    setDrawerOrder(null);
    setDrawerMedicine(null);
  }

  // --- dispense from drawer ---
  async function handleDrawerDispense() {
    if (!drawerOrder || !drawerMedicine) return;
    const quantity = Number(drawerQty);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setDrawerError("Enter a valid quantity to dispense.");
      return;
    }
    if (!drawerBatchId) {
      setDrawerError("Select a batch to dispense from.");
      return;
    }
    if (!drawerAllergyChecked) {
      setDrawerError("You must confirm the allergy check before dispensing.");
      return;
    }
    if (!drawerInteractionChecked && drawerInteractions.length > 0) {
      setDrawerError("You must confirm the drug interaction check before dispensing.");
      return;
    }

    setDrawerLoading(true);
    setDrawerError("");
    try {
      await apiFetch<Dispensation>("/pharmacy/dispense/enhanced", {
        method: "POST",
        body: JSON.stringify({
          orderId: drawerOrder.id,
          items: [{ medicineId: drawerMedicine.id, quantity }],
          notes: "",
          allergyCheckPassed: drawerAllergyChecked,
          interactionCheckPassed: drawerInteractionChecked,
          counselingNotes: drawerCounseling,
          dispenseStatus: "pending_verification",
        }),
      });
      toast.success(`Dispensed ${quantity} x ${drawerMedicine.genericName}. Awaiting pharmacist verification.`);
      closeDrawer();
      await loadAll();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Dispense failed.";
      setDrawerError(msg);
      toast.error(msg);
    } finally {
      setDrawerLoading(false);
    }
  }

  // --- status transitions ---
  async function handleStatusTransition(disp: Dispensation, newStatus: string) {
    try {
      await apiFetch<Dispensation>(`/pharmacy/dispensations/${disp.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
      toast.success(`Status updated to ${dispenseStatusLabel(newStatus)}.`);
      await loadAll();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Status update failed.";
      toast.error(msg);
    }
  }

  // --- derived data ---
  const lowStockCount = alerts?.lowStock.length ?? 0;
  const pendingCount = queue.length;
  const pendingVerificationCount = dispensations.filter((d) => d.dispenseStatus === "pending_verification").length;

  const filteredMedicines = inventorySearch.trim()
    ? medicines.filter((m) => {
        const q = inventorySearch.toLowerCase();
        return (
          m.genericName.toLowerCase().includes(q) ||
          m.brand.toLowerCase().includes(q) ||
          m.code.toLowerCase().includes(q) ||
          m.category.toLowerCase().includes(q)
        );
      })
    : medicines;

  // --- queue columns ---
  const queueColumns = [
    {
      key: "order",
      header: "Order No",
      render: (o: Order) => <strong style={{ color: theme.action.info }}>{o.orderNo}</strong>,
    },
    {
      key: "patient",
      header: "Patient",
      render: (o: Order) => (
        <div>
          <div style={{ fontWeight: theme.fontWeight.semibold, color: theme.text.primary }}>
            {o.patientName || "Unknown Patient"}
          </div>
          <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, fontFamily: "monospace" }}>
            {o.patientNo || o.patientId.slice(0, 8)}
          </div>
        </div>
      ),
    },
    {
      key: "medication",
      header: "Prescribed Medication",
      render: (o: Order) => {
        const medication = String(o.details?.medication ?? "");
        const matched = findMedicine(medication);
        return (
          <div>
            <div style={{ fontWeight: theme.fontWeight.semibold, color: theme.text.secondary }}>
              {medication || "---"}
            </div>
            {matched && (
              <div style={{ fontSize: theme.fontSize.sm, color: theme.action.info, fontWeight: theme.fontWeight.semibold }}>
                Stock ref: {matched.code} | {matched.strength || matched.dosageForm}
              </div>
            )}
            {!matched && (
              <div style={{ fontSize: theme.fontSize.sm, color: theme.action.warning, fontWeight: theme.fontWeight.semibold }}>
                No matching medicine master record
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: "instructions",
      header: "Instructions",
      render: (o: Order) => {
        const dosage = String(o.details?.dosage ?? "");
        const frequency = String(o.details?.frequency ?? "");
        const durationDays = o.details?.durationDays;
        return (
          [dosage, frequency, durationDays != null ? `${durationDays} days` : ""]
            .filter(Boolean)
            .join(" | ") || "---"
        );
      },
    },
    {
      key: "priority",
      header: "Priority",
      render: (o: Order) => {
        const p = o.priority || "routine";
        const colors: Record<string, string> = { routine: "#34d399", urgent: "#fbbf24", stat: "#f87171" };
        return (
          <span style={{ fontSize: theme.fontSize.xs, padding: "2px 8px", borderRadius: 4, background: (colors[p] || "#34d399") + "22", color: colors[p] || "#34d399", fontWeight: 600, textTransform: "uppercase" }}>
            {p}
          </span>
        );
      },
    },
    {
      key: "action",
      header: "Action",
      render: (o: Order) => (
        <Button size="sm" style={{ background: theme.action.info }} onClick={() => openDrawer(o)}>
          Open Dispense
        </Button>
      ),
    },
  ];

  // --- inventory columns ---
  const medicineColumns = [
    {
      key: "code",
      header: "Code",
      render: (m: Medicine) => <strong style={{ color: theme.text.secondary, fontFamily: "monospace" }}>{m.code}</strong>,
    },
    {
      key: "name",
      header: "Medication & Category",
      render: (m: Medicine) => {
        const low = alerts?.lowStock.find((l) => l.medicine.id === m.id);
        const totalStock = alerts?.lowStock.find((l) => l.medicine.id === m.id)?.totalQuantity;
        return (
          <div>
            <div style={{ fontWeight: theme.fontWeight.semibold, color: theme.text.primary }}>
              {m.genericName}
              {m.brand ? ` (${m.brand})` : ""}
            </div>
            <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
              {m.category || "Uncategorised"} | {m.storageLocation || "---"}
            </div>
            {low && totalStock !== undefined && (
              <StatusBadge variant="error" label={`LOW STOCK: ${totalStock} units`} />
            )}
          </div>
        );
      },
    },
    {
      key: "strength",
      header: "Strength / Form",
      render: (m: Medicine) => (m.strength || "---") + (m.dosageForm ? `, ${m.dosageForm}` : ""),
    },
    { key: "reorder", header: "Reorder Level", render: (m: Medicine) => m.reorderLevel },
    {
      key: "price",
      header: "Unit Price (NGN)",
      render: (m: Medicine) => <strong>{m.sellingPrice.toLocaleString()}</strong>,
    },
    {
      key: "status",
      header: "Status",
      render: (m: Medicine) => {
        const low = alerts?.lowStock.find((l) => l.medicine.id === m.id);
        if (low) return <StatusBadge variant="error" label="Low Stock" />;
        if (!m.active) return <StatusBadge variant="draft" label="Inactive" />;
        return <StatusBadge variant="approved" label="Normal" />;
      },
    },
  ];

  // --- history columns ---
  const historyColumns = [
    {
      key: "dispNo",
      header: "Dispensation No",
      render: (d: Dispensation) => <strong style={{ color: theme.action.info }}>{d.dispensationNo}</strong>,
    },
    {
      key: "orderNo",
      header: "Order No",
      render: (d: Dispensation) => <span style={{ fontFamily: "monospace", fontSize: theme.fontSize.sm }}>{d.prescriptionOrderId.slice(0, 8)}...</span>,
    },
    {
      key: "total",
      header: "Total (NGN)",
      render: (d: Dispensation) => <strong>{d.totalAmount.toLocaleString()}</strong>,
    },
    {
      key: "status",
      header: "Status",
      render: (d: Dispensation) => (
        <StatusBadge variant={dispenseStatusBadge(d.dispenseStatus)} label={dispenseStatusLabel(d.dispenseStatus)} />
      ),
    },
    {
      key: "signoff",
      header: "Sign-off",
      render: (d: Dispensation) => d.signOffBy ? (
        <div style={{ fontSize: theme.fontSize.sm, color: theme.text.secondary }}>
          Signed | {d.signOffAt ? new Date(d.signOffAt).toLocaleString() : ""}
        </div>
      ) : <span style={{ color: theme.text.muted }}>---</span>,
    },
    {
      key: "actions",
      header: "Actions",
      render: (d: Dispensation) => {
        if (d.dispenseStatus === "pending_verification") {
          return (
            <Button size="sm" style={{ background: theme.action.success }} onClick={() => handleStatusTransition(d, "ready_for_pickup")}>
              Verify & Release
            </Button>
          );
        }
        if (d.dispenseStatus === "ready_for_pickup") {
          return (
            <Button size="sm" style={{ background: theme.action.info }} onClick={() => handleStatusTransition(d, "dispensed")}>
              Mark Dispensed
            </Button>
          );
        }
        return <StatusBadge variant="approved" label="Completed" />;
      },
    },
    {
      key: "date",
      header: "Date",
      render: (d: Dispensation) => new Date(d.createdAt).toLocaleString(),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}>
      <PageHeader
        title="Pharmacy Dispense"
        description="Prescription dispensing queue, drug stock and batch control."
        actions={
          <Button variant="outline" onClick={() => setShowCharge(true)}>
            Charge Patient
          </Button>
        }
      />

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: theme.spacing["4"] }}>
        <Kpi label="Pending Dispense" value={pendingCount} color={theme.action.info} />
        <Kpi label="Pending Verification" value={pendingVerificationCount} color={theme.action.warning} />
        <Kpi label="Low Stock Alerts" value={lowStockCount} color={lowStockCount > 0 ? theme.action.danger : theme.action.success} />
        <Kpi label="Medicines on File" value={medicines.length} color={theme.action.secondary} />
        <Kpi label="Dispensed Total" value={dispensations.length} color={theme.action.success} />
      </div>

      <TabNav
        tabs={[
          { key: "dispense", label: "Prescription Dispensing Queue" },
          { key: "inventory", label: "Drug Stock & Batch Control" },
          { key: "history", label: "Dispensation History" },
        ]}
        active={activeTab}
        onChange={(k) => setActiveTab(k as "dispense" | "inventory" | "history")}
      />

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.danger }}>
          {error}
        </p>
      )}

      {loading && (
        <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>
          Loading pharmacy data...
        </p>
      )}

      {/* Tab 1: Dispensing Queue */}
      {!loading && activeTab === "dispense" && (
        <Card bodyStyle={{ padding: 0 }}>
          {queue.length === 0 ? (
            <EmptyState icon="pill" description="No prescriptions awaiting dispensing." />
          ) : (
            <DataTable columns={queueColumns} rows={queue} rowKey={(o) => o.id} dense />
          )}
        </Card>
      )}

      {/* Tab 2: Inventory & Stock Control */}
      {!loading && activeTab === "inventory" && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
          {alerts && (alerts.expiring.length > 0 || alerts.expired.length > 0) && (
            <div style={{ background: theme.surface.warning, border: `1px solid ${theme.surface.warningBorder}`, borderRadius: theme.radius.lg, padding: theme.spacing["4"] }}>
              <div style={{ fontSize: theme.fontSize.sm, color: theme.text.warning, fontWeight: theme.fontWeight.bold, marginBottom: theme.spacing["2"] }}>
                EXPIRY WATCH
              </div>
              {alerts.expired.map((b) => (
                <div key={b.id} style={{ fontSize: theme.fontSize.base, color: theme.text.danger }}>
                  * <strong>EXPIRED</strong> -- {b.medicineName} ({b.medicineCode}), batch {b.batchNumber}, expiry {b.expiryDate ?? "unknown"}, {b.quantityOnHand} units
                </div>
              ))}
              {alerts.expiring.map((b) => (
                <div key={b.id} style={{ fontSize: theme.fontSize.base, color: theme.text.warning }}>
                  * Expiring soon -- {b.medicineName} ({b.medicineCode}), batch {b.batchNumber}, expiry {b.expiryDate ?? "unknown"}, {b.quantityOnHand} units
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: theme.spacing["3"], alignItems: "center" }}>
            <Input
              placeholder="Search medicines by name, code, or category..."
              value={inventorySearch}
              onChange={(e) => setInventorySearch(e.target.value)}
              style={{ flex: 1, maxWidth: "24rem" }}
            />
            {inventorySearch && (
              <Button size="sm" onClick={() => setInventorySearch("")}>
                Clear
              </Button>
            )}
          </div>

          <Card bodyStyle={{ padding: 0 }}>
            {filteredMedicines.length === 0 ? (
              <EmptyState icon="box" description={inventorySearch ? "No medicines match your search." : "No medicines on file yet."} />
            ) : (
              <DataTable
                columns={medicineColumns}
                rows={filteredMedicines}
                rowKey={(m) => m.id}
                dense
                expandable={(m) => <BatchDetailView medicine={m} />}
              />
            )}
          </Card>
        </div>
      )}

      {/* Tab 3: Dispensation History */}
      {!loading && activeTab === "history" && (
        <Card bodyStyle={{ padding: 0 }}>
          {dispensations.length === 0 ? (
            <EmptyState icon="clipboard" description="No dispensations recorded yet." />
          ) : (
            <DataTable columns={historyColumns} rows={dispensations} rowKey={(d) => d.id} dense />
          )}
        </Card>
      )}

      {/* Dispense Action Drawer */}
      {drawerOrder && drawerMedicine && (
        <div style={drawerOverlayStyle} onClick={(e) => { if (e.target === e.currentTarget) closeDrawer(); }}>
          <div style={drawerPanelStyle}>
            {/* Drawer Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing["4"] }}>
              <div>
                <h2 style={{ margin: 0, fontSize: theme.fontSize.xl, fontWeight: theme.fontWeight.bold, color: theme.text.primary }}>
                  Dispense Prescription
                </h2>
                <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                  {drawerOrder.orderNo} | {drawerMedicine.genericName} ({drawerMedicine.code})
                </div>
              </div>
              <Button size="sm" onClick={closeDrawer}>Close</Button>
            </div>

            {/* Patient & Allergy Safety Banner */}
            <div style={{ background: drawerAllergies.length > 0 ? "#FEF2F2" : "#F0FDF4", border: `1px solid ${drawerAllergies.length > 0 ? "#FECACA" : "#BBF7D0"}`, borderRadius: theme.radius.lg, padding: theme.spacing["3"], marginBottom: theme.spacing["4"] }}>
              <div style={{ fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.bold, color: drawerAllergies.length > 0 ? theme.text.danger : theme.action.success, marginBottom: theme.spacing["1"] }}>
                {drawerAllergies.length > 0 ? "ALLERGY ALERT" : "ALLERGY CHECK"}
              </div>
              <div style={{ fontSize: theme.fontSize.base, color: theme.text.primary, fontWeight: theme.fontWeight.semibold }}>
                Patient: {drawerOrder.patientName || "Unknown"} | ID: {drawerOrder.patientNo || drawerOrder.patientId.slice(0, 8)}
              </div>
              {drawerAllergies.length > 0 && (
                <div style={{ marginTop: theme.spacing["2"] }}>
                  {drawerAllergies.map((a) => (
                    <div key={a.allergyId} style={{ fontSize: theme.fontSize.sm, color: theme.text.danger }}>
                      * {a.summary} {a.severity ? `(${a.severity})` : ""}
                    </div>
                  ))}
                </div>
              )}
              {drawerAllergies.length === 0 && (
                <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, marginTop: theme.spacing["1"] }}>
                  No known allergies recorded for this patient.
                </div>
              )}
            </div>

            {/* Drug Interaction Alerts */}
            {drawerInteractions.length > 0 && (
              <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: theme.radius.lg, padding: theme.spacing["3"], marginBottom: theme.spacing["4"] }}>
                <div style={{ fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.bold, color: theme.text.warning, marginBottom: theme.spacing["1"] }}>
                  DRUG INTERACTION WARNING
                </div>
                {drawerInteractions.map((ia, idx) => (
                  <div key={idx} style={{ fontSize: theme.fontSize.sm, color: theme.text.secondary, marginBottom: theme.spacing["1"] }}>
                    * {ia.severity.toUpperCase()}: {drawerMedicine.genericName} + {ia.existingMedication} -- {ia.warning}
                  </div>
                ))}
              </div>
            )}

            {/* Prescription Details */}
            <div style={{ background: theme.surface.card, border: `1px solid ${theme.surface.border}`, borderRadius: theme.radius.lg, padding: theme.spacing["4"], marginBottom: theme.spacing["4"] }}>
              <div style={{ fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.bold, color: theme.text.muted, marginBottom: theme.spacing["2"] }}>
                PRESCRIPTION DETAILS
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["2"] }}>
                <div>
                  <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>Medication</div>
                  <div style={{ fontWeight: theme.fontWeight.semibold, color: theme.text.primary }}>{drawerMedicine.genericName} {drawerMedicine.strength}</div>
                </div>
                <div>
                  <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>Form</div>
                  <div style={{ fontWeight: theme.fontWeight.semibold, color: theme.text.primary }}>{drawerMedicine.dosageForm || "---"}</div>
                </div>
                <div>
                  <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>Dosage</div>
                  <div style={{ fontWeight: theme.fontWeight.semibold, color: theme.text.primary }}>{String(drawerOrder.details?.dosage ?? "---")}</div>
                </div>
                <div>
                  <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>Frequency</div>
                  <div style={{ fontWeight: theme.fontWeight.semibold, color: theme.text.primary }}>{String(drawerOrder.details?.frequency ?? "---")}</div>
                </div>
                <div>
                  <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>Duration</div>
                  <div style={{ fontWeight: theme.fontWeight.semibold, color: theme.text.primary }}>{drawerOrder.details?.durationDays ? `${drawerOrder.details.durationDays} days` : "---"}</div>
                </div>
                <div>
                  <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>Unit Price</div>
                  <div style={{ fontWeight: theme.fontWeight.semibold, color: theme.text.primary }}>NGN {drawerMedicine.sellingPrice.toLocaleString()}</div>
                </div>
              </div>
            </div>

            {drawerLoading && (
              <p style={{ fontSize: theme.fontSize.base, color: theme.text.muted }}>Loading batch and safety data...</p>
            )}

            {/* Batch & Expiry Selection */}
            {!drawerLoading && (
              <div style={{ marginBottom: theme.spacing["4"] }}>
                <div style={{ fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.bold, color: theme.text.muted, marginBottom: theme.spacing["2"] }}>
                  SELECT BATCH (FIFO)
                </div>
                {drawerBatches.length === 0 ? (
                  <div style={{ fontSize: theme.fontSize.base, color: theme.text.danger }}>
                    No dispensable batches available for this medicine.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["2"] }}>
                    {drawerBatches.map((b) => (
                      <label
                        key={b.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: theme.spacing["3"],
                          padding: theme.spacing["3"],
                          border: `1px solid ${drawerBatchId === b.id ? theme.action.info : theme.surface.border}`,
                          borderRadius: theme.radius.md,
                          background: drawerBatchId === b.id ? "#EFF6FF" : theme.surface.card,
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="radio"
                          name="batch"
                          value={b.id}
                          checked={drawerBatchId === b.id}
                          onChange={() => setDrawerBatchId(b.id)}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: theme.fontWeight.semibold, color: theme.text.primary }}>
                            Batch: {b.batchNumber}
                            {b.fifoPriority === 1 && (
                              <span style={{ marginLeft: theme.spacing["2"], fontSize: theme.fontSize.xs, color: theme.action.info }}>(FIFO Priority)</span>
                            )}
                          </div>
                          <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                            Stock: {b.quantityOnHand} | Total: {b.totalStock} | Price: NGN {b.sellingPrice.toLocaleString()}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: theme.fontSize.sm, color: isExpired(b.expiryDate) ? theme.text.danger : isExpiringSoon(b.expiryDate) ? theme.text.warning : theme.text.muted }}>
                            {b.expiryDate ? `Exp: ${b.expiryDate}` : "No expiry"}
                          </div>
                          {isExpired(b.expiryDate) && (
                            <StatusBadge variant="error" label="Expired" />
                          )}
                          {isExpiringSoon(b.expiryDate) && !isExpired(b.expiryDate) && (
                            <StatusBadge variant="running" label="Expiring Soon" />
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Quantity Input */}
            {!drawerLoading && drawerBatches.length > 0 && (
              <div style={{ marginBottom: theme.spacing["4"] }}>
                <div style={{ fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.bold, color: theme.text.muted, marginBottom: theme.spacing["2"] }}>
                  QUANTITY TO DISPENSE
                </div>
                <Input
                  type="number"
                  min={1}
                  max={drawerBatches.find((b) => b.id === drawerBatchId)?.quantityOnHand}
                  value={drawerQty}
                  onChange={(e) => setDrawerQty(e.target.value)}
                  placeholder="Enter quantity"
                  style={{ maxWidth: "12rem" }}
                />
                {drawerBatchId && (
                  <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, marginTop: theme.spacing["1"] }}>
                    Available: {drawerBatches.find((b) => b.id === drawerBatchId)?.quantityOnHand} units
                  </div>
                )}
              </div>
            )}

            {/* Counseling Notes */}
            {!drawerLoading && (
              <div style={{ marginBottom: theme.spacing["4"] }}>
                <div style={{ fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.bold, color: theme.text.muted, marginBottom: theme.spacing["2"] }}>
                  PATIENT COUNSELING NOTES
                </div>
                <textarea
                  value={drawerCounseling}
                  onChange={(e) => setDrawerCounseling(e.target.value)}
                  placeholder="Enter counseling instructions (e.g., take with food, avoid alcohol, complete full course)..."
                  style={{ width: "100%", minHeight: "4rem", padding: theme.spacing["3"], border: `1px solid ${theme.surface.border}`, borderRadius: theme.radius.md, fontSize: theme.fontSize.base, color: theme.text.primary, background: theme.surface.card, resize: "vertical" }}
                />
              </div>
            )}

            {/* Safety Check Confirmations */}
            {!drawerLoading && (
              <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["3"], marginBottom: theme.spacing["4"] }}>
                <label style={{ display: "flex", alignItems: "center", gap: theme.spacing["2"], cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={drawerAllergyChecked}
                    onChange={(e) => setDrawerAllergyChecked(e.target.checked)}
                  />
                  <span style={{ fontSize: theme.fontSize.base, color: theme.text.primary }}>
                    I have verified the patient's allergy profile and confirmed no contraindications
                  </span>
                </label>
                {drawerInteractions.length > 0 && (
                  <label style={{ display: "flex", alignItems: "center", gap: theme.spacing["2"], cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={drawerInteractionChecked}
                      onChange={(e) => setDrawerInteractionChecked(e.target.checked)}
                    />
                    <span style={{ fontSize: theme.fontSize.base, color: theme.text.primary }}>
                      I have reviewed the drug interaction warnings ({drawerInteractions.length} found) and accept the risk
                    </span>
                  </label>
                )}
              </div>
            )}

            {/* Error */}
            {drawerError && (
              <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: theme.radius.md, padding: theme.spacing["3"], marginBottom: theme.spacing["4"] }}>
                <div style={{ fontSize: theme.fontSize.sm, color: theme.text.danger }}>{drawerError}</div>
              </div>
            )}

            {/* Sign-off & Submit */}
            {!drawerLoading && drawerBatches.length > 0 && (
              <div style={{ display: "flex", gap: theme.spacing["3"], justifyContent: "flex-end" }}>
                <Button onClick={closeDrawer}>Cancel</Button>
                <Button
                  loading={drawerLoading}
                  style={{ background: theme.action.success }}
                  onClick={handleDrawerDispense}
                >
                  Dispense & Send for Verification
                </Button>
              </div>
            )}

            {drawerMedicine && (
              <div style={{ marginTop: theme.spacing["4"], padding: theme.spacing["3"], background: theme.surface.card, borderRadius: theme.radius.md, border: `1px solid ${theme.surface.border}` }}>
                <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                  Sign-off: The dispensing pharmacist, matron, or superadmin can sign off on the prescription
                  in the Dispensation History tab once verification is complete.
                </div>
              </div>
            )}
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

// ---------- sub-components ----------

function Kpi({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card bodyStyle={{ padding: theme.spacing["4"] }}>
      <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, fontWeight: theme.fontWeight.bold }}>
        {label}
      </div>
      <div style={{ fontSize: "1.5rem", fontWeight: theme.fontWeight.bold, color }}>{value}</div>
    </Card>
  );
}

// ---------- batch detail view ----------

interface MedicineDetail {
  medicine: Medicine;
  batches: Batch[];
}

const th: CSSProperties = { padding: "0.5rem", textAlign: "left" };
const td: CSSProperties = { padding: "0.5rem", color: theme.text.secondary, verticalAlign: "top" };

function BatchDetailView({ medicine: m }: { medicine: Medicine }) {
  const [detail, setDetail] = useState<MedicineDetail | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetch<MedicineDetail>(`/pharmacy/medicines/${m.id}`)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load batches."); });
    return () => { cancelled = true; };
  }, [m.id]);

  if (loadError) {
    return <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.danger }}>{loadError}</p>;
  }
  if (!detail) {
    return <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>Loading batches...</p>;
  }
  const batches = detail.batches;
  if (batches.length === 0) {
    return <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>No batches received for this medicine yet.</p>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: theme.fontSize.base }}>
        <thead>
          <tr style={{ color: theme.text.muted, borderBottom: `1px solid ${theme.surface.border}` }}>
            <th style={th}>Batch No.</th>
            <th style={th}>Expiry</th>
            <th style={th}>On Hand</th>
            <th style={th}>Unit Cost</th>
            <th style={th}>Selling</th>
            <th style={th}>Supplier</th>
            <th style={th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.id} style={{ borderBottom: `1px solid ${theme.surface.border}` }}>
              <td style={{ ...td, fontFamily: "monospace", color: theme.text.secondary }}>{b.batchNumber}</td>
              <td style={{ ...td, color: isExpired(b.expiryDate) ? theme.text.danger : isExpiringSoon(b.expiryDate) ? theme.text.warning : theme.text.secondary }}>
                {b.expiryDate ?? "---"}
                {isExpired(b.expiryDate) && <StatusBadge variant="error" label="Expired" />}
                {isExpiringSoon(b.expiryDate) && !isExpired(b.expiryDate) && <StatusBadge variant="running" label="Expiring" />}
              </td>
              <td style={{ ...td, fontWeight: theme.fontWeight.semibold, color: b.quantityOnHand <= 0 ? theme.text.danger : theme.text.primary }}>
                {b.quantityOnHand}
              </td>
              <td style={td}>NGN {b.purchaseCost.toLocaleString()}</td>
              <td style={td}>NGN {b.sellingPrice.toLocaleString()}</td>
              <td style={td}>{b.supplier || "---"}</td>
              <td style={td}><StatusBadge variant={batchStatusBadge(b.status)} label={b.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- drawer styles ----------

const drawerOverlayStyle: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: "rgba(0, 0, 0, 0.5)",
  display: "flex",
  justifyContent: "flex-end",
  zIndex: 1000,
};

const drawerPanelStyle: CSSProperties = {
  width: "32rem",
  maxWidth: "100%",
  height: "100%",
  background: theme.surface.canvas,
  boxShadow: "-4px 0 16px rgba(0,0,0,0.1)",
  padding: theme.spacing["5"],
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: theme.spacing["3"],
};
