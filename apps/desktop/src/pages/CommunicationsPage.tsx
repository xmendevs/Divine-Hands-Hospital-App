import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { apiFetch } from "../api/client";

interface Staff {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  departmentName: string;
}

interface Message {
  id: string;
  kind: string;
  senderId: string;
  senderName: string;
  recipientId?: string;
  channelId?: string;
  channelName: string;
  body: string;
  createdAt: string;
}

interface Channel {
  id: string;
  name: string;
  type: string;
  description: string;
  memberCount: number;
  isMember: boolean;
}

interface CommsPolicy {
  notice: string;
  retentionDays: number;
  acknowledged: boolean;
}

export default function CommunicationsPage() {
  const [activeTab, setActiveTab] = useState<"dm" | "channels" | "broadcast">("dm");

  const [staff, setStaff] = useState<Staff[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [announcements, setAnnouncements] = useState<Message[]>([]);
  const [policy, setPolicy] = useState<CommsPolicy | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // DM state.
  const [selectedPeer, setSelectedPeer] = useState<Staff | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [dmInput, setDmInput] = useState("");
  const [dmThread, setDmThread] = useState<Record<string, Message[]>>({});

  // Channel state.
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [channelMessages, setChannelMessages] = useState<Message[]>([]);
  const [channelInput, setChannelInput] = useState("");

  // Broadcast state.
  const [broadcastInput, setBroadcastInput] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [staffRes, chRes, annRes, polRes] = await Promise.allSettled([
      apiFetch<Staff[]>("/staff"),
      apiFetch<Channel[]>("/communications/channels"),
      apiFetch<Message[]>("/communications/announcements"),
      apiFetch<CommsPolicy>("/communications/policy"),
    ]);
    const errors: string[] = [];
    if (staffRes.status === "fulfilled") {
      setStaff(staffRes.value);
    } else {
      errors.push(staffRes.reason instanceof Error ? staffRes.reason.message : "Could not load the staff directory.");
    }
    if (chRes.status === "fulfilled") {
      setChannels(chRes.value);
    } else {
      errors.push(chRes.reason instanceof Error ? chRes.reason.message : "Could not load channels.");
    }
    if (annRes.status === "fulfilled") {
      setAnnouncements(annRes.value);
    } else {
      errors.push(annRes.reason instanceof Error ? annRes.reason.message : "Could not load announcements.");
    }
    if (polRes.status === "fulfilled") {
      setPolicy(polRes.value);
    } else {
      errors.push(polRes.reason instanceof Error ? polRes.reason.message : "Could not load the comms policy.");
    }
    setError(errors.join(" "));
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function openThread(peer: Staff) {
    setSelectedPeer(peer);
    setDmInput("");
    setError("");
    const cached = dmThread[peer.userId];
    if (cached) {
      setMessages(cached);
      return;
    }
    try {
      const msgs = await apiFetch<Message[]>(`/communications/messages?recipientId=${peer.userId}`);
      setMessages(msgs);
      setDmThread((prev) => ({ ...prev, [peer.userId]: msgs }));
    } catch (err) {
      setMessages([]);
      setError(err instanceof Error ? err.message : "Could not load the conversation.");
    }
  }

  async function sendDm(e: FormEvent) {
    e.preventDefault();
    if (!selectedPeer || !dmInput.trim()) return;
    setError("");
    try {
      const msg = await apiFetch<Message>("/communications/messages", {
        method: "POST",
        body: JSON.stringify({ recipientId: selectedPeer.userId, body: dmInput.trim(), attachments: [] }),
      });
      setDmInput("");
      const updated = [...messages, msg];
      setMessages(updated);
      setDmThread((prev) => ({ ...prev, [selectedPeer.userId]: updated }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the message.");
    }
  }

  async function openChannel(ch: Channel) {
    setSelectedChannel(ch);
    setChannelInput("");
    setError("");
    try {
      const msgs = await apiFetch<Message[]>(`/communications/channels/${ch.id}/messages`);
      setChannelMessages(msgs);
    } catch (err) {
      setChannelMessages([]);
      setError(err instanceof Error ? err.message : "Could not load channel messages.");
    }
  }

  async function sendChannelMessage(e: FormEvent) {
    e.preventDefault();
    if (!selectedChannel || !channelInput.trim()) return;
    setError("");
    try {
      const msg = await apiFetch<Message>(`/communications/channels/${selectedChannel.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: channelInput.trim(), attachments: [] }),
      });
      setChannelInput("");
      setChannelMessages((prev) => [...prev, msg]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the message.");
    }
  }

  async function handleBroadcast(e: FormEvent) {
    e.preventDefault();
    if (!broadcastInput.trim()) return;
    setError("");
    try {
      await apiFetch<unknown>("/communications/announcements", {
        method: "POST",
        body: JSON.stringify({ body: broadcastInput.trim(), channelId: "" }),
      });
      setBroadcastInput("");
      const updated = await apiFetch<Message[]>("/communications/announcements");
      setAnnouncements(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post the announcement.");
    }
  }

  async function acknowledgePolicy() {
    setError("");
    try {
      await apiFetch<unknown>("/communications/policy/acknowledge", { method: "POST" });
      setPolicy((prev) => (prev ? { ...prev, acknowledged: true } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not acknowledge the policy.");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", height: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0f172a", margin: 0 }}>Staff Communications</h1>
          <p style={{ fontSize: "0.85rem", color: "#64748b", margin: 0 }}>
            Governed secure messaging, channels, and broadcast announcements.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button onClick={() => setActiveTab("dm")} style={tabStyle(activeTab === "dm")}>Direct Messages</button>
          <button onClick={() => setActiveTab("channels")} style={tabStyle(activeTab === "channels")}>Channels</button>
          <button onClick={() => setActiveTab("broadcast")} style={tabStyle(activeTab === "broadcast")}>Broadcasts</button>
        </div>
      </div>

      {policy && !policy.acknowledged && (
        <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "8px", padding: "0.85rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
          <div style={{ fontSize: "0.85rem", color: "#78350f" }}>
            <strong>Communications policy:</strong> {policy.notice} Messages are retained {policy.retentionDays} days.
          </div>
          <button onClick={() => acknowledgePolicy()} style={actionBtn("#b45309")}>Acknowledge</button>
        </div>
      )}

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: "0.85rem", color: "#b91c1c" }}>
          {error}
        </p>
      )}

      {loading && <p style={{ margin: 0, fontSize: "0.9rem", color: "#64748b" }}>Loading communications…</p>}

      {/* DM tab */}
      {!loading && activeTab === "dm" && (
        <div style={{ display: "flex", flex: 1, background: "#fff", borderRadius: "10px", border: "1px solid #e2e8f0", overflow: "hidden", minHeight: 420 }}>
          <div style={{ width: "280px", borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column", background: "#f8fafc", flexShrink: 0 }}>
            <div style={{ padding: "1rem", borderBottom: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.85rem", color: "#334155" }}>
              Hospital Staff Directory
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {staff.length === 0 && <p style={{ padding: "1rem", fontSize: "0.8rem", color: "#64748b" }}>No staff directory available.</p>}
              {staff.map((s) => (
                <div
                  key={s.userId}
                  onClick={() => openThread(s)}
                  style={{
                    padding: "0.75rem 1rem",
                    cursor: "pointer",
                    background: selectedPeer?.userId === s.userId ? "#e0f2fe" : "transparent",
                    borderBottom: "1px solid #f1f5f9",
                  }}
                >
                  <div style={{ fontSize: "0.85rem", fontWeight: selectedPeer?.userId === s.userId ? 700 : 500, color: "#1e293b" }}>
                    {s.firstName} {s.lastName}
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "#64748b" }}>
                    {s.jobTitle || "Staff"} {s.departmentName ? `· ${s.departmentName}` : ""}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#fff", minWidth: 0 }}>
            <div style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid #e2e8f0" }}>
              <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "#0f172a" }}>
                {selectedPeer ? `${selectedPeer.firstName} ${selectedPeer.lastName}` : "Select a staff member"}
              </div>
              <div style={{ fontSize: "0.7rem", color: "#64748b" }}>Secure Channel</div>
            </div>

            <div style={{ flex: 1, padding: "1rem", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {!selectedPeer && <p style={{ color: "#64748b", fontSize: "0.85rem" }}>Choose a recipient from the directory to start messaging.</p>}
              {selectedPeer && messages.length === 0 && <p style={{ color: "#64748b", fontSize: "0.85rem" }}>No messages yet in this conversation.</p>}
              {selectedPeer &&
                messages.map((msg) => {
                  const isMe = msg.senderId !== selectedPeer.userId;
                  return (
                    <div key={msg.id} style={{ alignSelf: isMe ? "flex-end" : "flex-start", maxWidth: "70%" }}>
                      <div style={{ background: isMe ? "#bae6fd" : "#f1f5f9", padding: "0.65rem 0.9rem", borderRadius: "8px", fontSize: "0.85rem", color: "#0f172a" }}>
                        {msg.body}
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end", fontSize: "0.65rem", color: "#64748b", marginTop: "2px" }}>
                        <span>{isMe ? `${msg.senderName} · ` : ""}{new Date(msg.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                  );
                })}
            </div>

            <form onSubmit={sendDm} style={{ padding: "0.75rem 1rem", borderTop: "1px solid #e2e8f0", display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="text"
                placeholder={selectedPeer ? `Type secure message to ${selectedPeer.firstName}...` : "Select a recipient first"}
                value={dmInput}
                disabled={!selectedPeer}
                onChange={(e) => setDmInput(e.target.value)}
                style={{ flex: 1, padding: "0.6rem 0.9rem", borderRadius: "6px", border: "1px solid #cbd5e1", outline: "none", fontSize: "0.85rem" }}
              />
              <button type="submit" disabled={!selectedPeer} style={sendBtn}>Send</button>
            </form>
          </div>
        </div>
      )}

      {/* Channels tab */}
      {!loading && activeTab === "channels" && (
        <div style={{ display: "flex", flex: 1, background: "#fff", borderRadius: "10px", border: "1px solid #e2e8f0", overflow: "hidden", minHeight: 420 }}>
          <div style={{ width: "280px", borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column", background: "#f8fafc", flexShrink: 0 }}>
            <div style={{ padding: "1rem", borderBottom: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.85rem", color: "#334155" }}>
              Hospital Channels
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {channels.length === 0 && <p style={{ padding: "1rem", fontSize: "0.8rem", color: "#64748b" }}>No channels available.</p>}
              {channels.map((ch) => (
                <div
                  key={ch.id}
                  onClick={() => openChannel(ch)}
                  style={{
                    padding: "0.75rem 1rem",
                    cursor: "pointer",
                    background: selectedChannel?.id === ch.id ? "#e0f2fe" : "transparent",
                    borderBottom: "1px solid #f1f5f9",
                  }}
                >
                  <div style={{ fontSize: "0.85rem", fontWeight: selectedChannel?.id === ch.id ? 700 : 500, color: "#1e293b" }}>
                    #{ch.name}
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "#64748b" }}>
                    {ch.type.toUpperCase()} · {ch.memberCount} members{ch.isMember ? " · member" : ""}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#fff", minWidth: 0 }}>
            <div style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid #e2e8f0" }}>
              <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "#0f172a" }}>
                {selectedChannel ? `#${selectedChannel.name}` : "Select a channel"}
              </div>
              {selectedChannel?.description && <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{selectedChannel.description}</div>}
            </div>

            <div style={{ flex: 1, padding: "1rem", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {!selectedChannel && <p style={{ color: "#64748b", fontSize: "0.85rem" }}>Choose a channel to view its messages.</p>}
              {selectedChannel && channelMessages.length === 0 && (
                <p style={{ color: "#64748b", fontSize: "0.85rem" }}>No messages yet in this channel.</p>
              )}
              {selectedChannel &&
                channelMessages.map((msg) => (
                  <div key={msg.id} style={{ maxWidth: "80%" }}>
                    <div style={{ fontSize: "0.7rem", color: "#64748b", marginBottom: "2px" }}>
                      <strong>{msg.senderName}</strong> · {new Date(msg.createdAt).toLocaleString()}
                    </div>
                    <div style={{ background: "#f1f5f9", padding: "0.65rem 0.9rem", borderRadius: "8px", fontSize: "0.85rem", color: "#0f172a" }}>
                      {msg.body}
                    </div>
                  </div>
                ))}
            </div>

            <form onSubmit={sendChannelMessage} style={{ padding: "0.75rem 1rem", borderTop: "1px solid #e2e8f0", display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="text"
                placeholder={selectedChannel ? `Message #${selectedChannel.name}...` : "Select a channel first"}
                value={channelInput}
                disabled={!selectedChannel || !selectedChannel.isMember}
                onChange={(e) => setChannelInput(e.target.value)}
                style={{ flex: 1, padding: "0.6rem 0.9rem", borderRadius: "6px", border: "1px solid #cbd5e1", outline: "none", fontSize: "0.85rem" }}
              />
              <button type="submit" disabled={!selectedChannel || !selectedChannel.isMember} style={sendBtn}>Send</button>
            </form>
          </div>
        </div>
      )}

      {/* Broadcast tab */}
      {!loading && activeTab === "broadcast" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <form onSubmit={handleBroadcast} style={{ background: "#fff", padding: "1.5rem", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#0f172a", marginTop: 0 }}>Hospital-Wide Broadcast Dispatch</h2>
            <p style={{ fontSize: "0.8rem", color: "#64748b" }}>Send emergency or shift bulletins to all active staff.</p>
            <textarea
              placeholder="Enter broadcast announcement..."
              value={broadcastInput}
              onChange={(e) => setBroadcastInput(e.target.value)}
              style={{ width: "100%", height: "120px", padding: "0.75rem", borderRadius: "6px", border: "1px solid #cbd5e1", marginBottom: "1rem", boxSizing: "border-box" }}
            />
            <button type="submit" style={{ background: "#0f172a", color: "#fff", border: "none", padding: "0.6rem 1.5rem", borderRadius: "6px", fontWeight: 700, cursor: "pointer" }}>
              Dispatch Broadcast
            </button>
          </form>

          <div style={{ background: "#fff", borderRadius: "10px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
            <div style={{ padding: "0.85rem 1.25rem", borderBottom: "1px solid #e2e8f0", fontWeight: 700, color: "#334155", fontSize: "0.85rem" }}>
              RECENT ANNOUNCEMENTS
            </div>
            {announcements.length === 0 && <p style={{ padding: "1rem", color: "#64748b", fontSize: "0.85rem", margin: 0 }}>No announcements yet.</p>}
            {announcements.map((a) => (
              <div key={a.id} style={{ padding: "0.85rem 1.25rem", borderBottom: "1px solid #f1f5f9" }}>
                <div style={{ fontSize: "0.7rem", color: "#64748b", marginBottom: "0.2rem" }}>
                  <strong>{a.senderName}</strong> · {new Date(a.createdAt).toLocaleString()}
                </div>
                <div style={{ fontSize: "0.9rem", color: "#1e293b" }}>{a.body}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function tabStyle(active: boolean): CSSProperties {
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

const sendBtn: CSSProperties = { background: "#0284c7", color: "#fff", border: "none", padding: "0.6rem 1.25rem", borderRadius: "6px", fontWeight: 700, cursor: "pointer", fontSize: "0.85rem" };
const actionBtn = (bg: string): CSSProperties => ({ padding: "0.4rem 0.9rem", background: bg, color: "#fff", border: "none", borderRadius: "6px", fontWeight: 700, cursor: "pointer", fontSize: "0.8rem" });
