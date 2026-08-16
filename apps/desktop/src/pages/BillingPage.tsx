import { useCallback, useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { apiFetch, getBaseUrl } from "../api/client";

interface InvoiceItem {
  id: string;
  code: string;
  name: string;
  category: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface Invoice {
  id: string;
  invoiceNo: string;
  patientId?: string;
  patientNo?: string;
  patientName?: string;
  priceListId?: string;
  currency: string;
  billTo: string;
  payerName: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  status: string;
  issuedAt?: string;
  voidReason?: string;
  createdAt: string;
  items: InvoiceItem[];
}

interface Payment {
  id: string;
  paymentNo: string;
  invoiceId: string;
  invoiceNo: string;
  patientName: string;
  amount: number;
  method: string;
  reference: string;
  receivedAt: string;
}

interface Receipt {
  id: string;
  receiptNo: string;
  invoiceNo: string;
  patientName: string;
  amount: number;
  method: string;
  currency: string;
  issuedAt: string;
}

interface PriceList {
  id: string;
  name: string;
  currency: string;
  status: string;
}

interface PriceListItem {
  id: string;
  code: string;
  name: string;
  category: string;
  price: number;
}

interface Shift {
  id: string;
  shiftNo: string;
  cashierId: string;
  openedAt: string;
  closingCash?: number;
  expectedCash?: number;
  variance?: number;
  status: string;
  openingCash: number;
}

interface PatientSummary {
  id: string;
  patientNo: string;
  firstName: string;
  lastName: string;
}

const PAYMENT_METHODS = ["cash", "pos", "card", "transfer", "online", "insurance", "corporate"];
const BILL_TO = ["patient", "insurance", "corporate"];

const currency = (val: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(val);

export default function BillingPage() {
  const [activeTab, setActiveTab] = useState<"invoices" | "payments">("invoices");

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [priceListItems, setPriceListItems] = useState<PriceListItem[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  // Cashier shift.
  const [openingCash, setOpeningCash] = useState("");
  const [closingCash, setClosingCash] = useState("");

  // Create invoice modal.
  const [showCreate, setShowCreate] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientSummary | null>(null);
  const [selectedPriceList, setSelectedPriceList] = useState("");
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [billTo, setBillTo] = useState("patient");
  const [payerName, setPayerName] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");
  const [creating, setCreating] = useState(false);

  // Receive payment modal.
  const [showPay, setShowPay] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("cash");
  const [payReference, setPayReference] = useState("");
  const [activeReceipt, setActiveReceipt] = useState<Receipt | null>(null);
  const [paying, setPaying] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [inv, pay, pl, sh] = await Promise.allSettled([
      apiFetch<Invoice[]>("/billing/invoices"),
      apiFetch<Payment[]>("/billing/payments"),
      apiFetch<PriceList[]>("/billing/price-lists"),
      apiFetch<Shift[]>("/billing/shifts"),
    ]);
    const errors: string[] = [];
    if (inv.status === "fulfilled") {
      setInvoices(inv.value);
      setSelectedInvoice((cur) => cur ?? inv.value[0] ?? null);
    } else {
      errors.push(inv.reason instanceof Error ? inv.reason.message : "Could not load invoices.");
    }
    if (pay.status === "fulfilled") {
      setPayments(pay.value);
    } else {
      errors.push(pay.reason instanceof Error ? pay.reason.message : "Could not load payments.");
    }
    if (pl.status === "fulfilled") {
      setPriceLists(pl.value);
      setSelectedPriceList((cur) => cur || pl.value[0]?.id || "");
    } else {
      errors.push(pl.reason instanceof Error ? pl.reason.message : "Could not load price lists.");
    }
    if (sh.status === "fulfilled") {
      setShifts(sh.value);
    } else {
      errors.push(sh.reason instanceof Error ? sh.reason.message : "Could not load cashier shifts.");
    }
    setError(errors.join(" "));
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Load price list items when a price list is chosen.
  useEffect(() => {
    if (!selectedPriceList) {
      setPriceListItems([]);
      return;
    }
    let cancelled = false;
    apiFetch<PriceListItem[]>(`/billing/price-lists/${selectedPriceList}/items`)
      .then((items) => {
        if (!cancelled) setPriceListItems(items);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load price list items.");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPriceList]);

  // Debounced patient search (create-invoice modal).
  useEffect(() => {
    const q = patientSearch.trim();
    if (!q) {
      setPatients([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const results = await apiFetch<PatientSummary[]>(`/patients/search?q=${encodeURIComponent(q)}`);
        if (!cancelled) setPatients(results);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Patient search failed.");
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [patientSearch]);

  const openShift = shifts.find((s) => s.status === "open");

  async function handleOpenShift(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await apiFetch<unknown>("/billing/shifts", {
        method: "POST",
        body: JSON.stringify({ openingCash: Number(openingCash) || 0 }),
      });
      setOpeningCash("");
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the shift.");
    }
  }

  async function handleCloseShift(e: FormEvent) {
    e.preventDefault();
    if (!openShift) return;
    setError("");
    try {
      await apiFetch<unknown>(`/billing/shifts/${openShift.id}/close`, {
        method: "POST",
        body: JSON.stringify({ closingCash: Number(closingCash) || 0 }),
      });
      setClosingCash("");
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not close the shift.");
    }
  }

  async function handleCreateInvoice(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!selectedPatient) {
      setError("Select a patient for this invoice.");
      return;
    }
    if (!selectedPriceList) {
      setError("Select a price list.");
      return;
    }
    const items = selectedItemIds
      .filter((id) => {
        const q = Number(quantities[id]);
        return Number.isFinite(q) && q > 0;
      })
      .map((id) => ({ priceListItemId: id, quantity: Number(quantities[id]) }));
    if (items.length === 0) {
      setError("Add at least one item with a positive quantity.");
      return;
    }
    setCreating(true);
    try {
      const inv = await apiFetch<Invoice>("/billing/invoices", {
        method: "POST",
        body: JSON.stringify({
          patientId: selectedPatient.id,
          priceListId: selectedPriceList,
          billTo,
          payerName,
          policyNumber,
          discountAmount: Number(discountAmount) || 0,
          items,
        }),
      });
      setShowCreate(false);
      setSelectedInvoice(inv);
      setSelectedPatient(null);
      setPatientSearch("");
      setSelectedItemIds([]);
      setQuantities({});
      setPayerName("");
      setPolicyNumber("");
      setDiscountAmount("");
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the invoice.");
    } finally {
      setCreating(false);
    }
  }

  async function issueInvoice(inv: Invoice) {
    setError("");
    try {
      await apiFetch<unknown>(`/billing/invoices/${inv.id}/issue`, { method: "POST" });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not issue the invoice.");
    }
  }

  async function handleReceivePayment(e: FormEvent) {
    e.preventDefault();
    if (!selectedInvoice) return;
    setPaying(true);
    setError("");
    try {
      const res = await apiFetch<{ payment: Payment; receipt: Receipt }>(`/billing/invoices/${selectedInvoice.id}/payments`, {
        method: "POST",
        body: JSON.stringify({
          amount: Number(payAmount),
          method: payMethod,
          reference: payReference,
          notes: "",
        }),
      });
      setShowPay(false);
      setPayAmount("");
      setPayReference("");
      setActiveReceipt(res.receipt);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record the payment (an open cashier shift is required).");
    } finally {
      setPaying(false);
    }
  }

  const filteredInvoices = invoices.filter(
    (inv) =>
      !searchTerm ||
      inv.patientName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inv.invoiceNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inv.patientNo?.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 800, color: "#0f172a" }}>Billing & Patient Payments</h2>
          <p style={{ margin: 0, fontSize: "0.875rem", color: "#64748b" }}>
            Registry billing, payment records, and receipt generation.
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} style={primaryBtn}>
          + Create Invoice
        </button>
      </div>

      {/* Cashier shift strip */}
      <div style={{ background: openShift ? "#f0fdf4" : "#fffbeb", border: openShift ? "1px solid #bbf7d0" : "1px solid #fcd34d", borderRadius: "8px", padding: "0.85rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
        {openShift ? (
          <>
            <div style={{ fontSize: "0.85rem", color: "#166534" }}>
              <strong>Shift {openShift.shiftNo} open</strong> — opened {new Date(openShift.openedAt).toLocaleString()} with {currency(openShift.openingCash)}. Payments can be received.
            </div>
            <form onSubmit={handleCloseShift} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="number"
                min={0}
                placeholder="Closing cash"
                value={closingCash}
                onChange={(e) => setClosingCash(e.target.value)}
                style={smallInput}
              />
              <button type="submit" style={actionBtn("#92400e")}>Close Shift</button>
            </form>
          </>
        ) : (
          <>
            <div style={{ fontSize: "0.85rem", color: "#78350f" }}>
              No open cashier shift. Open one before receiving payments.
            </div>
            <form onSubmit={handleOpenShift} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="number"
                min={0}
                placeholder="Opening cash"
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
                style={smallInput}
              />
              <button type="submit" style={actionBtn("#b45309")}>Open Shift</button>
            </form>
          </>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "1rem", borderBottom: "2px solid #e2e8f0" }}>
        <button onClick={() => setActiveTab("invoices")} style={tabStyle(activeTab === "invoices")}>
          Invoices & Billing Matrix
        </button>
        <button onClick={() => setActiveTab("payments")} style={tabStyle(activeTab === "payments")}>
          Payments & Receipts
        </button>
      </div>

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: "0.85rem", color: "#b91c1c" }}>
          {error}
        </p>
      )}

      {loading && <p style={{ margin: 0, fontSize: "0.9rem", color: "#64748b" }}>Loading billing data…</p>}

      {/* TAB 1: Invoices */}
      {!loading && activeTab === "invoices" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: "1.5rem", alignItems: "start" }}>
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "1rem" }}>
            <input
              type="text"
              placeholder="Search by patient name, ID or invoice no..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "0.85rem", marginBottom: "1rem", boxSizing: "border-box" }}
            />
            <div style={{ overflowY: "auto", maxHeight: "500px" }}>
              {filteredInvoices.length === 0 && (
                <p style={{ color: "#64748b", fontSize: "0.85rem" }}>No invoices match.</p>
              )}
              {filteredInvoices.map((inv) => (
                <div
                  key={inv.id}
                  onClick={() => setSelectedInvoice(inv)}
                  style={{
                    padding: "0.85rem",
                    borderBottom: "1px solid #f1f5f9",
                    borderRadius: "6px",
                    cursor: "pointer",
                    backgroundColor: selectedInvoice?.id === inv.id ? "#f0f9ff" : "transparent",
                    borderLeft: selectedInvoice?.id === inv.id ? "4px solid #0284c7" : "4px solid transparent",
                    marginBottom: "0.25rem",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 700, color: "#0284c7", fontSize: "0.85rem" }}>{inv.invoiceNo}</span>
                    <StatusPill status={inv.status} />
                  </div>
                  <div style={{ fontWeight: 600, margin: "0.25rem 0", fontSize: "0.9rem" }}>
                    {inv.patientName || "Walk-in"}{" "}
                    <span style={{ fontSize: "0.75rem", color: "#64748b" }}>{inv.patientNo ? `(${inv.patientNo})` : ""}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "0.8rem" }}>
                    <span>{inv.billTo.toUpperCase()}</span>
                    <span style={{ fontWeight: 700, color: "#0f172a" }}>{currency(inv.totalAmount)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {selectedInvoice && (
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "1.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #e2e8f0", paddingBottom: "1rem", marginBottom: "1rem" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#0f172a" }}>INVOICE DETAILS</h3>
                  <span style={{ fontSize: "0.8rem", color: "#64748b" }}>
                    Ref: {selectedInvoice.invoiceNo} | Date: {new Date(selectedInvoice.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  {selectedInvoice.status === "draft" && (
                    <button onClick={() => issueInvoice(selectedInvoice)} style={actionBtn("#2563eb")}>
                      Issue Invoice
                    </button>
                  )}
                  {selectedInvoice.balanceDue > 0 && (selectedInvoice.status === "issued" || selectedInvoice.status === "partially_paid") && (
                    <button
                      onClick={() => {
                        setPayAmount(String(selectedInvoice.balanceDue));
                        setShowPay(true);
                      }}
                      style={actionBtn("#16a34a")}
                    >
                      Receive Payment
                    </button>
                  )}
                </div>
              </div>

              <div style={{ backgroundColor: "#f8fafc", padding: "0.85rem", borderRadius: "6px", marginBottom: "1rem", fontSize: "0.85rem" }}>
                <div><strong>Patient:</strong> {selectedInvoice.patientName || "Walk-in"}</div>
                <div><strong>Bill to:</strong> {selectedInvoice.billTo.toUpperCase()} {selectedInvoice.payerName ? `(${selectedInvoice.payerName})` : ""}</div>
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
                <thead>
                  <tr style={{ background: "#f1f5f9", textAlign: "left", color: "#475569" }}>
                    <th style={{ padding: "0.6rem" }}>Item</th>
                    <th style={{ padding: "0.6rem" }}>Category</th>
                    <th style={{ padding: "0.6rem", textAlign: "right" }}>Price</th>
                    <th style={{ padding: "0.6rem", textAlign: "center" }}>Qty</th>
                    <th style={{ padding: "0.6rem", textAlign: "right" }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedInvoice.items.map((item) => (
                    <tr key={item.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "0.6rem" }}>{item.name}</td>
                      <td style={{ padding: "0.6rem", color: "#64748b" }}>{item.category || "—"}</td>
                      <td style={{ padding: "0.6rem", textAlign: "right" }}>{currency(item.unitPrice)}</td>
                      <td style={{ padding: "0.6rem", textAlign: "center" }}>{item.quantity}</td>
                      <td style={{ padding: "0.6rem", textAlign: "right", fontWeight: 600 }}>{currency(item.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.3rem", fontSize: "0.9rem" }}>
                <div>Subtotal: <strong>{currency(selectedInvoice.subtotal)}</strong></div>
                {selectedInvoice.discountAmount > 0 && (
                  <div>Discount: <strong>-{currency(selectedInvoice.discountAmount)}</strong></div>
                )}
                {selectedInvoice.taxAmount > 0 && <div>Tax: <strong>{currency(selectedInvoice.taxAmount)}</strong></div>}
                <div>Total: <strong>{currency(selectedInvoice.totalAmount)}</strong></div>
                <div style={{ color: "#16a34a" }}>Amount Paid: <strong>{currency(selectedInvoice.amountPaid)}</strong></div>
                <div style={{ fontSize: "1.05rem", fontWeight: 800, color: selectedInvoice.balanceDue > 0 ? "#dc2626" : "#16a34a" }}>
                  Balance Due: {currency(selectedInvoice.balanceDue)}
                </div>
                {selectedInvoice.voidReason && (
                  <div style={{ fontSize: "0.8rem", color: "#dc2626" }}>Voided: {selectedInvoice.voidReason}</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Payments & receipts */}
      {!loading && activeTab === "payments" && (
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "1.5rem" }}>
          <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem", color: "#0f172a" }}>Payment Ledger</h3>
          {payments.length === 0 ? (
            <p style={{ color: "#64748b", fontSize: "0.9rem" }}>No payments recorded yet.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ background: "#f1f5f9", textAlign: "left", color: "#475569" }}>
                  <th style={{ padding: "0.75rem" }}>Payment No</th>
                  <th style={{ padding: "0.75rem" }}>Invoice</th>
                  <th style={{ padding: "0.75rem" }}>Patient</th>
                  <th style={{ padding: "0.75rem" }}>Method</th>
                  <th style={{ padding: "0.75rem" }}>Reference</th>
                  <th style={{ padding: "0.75rem", textAlign: "right" }}>Amount</th>
                  <th style={{ padding: "0.75rem" }}>Received At</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "0.75rem", fontWeight: 700, color: "#0284c7" }}>{p.paymentNo}</td>
                    <td style={{ padding: "0.75rem" }}>{p.invoiceNo}</td>
                    <td style={{ padding: "0.75rem", fontWeight: 600 }}>{p.patientName || "—"}</td>
                    <td style={{ padding: "0.75rem" }}>{p.method.toUpperCase()}</td>
                    <td style={{ padding: "0.75rem", color: "#64748b" }}>{p.reference || "—"}</td>
                    <td style={{ padding: "0.75rem", textAlign: "right", fontWeight: 600, color: "#16a34a" }}>{currency(p.amount)}</td>
                    <td style={{ padding: "0.75rem", color: "#64748b" }}>{new Date(p.receivedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Create invoice modal */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)} title="Create Invoice & Link Patient" width="640px">
          <form onSubmit={handleCreateInvoice} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <FieldLabel>Patient</FieldLabel>
              {selectedPatient ? (
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "#0f172a" }}>
                    {selectedPatient.firstName} {selectedPatient.lastName} ({selectedPatient.patientNo})
                  </span>
                  <button type="button" onClick={() => setSelectedPatient(null)} style={ghostBtn}>×</button>
                </div>
              ) : (
                <input type="text" placeholder="Search patient by name or patient number..." value={patientSearch} onChange={(e) => setPatientSearch(e.target.value)} style={input} />
              )}
              {patients.length > 0 && !selectedPatient && (
                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "6px", marginTop: "0.25rem", overflow: "hidden" }}>
                  {patients.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setSelectedPatient(p);
                        setPatients([]);
                        setPatientSearch("");
                      }}
                      style={{ display: "block", width: "100%", textAlign: "left", padding: "0.5rem 0.75rem", border: "none", borderBottom: "1px solid #f1f5f9", background: "#fff", cursor: "pointer", fontSize: "0.85rem" }}
                    >
                      <strong style={{ color: "#0369a1" }}>{p.patientNo}</strong> — {p.firstName} {p.lastName}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
              <div>
                <FieldLabel>Price list</FieldLabel>
                <select value={selectedPriceList} onChange={(e) => setSelectedPriceList(e.target.value)} style={input}>
                  {priceLists.map((pl) => (
                    <option key={pl.id} value={pl.id}>
                      {pl.name} ({pl.currency})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel>Bill to</FieldLabel>
                <select value={billTo} onChange={(e) => setBillTo(e.target.value)} style={input}>
                  {BILL_TO.map((b) => (
                    <option key={b} value={b}>{b.toUpperCase()}</option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel>Discount (₦)</FieldLabel>
                <input type="number" min={0} value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value)} style={input} />
              </div>
            </div>

            {billTo !== "patient" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div>
                  <FieldLabel>Payer name</FieldLabel>
                  <input value={payerName} onChange={(e) => setPayerName(e.target.value)} placeholder="e.g. Hygeia HMO" style={input} />
                </div>
                <div>
                  <FieldLabel>Policy number</FieldLabel>
                  <input value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} style={input} />
                </div>
              </div>
            )}

            <div>
              <FieldLabel>Line items (from price list)</FieldLabel>
              <div style={{ maxHeight: "220px", overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: "6px" }}>
                {priceListItems.length === 0 && (
                  <p style={{ padding: "0.75rem", color: "#64748b", fontSize: "0.85rem", margin: 0 }}>No items in this price list.</p>
                )}
                {priceListItems.map((it) => (
                  <label key={it.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.75rem", borderBottom: "1px solid #f1f5f9", cursor: "pointer", fontSize: "0.85rem" }}>
                    <input
                      type="checkbox"
                      checked={selectedItemIds.includes(it.id)}
                      onChange={(e) =>
                        setSelectedItemIds((prev) => (e.target.checked ? [...prev, it.id] : prev.filter((x) => x !== it.id)))
                      }
                    />
                    <span style={{ flex: 1 }}>{it.name} <span style={{ color: "#64748b" }}>({it.code})</span></span>
                    <span style={{ fontWeight: 600 }}>{currency(it.price)}</span>
                    <input
                      type="number"
                      min={1}
                      placeholder="Qty"
                      value={quantities[it.id] ?? ""}
                      onChange={(e) => setQuantities((prev) => ({ ...prev, [it.id]: e.target.value }))}
                      style={{ width: "4rem", padding: "0.3rem", border: "1px solid #cbd5e1", borderRadius: "4px" }}
                    />
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <button type="button" onClick={() => setShowCreate(false)} style={ghostBtn}>Cancel</button>
              <button type="submit" disabled={creating} style={primaryBtn}>{creating ? "Creating…" : "Save & Issue Invoice"}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Receive payment modal */}
      {showPay && selectedInvoice && (
        <Modal onClose={() => setShowPay(false)} title="Process Payment & Generate Receipt" width="420px">
          <form onSubmit={handleReceivePayment} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {!openShift && (
              <p style={{ margin: 0, fontSize: "0.8rem", color: "#b45309", background: "#fffbeb", border: "1px solid #fcd34d", padding: "0.5rem 0.75rem", borderRadius: "6px" }}>
                No open cashier shift — the backend will reject this payment until one is opened.
              </p>
            )}
            <div>
              <FieldLabel>Amount (₦)</FieldLabel>
              <input type="number" required min={1} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} style={input} />
            </div>
            <div>
              <FieldLabel>Payment method</FieldLabel>
              <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} style={input}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{m.toUpperCase()}</option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>Reference (optional)</FieldLabel>
              <input value={payReference} onChange={(e) => setPayReference(e.target.value)} placeholder="e.g. transfer reference" style={input} />
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="button" onClick={() => setShowPay(false)} style={{ ...ghostBtn, flex: 1, padding: "0.6rem" }}>Cancel</button>
              <button type="submit" disabled={paying} style={{ ...primaryBtn, flex: 1, padding: "0.6rem" }}>
                {paying ? "Processing…" : "Confirm & Generate Receipt"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Receipt modal */}
      {activeReceipt && (
        <Modal onClose={() => setActiveReceipt(null)} title="Receipt Generated" width="450px">
          <div style={{ textAlign: "center", borderBottom: "2px dashed #cbd5e1", paddingBottom: "1rem", marginBottom: "1rem" }}>
            <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 800, color: "#0f172a" }}>DIVINE HANDS HOSPITAL</h3>
            <p style={{ margin: "0.2rem 0", fontSize: "0.75rem", color: "#64748b" }}>Official Payment Receipt</p>
            <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#0284c7", marginTop: "0.4rem" }}>Receipt #: {activeReceipt.receiptNo}</div>
          </div>
          <div style={{ fontSize: "0.85rem", marginBottom: "1rem", display: "grid", gap: "0.3rem" }}>
            <div><strong>Patient:</strong> {activeReceipt.patientName || "—"}</div>
            <div><strong>Invoice:</strong> {activeReceipt.invoiceNo}</div>
            <div><strong>Method:</strong> {activeReceipt.method.toUpperCase()}</div>
            <div><strong>Amount:</strong> <span style={{ fontWeight: 800, color: "#16a34a" }}>{currency(activeReceipt.amount)}</span></div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={() => window.open(`${getBaseUrl()}/api/v1/billing/receipts/${activeReceipt.id}/html`, "_blank")} style={{ ...primaryBtn, flex: 1 }}>
              Print Receipt
            </button>
            <button onClick={() => window.open(`${getBaseUrl()}/api/v1/billing/receipts/${activeReceipt.id}/pdf`, "_blank")} style={{ ...ghostBtn, flex: 1 }}>
              Download PDF
            </button>
            <button onClick={() => setActiveReceipt(null)} style={{ ...ghostBtn, flex: 1 }}>Close</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ onClose, title, children, width }: { onClose: () => void; title: string; children: ReactNode; width: string }) {
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15, 23, 42, 0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000 }}>
      <div style={{ background: "#fff", borderRadius: "8px", width: "100%", maxWidth: width, padding: "1.5rem", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h3 style={{ margin: 0, color: "#0f172a" }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    paid: ["#f0fdf4", "#16a34a"],
    issued: ["#eff6ff", "#2563eb"],
    partially_paid: ["#fefce8", "#ca8a04"],
    draft: ["#f1f5f9", "#475569"],
    voided: ["#fef2f2", "#dc2626"],
  };
  const [background, color] = map[status] ?? ["#f1f5f9", "#475569"];
  return (
    <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "0.15rem 0.4rem", borderRadius: "4px", background, color }}>
      {status.replace("_", " ").toUpperCase()}
    </span>
  );
}

function FieldLabel({ children }: { children: string }) {
  return <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "#475569", marginBottom: "0.2rem" }}>{children}</label>;
}

function tabStyle(active: boolean): CSSProperties {
  return {
    padding: "0.6rem 1rem",
    background: "none",
    border: "none",
    borderBottom: active ? "2px solid #2563eb" : "none",
    fontWeight: active ? 700 : 500,
    color: active ? "#2563eb" : "#64748b",
    cursor: "pointer",
  };
}

const input: CSSProperties = { width: "100%", padding: "0.5rem", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "0.9rem", boxSizing: "border-box" };
const smallInput: CSSProperties = { width: "8rem", padding: "0.4rem", border: "1px solid #cbd5e1", borderRadius: "4px" };
const primaryBtn: CSSProperties = { padding: "0.6rem 1.2rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "pointer", fontSize: "0.875rem" };
const ghostBtn: CSSProperties = { padding: "0.5rem 1.2rem", background: "transparent", border: "1px solid #cbd5e1", color: "#64748b", borderRadius: "6px", fontWeight: 600, cursor: "pointer" };
const actionBtn = (bg: string): CSSProperties => ({ padding: "0.5rem 1rem", background: bg, color: "#fff", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "pointer", fontSize: "0.85rem" });
