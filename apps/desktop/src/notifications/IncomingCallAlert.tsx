import { useEffect, useState } from "react";
import { useNotifications } from "./NotificationContext";

/**
 * Full-screen incoming call alert overlay.
 * Shows caller name, call type, ring tone, and Accept/Reject buttons.
 * Auto-dismisses after 30s (missed call).
 */
export default function IncomingCallAlert() {
  const { incomingCall, acceptIncomingCall, rejectIncomingCall } = useNotifications();
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (!incomingCall) return;
    const iv = setInterval(() => setPulse((p) => !p), 1000);
    return () => clearInterval(iv);
  }, [incomingCall]);

  if (!incomingCall) return null;

  const isVideo = incomingCall.callType === "video";

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 99999,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.9)", backdropFilter: "blur(12px)",
    }}>
      <div style={{
        width: 360, background: "#1a1a2e", borderRadius: 24,
        overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
        textAlign: "center", color: "#fff",
      }}>
        {/* Avatar */}
        <div style={{ padding: "40px 0 20px" }}>
          <div style={{
            width: 100, height: 100, borderRadius: 999,
            background: "linear-gradient(135deg, #2563eb, #7c3aed)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 44, margin: "0 auto 16px",
            boxShadow: pulse ? "0 0 40px rgba(37,99,235,0.5)" : "0 0 20px rgba(37,99,235,0.3)",
            transform: pulse ? "scale(1.05)" : "scale(1)",
            transition: "transform 0.5s ease, box-shadow 0.5s ease",
          }}>
            {incomingCall.callerName[0] || "?"}
          </div>
          <div style={{ fontSize: 14, color: "#94a3b8", marginBottom: 4 }}>Incoming {isVideo ? "Video" : "Voice"} Call</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{incomingCall.callerName}</div>
        </div>

        {/* Accept / Reject */}
        <div style={{ padding: "20px 0 40px", display: "flex", justifyContent: "center", gap: 40 }}>
          <button
            onClick={rejectIncomingCall}
            style={{
              width: 72, height: 72, borderRadius: 999, border: "none",
              background: "#ef4444", color: "#fff", fontSize: 30,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 4px 20px rgba(239,68,68,0.4)",
            }}
            title="Reject"
          >
            &#128222;
          </button>
          <button
            onClick={acceptIncomingCall}
            style={{
              width: 72, height: 72, borderRadius: 999, border: "none",
              background: "#22c55e", color: "#fff", fontSize: 30,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 4px 20px rgba(34,197,94,0.4)",
              animation: "pulse 1.5s infinite",
            }}
            title="Accept"
          >
            &#128222;
          </button>
        </div>

        <div style={{ padding: "0 24px 20px", fontSize: 12, color: "#64748b" }}>
          Tap to {isVideo ? "answer video" : "answer"} or reject
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
      `}</style>
    </div>
  );
}
