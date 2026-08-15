"use client";

import React, { useState } from "react";

interface PharmacyItem {
  id: string;
  name: string;
  category: string;
  batch: string;
  qty: number;
  status: string;
  price: string;
}

interface LabItem {
  id: string;
  name: string;
  category: string;
  lot: string;
  qty: number;
  status: string;
  expiry: string;
}

interface AssetItem {
  id: string;
  name: string;
  dept: string;
  serial: string;
  status: string;
  value: string;
}

export default function InventoryPage() {
  const [activeTab, setActiveTab] = useState<"pharmacy" | "lab" | "assets">("pharmacy");
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Initial State Data
  const [pharmacyData, setPharmacyData] = useState<PharmacyItem[]>([
    { id: "PRM-001", name: "Amoxicillin / Clavulanic Acid (Augmentin 625mg)", category: "Antibiotics", batch: "AUG-2026-X9", qty: 140, status: "In Stock", price: "₦4,500" },
    { id: "PRM-002", name: "Paracetamol 500mg IV Infusion (100ml)", category: "Analgesics", batch: "PCM-2026-B1", qty: 18, status: "Low Stock Alert", price: "₦1,200" },
    { id: "PRM-003", name: "Amlodipine Besylate 5mg Tabs", category: "Antihypertensives", batch: "AML-2025-Z4", qty: 85, status: "In Stock", price: "₦2,000" },
    { id: "PRM-004", name: "Propofol 10mg/ml Injection 20ml", category: "Anesthetics", batch: "PRO-2026-01", qty: 12, status: "Low Stock Alert", price: "₦8,500" },
  ]);

  const [labData, setLabData] = useState<LabItem[]>([
    { id: "LAB-001", name: "Cell-Dyna Lyse Reagent 5L", category: "Haematology", lot: "LOT-99201", qty: 4, status: "Low Stock Alert", expiry: "2027-01-15" },
    { id: "LAB-002", name: "Glucose Oxidase Test Strips (x100)", category: "Biochemistry", lot: "LOT-88210", qty: 22, status: "In Stock", expiry: "2026-11-30" },
    { id: "LAB-003", name: "Blood Agar Culture Plates (Pack of 20)", category: "Microbiology", lot: "LOT-33100", qty: 3, status: "Critical", expiry: "2026-09-10" },
  ]);

  const [assetData, setAssetData] = useState<AssetItem[]>([
    { id: "AST-1001", name: "Mindray BeneHeart D3 Defibrillator", dept: "ICU", serial: "SN-DEF-9082", status: "Operational", value: "₦4,800,000" },
    { id: "AST-1002", name: "GE Logiq E9 Ultrasound Scanner", dept: "Radiology", serial: "SN-US-4412", status: "Maintenance Required", value: "₦18,500,000" },
    { id: "AST-1003", name: "Sysmex XN-550 Automated Analyzer", dept: "Laboratory", serial: "SN-HEM-1102", status: "Operational", value: "₦12,000,000" },
  ]);

  // Form State for Adding Items
  const [formData, setFormData] = useState({
    name: "",
    categoryOrDept: "",
    codeOrBatch: "",
    qtyOrValue: "",
    extra: ""
  });

  // Action Handlers
  const handleQtyAdjust = (type: "pharmacy" | "lab", id: string, amount: number) => {
    if (type === "pharmacy") {
      setPharmacyData(prev => prev.map(item => {
        if (item.id === id) {
          const newQty = Math.max(0, item.qty + amount);
          return {
            ...item,
            qty: newQty,
            status: newQty < 20 ? "Low Stock Alert" : "In Stock"
          };
        }
        return item;
      }));
    } else {
      setLabData(prev => prev.map(item => {
        if (item.id === id) {
          const newQty = Math.max(0, item.qty + amount);
          return {
            ...item,
            qty: newQty,
            status: newQty < 5 ? "Low Stock Alert" : "In Stock"
          };
        }
        return item;
      }));
    }
  };

  const handleAssetStatusToggle = (id: string) => {
    setAssetData(prev => prev.map(item => {
      if (item.id === id) {
        return {
          ...item,
          status: item.status === "Operational" ? "Maintenance Required" : "Operational"
        };
      }
      return item;
    }));
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) return;

    if (activeTab === "pharmacy") {
      const newItem: PharmacyItem = {
        id: "PRM-00" + (pharmacyData.length + 1),
        name: formData.name,
        category: formData.categoryOrDept || "General",
        batch: formData.codeOrBatch || "BATCH-2026",
        qty: parseInt(formData.qtyOrValue) || 10,
        status: (parseInt(formData.qtyOrValue) || 10) < 20 ? "Low Stock Alert" : "In Stock",
        price: formData.extra || "₦1,000"
      };
      setPharmacyData([newItem, ...pharmacyData]);
    } else if (activeTab === "lab") {
      const newItem: LabItem = {
        id: "LAB-00" + (labData.length + 1),
        name: formData.name,
        category: formData.categoryOrDept || "General Lab",
        lot: formData.codeOrBatch || "LOT-100",
        qty: parseInt(formData.qtyOrValue) || 5,
        status: "In Stock",
        expiry: formData.extra || "2027-12-31"
      };
      setLabData([newItem, ...labData]);
    } else {
      const newItem: AssetItem = {
        id: "AST-" + (1000 + assetData.length + 1),
        name: formData.name,
        dept: formData.categoryOrDept || "General Ward",
        serial: formData.codeOrBatch || "SN-NEW-000",
        status: "Operational",
        value: formData.extra || "₦1,000,000"
      };
      setAssetData([newItem, ...assetData]);
    }

    setFormData({ name: "", categoryOrDept: "", codeOrBatch: "", qtyOrValue: "", extra: "" });
    setIsModalOpen(false);
  };

  const filteredPharmacy = pharmacyData.filter(i => i.name.toLowerCase().includes(searchTerm.toLowerCase()) || i.id.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredLab = labData.filter(i => i.name.toLowerCase().includes(searchTerm.toLowerCase()) || i.id.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredAssets = assetData.filter(i => i.name.toLowerCase().includes(searchTerm.toLowerCase()) || i.id.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div style={{ padding: "1.5rem", fontFamily: "system-ui, sans-serif", color: "#0f172a", backgroundColor: "#f8fafc", minHeight: "100vh" }}>

      <div style={{ marginBottom: "1.25rem" }}>
        <p style={{ color: "#64748b", margin: 0, fontSize: "0.9rem" }}>
          Centralized stock tracking, reorder thresholds, and asset management across clinical departments.
        </p>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        <div style={{ background: "#fff", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0", borderLeft: "4px solid #dc2626" }}>
          <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700 }}>PHARMACY ALERTS</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#dc2626", marginTop: "0.25rem" }}>
            {pharmacyData.filter(p => p.status.includes("Low")).length} SKUs Low
          </div>
        </div>
        <div style={{ background: "#fff", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0", borderLeft: "4px solid #d97706" }}>
          <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700 }}>LAB REAGENTS</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#d97706", marginTop: "0.25rem" }}>
            {labData.filter(l => l.status.includes("Low") || l.status.includes("Critical")).length} Items Reorder
          </div>
        </div>
        <div style={{ background: "#fff", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0", borderLeft: "4px solid #0284c7" }}>
          <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700 }}>EQUIPMENT SERVICE</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0284c7", marginTop: "0.25rem" }}>
            {assetData.filter(a => a.status.includes("Required")).length} Unit Due
          </div>
        </div>
        <div style={{ background: "#fff", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0", borderLeft: "4px solid #16a34a" }}>
          <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700 }}>TOTAL STOCK VALUE</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0f172a", marginTop: "0.25rem" }}>₦35.8M</div>
        </div>
      </div>

      {/* Navigation Control Panel */}
      <div style={{ background: "#fff", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0", marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginBottom: "1rem" }}>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={() => setActiveTab("pharmacy")} style={{ padding: "0.5rem 1rem", border: "none", background: activeTab === "pharmacy" ? "#0f172a" : "#f1f5f9", color: activeTab === "pharmacy" ? "#fff" : "#475569", borderRadius: "6px", fontWeight: 600, cursor: "pointer", fontSize: "0.875rem" }}>
              Pharmacy ({pharmacyData.length})
            </button>
            <button onClick={() => setActiveTab("lab")} style={{ padding: "0.5rem 1rem", border: "none", background: activeTab === "lab" ? "#0f172a" : "#f1f5f9", color: activeTab === "lab" ? "#fff" : "#475569", borderRadius: "6px", fontWeight: 600, cursor: "pointer", fontSize: "0.875rem" }}>
              Laboratory ({labData.length})
            </button>
            <button onClick={() => setActiveTab("assets")} style={{ padding: "0.5rem 1rem", border: "none", background: activeTab === "assets" ? "#0f172a" : "#f1f5f9", color: activeTab === "assets" ? "#fff" : "#475569", borderRadius: "6px", fontWeight: 600, cursor: "pointer", fontSize: "0.875rem" }}>
              Hospital Assets ({assetData.length})
            </button>
          </div>

          <button onClick={() => setIsModalOpen(true)} style={{ padding: "0.5rem 1rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 600, fontSize: "0.875rem", cursor: "pointer" }}>
            + Add {activeTab === "pharmacy" ? "Drug SKU" : activeTab === "lab" ? "Reagent" : "Asset Tag"}
          </button>
        </div>

        <input
          type="text"
          placeholder="Search items by code or name..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{ width: "100%", padding: "0.6rem 0.8rem", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "0.875rem", boxSizing: "border-box", outline: "none" }}
        />
      </div>

      {/* Tables Section */}
      {activeTab === "pharmacy" && (
        <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e2e8f0", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                <th style={{ padding: "0.75rem 1rem" }}>SKU</th>
                <th style={{ padding: "0.75rem 1rem" }}>Medication Name</th>
                <th style={{ padding: "0.75rem 1rem" }}>Category</th>
                <th style={{ padding: "0.75rem 1rem" }}>Batch</th>
                <th style={{ padding: "0.75rem 1rem" }}>Qty</th>
                <th style={{ padding: "0.75rem 1rem" }}>Status</th>
                <th style={{ padding: "0.75rem 1rem" }}>Unit Price</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPharmacy.map((item) => (
                <tr key={item.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "0.75rem 1rem", fontWeight: "bold", color: "#0284c7" }}>{item.id}</td>
                  <td style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>{item.name}</td>
                  <td style={{ padding: "0.75rem 1rem" }}>{item.category}</td>
                  <td style={{ padding: "0.75rem 1rem", fontFamily: "monospace" }}>{item.batch}</td>
                  <td style={{ padding: "0.75rem 1rem", fontWeight: "bold" }}>{item.qty}</td>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <span style={{ padding: "0.2rem 0.5rem", borderRadius: "4px", fontSize: "0.75rem", fontWeight: 700, background: item.status.includes("Low") ? "#fef2f2" : "#f0fdf4", color: item.status.includes("Low") ? "#dc2626" : "#16a34a" }}>
                      {item.status}
                    </span>
                  </td>
                  <td style={{ padding: "0.75rem 1rem", fontWeight: "bold" }}>{item.price}</td>
                  <td style={{ padding: "0.75rem 1rem", textAlign: "right" }}>
                    <div style={{ display: "flex", gap: "0.25rem", justifyContent: "flex-end" }}>
                      <button onClick={() => handleQtyAdjust("pharmacy", item.id, 10)} style={{ border: "1px solid #cbd5e1", background: "#fff", borderRadius: "4px", padding: "0.2rem 0.4rem", cursor: "pointer", fontSize: "0.75rem", fontWeight: "bold" }}>+10 Restock</button>
                      <button onClick={() => handleQtyAdjust("pharmacy", item.id, -1)} style={{ border: "1px solid #cbd5e1", background: "#fff", borderRadius: "4px", padding: "0.2rem 0.4rem", cursor: "pointer", fontSize: "0.75rem" }}>-1 Dispense</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "lab" && (
        <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e2e8f0", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                <th style={{ padding: "0.75rem 1rem" }}>Code</th>
                <th style={{ padding: "0.75rem 1rem" }}>Reagent / Consumable</th>
                <th style={{ padding: "0.75rem 1rem" }}>Discipline</th>
                <th style={{ padding: "0.75rem 1rem" }}>Lot No</th>
                <th style={{ padding: "0.75rem 1rem" }}>Qty</th>
                <th style={{ padding: "0.75rem 1rem" }}>Expiry</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredLab.map((item) => (
                <tr key={item.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "0.75rem 1rem", fontWeight: "bold", color: "#0284c7" }}>{item.id}</td>
                  <td style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>{item.name}</td>
                  <td style={{ padding: "0.75rem 1rem" }}>{item.category}</td>
                  <td style={{ padding: "0.75rem 1rem", fontFamily: "monospace" }}>{item.lot}</td>
                  <td style={{ padding: "0.75rem 1rem", fontWeight: "bold" }}>{item.qty} Packs</td>
                  <td style={{ padding: "0.75rem 1rem" }}>{item.expiry}</td>
                  <td style={{ padding: "0.75rem 1rem", textAlign: "right" }}>
                    <button onClick={() => handleQtyAdjust("lab", item.id, 5)} style={{ border: "1px solid #cbd5e1", background: "#fff", borderRadius: "4px", padding: "0.2rem 0.5rem", cursor: "pointer", fontSize: "0.75rem", fontWeight: "bold" }}>+5 Packs</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "assets" && (
        <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e2e8f0", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                <th style={{ padding: "0.75rem 1rem" }}>Asset Tag</th>
                <th style={{ padding: "0.75rem 1rem" }}>Equipment</th>
                <th style={{ padding: "0.75rem 1rem" }}>Department</th>
                <th style={{ padding: "0.75rem 1rem" }}>Serial Number</th>
                <th style={{ padding: "0.75rem 1rem" }}>Status</th>
                <th style={{ padding: "0.75rem 1rem" }}>Valuation</th>
                <th style={{ padding: "0.75rem 1rem", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAssets.map((item) => (
                <tr key={item.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "0.75rem 1rem", fontWeight: "bold", color: "#0284c7" }}>{item.id}</td>
                  <td style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>{item.name}</td>
                  <td style={{ padding: "0.75rem 1rem" }}>{item.dept}</td>
                  <td style={{ padding: "0.75rem 1rem", fontFamily: "monospace" }}>{item.serial}</td>
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <span style={{ padding: "0.2rem 0.5rem", borderRadius: "4px", fontSize: "0.75rem", fontWeight: 700, background: item.status.includes("Required") ? "#fef2f2" : "#f0fdf4", color: item.status.includes("Required") ? "#dc2626" : "#16a34a" }}>
                      {item.status}
                    </span>
                  </td>
                  <td style={{ padding: "0.75rem 1rem", fontWeight: "bold" }}>{item.value}</td>
                  <td style={{ padding: "0.75rem 1rem", textAlign: "right" }}>
                    <button onClick={() => handleAssetStatusToggle(item.id)} style={{ border: "1px solid #cbd5e1", background: "#fff", borderRadius: "4px", padding: "0.2rem 0.5rem", cursor: "pointer", fontSize: "0.75rem", fontWeight: "600" }}>
                      Toggle Service
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Item Modal */}
      {isModalOpen && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15, 23, 42, 0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000 }}>
          <div style={{ background: "#fff", borderRadius: "8px", width: "100%", maxWidth: "480px", padding: "1.5rem", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>
                Add New {activeTab === "pharmacy" ? "Pharmaceutical SKU" : activeTab === "lab" ? "Lab Reagent" : "Biomedical Asset"}
              </h3>
              <button onClick={() => setIsModalOpen(false)} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer", color: "#64748b" }}>✕</button>
            </div>

            <form onSubmit={handleFormSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>
                  {activeTab === "pharmacy" ? "Drug Name" : activeTab === "lab" ? "Reagent Name" : "Equipment Name"}
                </label>
                <input
                  type="text"
                  required
                  placeholder={activeTab === "pharmacy" ? "e.g. Ciprofloxacin 500mg" : activeTab === "lab" ? "e.g. EDTA Tube Pack" : "e.g. ECG Machine"}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #cbd5e1", boxSizing: "border-box" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>
                  {activeTab === "assets" ? "Department" : "Category / Discipline"}
                </label>
                <input
                  type="text"
                  placeholder={activeTab === "pharmacy" ? "e.g. Antibiotics" : activeTab === "lab" ? "e.g. Haematology" : "e.g. ICU"}
                  value={formData.categoryOrDept}
                  onChange={(e) => setFormData({ ...formData, categoryOrDept: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #cbd5e1", boxSizing: "border-box" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>
                    {activeTab === "pharmacy" ? "Batch No" : activeTab === "lab" ? "Lot No" : "Serial No"}
                  </label>
                  <input
                    type="text"
                    placeholder="Reference code"
                    value={formData.codeOrBatch}
                    onChange={(e) => setFormData({ ...formData, codeOrBatch: e.target.value })}
                    style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #cbd5e1", boxSizing: "border-box" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>
                    {activeTab === "assets" ? "Valuation" : "Quantity"}
                  </label>
                  <input
                    type="text"
                    placeholder={activeTab === "assets" ? "₦5,000,000" : "10"}
                    value={formData.qtyOrValue}
                    onChange={(e) => setFormData({ ...formData, qtyOrValue: e.target.value })}
                    style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #cbd5e1", boxSizing: "border-box" }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>
                  {activeTab === "pharmacy" ? "Unit Price" : activeTab === "lab" ? "Expiry Date" : "Asset Value"}
                </label>
                <input
                  type="text"
                  placeholder={activeTab === "pharmacy" ? "₦2,500" : activeTab === "lab" ? "YYYY-MM-DD" : "₦1,000,000"}
                  value={formData.extra}
                  onChange={(e) => setFormData({ ...formData, extra: e.target.value })}
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid #cbd5e1", boxSizing: "border-box" }}
                />
              </div>

              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                <button type="submit" style={{ flex: 1, padding: "0.6rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "pointer" }}>
                  Save Item
                </button>
                <button type="button" onClick={() => setIsModalOpen(false)} style={{ padding: "0.6rem 1rem", background: "#f1f5f9", color: "#475569", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "pointer" }}>
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