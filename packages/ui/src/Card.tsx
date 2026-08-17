import type { CSSProperties, ReactNode } from "react";
import { theme } from "./theme";

export interface CardProps {
  title?: ReactNode;
  hint?: ReactNode;
  toolbar?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
  bodyStyle?: CSSProperties;
}

/** White card with a fine border, optional header (title + hint left, toolbar right). */
export function Card({ title, hint, toolbar, children, style, bodyStyle }: CardProps) {
  return (
    <div
      style={{
        background: theme.surface.card,
        border: `1px solid ${theme.surface.border}`,
        borderRadius: theme.radius.lg,
        boxShadow: theme.shadow.card,
        ...style,
      }}
    >
      {title || toolbar ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: theme.spacing["4"],
            padding: `${theme.spacing["3"]} ${theme.spacing["5"]}`,
            borderBottom: `1px solid ${theme.surface.border}`,
          }}
        >
          <div>
            {title ? (
              <h3 style={{ margin: 0, fontSize: theme.fontSize.lg, fontWeight: theme.fontWeight.semibold, color: theme.text.primary }}>
                {title}
              </h3>
            ) : null}
            {hint ? (
              <p style={{ margin: `${theme.spacing["1"]} 0 0`, fontSize: theme.fontSize.sm, color: theme.text.muted }}>{hint}</p>
            ) : null}
          </div>
          {toolbar ? <div style={{ display: "flex", alignItems: "center", gap: theme.spacing["2"] }}>{toolbar}</div> : null}
        </div>
      ) : null}
      <div style={{ padding: theme.spacing["5"], ...bodyStyle }}>{children}</div>
    </div>
  );
}
