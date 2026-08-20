import { useCallback, useEffect, useRef, useState } from "react";
import { theme } from "@hims/ui";
import { useNotifications, type AppNotification, type NotificationKind } from "./NotificationContext";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const KIND_ICONS: Record<NotificationKind, string> = {
  dm: "\uD83D\uDCAC",
  broadcast: "\uD83D\uDCE2",
  call_incoming: "\uD83D\uDCDE",
  call_missed: "\u274C",
  call_rejected: "\uD83D\uDEAB",
  lab_critical: "\u26A0\uFE0F",
  order: "\uD83D\uDCCB",
  system: "\u2699\uFE0F",
};

const KIND_COLORS: Record<NotificationKind, string> = {
  dm: "#60a5fa",
  broadcast: "#f59e0b",
  call_incoming: "#22c55e",
  call_missed: "#ef4444",
  call_rejected: "#f97316",
  lab_critical: "#ef4444",
  order: "#a78bfa",
  system: "#94a3b8",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface NotificationBellProps {
  /** Called when user clicks a notification — receives the navigateTo tab key */
  onNavigate: (tab: string, data?: Record<string, string>) => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function NotificationBell({ onNavigate }: NotificationBellProps) {
  const { notifications, unreadCount, markRead, markAllRead, clearAll, dismiss } = useNotifications();
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);

  /* Close drawer on outside click */
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        drawerRef.current && !drawerRef.current.contains(e.target as Node) &&
        bellRef.current && !bellRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleClick = useCallback((notif: AppNotification) => {
    markRead(notif.id);
    setOpen(false);
    onNavigate(notif.navigateTo, notif.navigateData);
  }, [markRead, onNavigate]);

  return (
    <div style={{ position: "relative" }}>
      {/* Bell button */}
      <button
        ref={bellRef}
        onClick={() => setOpen(!open)}
        title={`${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}`}
        style={{
          position: "relative", width: 40, height: 40, borderRadius: 999,
          border: "none", background: "transparent", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 20, color: theme.text.primary,
        }}
      >
        &#128276;
        {unreadCount > 0 && (
          <span style={{
            position: "absolute", top: 2, right: 2,
            minWidth: 18, height: 18, borderRadius: 999,
            background: theme.text.danger, color: "#fff",
            fontSize: 10, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "0 4px", lineHeight: 1,
          }}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Drawer */}
      {open && (
        <div
          ref={drawerRef}
          style={{
            position: "absolute", top: "calc(100% + 8px)", right: 0,
            width: 380, maxHeight: 500,
            background: theme.surface.card, borderRadius: theme.radius.lg,
            border: `1px solid ${theme.surface.border}`,
            boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
            zIndex: 1000, overflow: "hidden",
            display: "flex", flexDirection: "column",
          }}
        >
          {/* Header */}
          <div style={{
            padding: `${theme.spacing["3"]} ${theme.spacing["4"]}`,
            borderBottom: `1px solid ${theme.surface.border}`,
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span style={{ fontSize: theme.fontSize.base, fontWeight: theme.fontWeight.bold, color: theme.text.primary }}>
              Notifications
              {unreadCount > 0 && <span style={{ marginLeft: 6, fontSize: theme.fontSize.xs, color: theme.text.danger }}>({unreadCount} new)</span>}
            </span>
            <div style={{ display: "flex", gap: theme.spacing["2"] }}>
              {unreadCount > 0 && (
                <button onClick={markAllRead} style={{ background: "none", border: "none", fontSize: theme.fontSize.xs, color: theme.action.info, cursor: "pointer" }}>
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button onClick={clearAll} style={{ background: "none", border: "none", fontSize: theme.fontSize.xs, color: theme.text.muted, cursor: "pointer" }}>
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Notification list */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {notifications.length === 0 ? (
              <div style={{ padding: theme.spacing["8"], textAlign: "center", color: theme.text.muted, fontSize: theme.fontSize.sm }}>
                No notifications yet.
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => handleClick(n)}
                  style={{
                    padding: `${theme.spacing["2"]} ${theme.spacing["3"]}`,
                    borderBottom: `1px solid ${theme.surface.border}`,
                    cursor: "pointer",
                    background: n.read ? "transparent" : `${theme.action.info}08`,
                    display: "flex", gap: theme.spacing["2"], alignItems: "flex-start",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = theme.surface.subtle)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = n.read ? "transparent" : `${theme.action.info}08`)}
                >
                  {/* Icon */}
                  <div style={{
                    width: 32, height: 32, borderRadius: 999, flexShrink: 0,
                    background: `${KIND_COLORS[n.kind]}18`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14,
                  }}>
                    {KIND_ICONS[n.kind]}
                  </div>
                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <span style={{
                        fontSize: theme.fontSize.sm,
                        fontWeight: n.read ? theme.fontWeight.medium : theme.fontWeight.bold,
                        color: theme.text.primary,
                      }}>
                        {n.title}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
                        style={{ background: "none", border: "none", fontSize: 12, color: theme.text.muted, cursor: "pointer", padding: 0, flexShrink: 0 }}
                      >
                        &#10005;
                      </button>
                    </div>
                    <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {n.body}
                    </div>
                    <div style={{ fontSize: 10, color: theme.text.muted, marginTop: 4 }}>
                      {timeAgo(n.timestamp)}
                      {!n.read && <span style={{ marginLeft: 6, width: 6, height: 6, borderRadius: 999, background: theme.action.info, display: "inline-block", verticalAlign: "middle" }} />}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
