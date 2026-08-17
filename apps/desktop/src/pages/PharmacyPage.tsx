import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { theme, Button, Card, DataTable, EmptyState, Input, PageHeader, StatusBadge, TabNav, type StatusVariant } from "@hims/ui";
import { apiFetch } from "../api/client";

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

interface Order {
  id: string;
  orderNo: string;
  patientId: string;
  orderType: string;
  status: string;
  details: Record<string, unknown>;
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
  createdAt: string;
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

function batchStatusBadge(status: string): StatusVariant {
  if (status === "available" || status === "active") return "approved";
  if (status === "quarantined") return "error";
  return "draft";
}

export default function PharmacyPage() {
  const [activeTab, setActiveTab] = useState<"dispense" | "inventory">("dispense");

  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [queue, setQueue] = useState<Order[]>([]);
  const [dispensations, setDispensations] = useState<Dispensation[]>([]);
  const [alerts, setAlerts] = useState<PharmacyAlerts | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Per-order dispense quantity (keyed by order id).
  const [qtyByOrder, setQtyByOrder] = useState<Record<string, string>>({});
  const [dispensingId, setDispensingId] = useState<string | null>(null);

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

  /** Match a prescription's medication line to a medicine master record. */
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

  async function handleDispense(order: Order) {
    const medication = String(order.details?.medication ?? "").trim();
    const medicine = findMedicine(medication);
    if (!medicine) {
      setError(
        `No medicine master record matches “${medication || "(no medication)"}”. Register it in the inventory tab first.`,
      );
      return;
    }
    const quantity = Number(qtyByOrder[order.id] ?? "");
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError("Enter a quantity to dispense.");
      return;
    }

    setDispensingId(order.id);
    setError("");
    try {
      await apiFetch<Dispensation>("/pharmacy/dispense", {
        method: "POST",
        body: JSON.stringify({
          orderId: order.id,
          items: [{ medicineId: medicine.id, quantity }],
          notes: "",
        }),
      });
      setQtyByOrder((prev) => ({ ...prev, [order.id]: "" }));
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dispense failed.");
    } finally {
      setDispensingId(null);
    }
  }

  const lowStockCount = alerts?.lowStock.length ?? 0;
  const pendingCount = queue.length;

  const queueColumns = [
    { key: "order", header: "Order No", render: (o: Order) => <strong style={{ color: theme.action.info }}>{o.orderNo}</strong> },
    {
      key: "patient",
      header: "Patient",
      render: (o: Order) => (
        <div>
          <div style={{ fontWeight: theme.fontWeight.semibold, color: theme.text.primary }}>Patient</div>
          <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, fontFamily: "monospace" }}>{o.patientId}</div>
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
            <div style={{ fontWeight: theme.fontWeight.semibold, color: theme.text.secondary }}>{medication || "—"}</div>
            {matched && (
              <div style={{ fontSize: theme.fontSize.sm, color: theme.action.info, fontWeight: theme.fontWeight.semibold }}>
                Stock ref: {matched.code} • {matched.strength || matched.dosageForm}
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
        return [dosage, frequency, durationDays != null ? `${durationDays} days` : ""].filter(Boolean).join(" · ") || "—";
      },
    },
    {
      key: "status",
      header: "Status",
      render: (o: Order) => <StatusBadge variant="running" label={o.status} />,
    },
    {
      key: "action",
      header: "Action",
      render: (o: Order) => {
        const matched = findMedicine(String(o.details?.medication ?? ""));
        return (
          <div style={{ display: "flex", gap: theme.spacing["2"], alignItems: "center" }}>
            <Input
              type="number"
              min={1}
              value={qtyByOrder[o.id] ?? ""}
              placeholder="Qty"
              onChange={(e) => setQtyByOrder((prev) => ({ ...prev, [o.id]: e.target.value }))}
              style={{ width: "4.5rem" }}
            />
            <Button
              size="sm"
              loading={dispensingId === o.id}
              disabled={!matched}
              style={{ background: matched ? theme.action.success : theme.text.muted }}
              onClick={() => handleDispense(o)}
            >
              Verify & Dispense
            </Button>
          </div>
        );
      },
    },
  ];

  const medicineColumns = [
    { key: "code", header: "Code", render: (m: Medicine) => <strong style={{ color: theme.text.secondary }}>{m.code}</strong> },
    {
      key: "name",
      header: "Medication & Category",
      render: (m: Medicine) => {
        const low = alerts?.lowStock.find((l) => l.medicine.id === m.id);
        return (
          <div>
            <div style={{ fontWeight: theme.fontWeight.semibold, color: theme.text.primary }}>
              {m.genericName}
              {m.brand ? ` (${m.brand})` : ""}
            </div>
            <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
              {m.category || "Uncategorised"} • {m.storageLocation || "—"}
            </div>
            {low && (
              <StatusBadge
                variant="error"
                label={`LOW STOCK — ${low.totalQuantity} units total`}
              />
            )}
          </div>
        );
      },
    },
    {
      key: "strength",
      header: "Strength / Form",
      render: (m: Medicine) => (m.strength || "—") + (m.dosageForm ? `, ${m.dosageForm}` : ""),
    },
    { key: "reorder", header: "Reorder Level", render: (m: Medicine) => m.reorderLevel },
    { key: "price", header: "Selling Price (₦)", render: (m: Medicine) => <strong>{m.sellingPrice.toLocaleString()}</strong> },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}>
      <PageHeader
        title="Pharmacy Dispense"
        description="Prescription dispensing queue, drug stock and batch control."
      />

