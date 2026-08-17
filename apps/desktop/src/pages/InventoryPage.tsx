import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import {
  theme,
  Button,
  Card,
  DataTable,
  EmptyState,
  FormField,
  Input,
  Modal,
  PageHeader,
  Select,
  StatusBadge,
  TabNav,
  useToast,
  type StatusVariant,
} from "@hims/ui";
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

function stockBadge(qty: number, low: boolean): StatusVariant {
  if (low || qty <= 5) return "error";
  return "approved";
}

function assetStatusBadge(status: string): StatusVariant {
  if (status === "under_maintenance" || status === "damaged") return "error";
  if (status === "in_use") return "active";
  if (status === "available") return "approved";
  return "draft";
}

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
  const toast = useToast();

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
      errors.push(
        medRes.reason instanceof Error ? medRes.reason.message : "Could not load medicines.",
      );
    }
    if (alertRes.status === "fulfilled") {
      setAlerts(alertRes.value);
    } else {
      errors.push(
        alertRes.reason instanceof Error ? alertRes.reason.message : "Could not load stock alerts.",
      );
    }
    if (assetRes.status === "fulfilled") {
      setAssets(assetRes.value);
    } else {
      errors.push(
        assetRes.reason instanceof Error ? assetRes.reason.message : "Could not load assets.",
      );
    }
    if (catRes.status === "fulfilled") {
      setCategories(catRes.value);
    } else {
      errors.push(
        catRes.reason instanceof Error ? catRes.reason.message : "Could not load asset categories.",
      );
    }
    setError(errors.join(" "));
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function changeAssetStatus(a: Asset, status: string) {
    const reason = window
      .prompt(`Reason for marking "${a.name}" as ${status.replace("_", " ")}?`)
      ?.trim();
    if (!reason) return;
    setError("");
    try {
      await apiFetch<unknown>(`/assets/${a.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status, reason }),
      });
      await loadAll();
      toast.success(`${a.name} marked ${status.replace("_", " ")}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not update the asset status.";
      setError(msg);
      toast.error(msg);
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
      toast.success(activeTab === "pharmacy" ? "Medicine added." : "Item added to inventory.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not save the item.";
      setError(msg);
      toast.error(msg);
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

  const defaultCategoryId = (tracking: string) =>
    categories.find((c) => c.tracking === tracking)?.id ?? "";

  const addLabel =
    activeTab === "pharmacy" ? "Drug SKU" : activeTab === "lab" ? "Consumable" : "Asset Tag";

  const medicineColumns = [
    {
      key: "code",
      header: "Code",
      render: (m: Medicine) => <strong style={{ color: theme.action.info }}>{m.code}</strong>,
    },
    {
      key: "name",
      header: "Medication",
      render: (m: Medicine) => (
        <span style={{ fontWeight: theme.fontWeight.semibold }}>
          {m.genericName}
          {m.brand ? ` (${m.brand})` : ""}
        </span>
      ),
    },
    { key: "category", header: "Category", render: (m: Medicine) => m.category || "—" },
    {
      key: "strength",
      header: "Strength / Form",
      render: (m: Medicine) => [m.strength, m.dosageForm].filter(Boolean).join(", ") || "—",
    },
    { key: "reorder", header: "Reorder", render: (m: Medicine) => m.reorderLevel },
    {
      key: "price",
      header: "Price (₦)",
      render: (m: Medicine) => <strong>{m.sellingPrice.toLocaleString()}</strong>,
    },
    {
      key: "stock",
      header: "Stock",
      render: (m: Medicine) => {
        const low = alerts?.lowStock.find((l) => l.medicine.id === m.id);
        return low ? (
          <StatusBadge variant="error" label={`LOW — ${low.totalQuantity} units`} />
        ) : (
          <StatusBadge variant="approved" label="In stock" />
        );
      },
    },
  ];

  const consumableColumns = [
    {
      key: "no",
      header: "Code",
      render: (a: Asset) => <strong style={{ color: theme.action.info }}>{a.assetNo}</strong>,
    },
    {
      key: "name",
      header: "Consumable",
      render: (a: Asset) => <span style={{ fontWeight: theme.fontWeight.semibold }}>{a.name}</span>,
    },
    { key: "category", header: "Category", render: (a: Asset) => a.categoryName },
    {
      key: "serial",
      header: "Serial / Lot",
      render: (a: Asset) => (
        <span style={{ fontFamily: "monospace" }}>{a.serialNumber || "—"}</span>
      ),
    },
    { key: "qty", header: "Qty", render: (a: Asset) => <strong>{a.quantityOnHand}</strong> },
    {
      key: "location",
      header: "Location",
      render: (a: Asset) => a.location || a.departmentName || "—",
    },
    {
      key: "status",
      header: "Status",
      render: (a: Asset) => (
        <StatusBadge
          variant={stockBadge(a.quantityOnHand, false)}
          label={a.quantityOnHand <= 5 ? "LOW STOCK" : "IN STOCK"}
        />
      ),
    },
  ];

  const assetColumns = [
    {
      key: "tag",
      header: "Asset Tag",
      render: (a: Asset) => <strong style={{ color: theme.action.info }}>{a.assetNo}</strong>,
    },
    {
      key: "name",
      header: "Equipment",
      render: (a: Asset) => <span style={{ fontWeight: theme.fontWeight.semibold }}>{a.name}</span>,
    },
    { key: "category", header: "Category", render: (a: Asset) => a.categoryName },
    {
      key: "serial",
      header: "Serial",
      render: (a: Asset) => (
        <span style={{ fontFamily: "monospace" }}>{a.serialNumber || "—"}</span>
      ),
    },
    {
      key: "dept",
      header: "Dept / Location",
      render: (a: Asset) => a.departmentName || a.location || "—",
    },
    {
      key: "status",
      header: "Status",
      render: (a: Asset) => (
        <StatusBadge variant={assetStatusBadge(a.status)} label={a.status.replace("_", " ")} />
      ),
    },
    {
      key: "value",
      header: "Valuation",
      render: (a: Asset) => <strong>{CURRENCY(a.cost)}</strong>,
    },
    {
      key: "actions",
      header: "Actions",
      render: (a: Asset) => (
        <div style={{ display: "flex", gap: theme.spacing["1"], flexWrap: "wrap" }}>
          {a.status !== "under_maintenance" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => changeAssetStatus(a, "under_maintenance")}
            >
              Mark Maintenance
            </Button>
          )}
          {a.status === "under_maintenance" && (
            <Button size="sm" variant="outline" onClick={() => changeAssetStatus(a, "available")}>
              Mark Available
            </Button>
          )}
          {a.status === "available" && (
            <Button size="sm" variant="outline" onClick={() => changeAssetStatus(a, "in_use")}>
              Mark In Use
            </Button>
          )}
        </div>
      ),
    },
  ];

  function BatchDetailView({ medicine: m }: { medicine: Medicine }) {
    const [batches, setBatches] = useState<Batch[] | null>(null);
    const [loadError, setLoadError] = useState("");
    useEffect(() => {
      let cancelled = false;
      apiFetch<{ medicine: Medicine; batches: Batch[] }>(`/pharmacy/medicines/${m.id}`)
        .then((d) => {
          if (!cancelled) setBatches(d.batches);
        })
        .catch((err) => {
          if (!cancelled)
            setLoadError(err instanceof Error ? err.message : "Could not load batches.");
        });
      return () => {
        cancelled = true;
      };
    }, [m.id]);
    if (loadError) {
      return (
        <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.danger }}>
          {loadError}
        </p>
      );
    }
    if (!batches) {
      return (
        <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>
          Loading batches…
        </p>
      );
    }
    if (batches.length === 0) {
      return (
        <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>
          No batches received yet.
        </p>
      );
    }
    return (
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: theme.fontSize.base }}>
          <thead>
            <tr
              style={{ color: theme.text.muted, borderBottom: `1px solid ${theme.surface.border}` }}
            >
              <th style={th}>Batch</th>
              <th style={th}>Expiry</th>
              <th style={th}>On Hand</th>
              <th style={th}>Supplier</th>
              <th style={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id} style={{ borderBottom: `1px solid ${theme.surface.border}` }}>
                <td style={{ ...td, fontFamily: "monospace" }}>{b.batchNumber}</td>
                <td
                  style={{
                    ...td,
                    color:
                      b.expiryDate && b.expiryDate < new Date().toISOString().slice(0, 10)
                        ? theme.text.danger
                        : theme.text.secondary,
                  }}
                >
                  {b.expiryDate ?? "—"}
                </td>
                <td style={{ ...td, fontWeight: theme.fontWeight.semibold }}>{b.quantityOnHand}</td>
                <td style={td}>{b.supplier || "—"}</td>
                <td style={td}>{b.status.toUpperCase()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}>
      <PageHeader
        title="Hospital Inventory & Assets"
        description="Centralized stock tracking, reorder thresholds, and asset management across clinical departments."
        actions={
          <Button
            onClick={() => {
              setFormData((prev) => ({
                ...prev,
                categoryId: activeTab === "lab" ? defaultCategoryId("quantity") : "",
              }));
              setShowModal(true);
            }}
          >
            + Add {addLabel}
          </Button>
        }
      />

      {/* KPI Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: theme.spacing["4"],
        }}
      >
        <KpiCard
          label="Pharmacy Alerts"
          value={`${lowStockCount} SKUs Low`}
          accent={theme.action.danger}
        />
        <KpiCard
          label="Lab Consumables"
          value={`${consumables.length} Items`}
          accent={theme.action.warning}
        />
        <KpiCard
          label="Equipment Service"
          value={`${serviceDue} Unit Due`}
          accent={theme.action.info}
        />
        <KpiCard
          label="Total Asset Value"
          value={CURRENCY(totalValue)}
          accent={theme.action.success}
        />
      </div>

      {/* Navigation Control Panel */}
      <Card bodyStyle={{ padding: theme.spacing["4"] }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: theme.spacing["4"],
            marginBottom: theme.spacing["4"],
          }}
        >
          <TabNav
            tabs={[
              { key: "pharmacy", label: `Pharmacy (${medicines.length})` },
              { key: "lab", label: `Laboratory (${consumables.length})` },
              { key: "assets", label: `Hospital Assets (${assets.length})` },
            ]}
            active={activeTab}
            onChange={(k) => setActiveTab(k as "pharmacy" | "lab" | "assets")}
          />
        </div>

        <div style={{ display: "flex", gap: theme.spacing["2"] }}>
          <Input
            type="text"
            placeholder="Search items by code or name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ flex: 1 }}
          />
          {activeTab === "assets" && (
            <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="ALL">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </div>
      </Card>

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
          Loading inventory data…
        </p>
      )}

      {/* Pharmacy table */}
      {!loading && activeTab === "pharmacy" && (
        <Card bodyStyle={{ padding: 0 }}>
          {filteredMedicines.length === 0 ? (
            <EmptyState icon="pill" description="No medicines match." />
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
      )}

      {/* Lab consumables table */}
      {!loading && activeTab === "lab" && (
        <Card bodyStyle={{ padding: 0 }}>
          {filteredConsumables.length === 0 ? (
            <EmptyState icon="box" description="No lab consumables on file yet." />
          ) : (
            <DataTable
              columns={consumableColumns}
              rows={filteredConsumables}
              rowKey={(a) => a.id}
              dense
            />
          )}
        </Card>
      )}

      {/* Assets table */}
      {!loading && activeTab === "assets" && (
        <Card bodyStyle={{ padding: 0 }}>
          {filteredAssets.length === 0 ? (
            <EmptyState icon="box" description="No assets match." />
          ) : (
            <DataTable columns={assetColumns} rows={filteredAssets} rowKey={(a) => a.id} dense />
          )}
        </Card>
      )}

      {/* Add Item Modal */}
      <Modal
        open={showModal}
        title={`Add New ${addLabel}`}
        onClose={() => setShowModal(false)}
        width={560}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button type="submit" form="add-item-form" loading={saving}>
              Save Item
            </Button>
          </>
        }
      >
        <form
          id="add-item-form"
          onSubmit={handleAddItem}
          style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}
        >
          <FormField label={activeTab === "pharmacy" ? "Generic name" : "Name"} required>
            <Input
              required
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </FormField>

          {activeTab === "pharmacy" ? (
            <div
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}
            >
              <FormField label="Category">
                <Input
                  value={formData.categoryId}
                  onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                  placeholder="e.g. Antibiotics"
                />
              </FormField>
              <FormField label="Strength">
                <Input
                  value={formData.strength}
                  onChange={(e) => setFormData({ ...formData, strength: e.target.value })}
                  placeholder="e.g. 500mg"
                />
              </FormField>
              <FormField label="Dosage form">
                <Input
                  value={formData.dosageForm}
                  onChange={(e) => setFormData({ ...formData, dosageForm: e.target.value })}
                  placeholder="e.g. Tablet"
                />
              </FormField>
              <FormField label="Reorder level">
                <Input
                  type="number"
                  min={0}
                  value={formData.reorderLevel}
                  onChange={(e) => setFormData({ ...formData, reorderLevel: e.target.value })}
                />
              </FormField>
              <FormField label="Unit cost (₦)">
                <Input
                  type="number"
                  min={0}
                  value={formData.unitCost}
                  onChange={(e) => setFormData({ ...formData, unitCost: e.target.value })}
                />
              </FormField>
              <FormField label="Selling price (₦)">
                <Input
                  type="number"
                  min={0}
                  value={formData.sellingPrice}
                  onChange={(e) => setFormData({ ...formData, sellingPrice: e.target.value })}
                />
              </FormField>
            </div>
          ) : (
            <>
              <FormField label="Category" required>
                <Select
                  required
                  value={formData.categoryId}
                  onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                >
                  <option value="">Select category…</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <div
                style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}
              >
                <FormField label="Serial / lot number">
                  <Input
                    value={formData.serialNumber}
                    onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
                  />
                </FormField>
                <FormField label="Quantity on hand">
                  <Input
                    type="number"
                    min={0}
                    value={formData.quantityOnHand}
                    onChange={(e) => setFormData({ ...formData, quantityOnHand: e.target.value })}
                  />
                </FormField>
                <FormField label="Cost (₦)">
                  <Input
                    type="number"
                    min={0}
                    value={formData.cost}
                    onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
                  />
                </FormField>
                <FormField label="Location">
                  <Input
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    placeholder="e.g. ICU"
                  />
                </FormField>
              </div>
            </>
          )}
        </form>
      </Modal>
    </div>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <Card
      bodyStyle={{
        padding: theme.spacing["4"],
        borderLeft: `4px solid ${accent}`,
      }}
    >
      <div
        style={{
          fontSize: theme.fontSize.sm,
          color: theme.text.muted,
          fontWeight: theme.fontWeight.bold,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "1.5rem",
          fontWeight: theme.fontWeight.bold,
          color: theme.text.primary,
          marginTop: theme.spacing["1"],
        }}
      >
        {value}
      </div>
    </Card>
  );
}

const th: CSSProperties = {
  padding: "0.5rem",
  textAlign: "left",
  fontWeight: theme.fontWeight.semibold,
};
const td: CSSProperties = { padding: "0.5rem", color: theme.text.secondary, verticalAlign: "top" };
