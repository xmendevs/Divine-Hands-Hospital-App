import type { CSSProperties, ReactNode } from "react";
import { theme } from "./theme";

const pill: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "4px",
  padding: "3px 10px",
  borderRadius: theme.radius.full,
  fontSize: theme.fontSize.sm,
  fontWeight: theme.fontWeight.semibold,
  lineHeight: 1.4,
  whiteSpace: "nowrap",
  userSelect: "none",
  border: "1px solid transparent",
};

export type ShiftVariant = "Day" | "Night" | "Aft" | "Off";

type BadgePalette = { bg: string; text: string; border: string };

const shiftMeta: Record<ShiftVariant, { icon: string; palette: BadgePalette }> = {
  Day: { icon: "☀️", palette: theme.badge.day },
  Night: { icon: "🌙", palette: theme.badge.night },
  Aft: { icon: "🌅", palette: theme.badge.aft },
  Off: { icon: "🌴", palette: theme.badge.off },
};

export function ShiftBadge({ variant, label }: { variant: ShiftVariant; label?: ReactNode }) {
  const meta = shiftMeta[variant];
  return (
    <span
      style={{
        ...pill,
        background: meta.palette.bg,
        color: meta.palette.text,
        borderColor: meta.palette.border,
      }}
    >
      <span aria-hidden>{meta.icon}</span>
      <span>{label ?? variant}</span>
    </span>
  );
}

export type StatusVariant = "draft" | "submitted" | "approved" | "active" | "inactive" | "running" | "error";

const statusPalette: Record<StatusVariant, BadgePalette> = {
  draft: theme.badge.draft,
  submitted: theme.badge.submitted,
  approved: theme.badge.approved,
  active: theme.badge.active,
  inactive: theme.badge.inactive,
  running: theme.badge.running,
  error: theme.badge.error,
};

export function StatusBadge({ variant, label }: { variant: StatusVariant; label?: ReactNode }) {
  const p = statusPalette[variant];
  return (
    <span
      style={{
        ...pill,
        background: p.bg,
        color: p.text,
        borderColor: p.border,
      }}
    >
      {label ?? variant}
    </span>
  );
}
