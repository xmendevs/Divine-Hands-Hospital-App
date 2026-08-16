import { useCallback, useEffect, useState, type CSSProperties } from "react";
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

  // Expanded medicine rows -> lazily fetched { medicine, batches }.
  const [expanded, setExpanded] = useState<Record<string, MedicineDetail>>({});
  const [expandingId, setExpandingId] = useState<string | null>(null);

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
      errors.push(queueRes.reason instanceof Error ? queueRes.reason.message : "Could not load the dispensing queue.");
    }
    if (dispRes.status === "fulfilled") {
      setDispensations(dispRes.value);
    } else {
      errors.push(dispRes.reason instanceof Error ? dispRes.reason.message : "Could not load dispensations.");
    }
    if (alertsRes.status === "fulfilled") {
      setAlerts(alertsRes.value);
    } else {
      errors.push(alertsRes.reason instanceof Error ? alertsRes.reason.message : "Could not load stock alerts.");
    }

    setError(errors.join(" "));
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function toggleMedicine(m: Medicine) {
    if (expanded[m.id]) {
      setExpanded((prev) => {
        const next = { ...prev };
        delete next[m.id];
        return next;
      });
      return;
    }
    setExpandingId(m.id);
    setError("");
    try {
      const detail = await apiFetch<MedicineDetail>(`/pharmacy/medicines/${m.id}`);
      setExpanded((prev) => ({ ...prev, [m.id]: detail }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load batches.");
    } finally {
      setExpandingId(null);
    }
  }

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Enterprise KPI Summary Bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
        <Kpi label="PENDING DISPENSE" value={pendingCount} color="#0284c7" />
        <Kpi label="LOW STOCK ALERTS" value={lowStockCount} color={lowStockCount > 0 ? "#dc2626" : "#16a34a"} />
        <Kpi label="MEDICINES ON FILE" value={medicines.length} color="#334155" />
        <Kpi label="DISPENSED TODAY" value={dispensations.length} color="#16a34a" />
      </div>

      {/* Tab Navigation */}
      <div style={{ display: "flex", gap: "0.75rem", borderBottom: "2px solid #e2e8f0", paddingBottom: "0.5rem" }}>
        <button
          onClick={() => setActiveTab("dispense")}
          style={{
            padding: "0.5rem 1.2rem",
            border: "none",
            background: activeTab === "dispense" ? "#0284c7" : "transparent",
            color: activeTab === "dispense" ? "#fff" : "#64748b",
            borderRadius: "6px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Prescription Dispensing Queue
        </button>
        <button
          onClick={() => setActiveTab("inventory")}
          style={{
            padding: "0.5rem 1.2rem",
            border: "none",
            background: activeTab === "inventory" ? "#0284c7" : "transparent",
            color: activeTab === "inventory" ? "#fff" : "#64748b",
            borderRadius: "6px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Drug Stock & Batch Control
        </button>
      </div>

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: "0.85rem", color: "#b91c1c" }}>
          {error}
        </p>
      )}

      {loading && (
        <p style={{ margin: 0, fontSize: "0.9rem", color: "#64748b" }}>Loading pharmacy data…</p>
      )}

      {/* Tab 1: Dispensing Queue */}
      {!loading && activeTab === "dispense" && (
        <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                <th style={{ padding: "0.75rem 1rem" }}>ORDER NO</th>
                <th style={{ padding: "0.75rem 1rem" }}>PATIENT</th>
                <th style={{ padding: "0.75rem 1rem" }}>PRESCRIBED MEDICATION</th>
                <th style={{ padding: "0.75rem 1rem" }}>INSTRUCTIONS</th>
                <th style={{ padding: "0.75rem 1rem" }}>STATUS</th>
                <th style={{ padding: "0.75rem 1rem" }}>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {queue.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: "1.5rem", textAlign: "center", color: "#64748b" }}>
                    No prescriptions awaiting dispensing.
                  </td>
                </tr>
              )}
              {queue.map((order) => {
                const medication = String(order.details?.medication ?? "");
                const dosage = String(order.details?.dosage ?? "");
                const frequency = String(order.details?.frequency ?? "");
                const durationDays = order.details?.durationDays;
                const matched = findMedicine(medication);
                return (
                  <tr key={order.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "0.85rem 1rem", fontWeight: 700, color: "#0369a1" }}>{order.orderNo}</td>
                    <td style={{ padding: "0.85rem 1rem" }}>
                      <div style={{ fontWeight: 600, color: "#0f172a" }}>Patient</div>
                      <div style={{ fontSize: "0.75rem", color: "#64748b", fontFamily: "monospace" }}>{order.patientId}</div>
                    </td>
                    <td style={{ padding: "0.85rem 1rem" }}>
                      <div style={{ fontWeight: 600, color: "#334155" }}>{medication || "—"}</div>
                      {matched && (
                        <div style={{ fontSize: "0.75rem", color: "#0284c7", fontWeight: 600 }}>
                          Stock ref: {matched.code} • {matched.strength || matched.dosageForm}
                        </div>
                      )}
                      {!matched && (
                        <div style={{ fontSize: "0.75rem", color: "#b45309", fontWeight: 600 }}>
                          No matching medicine master record
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "0.85rem 1rem", color: "#475569" }}>
                      {[dosage, frequency, durationDays != null ? `${durationDays} days` : ""].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td style={{ padding: "0.85rem 1rem" }}>
                      <span
                        style={{
                          padding: "0.25rem 0.5rem",
                          borderRadius: "4px",
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          background: "#fefce8",
                          color: "#ca8a04",
                        }}
                      >
                        {order.status.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: "0.85rem 1rem" }}>
                      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                        <input
                          type="number"
                          min={1}
                          value={qtyByOrder[order.id] ?? ""}
                          placeholder="Qty"
                          onChange={(e) => setQtyByOrder((prev) => ({ ...prev, [order.id]: e.target.value }))}
                          style={{ width: "4.5rem", padding: "0.4rem", border: "1px solid #cbd5e1", borderRadius: "4px", fontSize: "0.8rem" }}
                        />
                        <button
                          onClick={() => handleDispense(order)}
                          disabled={dispensingId === order.id || !matched}
                          style={{
                            padding: "0.4rem 0.8rem",
                            background: matched ? "#16a34a" : "#94a3b8",
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            fontWeight: 700,
                            cursor: matched ? "pointer" : "not-allowed",
                            fontSize: "0.75rem",
                          }}
                        >
                          {dispensingId === order.id ? "Dispensing…" : "Verify & Dispense"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 2: Inventory & Stock Control */}
      {!loading && activeTab === "inventory" && (
        <>
          {alerts && (alerts.expiring.length > 0 || alerts.expired.length > 0) && (
            <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "8px", padding: "1rem" }}>
              <div style={{ fontSize: "0.75rem", color: "#92400e", fontWeight: 700, marginBottom: "0.5rem" }}>
                EXPIRY WATCH
              </div>
              {alerts.expired.map((b) => (
                <div key={b.id} style={{ fontSize: "0.85rem", color: "#7c2d12" }}>
                  • <strong>EXPIRED</strong> — {b.medicineName} ({b.medicineCode}), batch {b.batchNumber}, expiry {b.expiryDate ?? "unknown"}, {b.quantityOnHand} units on hand
                </div>
              ))}
              {alerts.expiring.map((b) => (
                <div key={b.id} style={{ fontSize: "0.85rem", color: "#92400e" }}>
                  • Expiring soon — {b.medicineName} ({b.medicineCode}), batch {b.batchNumber}, expiry {b.expiryDate ?? "unknown"}, {b.quantityOnHand} units on hand
                </div>
              ))}
            </div>
          )}

          <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                  <th style={{ padding: "0.75rem 1rem" }}>CODE</th>
                  <th style={{ padding: "0.75rem 1rem" }}>MEDICATION & CATEGORY</th>
                  <th style={{ padding: "0.75rem 1rem" }}>STRENGTH / FORM</th>
                  <th style={{ padding: "0.75rem 1rem" }}>REORDER LEVEL</th>
                  <th style={{ padding: "0.75rem 1rem" }}>SELLING PRICE (₦)</th>
                  <th style={{ padding: "0.75rem 1rem" }}>BATCHES</th>
                </tr>
              </thead>
              <tbody>
                {medicines.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: "1.5rem", textAlign: "center", color: "#64748b" }}>
                      No medicines on file yet.
                    </td>
                  </tr>
                )}
                {medicines.map((m) => {
                  const low = alerts?.lowStock.find((l) => l.medicine.id === m.id);
                  const isExpanded = Boolean(expanded[m.id]);
                  const batches = expanded[m.id]?.batches ?? [];
                  return (
                    <MedicineRow
                      key={m.id}
                      medicine={m}
                      lowStock={low}
                      isExpanded={isExpanded}
                      expanding={expandingId === m.id}
                      batches={batches}
                      onToggle={() => toggleMedicine(m)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function MedicineRow({
  medicine: m,
  lowStock,
  isExpanded,
  expanding,
  batches,
  onToggle,
}: {
  medicine: Medicine;
  lowStock: LowStockItem | undefined;
  isExpanded: boolean;
  expanding: boolean;
  batches: Batch[];
  onToggle: () => void;
}) {
  return (
    <>
      <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
        <td style={{ padding: "0.85rem 1rem", fontWeight: 700, color: "#334155" }}>{m.code}</td>
        <td style={{ padding: "0.85rem 1rem" }}>
          <div style={{ fontWeight: 600, color: "#0f172a" }}>
            {m.genericName}
            {m.brand ? ` (${m.brand})` : ""}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#64748b" }}>
            {m.category || "Uncategorised"} • {m.storageLocation || "—"}
          </div>
          {lowStock && (
            <span
              style={{
                display: "inline-block",
                marginTop: "0.25rem",
                padding: "0.2rem 0.5rem",
                borderRadius: "4px",
                fontSize: "0.7rem",
                fontWeight: 700,
                background: "#fef2f2",
                color: "#dc2626",
              }}
            >
              LOW STOCK — {lowStock.totalQuantity} units total
            </span>
          )}
        </td>
        <td style={{ padding: "0.85rem 1rem", color: "#475569" }}>
          {m.strength || "—"}
          {m.dosageForm ? `, ${m.dosageForm}` : ""}
        </td>
        <td style={{ padding: "0.85rem 1rem", color: "#475569" }}>{m.reorderLevel}</td>
        <td style={{ padding: "0.85rem 1rem", fontWeight: 600, color: "#0f172a" }}>
          {m.sellingPrice.toLocaleString()}
        </td>
        <td style={{ padding: "0.85rem 1rem" }}>
          <button onClick={onToggle} style={viewBtn}>
            {expanding ? "Loading…" : isExpanded ? "Hide batches" : "View batches"}
          </button>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={6} style={{ padding: "0 1rem 1rem 1rem", background: "#f8fafc" }}>
            {batches.length === 0 ? (
              <p style={{ margin: "0.5rem 0", fontSize: "0.85rem", color: "#64748b" }}>
                No batches received for this medicine yet.
              </p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                <thead>
                  <tr style={{ color: "#64748b", borderBottom: "1px solid #e2e8f0" }}>
                    <th style={{ padding: "0.5rem" }}>BATCH NO.</th>
                    <th style={{ padding: "0.5rem" }}>EXPIRY</th>
                    <th style={{ padding: "0.5rem" }}>ON HAND</th>
                    <th style={{ padding: "0.5rem" }}>UNIT COST</th>
                    <th style={{ padding: "0.5rem" }}>SELLING</th>
                    <th style={{ padding: "0.5rem" }}>SUPPLIER</th>
                    <th style={{ padding: "0.5rem" }}>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id} style={{ borderBottom: "1px solid #eef2f7" }}>
                      <td style={{ padding: "0.5rem", fontFamily: "monospace", color: "#334155" }}>{b.batchNumber}</td>
                      <td style={{ padding: "0.5rem", color: b.expiryDate && b.expiryDate < today() ? "#dc2626" : "#475569" }}>
                        {b.expiryDate ?? "—"}
                      </td>
                      <td style={{ padding: "0.5rem", fontWeight: 600, color: b.quantityOnHand <= 0 ? "#dc2626" : "#0f172a" }}>
                        {b.quantityOnHand}
                      </td>
                      <td style={{ padding: "0.5rem", color: "#475569" }}>₦{b.purchaseCost.toLocaleString()}</td>
                      <td style={{ padding: "0.5rem", color: "#475569" }}>₦{b.sellingPrice.toLocaleString()}</td>
                      <td style={{ padding: "0.5rem", color: "#475569" }}>{b.supplier || "—"}</td>
                      <td style={{ padding: "0.5rem" }}>
                        <BatchStatus status={b.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function BatchStatus({ status }: { status: string }) {
  const ok = status === "available" || status === "active";
  const quarantined = status === "quarantined";
  const background = quarantined ? "#fef2f2" : ok ? "#f0fdf4" : "#f1f5f9";
  const color = quarantined ? "#dc2626" : ok ? "#16a34a" : "#475569";
  return (
    <span style={{ padding: "0.2rem 0.5rem", borderRadius: "4px", fontSize: "0.7rem", fontWeight: 700, background, color }}>
      {status.toUpperCase()}
    </span>
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function Kpi({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: "#fff", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
      <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

const viewBtn: CSSProperties = {
  padding: "0.35rem 0.75rem",
  background: "#f1f5f9",
  border: "1px solid #cbd5e1",
  borderRadius: "4px",
  cursor: "pointer",
  fontSize: "0.8rem",
};
