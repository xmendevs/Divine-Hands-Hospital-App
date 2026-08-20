import { useEffect, useState, type FormEvent } from "react";
import {
  theme,
  Button,
  FormField,
  Input,
  Modal,
  Select,
  StatusBadge,
  useToast,
  type StatusVariant,
} from "@hims/ui";
import { apiFetch } from "../api/client";

/* ─── Types ─── */

interface PatientSummary {
  id: string;
  patientNo: string;
  firstName: string;
  lastName: string;
}

interface PatientBalance {
  totalCharged: number;
  totalPaid: number;
  balanceDue: number;
  invoiceCount: number;
  invoices: {
    id: string;
    invoiceNo: string;
    totalAmount: number;
    amountPaid: number;
    balanceDue: number;
    status: string;
    createdAt: string;
  }[];
}

interface PriceList {
  id: string;
  name: string;
  currency: string;
}

interface PriceListItem {
  id: string;
  code: string;
  name: string;
  category: string;
  price: number;
}

/* ─── Helpers ─── */

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

/* ─── Component ─── */

interface ChargePatientModalProps {
  open: boolean;
  onClose: () => void;
  onCharged?: () => void;
  /** Pre-select a patient (e.g., from patient detail page) */
  preselectedPatient?: PatientSummary | null;
}

