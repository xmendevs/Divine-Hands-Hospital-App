import { useState } from "react";
import { theme, Button, Modal } from "@hims/ui";
import { apiFetch } from "../api/client";

interface PriceListItem {
  id: string;
  code: string;
  name: string;
  category: string;
  price: number;
  taxRate: number;
}

interface ChargeLine {
  itemId: string;
  name: string;
  price: number;
  quantity: number;
  taxRate: number;
}

interface ChargeConfirmationModalProps {
  open: boolean;
  onClose: () => void;
  onConfirmed: () => void;
  orderId: string;
  orderType: string;
  orderDetails: Record<string, unknown>;
  patientName: string;
  patientNo: string;
}

export default function ChargeConfirmationModal({
  open,
  onClose,
  onConfirmed,
  orderId,
  orderType,
  orderDetails,
  patientName,
  patientNo,
}: ChargeConfirmationModalProps) {
  const [lines, setLines] = useState<ChargeLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Load price list items when modal opens
  const loadPriceList = async () => {
    if (!open) return;
    setLoading(true);
    setError("");
    try {
      const lists = await apiFetch<{ id: string; status: string }[]>(
        "/billing/price-lists"
      );
      const activeList = lists.find((l) => l.status === "active");
      if (!activeList) {
        setError("No active price list found");
        setLoading(false);
        return;
      }
      const items = await apiFetch<PriceListItem[]>(
        `/billing/price-lists/${activeList.id}/items`
      );

      // Find matching items based on order type
      let searchKey = "";
      switch (orderType) {
        case "prescription":
          searchKey = String(orderDetails.medication ?? "");
          break;
        case "lab_request":
        case "lab_investigation":
          searchKey = String(orderDetails.test ?? "");
          break;
        case "radiology_imaging":
          searchKey = String(orderDetails.modality ?? "");
          break;
        default:
          searchKey = "";
      }

      // Filter items by search key
      const matched = searchKey
        ? items.filter(
            (i) =>
              i.name.toLowerCase().includes(searchKey.toLowerCase()) ||
              i.code.toLowerCase().includes(searchKey.toLowerCase())
          )
        : items.slice(0, 3); // Show first 3 if no search key

      if (matched.length === 0) {
        setError(
          `No matching items found for "${searchKey}". You can add items manually from the price list.`
        );
      }

      setLines(
        matched.map((i) => ({
          itemId: i.id,
          name: i.name,
          price: i.price,
          quantity: 1,
          taxRate: i.taxRate,
        }))
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load price list"
      );
    } finally {
      setLoading(false);
    }
  };

  // Load price list when modal opens
  if (open && lines.length === 0 && !loading && !error) {
    void loadPriceList();
  }

  const subtotal = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const taxTotal = lines.reduce(
    (sum, l) => sum + (l.price * l.quantity * l.taxRate) / 100,
    0
  );
  const total = subtotal + taxTotal;

  const handleConfirm = async () => {
    setSaving(true);
    setError("");
    try {
      await apiFetch(`/billing/auto-invoice/order/${orderId}`, {
        method: "POST",
      });
      onConfirmed();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not create invoice"
      );
    } finally {
      setSaving(false);
    }
  };

  const updateQuantity = (idx: number, qty: number) => {
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, quantity: Math.max(1, qty) } : l))
    );
  };

  const removeLine = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <Modal
      open={open}
      title="Confirm Charge"
      onClose={onClose}
      width={600}
      footer={
        <div style={{ display: "flex", gap: theme.spacing["2"] }}>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleConfirm()}
            disabled={saving || lines.length === 0}
          >
            {saving ? "Creating Invoice..." : `Confirm & Create Invoice (₦${total.toLocaleString()})`}
          </Button>
        </div>
      }
    >
      <div style={{ marginBottom: theme.spacing["3"] }}>
        <div
          style={{
            padding: theme.spacing["3"],
            background: theme.surface.card,
            borderRadius: theme.radius.md,
            border: `1px solid ${theme.surface.border}`,
          }}
        >
          <div
            style={{
              fontSize: theme.fontSize.sm,
              color: theme.text.muted,
              marginBottom: theme.spacing["1"],
            }}
          >
            Patient
          </div>
          <div style={{ fontWeight: theme.fontWeight.semibold }}>
            {patientName} ({patientNo})
          </div>
          <div
            style={{
              fontSize: theme.fontSize.sm,
              color: theme.text.muted,
              marginTop: theme.spacing["2"],
            }}
          >
            Order Type
          </div>
          <div style={{ fontWeight: theme.fontWeight.semibold, textTransform: "capitalize" }}>
            {orderType.replace(/_/g, " ")}
          </div>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: theme.spacing["2"],
            background: "rgba(248, 113, 113, 0.1)",
            border: "1px solid rgba(248, 113, 113, 0.3)",
            borderRadius: theme.radius.md,
            color: "#f87171",
            fontSize: theme.fontSize.sm,
            marginBottom: theme.spacing["3"],
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: theme.spacing["4"], textAlign: "center", color: theme.text.muted }}>
          Loading price list...
        </div>
      ) : lines.length === 0 ? (
        <div style={{ padding: theme.spacing["4"], textAlign: "center", color: theme.text.muted }}>
          No matching items found. Create the order first, then charge from the billing page.
        </div>
      ) : (
        <>
          <div
            style={{
              fontSize: theme.fontSize.sm,
              fontWeight: theme.fontWeight.semibold,
              color: theme.text.secondary,
              marginBottom: theme.spacing["2"],
            }}
          >
            Line Items
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["2"] }}>
            {lines.map((line, idx) => (
              <div
                key={idx}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: theme.spacing["2"],
                  padding: theme.spacing["2"],
                  background: theme.surface.card,
                  borderRadius: theme.radius.md,
                  border: `1px solid ${theme.surface.border}`,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: theme.fontWeight.medium }}>{line.name}</div>
                  <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted }}>
                    ₦{line.price.toLocaleString()} each
                    {line.taxRate > 0 ? ` (${line.taxRate}% tax)` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: theme.spacing["1"] }}>
                  <button
                    onClick={() => updateQuantity(idx, line.quantity - 1)}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 4,
                      border: `1px solid ${theme.surface.border}`,
                      background: theme.surface.card,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    -
                  </button>
                  <span style={{ minWidth: 24, textAlign: "center" }}>{line.quantity}</span>
                  <button
                    onClick={() => updateQuantity(idx, line.quantity + 1)}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 4,
                      border: `1px solid ${theme.surface.border}`,
                      background: theme.surface.card,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    +
                  </button>
                </div>
                <div style={{ fontWeight: theme.fontWeight.semibold, minWidth: 80, textAlign: "right" }}>
                  ₦{(line.price * line.quantity).toLocaleString()}
                </div>
                <button
                  onClick={() => removeLine(idx)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#f87171",
                    cursor: "pointer",
                    fontSize: theme.fontSize.xs,
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: theme.spacing["3"],
              padding: theme.spacing["3"],
              background: theme.surface.card,
              borderRadius: theme.radius.md,
              border: `1px solid ${theme.surface.border}`,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: theme.spacing["1"] }}>
              <span style={{ color: theme.text.muted }}>Subtotal</span>
              <span>₦{subtotal.toLocaleString()}</span>
            </div>
            {taxTotal > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: theme.spacing["1"] }}>
                <span style={{ color: theme.text.muted }}>Tax</span>
                <span>₦{taxTotal.toLocaleString()}</span>
              </div>
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontWeight: theme.fontWeight.bold,
                fontSize: theme.fontSize.lg,
                borderTop: `1px solid ${theme.surface.border}`,
                paddingTop: theme.spacing["2"],
                marginTop: theme.spacing["2"],
              }}
            >
              <span>Total</span>
              <span style={{ color: theme.action.primary }}>₦{total.toLocaleString()}</span>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
