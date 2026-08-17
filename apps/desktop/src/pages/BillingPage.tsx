import { useCallback, useEffect, useState, type FormEvent } from "react";
import { theme, Button, Card, DataTable, EmptyState, FormField, Input, Modal, PageHeader, Select, StatusBadge, TabNav, type StatusVariant } from "@hims/ui";
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
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(val);

function invoiceStatusBadge(status: string): StatusVariant {
  if (status === "paid") return "approved";
  if (status === "issued") return "active";
  if (status === "partially_paid") return "running";
  if (status === "voided") return "error";
  return "draft";
}

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
      errors.push(
        sh.reason instanceof Error ? sh.reason.message : "Could not load cashier shifts.",
      );
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
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Could not load price list items.");
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
        const results = await apiFetch<PatientSummary[]>(
          `/patients/search?q=${encodeURIComponent(q)}`,
        );
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
      const res = await apiFetch<{ payment: Payment; receipt: Receipt }>(
        `/billing/invoices/${selectedInvoice.id}/payments`,
        {
          method: "POST",
          body: JSON.stringify({
            amount: Number(payAmount),
            method: payMethod,
            reference: payReference,
            notes: "",
          }),
        },
      );
      setShowPay(false);
      setPayAmount("");
      setPayReference("");
      setActiveReceipt(res.receipt);
      await loadAll();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not record the payment (an open cashier shift is required).",
      );
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

  const paymentColumns = [
    { key: "no", header: "Payment No", render: (p: Payment) => <strong style={{ color: theme.action.info }}>{p.paymentNo}</strong> },
    { key: "invoice", header: "Invoice", render: (p: Payment) => p.invoiceNo },
    { key: "patient", header: "Patient", render: (p: Payment) => <span style={{ fontWeight: theme.fontWeight.semibold }}>{p.patientName || "—"}</span> },
    { key: "method", header: "Method", render: (p: Payment) => p.method.toUpperCase() },
    { key: "reference", header: "Reference", render: (p: Payment) => p.reference || "—" },
    { key: "amount", header: "Amount", render: (p: Payment) => <strong style={{ color: theme.action.success }}>{currency(p.amount)}</strong> },
    { key: "received", header: "Received At", render: (p: Payment) => new Date(p.receivedAt).toLocaleString() },
  ];

  const invoiceItemColumns = [
    { key: "name", header: "Item", render: (it: InvoiceItem) => it.name },
    { key: "category", header: "Category", render: (it: InvoiceItem) => it.category || "—" },
    { key: "price", header: "Price", align: "right" as const, render: (it: InvoiceItem) => currency(it.unitPrice) },
    { key: "qty", header: "Qty", align: "center" as const, render: (it: InvoiceItem) => it.quantity },
    { key: "total", header: "Total", align: "right" as const, render: (it: InvoiceItem) => <strong>{currency(it.lineTotal)}</strong> },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}>
      <PageHeader
        title="Billing & Cashier"
        description="Registry billing, payment records, and receipt generation."
        actions={<Button onClick={() => setShowCreate(true)}>+ Create Invoice</Button>}
      />

      {/* Cashier shift strip */}
      <div
        style={{
          background: openShift ? theme.badge.approved.bg : theme.badge.running.bg,
          border: `1px solid ${openShift ? theme.badge.approved.border : theme.badge.running.border}`,
          borderRadius: theme.radius.lg,
          padding: `${theme.spacing["3"]} ${theme.spacing["4"]}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: theme.spacing["4"],
          flexWrap: "wrap",
        }}
      >
        {openShift ? (
          <>
            <div style={{ fontSize: theme.fontSize.base, color: theme.badge.approved.text }}>
              <strong>Shift {openShift.shiftNo} open</strong> — opened{" "}
              {new Date(openShift.openedAt).toLocaleString()} with {currency(openShift.openingCash)}
              . Payments can be received.
            </div>
            <form onSubmit={handleCloseShift} style={{ display: "flex", gap: theme.spacing["2"], alignItems: "center" }}>
              <Input
                type="number"
                min={0}
                placeholder="Closing cash"
                value={closingCash}
                onChange={(e) => setClosingCash(e.target.value)}
                style={{ width: "8rem" }}
              />
              <Button type="submit" size="sm" style={{ background: theme.action.warning }}>
                Close Shift
              </Button>
            </form>
          </>
        ) : (
          <>
            <div style={{ fontSize: theme.fontSize.base, color: theme.badge.running.text }}>
              No open cashier shift. Open one before receiving payments.
            </div>
            <form onSubmit={handleOpenShift} style={{ display: "flex", gap: theme.spacing["2"], alignItems: "center" }}>
              <Input
                type="number"
                min={0}
                placeholder="Opening cash"
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
                style={{ width: "8rem" }}
              />
              <Button type="submit" size="sm" style={{ background: theme.action.warning }}>
                Open Shift
              </Button>
            </form>
          </>
        )}
      </div>

      <TabNav
        tabs={[
          { key: "invoices", label: "Invoices & Billing Matrix" },
          { key: "payments", label: "Payments & Receipts" },
        ]}
        active={activeTab}
        onChange={(k) => setActiveTab(k as "invoices" | "payments")}
      />

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.danger }}>
          {error}
        </p>
      )}

      {loading && (
        <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>Loading billing data…</p>
      )}

      {/* TAB 1: Invoices */}
      {!loading && activeTab === "invoices" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: theme.spacing["6"], alignItems: "start" }}>
          <Card bodyStyle={{ padding: theme.spacing["4"] }}>
            <Input
              type="text"
              placeholder="Search by patient name, ID or invoice no..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ marginBottom: theme.spacing["4"] }}
            />
            <div style={{ overflowY: "auto", maxHeight: 500 }}>
              {filteredInvoices.length === 0 && (
                <p style={{ color: theme.text.muted, fontSize: theme.fontSize.base }}>No invoices match.</p>
              )}
              {filteredInvoices.map((inv) => (
                <div
                  key={inv.id}
                  onClick={() => setSelectedInvoice(inv)}
                  style={{
                    padding: theme.spacing["3"],
                    borderBottom: `1px solid ${theme.surface.border}`,
                    borderRadius: theme.radius.md,
                    cursor: "pointer",
                    backgroundColor: selectedInvoice?.id === inv.id ? "#f0f9ff" : "transparent",
                    borderLeft: selectedInvoice?.id === inv.id ? `4px solid ${theme.action.info}` : "4px solid transparent",
                    marginBottom: "0.25rem",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: theme.fontWeight.bold, color: theme.action.info, fontSize: theme.fontSize.base }}>
                      {inv.invoiceNo}
                    </span>
                    <StatusBadge variant={invoiceStatusBadge(inv.status)} label={inv.status.replace("_", " ")} />
                  </div>
                  <div style={{ fontWeight: theme.fontWeight.semibold, margin: "0.25rem 0", fontSize: theme.fontSize.base }}>
                    {inv.patientName || "Walk-in"}{" "}
                    <span style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                      {inv.patientNo ? `(${inv.patientNo})` : ""}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", color: theme.text.muted, fontSize: theme.fontSize.base }}>
                    <span>{inv.billTo.toUpperCase()}</span>
                    <span style={{ fontWeight: theme.fontWeight.bold, color: theme.text.primary }}>{currency(inv.totalAmount)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {selectedInvoice && (
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: `1px solid ${theme.surface.border}`, paddingBottom: theme.spacing["4"], marginBottom: theme.spacing["4"], gap: theme.spacing["4"], flexWrap: "wrap" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: theme.fontSize.lg, color: theme.text.primary }}>INVOICE DETAILS</h3>
                  <span style={{ fontSize: theme.fontSize.base, color: theme.text.muted }}>
                    Ref: {selectedInvoice.invoiceNo} | Date: {new Date(selectedInvoice.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div style={{ display: "flex", gap: theme.spacing["2"], alignItems: "center", flexWrap: "wrap" }}>
                  {selectedInvoice.status === "draft" && (
                    <Button size="sm" onClick={() => issueInvoice(selectedInvoice)}>
                      Issue Invoice
                    </Button>
                  )}
                  {selectedInvoice.balanceDue > 0 &&
                    (selectedInvoice.status === "issued" || selectedInvoice.status === "partially_paid") && (
                      <Button
                        size="sm"
                        style={{ background: theme.action.success }}
                        onClick={() => {
                          setPayAmount(String(selectedInvoice.balanceDue));
                          setShowPay(true);
                        }}
                      >
                        Receive Payment
                      </Button>
                    )}
                </div>
              </div>

              <div
                style={{
                  backgroundColor: theme.surface.subtle,
                  padding: theme.spacing["3"],
                  borderRadius: theme.radius.md,
                  marginBottom: theme.spacing["4"],
                  fontSize: theme.fontSize.base,
                }}
              >
                <div>
                  <strong>Patient:</strong> {selectedInvoice.patientName || "Walk-in"}
                </div>
                <div>
                  <strong>Bill to:</strong> {selectedInvoice.billTo.toUpperCase()}{" "}
                  {selectedInvoice.payerName ? `(${selectedInvoice.payerName})` : ""}
                </div>
              </div>

              <div style={{ marginBottom: "1.5rem" }}>
                <DataTable columns={invoiceItemColumns} rows={selectedInvoice.items} rowKey={(it) => it.id} dense />
              </div>

              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.3rem", fontSize: theme.fontSize.base }}>
                <div>
                  Subtotal: <strong>{currency(selectedInvoice.subtotal)}</strong>
                </div>
                {selectedInvoice.discountAmount > 0 && (
                  <div>
                    Discount: <strong>-{currency(selectedInvoice.discountAmount)}</strong>
                  </div>
                )}
                {selectedInvoice.taxAmount > 0 && (
                  <div>
                    Tax: <strong>{currency(selectedInvoice.taxAmount)}</strong>
                  </div>
                )}
                <div>
                  Total: <strong>{currency(selectedInvoice.totalAmount)}</strong>
                </div>
                <div style={{ color: theme.action.success }}>
                  Amount Paid: <strong>{currency(selectedInvoice.amountPaid)}</strong>
                </div>
                <div
                  style={{
                    fontSize: "1.05rem",
                    fontWeight: theme.fontWeight.bold,
                    color: selectedInvoice.balanceDue > 0 ? theme.action.danger : theme.action.success,
                  }}
                >
                  Balance Due: {currency(selectedInvoice.balanceDue)}
                </div>
                {selectedInvoice.voidReason && (
                  <div style={{ fontSize: theme.fontSize.base, color: theme.action.danger }}>
                    Voided: {selectedInvoice.voidReason}
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* TAB 2: Payments & receipts */}
      {!loading && activeTab === "payments" && (
        <Card title="Payment Ledger" bodyStyle={{ padding: 0 }}>
          {payments.length === 0 ? (
            <EmptyState icon="cash" description="No payments recorded yet." />
          ) : (
            <DataTable columns={paymentColumns} rows={payments} rowKey={(p) => p.id} dense />
          )}
        </Card>
      )}

      {/* Create invoice modal */}
      <Modal
        open={showCreate}
        title="Create Invoice & Link Patient"
        onClose={() => setShowCreate(false)}
        width={640}
      >
        <form onSubmit={handleCreateInvoice} style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
          <FormField label="Patient">
            {selectedPatient ? (
              <div style={{ display: "flex", gap: theme.spacing["2"], alignItems: "center" }}>
                <span style={{ fontSize: theme.fontSize.base, fontWeight: theme.fontWeight.semibold, color: theme.text.primary }}>
                  {selectedPatient.firstName} {selectedPatient.lastName} ({selectedPatient.patientNo})
                </span>
                <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedPatient(null)}>
                  ×
                </Button>
              </div>
            ) : (
              <div style={{ position: "relative" }}>
                <Input
                  type="text"
                  placeholder="Search patient by name or patient number..."
                  value={patientSearch}
                  onChange={(e) => setPatientSearch(e.target.value)}
                />
                {patients.length > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      left: 0,
                      right: 0,
                      background: theme.surface.card,
                      border: `1px solid ${theme.surface.border}`,
                      borderRadius: theme.radius.md,
                      boxShadow: theme.shadow.popover,
                      zIndex: 10,
                      overflow: "hidden",
                    }}
                  >
                    {patients.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setSelectedPatient(p);
                          setPatients([]);
                          setPatientSearch("");
                        }}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          padding: `${theme.spacing["2"]} ${theme.spacing["3"]}`,
                          border: "none",
                          borderBottom: `1px solid ${theme.surface.border}`,
                          background: theme.surface.card,
                          cursor: "pointer",
                          fontSize: theme.fontSize.base,
                        }}
                      >
                        <strong style={{ color: theme.action.info }}>{p.patientNo}</strong> — {p.firstName} {p.lastName}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </FormField>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: theme.spacing["3"] }}>
            <FormField label="Price list">
              <Select value={selectedPriceList} onChange={(e) => setSelectedPriceList(e.target.value)}>
                {priceLists.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pl.name} ({pl.currency})
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Bill to">
              <Select value={billTo} onChange={(e) => setBillTo(e.target.value)}>
                {BILL_TO.map((b) => (
                  <option key={b} value={b}>
                    {b.toUpperCase()}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Discount (₦)">
              <Input
                type="number"
                min={0}
                value={discountAmount}
                onChange={(e) => setDiscountAmount(e.target.value)}
              />
            </FormField>
          </div>

          {billTo !== "patient" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}>
              <FormField label="Payer name">
                <Input value={payerName} onChange={(e) => setPayerName(e.target.value)} placeholder="e.g. Hygeia HMO" />
              </FormField>
              <FormField label="Policy number">
                <Input value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} />
              </FormField>
            </div>
          )}

          <div>
            <span style={{ fontSize: theme.fontSize.base, fontWeight: theme.fontWeight.semibold, color: theme.text.secondary }}>
              Line items (from price list)
            </span>
            <div
              style={{
                maxHeight: 220,
                overflowY: "auto",
                border: `1px solid ${theme.surface.border}`,
                borderRadius: theme.radius.md,
                marginTop: theme.spacing["1"],
              }}
            >
              {priceListItems.length === 0 && (
                <p style={{ padding: theme.spacing["3"], color: theme.text.muted, fontSize: theme.fontSize.base, margin: 0 }}>
                  No items in this price list.
                </p>
              )}
              {priceListItems.map((it) => (
                <label
                  key={it.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: theme.spacing["2"],
                    padding: `${theme.spacing["2"]} ${theme.spacing["3"]}`,
                    borderBottom: `1px solid ${theme.surface.border}`,
                    cursor: "pointer",
                    fontSize: theme.fontSize.base,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedItemIds.includes(it.id)}
                    onChange={(e) =>
                      setSelectedItemIds((prev) =>
                        e.target.checked ? [...prev, it.id] : prev.filter((x) => x !== it.id),
                      )
                    }
                    style={{ accentColor: theme.action.primary }}
                  />
                  <span style={{ flex: 1 }}>
                    {it.name} <span style={{ color: theme.text.muted }}>({it.code})</span>
                  </span>
                  <span style={{ fontWeight: theme.fontWeight.semibold }}>{currency(it.price)}</span>
                  <Input
                    type="number"
                    min={1}
                    placeholder="Qty"
                    value={quantities[it.id] ?? ""}
                    onChange={(e) => setQuantities((prev) => ({ ...prev, [it.id]: e.target.value }))}
                    style={{ width: "4rem" }}
                  />
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: theme.spacing["2"] }}>
            <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={creating}>
              Save & Issue Invoice
            </Button>
          </div>
        </form>
      </Modal>

      {/* Receive payment modal */}
      <Modal
        open={showPay && !!selectedInvoice}
        title="Process Payment & Generate Receipt"
        onClose={() => setShowPay(false)}
        width={420}
      >
        <form onSubmit={handleReceivePayment} style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
          {!openShift && (
            <p
              style={{
                margin: 0,
                fontSize: theme.fontSize.base,
                color: theme.action.warning,
                background: theme.badge.running.bg,
                border: `1px solid ${theme.badge.running.border}`,
                padding: `${theme.spacing["2"]} ${theme.spacing["3"]}`,
                borderRadius: theme.radius.md,
              }}
            >
              No open cashier shift — the backend will reject this payment until one is opened.
            </p>
          )}
          <FormField label="Amount (₦)" required>
            <Input
              type="number"
              required
              min={1}
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
            />
          </FormField>
          <FormField label="Payment method">
            <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m.toUpperCase()}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Reference (optional)">
            <Input
              value={payReference}
              onChange={(e) => setPayReference(e.target.value)}
              placeholder="e.g. transfer reference"
            />
          </FormField>
          <div style={{ display: "flex", gap: theme.spacing["2"] }}>
            <Button type="button" variant="ghost" style={{ flex: 1 }} onClick={() => setShowPay(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={paying} style={{ flex: 1 }}>
              Confirm & Generate Receipt
            </Button>
          </div>
        </form>
      </Modal>

      {/* Receipt modal */}
      <Modal
        open={!!activeReceipt}
        title="Receipt Generated"
        onClose={() => setActiveReceipt(null)}
        width={450}
      >
        {activeReceipt && (
          <>
            <div
              style={{
                textAlign: "center",
                borderBottom: "2px dashed #cbd5e1",
                paddingBottom: theme.spacing["4"],
                marginBottom: theme.spacing["4"],
              }}
            >
              <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: theme.fontWeight.bold, color: theme.text.primary }}>
                DIVINE HANDS HOSPITAL
              </h3>
              <p style={{ margin: "0.2rem 0", fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                Official Payment Receipt
              </p>
              <div style={{ fontSize: theme.fontSize.base, fontWeight: theme.fontWeight.bold, color: theme.action.info, marginTop: "0.4rem" }}>
                Receipt #: {activeReceipt.receiptNo}
              </div>
            </div>
            <div style={{ fontSize: theme.fontSize.base, marginBottom: theme.spacing["4"], display: "grid", gap: "0.3rem" }}>
              <div>
                <strong>Patient:</strong> {activeReceipt.patientName || "—"}
              </div>
              <div>
                <strong>Invoice:</strong> {activeReceipt.invoiceNo}
              </div>
              <div>
                <strong>Method:</strong> {activeReceipt.method.toUpperCase()}
              </div>
              <div>
                <strong>Amount:</strong>{" "}
                <span style={{ fontWeight: theme.fontWeight.bold, color: theme.action.success }}>
                  {currency(activeReceipt.amount)}
                </span>
              </div>
            </div>
            <div style={{ display: "flex", gap: theme.spacing["2"] }}>
              <Button
                style={{ flex: 1 }}
                onClick={() =>
                  window.open(
                    `${getBaseUrl()}/api/v1/billing/receipts/${activeReceipt.id}/html`,
                    "_blank",
                  )
                }
              >
                Print Receipt
              </Button>
              <Button
                variant="outline"
                style={{ flex: 1 }}
                onClick={() =>
                  window.open(
                    `${getBaseUrl()}/api/v1/billing/receipts/${activeReceipt.id}/pdf`,
                    "_blank",
                  )
                }
              >
                Download PDF
              </Button>
              <Button variant="ghost" style={{ flex: 1 }} onClick={() => setActiveReceipt(null)}>
                Close
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
