import { Fragment, useCallback, useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { apiFetch } from "../api/client";

interface Medicine {
  id: string;
  code: string;
  genericName: string;
  brand: string;
  strength: string;
  dosageForm: string;
  category: string;
  reorderLevel: number;
  unitCost: number;
  sellingPrice: number;
  active: boolean;
}

interface Batch {
  id: string;
  batchNumber: string;
  expiryDate?: string;
  quantityOnHand: number;
  purchaseCost: number;
  sellingPrice: number;
  supplier: string;
  status: string;
}

interface LowStockItem {
  medicine: Medicine;
  totalQuantity: number;
}

interface PharmacyAlerts {
  lowStock: LowStockItem[];
}

interface Asset {
  id: string;
  assetNo: string;
  name: string;
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  tracking: string;
  serialNumber: string;
  supplier: string;
  cost: number;
  location: string;
  departmentName: string;
  condition: string;
  status: string;
  quantityOnHand: number;
}

interface AssetCategory {
  id: string;
  code: string;
  name: string;
  tracking: string;
}

const CURRENCY = (val: number) => `₦${val.toLocaleString()}`;

export default function InventoryPage() {
  const [activeTab, setActiveTab] = useState<"pharmacy" | "lab" | "assets">("pharmacy");
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");

  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [alerts, setAlerts] = useState<PharmacyAlerts | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<AssetCategory[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Expanded medicine -> batches.
  const [expanded, setExpanded] = useState<Record<string, Batch[]>>({});
  const [expandingId, setExpandingId] = useState<string | null>(null);

  // Add-item modal.
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    categoryId: "",
    code: "",
    strength: "",
    dosageForm: "",
    reorderLevel: "",
    unitCost: "",
    sellingPrice: "",
    serialNumber: "",
    cost: "",
    quantityOnHand: "",
    location: "",
  });

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [medRes, alertRes, assetRes, catRes] = await Promise.allSettled([
      apiFetch<Medicine[]>("/pharmacy/medicines"),
      apiFetch<PharmacyAlerts>("/pharmacy/alerts"),
      apiFetch<Asset[]>("/assets"),
      apiFetch<AssetCategory[]>("/assets/categories"),
    ]);
    const errors: string[] = [];
    if (medRes.status === "fulfilled") {
      setMedicines(medRes.value);
    } else {
      errors.push(medRes.reason instanceof Error ? medRes.reason.message : "Could not load medicines.");
    }
    if (alertRes.status === "fulfilled") {
      setAlerts(alertRes.value);
    } else {
      errors.push(alertRes.reason instanceof Error ? alertRes.reason.message : "Could not load stock alerts.");
    }
    if (assetRes.status === "fulfilled") {
      setAssets(assetRes.value);
    } else {
      errors.push(assetRes.reason instanceof Error ? assetRes.reason.message : "Could not load assets.");
    }
    if (catRes.status === "fulfilled") {
      setCategories(catRes.value);
    } else {
      errors.push(catRes.reason instanceof Error ? catRes.reason.message : "Could not load asset categories.");
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
      const detail = await apiFetch<{ medicine: Medicine; batches: Batch[] }>(`/pharmacy/medicines/${m.id}`);
      setExpanded((prev) => ({ ...prev, [m.id]: detail.batches }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load batches.");
    } finally {
      setExpandingId(null);
    }
  }

  async function changeAssetStatus(a: Asset, status: string) {
    const reason = window.prompt(`Reason for marking "${a.name}" as ${status.replace("_", " ")}?`)?.trim();
    if (!reason) return;
    setError("");
    try {
      await apiFetch<unknown>(`/assets/${a.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status, reason }),
      });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the asset status.");
    }
  }

  async function handleAddItem(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (activeTab === "pharmacy") {
        await apiFetch<unknown>("/pharmacy/medicines", {
          method: "POST",
          body: JSON.stringify({
            genericName: formData.name,
            brand: "",
            strength: formData.strength,
            dosageForm: formData.dosageForm,
            category: formData.categoryId,
            supplier: "",
            reorderLevel: Number(formData.reorderLevel) || 0,
            storageLocation: "",
            unitCost: Number(formData.unitCost) || 0,
            sellingPrice: Number(formData.sellingPrice) || 0,
          }),
        });
      } else {
        await apiFetch<unknown>("/assets", {
          method: "POST",
          body: JSON.stringify({
            name: formData.name,
            categoryId: formData.categoryId,
            serialNumber: formData.serialNumber,
            manufacturer: "",
            supplier: "",
            purchaseDate: "",
            cost: Number(formData.cost) || 0,
            location: formData.location,
            departmentId: "",
            custodianId: "",
            condition: "good",
            warrantyExpiry: "",
            quantityOnHand: Number(formData.quantityOnHand) || 1,
            notes: "",
          }),
        });
      }
      setShowModal(false);
      setFormData({
        name: "",
        categoryId: "",
        code: "",
        strength: "",
        dosageForm: "",
        reorderLevel: "",
        unitCost: "",
        sellingPrice: "",
        serialNumber: "",
        cost: "",
        quantityOnHand: "",
        location: "",
      });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the item.");
    } finally {
      setSaving(false);
    }
  }

  const lowStockCount = alerts?.lowStock.length ?? 0;
  const consumables = assets.filter((a) => a.categoryCode === "consumables");
  const serviceDue = assets.filter((a) => a.status === "under_maintenance").length;
  const totalValue = assets.reduce((acc, a) => acc + a.cost, 0);

  const filteredAssets = assets.filter(
    (a) =>
      (categoryFilter === "ALL" || a.categoryId === categoryFilter) &&
      (!searchTerm ||
        a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        a.assetNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
        a.serialNumber.toLowerCase().includes(searchTerm.toLowerCase())),
  );

  const filteredMedicines = medicines.filter(
    (m) =>
      !searchTerm ||
      m.genericName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.brand.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const filteredConsumables = consumables.filter(
    (a) =>
      !searchTerm ||
      a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.assetNo.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const defaultCategoryId = (tracking: string) => categories.find((c) => c.tracking === tracking)?.id ?? "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <p style={{ color: "#64748b", margin: 0, fontSize: "0.9rem" }}>
        Centralized stock tracking, reorder thresholds, and asset management across clinical departments.
      </p>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
        <KpiCard label="PHARMACY ALERTS" value={`${lowStockCount} SKUs Low`} accent="#dc2626" />
        <KpiCard label="LAB CONSUMABLES" value={`${consumables.length} Items`} accent="#d97706" />
        <KpiCard label="EQUIPMENT SERVICE" value={`${serviceDue} Unit Due`} accent="#0284c7" />
        <KpiCard label="TOTAL ASSET VALUE" value={CURRENCY(totalValue)} accent="#16a34a" />
      </div>

      {/* Navigation Control Panel */}
      <div style={{ background: "#fff", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginBottom: "1rem" }}>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={() => setActiveTab("pharmacy")} style={tabBtn(activeTab === "pharmacy")}>
              Pharmacy ({medicines.length})
            </button>
            <button onClick={() => setActiveTab("lab")} style={tabBtn(activeTab === "lab")}>
              Laboratory ({consumables.length})
            </button>
            <button onClick={() => setActiveTab("assets")} style={tabBtn(activeTab === "assets")}>
              Hospital Assets ({assets.length})
            </button>
          </div>

          <button
            onClick={() => {
              setFormData((prev) => ({
                ...prev,
                categoryId: activeTab === "lab" ? defaultCategoryId("quantity") : "",
              }));
              setShowModal(true);
            }}
            style={{ padding: "0.5rem 1rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 600, fontSize: "0.875rem", cursor: "pointer" }}
          >
            + Add {activeTab === "pharmacy" ? "Drug SKU" : activeTab === "lab" ? "Consumable" : "Asset Tag"}
          </button>
        </div>

        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            type="text"
            placeholder="Search items by code or name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ flex: 1, padding: "0.6rem 0.8rem", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "0.875rem", boxSizing: "border-box", outline: "none" }}
          />
          {activeTab === "assets" && (
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ padding: "0.6rem 0.8rem", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "0.875rem" }}>
              <option value="ALL">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: "0.85rem", color: "#b91c1c" }}>
          {error}
        </p>
      )}

      {loading && <p style={{ margin: 0, fontSize: "0.9rem", color: "#64748b" }}>Loading inventory data…</p>}

      {/* Pharmacy table */}
      {!loading && activeTab === "pharmacy" && (
        <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e2e8f0", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                <th style={{ padding: "0.75rem 1rem" }}>CODE</th>
                <th style={{ padding: "0.75rem 1rem" }}>MEDICATION</th>
                <th style={{ padding: "0.75rem 1rem" }}>CATEGORY</th>
                <th style={{ padding: "0.75rem 1rem" }}>STRENGTH / FORM</th>
                <th style={{ padding: "0.75rem 1rem" }}>REORDER</th>
                <th style={{ padding: "0.75rem 1rem" }}>PRICE (₦)</th>
                <th style={{ padding: "0.75rem 1rem" }}>STOCK</th>
                <th style={{ padding: "0.75rem 1rem" }}>BATCHES</th>
              </tr>
            </thead>
            <tbody>
              {filteredMedicines.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: "1.5rem", textAlign: "center", color: "#64748b" }}>No medicines match.</td>
                </tr>
              )}
              {filteredMedicines.map((m) => {
                const low = alerts?.lowStock.find((l) => l.medicine.id === m.id);
                const batches = expanded[m.id] ?? [];
                return (
                  <Fragment key={m.id}>
                    <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "0.75rem 1rem", fontWeight: "bold", color: "#0284c7" }}>{m.code}</td>
                      <td style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>
                        {m.genericName}
                        {m.brand ? ` (${m.brand})` : ""}
                      </td>
                      <td style={{ padding: "0.75rem 1rem" }}>{m.category || "—"}</td>
                      <td style={{ padding: "0.75rem 1rem" }}>{[m.strength, m.dosageForm].filter(Boolean).join(", ") || "—"}</td>
                      <td style={{ padding: "0.75rem 1rem" }}>{m.reorderLevel}</td>
                      <td style={{ padding: "0.75rem 1rem", fontWeight: "bold" }}>{m.sellingPrice.toLocaleString()}</td>
                      <td style={{ padding: "0.75rem 1rem" }}>
                        {low ? (
                          <span style={badge("#fef2f2", "#dc2626")}>LOW — {low.totalQuantity} units</span>
                        ) : (
                          <span style={badge("#f0fdf4", "#16a34a")}>In stock</span>
                        )}
                      </td>
                      <td style={{ padding: "0.75rem 1rem" }}>
                        <button
                          onClick={() => toggleMedicine(m)}
                          style={{ border: "1px solid #cbd5e1", background: "#fff", borderRadius: "4px", padding: "0.25rem 0.6rem", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}
                        >
                          {expandingId === m.id ? "Loading…" : expanded[m.id] ? "Hide" : "View"}
                        </button>
                      </td>
                    </tr>
                    {expanded[m.id] && (
                      <tr key={`${m.id}-batches`}>
                        <td colSpan={8} style={{ padding: "0 1rem 1rem 1rem", background: "#f8fafc" }}>
                          {batches.length === 0 ? (
                            <p style={{ margin: "0.5rem 0", fontSize: "0.8rem", color: "#64748b" }}>No batches received yet.</p>
                          ) : (
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                              <thead>
                                <tr style={{ color: "#64748b", borderBottom: "1px solid #e2e8f0" }}>
                                  <th style={{ padding: "0.5rem" }}>BATCH</th>
                                  <th style={{ padding: "0.5rem" }}>EXPIRY</th>
                                  <th style={{ padding: "0.5rem" }}>ON HAND</th>
                                  <th style={{ padding: "0.5rem" }}>SUPPLIER</th>
                                  <th style={{ padding: "0.5rem" }}>STATUS</th>
                                </tr>
                              </thead>
                              <tbody>
                                {batches.map((b) => (
                                  <tr key={b.id} style={{ borderBottom: "1px solid #eef2f7" }}>
                                    <td style={{ padding: "0.5rem", fontFamily: "monospace" }}>{b.batchNumber}</td>
                                    <td style={{ padding: "0.5rem", color: b.expiryDate && b.expiryDate < new Date().toISOString().slice(0, 10) ? "#dc2626" : "#475569" }}>
                                      {b.expiryDate ?? "—"}
                                    </td>
                                    <td style={{ padding: "0.5rem", fontWeight: 600 }}>{b.quantityOnHand}</td>
                                    <td style={{ padding: "0.5rem" }}>{b.supplier || "—"}</td>
                                    <td style={{ padding: "0.5rem" }}>{b.status.toUpperCase()}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Lab consumables table */}
      {!loading && activeTab === "lab" && (
        <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e2e8f0", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                <th style={{ padding: "0.75rem 1rem" }}>CODE</th>
                <th style={{ padding: "0.75rem 1rem" }}>CONSUMABLE</th>
                <th style={{ padding: "0.75rem 1rem" }}>CATEGORY</th>
                <th style={{ padding: "0.75rem 1rem" }}>SERIAL / LOT</th>
                <th style={{ padding: "0.75rem 1rem" }}>QTY</th>
                <th style={{ padding: "0.75rem 1rem" }}>LOCATION</th>
                <th style={{ padding: "0.75rem 1rem" }}>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {filteredConsumables.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: "1.5rem", textAlign: "center", color: "#64748b" }}>No lab consumables on file yet.</td>
                </tr>
              )}
              {filteredConsumables.map((a) => (
                <tr key={a.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "0.75rem 1rem", fontWeight: "bold", color: "#0284c7" }}>{a.assetNo}</td>
                  <td style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>{a.name}</td>
                  <td style={{ padding: "0.75rem 1rem" }}>{a.categoryName}</td>
                  <td style={{ padding: "0.75rem 1rem", fontFamily: "monospace" }}>{a.serialNumber || "—"}</td>
                  <td style={{ padding: "0.75rem 1rem", fontWeight: "bold" }}>{a.quantityOnHand}</td>
                  <td style={{ padding: "0.75rem 1rem" }}>{a.location || a.departmentName || "—"}</td>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <span style={badge(a.quantityOnHand <= 5 ? "#fef2f2" : "#f0fdf4", a.quantityOnHand <= 5 ? "#dc2626" : "#16a34a")}>
                      {a.quantityOnHand <= 5 ? "LOW STOCK" : "IN STOCK"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Assets table */}
      {!loading && activeTab === "assets" && (
        <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e2e8f0", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                <th style={{ padding: "0.75rem 1rem" }}>ASSET TAG</th>
                <th style={{ padding: "0.75rem 1rem" }}>EQUIPMENT</th>
                <th style={{ padding: "0.75rem 1rem" }}>CATEGORY</th>
                <th style={{ padding: "0.75rem 1rem" }}>SERIAL</th>
                <th style={{ padding: "0.75rem 1rem" }}>DEPT / LOCATION</th>
                <th style={{ padding: "0.75rem 1rem" }}>STATUS</th>
                <th style={{ padding: "0.75rem 1rem" }}>VALUATION</th>
                <th style={{ padding: "0.75rem 1rem" }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filteredAssets.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: "1.5rem", textAlign: "center", color: "#64748b" }}>No assets match.</td>
                </tr>
              )}
              {filteredAssets.map((a) => (
                <tr key={a.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "0.75rem 1rem", fontWeight: "bold", color: "#0284c7" }}>{a.assetNo}</td>
                  <td style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>{a.name}</td>
                  <td style={{ padding: "0.75rem 1rem" }}>{a.categoryName}</td>
                  <td style={{ padding: "0.75rem 1rem", fontFamily: "monospace" }}>{a.serialNumber || "—"}</td>
                  <td style={{ padding: "0.75rem 1rem" }}>{a.departmentName || a.location || "—"}</td>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <span style={badge(a.status === "under_maintenance" || a.status === "damaged" ? "#fef2f2" : "#f0fdf4", a.status === "under_maintenance" || a.status === "damaged" ? "#dc2626" : "#16a34a")}>
                      {a.status.replace("_", " ").toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: "0.75rem 1rem", fontWeight: "bold" }}>{CURRENCY(a.cost)}</td>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                      {a.status !== "under_maintenance" && (
                        <button onClick={() => changeAssetStatus(a, "under_maintenance")} style={miniBtn}>
                          Mark Maintenance
                        </button>
                      )}
                      {a.status === "under_maintenance" && (
                        <button onClick={() => changeAssetStatus(a, "available")} style={miniBtn}>
                          Mark Available
                        </button>
                      )}
                      {a.status === "available" && (
                        <button onClick={() => changeAssetStatus(a, "in_use")} style={miniBtn}>
                          Mark In Use
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Item Modal */}
      {showModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15, 23, 42, 0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000 }}>
          <div style={{ background: "#fff", borderRadius: "8px", width: "100%", maxWidth: "520px", padding: "1.5rem", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: "#0f172a" }}>
                Add New {activeTab === "pharmacy" ? "Drug SKU" : activeTab === "lab" ? "Consumable" : "Asset"}
              </h3>
              <button onClick={() => setShowModal(false)} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer", color: "#64748b" }}>✕</button>
            </div>

            <form onSubmit={handleAddItem} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <FieldLabel>{activeTab === "pharmacy" ? "Generic name *" : "Name *"}</FieldLabel>
                <input required type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} style={input} />
              </div>

              {activeTab === "pharmacy" ? (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                    <div>
                      <FieldLabel>Category</FieldLabel>
                      <input value={formData.categoryId} onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })} placeholder="e.g. Antibiotics" style={input} />
                    </div>
                    <div>
                      <FieldLabel>Strength</FieldLabel>
                      <input value={formData.strength} onChange={(e) => setFormData({ ...formData, strength: e.target.value })} placeholder="e.g. 500mg" style={input} />
                    </div>
                    <div>
                      <FieldLabel>Dosage form</FieldLabel>
                      <input value={formData.dosageForm} onChange={(e) => setFormData({ ...formData, dosageForm: e.target.value })} placeholder="e.g. Tablet" style={input} />
                    </div>
                    <div>
                      <FieldLabel>Reorder level</FieldLabel>
                      <input type="number" min={0} value={formData.reorderLevel} onChange={(e) => setFormData({ ...formData, reorderLevel: e.target.value })} style={input} />
                    </div>
                    <div>
                      <FieldLabel>Unit cost (₦)</FieldLabel>
                      <input type="number" min={0} value={formData.unitCost} onChange={(e) => setFormData({ ...formData, unitCost: e.target.value })} style={input} />
                    </div>
                    <div>
                      <FieldLabel>Selling price (₦)</FieldLabel>
                      <input type="number" min={0} value={formData.sellingPrice} onChange={(e) => setFormData({ ...formData, sellingPrice: e.target.value })} style={input} />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <FieldLabel>Category *</FieldLabel>
                    <select required value={formData.categoryId} onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })} style={input}>
                      <option value="">Select category…</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                    <div>
                      <FieldLabel>Serial / lot number</FieldLabel>
                      <input value={formData.serialNumber} onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })} style={input} />
                    </div>
                    <div>
                      <FieldLabel>Quantity on hand</FieldLabel>
                      <input type="number" min={0} value={formData.quantityOnHand} onChange={(e) => setFormData({ ...formData, quantityOnHand: e.target.value })} style={input} />
                    </div>
                    <div>
                      <FieldLabel>Cost (₦)</FieldLabel>
                      <input type="number" min={0} value={formData.cost} onChange={(e) => setFormData({ ...formData, cost: e.target.value })} style={input} />
                    </div>
                    <div>
                      <FieldLabel>Location</FieldLabel>
                      <input value={formData.location} onChange={(e) => setFormData({ ...formData, location: e.target.value })} placeholder="e.g. ICU" style={input} />
                    </div>
                  </div>
                </>
              )}

              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                <button type="submit" disabled={saving} style={{ flex: 1, padding: "0.6rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "pointer" }}>
                  {saving ? "Saving…" : "Save Item"}
                </button>
                <button type="button" onClick={() => setShowModal(false)} style={{ padding: "0.6rem 1rem", background: "#f1f5f9", color: "#475569", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ background: "#fff", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0", borderLeft: `4px solid ${accent}` }}>
      <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0f172a", marginTop: "0.25rem" }}>{value}</div>
    </div>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>{children}</label>;
}

function tabBtn(active: boolean): CSSProperties {
  return { padding: "0.5rem 1rem", border: "none", background: active ? "#0f172a" : "#f1f5f9", color: active ? "#fff" : "#475569", borderRadius: "6px", fontWeight: 600, cursor: "pointer", fontSize: "0.875rem" };
}

function badge(background: string, color: string): CSSProperties {
  return { padding: "0.2rem 0.5rem", borderRadius: "4px", fontSize: "0.75rem", fontWeight: 700, background, color };
}

const input: CSSProperties = { width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #cbd5e1", boxSizing: "border-box" };
const miniBtn: CSSProperties = { border: "1px solid #cbd5e1", background: "#fff", borderRadius: "4px", padding: "0.2rem 0.5rem", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 };
