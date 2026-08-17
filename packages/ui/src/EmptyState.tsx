import type { ReactNode } from "react";
import { theme } from "./theme";
import { Icon, type IconName } from "./Icon";

export interface EmptyStateProps {
  icon?: IconName;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon = "search", title, description, action }: EmptyStateProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: theme.spacing["2"],
        padding: theme.spacing["8"],
        textAlign: "center",
        color: theme.text.muted,
      }}
    >
      <Icon name={icon} size={32} color={theme.text.muted} />
      {title ? (
        <p style={{ margin: 0, fontSize: theme.fontSize.lg, fontWeight: theme.fontWeight.semibold, color: theme.text.secondary }}>
          {title}
        </p>
      ) : null}
      {description ? <p style={{ margin: 0, fontSize: theme.fontSize.base }}>{description}</p> : null}
      {action}
    </div>
  );
}
