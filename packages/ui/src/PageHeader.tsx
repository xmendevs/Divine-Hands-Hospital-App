import type { CSSProperties, ReactNode } from "react";
import { theme } from "./theme";

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  style?: CSSProperties;
}

/** Standardized page header: title + subtitle on the left, badge + actions on the right. */
export function PageHeader({ title, description, badge, actions, style }: PageHeaderProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: theme.spacing["4"],
        flexWrap: "wrap",
        marginBottom: theme.spacing["5"],
        ...style,
      }}
    >
      <div>
        <h1
          style={{
            margin: 0,
            fontSize: theme.fontSize.xl,
            fontWeight: theme.fontWeight.bold,
            color: theme.text.primary,
            letterSpacing: "-0.02em",
          }}
        >
          {title}
        </h1>
        {description ? (
          <p style={{ margin: `${theme.spacing["1"]} 0 0`, fontSize: theme.fontSize.base, color: theme.text.muted }}>
            {description}
          </p>
        ) : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: theme.spacing["2"], flexWrap: "wrap" }}>
        {badge}
        {actions}
      </div>
    </div>
  );
}
