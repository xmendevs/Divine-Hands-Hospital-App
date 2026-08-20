import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type NotificationKind =
  | "dm"
  | "broadcast"
  | "call_incoming"
  | "call_missed"
  | "call_rejected"
  | "lab_critical"
  | "order"
  | "system";

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** Where to navigate when clicked (sidebar tab key) */
  navigateTo: string;
  /** Optional extra data for navigation (e.g., peer userId, channel id) */
  navigateData?: Record<string, string>;
  timestamp: string;
  read: boolean;
}

export interface IncomingCallAlert {
  callerName: string;
  callerId: string;
  callType: "voice" | "video";
  callId: string;
}

interface NotificationContextValue {
  notifications: AppNotification[];
  unreadCount: number;
  /** Add a notification */
  push: (n: Omit<AppNotification, "id" | "timestamp" | "read">) => void;
  /** Mark one as read */
  markRead: (id: string) => void;
  /** Mark all as read */
  markAllRead: () => void;
  /** Clear all */
  clearAll: () => void;
  /** Remove a single notification */
  dismiss: (id: string) => void;

  /* ── Incoming call alerts ── */
  incomingCall: IncomingCallAlert | null;
  /** Show an incoming call alert */
  showIncomingCall: (alert: IncomingCallAlert) => void;
  /** Accept the incoming call */
  acceptIncomingCall: () => void;
  /** Reject the incoming call */
  rejectIncomingCall: () => void;
}

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

const NotificationCtx = createContext<NotificationContextValue | null>(null);

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationCtx);
  if (!ctx) throw new Error("useNotifications must be used within NotificationProvider");
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Ring tone via Web Audio API                                        */
/* ------------------------------------------------------------------ */

function playRingtone(): () => void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 440;
    gain.gain.value = 0.25;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.5;
    lfoGain.gain.value = 200;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    lfo.start();
    return () => { osc.stop(); lfo.stop(); ctx.close().catch(() => {}); };
  } catch { return () => {}; }
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

let nextId = 1;

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [incomingCall, setIncomingCall] = useState<IncomingCallAlert | null>(null);
  const stopRingRef = useRef<() => void>(() => {});

  /* ── Notification CRUD ── */
  const push = useCallback((n: Omit<AppNotification, "id" | "timestamp" | "read">) => {
    const full: AppNotification = {
      ...n,
      id: `notif-${nextId++}`,
      timestamp: new Date().toISOString(),
      read: false,
    };
    setNotifications((prev) => [full, ...prev].slice(0, 100)); // keep last 100
  }, []);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => setNotifications([]), []);

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  /* ── Incoming call alerts ── */
  const showIncomingCall = useCallback((alert: IncomingCallAlert) => {
    setIncomingCall(alert);
    stopRingRef.current = playRingtone();
    // Auto-dismiss after 30 seconds (missed call)
    setTimeout(() => {
      setIncomingCall((prev) => {
        if (prev && prev.callId === alert.callId) {
          stopRingRef.current();
          return null;
        }
        return prev;
      });
    }, 30000);
  }, []);

  const acceptIncomingCall = useCallback(() => {
    stopRingRef.current();
    setIncomingCall(null);
  }, []);

  const rejectIncomingCall = useCallback(() => {
    stopRingRef.current();
    setIncomingCall(null);
  }, []);

  /* ── Cleanup on unmount ── */
  useEffect(() => {
    return () => { stopRingRef.current(); };
  }, []);

  const value = useMemo<NotificationContextValue>(() => ({
    notifications,
    unreadCount: notifications.filter((n) => !n.read).length,
    push, markRead, markAllRead, clearAll, dismiss,
    incomingCall, showIncomingCall, acceptIncomingCall, rejectIncomingCall,
  }), [notifications, push, markRead, markAllRead, clearAll, dismiss, incomingCall, showIncomingCall, acceptIncomingCall, rejectIncomingCall]);

  return <NotificationCtx.Provider value={value}>{children}</NotificationCtx.Provider>;
}
