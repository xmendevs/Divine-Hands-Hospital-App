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
import { useAuth } from "../auth/AuthContext";

// ---------- interfaces ----------

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
  expiring: { batchNumber: string; medicineName: string; medicineCode: string; expiryDate?: string; quantityOnHand: number }[];
  expired: { batchNumber: string; medicineName: string; medicineCode: string; expiryDate?: string; quantityOnHand: number }[];
}

interface LabConsumable {
  id: string;
  itemCode: string;
  name: string;
  category: string;
  packagingUnit: string;
  batchLotNumber: string;
  reorderLevel: number;
  unitCost: number;
  quantityOnHand: number;
  storageLocation: string;
  supplier: string;
  expiryDate?: string;
  active: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
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

// ---------- helpers ----------

const CURRENCY = (val: number) => `NGN ${val.toLocaleString()}`;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function isExpired(dateStr?: string): boolean {
  return !!dateStr && dateStr < today();
}

function stockStatus(qty: number, reorder: number): StatusVariant {
  if (qty <= 0) return "error";
  if (qty <= reorder) return "running";
  return "approved";
}

function stockStatusLabel(qty: number, reorder: number): string {
  if (qty <= 0) return "Out of Stock";
  if (qty <= reorder) return "Low Stock";
  return "Optimal";
}

function assetStatusBadge(status: string): StatusVariant {
  if (status === "under_maintenance" || status === "damaged") return "error";
  if (status === "in_use") return "active";
  if (status === "available") return "approved";
  return "draft";
}

function expiryBadge(dateStr?: string): StatusVariant | null {
  if (!dateStr) return null;
  if (isExpired(dateStr)) return "error";
  const d = new Date(dateStr);
  const now = new Date();
  const diff = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (diff > 0 && diff <= 90) return "running";
  return null;
}

// ---------- main component ----------

export default function InventoryPage() {
  const { me } = useAuth();
  const isSuperAdmin = me?.roles?.some((r) => r.code === "super_admin") ?? false;

  const [activeTab, setActiveTab] = useState<"pharmacy" | "lab" | "assets">("pharmacy");
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");

  // Data
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [alerts, setAlerts] = useState<PharmacyAlerts | null>(null);
  const [labConsumables, setLabConsumables] = useState<LabConsumable[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [medicineBatches, setMedicineBatches] = useState<Record<string, Batch[]>>({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const toast = useToast();

  // Modal state per tab
  const [showPharmacyModal, setShowPharmacyModal] = useState(false);
  const [showLabModal, setShowLabModal] = useState(false);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [statusTarget, setStatusTarget] = useState<Asset | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [saving, setSaving] = useState(false);

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editType, setEditType] = useState<"pharmacy" | "lab">("pharmacy");
  const [editId, setEditId] = useState("");
  const [editForm, setEditForm] = useState({
    // pharmacy fields
    genericName: "", brand: "", strength: "", dosageForm: "", category: "", reorderLevel: "", unitCost: "", sellingPrice: "",
    // lab fields
    name: "", packagingUnit: "", batchLotNumber: "", quantityOnHand: "", storageLocation: "", supplier: "", expiryDate: "",
  });

  // Pharmacy form
  const [phForm, setPhForm] = useState({
    genericName: "", brand: "", strength: "", dosageForm: "", category: "",
    batchNumber: "", expiryDate: "", reorderLevel: "", unitCost: "", sellingPrice: "", initialStock: "",
  });

  // Lab form
  const [labForm, setLabForm] = useState({
    name: "", category: "", packagingUnit: "", batchLotNumber: "",
    reorderLevel: "", unitCost: "", quantityOnHand: "", storageLocation: "", supplier: "", expiryDate: "",
  });

  // Asset form
  const [assetForm, setAssetForm] = useState({
    name: "", categoryId: "", serialNumber: "", location: "",
    cost: "", quantityOnHand: "", notes: "",
  });

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [medRes, alertRes, labRes, assetRes, catRes] = await Promise.allSettled([
      apiFetch<Medicine[]>("/pharmacy/medicines"),
      apiFetch<PharmacyAlerts>("/pharmacy/alerts"),
      apiFetch<LabConsumable[]>("/lab-consumables"),
      apiFetch<Asset[]>("/assets"),
      apiFetch<AssetCategory[]>("/assets/categories"),
    ]);
    const errors: string[] = [];
    if (medRes.status === "fulfilled") setMedicines(medRes.value);
    else errors.push(medRes.reason instanceof Error ? medRes.reason.message : "Could not load medicines.");
    if (alertRes.status === "fulfilled") setAlerts(alertRes.value);
    else errors.push(alertRes.reason instanceof Error ? alertRes.reason.message : "Could not load alerts.");
    if (labRes.status === "fulfilled") setLabConsumables(labRes.value);
    else errors.push(labRes.reason instanceof Error ? labRes.reason.message : "Could not load lab consumables.");
    if (assetRes.status === "fulfilled") setAssets(assetRes.value);
    else errors.push(assetRes.reason instanceof Error ? assetRes.reason.message : "Could not load assets.");
    if (catRes.status === "fulfilled") setCategories(catRes.value);
    else errors.push(catRes.reason instanceof Error ? catRes.reason.message : "Could not load categories.");
    setError(errors.join(" "));
    setLoading(false);

    // Pre-load batch info for all medicines
    if (medRes.status === "fulfilled") {
      const batchMap: Record<string, Batch[]> = {};
      await Promise.allSettled(
        medRes.value.map(async (m) => {
          try {
            const detail = await apiFetch<{ medicine: Medicine; batches: Batch[] }>(`/pharmacy/medicines/${m.id}`);
            batchMap[m.id] = detail.batches;
          } catch {
            batchMap[m.id] = [];
          }
        }),
      );
      setMedicineBatches(batchMap);
    }
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // --- status change (replaces window.prompt) ---
  function openStatusModal(a: Asset) {
    setStatusTarget(a);
    setStatusReason("");
    setShowStatusModal(true);
  }

  async function handleStatusChange() {
    if (!statusTarget || !statusReason.trim()) return;
    // Determine target status based on current
    const nextStatus = statusTarget.status === "under_maintenance" ? "available"
      : statusTarget.status === "available" ? "in_use"
      : "under_maintenance";
    setSaving(true);
    try {
      await apiFetch(`/assets/${statusTarget.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status: nextStatus, reason: statusReason.trim() }),
      });
      toast.success(`${statusTarget.name} marked ${nextStatus.replace("_", " ")}.`);
      setShowStatusModal(false);
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update status.");
    } finally {
      setSaving(false);
    }
  }

  // --- edit pharmacy item ---
  function openEditPharmacy(m: Medicine) {
    setEditType("pharmacy");
    setEditId(m.id);
    setEditForm({
      genericName: m.genericName, brand: m.brand, strength: m.strength, dosageForm: m.dosageForm,
      category: m.category, reorderLevel: String(m.reorderLevel), unitCost: String(m.unitCost),
      sellingPrice: String(m.sellingPrice), name: "", packagingUnit: "", batchLotNumber: "",
      quantityOnHand: "", storageLocation: "", supplier: "", expiryDate: "",
    });
    setShowEditModal(true);
  }

  // --- edit lab consumable ---
  function openEditLab(lc: LabConsumable) {
    setEditType("lab");
    setEditId(lc.id);
    setEditForm({
      name: lc.name, category: lc.category, packagingUnit: lc.packagingUnit,
      batchLotNumber: lc.batchLotNumber, reorderLevel: String(lc.reorderLevel),
      unitCost: String(lc.unitCost), quantityOnHand: String(lc.quantityOnHand),
      storageLocation: lc.storageLocation, supplier: lc.supplier, expiryDate: lc.expiryDate ?? "",
      genericName: "", brand: "", strength: "", dosageForm: "", sellingPrice: "",
    });
    setShowEditModal(true);
  }

  async function handleEditSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editType === "pharmacy") {
        await apiFetch(`/pharmacy/medicines/${editId}`, {
          method: "PATCH",
          body: JSON.stringify({
            genericName: editForm.genericName, brand: editForm.brand, strength: editForm.strength,
            dosageForm: editForm.dosageForm, category: editForm.category, supplier: "",
            reorderLevel: Number(editForm.reorderLevel) || 0, storageLocation: "",
            unitCost: Number(editForm.unitCost) || 0, sellingPrice: Number(editForm.sellingPrice) || 0,
          }),
        });
        toast.success("Medicine updated.");
      } else {
        await apiFetch(`/lab-consumables/${editId}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: editForm.name, category: editForm.category, packagingUnit: editForm.packagingUnit,
            batchLotNumber: editForm.batchLotNumber, reorderLevel: Number(editForm.reorderLevel) || 0,
            unitCost: Number(editForm.unitCost) || 0, quantityOnHand: Number(editForm.quantityOnHand) || 0,
            storageLocation: editForm.storageLocation, supplier: editForm.supplier, expiryDate: editForm.expiryDate,
          }),
        });
        toast.success("Lab consumable updated.");
      }
      setShowEditModal(false);
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update item.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(type: "pharmacy" | "lab", id: string, name: string) {
    if (!confirm(`Are you sure you want to delete "${name}"? This action requires super admin privileges.`)) return;
    setSaving(true);
    try {
      if (type === "pharmacy") {
        await apiFetch(`/pharmacy/medicines/${id}`, { method: "DELETE" });
        toast.success(`"${name}" deleted.`);
      } else {
        await apiFetch(`/lab-consumables/${id}`, { method: "DELETE" });
        toast.success(`"${name}" deleted.`);
      }
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete item.");
    } finally {
      setSaving(false);
    }
  }

  // --- add pharmacy item ---
  async function handleAddPharmacy(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch("/pharmacy/medicines", {
        method: "POST",
        body: JSON.stringify({
          genericName: phForm.genericName, brand: phForm.brand, strength: phForm.strength,
          dosageForm: phForm.dosageForm, category: phForm.category, supplier: "",
          reorderLevel: Number(phForm.reorderLevel) || 0, storageLocation: "",
          unitCost: Number(phForm.unitCost) || 0, sellingPrice: Number(phForm.sellingPrice) || 0,
        }),
      });
      // If initial stock provided, receive it
      if (phForm.initialStock && Number(phForm.initialStock) > 0) {
        // We need the medicine ID - reload to get it
        await loadAll();
        const newMed = medicines.find((m) => m.genericName === phForm.genericName);
        if (newMed && phForm.batchNumber) {
          await apiFetch("/pharmacy/receipts", {
            method: "POST",
            body: JSON.stringify({
              medicineId: newMed.id, batchNumber: phForm.batchNumber,
              expiryDate: phForm.expiryDate, quantity: Number(phForm.initialStock),
              purchaseCost: Number(phForm.unitCost) || 0, sellingPrice: Number(phForm.sellingPrice) || 0,
              supplier: "",
            }),
          });
        }
      }
      setShowPharmacyModal(false);
      setPhForm({ genericName: "", brand: "", strength: "", dosageForm: "", category: "", batchNumber: "", expiryDate: "", reorderLevel: "", unitCost: "", sellingPrice: "", initialStock: "" });
      await loadAll();
      toast.success("Drug SKU added.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save item.");
    } finally {
      setSaving(false);
    }
  }

