import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import FileAttachmentPicker, { type SelectedFile } from "./FileAttachmentPicker";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface LiveBroadcastModalProps {
  open: boolean;
  onClose: () => void;
  type: "voice" | "video";
  broadcasterName: string;
  broadcasterId?: string;
}

type BroadcastState = "setup" | "live" | "ended";

interface Participant {
  name: string;
  role: string;
  joinedAt: string;
  isMuted: boolean;
  isHost: boolean;
  handRaised: boolean;
  cameraOn: boolean;
}

interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: string;
}

interface SharedFile {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageRef: string;
}

interface FloatingReaction {
  id: number;
  emoji: string;
  x: number;
}

const REACTIONS = ["👍", "❤️", "👏", "😂", "🎉", "😮"];

const ROLE_COLORS: Record<string, string> = {
  Doctor: "#60a5fa",
  Nurse: "#a78bfa",
  Matron: "#e879f9",
  Pharmacist: "#34d399",
  Cashier: "#fbbf24",
  "Lab Tech": "#f87171",
  "Lab Supervisor": "#fb923c",
  Host: "#ef4444",
};

function getRoleColor(role: string): string {
  for (const [key, color] of Object.entries(ROLE_COLORS)) {
    if (role.toLowerCase().includes(key.toLowerCase())) return color;
  }
  return "#94a3b8";
}

