import { useCallback, useEffect, useState, type FormEvent } from "react";
import { theme, Button, Card, EmptyState, Input, PageHeader, TabNav, Textarea } from "@hims/ui";
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
      errors.push(
        staffRes.reason instanceof Error
          ? staffRes.reason.message
          : "Could not load the staff directory.",
      );
    }
    if (chRes.status === "fulfilled") {
      setChannels(chRes.value);
    } else {
      errors.push(
        chRes.reason instanceof Error ? chRes.reason.message : "Could not load channels.",
      );
    }
    if (annRes.status === "fulfilled") {
      setAnnouncements(annRes.value);
    } else {
      errors.push(
        annRes.reason instanceof Error ? annRes.reason.message : "Could not load announcements.",
      );
    }
    if (polRes.status === "fulfilled") {
      setPolicy(polRes.value);
    } else {
      errors.push(
        polRes.reason instanceof Error ? polRes.reason.message : "Could not load the comms policy.",
      );
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
        body: JSON.stringify({
          recipientId: selectedPeer.userId,
          body: dmInput.trim(),
          attachments: [],
        }),
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
      const msg = await apiFetch<Message>(
        `/communications/channels/${selectedChannel.id}/messages`,
        {
          method: "POST",
          body: JSON.stringify({ body: channelInput.trim(), attachments: [] }),
        },
      );
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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: theme.spacing["4"],
        height: "100%",
        boxSizing: "border-box",
      }}
    >
      <PageHeader
        title="Staff Communications"
        description="Governed secure messaging, channels, and broadcast announcements."
      />

      <TabNav
        tabs={[
          { key: "dm", label: "Direct Messages" },
          { key: "channels", label: "Channels" },
          { key: "broadcast", label: "Broadcasts" },
        ]}
        active={activeTab}
        onChange={(k) => setActiveTab(k as "dm" | "channels" | "broadcast")}
      />

      {policy && !policy.acknowledged && (
        <div
          style={{
            background: "#fffbeb",
            border: "1px solid #fcd34d",
            borderRadius: theme.radius.md,
            padding: `${theme.spacing["3"]} ${theme.spacing["4"]}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: theme.spacing["4"],
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: theme.fontSize.base, color: "#78350f" }}>
            <strong>Communications policy:</strong> {policy.notice} Messages are retained{" "}
            {policy.retentionDays} days.
          </div>
          <Button size="sm" style={{ background: theme.action.warning }} onClick={() => acknowledgePolicy()}>
            Acknowledge
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.danger }}>
          {error}
        </p>
      )}

      {loading && (
        <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>Loading communications…</p>
      )}

      {/* DM tab */}
      {!loading && activeTab === "dm" && (
        <PaneShell>
          <div style={dirPane}>
            <div style={dirHeader}>Hospital Staff Directory</div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {staff.length === 0 && (
                <p style={{ padding: theme.spacing["4"], fontSize: theme.fontSize.base, color: theme.text.muted }}>
                  No staff directory available.
                </p>
              )}
              {staff.map((s) => (
                <div
                  key={s.userId}
                  onClick={() => openThread(s)}
                  style={{
                    padding: `${theme.spacing["3"]} ${theme.spacing["4"]}`,
                    cursor: "pointer",
                    background: selectedPeer?.userId === s.userId ? theme.badge.aft.bg : "transparent",
                    borderBottom: `1px solid ${theme.surface.border}`,
                  }}
                >
                  <div
                    style={{
                      fontSize: theme.fontSize.base,
                      fontWeight: selectedPeer?.userId === s.userId ? theme.fontWeight.bold : theme.fontWeight.medium,
                      color: theme.text.primary,
                    }}
                  >
                    {s.firstName} {s.lastName}
                  </div>
                  <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                    {s.jobTitle || "Staff"} {s.departmentName ? `· ${s.departmentName}` : ""}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", background: theme.surface.card, minWidth: 0 }}>
            <div style={{ padding: `${theme.spacing["3"]} 1.25rem`, borderBottom: `1px solid ${theme.surface.border}` }}>
              <div style={{ fontWeight: theme.fontWeight.bold, fontSize: theme.fontSize.base, color: theme.text.primary }}>
                {selectedPeer ? `${selectedPeer.firstName} ${selectedPeer.lastName}` : "Select a staff member"}
              </div>
              <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>Secure Channel</div>
            </div>

            <div style={{ flex: 1, padding: theme.spacing["4"], overflowY: "auto", display: "flex", flexDirection: "column", gap: theme.spacing["3"] }}>
              {!selectedPeer && (
                <p style={{ color: theme.text.muted, fontSize: theme.fontSize.base }}>
                  Choose a recipient from the directory to start messaging.
                </p>
              )}
              {selectedPeer && messages.length === 0 && (
                <p style={{ color: theme.text.muted, fontSize: theme.fontSize.base }}>
                  No messages yet in this conversation.
                </p>
              )}
              {selectedPeer &&
                messages.map((msg) => {
                  const isMe = msg.senderId !== selectedPeer.userId;
                  return (
                    <div key={msg.id} style={{ alignSelf: isMe ? "flex-end" : "flex-start", maxWidth: "70%" }}>
                      <div
                        style={{
                          background: isMe ? theme.badge.aft.bg : theme.surface.subtle,
                          padding: `${theme.spacing["2"]} 0.9rem`,
                          borderRadius: theme.radius.md,
                          fontSize: theme.fontSize.base,
                          color: theme.text.primary,
                        }}
                      >
                        {msg.body}
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end", fontSize: theme.fontSize.xs, color: theme.text.muted, marginTop: "2px" }}>
                        <span>
                          {isMe ? `${msg.senderName} · ` : ""}
                          {new Date(msg.createdAt).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>

            <form
              onSubmit={sendDm}
              style={{
                padding: `${theme.spacing["3"]} ${theme.spacing["4"]}`,
                borderTop: `1px solid ${theme.surface.border}`,
                display: "flex",
                gap: theme.spacing["2"],
                alignItems: "center",
              }}
            >
              <Input
                type="text"
                placeholder={selectedPeer ? `Type secure message to ${selectedPeer.firstName}...` : "Select a recipient first"}
                value={dmInput}
                disabled={!selectedPeer}
                onChange={(e) => setDmInput(e.target.value)}
                style={{ flex: 1 }}
              />
              <Button type="submit" disabled={!selectedPeer}>
                Send
              </Button>
            </form>
          </div>
        </PaneShell>
      )}

      {/* Channels tab */}
      {!loading && activeTab === "channels" && (
        <PaneShell>
          <div style={dirPane}>
            <div style={dirHeader}>Hospital Channels</div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {channels.length === 0 && (
                <p style={{ padding: theme.spacing["4"], fontSize: theme.fontSize.base, color: theme.text.muted }}>
                  No channels available.
                </p>
              )}
              {channels.map((ch) => (
                <div
                  key={ch.id}
                  onClick={() => openChannel(ch)}
                  style={{
                    padding: `${theme.spacing["3"]} ${theme.spacing["4"]}`,
                    cursor: "pointer",
                    background: selectedChannel?.id === ch.id ? theme.badge.aft.bg : "transparent",
                    borderBottom: `1px solid ${theme.surface.border}`,
                  }}
                >
                  <div style={{ fontSize: theme.fontSize.base, fontWeight: selectedChannel?.id === ch.id ? theme.fontWeight.bold : theme.fontWeight.medium, color: theme.text.primary }}>
                    #{ch.name}
                  </div>
                  <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>
                    {ch.type.toUpperCase()} · {ch.memberCount} members{ch.isMember ? " · member" : ""}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", background: theme.surface.card, minWidth: 0 }}>
            <div style={{ padding: `${theme.spacing["3"]} 1.25rem`, borderBottom: `1px solid ${theme.surface.border}` }}>
              <div style={{ fontWeight: theme.fontWeight.bold, fontSize: theme.fontSize.base, color: theme.text.primary }}>
                {selectedChannel ? `#${selectedChannel.name}` : "Select a channel"}
              </div>
              {selectedChannel?.description && (
                <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>{selectedChannel.description}</div>
              )}
            </div>

            <div style={{ flex: 1, padding: theme.spacing["4"], overflowY: "auto", display: "flex", flexDirection: "column", gap: theme.spacing["3"] }}>
              {!selectedChannel && (
                <p style={{ color: theme.text.muted, fontSize: theme.fontSize.base }}>Choose a channel to view its messages.</p>
              )}
              {selectedChannel && channelMessages.length === 0 && (
                <p style={{ color: theme.text.muted, fontSize: theme.fontSize.base }}>No messages yet in this channel.</p>
              )}
              {selectedChannel &&
                channelMessages.map((msg) => (
                  <div key={msg.id} style={{ maxWidth: "80%" }}>
                    <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, marginBottom: "2px" }}>
                      <strong>{msg.senderName}</strong> · {new Date(msg.createdAt).toLocaleString()}
                    </div>
                    <div
                      style={{
                        background: theme.surface.subtle,
                        padding: `${theme.spacing["2"]} 0.9rem`,
                        borderRadius: theme.radius.md,
                        fontSize: theme.fontSize.base,
                        color: theme.text.primary,
                      }}
                    >
                      {msg.body}
                    </div>
                  </div>
                ))}
            </div>

            <form
              onSubmit={sendChannelMessage}
              style={{
                padding: `${theme.spacing["3"]} ${theme.spacing["4"]}`,
                borderTop: `1px solid ${theme.surface.border}`,
                display: "flex",
                gap: theme.spacing["2"],
                alignItems: "center",
              }}
            >
              <Input
                type="text"
                placeholder={selectedChannel ? `Message #${selectedChannel.name}...` : "Select a channel first"}
                value={channelInput}
                disabled={!selectedChannel || !selectedChannel.isMember}
                onChange={(e) => setChannelInput(e.target.value)}
                style={{ flex: 1 }}
              />
              <Button type="submit" disabled={!selectedChannel || !selectedChannel.isMember}>
                Send
              </Button>
            </form>
          </div>
        </PaneShell>
      )}

      {/* Broadcast tab */}
      {!loading && activeTab === "broadcast" && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}>
          <Card title="Hospital-Wide Broadcast Dispatch" hint="Send emergency or shift bulletins to all active staff.">
            <form onSubmit={handleBroadcast} style={{ display: "flex", flexDirection: "column", gap: theme.spacing["3"], maxWidth: 720 }}>
              <Textarea
                placeholder="Enter broadcast announcement..."
                value={broadcastInput}
                onChange={(e) => setBroadcastInput(e.target.value)}
                style={{ height: 120 }}
              />
              <div>
                <Button type="submit">Dispatch Broadcast</Button>
              </div>
            </form>
          </Card>

          <Card title="Recent Announcements" bodyStyle={{ padding: 0 }}>
            {announcements.length === 0 ? (
              <EmptyState icon="chat" description="No announcements yet." />
            ) : (
              <div>
                {announcements.map((a) => (
                  <div key={a.id} style={{ padding: `${theme.spacing["3"]} 1.25rem`, borderBottom: `1px solid ${theme.surface.border}` }}>
                    <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, marginBottom: "0.2rem" }}>
                      <strong>{a.senderName}</strong> · {new Date(a.createdAt).toLocaleString()}
                    </div>
                    <div style={{ fontSize: theme.fontSize.base, color: theme.text.primary }}>{a.body}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function PaneShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flex: 1,
        background: theme.surface.card,
        borderRadius: theme.radius.lg,
        border: `1px solid ${theme.surface.border}`,
        overflow: "hidden",
        minHeight: 420,
      }}
    >
      {children}
    </div>
  );
}

const dirPane = {
  width: 280,
  borderRight: `1px solid ${theme.surface.border}`,
  display: "flex",
  flexDirection: "column",
  background: theme.surface.subtle,
  flexShrink: 0,
} as const;

const dirHeader = {
  padding: theme.spacing["4"],
  borderBottom: `1px solid ${theme.surface.border}`,
  fontWeight: theme.fontWeight.bold,
  fontSize: theme.fontSize.base,
  color: theme.text.secondary,
} as const;
