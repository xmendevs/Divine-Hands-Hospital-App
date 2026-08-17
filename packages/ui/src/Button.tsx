import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { theme } from "./theme";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

const variantStyle: Record<ButtonVariant, CSSProperties> = {
  primary: { background: theme.action.primary, color: "#ffffff", border: "none" },
  secondary: { background: theme.action.secondary, color: "#ffffff", border: "none" },
  outline: { background: "#ffffff", color: theme.text.primary, border: `1px solid ${theme.surface.borderStrong}` },
  ghost: { background: "transparent", color: theme.text.secondary, border: "none" },
  danger: { background: theme.action.danger, color: "#ffffff", border: "none" },
};

const sizeStyle: Record<ButtonSize, CSSProperties> = {
  sm: { padding: "0.3rem 0.75rem", fontSize: theme.fontSize.sm },
  md: { padding: "0.5rem 1rem", fontSize: theme.fontSize.base },
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  children,
  style,
  disabled,
  ...props
}: ButtonProps) {
  const inactive = disabled || loading;
  return (
    <button
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: theme.spacing["2"],
        borderRadius: theme.radius.md,
        fontWeight: theme.fontWeight.semibold,
        cursor: inactive ? "not-allowed" : "pointer",
        opacity: inactive ? 0.55 : 1,
        transition: "background-color 150ms ease, opacity 150ms ease, border-color 150ms ease",
        ...variantStyle[variant],
        ...sizeStyle[size],
        ...style,
      }}
      disabled={inactive}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner size={size === "sm" ? 12 : 14} color="currentColor" /> : null}
      {icon && !loading ? <span style={{ display: "inline-flex" }}>{icon}</span> : null}
      {children}
    </button>
  );
}
