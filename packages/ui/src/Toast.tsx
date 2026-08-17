import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { theme } from "./theme";
import { Icon, type IconName } from "./Icon";

export type ToastType = "success" | "error" | "info";

export interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | undefined>(undefined);

let toastCounter = 0;

const toastMeta: Record<ToastType, { icon: IconName; color: string; border: string }> = {
  success: { icon: "check", color: theme.action.success, border: theme.action.success },
  error: { icon: "warning", color: theme.action.danger, border: theme.action.danger },
  info: { icon: "chat", color: theme.action.primary, border: theme.action.primary },
};

export function Toast({ type, message }: { type: ToastType; message: string }) {
  const meta = toastMeta[type];
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.spacing["2"],
        minWidth: 260,
        maxWidth: 380,
        padding: `${theme.spacing["2"]} ${theme.spacing["4"]}`,
        background: theme.surface.card,
        border: `1px solid ${theme.surface.border}`,
        borderLeft: `3px solid ${meta.border}`,
        borderRadius: theme.radius.md,
        boxShadow: theme.shadow.popover,
        fontSize: theme.fontSize.base,
        color: theme.text.primary,
      }}
    >
      <Icon name={meta.icon} size={16} color={meta.color} />
      <span>{message}</span>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((type: ToastType, message: string) => {
    const id = ++toastCounter;
    setToasts((prev) => [...prev, { id, type, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      info: (m) => push("info", m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        style={{
          position: "fixed",
          top: theme.spacing["4"],
          right: theme.spacing["4"],
          display: "flex",
          flexDirection: "column",
          gap: theme.spacing["2"],
          zIndex: 2000,
        }}
      >
        {toasts.map((t) => (
          <Toast key={t.id} type={t.type} message={t.message} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