export default function ChargePatientModal({
  open,
  onClose,
  onCharged,
  preselectedPatient,
}: ChargePatientModalProps) {
  const toast = useToast();

  /* ── Patient search ── */
  const [patientSearch, setPatientSearch] = useState("");
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientSummary | null>(
    preselectedPatient ?? null,
  );

  /* ── Balance ── */
  const [balance, setBalance] = useState<PatientBalance | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);

  /* ── Invoice creation ── */
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [selectedPriceList, setSelectedPriceList] = useState("");
  const [priceListItems, setPriceListItems] = useState<PriceListItem[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [billTo, setBillTo] = useState("patient");
  const [payerName, setPayerName] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  /* ── Mode: charge vs balance ── */
  const [mode, setMode] = useState<"charge" | "balance">("charge");

  /* Pre-select patient */
  useEffect(() => {
    if (preselectedPatient) {
      setSelectedPatient(preselectedPatient);
    }
  }, [preselectedPatient]);

  /* Load price lists */
  useEffect(() => {
    if (!open) return;
    apiFetch<PriceList[]>("/billing/price-lists")
      .then((lists) => {
        setPriceLists(lists);
        if (lists.length > 0 && !selectedPriceList) {
          setSelectedPriceList(lists[0].id);
        }
      })
      .catch(() => {});
  }, [open, selectedPriceList]);

  /* Load price list items */
  useEffect(() => {
    if (!selectedPriceList) {
      setPriceListItems([]);
      return;
    }
    apiFetch<PriceListItem[]>(`/billing/price-lists/${selectedPriceList}/items`)
      .then((items) => setPriceListItems(items))
      .catch(() => {});
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

  /* Load balance when patient selected and in balance mode */
  useEffect(() => {
    if (!selectedPatient || !open || mode !== "balance") {
      setBalance(null);
      return;
    }
    setLoadingBalance(true);
    apiFetch<PatientBalance>(`/billing/patients/${selectedPatient.id}/balance`)
      .then((b) => setBalance(b))
      .catch(() => setBalance(null))
      .finally(() => setLoadingBalance(false));
  }, [selectedPatient, open, mode]);

  /* Reset on close */
  useEffect(() => {
    if (!open) {
      setSelectedPatient(preselectedPatient ?? null);
      setPatientSearch("");
      setPatients([]);
      setBalance(null);
      setSelectedItemIds([]);
      setQuantities({});
      setPayerName("");
      setDiscountAmount("");
      setError("");
      setMode("charge");
    }
  }, [open, preselectedPatient]);

  /* Create invoice */
  async function handleCreateInvoice(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!selectedPatient) {
      setError("Select a patient.");
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
      await apiFetch<unknown>("/billing/invoices", {
        method: "POST",
        body: JSON.stringify({
          patientId: selectedPatient.id,
          priceListId: selectedPriceList,
          billTo,
          payerName,
          discountAmount: Number(discountAmount) || 0,
          items,
        }),
      });
      toast.success(`Invoice created for ${selectedPatient.firstName} ${selectedPatient.lastName}.`);
      onCharged?.();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not create invoice.";
      setError(msg);
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Charge Patient"
      onClose={onClose}
      width={560}
    >
      {/* Patient selector */}
      <div style={{ marginBottom: theme.spacing["4"] }}>
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
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSelectedPatient(null);
                  setBalance(null);
                }}
              >
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
      </div>

      {/* Mode tabs */}
      {selectedPatient && (
        <div
          style={{
            display: "flex",
            gap: theme.spacing["2"],
            marginBottom: theme.spacing["4"],
            borderBottom: `1px solid ${theme.surface.border}`,
            paddingBottom: theme.spacing["3"],
          }}
        >
          <Button
            size="sm"
            variant={mode === "charge" ? undefined : "ghost"}
            onClick={() => setMode("charge")}
          >
            Create Charge
          </Button>
          <Button
            size="sm"
            variant={mode === "balance" ? undefined : "ghost"}
            onClick={() => setMode("balance")}
          >
            Check Balance
          </Button>
        </div>
      )}

      {error && (
        <p style={{ margin: `0 0 ${theme.spacing["3"]} 0`, fontSize: theme.fontSize.base, color: theme.text.danger }}>
          {error}
        </p>
      )}

      {/* ── Charge Mode ── */}
      {selectedPatient && mode === "charge" && (
        <form
          onSubmit={handleCreateInvoice}
          style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: theme.spacing["3"] }}>
            <FormField label="Price List">
              <Select value={selectedPriceList} onChange={(e) => setSelectedPriceList(e.target.value)}>
                {priceLists.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pl.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Bill To">
              <Select value={billTo} onChange={(e) => setBillTo(e.target.value)}>
                <option value="patient">Patient</option>
                <option value="insurance">Insurance</option>
                <option value="corporate">Corporate</option>
              </Select>
            </FormField>
          </div>

          {billTo !== "patient" && (
            <FormField label="Payer Name">
              <Input
                value={payerName}
                onChange={(e) => setPayerName(e.target.value)}
                placeholder="e.g. Hygeia HMO"
              />
            </FormField>
          )}

          <FormField label="Discount (NGN)">
            <Input
              type="number"
              min={0}
              value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
            />
          </FormField>

          {/* Line items */}
          <div>
            <span style={{ fontSize: theme.fontSize.base, fontWeight: theme.fontWeight.semibold, color: theme.text.secondary }}>
              Line Items
            </span>
            <div
              style={{
                maxHeight: 200,
                overflowY: "auto",
                border: `1px solid ${theme.surface.border}`,
                borderRadius: theme.radius.md,
                marginTop: theme.spacing["1"],
              }}
            >
              {priceListItems.length === 0 && (
                <p style={{ padding: theme.spacing["3"], color: theme.text.muted, fontSize: theme.fontSize.base, margin: 0 }}>
                  No items available.
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
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={creating}>
              Create Invoice
            </Button>
          </div>
        </form>
      )}

      {/* ── Balance Mode ── */}
      {selectedPatient && mode === "balance" && (
        <div>
          {loadingBalance && (
            <p style={{ color: theme.text.muted, fontSize: theme.fontSize.base }}>Loading balance...</p>
          )}
          {!loadingBalance && balance && (
            <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["3"] }}>
              {/* Summary cards */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: theme.spacing["3"] }}>
                {[
                  { label: "Total Charged", value: currency(balance.totalCharged), color: theme.text.primary },
                  { label: "Total Paid", value: currency(balance.totalPaid), color: theme.action.success },
                  { label: "Balance Due", value: currency(balance.balanceDue), color: balance.balanceDue > 0 ? theme.action.danger : theme.action.success },
                ].map((card) => (
                  <div
                    key={card.label}
                    style={{
                      background: theme.surface.subtle,
                      padding: theme.spacing["3"],
                      borderRadius: theme.radius.md,
                      border: `1px solid ${theme.surface.border}`,
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginBottom: "0.2rem" }}>
                      {card.label}
                    </div>
                    <div style={{ fontSize: "1.1rem", fontWeight: theme.fontWeight.bold, color: card.color }}>
                      {card.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* Invoice list */}
              {balance.invoices.length > 0 && (
                <div>
                  <span style={{ fontSize: theme.fontSize.base, fontWeight: theme.fontWeight.semibold }}>
                    Invoices ({balance.invoiceCount})
                  </span>
                  <div style={{ maxHeight: 250, overflowY: "auto", marginTop: theme.spacing["1"] }}>
                    {balance.invoices.map((inv) => (
                      <div
                        key={inv.id}
                        style={{
                          padding: theme.spacing["3"],
                          borderBottom: `1px solid ${theme.surface.border}`,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          fontSize: theme.fontSize.base,
                        }}
                      >
                        <div>
                          <strong style={{ color: theme.action.info }}>{inv.invoiceNo}</strong>
                          <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                            {new Date(inv.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div>Total: {currency(inv.totalAmount)}</div>
                          <div style={{ color: theme.action.success }}>Paid: {currency(inv.amountPaid)}</div>
                          <div
                            style={{
                              fontWeight: theme.fontWeight.bold,
                              color: inv.balanceDue > 0 ? theme.action.danger : theme.action.success,
                            }}
                          >
                            Balance: {currency(inv.balanceDue)}
                          </div>
                        </div>
                        <StatusBadge variant={invoiceStatusBadge(inv.status)} label={inv.status.replace("_", " ")} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {balance.invoices.length === 0 && (
                <p style={{ color: theme.text.muted, fontSize: theme.fontSize.base, textAlign: "center", padding: theme.spacing["4"] }}>
                  No invoices found for this patient.
                </p>
              )}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: theme.spacing["4"] }}>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