function formatTime(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function LiveBroadcastModal({
  open, onClose, type, broadcasterName,
}: LiveBroadcastModalProps) {
  const isVideo = type === "video";

  /* ── State ── */
  const [state, setState] = useState<BroadcastState>("setup");
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(isVideo);
  const [screenSharing, setScreenSharing] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [sharedFiles, setSharedFiles] = useState<SharedFile[]>([]);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const [showChat, setShowChat] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const reactionIdRef = useRef(0);

  /* ── Refs ── */
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  /* ── Timer ── */
  useEffect(() => {
    if (state === "live") {
      setDuration(0);
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    }
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [state]);

  /* ── Camera / Screen Share ── */
  useEffect(() => {
    if (!open || state !== "live") return;
    let cancelled = false;
    const startMedia = async () => {
      try {
        if (screenSharing) {
          const s = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: false });
          if (cancelled) { s.getTracks().forEach((t: any) => t.stop()); return; }
          streamRef.current = s;
          if (videoRef.current) videoRef.current.srcObject = s;
          s.getVideoTracks()[0]?.addEventListener("ended", () => setScreenSharing(false));
        } else if (cameraOn && isVideo) {
          const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
          streamRef.current = s;
          if (videoRef.current) videoRef.current.srcObject = s;
        }
      } catch { /* denied */ }
    };
    startMedia();
    return () => {
      cancelled = true;
      if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    };
  }, [open, state, cameraOn, screenSharing, isVideo]);

  /* ── Auto-scroll chat ── */
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  /* ── Cleanup ── */
  const cleanup = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    setState("setup"); setDuration(0); setParticipants([]); setChatMessages([]);
    setSharedFiles([]); setFloatingReactions([]); setShowChat(false);
    setShowParticipants(false); setShowFiles(false);
  }, []);

  const handleClose = useCallback(() => { cleanup(); onClose(); }, [cleanup, onClose]);

  const startBroadcast = useCallback(() => setState("live"), []);

  const endBroadcast = useCallback(() => {
    cleanup(); setState("ended");
    setTimeout(() => handleClose(), 2500);
  }, [cleanup, handleClose]);

  /* ── Chat ── */
  const sendChat = useCallback((e: FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    setChatMessages((prev) => [...prev, { id: `c-${Date.now()}`, sender: broadcasterName, text: chatInput.trim(), timestamp: new Date().toLocaleTimeString() }]);
    setChatInput("");
  }, [chatInput, broadcasterName]);

  /* ── Reactions ── */
  const sendReaction = useCallback((emoji: string) => {
    const id = ++reactionIdRef.current;
    const x = 15 + Math.random() * 70;
    setFloatingReactions((prev) => [...prev, { id, emoji, x }]);
    setTimeout(() => setFloatingReactions((prev) => prev.filter((r) => r.id !== id)), 3000);
  }, []);

  /* ── File sharing ── */
  const handleFilesSelected = useCallback((files: SelectedFile[]) => {
    setSharedFiles((prev) => [...prev, ...files.map((f) => ({ fileName: f.fileName, mimeType: f.mimeType, sizeBytes: f.sizeBytes, storageRef: f.dataUrl }))]);
  }, []);

  if (!open) return null;

  /* ── ENDED ── */
  if (state === "ended") {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)" }}>
        <div style={{ background: "#1a1a2e", borderRadius: 20, padding: 48, textAlign: "center", color: "#fff", maxWidth: 400 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>&#128225;</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Broadcast Ended</div>
          <div style={{ fontSize: 14, color: "#94a3b8" }}>Duration: {formatTime(duration)} &middot; {participants.length + 1} participants joined</div>
        </div>
        <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}@keyframes floatUp{0%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(-500px) scale(1.6)}}`}</style>
      </div>
    );
  }

  /* ── SETUP ── */
  if (state === "setup") {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)" }}>
        <div style={{ width: 520, maxWidth: "95vw", background: "#1a1a2e", borderRadius: 20, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.5)", color: "#fff" }}>
          <div style={{ padding: "24px 32px", textAlign: "center", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#94a3b8", marginBottom: 4 }}>Broadcast Setup</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>Hospital-Wide {isVideo ? "Video" : "Audio"} Broadcast</div>
          </div>
          <div style={{ padding: 32, textAlign: "center" }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>{isVideo ? "\uD83D\uDCF9" : "\uD83C\uDF99\uFE0F"}</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Ready to Go Live?</div>
            <div style={{ fontSize: 14, color: "#94a3b8", marginBottom: 8 }}>All active staff will be notified and can join as {isVideo ? "viewers" : "listeners"}.</div>
            <div style={{ fontSize: 13, color: "#64748b", marginBottom: 24 }}>Host: <strong style={{ color: "#fff" }}>{broadcasterName}</strong></div>
            <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
              <button onClick={handleClose} style={{ padding: "12px 28px", borderRadius: 12, border: "1px solid #334155", background: "transparent", color: "#fff", cursor: "pointer", fontSize: 14 }}>Cancel</button>
              <button onClick={startBroadcast} style={{ padding: "12px 28px", borderRadius: 12, border: "none", background: "#ef4444", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>&#128308; Go Live</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── LIVE ── */
  const allParticipants: Participant[] = [
    { name: broadcasterName, role: "Host", joinedAt: "", isMuted: muted, isHost: true, handRaised: false, cameraOn },
    ...participants,
  ];
  const gridCols = allParticipants.length <= 2 ? 2 : allParticipants.length <= 4 ? 2 : 3;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", flexDirection: "column", background: "#0f0f23", color: "#fff" }}>
      {/* Floating reactions */}
      {floatingReactions.map((r) => (
        <div key={r.id} style={{ position: "fixed", left: `${r.x}%`, bottom: 80, fontSize: 36, zIndex: 10000, pointerEvents: "none", animation: "floatUp 3s ease-out forwards" }}>{r.emoji}</div>
      ))}

      {/* ── Top Bar ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 20px", background: "#1a1a2e", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#ef4444", padding: "3px 10px", borderRadius: 8, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: "#fff", animation: "pulse 1s infinite" }} />
            LIVE
          </span>
          <span style={{ fontSize: 18, fontWeight: 700 }}>Hospital Broadcast</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 14, color: "#94a3b8" }}>{allParticipants.length} in room</span>
          <span style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{formatTime(duration)}</span>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* ── Video Grid ── */}
        <div style={{ flex: 1, padding: 12, display: "grid", gridTemplateColumns: `repeat(${gridCols}, 1fr)`, gap: 8, overflow: "auto", alignContent: "start" }}>
          {allParticipants.map((p, i) => {
            const rc = getRoleColor(p.role);
            const showVid = p.isHost ? cameraOn : p.cameraOn;
            return (
              <div key={i} style={{ background: "#1a1a2e", borderRadius: 12, overflow: "hidden", position: "relative", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 180, border: p.isHost ? "2px solid #ef4444" : "1px solid rgba(255,255,255,0.08)" }}>
                {p.isHost && showVid ? (
                  <video ref={videoRef} autoPlay muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : showVid ? (
                  <div style={{ width: "100%", height: "100%", background: `linear-gradient(135deg, ${rc}33, ${rc}11)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ width: 72, height: 72, borderRadius: 999, background: `${rc}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 700, color: rc }}>{p.name[0]}</div>
                  </div>
                ) : (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ width: 80, height: 80, borderRadius: 999, background: `${rc}33`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, margin: "0 auto 8px", color: rc, fontWeight: 700 }}>{p.name[0]}</div>
                    <div style={{ fontSize: 12, color: "#94a3b8" }}>Camera off</div>
                  </div>
                )}
                {/* Name badge */}
                <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "6px 10px", background: "linear-gradient(transparent, rgba(0,0,0,0.8))", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{p.isHost ? `${p.name} (Host)` : p.name}</span>
                    {p.handRaised && <span style={{ fontSize: 14 }}>&#9995;</span>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {p.isMuted ? <span style={{ fontSize: 11, color: "#ef4444" }}>&#128263;</span> : <span style={{ fontSize: 11, color: "#22c55e" }}>&#127908;</span>}
                    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: `${rc}33`, color: rc }}>{p.role}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Side Panels (Chat / Participants / Files) ── */}
        {(showChat || showParticipants || showFiles) && (
          <div style={{ width: 320, background: "#1a1a2e", borderLeft: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", flexShrink: 0 }}>
            {/* Panel Header */}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{showChat ? "In-Call Chat" : showParticipants ? "Participants" : "Shared Files"}</span>
              <button onClick={() => { setShowChat(false); setShowParticipants(false); setShowFiles(false); }} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 16 }}>&#10005;</button>
            </div>

            {/* Chat Panel */}
            {showChat && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
                  {chatMessages.length === 0 && <div style={{ fontSize: 13, color: "#64748b", textAlign: "center", marginTop: 24 }}>No messages yet.</div>}
                  {chatMessages.map((m) => (
                    <div key={m.id} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, color: "#64748b" }}>{m.timestamp}</div>
                      <div style={{ fontSize: 13 }}><strong style={{ color: "#60a5fa" }}>{m.sender}</strong>: {m.text}</div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                <form onSubmit={sendChat} style={{ padding: "8px 12px", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: 8 }}>
                  <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Type a message..." style={{ flex: 1, background: "#0f0f23", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "8px 12px", color: "#fff", fontSize: 13, outline: "none" }} />
                  <button type="submit" style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Send</button>
                </form>
              </div>
            )}

            {/* Participants Panel */}
            {showParticipants && (
              <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>In Room ({allParticipants.length})</div>
                {allParticipants.map((p, i) => {
                  const rc = getRoleColor(p.role);
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <div style={{ width: 32, height: 32, borderRadius: 999, background: `${rc}33`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: rc }}>{p.name[0]}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{p.isHost ? `${p.name} (Host)` : p.name}</div>
                        <div style={{ fontSize: 11, color: rc }}>{p.role}</div>
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        {p.isMuted ? <span style={{ fontSize: 11, color: "#ef4444" }}>&#128263;</span> : <span style={{ fontSize: 11, color: "#22c55e" }}>&#127908;</span>}
                        {p.handRaised && <span style={{ fontSize: 12 }}>&#9995;</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Files Panel */}
            {showFiles && (
              <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
                <div style={{ marginBottom: 12 }}>
                  <FileAttachmentPicker onFilesSelected={handleFilesSelected} />
                </div>
                {sharedFiles.length === 0 && <div style={{ fontSize: 13, color: "#64748b", textAlign: "center", marginTop: 24 }}>No files shared yet.</div>}
                {sharedFiles.map((f, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>{f.mimeType.includes("pdf") ? "\uD83D\uDCC4" : f.mimeType.startsWith("image/") ? "\uD83D\uDDBC\uFE0F" : "\uD83D\uDCCE"}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.fileName}</div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>{(f.sizeBytes / 1024).toFixed(1)} KB</div>
                    </div>
                    <a href={f.storageRef} download={f.fileName} style={{ fontSize: 12, color: "#60a5fa", textDecoration: "none" }}>&#11015;</a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Bottom Controls ── */}
      <div style={{ padding: "12px 20px", background: "#1a1a2e", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "center", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
        {/* Reaction tray */}
        <div style={{ display: "flex", gap: 4, marginRight: 8 }}>
          {REACTIONS.map((emoji) => (
            <button key={emoji} onClick={() => sendReaction(emoji)} title={`React ${emoji}`} style={{ width: 36, height: 36, borderRadius: 999, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >{emoji}</button>
          ))}
        </div>

        <div style={{ width: 1, height: 32, background: "rgba(255,255,255,0.15)", margin: "0 4px" }} />

        {/* Media controls */}
        <button onClick={() => setMuted(!muted)} title={muted ? "Unmute" : "Mute"} style={ctrlBtn(muted)}>{muted ? "\uD83D\uDD07" : "\uD83C\uDF99\uFE0F"}</button>
        {isVideo && <button onClick={() => setCameraOn(!cameraOn)} title={cameraOn ? "Turn camera off" : "Turn camera on"} style={ctrlBtn(!cameraOn)}>{cameraOn ? "\uD83D\uDCF9" : "\uD83D\uDCF7"}</button>}
        <button onClick={() => setScreenSharing(!screenSharing)} title={screenSharing ? "Stop sharing" : "Share screen"} style={ctrlBtn(screenSharing)}>&#128421;&#65039;</button>

        <div style={{ width: 1, height: 32, background: "rgba(255,255,255,0.15)", margin: "0 4px" }} />

        {/* Panel toggles */}
        <button onClick={() => { setShowChat(!showChat); setShowParticipants(false); setShowFiles(false); }} title="Chat" style={panelBtn(showChat)}>&#128172;</button>
        <button onClick={() => { setShowParticipants(!showParticipants); setShowChat(false); setShowFiles(false); }} title="Participants" style={panelBtn(showParticipants)}>&#128101;</button>
        <button onClick={() => { setShowFiles(!showFiles); setShowChat(false); setShowParticipants(false); }} title="Files" style={panelBtn(showFiles)}>&#128206;</button>

        <div style={{ width: 1, height: 32, background: "rgba(255,255,255,0.15)", margin: "0 4px" }} />

        {/* End broadcast */}
        <button onClick={endBroadcast} title="End broadcast" style={{ width: 52, height: 52, borderRadius: 999, border: "none", background: "#ef4444", color: "#fff", fontSize: 22, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>&#9209;&#65039;</button>
      </div>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes floatUp {
          0% { opacity: 1; transform: translateY(0) scale(1); }
          100% { opacity: 0; transform: translateY(-500px) scale(1.6); }
        }
      `}</style>
    </div>
  );
}

/* ── Control button helpers ── */
function ctrlBtn(active: boolean): React.CSSProperties {
  return {
    width: 48, height: 48, borderRadius: 999, border: "none",
    background: active ? "#ef4444" : "#334155", color: "#fff",
    fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    transition: "background 0.15s",
  };
}

function panelBtn(active: boolean): React.CSSProperties {
  return {
    width: 40, height: 40, borderRadius: 999, border: "none",
    background: active ? "#2563eb" : "#334155", color: "#fff",
    fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    transition: "background 0.15s",
  };
}
