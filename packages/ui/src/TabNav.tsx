import type { CSSProperties, ReactNode } from "react";
import { theme } from "./theme";

export interface TabItem {
  key: string;
  label: ReactNode;
}

export interface TabNavProps {
  tabs: TabItem[];
  active: string;
  onChange: (key: string) => void;
  style?: CSSProperties;
}

/** Underline sub-navigation tabs with a 2px primary-blue active indicator. */
export function TabNav({ tabs, active, onChange, style }: TabNavProps) {
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        gap: theme.spacing["5"],
        borderBottom: `1px solid ${theme.surface.border}`,
        ...style,
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            style={{
              background: "none",
              border: "none",
              padding: `${theme.spacing["2"]} ${theme.spacing["1"]}`,
              marginBottom: "-1px",
              cursor: "pointer",
              borderBottom: isActive ? `2px solid ${theme.action.primary}` : "2px solid transparent",
              color: isActive ? theme.action.primary : theme.text.muted,
              fontWeight: isActive ? theme.fontWeight.semibold : theme.fontWeight.medium,
              fontSize: theme.fontSize.base,
              transition: "color 150ms ease, border-color 150ms ease",
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
