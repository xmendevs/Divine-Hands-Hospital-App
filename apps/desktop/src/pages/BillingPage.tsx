import React, { useState } from "react";

export type PaymentMethod = "Cash" | "POS/Card" | "Bank Transfer" | "HMO Coverage" | "Retainership";
export type InvoiceStatus = "Paid" | "Unpaid" | "Partially Paid" | "Pending HMO Claim";
export type PayerType = "Private / Out-of-Pocket" | "HMO / Insurance" | "Corporate Retainership";

export interface LineItem {
  id: string;
  description: string;
  category: "Consultation" | "Pharmacy" | "Laboratory" | "Ward/Bed" | "Procedure" | "Nursing Care";
  unitPrice: number;
  quantity: number;
  total: number;
}

export interface Invoice {
  invoiceId: string;
  patientId: string;
  patientName: string;
  payerType: PayerType;
  hmoProvider?: string;
  date: string;
  lineItems: LineItem[];
  subTotal: number;
  grandTotal: number;
  amountPaid: number;
  balanceDue: number;
  status: InvoiceStatus;
  paymentMethod?: PaymentMethod;
}

// Mock Patient Registry list so you can pick from existing patients anywhere
export const REGISTERED_PATIENTS = [
  { id: "DH-2026-1042", name: "Adesanya Bamidele", phone: "08031234567", payer: "Private / Out-of-Pocket" as PayerType },
  { id: "DH-2026-0921", name: "Chisom Okonkwo", phone: "08098765432", payer: "HMO / Insurance", hmo: "Hygeia HMO" },
  { id: "DH-2026-1105", name: "Ibrahim Garba", phone: "08123456789", payer: "Corporate Retainership" },
  { id: "DH-2026-1188", name: "Grace Effiong", phone: "07011223344", payer: "Private / Out-of-Pocket" as PayerType },
];

