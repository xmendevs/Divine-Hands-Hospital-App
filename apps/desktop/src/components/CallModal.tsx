import { useCallback, useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CallParticipant {
  name: string;
  avatar?: string;
  isSelf?: boolean;
  userId?: string;
}

export type CallState = "initiating" | "ringing" | "incoming" | "connected" | "ended" | "missed" | "rejected";

interface CallModalProps {
  open: boolean;
  onClose: () => void;
  type: "voice" | "video";
  participants: CallParticipant[];
  /** If provided, this is an incoming call from this person */
  incomingFrom?: CallParticipant;
  /** Callback when call state changes (for logging) */
  onStateChange?: (state: CallState, duration?: number) => void;
}

/* ------------------------------------------------------------------ */
/*  Ringtone (generated via Web Audio API)                             */
/* ------------------------------------------------------------------ */

function playRingtone(): () => void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 440;
    gain.gain.value = 0.3;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();

    // Modulate for ring-ring pattern
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.5; // 0.5 Hz = 2s cycle
    lfoGain.gain.value = 200;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    lfo.start();

    return () => {
      osc.stop();
      lfo.stop();
      ctx.close();
    };
  } catch {
    return () => {};
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function CallModal({ open, onClose, type, participants, incomingFrom, onStateChange }: CallModalProps) {
  const [state, setState] = useState<CallState>("initiating");
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(type === "video");
  const [screenSharing, setScreenSharing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopRingRef = useRef<() => void>(() => {});

  const isVideo = type === "video";
  const caller = incomingFrom || participants[0];

  // Clean up on close
  const cleanup = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    stopRingRef.current();
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
  }, []);

  // Initiate call
  useEffect(() => {
    if (!open) return;
    setState(incomingFrom ? "incoming" : "initiating");
    setDuration(0);
    setMuted(false);
    setSpeakerOn(true);
    setCameraOn(type === "video");
    setScreenSharing(false);

    if (!incomingFrom) {
      // Caller: go to ringing after brief delay
      const initTimeout = setTimeout(() => {
        setState("ringing");
        stopRingRef.current = playRingtone();
        // 20s timeout for no answer
        timeoutRef.current = setTimeout(() => {
          cleanup();
          setState("missed");
          onStateChange?.("missed", 0);
          setTimeout(() => onClose(), 2000);
        }, 20000);
      }, 800);
      return () => { clearTimeout(initTimeout); cleanup(); };
    }
    return cleanup;
  }, [open, incomingFrom, type]); // eslint-disable-line react-hooks/exhaustive-deps

  // Start camera for video calls when connected
  useEffect(() => {
    if (!open || type !== "video" || !cameraOn || state !== "connected") return;
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    };
  }, [open, type, cameraOn, state]);

  // Start timer when connected
  useEffect(() => {
    if (state === "connected") {
      setDuration(0);
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
      onStateChange?.("connected", 0);
    }
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const acceptCall = useCallback(() => {
    stopRingRef.current();
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    setState("connected");
    onStateChange?.("connected", 0);
  }, [onStateChange]);

  const rejectCall = useCallback(() => {
    cleanup();
    setState("rejected");
    onStateChange?.("rejected", 0);
    setTimeout(() => onClose(), 1200);
  }, [cleanup, onClose, onStateChange]);

  const endCall = useCallback(() => {
    const dur = duration;
    cleanup();
    setState("ended");
    onStateChange?.("ended", dur);
    setTimeout(() => onClose(), 1200);
  }, [cleanup, onClose, duration, onStateChange]);

  function formatDuration(secs: number) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }

  if (!open) return null;

  const stateLabel: Record<string, string> = {
    initiating: "Calling...",
    ringing: "Ringing...",
    incoming: "Incoming Call",
    connected: isVideo ? "Video Call" : "Voice Call",
    ended: "Call Ended",
    missed: "Missed Call",
    rejected: "Call Rejected",
  };

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 9999,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,0.85)",
      backdropFilter: "blur(8px)",
    }}>
      <div style={{
        width: isVideo ? 640 : 380,
        maxWidth: "95vw",
        background: "#1a1a2e",
        borderRadius: 20,
        overflow: "hidden",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        display: "flex",
        flexDirection: "column",
        color: "#fff",
      }}>
        {/* Header */}
        <div style={{ padding: "20px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 14, color: "#94a3b8", marginBottom: 4 }}>
            {stateLabel[state] || ""}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {participants.map((p) => p.name).join(", ")}
          </div>
          {state === "connected" && (
            <div style={{ fontSize: 14, color: "#94a3b8", marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
              {formatDuration(duration)}
            </div>
          )}
        </div>

        {/* Video area */}
        {isVideo && (
          <div style={{ flex: 1, minHeight: 300, background: "#0f0f23", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
            {(state === "initiating" || state === "ringing" || state === "incoming") && (
              <div style={{ textAlign: "center" }}>
                <div style={{ width: 96, height: 96, borderRadius: 999, background: "#334155", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, margin: "0 auto 16px", animation: "pulse 1.5s infinite" }}>
                  {caller?.name?.[0] || "?"}
                </div>
                <div style={{ color: "#94a3b8" }}>{stateLabel[state]}</div>
              </div>
            )}
            {state === "connected" && cameraOn && (
              <video ref={videoRef} autoPlay muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8 }} />
            )}
            {state === "connected" && !cameraOn && (
              <div style={{ textAlign: "center" }}>
                <div style={{ width: 80, height: 80, borderRadius: 999, background: "#334155", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, margin: "0 auto 12px" }}>
                  {caller?.name?.[0] || "?"}
                </div>
                <div style={{ color: "#94a3b8" }}>Camera off</div>
              </div>
            )}
            {(state === "ended" || state === "missed" || state === "rejected") && (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 48, marginBottom: 8 }}>📞</div>
                <div style={{ color: "#94a3b8" }}>{stateLabel[state]}</div>
                {duration > 0 && <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>Duration: {formatDuration(duration)}</div>}
              </div>
            )}
            {screenSharing && state === "connected" && (
              <div style={{ position: "absolute", bottom: 12, right: 12, background: "#2563eb", padding: "4px 12px", borderRadius: 8, fontSize: 12 }}>Screen sharing</div>
            )}
          </div>
        )}

        {/* Voice call avatar area */}
        {!isVideo && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 200 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{
                width: 96, height: 96, borderRadius: 999, background: "#334155",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 40, margin: "0 auto 16px",
                animation: (state === "ringing" || state === "incoming" || state === "initiating") ? "pulse 1.5s infinite" : "none",
              }}>
                {caller?.name?.[0] || "?"}
              </div>
              <div style={{ fontSize: 14, color: state === "connected" ? "#22c55e" : "#94a3b8" }}>
                {stateLabel[state]}
              </div>
              {state === "connected" && (
                <div style={{ fontSize: 24, fontWeight: 700, marginTop: 8, fontVariantNumeric: "tabular-nums" }}>
                  {formatDuration(duration)}
                </div>
              )}
              {(state === "ended" || state === "missed" || state === "rejected") && duration > 0 && (
                <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>Duration: {formatDuration(duration)}</div>
              )}
            </div>
          </div>
        )}

        {/* Incoming call: Accept / Reject */}
        {state === "incoming" && (
          <div style={{ padding: "20px 24px", display: "flex", justifyContent: "center", gap: 32 }}>
            <button onClick={rejectCall} style={{
              width: 64, height: 64, borderRadius: 999, border: "none", background: "#ef4444",
              color: "#fff", fontSize: 28, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            }}>📞</button>
            <button onClick={acceptCall} style={{
              width: 64, height: 64, borderRadius: 999, border: "none", background: "#22c55e",
              color: "#fff", fontSize: 28, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              animation: "pulse 1.5s infinite",
            }}>📞</button>
          </div>
        )}

        {/* Connected: Controls */}
        {state === "connected" && (
          <div style={{ padding: "20px 24px", display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap" }}>
            <button onClick={() => setMuted(!muted)} style={controlBtn(muted)}>{muted ? "🔇" : "🎤"}</button>
            {!isVideo && <button onClick={() => setSpeakerOn(!speakerOn)} style={controlBtn(!speakerOn)}>{speakerOn ? "🔊" : "🔈"}</button>}
            {isVideo && <button onClick={() => setCameraOn(!cameraOn)} style={controlBtn(!cameraOn)}>{cameraOn ? "📹" : "📷"}</button>}
            {isVideo && <button onClick={() => setScreenSharing(!screenSharing)} style={controlBtn(screenSharing)}>🖥️</button>}
            <button onClick={endCall} style={{ width: 56, height: 56, borderRadius: 999, border: "none", background: "#ef4444", color: "#fff", fontSize: 24, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>📞</button>
          </div>
        )}

        {/* Ringing: Cancel button for caller */}
        {state === "ringing" && (
          <div style={{ padding: "20px 24px", display: "flex", justifyContent: "center" }}>
            <button onClick={endCall} style={{ width: 56, height: 56, borderRadius: 999, border: "none", background: "#ef4444", color: "#fff", fontSize: 24, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>📞</button>
          </div>
        )}
      </div>

      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.7; transform: scale(1.05); } }`}</style>
    </div>
  );
}

function controlBtn(active: boolean): React.CSSProperties {
  return {
    width: 48, height: 48, borderRadius: 999, border: "none",
    background: active ? "#ef4444" : "#334155", color: "#fff",
    fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
  };
}