  // --- add lab consumable ---
  async function handleAddLab(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch("/lab-consumables", {
        method: "POST",
        body: JSON.stringify({
          name: labForm.name, category: labForm.category, packagingUnit: labForm.packagingUnit,
          batchLotNumber: labForm.batchLotNumber, reorderLevel: Number(labForm.reorderLevel) || 0,
          unitCost: Number(labForm.unitCost) || 0, quantityOnHand: Number(labForm.quantityOnHand) || 0,
          storageLocation: labForm.storageLocation, supplier: labForm.supplier, expiryDate: labForm.expiryDate,
        }),
      });
      setShowLabModal(false);
      setLabForm({ name: "", category: "", packagingUnit: "", batchLotNumber: "", reorderLevel: "", unitCost: "", quantityOnHand: "", storageLocation: "", supplier: "", expiryDate: "" });
      await loadAll();
      toast.success("Lab consumable added.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save item.");
    } finally {
      setSaving(false);
    }
  }

  // --- add asset ---
  async function handleAddAsset(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch("/assets", {
        method: "POST",
        body: JSON.stringify({
          name: assetForm.name, categoryId: assetForm.categoryId, serialNumber: assetForm.serialNumber,
          manufacturer: "", supplier: "", purchaseDate: "",
          cost: Number(assetForm.cost) || 0, location: assetForm.location,
          departmentId: "", custodianId: "", condition: "good", warrantyExpiry: "",
          quantityOnHand: Number(assetForm.quantityOnHand) || 1, notes: assetForm.notes,
        }),
      });
      setShowAssetModal(false);
      setAssetForm({ name: "", categoryId: "", serialNumber: "", location: "", cost: "", quantityOnHand: "", notes: "" });
      await loadAll();
      toast.success("Asset tag added.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save item.");
    } finally {
      setSaving(false);
    }
  }

  // --- filters ---
  const filteredMedicines = medicines.filter((m) =>
    !searchTerm || m.genericName.toLowerCase().includes(searchTerm.toLowerCase()) || m.code.toLowerCase().includes(searchTerm.toLowerCase()) || m.category.toLowerCase().includes(searchTerm.toLowerCase()),
  );
  const filteredLab = labConsumables.filter((lc) =>
    !searchTerm || lc.name.toLowerCase().includes(searchTerm.toLowerCase()) || lc.itemCode.toLowerCase().includes(searchTerm.toLowerCase()) || lc.category.toLowerCase().includes(searchTerm.toLowerCase()),
  );
  const filteredAssets = assets.filter((a) =>
    (categoryFilter === "ALL" || a.categoryId === categoryFilter) &&
    (!searchTerm || a.name.toLowerCase().includes(searchTerm.toLowerCase()) || a.assetNo.toLowerCase().includes(searchTerm.toLowerCase()) || a.serialNumber.toLowerCase().includes(searchTerm.toLowerCase())),
  );

  const lowStockCount = alerts?.lowStock.length ?? 0;
  const expiringCount = (alerts?.expiring.length ?? 0) + (alerts?.expired.length ?? 0);
  const underMaintCount = assets.filter((a) => a.status === "under_maintenance").length;
  const totalAssetValue = assets.reduce((acc, a) => acc + a.cost, 0);
  const labLowCount = labConsumables.filter((lc) => lc.quantityOnHand <= lc.reorderLevel && lc.reorderLevel > 0).length;

  // --- pharmacy columns ---
  const pharmacyColumns = [
    {
      key: "code", header: "SKU / Code",
      render: (m: Medicine) => <strong style={{ color: theme.action.info, fontFamily: "monospace" }}>{m.code}</strong>,
    },
    {
      key: "name", header: "Medication",
      render: (m: Medicine) => (
        <div>
          <div style={{ fontWeight: theme.fontWeight.semibold, color: theme.text.primary }}>{m.genericName}</div>
          {m.brand && <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>{m.brand}</div>}
        </div>
      ),
    },
    { key: "category", header: "Category", render: (m: Medicine) => m.category || "---" },
    { key: "strength", header: "Strength / Form", render: (m: Medicine) => [m.strength, m.dosageForm].filter(Boolean).join(", ") || "---" },
    {
      key: "batch", header: "Batch / Expiry",
      render: (m: Medicine) => {
        const batches = medicineBatches[m.id] || [];
        if (batches.length === 0) return <span style={{ color: theme.text.muted }}>No batches</span>;
        // Show earliest expiry batch
        const sorted = [...batches].sort((a, b) => {
          if (!a.expiryDate) return 1;
          if (!b.expiryDate) return -1;
          return a.expiryDate.localeCompare(b.expiryDate);
        });
        const earliest = sorted[0];
        return (
          <div>
            <div style={{ fontFamily: "monospace", fontSize: theme.fontSize.sm }}>{earliest.batchNumber}</div>
            <div style={{ fontSize: theme.fontSize.sm, color: isExpired(earliest.expiryDate) ? theme.text.danger : theme.text.muted }}>
              {earliest.expiryDate ?? "---"}
              {isExpired(earliest.expiryDate) && <StatusBadge variant="error" label="Expired" />}
            </div>
            {batches.length > 1 && <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted }}>{batches.length} batches</div>}
          </div>
        );
      },
    },
    { key: "reorder", header: "Reorder Level", render: (m: Medicine) => m.reorderLevel },
    { key: "unitCost", header: "Unit Cost (NGN)", render: (m: Medicine) => CURRENCY(m.unitCost) },
    { key: "sellPrice", header: "Selling Price (NGN)", render: (m: Medicine) => <strong>{CURRENCY(m.sellingPrice)}</strong> },
    {
      key: "stock", header: "Stock Balance",
      render: (m: Medicine) => {
        const low = alerts?.lowStock.find((l) => l.medicine.id === m.id);
        const qty = low?.totalQuantity ?? 0;
        return <strong style={{ color: qty <= 0 ? theme.text.danger : qty <= m.reorderLevel ? theme.text.warning : theme.text.primary }}>{qty}</strong>;
      },
    },
    {
      key: "status", header: "Status",
      render: (m: Medicine) => {
        const low = alerts?.lowStock.find((l) => l.medicine.id === m.id);
        const qty = low?.totalQuantity ?? 0;
        return <StatusBadge variant={stockStatus(qty, m.reorderLevel)} label={stockStatusLabel(qty, m.reorderLevel)} />;
      },
    },
    ...(isSuperAdmin ? [{
      key: "actions", header: "Actions",
      render: (m: Medicine) => (
        <div style={{ display: "flex", gap: theme.spacing["1"] }}>
          <Button size="sm" onClick={() => openEditPharmacy(m)}>Edit</Button>
          <Button size="sm" style={{ color: theme.text.danger }} onClick={() => handleDelete("pharmacy", m.id, m.genericName)}>Delete</Button>
        </div>
      ),
    }] : []),
  ];

  // --- lab columns ---
  const labColumns = [
    {
      key: "code", header: "Item Code",
      render: (lc: LabConsumable) => <strong style={{ color: theme.action.info, fontFamily: "monospace" }}>{lc.itemCode}</strong>,
    },
    {
      key: "name", header: "Consumable Name",
      render: (lc: LabConsumable) => <span style={{ fontWeight: theme.fontWeight.semibold }}>{lc.name}</span>,
    },
    { key: "category", header: "Category", render: (lc: LabConsumable) => lc.category || "---" },
    { key: "packaging", header: "Packaging Unit", render: (lc: LabConsumable) => lc.packagingUnit || "---" },
    { key: "batch", header: "Batch / Lot", render: (lc: LabConsumable) => <span style={{ fontFamily: "monospace" }}>{lc.batchLotNumber || "---"}</span> },
    { key: "reorder", header: "Reorder Level", render: (lc: LabConsumable) => lc.reorderLevel },
    { key: "price", header: "Unit Cost (NGN)", render: (lc: LabConsumable) => <strong>{CURRENCY(lc.unitCost)}</strong> },
    { key: "qty", header: "Stock Balance", render: (lc: LabConsumable) => <strong>{lc.quantityOnHand}</strong> },
    { key: "location", header: "Location", render: (lc: LabConsumable) => lc.storageLocation || "---" },
    {
      key: "status", header: "Status",
      render: (lc: LabConsumable) => {
        if (lc.quantityOnHand <= 0) return <StatusBadge variant="error" label="Out of Stock" />;
        if (lc.reorderLevel > 0 && lc.quantityOnHand <= lc.reorderLevel) return <StatusBadge variant="running" label="Low Stock" />;
        return <StatusBadge variant="approved" label="Available" />;
      },
    },
    ...(isSuperAdmin ? [{
      key: "actions", header: "Actions",
      render: (lc: LabConsumable) => (
        <div style={{ display: "flex", gap: theme.spacing["1"] }}>
          <Button size="sm" onClick={() => openEditLab(lc)}>Edit</Button>
          <Button size="sm" style={{ color: theme.text.danger }} onClick={() => handleDelete("lab", lc.id, lc.name)}>Delete</Button>
        </div>
      ),
    }] : []),
  ];

  // --- asset columns ---
  const assetColumns = [
    {
      key: "tag", header: "Asset Tag",
      render: (a: Asset) => <strong style={{ color: theme.action.info }}>{a.assetNo}</strong>,
    },
    {
      key: "name", header: "Equipment Name",
      render: (a: Asset) => <span style={{ fontWeight: theme.fontWeight.semibold }}>{a.name}</span>,
    },
    { key: "category", header: "Category", render: (a: Asset) => a.categoryName },
    { key: "serial", header: "Serial Number", render: (a: Asset) => <span style={{ fontFamily: "monospace" }}>{a.serialNumber || "---"}</span> },
    { key: "dept", header: "Department / Location", render: (a: Asset) => a.departmentName || a.location || "---" },
    { key: "value", header: "Valuation (NGN)", render: (a: Asset) => <strong>{CURRENCY(a.cost)}</strong> },
    {
      key: "status", header: "Status",
      render: (a: Asset) => <StatusBadge variant={assetStatusBadge(a.status)} label={a.status.replace("_", " ")} />,
    },
    {
      key: "actions", header: "Actions",
      render: (a: Asset) => (
        <div style={{ display: "flex", gap: theme.spacing["1"], flexWrap: "wrap" }}>
          {a.status !== "under_maintenance" && a.status !== "disposed" && (
            <Button size="sm" onClick={() => openStatusModal(a)}>
              {a.status === "available" ? "Mark In Use" : "Mark Maintenance"}
            </Button>
          )}
          {a.status === "under_maintenance" && (
            <Button size="sm" onClick={() => openStatusModal(a)}>Mark Available</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}>
      <PageHeader
        title="Hospital Inventory & Assets"
        description="Centralized stock tracking, reorder thresholds, and asset management."
        actions={
          <Button onClick={() => {
            if (activeTab === "pharmacy") setShowPharmacyModal(true);
            else if (activeTab === "lab") setShowLabModal(true);
            else setShowAssetModal(true);
          }}>
            + Add {activeTab === "pharmacy" ? "Drug SKU" : activeTab === "lab" ? "Lab Consumable" : "Asset Tag"}
          </Button>
        }
      />

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: theme.spacing["4"] }}>
        <KpiCard label="Pharmacy Low Stock" value={`${lowStockCount} SKUs`} accent={lowStockCount > 0 ? theme.action.danger : theme.action.success} />
        <KpiCard label="Expiring / Expired" value={`${expiringCount} Batches`} accent={expiringCount > 0 ? theme.action.warning : theme.action.success} />
        <KpiCard label="Lab Consumables" value={`${labConsumables.length} Items`} accent={theme.action.info} />
        <KpiCard label="Lab Low Stock" value={`${labLowCount} Items`} accent={labLowCount > 0 ? theme.action.warning : theme.action.success} />
        <KpiCard label="Assets Under Service" value={`${underMaintCount} Units`} accent={underMaintCount > 0 ? theme.action.warning : theme.action.success} />
        <KpiCard label="Total Asset Value" value={CURRENCY(totalAssetValue)} accent={theme.action.secondary} />
      </div>

      {/* Tab Nav + Search */}
      <Card bodyStyle={{ padding: theme.spacing["4"] }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: theme.spacing["4"], marginBottom: theme.spacing["3"] }}>
          <TabNav
            tabs={[
              { key: "pharmacy", label: `Pharmacy (${medicines.length})` },
              { key: "lab", label: `Laboratory (${labConsumables.length})` },
              { key: "assets", label: `Hospital Assets (${assets.length})` },
            ]}
            active={activeTab}
            onChange={(k) => { setActiveTab(k as "pharmacy" | "lab" | "assets"); setSearchTerm(""); setCategoryFilter("ALL"); }}
          />
        </div>
        <div style={{ display: "flex", gap: theme.spacing["2"] }}>
          <Input
            type="text"
            placeholder={activeTab === "pharmacy" ? "Search by name, code, or category..." : activeTab === "lab" ? "Search by name, code, or category..." : "Search by name, tag, or serial..."}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ flex: 1 }}
          />
          {activeTab === "assets" && (
            <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="ALL">All Categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
        </div>
      </Card>

      {error && <p role="alert" style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.danger }}>{error}</p>}
      {loading && <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>Loading inventory data...</p>}

      {/* Pharmacy Table */}
      {!loading && activeTab === "pharmacy" && (
        <Card bodyStyle={{ padding: 0 }}>
          {filteredMedicines.length === 0 ? (
            <EmptyState icon="pill" description="No medicines match your search." />
          ) : (
            <DataTable columns={pharmacyColumns} rows={filteredMedicines} rowKey={(m) => m.id} dense expandable={(m) => <BatchDetailView medicine={m} />} />
          )}
        </Card>
      )}

      {/* Lab Consumables Table */}
      {!loading && activeTab === "lab" && (
        <Card bodyStyle={{ padding: 0 }}>
          {filteredLab.length === 0 ? (
            <EmptyState icon="box" description="No lab consumables on file yet." />
          ) : (
            <DataTable columns={labColumns} rows={filteredLab} rowKey={(lc) => lc.id} dense />
          )}
        </Card>
      )}

      {/* Assets Table */}
      {!loading && activeTab === "assets" && (
        <Card bodyStyle={{ padding: 0 }}>
          {filteredAssets.length === 0 ? (
            <EmptyState icon="box" description="No assets match your search." />
          ) : (
            <DataTable columns={assetColumns} rows={filteredAssets} rowKey={(a) => a.id} dense />
          )}
        </Card>
      )}

      {/* Status Change Modal (replaces window.prompt) */}
      <Modal open={showStatusModal} title="Change Asset Status" onClose={() => setShowStatusModal(false)} width={480}
        footer={<>
          <Button variant="ghost" onClick={() => setShowStatusModal(false)}>Cancel</Button>
          <Button loading={saving} onClick={handleStatusChange}>Confirm</Button>
        </>}
      >
        {statusTarget && (
          <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["3"] }}>
            <div style={{ fontSize: theme.fontSize.base, color: theme.text.primary }}>
              <strong>{statusTarget.name}</strong> ({statusTarget.assetNo})
            </div>
            <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
              Current status: {statusTarget.status.replace("_", " ")}
            </div>
            <FormField label="Reason for status change" required>
              <Input required value={statusReason} onChange={(e) => setStatusReason(e.target.value)} placeholder="Enter reason..." />
            </FormField>
          </div>
        )}
      </Modal>

      {/* Add Pharmacy Modal */}
      <Modal open={showPharmacyModal} title="Add New Drug SKU" onClose={() => setShowPharmacyModal(false)} width={560}
        footer={<>
          <Button variant="ghost" onClick={() => setShowPharmacyModal(false)}>Cancel</Button>
          <Button type="submit" form="add-pharmacy-form" loading={saving}>Save Drug SKU</Button>
        </>}
      >
        <form id="add-pharmacy-form" onSubmit={handleAddPharmacy} style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
          <FormField label="Generic Name" required>
            <Input required value={phForm.genericName} onChange={(e) => setPhForm({ ...phForm, genericName: e.target.value })} placeholder="e.g. Paracetamol" />
          </FormField>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}>
            <FormField label="Category">
              <Input value={phForm.category} onChange={(e) => setPhForm({ ...phForm, category: e.target.value })} placeholder="e.g. Antibiotics" />
            </FormField>
            <FormField label="Strength">
              <Input value={phForm.strength} onChange={(e) => setPhForm({ ...phForm, strength: e.target.value })} placeholder="e.g. 500mg" />
            </FormField>
            <FormField label="Dosage Form">
              <Input value={phForm.dosageForm} onChange={(e) => setPhForm({ ...phForm, dosageForm: e.target.value })} placeholder="e.g. Tablet" />
            </FormField>
            <FormField label="Batch Number">
              <Input value={phForm.batchNumber} onChange={(e) => setPhForm({ ...phForm, batchNumber: e.target.value })} placeholder="e.g. BAT-2026-001" />
            </FormField>
            <FormField label="Expiry Date">
              <Input type="date" value={phForm.expiryDate} onChange={(e) => setPhForm({ ...phForm, expiryDate: e.target.value })} />
            </FormField>
            <FormField label="Reorder Level">
              <Input type="number" min={0} value={phForm.reorderLevel} onChange={(e) => setPhForm({ ...phForm, reorderLevel: e.target.value })} />
            </FormField>
            <FormField label="Unit Cost (NGN)">
              <Input type="number" min={0} value={phForm.unitCost} onChange={(e) => setPhForm({ ...phForm, unitCost: e.target.value })} />
            </FormField>
            <FormField label="Selling Price (NGN)">
              <Input type="number" min={0} value={phForm.sellingPrice} onChange={(e) => setPhForm({ ...phForm, sellingPrice: e.target.value })} />
            </FormField>
            <FormField label="Initial Stock Quantity">
              <Input type="number" min={0} value={phForm.initialStock} onChange={(e) => setPhForm({ ...phForm, initialStock: e.target.value })} placeholder="Opening inventory count" />
            </FormField>
          </div>
        </form>
      </Modal>

      {/* Add Lab Consumable Modal */}
      <Modal open={showLabModal} title="Add New Lab Consumable" onClose={() => setShowLabModal(false)} width={560}
        footer={<>
          <Button variant="ghost" onClick={() => setShowLabModal(false)}>Cancel</Button>
          <Button type="submit" form="add-lab-form" loading={saving}>Save Consumable</Button>
        </>}
      >
        <form id="add-lab-form" onSubmit={handleAddLab} style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
          <FormField label="Item Name" required>
            <Input required value={labForm.name} onChange={(e) => setLabForm({ ...labForm, name: e.target.value })} placeholder="e.g. EDTA Vacutainer Tubes" />
          </FormField>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}>
            <FormField label="Category">
              <Select value={labForm.category} onChange={(e) => setLabForm({ ...labForm, category: e.target.value })}>
                <option value="">Select category...</option>
                <option value="Phlebotomy">Phlebotomy</option>
                <option value="Reagents">Reagents</option>
                <option value="Consumables & PPE">Consumables & PPE</option>
                <option value="Glassware">Glassware</option>
              </Select>
            </FormField>
            <FormField label="Packaging Unit">
              <Input value={labForm.packagingUnit} onChange={(e) => setLabForm({ ...labForm, packagingUnit: e.target.value })} placeholder="e.g. Box of 100" />
            </FormField>
            <FormField label="Batch / Lot Number">
              <Input value={labForm.batchLotNumber} onChange={(e) => setLabForm({ ...labForm, batchLotNumber: e.target.value })} placeholder="e.g. LOT-2026-001" />
            </FormField>
            <FormField label="Initial Quantity">
              <Input type="number" min={0} value={labForm.quantityOnHand} onChange={(e) => setLabForm({ ...labForm, quantityOnHand: e.target.value })} />
            </FormField>
            <FormField label="Reorder Level">
              <Input type="number" min={0} value={labForm.reorderLevel} onChange={(e) => setLabForm({ ...labForm, reorderLevel: e.target.value })} />
            </FormField>
            <FormField label="Unit Cost (NGN)">
              <Input type="number" min={0} value={labForm.unitCost} onChange={(e) => setLabForm({ ...labForm, unitCost: e.target.value })} />
            </FormField>
            <FormField label="Storage Location">
              <Input value={labForm.storageLocation} onChange={(e) => setLabForm({ ...labForm, storageLocation: e.target.value })} placeholder="e.g. Main Lab, Cold Storage" />
            </FormField>
            <FormField label="Expiry Date">
              <Input type="date" value={labForm.expiryDate} onChange={(e) => setLabForm({ ...labForm, expiryDate: e.target.value })} />
            </FormField>
          </div>
        </form>
      </Modal>

      {/* Add Asset Modal */}
      <Modal open={showAssetModal} title="Add New Asset Tag" onClose={() => setShowAssetModal(false)} width={560}
        footer={<>
          <Button variant="ghost" onClick={() => setShowAssetModal(false)}>Cancel</Button>
          <Button type="submit" form="add-asset-form" loading={saving}>Save Asset</Button>
        </>}
      >
        <form id="add-asset-form" onSubmit={handleAddAsset} style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
          <FormField label="Equipment Name" required>
            <Input required value={assetForm.name} onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })} placeholder="e.g. Patient Monitor" />
          </FormField>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}>
            <FormField label="Category" required>
              <Select required value={assetForm.categoryId} onChange={(e) => setAssetForm({ ...assetForm, categoryId: e.target.value })}>
                <option value="">Select category...</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </FormField>
            <FormField label="Serial Number">
              <Input value={assetForm.serialNumber} onChange={(e) => setAssetForm({ ...assetForm, serialNumber: e.target.value })} placeholder="Manufacturer serial" />
            </FormField>
            <FormField label="Department / Location">
              <Input value={assetForm.location} onChange={(e) => setAssetForm({ ...assetForm, location: e.target.value })} placeholder="e.g. ICU, Theatre 1" />
            </FormField>
            <FormField label="Purchase Valuation (NGN)">
              <Input type="number" min={0} value={assetForm.cost} onChange={(e) => setAssetForm({ ...assetForm, cost: e.target.value })} />
            </FormField>
            <FormField label="Initial Quantity">
              <Input type="number" min={1} value={assetForm.quantityOnHand} onChange={(e) => setAssetForm({ ...assetForm, quantityOnHand: e.target.value })} />
            </FormField>
            <FormField label="Notes">
              <Input value={assetForm.notes} onChange={(e) => setAssetForm({ ...assetForm, notes: e.target.value })} placeholder="Maintenance cycle, install date..." />
            </FormField>
          </div>
        </form>
      </Modal>

      {/* Edit Modal (super admin only) */}
      {isSuperAdmin && (
        <Modal open={showEditModal} title={`Edit ${editType === "pharmacy" ? "Drug SKU" : "Lab Consumable"}`} onClose={() => setShowEditModal(false)} width={560}
          footer={<>
            <Button variant="ghost" onClick={() => setShowEditModal(false)}>Cancel</Button>
            <Button type="submit" form="edit-form" loading={saving}>Save Changes</Button>
          </>}
        >
          <form id="edit-form" onSubmit={handleEditSave} style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
            {editType === "pharmacy" ? (
              <>
                <FormField label="Generic Name" required>
                  <Input required value={editForm.genericName} onChange={(e) => setEditForm({ ...editForm, genericName: e.target.value })} />
                </FormField>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}>
                  <FormField label="Category">
                    <Input value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} />
                  </FormField>
                  <FormField label="Strength">
                    <Input value={editForm.strength} onChange={(e) => setEditForm({ ...editForm, strength: e.target.value })} />
                  </FormField>
                  <FormField label="Dosage Form">
                    <Input value={editForm.dosageForm} onChange={(e) => setEditForm({ ...editForm, dosageForm: e.target.value })} />
                  </FormField>
                  <FormField label="Reorder Level">
                    <Input type="number" min={0} value={editForm.reorderLevel} onChange={(e) => setEditForm({ ...editForm, reorderLevel: e.target.value })} />
                  </FormField>
                  <FormField label="Unit Cost (NGN)">
                    <Input type="number" min={0} value={editForm.unitCost} onChange={(e) => setEditForm({ ...editForm, unitCost: e.target.value })} />
                  </FormField>
                  <FormField label="Selling Price (NGN)">
                    <Input type="number" min={0} value={editForm.sellingPrice} onChange={(e) => setEditForm({ ...editForm, sellingPrice: e.target.value })} />
                  </FormField>
                </div>
              </>
            ) : (
              <>
                <FormField label="Item Name" required>
                  <Input required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                </FormField>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}>
                  <FormField label="Category">
                    <Select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}>
                      <option value="">Select...</option>
                      <option value="Phlebotomy">Phlebotomy</option>
                      <option value="Reagents">Reagents</option>
                      <option value="Consumables & PPE">Consumables & PPE</option>
                      <option value="Glassware">Glassware</option>
                    </Select>
                  </FormField>
                  <FormField label="Packaging Unit">
                    <Input value={editForm.packagingUnit} onChange={(e) => setEditForm({ ...editForm, packagingUnit: e.target.value })} />
                  </FormField>
                  <FormField label="Batch / Lot Number">
                    <Input value={editForm.batchLotNumber} onChange={(e) => setEditForm({ ...editForm, batchLotNumber: e.target.value })} />
                  </FormField>
                  <FormField label="Quantity on Hand">
                    <Input type="number" min={0} value={editForm.quantityOnHand} onChange={(e) => setEditForm({ ...editForm, quantityOnHand: e.target.value })} />
                  </FormField>
                  <FormField label="Reorder Level">
                    <Input type="number" min={0} value={editForm.reorderLevel} onChange={(e) => setEditForm({ ...editForm, reorderLevel: e.target.value })} />
                  </FormField>
                  <FormField label="Unit Cost (NGN)">
                    <Input type="number" min={0} value={editForm.unitCost} onChange={(e) => setEditForm({ ...editForm, unitCost: e.target.value })} />
                  </FormField>
                  <FormField label="Storage Location">
                    <Input value={editForm.storageLocation} onChange={(e) => setEditForm({ ...editForm, storageLocation: e.target.value })} />
                  </FormField>
                  <FormField label="Expiry Date">
                    <Input type="date" value={editForm.expiryDate} onChange={(e) => setEditForm({ ...editForm, expiryDate: e.target.value })} />
                  </FormField>
                </div>
              </>
            )}
          </form>
        </Modal>
      )}
    </div>
  );
}

