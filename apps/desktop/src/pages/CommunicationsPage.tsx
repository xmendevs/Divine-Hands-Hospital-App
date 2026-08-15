import React, { useState, useEffect, useRef } from "react";

interface Message {
  id: string;
  sender: string;
  text?: string;
  audioUrl?: string;
  timestamp: string;
  status: "sent" | "delivered" | "seen";
}

interface CallLog {
  id: string;
  peer: string;
  type: "Voice" | "Video";
  duration: string;
  timestamp: string;
  status: "Completed" | "Missed" | "Declined";
}

export default function CommunicationsPage() {
  const [activeTab, setActiveTab] = useState<"dm" | "broadcast" | "calls" | "channels">("dm");
  const [selectedPeer, setSelectedPeer] = useState("Dr. Sarah Jenkins");
  const [inputText, setInputText] = useState("");
  const [messages, setMessages] = useState<Record<string, Message[]>>({
    "Dr. Sarah Jenkins": [
      { id: "1", sender: "Dr. Sarah Jenkins", text: "Please review the lab results for Ward 3.", timestamp: "10:42 AM", status: "seen" },
      { id: "2", sender: "You", text: "Checked. Proceeding with prescription update.", timestamp: "10:45 AM", status: "seen" },
    ],
    "Nurse Adebayo": [
      { id: "1", sender: "Nurse Adebayo", text: "Handover notes submitted for morning shift.", timestamp: "08:15 AM", status: "seen" },
    ]
  });

  const [inCall, setInCall] = useState(false);
  const [callType, setCallType] = useState<"Voice" | "Video">("Voice");
  const [callTimer, setCallTimer] = useState(0);
  const [callLogs, setCallLogs] = useState<CallLog[]>([
    { id: "c1", peer: "Nurse Adebayo", type: "Voice", duration: "03:45", timestamp: "Today, 09:30 AM", status: "Completed" },
    { id: "c2", peer: "Dr. Chidi Okafor", type: "Video", duration: "12:10", timestamp: "Yesterday, 04:15 PM", status: "Completed" },
  ]);

  const [isRecording, setIsRecording] = useState(false);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    if (inCall) {
      setCallTimer(0);
      timerRef.current = setInterval(() => {
        setCallTimer((prev) => prev + 1);
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [inCall]);

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    return `${mins.toString().padStart(2, "0")}:${remSecs.toString().padStart(2, "0")}`;
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const newMsg: Message = {
      id: Date.now().toString(),
      sender: "You",
      text: inputText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: "sent",
    };

    setMessages((prev) => ({
      ...prev,
      [selectedPeer]: [...(prev[selectedPeer] || []), newMsg],
    }));
    setInputText("");

    setTimeout(() => {
      setMessages((prev) => ({
        ...prev,
        [selectedPeer]: prev[selectedPeer].map((m) => m.id === newMsg.id ? { ...m, status: "delivered" } : m),
      }));
    }, 1200);

    setTimeout(() => {
      setMessages((prev) => ({
        ...prev,
        [selectedPeer]: prev[selectedPeer].map((m) => m.id === newMsg.id ? { ...m, status: "seen" } : m),
      }));
    }, 2500);
  };

  const startCall = (type: "Voice" | "Video") => {
    setCallType(type);
    setInCall(true);
  };

  const endCall = () => {
    setInCall(false);
    const newLog: CallLog = {
      id: Date.now().toString(),
      peer: selectedPeer,
      type: callType,
      duration: formatTime(callTimer),
      timestamp: "Just now",
      status: "Completed",
    };
    setCallLogs([newLog, ...callLogs]);
  };

  return (
    <div style={{ padding: "1.5rem", height: "100vh", boxSizing: "border-box", display: "flex", flexDirection: "column", background: "#f8fafc" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0f172a", margin: 0 }}>Staff Communications & Calls</h1>
          <p style={{ fontSize: "0.85rem", color: "#64748b", margin: 0 }}>Governed secure messaging, voice/video calls, and broadcast channels.</p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button onClick={() => setActiveTab("dm")} style={tabStyle(activeTab === "dm")}>Direct Messages</button>
          <button onClick={() => setActiveTab("broadcast")} style={tabStyle(activeTab === "broadcast")}>Broadcasts</button>
          <button onClick={() => setActiveTab("calls")} style={tabStyle(activeTab === "calls")}>Call Logs</button>
        </div>
      </div>

      {activeTab === "dm" && (
        <div style={{ display: "flex", flex: 1, background: "#fff", borderRadius: "10px", border: "1px solid #e2e8f0", overflow: "hidden", minHeight: 0 }}>
          <div style={{ width: "280px", borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column", background: "#f8fafc" }}>
            <div style={{ padding: "1rem", borderBottom: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.85rem", color: "#334155" }}>Hospital Staff Directory</div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {["Dr. Sarah Jenkins", "Nurse Adebayo", "Dr. Chidi Okafor", "Matron Elizabeth Cole", "Pharmacy Frontdesk"].map((peer) => (
                <div 
                  key={peer} 
                  onClick={() => setSelectedPeer(peer)}
                  style={{ padding: "0.75rem 1rem", cursor: "pointer", background: selectedPeer === peer ? "#e0f2fe" : "transparent", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}
                >
                  <span style={{ fontSize: "0.85rem", fontWeight: selectedPeer === peer ? 700 : 500, color: "#1e293b" }}>{peer}</span>
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#22c55e" }}></span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#fff" }}>
            <div style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "#0f172a" }}>{selectedPeer}</div>
                <div style={{ fontSize: "0.7rem", color: "#22c55e" }}>Online • Secure Channel</div>
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button onClick={() => startCall("Voice")} style={callBtnStyle("#0284c7")}>📞 Voice Call</button>
                <button onClick={() => startCall("Video")} style={callBtnStyle("#0d9488")}>📹 Video Call</button>
              </div>
            </div>

            {inCall && (
              <div style={{ background: "#0f172a", color: "#fff", padding: "1.5rem", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", borderBottom: "1px solid #334155" }}>
                <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{callType} Call with {selectedPeer}</div>
                <div style={{ fontSize: "2rem", fontFamily: "monospace", color: "#38bdf8" }}>{formatTime(callTimer)}</div>
                <div style={{ fontSize: "0.75rem", color: "#94a3b8" }}>Encrypted Hospital Call Session</div>
                <button onClick={endCall} style={{ background: "#ef4444", color: "#fff", border: "none", padding: "0.5rem 1.5rem", borderRadius: "6px", fontWeight: 700, cursor: "pointer" }}>End Call</button>
              </div>
            )}

            <div style={{ flex: 1, padding: "1rem", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {(messages[selectedPeer] || []).map((msg) => {
                const isMe = msg.sender === "You";
                return (
                  <div key={msg.id} style={{ alignSelf: isMe ? "flex-end" : "flex-start", maxWidth: "70%" }}>
                    <div style={{ background: isMe ? "#bae6fd" : "#f1f5f9", padding: "0.65rem 0.9rem", borderRadius: "8px", fontSize: "0.85rem", color: "#0f172a" }}>
                      {msg.text}
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "4px", fontSize: "0.65rem", color: "#64748b", marginTop: "2px" }}>
                      <span>{msg.timestamp}</span>
                      {isMe && (
                        <span style={{ color: msg.status === "seen" ? "#0284c7" : "#64748b", fontWeight: 700 }}>
                          {msg.status === "sent" && "✓"}
                          {msg.status === "delivered" && "✓✓"}
                          {msg.status === "seen" && "✓✓ (Seen)"}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <form onSubmit={handleSendMessage} style={{ padding: "0.75rem 1rem", borderTop: "1px solid #e2e8f0", display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input 
                type="text" 
                placeholder={`Type secure message to ${selectedPeer}...`}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                style={{ flex: 1, padding: "0.6rem 0.9rem", borderRadius: "6px", border: "1px solid #cbd5e1", outline: "none", fontSize: "0.85rem" }}
              />
              <button 
                type="button" 
                onClick={() => {
                  setIsRecording(!isRecording);
                  setTimeout(() => {
                    const voiceMsg: Message = { id: Date.now().toString(), sender: "You", text: "🎤 [Voice Note - 0:14]", timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), status: "sent" };
                    setMessages(p => ({ ...p, [selectedPeer]: [...(p[selectedPeer] || []), voiceMsg] }));
                    setIsRecording(false);
                  }, 1000);
                }}
                style={{ background: isRecording ? "#ef4444" : "#e2e8f0", border: "none", padding: "0.6rem 0.9rem", borderRadius: "6px", cursor: "pointer", fontSize: "0.85rem" }}
                title="Hold or Click to Record Voice Note"
              >
                {isRecording ? "🔴 Recording..." : "🎤"}
              </button>
              <button type="submit" style={{ background: "#0284c7", color: "#fff", border: "none", padding: "0.6rem 1.25rem", borderRadius: "6px", fontWeight: 700, cursor: "pointer", fontSize: "0.85rem" }}>Send</button>
            </form>
          </div>
        </div>
      )}

      {activeTab === "broadcast" && (
        <div style={{ background: "#fff", padding: "1.5rem", borderRadius: "10px", border: "1px solid #e2e8f0", flex: 1 }}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#0f172a", marginTop: 0 }}>Hospital-Wide Broadcast Dispatch</h2>
          <p style={{ fontSize: "0.8rem", color: "#64748b" }}>Send emergency or shift bulletins to all active clinical departments.</p>
          <textarea placeholder="Enter broadcast announcement..." style={{ width: "100%", height: "120px", padding: "0.75rem", borderRadius: "6px", border: "1px solid #cbd5e1", marginBottom: "1rem", boxSizing: "border-box" }} />
          <button onClick={() => alert("Broadcast dispatched to all hospital departments.")} style={{ background: "#0f172a", color: "#fff", border: "none", padding: "0.6rem 1.5rem", borderRadius: "6px", fontWeight: 700, cursor: "pointer" }}>Dispatch Broadcast</button>
        </div>
      )}

      {activeTab === "calls" && (
        <div style={{ background: "#fff", borderRadius: "10px", border: "1px solid #e2e8f0", overflow: "hidden", flex: 1 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: "#f1f5f9", textAlign: "left", color: "#475569" }}>
                <th style={{ padding: "0.75rem 1rem" }}>Staff Peer</th>
                <th style={{ padding: "0.75rem 1rem" }}>Call Type</th>
                <th style={{ padding: "0.75rem 1rem" }}>Duration</th>
                <th style={{ padding: "0.75rem 1rem" }}>Timestamp</th>
                <th style={{ padding: "0.75rem 1rem" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {callLogs.map((log) => (
                <tr key={log.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "0.75rem 1rem", fontWeight: 600, color: "#0f172a" }}>{log.peer}</td>
                  <td style={{ padding: "0.75rem 1rem" }}>{log.type}</td>
                  <td style={{ padding: "0.75rem 1rem", fontFamily: "monospace" }}>{log.duration}</td>
                  <td style={{ padding: "0.75rem 1rem", color: "#64748b" }}>{log.timestamp}</td>
                  <td style={{ padding: "0.75rem 1rem", color: "#16a34a", fontWeight: 600 }}>{log.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function tabStyle(active: boolean) {
  return {
    background: active ? "#0f172a" : "#e2e8f0",
    color: active ? "#fff" : "#334155",
    border: "none",
    padding: "0.5rem 1rem",
    borderRadius: "6px",
    fontWeight: 700,
    fontSize: "0.8rem",
    cursor: "pointer",
  };
}

function callBtnStyle(bg: string) {
  return {
    background: bg,
    color: "#fff",
    border: "none",
    padding: "0.4rem 0.75rem",
    borderRadius: "6px",
    fontSize: "0.75rem",
    fontWeight: 700,
    cursor: "pointer",
  };
}
