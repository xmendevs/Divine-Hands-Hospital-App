import { useState } from "react";

export interface StockItem {
  id: string;
  name: string;
  category: "Antibiotics" | "Analgesics" | "Antihypertensives" | "Consumables";
  dosageForm: string;
  batchNumber: string;
  quantityInStock: number;
  reorderLevel: number;
  unitPrice: number;
  expiryDate: string;
}

export interface PrescriptionOrder {
  id: string;
  patientId: string;
  patientName: string;
  doctorName: string;
  drugName: string;
  dosage: string;
  frequency: string;
  durationDays: number;
  status: "PENDING" | "DISPENSED" | "OUT_OF_STOCK";
  createdAt: string;
}

export default function PharmacyPage() {
  const [activeTab, setActiveTab] = useState<"dispense" | "inventory" | "reorder">("dispense");

  // Initial Inventory State
  const [inventory, setInventory] = useState<StockItem[]>([
    {
      id: "DRG-001",
      name: "Amoxicillin / Clavulanic Acid (Augmentin)",
      category: "Antibiotics",
      dosageForm: "625mg Tablet",
      batchNumber: "AUG-2026-X9",
      quantityInStock: 140,
      reorderLevel: 50,
      unitPrice: 450,
      expiryDate: "2027-03-31",
    },
    {
      id: "DRG-002",
      name: "Paracetamol (Acetaminophen)",
      category: "Analgesics",
      dosageForm: "500mg Tablet",
      batchNumber: "PCM-2026-B1",
      quantityInStock: 12,
      reorderLevel: 100,
      unitPrice: 50,
      expiryDate: "2026-09-15",
    },
    {
      id: "DRG-003",
      name: "Amlodipine Besylate",
      category: "Antihypertensives",
      dosageForm: "5mg Tablet",
      batchNumber: "AML-2025-Z4",
      quantityInStock: 85,
      reorderLevel: 30,
      unitPrice: 200,
      expiryDate: "2028-01-20",
    },
  ]);

  // Initial Prescription Orders Queue
  const [prescriptions, setPrescriptions] = useState<PrescriptionOrder[]>([
    {
      id: "RX-8801",
      patientId: "DHHA0001",
      patientName: "Blessing Okon",
      doctorName: "Dr. Amina",
      drugName: "Amoxicillin / Clavulanic Acid (Augmentin)",
      dosage: "625mg",
      frequency: "BD (Twice Daily)",
      durationDays: 7,
      status: "PENDING",
      createdAt: "2026-08-15 08:30",
    },
    {
      id: "RX-8802",
      patientId: "DHH0001",
      patientName: "Emmanuel Adebayo",
      doctorName: "Dr. A. Okonkwo",
      drugName: "Paracetamol (Acetaminophen)",
      dosage: "1000mg",
      frequency: "TDS (Thrice Daily)",
      durationDays: 5,
      status: "PENDING",
      createdAt: "2026-08-15 09:15",
    },
  ]);

  // Dispense Handler (Deducts stock automatically)
  const handleDispense = (rxId: string, drugName: string) => {
    const stockItem = inventory.find((item) => item.name === drugName);

    if (!stockItem || stockItem.quantityInStock <= 0) {
      alert(`Cannot dispense. ${drugName} is OUT OF STOCK!`);
      return;
    }

    // Deduct stock quantity (e.g. 10 tablets)
    const qtyToDeduct = 10;
    setInventory(
      inventory.map((item) =>
        item.name === drugName
          ? { ...item, quantityInStock: Math.max(0, item.quantityInStock - qtyToDeduct) }
          : item
      )
    );

    // Update prescription status
    setPrescriptions(
      prescriptions.map((rx) => (rx.id === rxId ? { ...rx, status: "DISPENSED" } : rx))
    );

    alert(`Prescription ${rxId} successfully dispensed! Inventory updated.`);
  };

  const lowStockItems = inventory.filter((item) => item.quantityInStock <= item.reorderLevel);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      
      {/* Enterprise KPI Summary Bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
        <div style={{ background: "#fff", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700 }}>PENDING DISPENSE</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#0284c7" }}>
            {prescriptions.filter((p) => p.status === "PENDING").length}
          </div>
        </div>
        <div style={{ background: "#fff", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700 }}>LOW STOCK ALERTS</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: lowStockItems.length > 0 ? "#dc2626" : "#16a34a" }}>
            {lowStockItems.length}
          </div>
        </div>
        <div style={{ background: "#fff", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700 }}>TOTAL SKUs IN STOCK</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#334155" }}>
            {inventory.length}
          </div>
        </div>
        <div style={{ background: "#fff", padding: "1rem", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 700 }}>DISPENSED TODAY</div>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#16a34a" }}>
            {prescriptions.filter((p) => p.status === "DISPENSED").length}
          </div>
        </div>
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

      {/* Tab 1: Dispensing Queue */}
      {activeTab === "dispense" && (
        <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                <th style={{ padding: "0.75rem 1rem" }}>RX ID</th>
                <th style={{ padding: "0.75rem 1rem" }}>PATIENT</th>
                <th style={{ padding: "0.75rem 1rem" }}>PRESCRIBED DRUG & DOSAGE</th>
                <th style={{ padding: "0.75rem 1rem" }}>FREQUENCY / DURATION</th>
                <th style={{ padding: "0.75rem 1rem" }}>STATUS</th>
                <th style={{ padding: "0.75rem 1rem" }}>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {prescriptions.map((rx) => (
                <tr key={rx.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "0.85rem 1rem", fontWeight: 700, color: "#0369a1" }}>{rx.id}</td>
                  <td style={{ padding: "0.85rem 1rem" }}>
                    <div style={{ fontWeight: 600, color: "#0f172a" }}>{rx.patientName}</div>
                    <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{rx.patientId} • Prescribed by {rx.doctorName}</div>
                  </td>
                  <td style={{ padding: "0.85rem 1rem" }}>
                    <div style={{ fontWeight: 600, color: "#334155" }}>{rx.drugName}</div>
                    <div style={{ fontSize: "0.75rem", color: "#0284c7", fontWeight: 600 }}>Dose: {rx.dosage}</div>
                  </td>
                  <td style={{ padding: "0.85rem 1rem", color: "#475569" }}>
                    {rx.frequency} ({rx.durationDays} Days)
                  </td>
                  <td style={{ padding: "0.85rem 1rem" }}>
                    <span
                      style={{
                        padding: "0.25rem 0.5rem",
                        borderRadius: "4px",
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        background: rx.status === "DISPENSED" ? "#f0fdf4" : "#fefce8",
                        color: rx.status === "DISPENSED" ? "#16a34a" : "#ca8a04",
                      }}
                    >
                      {rx.status}
                    </span>
                  </td>
                  <td style={{ padding: "0.85rem 1rem" }}>
                    {rx.status === "PENDING" ? (
                      <button
                        onClick={() => handleDispense(rx.id, rx.drugName)}
                        style={{
                          padding: "0.4rem 0.8rem",
                          background: "#16a34a",
                          color: "#fff",
                          border: "none",
                          borderRadius: "4px",
                          fontWeight: 700,
                          cursor: "pointer",
                          fontSize: "0.75rem",
                        }}
                      >
                        Verify & Dispense
                      </button>
                    ) : (
                      <span style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 600 }}>Dispensed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 2: Inventory & Stock Control */}
      {activeTab === "inventory" && (
        <div style={{ background: "#fff", borderRadius: "8px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                <th style={{ padding: "0.75rem 1rem" }}>DRUG SKU</th>
                <th style={{ padding: "0.75rem 1rem" }}>MEDICATION & CATEGORY</th>
                <th style={{ padding: "0.75rem 1rem" }}>BATCH NO.</th>
                <th style={{ padding: "0.75rem 1rem" }}>EXPIRY DATE</th>
                <th style={{ padding: "0.75rem 1rem" }}>STOCK LEVEL</th>
                <th style={{ padding: "0.75rem 1rem" }}>UNIT PRICE (₦)</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((item) => {
                const isLow = item.quantityInStock <= item.reorderLevel;
                return (
                  <tr key={item.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "0.85rem 1rem", fontWeight: 700, color: "#334155" }}>{item.id}</td>
                    <td style={{ padding: "0.85rem 1rem" }}>
                      <div style={{ fontWeight: 600, color: "#0f172a" }}>{item.name}</div>
                      <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{item.category} • {item.dosageForm}</div>
                    </td>
                    <td style={{ padding: "0.85rem 1rem", fontFamily: "monospace", color: "#475569" }}>{item.batchNumber}</td>
                    <td style={{ padding: "0.85rem 1rem", color: "#475569" }}>{item.expiryDate}</td>
                    <td style={{ padding: "0.85rem 1rem" }}>
                      <span
                        style={{
                          padding: "0.25rem 0.6rem",
                          borderRadius: "4px",
                          fontWeight: 700,
                          fontSize: "0.8rem",
                          background: isLow ? "#fef2f2" : "#f0fdf4",
                          color: isLow ? "#dc2626" : "#16a34a",
                          border: isLow ? "1px solid #fca5a5" : "none",
                        }}
                      >
                        {item.quantityInStock} units {isLow && "(LOW STOCK)"}
                      </span>
                    </td>
                    <td style={{ padding: "0.85rem 1rem", fontWeight: 600, color: "#0f172a" }}>
                      ₦{item.unitPrice.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
