import { theme, Icon, type IconName } from "@hims/ui";
import type { CSSProperties } from "react";

export interface NavItem {
  key: string;
  label: string;
  icon: IconName;
  onSelect?: () => void;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export interface SidebarProps {
  groups: NavGroup[];
  active: string;
  onSelect: (key: string) => void;
  onLogout: () => void;
  username: string;
}

const navBtnBase: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: theme.spacing["2"],
  width: "100%",
  textAlign: "left",
  background: "transparent",
  color: theme.sidebar.text,
  border: "none",
  padding: "0.5rem 0.75rem",
  borderRadius: theme.radius.md,
  fontSize: theme.fontSize.base,
  fontWeight: theme.fontWeight.medium,
  cursor: "pointer",
  transition: "background-color 150ms ease, color 150ms ease",
};

export function Sidebar({ groups, active, onSelect, onLogout, username }: SidebarProps) {
  return (
    <aside
      role="navigation"
      aria-label="Main navigation"
      style={{
        width: 240,
        background: theme.sidebar.bg,
        color: "#ffffff",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        overflowY: "auto",
        height: "100vh",
      }}
    >
      <div style={{ padding: "1.25rem", borderBottom: `1px solid ${theme.sidebar.border}` }}>
        <h2 style={{ margin: 0, fontSize: theme.fontSize.lg, fontWeight: theme.fontWeight.bold, color: "#ffffff" }}>
          Divine Hands Hospital
        </h2>
        <span style={{ fontSize: theme.fontSize.sm, color: theme.sidebar.text }}>Enterprise Desktop OS</span>
      </div>

      <div style={{ padding: theme.spacing["4"], flex: 1, display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        {groups.map((group) => (
          <div key={group.title}>
            <div
              style={{
                fontSize: theme.fontSize.xs,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: theme.sidebar.category,
                fontWeight: theme.fontWeight.bold,
                marginBottom: theme.spacing["2"],
              }}
            >
              {group.title}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
              {group.items.map((item) => {
                const isActive = item.key === active;
                return (
                  <button
                    key={item.key}
                    onClick={() => (item.onSelect ? item.onSelect() : onSelect(item.key))}
                    aria-current={isActive ? "page" : undefined}
                    onMouseEnter={(e) => {
                      if (!isActive) e.currentTarget.style.background = theme.sidebar.hoverBg;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = isActive ? theme.sidebar.activeBg : "transparent";
                    }}
                    style={{
                      ...navBtnBase,
                      background: isActive ? theme.sidebar.activeBg : "transparent",
                      color: isActive ? theme.sidebar.activeTextAlt : theme.sidebar.text,
                      fontWeight: isActive ? theme.fontWeight.semibold : theme.fontWeight.medium,
                    }}
                  >
                    <Icon name={item.icon} size={16} color={isActive ? theme.sidebar.activeText : theme.sidebar.text} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          padding: theme.spacing["4"],
          borderTop: `1px solid ${theme.sidebar.border}`,
          display: "flex",
          flexDirection: "column",
          gap: "0.2rem",
        }}
      >
        <span style={{ fontSize: theme.fontSize.sm, color: theme.sidebar.text, padding: `0 ${theme.spacing["3"]}`, marginBottom: theme.spacing["2"] }}>
          {username}
        </span>
        <div
          style={{
            fontSize: theme.fontSize.xs,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: theme.sidebar.category,
            fontWeight: theme.fontWeight.bold,
            marginBottom: theme.spacing["2"],
          }}
        >
          System & Admin
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
          <button
            onClick={() => onSelect("settings")}
            aria-current={active === "settings" ? "page" : undefined}
            onMouseEnter={(e) => {
              if (active !== "settings") e.currentTarget.style.background = theme.sidebar.hoverBg;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = active === "settings" ? theme.sidebar.activeBg : "transparent";
            }}
            style={{
              ...navBtnBase,
              background: active === "settings" ? theme.sidebar.activeBg : "transparent",
              color: active === "settings" ? theme.sidebar.activeTextAlt : theme.sidebar.text,
              fontWeight: active === "settings" ? theme.fontWeight.semibold : theme.fontWeight.medium,
            }}
          >
            <Icon name="gear" size={16} color={active === "settings" ? theme.sidebar.activeText : theme.sidebar.text} />
            Settings
          </button>
          <button
            onClick={onLogout}
            onMouseEnter={(e) => (e.currentTarget.style.background = theme.sidebar.hoverBg)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            style={navBtnBase}
          >
            <Icon name="logout" size={16} color={theme.sidebar.text} />
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