// ---------- sub-components ----------

function KpiCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <Card bodyStyle={{ padding: theme.spacing["4"], borderLeft: `4px solid ${accent}` }}>
      <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, fontWeight: theme.fontWeight.bold }}>{label}</div>
      <div style={{ fontSize: "1.25rem", fontWeight: theme.fontWeight.bold, color: theme.text.primary, marginTop: theme.spacing["1"] }}>{value}</div>
    </Card>
  );
}

// ---------- batch detail view ----------

const th: CSSProperties = { padding: "0.5rem", textAlign: "left" };
const td: CSSProperties = { padding: "0.5rem", color: theme.text.secondary, verticalAlign: "top" };

function BatchDetailView({ medicine: m }: { medicine: Medicine }) {
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ medicine: Medicine; batches: Batch[] }>(`/pharmacy/medicines/${m.id}`)
      .then((d) => { if (!cancelled) setBatches(d.batches); })
      .catch((err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load batches."); });
    return () => { cancelled = true; };
  }, [m.id]);
  if (loadError) return <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.danger }}>{loadError}</p>;
  if (!batches) return <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>Loading batches...</p>;
  if (batches.length === 0) return <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>No batches received yet.</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: theme.fontSize.base }}>
        <thead>
          <tr style={{ color: theme.text.muted, borderBottom: `1px solid ${theme.surface.border}` }}>
            <th style={th}>Batch No.</th>
            <th style={th}>Expiry Date</th>
            <th style={th}>On Hand</th>
            <th style={th}>Unit Cost</th>
            <th style={th}>Selling</th>
            <th style={th}>Supplier</th>
            <th style={th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => {
            const eb = expiryBadge(b.expiryDate);
            return (
              <tr key={b.id} style={{ borderBottom: `1px solid ${theme.surface.border}` }}>
                <td style={{ ...td, fontFamily: "monospace" }}>{b.batchNumber}</td>
                <td style={{ ...td, color: isExpired(b.expiryDate) ? theme.text.danger : theme.text.secondary }}>
                  {b.expiryDate ?? "---"}
                  {eb && <StatusBadge variant={eb} label={isExpired(b.expiryDate) ? "Expired" : "Expiring"} />}
                </td>
                <td style={{ ...td, fontWeight: theme.fontWeight.semibold, color: b.quantityOnHand <= 0 ? theme.text.danger : theme.text.primary }}>{b.quantityOnHand}</td>
                <td style={td}>{CURRENCY(b.purchaseCost)}</td>
                <td style={td}>{CURRENCY(b.sellingPrice)}</td>
                <td style={td}>{b.supplier || "---"}</td>
                <td style={td}><StatusBadge variant={b.status === "active" ? "approved" : "error"} label={b.status} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
