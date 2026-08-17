/**
 * Clinical Matrix design tokens — single source of truth for the Divine Hands
 * Hospital desktop app. See docs/ui-design-reference/clinical_matrix/DESIGN.md.
 */

export const theme = {
  sidebar: {
    bg: "#0f172a",
    bgDeep: "#0b132b",
    category: "#64748b",
    text: "#94a3b8",
    activeBg: "#1e293b",
    activeText: "#38bdf8",
    activeTextAlt: "#ffffff",
    hoverBg: "rgba(255, 255, 255, 0.04)",
    border: "#1e293b",
  },
  surface: {
    canvas: "#f8fafc",
    card: "#ffffff",
    subtle: "#f1f5f9",
    border: "#e2e8f0",
    borderStrong: "#cbd5e1",
    focus: "#2563eb",
  },
  text: {
    primary: "#0f172a",
    secondary: "#475569",
    muted: "#64748b",
    inverse: "#ffffff",
    danger: "#b91c1c",
  },
  action: {
    primary: "#2563eb",
    primaryHover: "#1d4ed8",
    secondary: "#334155",
    danger: "#dc2626",
    success: "#16a34a",
    warning: "#b45309",
    info: "#0369a1",
  },
  badge: {
    draft: { bg: "#f1f5f9", text: "#475569", border: "#e2e8f0" },
    day: { bg: "#fef3c7", text: "#b45309", border: "#fde68a" },
    aft: { bg: "#e0f2fe", text: "#0369a1", border: "#bae6fd" },
    night: { bg: "#e0e7ff", text: "#4338ca", border: "#c7d2fe" },
    off: { bg: "#f8fafc", text: "#64748b", border: "#e2e8f0" },
    submitted: { bg: "#e0f2fe", text: "#0369a1", border: "#bae6fd" },
    approved: { bg: "#dcfce7", text: "#15803d", border: "#bbf7d0" },
    active: { bg: "#dbeafe", text: "#1d4ed8", border: "#bfdbfe" },
    inactive: { bg: "#f1f5f9", text: "#64748b", border: "#e2e8f0" },
    running: { bg: "#fef3c7", text: "#b45309", border: "#fde68a" },
    error: { bg: "#fee2e2", text: "#b91c1c", border: "#fecaca" },
  },
  fontSize: {
    xs: "0.65rem",
    sm: "0.75rem",
    base: "0.85rem",
    lg: "1rem",
    xl: "1.25rem",
    "2xl": "1.5rem",
  },
  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  radius: {
    sm: "4px",
    md: "6px",
    lg: "10px",
    full: "9999px",
  },
  shadow: {
    card: "0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)",
    popover: "0 10px 25px -5px rgba(15, 23, 42, 0.1)",
  },
  spacing: {
    "1": "0.25rem",
    "2": "0.5rem",
    "3": "0.75rem",
    "4": "1rem",
    "5": "1.25rem",
    "6": "1.5rem",
    "8": "2rem",
  },
} as const;

export type Theme = typeof theme;