      {/* Enterprise KPI Summary Bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: theme.spacing["4"] }}>
        <Kpi label="Pending Dispense" value={pendingCount} color={theme.action.info} />
        <Kpi label="Low Stock Alerts" value={lowStockCount} color={lowStockCount > 0 ? theme.action.danger : theme.action.success} />
        <Kpi label="Medicines on File" value={medicines.length} color={theme.action.secondary} />
        <Kpi label="Dispensed Today" value={dispensations.length} color={theme.action.success} />
      </div>

      <TabNav
        tabs={[
          { key: "dispense", label: "Prescription Dispensing Queue" },
          { key: "inventory", label: "Drug Stock & Batch Control" },
        ]}
        active={activeTab}
        onChange={(k) => setActiveTab(k as "dispense" | "inventory")}
      />

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.danger }}>
          {error}
        </p>
      )}

      {loading && (
        <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>Loading pharmacy data…</p>
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
            <div
              style={{
                background: "#fffbeb",
                border: "1px solid #fcd34d",
                borderRadius: theme.radius.lg,
                padding: theme.spacing["4"],
              }}
            >
              <div style={{ fontSize: theme.fontSize.sm, color: "#92400e", fontWeight: theme.fontWeight.bold, marginBottom: theme.spacing["2"] }}>
                EXPIRY WATCH
              </div>
              {alerts.expired.map((b) => (
                <div key={b.id} style={{ fontSize: theme.fontSize.base, color: "#7c2d12" }}>
                  • <strong>EXPIRED</strong> — {b.medicineName} ({b.medicineCode}), batch {b.batchNumber},
                  expiry {b.expiryDate ?? "unknown"}, {b.quantityOnHand} units on hand
                </div>
              ))}
              {alerts.expiring.map((b) => (
                <div key={b.id} style={{ fontSize: theme.fontSize.base, color: "#92400e" }}>
                  • Expiring soon — {b.medicineName} ({b.medicineCode}), batch {b.batchNumber},
                  expiry {b.expiryDate ?? "unknown"}, {b.quantityOnHand} units on hand
                </div>
              ))}
            </div>
          )}

          <Card bodyStyle={{ padding: 0 }}>
            {medicines.length === 0 ? (
              <EmptyState icon="box" description="No medicines on file yet." />
            ) : (
              <DataTable columns={medicineColumns} rows={medicines} rowKey={(m) => m.id} dense expandable={(m) => <BatchDetailView medicine={m} />} />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card bodyStyle={{ padding: theme.spacing["4"] }}>
      <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, fontWeight: theme.fontWeight.bold }}>{label}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: theme.fontWeight.bold, color }}>{value}</div>
    </Card>
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const th: CSSProperties = { padding: "0.5rem", textAlign: "left" };
const td: CSSProperties = { padding: "0.5rem", color: theme.text.secondary, verticalAlign: "top" };

/** Lazily fetches and renders the batch list for a medicine (runs on expand). */
function BatchDetailView({ medicine: m }: { medicine: Medicine }) {
  const [detail, setDetail] = useState<MedicineDetail | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetch<MedicineDetail>(`/pharmacy/medicines/${m.id}`)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load batches.");
      });
    return () => {
      cancelled = true;
    };
  }, [m.id]);

  if (loadError) {
    return <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.danger }}>{loadError}</p>;
  }
  if (!detail) {
    return <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>Loading batches…</p>;
  }
  const batches = detail.batches;
  if (batches.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>
        No batches received for this medicine yet.
      </p>
    );
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
              <td style={{ ...td, color: b.expiryDate && b.expiryDate < today() ? theme.text.danger : theme.text.secondary }}>
                {b.expiryDate ?? "—"}
              </td>
              <td style={{ ...td, fontWeight: theme.fontWeight.semibold, color: b.quantityOnHand <= 0 ? theme.text.danger : theme.text.primary }}>
                {b.quantityOnHand}
              </td>
              <td style={td}>₦{b.purchaseCost.toLocaleString()}</td>
              <td style={td}>₦{b.sellingPrice.toLocaleString()}</td>
              <td style={td}>{b.supplier || "—"}</td>
              <td style={td}>
                <StatusBadge variant={batchStatusBadge(b.status)} label={b.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
