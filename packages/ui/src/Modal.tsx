import { useEffect, type CSSProperties, type ReactNode } from "react";
import { theme } from "./theme";
import { Icon } from "./Icon";

export interface ModalProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number | string;
  style?: CSSProperties;
}

export function Modal({ open, title, onClose, children, footer, width = 480, style }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : undefined}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: theme.surface.card,
          borderRadius: theme.radius.lg,
          width,
          maxWidth: "92vw",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: theme.shadow.popover,
          ...style,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: theme.spacing["4"],
            padding: `${theme.spacing["4"]} ${theme.spacing["5"]}`,
            borderBottom: `1px solid ${theme.surface.border}`,
          }}
        >
          <h3 style={{ margin: 0, fontSize: theme.fontSize.lg, fontWeight: theme.fontWeight.semibold, color: theme.text.primary }}>
            {title}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              borderRadius: theme.radius.md,
              border: "none",
              background: "transparent",
              color: theme.text.muted,
              cursor: "pointer",
            }}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div style={{ padding: theme.spacing["5"], overflowY: "auto" }}>{children}</div>
        {footer ? (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: theme.spacing["2"],
              padding: `${theme.spacing["3"]} ${theme.spacing["5"]}`,
              borderTop: `1px solid ${theme.surface.border}`,
            }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
