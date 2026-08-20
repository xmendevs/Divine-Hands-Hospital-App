import { useCallback, useEffect, useState, type FormEvent } from "react";
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
import { apiFetch, getBaseUrl } from "../api/client";
import { useAuth } from "../auth/AuthContext";

/* ──────────────────────────── Types ────────────────────────────── */

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
  policyNumber?: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  status: string;
  issuedAt?: string;
  voidReason?: string;
  validatedBy?: string;
  validatedByName?: string;
  validatedAt?: string;
  paymentPlan?: string;
  installmentAmount?: number;
  installmentFrequency?: string;
  updateReason?: string;
  createdAt: string;
  items: InvoiceItem[];
}

interface Payment {
  id: string;
  paymentNo: string;
  invoiceId: string;
  invoiceNo: string;
  patientId?: string;
  patientName: string;
  amount: number;
  method: string;
  reference: string;
  payerName?: string;
  notes?: string;
  receivedAt: string;
}

interface Receipt {
  id: string;
  receiptNo: string;
  invoiceNo: string;
  patientName: string;
  patientNo?: string;
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
  cashierName?: string;
  openedAt: string;
  closedAt?: string;
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

/* ──────────────────────────── Constants ──────────────────────────── */

const PAYMENT_METHODS = [
  "cash",
  "pos",
  "card",
  "transfer",
  "online",
  "insurance",
  "corporate",
];
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

function methodLabel(m: string) {
  const map: Record<string, string> = {
    cash: "Cash",
    pos: "POS",
    card: "Card",
    transfer: "Bank Transfer",
    online: "Online",
    insurance: "Insurance",
    corporate: "Corporate",
  };
  return map[m] || m.toUpperCase();
}

/* ──────────────────────────── Component ──────────────────────────── */

type TabKey = "dashboard" | "invoices" | "payments" | "shifts" | "validate";

export default function BillingPage() {
  const { me } = useAuth();
  const isSuperAdmin =
    me?.roles?.some(
      (r: { code?: string }) => r.code === "super_admin" || r.code === "superadmin",
    ) ?? false;

  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [priceListItems, setPriceListItems] = useState<PriceListItem[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const toast = useToast();

  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  /* ── Cashier shift state ── */
  const [openingCash, setOpeningCash] = useState("");
  const [closingCash, setClosingCash] = useState("");

  /* ── Create invoice modal ── */
  const [showCreate, setShowCreate] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [selectedPatient, setSelectedPatient] =
    useState<PatientSummary | null>(null);
  const [selectedPriceList, setSelectedPriceList] = useState("");
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [billTo, setBillTo] = useState("patient");
  const [payerName, setPayerName] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");
  const [creating, setCreating] = useState(false);

  /* ── Receive payment modal ── */
  const [showPay, setShowPay] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("cash");
  const [payReference, setPayReference] = useState("");
  const [payPayerName, setPayPayerName] = useState("");
  const [paying, setPaying] = useState(false);

  /* ── Receipt modal ── */
  const [activeReceipt, setActiveReceipt] = useState<Receipt | null>(null);

  /* ── Share receipt modal ── */
  const [showShare, setShowShare] = useState(false);
  const [shareReceipt, setShareReceipt] = useState<Receipt | null>(null);

  /* ── Edit invoice modal (super admin) ── */
  const [showEdit, setShowEdit] = useState(false);
  const [editDiscount, setEditDiscount] = useState("");
  const [editPlan, setEditPlan] = useState("full");
  const [editInstallmentAmt, setEditInstallmentAmt] = useState("");
  const [editInstallmentFreq, setEditInstallmentFreq] = useState("monthly");
  const [editReason, setEditReason] = useState("");
  const [saving, setSaving] = useState(false);

  /* ──────────────────────────── Data Loading ──────────────────────── */

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
      errors.push(
        inv.reason instanceof Error ? inv.reason.message : "Could not load invoices.",
      );
    }
    if (pay.status === "fulfilled") setPayments(pay.value);
    else errors.push(pay.reason instanceof Error ? pay.reason.message : "Payments load failed.");
    if (pl.status === "fulfilled") {
      setPriceLists(pl.value);
      setSelectedPriceList((cur) => cur || pl.value[0]?.id || "");
    } else errors.push(pl.reason instanceof Error ? pl.reason.message : "Price lists load failed.");
    if (sh.status === "fulfilled") setShifts(sh.value);
    else errors.push(sh.reason instanceof Error ? sh.reason.message : "Shifts load failed.");
    setError(errors.join(" "));
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  /* Load price list items */
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
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedPriceList]);

  /* Debounced patient search */
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
      } catch {
        /* ignore */
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [patientSearch]);

  const openShift = shifts.find((s) => s.status === "open");

  /* ──────────────────────────── Actions ──────────────────────── */

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
      toast.success("Cashier shift opened.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not open shift.";
      setError(msg);
      toast.error(msg);
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
      toast.success("Cashier shift closed.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not close shift.";
      setError(msg);
      toast.error(msg);
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
      toast.success(`Invoice ${inv.invoiceNo} created.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not create invoice.";
      setError(msg);
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  async function issueInvoice(inv: Invoice) {
    setError("");
    try {
      await apiFetch<unknown>(`/billing/invoices/${inv.id}/issue`, {
        method: "POST",
      });
      await loadAll();
      toast.success(`Invoice ${inv.invoiceNo} issued.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not issue invoice.";
      setError(msg);
      toast.error(msg);
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
            payerName: payPayerName || selectedInvoice.patientName || "",
            notes: "",
          }),
        },
      );
      setShowPay(false);
      setPayAmount("");
      setPayReference("");
      setPayPayerName("");
      setActiveReceipt(res.receipt);
      await loadAll();
      toast.success(`Payment of ${currency(res.payment.amount)} recorded.`);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Could not record payment (open a cashier shift first).";
      setError(msg);
      toast.error(msg);
    } finally {
      setPaying(false);
    }
  }

  async function handleValidateInvoice(inv: Invoice) {
    setError("");
    try {
      await apiFetch<unknown>(`/billing/invoices/${inv.id}/validate`, {
        method: "POST",
      });
      await loadAll();
      toast.success(`Invoice ${inv.invoiceNo} validated & signed off.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Validation failed.";
      setError(msg);
      toast.error(msg);
    }
  }

  async function handleUpdateInvoice(e: FormEvent) {
    e.preventDefault();
    if (!selectedInvoice) return;
    setSaving(true);
    try {
      await apiFetch<unknown>(`/billing/invoices/${selectedInvoice.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          subtotal: selectedInvoice.subtotal,
          discountAmount: Number(editDiscount),
          taxAmount: selectedInvoice.taxAmount,
          totalAmount:
            selectedInvoice.subtotal -
            Number(editDiscount) +
            selectedInvoice.taxAmount,
          paymentPlan: editPlan,
          installmentAmount: editInstallmentAmt
            ? Number(editInstallmentAmt)
            : null,
          installmentFrequency: editInstallmentFreq,
          updateReason: editReason,
        }),
      });
      setShowEdit(false);
      setEditDiscount("");
      setEditReason("");
      await loadAll();
      toast.success("Invoice updated.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Update failed.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  /* ──────────────────────────── Computed ──────────────────────── */

  const filteredInvoices = invoices.filter(
    (inv) =>
      !searchTerm ||
      inv.patientName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inv.invoiceNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inv.patientNo?.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayPayments = payments.filter(
    (p) => p.receivedAt.slice(0, 10) === todayStr,
  );
  const todayCollections = todayPayments.reduce((s, p) => s + p.amount, 0);
  const outstandingBalance = invoices.reduce(
    (s, i) => s + (i.balanceDue > 0 ? i.balanceDue : 0),
    0,
  );
  const pendingValidations = invoices.filter(
    (i) =>
      i.status !== "draft" &&
      i.status !== "voided" &&
      !i.validatedBy,
  ).length;
  const totalPaid = invoices.reduce((s, i) => s + i.amountPaid, 0);

  /* Method breakdown for dashboard */
  const methodBreakdown = todayPayments.reduce<Record<string, number>>(
    (acc, p) => {
      acc[p.method] = (acc[p.method] || 0) + p.amount;
      return acc;
    },
    {},
  );

  /* ──────────────────────────── Table Columns ──────────────────── */

  const paymentColumns = [
    {
      key: "no",
      header: "Payment No",
      render: (p: Payment) => (
        <strong style={{ color: theme.action.info }}>{p.paymentNo}</strong>
      ),
    },
    { key: "invoice", header: "Invoice", render: (p: Payment) => p.invoiceNo },
    {
      key: "patient",
      header: "Patient",
      render: (p: Payment) => (
        <span style={{ fontWeight: theme.fontWeight.semibold }}>
          {p.patientName || "\u2014"}
        </span>
      ),
    },
    { key: "method", header: "Method", render: (p: Payment) => methodLabel(p.method) },
    { key: "payer", header: "Payer", render: (p: Payment) => p.payerName || p.patientName || "\u2014" },
    { key: "reference", header: "Reference", render: (p: Payment) => p.reference || "\u2014" },
    {
      key: "amount",
      header: "Amount",
      align: "right" as const,
      render: (p: Payment) => (
        <strong style={{ color: theme.action.success }}>{currency(p.amount)}</strong>
      ),
    },
    {
      key: "received",
      header: "Date",
      render: (p: Payment) => new Date(p.receivedAt).toLocaleString(),
    },
  ];

  const ledgerColumns = [
    {
      key: "invoice",
      header: "Invoice ID / Ref",
      render: (i: Invoice) => <strong style={{ color: theme.action.info }}>{i.invoiceNo}</strong>,
    },
    {
      key: "patient",
      header: "Patient details",
      render: (i: Invoice) => (
        <span>{i.patientName || "Walk-in"}{i.patientNo ? ` (${i.patientNo})` : ""}</span>
      ),
    },
    {
      key: "services",
      header: "Service breakdown",
      render: (i: Invoice) => [...new Set(i.items.map((item) => item.category || "General"))].join(" + ") || "—",
    },
    { key: "total", header: "Total bill", align: "right" as const, render: (i: Invoice) => currency(i.totalAmount) },
    { key: "paid", header: "Total paid", align: "right" as const, render: (i: Invoice) => currency(i.amountPaid) },
    {
      key: "balance",
      header: "Balance due",
      align: "right" as const,
      render: (i: Invoice) => <strong style={{ color: i.balanceDue > 0 ? theme.action.danger : theme.action.success }}>{currency(i.balanceDue)}</strong>,
    },
    {
      key: "lastPayment",
      header: "Latest payment",
      render: (i: Invoice) => {
        const payment = payments.find((p) => p.invoiceId === i.id);
        return payment ? `${methodLabel(payment.method)} · ${payment.payerName || payment.patientName || "—"}` : "—";
      },
    },
    {
      key: "paidAt",
      header: "Payment date & time",
      render: (i: Invoice) => {
        const payment = payments.find((p) => p.invoiceId === i.id);
        return payment ? new Date(payment.receivedAt).toLocaleString() : "—";
      },
    },
    { key: "status", header: "Payment status", render: (i: Invoice) => <StatusBadge variant={invoiceStatusBadge(i.status)} label={i.status.replace("_", " ")} /> },
    {
      key: "verification",
      header: "Super Admin verification",
      render: (i: Invoice) => <StatusBadge variant={i.validatedBy ? "approved" : "running"} label={i.validatedBy ? "Approved & signed off" : "Pending review"} />,
    },
    {
      key: "actions",
      header: "Actions",
      render: (i: Invoice) => (
        <div style={{ display: "flex", gap: theme.spacing["1"] }}>
          <Button size="sm" variant="outline" onClick={() => { setSelectedInvoice(i); setActiveTab("invoices"); }}>View</Button>
          {isSuperAdmin && !i.validatedBy && i.amountPaid > 0 && (
            <Button size="sm" onClick={() => void handleValidateInvoice(i)}>Sign-off</Button>
          )}
        </div>
      ),
    },
  ];

  const invoiceItemColumns = [
    { key: "name", header: "Item", render: (it: InvoiceItem) => it.name },
    { key: "category", header: "Category", render: (it: InvoiceItem) => it.category || "\u2014" },
    {
      key: "price",
      header: "Unit Price",
      align: "right" as const,
      render: (it: InvoiceItem) => currency(it.unitPrice),
    },
    {
      key: "qty",
      header: "Qty",
      align: "center" as const,
      render: (it: InvoiceItem) => it.quantity,
    },
    {
      key: "total",
      header: "Line Total",
      align: "right" as const,
      render: (it: InvoiceItem) => <strong>{currency(it.lineTotal)}</strong>,
    },
  ];

  const shiftColumns = [
    {
      key: "shiftNo",
      header: "Shift No",
      render: (sh: Shift) => (
        <strong style={{ color: theme.action.info }}>{sh.shiftNo}</strong>
      ),
    },
    { key: "cashier", header: "Cashier", render: (sh: Shift) => sh.cashierName || sh.cashierId },
    { key: "opened", header: "Opened", render: (sh: Shift) => new Date(sh.openedAt).toLocaleString() },
    { key: "closed", header: "Closed", render: (sh: Shift) => (sh.closedAt ? new Date(sh.closedAt).toLocaleString() : "\u2014") },
    { key: "opening", header: "Opening Cash", align: "right" as const, render: (sh: Shift) => currency(sh.openingCash) },
    { key: "closing", header: "Closing Cash", align: "right" as const, render: (sh: Shift) => (sh.closingCash != null ? currency(sh.closingCash) : "\u2014") },
    { key: "expected", header: "Expected", align: "right" as const, render: (sh: Shift) => (sh.expectedCash != null ? currency(sh.expectedCash) : "\u2014") },
    { key: "variance", header: "Variance", align: "right" as const, render: (sh: Shift) => (sh.variance != null ? (
      <span style={{ color: Math.abs(sh.variance) > 0 ? theme.action.danger : theme.action.success, fontWeight: theme.fontWeight.bold }}>
        {currency(sh.variance)}
      </span>
    ) : "\u2014") },
    {
      key: "status",
      header: "Status",
      render: (sh: Shift) => (
        <StatusBadge
          variant={sh.status === "open" ? "active" : "approved"}
          label={sh.status}
        />
      ),
    },
  ];

  /* ──────────────────────────── Render ──────────────────────── */

  const tabs: { key: TabKey; label: string }[] = [
    { key: "dashboard", label: "Dashboard" },
    { key: "invoices", label: "Invoices" },
    { key: "payments", label: "Payments & Receipts" },
    { key: "shifts", label: "Cashier Shifts" },
  ];
  if (isSuperAdmin) {
    tabs.push({ key: "validate", label: "Validate & Sign-off" });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}>
      <PageHeader
        title="Billing & Cashier"
        description="Invoices, payments, cashier shifts, and validation."
        actions={
          <Button onClick={() => setShowCreate(true)}>+ Create Invoice</Button>
        }
      />

      {/* ── Cashier shift strip ── */}
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
              <strong>Shift {openShift.shiftNo}</strong> open &mdash; opened{" "}
              {new Date(openShift.openedAt).toLocaleString()} with {currency(openShift.openingCash)}
              . Payments can be received.
            </div>
            <form
              onSubmit={handleCloseShift}
              style={{ display: "flex", gap: theme.spacing["2"], alignItems: "center" }}
            >
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
            <form
              onSubmit={handleOpenShift}
              style={{ display: "flex", gap: theme.spacing["2"], alignItems: "center" }}
            >
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

      <TabNav tabs={tabs} active={activeTab} onChange={(k) => setActiveTab(k as TabKey)} />

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.danger }}>
          {error}
        </p>
      )}

      {loading && (
        <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>
          Loading billing data...
        </p>
      )}

      {/* ════════════════════ TAB: Dashboard ════════════════════ */}
      {!loading && activeTab === "dashboard" && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}>
          {/* KPI Cards */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: theme.spacing["4"],
            }}
          >
            {[
              {
                label: "Today's Collections",
                value: currency(todayCollections),
                color: theme.action.success,
                bg: theme.badge.approved.bg,
              },
              {
                label: "Outstanding Balance",
                value: currency(outstandingBalance),
                color: theme.action.danger,
                bg: theme.badge.error?.bg ?? "#fef2f2",
              },
              {
                label: "Pending Validations",
                value: String(pendingValidations),
                color: theme.action.warning,
                bg: theme.badge.running.bg,
              },
              {
                label: "Total Paid (All Time)",
                value: currency(totalPaid),
                color: theme.action.info,
                bg: theme.badge.active?.bg ?? "#eff6ff",
              },
              {
                label: "Total Invoices",
                value: String(invoices.length),
                color: theme.text.primary,
                bg: theme.surface.subtle,
              },
            ].map((card) => (
              <div
                key={card.label}
                style={{
                  background: card.bg,
                  borderRadius: theme.radius.lg,
                  padding: theme.spacing["4"],
                  border: `1px solid ${theme.surface.border}`,
                }}
              >
                <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, marginBottom: "0.25rem" }}>
                  {card.label}
                </div>
                <div style={{ fontSize: "1.5rem", fontWeight: theme.fontWeight.bold, color: card.color }}>
                  {card.value}
                </div>
              </div>
            ))}
          </div>

          {/* Today's payment breakdown by method */}
          <Card title="Today's Payment Breakdown">
            {Object.keys(methodBreakdown).length === 0 ? (
              <p style={{ color: theme.text.muted, fontSize: theme.fontSize.base, margin: 0 }}>
                No payments recorded today.
              </p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                  gap: theme.spacing["3"],
                }}
              >
                {Object.entries(methodBreakdown)
                  .sort((a, b) => b[1] - a[1])
                  .map(([method, amount]) => (
                    <div
                      key={method}
                      style={{
                        padding: theme.spacing["3"],
                        borderRadius: theme.radius.md,
                        background: theme.surface.subtle,
                        border: `1px solid ${theme.surface.border}`,
                      }}
                    >
                      <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                        {methodLabel(method)}
                      </div>
                      <div style={{ fontSize: "1.1rem", fontWeight: theme.fontWeight.bold, color: theme.text.primary }}>
                        {currency(amount)}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </Card>

          {/* Recent invoices quick view */}
          <Card title="Recent Invoices">
            {invoices.length === 0 ? (
              <EmptyState icon="cash" description="No invoices yet." />
            ) : (
              <DataTable
                columns={[
                  { key: "no", header: "Invoice No", render: (i: Invoice) => <strong style={{ color: theme.action.info }}>{i.invoiceNo}</strong> },
                  { key: "patient", header: "Patient", render: (i: Invoice) => i.patientName || "Walk-in" },
                  { key: "total", header: "Total", align: "right" as const, render: (i: Invoice) => currency(i.totalAmount) },
                  { key: "paid", header: "Paid", align: "right" as const, render: (i: Invoice) => <span style={{ color: theme.action.success }}>{currency(i.amountPaid)}</span> },
                  { key: "balance", header: "Balance", align: "right" as const, render: (i: Invoice) => (
                    <span style={{ color: i.balanceDue > 0 ? theme.action.danger : theme.action.success, fontWeight: theme.fontWeight.bold }}>
                      {currency(i.balanceDue)}
                    </span>
                  )},
                  { key: "status", header: "Status", render: (i: Invoice) => <StatusBadge variant={invoiceStatusBadge(i.status)} label={i.status.replace("_", " ")} /> },
                  { key: "validated", header: "Validated", render: (i: Invoice) => i.validatedBy ? (
                    <StatusBadge variant="approved" label="Signed Off" />
                  ) : (
                    <StatusBadge variant="draft" label="Pending" />
                  )},
                ]}
                rows={invoices.slice(0, 10)}
                rowKey={(i: Invoice) => i.id}
                dense
              />
            )}
          </Card>
        </div>
      )}

      {/* ════════════════════ TAB: Invoices ════════════════════ */}
      {!loading && activeTab === "invoices" && (
        <>
          <Card title="Unified Patient Billing Ledger" bodyStyle={{ padding: 0 }}>
            <div style={{ overflowX: "auto" }}>
              <DataTable columns={ledgerColumns} rows={filteredInvoices} rowKey={(i: Invoice) => i.id} dense />
            </div>
          </Card>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1.4fr",
              gap: theme.spacing["6"],
              alignItems: "start",
            }}
          >
          {/* Invoice list */}
          <Card bodyStyle={{ padding: theme.spacing["4"] }}>
            <Input
              type="text"
              placeholder="Search by patient name, ID or invoice no..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ marginBottom: theme.spacing["4"] }}
            />
            <div style={{ overflowY: "auto", maxHeight: 550 }}>
              {filteredInvoices.length === 0 && (
                <p style={{ color: theme.text.muted, fontSize: theme.fontSize.base }}>
                  No invoices match.
                </p>
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
                    backgroundColor:
                      selectedInvoice?.id === inv.id ? theme.surface.subtle : "transparent",
                    borderLeft:
                      selectedInvoice?.id === inv.id
                        ? `4px solid ${theme.action.info}`
                        : "4px solid transparent",
                    marginBottom: "0.25rem",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span
                      style={{
                        fontWeight: theme.fontWeight.bold,
                        color: theme.action.info,
                        fontSize: theme.fontSize.base,
                      }}
                    >
                      {inv.invoiceNo}
                    </span>
                    <div style={{ display: "flex", gap: theme.spacing["1"] }}>
                      <StatusBadge variant={invoiceStatusBadge(inv.status)} label={inv.status.replace("_", " ")} />
                      {inv.validatedBy && <StatusBadge variant="approved" label="Validated" />}
                    </div>
                  </div>
                  <div style={{ fontWeight: theme.fontWeight.semibold, margin: "0.25rem 0", fontSize: theme.fontSize.base }}>
                    {inv.patientName || "Walk-in"}{" "}
                    <span style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                      {inv.patientNo ? `(${inv.patientNo})` : ""}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                    <span>{inv.billTo.toUpperCase()}</span>
                    <span style={{ fontWeight: theme.fontWeight.bold, color: inv.balanceDue > 0 ? theme.action.danger : theme.action.success }}>
                      {currency(inv.balanceDue)} bal
                    </span>
                  </div>
                  {inv.paymentPlan === "installment" && inv.installmentAmount && (
                    <div style={{ fontSize: theme.fontSize.xs, color: theme.action.info, marginTop: "0.15rem" }}>
                      Installment: {currency(inv.installmentAmount)} / {inv.installmentFrequency}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {/* Invoice detail panel */}
          {selectedInvoice && (
            <Card>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  borderBottom: `1px solid ${theme.surface.border}`,
                  paddingBottom: theme.spacing["4"],
                  marginBottom: theme.spacing["4"],
                  gap: theme.spacing["4"],
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <h3 style={{ margin: 0, fontSize: theme.fontSize.lg, color: theme.text.primary }}>
                    INVOICE DETAILS
                  </h3>
                  <span style={{ fontSize: theme.fontSize.base, color: theme.text.muted }}>
                    Ref: {selectedInvoice.invoiceNo} | Date:{" "}
                    {new Date(selectedInvoice.createdAt).toLocaleDateString()}
                  </span>
                  {selectedInvoice.validatedBy && (
                    <div style={{ fontSize: theme.fontSize.sm, color: theme.action.success, marginTop: "0.2rem" }}>
                      Validated by: {selectedInvoice.validatedByName || "Admin"} on{" "}
                      {selectedInvoice.validatedAt
                        ? new Date(selectedInvoice.validatedAt).toLocaleString()
                        : "\u2014"}
                    </div>
                  )}
                  {selectedInvoice.updateReason && (
                    <div style={{ fontSize: theme.fontSize.sm, color: theme.action.warning, marginTop: "0.1rem" }}>
                      Last update reason: {selectedInvoice.updateReason}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: theme.spacing["2"], alignItems: "center", flexWrap: "wrap" }}>
                  {selectedInvoice.status === "draft" && (
                    <Button size="sm" onClick={() => issueInvoice(selectedInvoice)}>
                      Issue Invoice
                    </Button>
                  )}
                  {selectedInvoice.balanceDue > 0 &&
                    (selectedInvoice.status === "issued" ||
                      selectedInvoice.status === "partially_paid") && (
                      <Button
                        size="sm"
                        style={{ background: theme.action.success }}
                        onClick={() => {
                          setPayAmount(String(selectedInvoice.balanceDue));
                          setPayPayerName(selectedInvoice.patientName || "");
                          setShowPay(true);
                        }}
                      >
                        Receive Payment
                      </Button>
                    )}
                  {selectedInvoice.status !== "voided" &&
                    selectedInvoice.status !== "paid" &&
                    selectedInvoice.validatedBy && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setShareReceipt({
                            id: "",
                            receiptNo: "",
                            invoiceNo: selectedInvoice.invoiceNo,
                            patientName: selectedInvoice.patientName || "",
                            patientNo: selectedInvoice.patientNo,
                            amount: selectedInvoice.amountPaid,
                            method: "",
                            currency: "NGN",
                            issuedAt: selectedInvoice.createdAt,
                          });
                          setShowShare(true);
                        }}
                      >
                        Share Receipt
                      </Button>
                    )}
                  {isSuperAdmin &&
                    selectedInvoice.status !== "voided" &&
                    selectedInvoice.status !== "paid" &&
                    !selectedInvoice.validatedBy && (
                      <Button
                        size="sm"
                        style={{ background: theme.action.warning }}
                        onClick={() => handleValidateInvoice(selectedInvoice)}
                      >
                        Validate & Sign-off
                      </Button>
                    )}
                  {isSuperAdmin &&
                    (selectedInvoice.status === "issued" ||
                      selectedInvoice.status === "partially_paid") && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditDiscount(String(selectedInvoice.discountAmount));
                          setEditPlan(selectedInvoice.paymentPlan || "full");
                          setEditInstallmentAmt(
                            selectedInvoice.installmentAmount
                              ? String(selectedInvoice.installmentAmount)
                              : "",
                          );
                          setEditInstallmentFreq(selectedInvoice.installmentFrequency || "monthly");
                          setEditReason("");
                          setShowEdit(true);
                        }}
                      >
                        Edit Invoice
                      </Button>
                    )}
                </div>
              </div>

              {/* Patient & billing info */}
              <div
                style={{
                  backgroundColor: theme.surface.subtle,
                  padding: theme.spacing["3"],
                  borderRadius: theme.radius.md,
                  marginBottom: theme.spacing["4"],
                  fontSize: theme.fontSize.base,
                  display: "grid",
                  gap: "0.2rem",
                }}
              >
                <div>
                  <strong>Patient:</strong> {selectedInvoice.patientName || "Walk-in"}
                </div>
                {selectedInvoice.patientNo && (
                  <div>
                    <strong>Patient ID:</strong> {selectedInvoice.patientNo}
                  </div>
                )}
                <div>
                  <strong>Bill to:</strong> {selectedInvoice.billTo.toUpperCase()}{" "}
                  {selectedInvoice.payerName ? `(${selectedInvoice.payerName})` : ""}
                </div>
                {selectedInvoice.policyNumber && (
                  <div>
                    <strong>Policy:</strong> {selectedInvoice.policyNumber}
                  </div>
                )}
                <div>
                  <strong>Payment Plan:</strong>{" "}
                  {(selectedInvoice.paymentPlan || "full").toUpperCase()}
                </div>
              </div>

              {/* Line items */}
              <div style={{ marginBottom: "1.5rem" }}>
                <DataTable
                  columns={invoiceItemColumns}
                  rows={selectedInvoice.items}
                  rowKey={(it: InvoiceItem) => it.id}
                  dense
                />
              </div>

              {/* Totals */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  gap: "0.3rem",
                  fontSize: theme.fontSize.base,
                }}
              >
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
                <div style={{ fontSize: "1.05rem" }}>
                  Total: <strong>{currency(selectedInvoice.totalAmount)}</strong>
                </div>
                <div style={{ color: theme.action.success }}>
                  Amount Paid: <strong>{currency(selectedInvoice.amountPaid)}</strong>
                </div>
                <div
                  style={{
                    fontSize: "1.1rem",
                    fontWeight: theme.fontWeight.bold,
                    color:
                      selectedInvoice.balanceDue > 0
                        ? theme.action.danger
                        : theme.action.success,
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
        </>
      )}

      {/* ════════════════════ TAB: Payments & Receipts ════════════════════ */}
      {!loading && activeTab === "payments" && (
        <Card title="Payment Ledger" bodyStyle={{ padding: 0 }}>
          {payments.length === 0 ? (
            <EmptyState icon="cash" description="No payments recorded yet." />
          ) : (
            <DataTable columns={paymentColumns} rows={payments} rowKey={(p: Payment) => p.id} dense />
          )}
        </Card>
      )}

      {/* ════════════════════ TAB: Cashier Shifts ════════════════════ */}
      {!loading && activeTab === "shifts" && (
        <Card title="Cashier Shift History" bodyStyle={{ padding: 0 }}>
          {shifts.length === 0 ? (
            <EmptyState icon="cash" description="No shifts recorded yet." />
          ) : (
            <DataTable columns={shiftColumns} rows={shifts} rowKey={(sh: Shift) => sh.id} dense />
          )}
        </Card>
      )}

      {/* ════════════════════ TAB: Validate & Sign-off (super admin) ════════════════════ */}
      {!loading && activeTab === "validate" && isSuperAdmin && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
          <Card title="Pending Validation" bodyStyle={{ padding: 0 }}>
            {(() => {
              const pending = invoices.filter(
                (i) =>
                  i.status !== "draft" &&
                  i.status !== "voided" &&
                  !i.validatedBy,
              );
              if (pending.length === 0) {
                return (
                  <div style={{ padding: theme.spacing["6"], textAlign: "center" }}>
                    <p style={{ color: theme.text.muted, fontSize: theme.fontSize.base }}>
                      All invoices have been validated.
                    </p>
                  </div>
                );
              }
              return (
                <DataTable
                  columns={[
                    { key: "no", header: "Invoice", render: (i: Invoice) => <strong style={{ color: theme.action.info }}>{i.invoiceNo}</strong> },
                    { key: "patient", header: "Patient", render: (i: Invoice) => i.patientName || "Walk-in" },
                    { key: "total", header: "Total", align: "right" as const, render: (i: Invoice) => currency(i.totalAmount) },
                    { key: "paid", header: "Paid", align: "right" as const, render: (i: Invoice) => currency(i.amountPaid) },
                    { key: "balance", header: "Balance", align: "right" as const, render: (i: Invoice) => (
                      <span style={{ color: i.balanceDue > 0 ? theme.action.danger : theme.action.success, fontWeight: theme.fontWeight.bold }}>
                        {currency(i.balanceDue)}
                      </span>
                    )},
                    { key: "status", header: "Status", render: (i: Invoice) => <StatusBadge variant={invoiceStatusBadge(i.status)} label={i.status.replace("_", " ")} /> },
                    {
                      key: "action",
                      header: "Action",
                      render: (i: Invoice) => (
                        <Button
                          size="sm"
                          style={{ background: theme.action.warning }}
                          onClick={() => handleValidateInvoice(i)}
                        >
                          Validate & Sign-off
                        </Button>
                      ),
                    },
                  ]}
                  rows={pending}
                  rowKey={(i: Invoice) => i.id}
                  dense
                />
              );
            })()}
          </Card>

          <Card title="Recently Validated" bodyStyle={{ padding: 0 }}>
            {(() => {
              const validated = invoices.filter((i) => i.validatedBy);
              if (validated.length === 0) {
                return (
                  <div style={{ padding: theme.spacing["6"], textAlign: "center" }}>
                    <p style={{ color: theme.text.muted, fontSize: theme.fontSize.base }}>
                      No validated invoices yet.
                    </p>
                  </div>
                );
              }
              return (
                <DataTable
                  columns={[
                    { key: "no", header: "Invoice", render: (i: Invoice) => <strong>{i.invoiceNo}</strong> },
                    { key: "patient", header: "Patient", render: (i: Invoice) => i.patientName || "Walk-in" },
                    { key: "total", header: "Total", align: "right" as const, render: (i: Invoice) => currency(i.totalAmount) },
                    { key: "validatedBy", header: "Validated By", render: (i: Invoice) => i.validatedByName || "Admin" },
                    { key: "validatedAt", header: "Validated At", render: (i: Invoice) => i.validatedAt ? new Date(i.validatedAt).toLocaleString() : "\u2014" },
                    { key: "status", header: "Status", render: (i: Invoice) => <StatusBadge variant={invoiceStatusBadge(i.status)} label={i.status.replace("_", " ")} /> },
                  ]}
                  rows={validated}
                  rowKey={(i: Invoice) => i.id}
                  dense
                />
              );
            })()}
          </Card>
        </div>
      )}

      {/* ════════════════════ MODALS ════════════════════ */}

      {/* Create invoice modal */}
      <Modal
        open={showCreate}
        title="Create Invoice & Link Patient"
        onClose={() => setShowCreate(false)}
        width={640}
      >
        <form
          onSubmit={handleCreateInvoice}
          style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}
        >
          <FormField label="Patient" required>
            {selectedPatient ? (
              <div style={{ display: "flex", gap: theme.spacing["2"], alignItems: "center" }}>
                <span
                  style={{
                    fontSize: theme.fontSize.base,
                    fontWeight: theme.fontWeight.semibold,
                    color: theme.text.primary,
                  }}
                >
                  {selectedPatient.firstName} {selectedPatient.lastName} ({selectedPatient.patientNo})
                </span>
                <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedPatient(null)}>
                  x
                </Button>
              </div>
            ) : (
              <div style={{ position: "relative" }}>
                <Input
                  type="text"
                  placeholder="Search patient by name or number..."
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
                      maxHeight: 200,
                      overflowY: "auto",
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
                        <strong style={{ color: theme.action.info }}>{p.patientNo}</strong> &mdash;{" "}
                        {p.firstName} {p.lastName}
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
            <FormField label="Discount (NGN)">
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
                <Input
                  value={payerName}
                  onChange={(e) => setPayerName(e.target.value)}
                  placeholder="e.g. Hygeia HMO"
                />
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
        title="Process Payment"
        onClose={() => setShowPay(false)}
        width={420}
      >
        <form
          onSubmit={handleReceivePayment}
          style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}
        >
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
              No open cashier shift &mdash; open one before receiving payments.
            </p>
          )}
          {selectedInvoice && (
            <div
              style={{
                background: theme.surface.subtle,
                padding: theme.spacing["3"],
                borderRadius: theme.radius.md,
                fontSize: theme.fontSize.base,
              }}
            >
              <div>
                <strong>Invoice:</strong> {selectedInvoice.invoiceNo}
              </div>
              <div>
                <strong>Patient:</strong> {selectedInvoice.patientName || "Walk-in"}
              </div>
              <div>
                <strong>Balance Due:</strong>{" "}
                <span style={{ fontWeight: theme.fontWeight.bold, color: theme.action.danger }}>
                  {currency(selectedInvoice.balanceDue)}
                </span>
              </div>
            </div>
          )}
          <FormField label="Amount (NGN)" required>
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
                  {methodLabel(m)}
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
          <FormField label="Payer's full name">
            <Input
              value={payPayerName}
              onChange={(e) => setPayPayerName(e.target.value)}
              placeholder="Defaults to the patient"
            />
          </FormField>
          <div style={{ display: "flex", gap: theme.spacing["2"] }}>
            <Button type="button" variant="ghost" style={{ flex: 1 }} onClick={() => setShowPay(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={paying} style={{ flex: 1 }}>
              Confirm Payment
            </Button>
          </div>
        </form>
      </Modal>

      {/* Receipt modal */}
      <Modal
        open={!!activeReceipt}
        title="Payment Receipt"
        onClose={() => setActiveReceipt(null)}
        width={450}
      >
        {activeReceipt && (
          <>
            <div
              style={{
                textAlign: "center",
                borderBottom: `2px dashed ${theme.surface.borderStrong}`,
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
              <div
                style={{
                  fontSize: theme.fontSize.base,
                  fontWeight: theme.fontWeight.bold,
                  color: theme.action.info,
                  marginTop: "0.4rem",
                }}
              >
                Receipt #: {activeReceipt.receiptNo}
              </div>
            </div>
            <div style={{ fontSize: theme.fontSize.base, marginBottom: theme.spacing["4"], display: "grid", gap: "0.3rem" }}>
              <div><strong>Patient:</strong> {activeReceipt.patientName || "\u2014"}</div>
              {activeReceipt.patientNo && <div><strong>Patient ID:</strong> {activeReceipt.patientNo}</div>}
              <div><strong>Invoice:</strong> {activeReceipt.invoiceNo}</div>
              <div><strong>Method:</strong> {methodLabel(activeReceipt.method)}</div>
              <div>
                <strong>Amount:</strong>{" "}
                <span style={{ fontWeight: theme.fontWeight.bold, color: theme.action.success }}>
                  {currency(activeReceipt.amount)}
                </span>
              </div>
              <div><strong>Date:</strong> {new Date(activeReceipt.issuedAt).toLocaleString()}</div>
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
                Print
              </Button>
              <Button
                variant="outline"
                style={{ flex: 1 }}
                onClick={() => {
                  setShareReceipt(activeReceipt);
                  setActiveReceipt(null);
                  setShowShare(true);
                }}
              >
                Share
              </Button>
              <Button variant="ghost" style={{ flex: 1 }} onClick={() => setActiveReceipt(null)}>
                Close
              </Button>
            </div>
          </>
        )}
      </Modal>

      {/* Share receipt modal */}
      <Modal
        open={showShare}
        title="Share Receipt"
        onClose={() => setShowShare(false)}
        width={420}
      >
        {shareReceipt && (
          <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
            <div
              style={{
                background: theme.surface.subtle,
                padding: theme.spacing["3"],
                borderRadius: theme.radius.md,
                fontSize: theme.fontSize.base,
              }}
            >
              <div>
                <strong>Patient:</strong> {shareReceipt.patientName || "\u2014"}
              </div>
              {shareReceipt.patientNo && (
                <div>
                  <strong>ID:</strong> {shareReceipt.patientNo}
                </div>
              )}
              <div>
                <strong>Invoice:</strong> {shareReceipt.invoiceNo}
              </div>
              <div>
                <strong>Amount:</strong> {currency(shareReceipt.amount)}
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: theme.spacing["3"],
              }}
            >
              <Button
                onClick={() => {
                  const text = `DIVINE HANDS HOSPITAL\nPayment Receipt\n\nInvoice: ${shareReceipt.invoiceNo}\nPatient: ${shareReceipt.patientName}\nAmount: ${currency(shareReceipt.amount)}\nDate: ${new Date().toLocaleString()}`;
                  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
                  toast.success("WhatsApp opened.");
                }}
              >
                WhatsApp
              </Button>
              <Button
                onClick={() => {
                  const subject = `Payment Receipt - ${shareReceipt.invoiceNo}`;
                  const body = `DIVINE HANDS HOSPITAL - Payment Receipt\n\nInvoice: ${shareReceipt.invoiceNo}\nPatient: ${shareReceipt.patientName}\nAmount: ${currency(shareReceipt.amount)}\nDate: ${new Date().toLocaleString()}`;
                  window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                  toast.success("Email client opened.");
                }}
              >
                Email
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  const url = `${getBaseUrl()}/api/v1/billing/receipts/${shareReceipt.id}/html`;
                  navigator.clipboard.writeText(url).then(() => {
                    toast.success("Receipt link copied to clipboard.");
                  });
                }}
              >
                Copy Link
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  window.open(
                    `${getBaseUrl()}/api/v1/billing/receipts/${shareReceipt.id}/pdf`,
                    "_blank",
                  )
                }
              >
                Download PDF
              </Button>
            </div>

            <Button
              onClick={() =>
                window.open(
                  `${getBaseUrl()}/api/v1/billing/receipts/${shareReceipt.id}/html`,
                  "_blank",
                )
              }
            >
              Print Receipt
            </Button>

            <Button variant="ghost" onClick={() => setShowShare(false)}>
              Close
            </Button>
          </div>
        )}
      </Modal>

      {/* Edit invoice modal (super admin) */}
      <Modal
        open={showEdit}
        title="Edit Invoice (Super Admin)"
        onClose={() => setShowEdit(false)}
        width={480}
      >
        {selectedInvoice && (
          <form
            onSubmit={handleUpdateInvoice}
            style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}
          >
            <div
              style={{
                background: theme.surface.subtle,
                padding: theme.spacing["3"],
                borderRadius: theme.radius.md,
                fontSize: theme.fontSize.base,
              }}
            >
              <div>
                <strong>Invoice:</strong> {selectedInvoice.invoiceNo}
              </div>
              <div>
                <strong>Patient:</strong> {selectedInvoice.patientName || "Walk-in"}
              </div>
              <div>
                <strong>Current Total:</strong> {currency(selectedInvoice.totalAmount)}
              </div>
            </div>

            <FormField label="Discount Amount (NGN)">
              <Input
                type="number"
                min={0}
                value={editDiscount}
                onChange={(e) => setEditDiscount(e.target.value)}
              />
            </FormField>

            <FormField label="Payment Plan">
              <Select value={editPlan} onChange={(e) => setEditPlan(e.target.value)}>
                <option value="full">Full Payment</option>
                <option value="installment">Installment</option>
              </Select>
            </FormField>

            {editPlan === "installment" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}>
                <FormField label="Installment Amount (NGN)">
                  <Input
                    type="number"
                    min={0}
                    value={editInstallmentAmt}
                    onChange={(e) => setEditInstallmentAmt(e.target.value)}
                  />
                </FormField>
                <FormField label="Frequency">
                  <Select
                    value={editInstallmentFreq}
                    onChange={(e) => setEditInstallmentFreq(e.target.value)}
                  >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Bi-Weekly</option>
                    <option value="monthly">Monthly</option>
                  </Select>
                </FormField>
              </div>
            )}

            <FormField label="Reason for Update (required)">
              <Input
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="e.g. Billing correction, additional charges..."
                required
              />
            </FormField>

            <div style={{ display: "flex", gap: theme.spacing["2"] }}>
              <Button type="button" variant="ghost" style={{ flex: 1 }} onClick={() => setShowEdit(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving} style={{ flex: 1 }}>
                Save Changes
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