export default function BillingPage() {
  const [activeTab, setActiveTab] = useState<"invoices" | "patient-payments" | "receipts">("invoices");

  const [invoices, setInvoices] = useState<Invoice[]>([
    {
      invoiceId: "INV-2026-0081",
      patientId: "DH-2026-1042",
      patientName: "Adesanya Bamidele",
      payerType: "Private / Out-of-Pocket",
      date: "2026-08-15",
      lineItems: [
        { id: "LI-1", description: "General Practitioner Consultation", category: "Consultation", unitPrice: 10000, quantity: 1, total: 10000 },
        { id: "LI-2", description: "Full Blood Count (FBC) + Malaria Parasite", category: "Laboratory", unitPrice: 15500, quantity: 1, total: 15500 },
      ],
      subTotal: 25500,
      grandTotal: 25500,
      amountPaid: 25500,
      balanceDue: 0,
      status: "Paid",
      paymentMethod: "POS/Card",
    },
    {
      invoiceId: "INV-2026-0082",
      patientId: "DH-2026-0921",
      patientName: "Chisom Okonkwo",
      payerType: "HMO / Insurance",
      hmoProvider: "Hygeia HMO",
      date: "2026-08-15",
      lineItems: [
        { id: "LI-4", description: "Specialist Physician Consultation", category: "Consultation", unitPrice: 25000, quantity: 1, total: 25000 },
      ],
      subTotal: 25000,
      grandTotal: 25000,
      amountPaid: 0,
      balanceDue: 25000,
      status: "Pending HMO Claim",
    },
  ]);

  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(invoices[0]);
  const [searchTerm, setSearchTerm] = useState("");

  // New Invoice Modal State
  const [isNewInvoiceOpen, setIsNewInvoiceOpen] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState(REGISTERED_PATIENTS[0].id);
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { id: "1", description: "Consultation Fee", category: "Consultation", unitPrice: 10000, quantity: 1, total: 10000 },
  ]);

  // Payment Settlement & Receipt Modal State
  const [isSettleModalOpen, setIsSettleModalOpen] = useState(false);
  const [paymentAmountInput, setPaymentAmountInput] = useState<number>(0);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod>("POS/Card");
  const [activeReceipt, setActiveReceipt] = useState<{ invoice: Invoice; amountPaidNow: number; receiptNo: string } | null>(null);

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(val);

  const calculateSubtotal = (items: LineItem[]) => items.reduce((acc, curr) => acc + curr.total, 0);

  const handleAddLineItem = () => {
    setLineItems([...lineItems, { id: Date.now().toString(), description: "", category: "Pharmacy", unitPrice: 0, quantity: 1, total: 0 }]);
  };

  const handleUpdateLineItem = (id: string, field: "description" | "unitPrice" | "quantity", val: string) => {
    setLineItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item };
        if (field === "description") updated.description = val;
        if (field === "unitPrice") updated.unitPrice = Number(val) || 0;
        if (field === "quantity") updated.quantity = Number(val) || 0;
        updated.total = updated.unitPrice * updated.quantity;
        return updated;
      })
    );
  };

  const handleCreateInvoice = (e: React.FormEvent) => {
    e.preventDefault();
    const patientObj = REGISTERED_PATIENTS.find((p) => p.id === selectedPatientId) || REGISTERED_PATIENTS[0];
    const sub = calculateSubtotal(lineItems);

    const newInv: Invoice = {
      invoiceId: `INV-2026-00${invoices.length + 83}`,
      patientId: patientObj.id,
      patientName: patientObj.name,
      payerType: patientObj.payer as PayerType,
      hmoProvider: patientObj.hmo,
      date: new Date().toISOString().split("T")[0],
      lineItems: lineItems.filter((i) => i.description.trim() !== ""),
      subTotal: sub,
      grandTotal: sub,
      amountPaid: 0,
      balanceDue: sub,
      status: patientObj.payer === "HMO / Insurance" ? "Pending HMO Claim" : "Unpaid",
    };

    setInvoices([newInv, ...invoices]);
    setSelectedInvoice(newInv);
    setIsNewInvoiceOpen(false);
    setLineItems([{ id: "1", description: "Consultation Fee", category: "Consultation", unitPrice: 10000, quantity: 1, total: 10000 }]);
  };

  const handleSettlePayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoice) return;

    const amountNow = Number(paymentAmountInput);
    const newAmountPaid = selectedInvoice.amountPaid + amountNow;
    const newBalance = Math.max(0, selectedInvoice.grandTotal - newAmountPaid);
    const newStatus: InvoiceStatus = newBalance === 0 ? "Paid" : "Partially Paid";

    const updatedInv: Invoice = {
      ...selectedInvoice,
      amountPaid: newAmountPaid,
      balanceDue: newBalance,
      status: newStatus,
      paymentMethod: selectedPaymentMethod,
    };

    setInvoices((prev) => prev.map((inv) => (inv.invoiceId === updatedInv.invoiceId ? updatedInv : inv)));
    setSelectedInvoice(updatedInv);
    setIsSettleModalOpen(false);

    // Trigger Receipt generation
    setActiveReceipt({
      invoice: updatedInv,
      amountPaidNow: amountNow,
      receiptNo: `RCP-2026-${Math.floor(1000 + Math.random() * 9000)}`,
    });
  };

  return (
    <div style={{ padding: "1.5rem", fontFamily: "system-ui, sans-serif", color: "#0f172a" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.2rem" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 800 }}>Billing & Patient Payments</h2>
          <p style={{ margin: 0, fontSize: "0.875rem", color: "#64748b" }}>Fully linked registry billing, payment records, and instant receipt generation.</p>
        </div>
        <button
          onClick={() => setIsNewInvoiceOpen(true)}
          style={{ padding: "0.6rem 1.2rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "pointer", fontSize: "0.875rem" }}
        >
          + Link Patient & Create Invoice
        </button>
      </div>

      {/* Tabs Navigation */}
      <div style={{ display: "flex", gap: "1rem", borderBottom: "2px solid #e2e8f0", marginBottom: "1.5rem" }}>
        <button
          onClick={() => setActiveTab("invoices")}
          style={{ padding: "0.6rem 1rem", background: "none", border: "none", borderBottom: activeTab === "invoices" ? "2px solid #2563eb" : "none", fontWeight: activeTab === "invoices" ? 700 : 500, color: activeTab === "invoices" ? "#2563eb" : "#64748b", cursor: "pointer" }}
        >
          Invoices & Billing Matrix
        </button>
        <button
          onClick={() => setActiveTab("patient-payments")}
          style={{ padding: "0.6rem 1rem", background: "none", border: "none", borderBottom: activeTab === "patient-payments" ? "2px solid #2563eb" : "none", fontWeight: activeTab === "patient-payments" ? 700 : 500, color: activeTab === "patient-payments" ? "#2563eb" : "#64748b", cursor: "pointer" }}
        >
          Patient Payment Records & History
        </button>
      </div>

      {/* TAB 1: Invoices */}
      {activeTab === "invoices" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: "1.5rem", alignItems: "start" }}>
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "1rem" }}>
            <input
              type="text"
              placeholder="Search by patient name or ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "0.85rem", marginBottom: "1rem" }}
            />

            <div style={{ overflowY: "auto", maxHeight: "500px" }}>
              {invoices
                .filter((inv) => inv.patientName.toLowerCase().includes(searchTerm.toLowerCase()) || inv.patientId.toLowerCase().includes(searchTerm.toLowerCase()))
                .map((inv) => (
                  <div
                    key={inv.invoiceId}
                    onClick={() => setSelectedInvoice(inv)}
                    style={{
                      padding: "0.85rem",
                      borderBottom: "1px solid #f1f5f9",
                      borderRadius: "6px",
                      cursor: "pointer",
                      backgroundColor: selectedInvoice?.invoiceId === inv.invoiceId ? "#f0f9ff" : "transparent",
                      borderLeft: selectedInvoice?.invoiceId === inv.invoiceId ? "4px solid #0284c7" : "4px solid transparent",
                      marginBottom: "0.25rem",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 700, color: "#0284c7", fontSize: "0.85rem" }}>{inv.invoiceId}</span>
                      <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "0.15rem 0.4rem", borderRadius: "4px", background: inv.status === "Paid" ? "#f0fdf4" : "#fef2f2", color: inv.status === "Paid" ? "#16a34a" : "#dc2626" }}>
                        {inv.status}
                      </span>
                    </div>
                    <div style={{ fontWeight: 600, margin: "0.25rem 0", fontSize: "0.9rem" }}>{inv.patientName} <span style={{ fontSize: "0.75rem", color: "#64748b" }}>({inv.patientId})</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "0.8rem" }}>
                      <span>{inv.payerType}</span>
                      <span style={{ fontWeight: 700, color: "#0f172a" }}>{formatCurrency(inv.grandTotal)}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {selectedInvoice && (
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "1.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #e2e8f0", paddingBottom: "1rem", marginBottom: "1rem" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.1rem" }}>INVOICE DETAILS</h3>
                  <span style={{ fontSize: "0.8rem", color: "#64748b" }}>Ref: {selectedInvoice.invoiceId} | Date: {selectedInvoice.date}</span>
                </div>
                {selectedInvoice.balanceDue > 0 && selectedInvoice.status !== "Pending HMO Claim" && (
                  <button
                    onClick={() => {
                      setPaymentAmountInput(selectedInvoice.balanceDue);
                      setIsSettleModalOpen(true);
                    }}
                    style={{ padding: "0.5rem 1rem", background: "#16a34a", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "pointer", fontSize: "0.85rem" }}
                  >
                    Receive Payment & Print Receipt
                  </button>
                )}
              </div>

              <div style={{ backgroundColor: "#f8fafc", padding: "0.85rem", borderRadius: "6px", marginBottom: "1rem", fontSize: "0.85rem" }}>
                <div><strong>Patient Name:</strong> {selectedInvoice.patientName}</div>
                <div><strong>Registry ID:</strong> {selectedInvoice.patientId}</div>
                <div><strong>Payment Payer:</strong> {selectedInvoice.payerType} {selectedInvoice.hmoProvider ? `(${selectedInvoice.hmoProvider})` : ""}</div>
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
                <thead>
                  <tr style={{ background: "#f1f5f9", textAlign: "left", color: "#475569" }}>
                    <th style={{ padding: "0.6rem" }}>Description</th>
                    <th style={{ padding: "0.6rem" }}>Category</th>
                    <th style={{ padding: "0.6rem", textAlign: "right" }}>Price</th>
                    <th style={{ padding: "0.6rem", textAlign: "center" }}>Qty</th>
                    <th style={{ padding: "0.6rem", textAlign: "right" }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedInvoice.lineItems.map((item) => (
                    <tr key={item.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "0.6rem" }}>{item.description}</td>
                      <td style={{ padding: "0.6rem", color: "#64748b" }}>{item.category}</td>
                      <td style={{ padding: "0.6rem", textAlign: "right" }}>{formatCurrency(item.unitPrice)}</td>
                      <td style={{ padding: "0.6rem", textAlign: "center" }}>{item.quantity}</td>
                      <td style={{ padding: "0.6rem", textAlign: "right", fontWeight: 600 }}>{formatCurrency(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.3rem", fontSize: "0.9rem" }}>
                <div>Total Amount: <strong>{formatCurrency(selectedInvoice.grandTotal)}</strong></div>
                <div style={{ color: "#16a34a" }}>Amount Paid: <strong>{formatCurrency(selectedInvoice.amountPaid)}</strong></div>
                <div style={{ fontSize: "1.05rem", fontWeight: 800, color: selectedInvoice.balanceDue > 0 ? "#dc2626" : "#16a34a" }}>
                  Balance Due: {formatCurrency(selectedInvoice.balanceDue)}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Patient Payment History Tab */}
      {activeTab === "patient-payments" && (
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "1.5rem" }}>
          <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem" }}>Linked Patient Payment Ledger</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ background: "#f1f5f9", textAlign: "left", color: "#475569" }}>
                <th style={{ padding: "0.75rem" }}>Patient ID</th>
                <th style={{ padding: "0.75rem" }}>Patient Name</th>
                <th style={{ padding: "0.75rem" }}>Total Invoiced</th>
                <th style={{ padding: "0.75rem" }}>Total Paid</th>
                <th style={{ padding: "0.75rem" }}>Outstanding Balance</th>
                <th style={{ padding: "0.75rem" }}>Last Payment Method</th>
              </tr>
            </thead>
            <tbody>
              {REGISTERED_PATIENTS.map((pat) => {
                const patInvoices = invoices.filter((i) => i.patientId === pat.id);
                const totalInv = patInvoices.reduce((acc, curr) => acc + curr.grandTotal, 0);
                const totalPaid = patInvoices.reduce((acc, curr) => acc + curr.amountPaid, 0);
                const balance = totalInv - totalPaid;
                const lastMethod = patInvoices.find((i) => i.paymentMethod)?.paymentMethod || "None";

                return (
                  <tr key={pat.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "0.75rem", fontWeight: 700, color: "#0284c7" }}>{pat.id}</td>
                    <td style={{ padding: "0.75rem", fontWeight: 600 }}>{pat.name}</td>
                    <td style={{ padding: "0.75rem" }}>{formatCurrency(totalInv)}</td>
                    <td style={{ padding: "0.75rem", color: "#16a34a", fontWeight: 600 }}>{formatCurrency(totalPaid)}</td>
                    <td style={{ padding: "0.75rem", color: balance > 0 ? "#dc2626" : "#0f172a", fontWeight: 700 }}>{formatCurrency(balance)}</td>
                    <td style={{ padding: "0.75rem" }}>{lastMethod}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* --- MODAL: LINK PATIENT & CREATE INVOICE --- */}
      {isNewInvoiceOpen && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15, 23, 42, 0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000 }}>
          <div style={{ background: "#fff", borderRadius: "8px", width: "100%", maxWidth: "600px", padding: "1.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0 }}>Create Invoice & Link Patient</h3>
              <button onClick={() => setIsNewInvoiceOpen(false)} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
            </div>
            <form onSubmit={handleCreateInvoice}>
              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.3rem" }}>Select Patient from Registry</label>
                <select
                  value={selectedPatientId}
                  onChange={(e) => setSelectedPatientId(e.target.value)}
                  style={{ width: "100%", padding: "0.5rem", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "0.9rem" }}
                >
                  {REGISTERED_PATIENTS.map((pat) => (
                    <option key={pat.id} value={pat.id}>
                      {pat.name} ({pat.id}) — Payer: {pat.payer}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginTop: "1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                  <label style={{ fontSize: "0.85rem", fontWeight: 700 }}>Bill Line Items</label>
                  <button type="button" onClick={handleAddLineItem} style={{ background: "#f1f5f9", border: "1px solid #cbd5e1", padding: "0.2rem 0.6rem", borderRadius: "4px", fontSize: "0.75rem" }}>+ Add Item</button>
                </div>
                {lineItems.map((item) => (
                  <div key={item.id} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "0.4rem", marginBottom: "0.4rem" }}>
                    <input type="text" placeholder="Description" value={item.description} onChange={(e) => handleUpdateLineItem(item.id, "description", e.target.value)} style={{ padding: "0.4rem", border: "1px solid #cbd5e1", borderRadius: "4px" }} />
                    <input type="number" placeholder="Price" value={item.unitPrice || ""} onChange={(e) => handleUpdateLineItem(item.id, "unitPrice", e.target.value)} style={{ padding: "0.4rem", border: "1px solid #cbd5e1", borderRadius: "4px" }} />
                    <input type="number" placeholder="Qty" value={item.quantity || ""} onChange={(e) => handleUpdateLineItem(item.id, "quantity", e.target.value)} style={{ padding: "0.4rem", border: "1px solid #cbd5e1", borderRadius: "4px" }} />
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1.5rem", borderTop: "1px solid #e2e8f0", paddingTop: "1rem" }}>
                <span style={{ fontWeight: 800 }}>Total: {formatCurrency(calculateSubtotal(lineItems))}</span>
                <button type="submit" style={{ padding: "0.5rem 1.2rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "pointer" }}>Save & Issue Invoice</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL: SETTLE PAYMENT & INPUT AMOUNT --- */}
      {isSettleModalOpen && selectedInvoice && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15, 23, 42, 0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000 }}>
          <div style={{ background: "#fff", borderRadius: "8px", width: "100%", maxWidth: "400px", padding: "1.5rem" }}>
            <h3 style={{ margin: "0 0 1rem 0" }}>Process Payment & Generate Receipt</h3>
            <form onSubmit={handleSettlePayment}>
              <div style={{ marginBottom: "0.8rem" }}>
                <label style={{ display: "block", fontSize: "0.8rem", color: "#64748b" }}>Payment Method</label>
                <select value={selectedPaymentMethod} onChange={(e) => setSelectedPaymentMethod(e.target.value as PaymentMethod)} style={{ width: "100%", padding: "0.5rem", border: "1px solid #cbd5e1", borderRadius: "6px" }}>
                  <option value="POS/Card">POS / Debit Card</option>
                  <option value="Cash">Cash Collection</option>
                  <option value="Bank Transfer">Direct Bank Transfer</option>
                </select>
              </div>
              <div style={{ marginBottom: "1.2rem" }}>
                <label style={{ display: "block", fontSize: "0.8rem", color: "#64748b" }}>Amount Patient is Paying Now (₦)</label>
                <input type="number" required value={paymentAmountInput} onChange={(e) => setPaymentAmountInput(Number(e.target.value))} style={{ width: "100%", padding: "0.5rem", border: "1px solid #cbd5e1", borderRadius: "6px", fontWeight: "bold" }} />
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="button" onClick={() => setIsSettleModalOpen(false)} style={{ flex: 1, padding: "0.6rem", background: "#f1f5f9", border: "none", borderRadius: "6px", cursor: "pointer" }}>Cancel</button>
                <button type="submit" style={{ flex: 1, padding: "0.6rem", background: "#16a34a", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "pointer" }}>Confirm & Print Receipt</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- RECEIPT MODAL / PRINT VIEW --- */}
      {activeReceipt && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15, 23, 42, 0.6)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1100 }}>
          <div style={{ background: "#fff", borderRadius: "8px", width: "100%", maxWidth: "450px", padding: "2rem", boxShadow: "0 10px 25px rgba(0,0,0,0.2)" }}>
            <div style={{ textAlign: "center", borderBottom: "2px dashed #cbd5e1", paddingBottom: "1rem", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 800 }}>DIVINE HANDS HOSPITAL</h3>
              <p style={{ margin: "0.2rem 0", fontSize: "0.75rem", color: "#64748b" }}>Official Payment Receipt</p>
              <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#0284c7", marginTop: "0.4rem" }}>Receipt #: {activeReceipt.receiptNo}</div>
            </div>

            <div style={{ fontSize: "0.85rem", marginBottom: "1rem", display: "grid", gap: "0.3rem" }}>
              <div><strong>Patient Name:</strong> {activeReceipt.invoice.patientName}</div>
              <div><strong>Patient ID:</strong> {activeReceipt.invoice.patientId}</div>
              <div><strong>Invoice Ref:</strong> {activeReceipt.invoice.invoiceId}</div>
              <div><strong>Date:</strong> {new Date().toLocaleDateString()}</div>
              <div><strong>Payment Method:</strong> {activeReceipt.invoice.paymentMethod}</div>
            </div>

            <div style={{ background: "#f8fafc", padding: "1rem", borderRadius: "6px", textAlign: "center", marginBottom: "1.5rem" }}>
              <span style={{ fontSize: "0.75rem", color: "#64748b", display: "block" }}>AMOUNT PAID NOW</span>
              <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#16a34a" }}>{formatCurrency(activeReceipt.amountPaidNow)}</div>
              <div style={{ fontSize: "0.8rem", color: "#475569", marginTop: "0.4rem" }}>Remaining Balance: <strong>{formatCurrency(activeReceipt.invoice.balanceDue)}</strong></div>
            </div>

            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                onClick={() => window.print()}
                style={{ flex: 1, padding: "0.6rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "pointer" }}
              >
                Print Receipt
              </button>
              <button
                onClick={() => setActiveReceipt(null)}
                style={{ flex: 1, padding: "0.6rem", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: "6px", fontWeight: 600, cursor: "pointer" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
