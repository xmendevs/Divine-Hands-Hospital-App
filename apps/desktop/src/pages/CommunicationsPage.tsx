import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  theme,
  Button,
  Card,
  EmptyState,
  FormField,
  Input,
  Modal,
  PageHeader,
  Select,
  TabNav,
  Textarea,
  useToast,
} from "@hims/ui";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import VoiceRecorder from "../components/VoiceRecorder";
import VoiceNotePlayer from "../components/VoiceNotePlayer";
import CallModal from "../components/CallModal";
import FileAttachmentPicker, { type SelectedFile } from "../components/FileAttachmentPicker";
import FilePreviewCard from "../components/FilePreviewCard";
import LiveBroadcastModal from "../components/LiveBroadcastModal";
import { useNotifications } from "../notifications/NotificationContext";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Staff {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  departmentName: string;
  roles?: string[];
}

interface Message {
  id: string;
  kind: string;
  senderId: string;
  senderName: string;
  senderUsername: string;
  recipientId?: string;
  recipientName?: string;
  channelId?: string;
  channelName?: string;
  body: string;
  priority: string;
  replyToId?: string;
  editedAt?: string;
  isDeleted: boolean;
  createdAt: string;
  attachments: { id: string; fileName: string; mimeType: string; sizeBytes: number; storageRef?: string }[];
  readBy?: string[];
  replyCount?: number;
  status?: "sent" | "delivered" | "read"; // local UI status for outgoing DMs
}

interface Channel {
  id: string;
  name: string;
  type: string;
  departmentId?: string;
  shiftId?: string;
  departmentName?: string;
  shiftName?: string;
  description: string;
  createdBy: string;
  createdAt: string;
  memberCount: number;
  isMember: boolean;
  isReadOnly?: boolean;
  isArchived?: boolean;
  unreadCount?: number;
}

interface UnreadCounts {
  dm: Record<string, number>;
  channels: Record<string, number>;
  total: number;
}

interface CommsPolicy {
  notice: string;
  retentionDays: number;
  acknowledged: boolean;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const priorityColors: Record<string, { bg: string; text: string; label: string }> = {
  normal: { bg: "#166534", text: "#dcfce7", label: "Normal" },
  urgent: { bg: "#92400e", text: "#fef3c7", label: "Urgent" },
  critical: { bg: "#991b1b", text: "#fee2e2", label: "Critical" },
};

const ROLE_DISPLAY_NAMES: Record<string, string> = {
  super_admin: "Super Admin",
  doctor: "Doctor",
  nurse: "Nurse",
  matron: "Matron",
  pharmacist: "Pharmacist",
  cashier: "Cashier",
  lab_technician: "Lab Tech",
  lab_supervisor: "Lab Supervisor",
  receptionist: "Receptionist",
  admin: "Admin",
};

const ROLE_COLORS: Record<string, string> = {
  super_admin: "#ef4444",
  doctor: "#60a5fa",
  nurse: "#a78bfa",
  matron: "#e879f9",
  pharmacist: "#34d399",
  cashier: "#fbbf24",
  lab_technician: "#f87171",
  lab_supervisor: "#fb923c",
  receptionist: "#94a3b8",
  admin: "#f59e0b",
};

function roleDisplayName(roleCode: string): string {
  return ROLE_DISPLAY_NAMES[roleCode] || roleCode.replace(/_/g, " ");
}

function roleColor(roleCode: string): string {
  return ROLE_COLORS[roleCode] || "#94a3b8";
}

/** Extract stored duration (seconds) from a voice note body like "[Voice Note 14s]" */
function extractVoiceNoteDuration(body: string): number | undefined {
  const m = body.match(/\[(?:Voice Note|Voice Broadcast)\s+(\d+)s\]/);
  return m ? parseInt(m[1], 10) : undefined;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString();
}

function messagePreview(body: string, maxLen = 60) {
  if (body.length <= maxLen) return body;
  return body.slice(0, maxLen) + "...";
}

/** Sort messages oldest-first (ascending by timestamp). */
function sortAsc(msgs: Message[]): Message[] {
  return [...msgs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

/** WhatsApp-style read receipt ticks for outgoing messages. */
function ReadReceipt({ status }: { status?: string }) {
  if (!status) return null;
  if (status === "sent") {
    return <span style={{ fontSize: 13, color: "#9ca3af", marginLeft: 4, lineHeight: 1 }}>&#10003;</span>;
  }
  if (status === "delivered") {
    return <span style={{ fontSize: 13, color: "#9ca3af", marginLeft: 4, lineHeight: 1 }}>&#10003;&#10003;</span>;
  }
  // read
  return <span style={{ fontSize: 13, color: "#3b82f6", marginLeft: 4, lineHeight: 1 }}>&#10003;&#10003;</span>;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function CommunicationsPage() {
  const { me } = useAuth();
  const [activeTab, setActiveTab] = useState<"dm" | "channels" | "broadcast" | "calls" | "search" | "notifications">("dm");
  const toast = useToast();
  const notif = useNotifications();

  /* Shared state */
  const [staff, setStaff] = useState<Staff[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [announcements, setAnnouncements] = useState<Message[]>([]);
  const [policy, setPolicy] = useState<CommsPolicy | null>(null);
  const [unread, setUnread] = useState<UnreadCounts>({ dm: {}, channels: {}, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /* DM state */
  const [selectedPeer, setSelectedPeer] = useState<Staff | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [dmInput, setDmInput] = useState("");
  const [dmPriority, setDmPriority] = useState("normal");
  const [dmTyping, setDmTyping] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [dmThread, setDmThread] = useState<Record<string, Message[]>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Channel state */
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [channelMessages, setChannelMessages] = useState<Message[]>([]);
  const [channelInput, setChannelInput] = useState("");
  const channelTyping = false;

  /* Broadcast state */
  const [broadcastInput, setBroadcastInput] = useState("");
  const [broadcastPriority, setBroadcastPriority] = useState("normal");

  /* Search state */
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Message[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  /* Notification state */
  const [notifPrefs, setNotifPrefs] = useState({ inApp: true, sound: true, desktop: true });

  /* Create channel modal */
  const [createChOpen, setCreateChOpen] = useState(false);
  const [newChName, setNewChName] = useState("");
  const [newChType, setNewChType] = useState("department");
  const [newChDept, setNewChDept] = useState("");
  const [newChDesc, setNewChDesc] = useState("");

  /* Message context menu */
  const [ctxMenu, setCtxMenu] = useState<{ msg: Message; x: number; y: number } | null>(null);
  const [editModal, setEditModal] = useState<{ msg: Message; body: string } | null>(null);

  /* Thread view */
  const [threadParent, setThreadParent] = useState<Message | null>(null);
  const [threadReplies, setThreadReplies] = useState<Message[]>([]);

  /* Voice note state */
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [recordingBroadcastVoice, setRecordingBroadcastVoice] = useState(false);

  /* Staff filter */
  const [staffFilter, setStaffFilter] = useState("");

  /* File attachment state */
  const [dmAttachments, setDmAttachments] = useState<SelectedFile[]>([]);
  const [broadcastAttachments, setBroadcastAttachments] = useState<SelectedFile[]>([]);

  /* Live broadcast state */
  const [liveBroadcastOpen, setLiveBroadcastOpen] = useState(false);
  const [liveBroadcastType, setLiveBroadcastType] = useState<"voice" | "video">("voice");

  /* Call state */
  const [callOpen, setCallOpen] = useState(false);
  const [callType, setCallType] = useState<"voice" | "video">("voice");
  const [activeCallId, setActiveCallId] = useState<string | null>(null);

  /* Call logs */
  const [callLogs, setCallLogs] = useState<any[]>([]);
  const [callLogsLoading, setCallLogsLoading] = useState(false);

  /* ---------------------------------------------------------------- */
  /*  Load data                                                        */
  /* ---------------------------------------------------------------- */

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [staffRes, chRes, annRes, polRes, unreadRes] = await Promise.allSettled([
      apiFetch<Staff[]>("/staff"),
      apiFetch<Channel[]>("/communications/channels"),
      apiFetch<Message[]>("/communications/announcements"),
      apiFetch<CommsPolicy>("/communications/policy"),
      apiFetch<UnreadCounts>("/communications/unread"),
    ]);
    if (staffRes.status === "fulfilled") setStaff(staffRes.value);
    if (chRes.status === "fulfilled") setChannels(chRes.value);
    if (annRes.status === "fulfilled") setAnnouncements(annRes.value);
    if (polRes.status === "fulfilled") setPolicy(polRes.value);
    if (unreadRes.status === "fulfilled") setUnread(unreadRes.value);
    setLoading(false);
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  /* Poll unread every 15s */
  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const u = await apiFetch<UnreadCounts>("/communications/unread");
        setUnread(u);
      } catch { /* noop */ }
    }, 15000);
    return () => clearInterval(iv);
  }, []);

  /* ---------------------------------------------------------------- */
  /*  DM functions                                                     */
  /* ---------------------------------------------------------------- */

  async function openThread(peer: Staff) {
    setSelectedPeer(peer);
    setDmInput("");
    setDmPriority("normal");
    setReplyTo(null);
    setError("");
    const cached = dmThread[peer.userId];
    if (cached) {
      setMessages(sortAsc(cached));
    } else {
      try {
        const msgs = await apiFetch<Message[]>(`/communications/messages?recipientId=${peer.userId}`);
        const sorted = sortAsc(msgs);
        setMessages(sorted);
        setDmThread((prev) => ({ ...prev, [peer.userId]: sorted }));
      } catch {
        setMessages([]);
      }
    }
    // Mark as read -- send peerId so the backend knows which DM thread to clear
    try {
      await apiFetch(`/communications/conversations/read?peerId=${peer.userId}`, { method: "POST" });
    } catch { /* noop */ }
    setUnread((prev) => ({
      ...prev,
      total: Math.max(0, prev.total - (prev.dm[peer.userId] || 0)),
      dm: { ...prev.dm, [peer.userId]: 0 },
    }));
    // Scroll to bottom after load
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "auto" }), 100);
  }

  async function sendDm(e: FormEvent) {
    e.preventDefault();
    if (!selectedPeer || (!dmInput.trim() && dmAttachments.length === 0)) return;
    setError("");
    try {
      const atts = dmAttachments.map((f) => ({
        fileName: f.fileName,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        storageRef: f.dataUrl,
      }));
      const bodyText = dmInput.trim() || (atts.length > 0 ? `Shared ${atts.length} file(s)` : "");
      const payload: Record<string, unknown> = {
        recipientId: selectedPeer.userId,
        body: bodyText,
        priority: dmPriority,
        attachments: atts,
      };
      if (replyTo) payload.replyToId = replyTo.id;
      const msg = await apiFetch<Message>("/communications/messages", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      // Start with "sent" status, simulate delivery then read
      const sentMsg: Message = { ...msg, status: "sent" };
      setDmInput("");
      setDmPriority("normal");
      setDmAttachments([]);
      setReplyTo(null);
      const updated = sortAsc([...messages, sentMsg]);
      setMessages(updated);
      setDmThread((prev) => ({ ...prev, [selectedPeer.userId]: updated }));
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

      // NOTE: DM notifications are delivered server-side to the recipient only.
      // The sender never sees a self-notification for their own sent message.

      // Simulate: sent -> delivered after 1s, delivered -> read after 2s
      setTimeout(() => {
        setMessages((prev) => {
          const next = prev.map((m) => m.id === sentMsg.id ? { ...m, status: "delivered" as const } : m);
          setDmThread((t) => ({ ...t, [selectedPeer.userId]: next }));
          return next;
        });
      }, 1000);
      setTimeout(() => {
        setMessages((prev) => {
          const next = prev.map((m) => m.id === sentMsg.id ? { ...m, status: "read" as const } : m);
          setDmThread((t) => ({ ...t, [selectedPeer.userId]: next }));
          return next;
        });
      }, 3000);
    } catch (err) {
      const m = err instanceof Error ? err.message : "Could not send the message.";
      setError(m);
      toast.error(m);
    }
  }

  async function sendVoiceNote(blob: Blob, durationSecs: number) {
    if (!selectedPeer) return;
    setRecordingVoice(false);
    try {
      // Convert blob to base64
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve) => {
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });

      const payload: Record<string, unknown> = {
        recipientId: selectedPeer.userId,
        body: `[Voice Note ${durationSecs}s]`,
        priority: "normal",
        attachments: [{
          fileName: `voice-note-${Date.now()}.webm`,
          mimeType: "audio/webm",
          sizeBytes: blob.size,
          storageRef: base64,
        }],
      };
      if (replyTo) payload.replyToId = replyTo.id;

      const msg = await apiFetch<Message>("/communications/messages", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      const sentMsg: Message = { ...msg, status: "sent" };
      setReplyTo(null);
      const updated = sortAsc([...messages, sentMsg]);
      setMessages(updated);
      setDmThread((prev) => ({ ...prev, [selectedPeer.userId]: updated }));
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

      // Simulate delivered -> read
      setTimeout(() => {
        setMessages((prev) => {
          const next = prev.map((m) => m.id === sentMsg.id ? { ...m, status: "delivered" as const } : m);
          setDmThread((t) => ({ ...t, [selectedPeer.userId]: next }));
          return next;
        });
      }, 1000);
      setTimeout(() => {
        setMessages((prev) => {
          const next = prev.map((m) => m.id === sentMsg.id ? { ...m, status: "read" as const } : m);
          setDmThread((t) => ({ ...t, [selectedPeer.userId]: next }));
          return next;
        });
      }, 3000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send voice note.");
    }
  }

  function handleDmTyping() {
    if (!selectedPeer || dmTyping) return;
    setDmTyping(true);
    apiFetch("/communications/typing", { method: "POST", body: JSON.stringify({ peerId: selectedPeer.userId }), headers: { "Content-Type": "application/json" } }).catch(() => {});
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => setDmTyping(false), 5000);
  }

  /* ---------------------------------------------------------------- */
  /*  Call functions                                                   */
  /* ---------------------------------------------------------------- */

  async function startCall(calleeId: string, ct: "voice" | "video") {
    try {
      const data = JSON.stringify({ calleeId, callType: ct });
      const res = await apiFetch<any>("/communications/calls", {
        method: "POST",
        body: data,
      });
      setActiveCallId(res.id);
      setCallType(ct);
      setCallOpen(true);
      // Push incoming call notification for the callee
      if (selectedPeer) {
        notif.push({
          kind: "call_incoming",
          title: `Incoming ${ct} call`,
          body: `${me?.username || "Someone"} is calling ${selectedPeer.firstName} ${selectedPeer.lastName}`,
          navigateTo: "communications",
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start call.");
    }
  }

  async function handleCallStateChange(callState: string, dur?: number) {
    if (!activeCallId) return;
    try {
      await apiFetch(`/communications/calls/${activeCallId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: callState === "ended" ? "answered" : callState, durationSeconds: dur || 0 }),
      });
    } catch { /* noop */ }
    // If missed or ended, post a message in the DM thread
    if ((callState === "missed" || callState === "rejected") && selectedPeer) {
      try {
        const label = callState === "missed" ? "Missed call" : "Call rejected";
        await apiFetch("/communications/messages", {
          method: "POST",
          body: JSON.stringify({
            recipientId: selectedPeer.userId,
            body: `[${label} - ${callType === "video" ? "Video" : "Voice"}]`,
            priority: "normal",
            attachments: [],
          }),
        });
        // Refresh the thread
        const msgs = await apiFetch<Message[]>(`/communications/messages?recipientId=${selectedPeer.userId}`);
        const sorted = sortAsc(msgs);
        setMessages(sorted);
        setDmThread((prev) => ({ ...prev, [selectedPeer.userId]: sorted }));
      } catch { /* noop */ }
    }
  }

  async function loadCallLogs() {
    setCallLogsLoading(true);
    try {
      const logs = await apiFetch<any[]>("/communications/calls");
      setCallLogs(logs);
    } catch {
      setCallLogs([]);
    }
    setCallLogsLoading(false);
  }

  /* ---------------------------------------------------------------- */
  /*  Channel functions                                                */
  /* ---------------------------------------------------------------- */

  async function openChannel(ch: Channel) {
    setSelectedChannel(ch);
    setChannelInput("");
    setError("");
    try {
      const msgs = await apiFetch<Message[]>(`/communications/channels/${ch.id}/messages`);
      setChannelMessages(sortAsc(msgs));
    } catch {
      setChannelMessages([]);
    }
    // Mark as read
    try { await apiFetch(`/communications/channels/${ch.id}/read`, { method: "POST" }); } catch { /* noop */ }
    setUnread((prev) => ({ ...prev, total: Math.max(0, prev.total - (prev.channels[ch.id] || 0)), channels: { ...prev.channels, [ch.id]: 0 } }));
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "auto" }), 100);
  }

  async function sendChannelMessage(e: FormEvent) {
    e.preventDefault();
    if (!selectedChannel || !channelInput.trim()) return;
    setError("");
    try {
      const body: Record<string, unknown> = { body: channelInput.trim(), attachments: [] };
      if (replyTo) body.replyToId = replyTo.id;
      const msg = await apiFetch<Message>(`/communications/channels/${selectedChannel.id}/messages`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setChannelInput("");
      setReplyTo(null);
      setChannelMessages((prev) => sortAsc([...prev, msg]));
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err) {
      const m = err instanceof Error ? err.message : "Could not send the message.";
      setError(m);
      toast.error(m);
    }
  }

  async function handleCreateChannel(e: FormEvent) {
    e.preventDefault();
    if (!newChName.trim()) return;
    try {
      await apiFetch("/communications/channels", {
        method: "POST",
        body: JSON.stringify({
          name: newChName.trim(),
          type: newChType,
          departmentId: newChDept || "",
          shiftId: "",
          description: newChDesc,
        }),
      });
      setCreateChOpen(false);
      setNewChName("");
      setNewChDept("");
      setNewChDesc("");
      toast.success("Channel created.");
      loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create channel.");
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Broadcast                                                        */
  /* ---------------------------------------------------------------- */

  async function handleBroadcast(e: FormEvent) {
    e.preventDefault();
    if (!broadcastInput.trim() && broadcastAttachments.length === 0) return;
    try {
      const atts = broadcastAttachments.map((f) => ({
        fileName: f.fileName,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        storageRef: f.dataUrl,
      }));
      const bodyText = broadcastInput.trim() || (atts.length > 0 ? `Shared ${atts.length} file(s)` : "");
      await apiFetch("/communications/announcements", {
        method: "POST",
        body: JSON.stringify({ body: bodyText, channelId: "", attachments: atts }),
      });
      setBroadcastInput("");
      setBroadcastPriority("normal");
      setBroadcastAttachments([]);
      const updated = await apiFetch<Message[]>("/communications/announcements");
      setAnnouncements(updated);
      toast.success("Broadcast dispatched to all staff.");
      // Push notification for all staff (including self for demo)
      notif.push({
        kind: "broadcast",
        title: `Broadcast from ${me?.username || "Admin"}`,
        body: bodyText.slice(0, 100),
        navigateTo: "communications",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not post.");
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Search                                                           */
  /* ---------------------------------------------------------------- */

  async function handleSearch(e?: FormEvent) {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    try {
      const results = await apiFetch<Message[]>(`/communications/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    }
    setSearchLoading(false);
  }

  /* ---------------------------------------------------------------- */
  /*  Message actions                                                  */
  /* ---------------------------------------------------------------- */

  async function handleEditMessage() {
    if (!editModal) return;
    try {
      await apiFetch(`/communications/messages/${editModal.msg.id}`, {
        method: "PATCH",
        body: JSON.stringify({ body: editModal.body }),
      });
      setEditModal(null);
      toast.success("Message edited.");
      // Refresh current view
      if (selectedPeer) openThread(selectedPeer);
      if (selectedChannel) openChannel(selectedChannel);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not edit.");
    }
  }

  async function handleDeleteMessage(msgId: string) {
    try {
      await apiFetch(`/communications/messages/${msgId}`, { method: "DELETE" });
      setCtxMenu(null);
      toast.success("Message deleted.");
      if (selectedPeer) openThread(selectedPeer);
      if (selectedChannel) openChannel(selectedChannel);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete.");
    }
  }

  async function openThreadReplies(msg: Message) {
    setThreadParent(msg);
    try {
      const replies = await apiFetch<Message[]>(`/communications/messages/${msg.id}/thread`);
      setThreadReplies(replies);
    } catch {
      setThreadReplies([]);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Notification prefs                                               */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    apiFetch<{ inApp: boolean; sound: boolean; desktop: boolean }>("/communications/notifications/prefs")
      .then(setNotifPrefs)
      .catch(() => {});
  }, []);

  async function saveNotifPrefs() {
    try {
      await apiFetch("/communications/notifications/prefs", {
        method: "PUT",
        body: JSON.stringify(notifPrefs),
      });
      toast.success("Notification preferences saved.");
    } catch {
      toast.error("Could not save preferences.");
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Scroll helper                                                    */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (selectedPeer || selectedChannel) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, channelMessages]);

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"], height: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <PageHeader title="Staff Communications" description="Secure messaging, channels, search, and broadcast announcements." />
        {unread.total > 0 && (
          <div style={{ background: theme.text.danger, color: "#fff", borderRadius: 999, padding: "4px 12px", fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.bold }}>
            {unread.total} unread
          </div>
        )}
      </div>

      <TabNav
        tabs={[
          { key: "dm", label: `Direct Messages${unread.total > 0 ? ` (${unread.total})` : ""}` },
          { key: "channels", label: "Channels" },
          { key: "broadcast", label: "Broadcasts" },
          { key: "calls", label: "Call Logs" },
          { key: "search", label: "Search" },
          { key: "notifications", label: "Notifications" },
        ]}
        active={activeTab}
        onChange={(k) => setActiveTab(k as typeof activeTab)}
      />

      {policy && !policy.acknowledged && (
        <div style={{ background: theme.surface.warning, border: `1px solid ${theme.surface.warningBorder}`, borderRadius: theme.radius.md, padding: `${theme.spacing["3"]} ${theme.spacing["4"]}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: theme.spacing["4"], flexWrap: "wrap" }}>
          <div style={{ fontSize: theme.fontSize.base, color: theme.text.warning }}>
            <strong>Communications policy:</strong> {policy.notice} Messages are retained {policy.retentionDays} days.
          </div>
          <Button size="sm" style={{ background: theme.action.warning }} onClick={() => { apiFetch("/communications/policy/acknowledge", { method: "POST" }).then(() => setPolicy((p) => p ? { ...p, acknowledged: true } : p)); }}>
            Acknowledge
          </Button>
        </div>
      )}

      {error && <p role="alert" style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.danger }}>{error}</p>}
      {loading && <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>Loading communications...</p>}

      {/* ============================================================ */}
      {/*  DM TAB                                                      */}
      {/* ============================================================ */}
      {!loading && activeTab === "dm" && (
        <PaneShell>
          {/* Staff Directory */}
          <div style={dirPane}>
            <div style={dirHeader}>Hospital Staff Directory</div>
            <div style={{ padding: `${theme.spacing["2"]} ${theme.spacing["3"]}` }}>
              <Input
                placeholder="Filter staff by name or role..."
                value={staffFilter}
                onChange={(e) => setStaffFilter(e.target.value)}
                style={{ width: "100%", fontSize: theme.fontSize.sm }}
              />
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {(() => {
                const filter = staffFilter.trim().toLowerCase();
                const filtered = filter
                  ? staff.filter((s) => {
                      const name = `${s.firstName} ${s.lastName}`.toLowerCase();
                      const role = (s.roles || []).join(" ").toLowerCase();
                      const dept = (s.departmentName || "").toLowerCase();
                      return name.includes(filter) || role.includes(filter) || dept.includes(filter);
                    })
                  : staff;
                if (filtered.length === 0) {
                  return (
                    <div style={{ padding: theme.spacing["4"], fontSize: theme.fontSize.sm, color: theme.text.muted, textAlign: "center" }}>
                      No staff match "{staffFilter}"
                    </div>
                  );
                }
                return filtered.map((s) => {
                  const unreadCount = unread.dm[s.userId] || 0;
                  const primaryRole = s.roles?.[0] || "";
                  const rc = roleColor(primaryRole);
                  const rd = roleDisplayName(primaryRole);
                  return (
                    <div
                      key={s.userId}
                      onClick={() => openThread(s)}
                      style={{
                        padding: `${theme.spacing["2"]} ${theme.spacing["3"]}`,
                        cursor: "pointer",
                        background: selectedPeer?.userId === s.userId ? theme.badge.aft.bg : "transparent",
                        borderBottom: `1px solid ${theme.surface.border}`,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: theme.spacing["2"],
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: theme.spacing["2"], marginBottom: 2 }}>
                          <div style={{
                            width: 28, height: 28, borderRadius: 999, flexShrink: 0,
                            background: `${rc}22`, border: `1.5px solid ${rc}`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 11, fontWeight: 700, color: rc,
                          }}>
                            {s.firstName[0]}{s.lastName[0]}
                          </div>
                          <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ fontSize: theme.fontSize.sm, fontWeight: selectedPeer?.userId === s.userId ? theme.fontWeight.bold : theme.fontWeight.medium, color: theme.text.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {s.firstName} {s.lastName}
                            </span>
                            {rd && (
                              <span style={{
                                fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4,
                                background: `${rc}22`, color: rc, lineHeight: 1.4, flexShrink: 0,
                              }}>
                                {rd}
                              </span>
                            )}
                          </div>
                        </div>
                        {(s.jobTitle || s.departmentName) && (
                          <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, paddingLeft: 36, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {s.jobTitle || "Staff"}{s.departmentName ? ` \u2022 ${s.departmentName}` : ""}
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                        {unreadCount > 0 && (
                          <span style={{ background: theme.text.danger, color: "#fff", borderRadius: 999, padding: "2px 8px", fontSize: theme.fontSize.xs, fontWeight: theme.fontWeight.bold }}>
                            {unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {/* Chat pane */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", background: theme.surface.card, minWidth: 0 }}>
            <div style={{ padding: `${theme.spacing["2"]} 1.25rem`, borderBottom: `1px solid ${theme.surface.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: theme.fontWeight.bold, fontSize: theme.fontSize.base, color: theme.text.primary }}>
                  {selectedPeer ? `${selectedPeer.firstName} ${selectedPeer.lastName}` : "Select a staff member"}
                </div>
                <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>Secure Channel | End-to-End Encrypted</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: theme.spacing["2"] }}>
                {replyTo && (
                  <div style={{ display: "flex", alignItems: "center", gap: theme.spacing["2"], background: theme.surface.subtle, padding: "4px 8px", borderRadius: theme.radius.sm, fontSize: theme.fontSize.xs }}>
                    Replying to <strong>{replyTo.senderName}</strong>: {messagePreview(replyTo.body, 30)}
                    <button onClick={() => setReplyTo(null)} style={{ background: "none", border: "none", cursor: "pointer", color: theme.text.danger, fontWeight: "bold" }}>x</button>
                  </div>
                )}
                {selectedPeer && (
                  <>
                    <button
                      onClick={() => { if (selectedPeer) startCall(selectedPeer.userId, "voice"); }}
                      title="Voice Call"
                      style={{ width: 36, height: 36, borderRadius: 999, border: "none", background: theme.surface.subtle, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}
                    >📞</button>
                    <button
                      onClick={() => { if (selectedPeer) startCall(selectedPeer.userId, "video"); }}
                      title="Video Call"
                      style={{ width: 36, height: 36, borderRadius: 999, border: "none", background: theme.surface.subtle, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}
                    >📹</button>
                  </>
                )}
              </div>
            </div>

            <div style={{ flex: 1, padding: theme.spacing["3"], overflowY: "auto", display: "flex", flexDirection: "column", gap: theme.spacing["2"] }}>
              {!selectedPeer && <p style={{ color: theme.text.muted, fontSize: theme.fontSize.base }}>Choose a recipient from the directory to start messaging.</p>}
              {selectedPeer && messages.length === 0 && <p style={{ color: theme.text.muted, fontSize: theme.fontSize.base }}>No messages yet.</p>}
              {selectedPeer && messages.map((msg) => {
                const isMe = msg.senderId === me?.id;
                if (msg.isDeleted) {
                  return (
                    <div key={msg.id} style={{ display: "flex", justifyContent: isMe ? "flex-end" : "flex-start", width: "100%" }}>
                      <div style={{ maxWidth: "70%", background: theme.surface.subtle, padding: `${theme.spacing["1"]} 0.6rem`, borderRadius: theme.radius.md, fontSize: theme.fontSize.sm, color: theme.text.muted, fontStyle: "italic" }}>
                        [Message deleted]
                      </div>
                    </div>
                  );
                }
                const pc = priorityColors[msg.priority] || priorityColors.normal;
                return (
                  <div
                    key={msg.id}
                    style={{ display: "flex", justifyContent: isMe ? "flex-end" : "flex-start", width: "100%", cursor: "context-menu" }}
                    onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ msg, x: e.clientX, y: e.clientY }); }}
                  >
                    <div style={{ maxWidth: "70%" }}>
                      {msg.replyToId && (
                        <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginBottom: 2, paddingLeft: 8, borderLeft: `2px solid ${theme.surface.border}` }}>
                          Reply to message
                        </div>
                      )}
                      <div style={{
                        background: isMe ? "#2563eb" : theme.surface.subtle,
                        padding: `${theme.spacing["2"]} 0.8rem`,
                        borderRadius: isMe ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                        fontSize: theme.fontSize.sm,
                        color: isMe ? "#ffffff" : theme.text.primary,
                        position: "relative",
                        wordBreak: "break-word",
                      }}>
                        {msg.priority !== "normal" && (
                          <span style={{ display: "inline-block", background: pc.bg, color: pc.text, borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: theme.fontWeight.bold, marginRight: 6, verticalAlign: "middle" }}>
                            {pc.label}
                          </span>
                        )}
                        {msg.body.startsWith("[Voice Note") && msg.attachments?.[0]?.storageRef ? (
                          <VoiceNotePlayer
                            audioUrl={msg.attachments[0].storageRef}
                            storedDuration={extractVoiceNoteDuration(msg.body)}
                            isOutgoing={isMe}
                          />
                        ) : (
                          <>{msg.body}</>
                        )}
                        {/* File attachments */}
                        {msg.attachments && msg.attachments.length > 0 && !msg.body.startsWith("[Voice Note") && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: msg.body && !msg.body.startsWith("[") ? 6 : 0 }}>
                            {msg.attachments.map((att) => (
                              <FilePreviewCard key={att.id} attachment={att} isOutgoing={isMe} />
                            ))}
                          </div>
                        )}
                        {msg.editedAt && <span style={{ fontSize: 10, color: isMe ? "rgba(255,255,255,0.7)" : theme.text.muted, fontStyle: "italic" }}> (edited)</span>}
                      </div>
                      <div style={{ display: "flex", justifyContent: isMe ? "flex-end" : "flex-start", alignItems: "center", fontSize: theme.fontSize.xs, color: theme.text.muted, marginTop: 2, gap: 4 }}>
                        <span>{formatTime(msg.createdAt)}</span>
                        {isMe && <ReadReceipt status={msg.status} />}
                        {msg.replyCount != null && msg.replyCount > 0 && (
                          <button onClick={() => openThreadReplies(msg)} style={{ background: "none", border: "none", color: theme.badge.aft.bg, cursor: "pointer", fontSize: theme.fontSize.xs }}>
                            {msg.replyCount} replies
                          </button>
                        )}
                        {!isMe && (
                          <button onClick={() => setReplyTo(msg)} style={{ background: "none", border: "none", color: theme.text.muted, cursor: "pointer", fontSize: theme.fontSize.xs }}>
                            Reply
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {selectedPeer && dmTyping && (
              <div style={{ padding: `0 1.25rem`, fontSize: theme.fontSize.xs, color: theme.text.muted, fontStyle: "italic" }}>
                You are typing...
              </div>
            )}

            {recordingVoice && selectedPeer && (
              <div style={{ padding: `${theme.spacing["2"]} ${theme.spacing["3"]}`, borderTop: `1px solid ${theme.surface.border}` }}>
                <VoiceRecorder
                  onRecord={(blob, secs) => sendVoiceNote(blob, secs)}
                  onCancel={() => setRecordingVoice(false)}
                />
              </div>
            )}
            {/* File attachment previews */}
            {dmAttachments.length > 0 && (
              <div style={{ padding: `${theme.spacing["1"]} ${theme.spacing["3"]}`, display: "flex", gap: 8, flexWrap: "wrap", borderTop: `1px solid ${theme.surface.border}` }}>
                {dmAttachments.map((f, i) => (
                  <div key={i} style={{ position: "relative", background: theme.surface.subtle, borderRadius: 8, padding: 6, display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                    {f.thumbnail ? (
                      <img src={f.thumbnail} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: "cover" }} />
                    ) : (
                      <span style={{ fontSize: 16 }}>file</span>
                    )}
                    <span style={{ color: theme.text.primary, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.fileName}</span>
                    <button onClick={() => setDmAttachments((prev) => prev.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: theme.text.danger, cursor: "pointer", fontSize: 14, padding: 0 }}>x</button>
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={sendDm} style={{ padding: `${theme.spacing["2"]} ${theme.spacing["3"]}`, borderTop: dmAttachments.length > 0 ? "none" : `1px solid ${theme.surface.border}`, display: "flex", gap: theme.spacing["2"], alignItems: "center" }}>
              <Select
                value={dmPriority}
                onChange={(e) => setDmPriority(e.target.value)}
                style={{ width: 100, fontSize: theme.fontSize.sm }}
              >
                <option value="normal">Normal</option>
                <option value="urgent">Urgent</option>
                <option value="critical">Critical</option>
              </Select>
              <FileAttachmentPicker onFilesSelected={(files) => setDmAttachments((prev) => [...prev, ...files])} disabled={!selectedPeer} />
              <Input
                type="text"
                placeholder={selectedPeer ? `Message ${selectedPeer.firstName}...` : "Select a recipient first"}
                value={dmInput}
                disabled={!selectedPeer}
                onChange={(e) => { setDmInput(e.target.value); handleDmTyping(); }}
                style={{ flex: 1 }}
              />
              {/* Microphone button */}
              <button
                type="button"
                onClick={() => setRecordingVoice(!recordingVoice)}
                disabled={!selectedPeer}
                title={recordingVoice ? "Stop recording" : "Record voice note"}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 999,
                  border: "none",
                  background: recordingVoice ? "#ef4444" : (selectedPeer ? theme.badge.aft.bg : theme.surface.subtle),
                  color: recordingVoice ? "#fff" : (selectedPeer ? "#fff" : theme.text.muted),
                  cursor: selectedPeer ? "pointer" : "default",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                }}
              >
                {recordingVoice ? "⏹" : "🎤"}
              </button>
              <Button type="submit" disabled={!selectedPeer || (!dmInput.trim() && dmAttachments.length === 0)}>Send</Button>
            </form>
          </div>
        </PaneShell>
      )}

      {/* ============================================================ */}
      {/*  CHANNELS TAB                                                */}
      {/* ============================================================ */}
      {!loading && activeTab === "channels" && (
        <PaneShell>
          <div style={dirPane}>
            <div style={{ ...dirHeader, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Hospital Channels</span>
              <button onClick={() => setCreateChOpen(true)} style={{ background: "none", border: "none", color: theme.badge.aft.bg, cursor: "pointer", fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.bold }}>
                + New
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {channels.length === 0 && <p style={{ padding: theme.spacing["4"], fontSize: theme.fontSize.sm, color: theme.text.muted }}>No channels.</p>}
              {channels.map((ch) => {
                const unreadCount = unread.channels[ch.id] || 0;
                return (
                  <div key={ch.id} onClick={() => openChannel(ch)} style={{ padding: `${theme.spacing["2"]} ${theme.spacing["3"]}`, cursor: "pointer", background: selectedChannel?.id === ch.id ? theme.badge.aft.bg : "transparent", borderBottom: `1px solid ${theme.surface.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: theme.fontSize.sm, fontWeight: selectedChannel?.id === ch.id ? theme.fontWeight.bold : theme.fontWeight.medium, color: theme.text.primary }}>
                        #{ch.name}
                        {ch.isReadOnly && <span style={{ fontSize: 10, color: theme.text.muted, marginLeft: 4 }}>(read-only)</span>}
                      </div>
                      <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted }}>
                        {ch.type.toUpperCase()} | {ch.memberCount} members
                        {ch.isMember ? " | Joined" : ""}
                      </div>
                    </div>
                    {unreadCount > 0 && (
                      <span style={{ background: theme.text.danger, color: "#fff", borderRadius: 999, padding: "2px 8px", fontSize: theme.fontSize.xs, fontWeight: theme.fontWeight.bold }}>
                        {unreadCount}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", background: theme.surface.card, minWidth: 0 }}>
            <div style={{ padding: `${theme.spacing["2"]} 1.25rem`, borderBottom: `1px solid ${theme.surface.border}` }}>
              <div style={{ fontWeight: theme.fontWeight.bold, fontSize: theme.fontSize.base, color: theme.text.primary }}>
                {selectedChannel ? `#${selectedChannel.name}` : "Select a channel"}
              </div>
              {selectedChannel?.description && <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>{selectedChannel.description}</div>}
            </div>

            <div style={{ flex: 1, padding: theme.spacing["3"], overflowY: "auto", display: "flex", flexDirection: "column", gap: theme.spacing["2"] }}>
              {!selectedChannel && <p style={{ color: theme.text.muted, fontSize: theme.fontSize.base }}>Choose a channel to view its messages.</p>}
              {selectedChannel && channelMessages.length === 0 && <p style={{ color: theme.text.muted, fontSize: theme.fontSize.base }}>No messages yet in this channel.</p>}
              {selectedChannel && channelMessages.map((msg) => {
                if (msg.isDeleted) {
                  return <div key={msg.id} style={{ maxWidth: "80%" }}><div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, fontStyle: "italic" }}>[Message deleted]</div></div>;
                }
                const pc = priorityColors[msg.priority] || priorityColors.normal;
                return (
                  <div key={msg.id} style={{ maxWidth: "80%", cursor: "context-menu" }} onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ msg, x: e.clientX, y: e.clientY }); }}>
                    <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, marginBottom: 2 }}>
                      <strong>{msg.senderName}</strong> | {formatTime(msg.createdAt)}
                      {msg.priority !== "normal" && (
                        <span style={{ display: "inline-block", background: pc.bg, color: pc.text, borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: theme.fontWeight.bold, marginLeft: 6 }}>
                          {pc.label}
                        </span>
                      )}
                    </div>
                    <div style={{ background: msg.senderId === me?.id ? theme.badge.aft.bg : theme.surface.subtle, padding: `${theme.spacing["2"]} 0.8rem`, borderRadius: theme.radius.md, fontSize: theme.fontSize.sm, color: theme.text.primary }}>
                      {msg.body}
                      {msg.editedAt && <span style={{ fontSize: 10, color: theme.text.muted, fontStyle: "italic" }}> (edited)</span>}
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                      {msg.replyCount != null && msg.replyCount > 0 && (
                        <button onClick={() => openThreadReplies(msg)} style={{ background: "none", border: "none", color: theme.badge.aft.bg, cursor: "pointer", fontSize: theme.fontSize.xs }}>
                          {msg.replyCount} replies
                        </button>
                      )}
                      <button onClick={() => setReplyTo(msg)} style={{ background: "none", border: "none", color: theme.text.muted, cursor: "pointer", fontSize: theme.fontSize.xs }}>
                        Reply
                      </button>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {selectedChannel && channelTyping && (
              <div style={{ padding: `0 1.25rem`, fontSize: theme.fontSize.xs, color: theme.text.muted, fontStyle: "italic" }}>Someone is typing...</div>
            )}

            <form onSubmit={sendChannelMessage} style={{ padding: `${theme.spacing["2"]} ${theme.spacing["3"]}`, borderTop: `1px solid ${theme.surface.border}`, display: "flex", gap: theme.spacing["2"], alignItems: "center" }}>
              <Input
                type="text"
                placeholder={selectedChannel ? `Message #${selectedChannel.name}...` : "Select a channel first"}
                value={channelInput}
                disabled={!selectedChannel || !selectedChannel.isMember}
                onChange={(e) => setChannelInput(e.target.value)}
                style={{ flex: 1 }}
              />
              <Button type="submit" disabled={!selectedChannel || !selectedChannel.isMember || !channelInput.trim()}>Send</Button>
            </form>
          </div>
        </PaneShell>
      )}

      {/* ============================================================ */}
      {/*  BROADCAST TAB                                               */}
      {/* ============================================================ */}
      {!loading && activeTab === "broadcast" && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["5"] }}>
          {/* Live Broadcast Buttons */}
          <Card title="Live Broadcast" hint="Start a hospital-wide voice or video broadcast.">
            <div style={{ display: "flex", gap: theme.spacing["3"], flexWrap: "wrap" }}>
              <Button onClick={() => { setLiveBroadcastType("voice"); setLiveBroadcastOpen(true); }}>
                Start Voice Broadcast
              </Button>
              <Button onClick={() => { setLiveBroadcastType("video"); setLiveBroadcastOpen(true); }}>
                Start Video Broadcast
              </Button>
            </div>
          </Card>

          {/* Broadcast Message Form */}
          <Card title="Hospital-Wide Broadcast Dispatch" hint="Send text, files, or voice notes to all active staff.">
            {/* File attachment previews */}
            {broadcastAttachments.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: theme.spacing["3"] }}>
                {broadcastAttachments.map((f, i) => (
                  <div key={i} style={{ position: "relative", background: theme.surface.subtle, borderRadius: 8, padding: 6, display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                    {f.thumbnail ? (
                      <img src={f.thumbnail} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: "cover" }} />
                    ) : (
                      <span style={{ fontSize: 16 }}>file</span>
                    )}
                    <span style={{ color: theme.text.primary, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.fileName}</span>
                    <button onClick={() => setBroadcastAttachments((prev) => prev.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: theme.text.danger, cursor: "pointer", fontSize: 14, padding: 0 }}>x</button>
                  </div>
                ))}
              </div>
            )}
            {recordingBroadcastVoice && (
              <div style={{ marginBottom: theme.spacing["3"] }}>
                <VoiceRecorder
                  onRecord={async (blob, secs) => {
                    setRecordingBroadcastVoice(false);
                    try {
                      // Convert audio blob to base64 data URL for playback
                      const reader = new FileReader();
                      const base64 = await new Promise<string>((resolve) => {
                        reader.onloadend = () => resolve(reader.result as string);
                        reader.readAsDataURL(blob);
                      });
                      await apiFetch("/communications/announcements", {
                        method: "POST",
                        body: JSON.stringify({
                          body: `[Voice Broadcast ${secs}s]`,
                          channelId: "",
                          attachments: [{
                            fileName: `voice-broadcast-${Date.now()}.webm`,
                            mimeType: "audio/webm",
                            sizeBytes: blob.size,
                            storageRef: base64,
                          }],
                        }),
                      });
                      const updated = await apiFetch<Message[]>("/communications/announcements");
                      setAnnouncements(updated);
                      toast.success("Voice broadcast sent.");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Could not send.");
                    }
                  }}
                  onCancel={() => setRecordingBroadcastVoice(false)}
                />
              </div>
            )}
            <form onSubmit={handleBroadcast} style={{ display: "flex", flexDirection: "column", gap: theme.spacing["3"], maxWidth: 720 }}>
              <div style={{ display: "flex", gap: theme.spacing["2"], alignItems: "center" }}>
                <Select
                  value={broadcastPriority}
                  onChange={(e) => setBroadcastPriority(e.target.value)}
                  style={{ width: 150 }}
                >
                  <option value="normal">Normal</option>
                  <option value="urgent">Urgent</option>
                  <option value="critical">Critical (Emergency)</option>
                </Select>
                <FileAttachmentPicker onFilesSelected={(files) => setBroadcastAttachments((prev) => [...prev, ...files])} />
                <button
                  type="button"
                  onClick={() => setRecordingBroadcastVoice(!recordingBroadcastVoice)}
                  title="Record voice broadcast"
                  style={{ width: 36, height: 36, borderRadius: 999, border: "none", background: recordingBroadcastVoice ? "#ef4444" : theme.surface.subtle, color: recordingBroadcastVoice ? "#fff" : theme.text.primary, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}
                >
                  {recordingBroadcastVoice ? "STOP" : "MIC"}
                </button>
              </div>
              <Textarea placeholder="Enter broadcast announcement..." value={broadcastInput} onChange={(e) => setBroadcastInput(e.target.value)} style={{ height: 120 }} />
              <div><Button type="submit" disabled={!broadcastInput.trim() && broadcastAttachments.length === 0}>Dispatch Broadcast</Button></div>
            </form>
          </Card>

          {/* Recent Announcements */}
          <Card title="Recent Announcements" bodyStyle={{ padding: 0 }}>
            {announcements.length === 0 ? (
              <EmptyState icon="chat" description="No announcements yet." />
            ) : (
              <div>
                {announcements.map((a) => {
                  const pc = priorityColors[a.priority] || priorityColors.normal;
                  const isVoiceBroadcast = a.body.startsWith("[Voice Broadcast");
                  return (
                    <div key={a.id} style={{ padding: `${theme.spacing["3"]} 1.25rem`, borderBottom: `1px solid ${theme.surface.border}` }}>
                      <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted, marginBottom: "0.2rem" }}>
                        <strong>{a.senderName}</strong> | {formatTime(a.createdAt)}
                        {a.priority !== "normal" && (
                          <span style={{ display: "inline-block", background: pc.bg, color: pc.text, borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: theme.fontWeight.bold, marginLeft: 6 }}>
                            {pc.label}
                          </span>
                        )}
                      </div>
                      {isVoiceBroadcast && a.attachments?.[0]?.storageRef ? (
                        <VoiceNotePlayer
                          audioUrl={a.attachments[0].storageRef}
                          storedDuration={extractVoiceNoteDuration(a.body)}
                          isOutgoing={false}
                        />
                      ) : (
                        <div style={{ fontSize: theme.fontSize.base, color: theme.text.primary }}>{a.body}</div>
                      )}
                      {a.attachments && a.attachments.length > 0 && !isVoiceBroadcast && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                          {a.attachments.map((att: any) => (
                            <FilePreviewCard key={att.id} attachment={att} isOutgoing={false} />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Live Broadcast Modal */}
          <LiveBroadcastModal
            open={liveBroadcastOpen}
            onClose={() => setLiveBroadcastOpen(false)}
            type={liveBroadcastType}
            broadcasterName={me ? `${(me as any).firstName || "Admin"} ${(me as any).lastName || ""}` : "Admin"}
            broadcasterId={me?.id}
          />
        </div>
      )}

      {/* ============================================================ */}
      {/*  CALL LOGS TAB                                               */}
      {/* ============================================================ */}
      {!loading && activeTab === "calls" && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
          <Card title="Call History">
            <div style={{ display: "flex", gap: theme.spacing["2"], marginBottom: theme.spacing["3"] }}>
              <Button size="sm" onClick={loadCallLogs}>Refresh</Button>
            </div>
            {callLogsLoading && <p style={{ color: theme.text.muted }}>Loading call logs...</p>}
            {!callLogsLoading && callLogs.length === 0 && <EmptyState icon="chat" description="No call logs yet." />}
            {!callLogsLoading && callLogs.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {callLogs.map((log: any) => {
                  const isOutgoing = log.direction === "outgoing";
                  const otherName = isOutgoing ? log.calleeName : log.callerName;
                  const statusColors: Record<string, string> = {
                    answered: "#22c55e",
                    missed: "#ef4444",
                    rejected: "#f97316",
                    timeout: "#f97316",
                  };
                  const statusColor = statusColors[log.status] || theme.text.muted;
                  const icon = log.callType === "video" ? "📹" : "📞";
                  const dirIcon = isOutgoing ? "\u2197" : "\u2199"; // arrows
                  const dur = log.durationSeconds;
                  const durStr = dur > 0 ? `${Math.floor(dur / 60)}:${(dur % 60).toString().padStart(2, "0")}` : "Missed";

                  return (
                    <div key={log.id} style={{ display: "flex", alignItems: "center", gap: theme.spacing["3"], padding: `${theme.spacing["3"]} 0`, borderBottom: `1px solid ${theme.surface.border}` }}>
                      {/* Avatar */}
                      <div style={{ width: 40, height: 40, borderRadius: 999, background: theme.surface.subtle, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>
                        {icon}
                      </div>
                      {/* Details */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.bold, color: theme.text.primary }}>
                          {otherName || "Unknown"}
                        </div>
                        <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted }}>
                          {dirIcon} {isOutgoing ? "Outgoing" : "Incoming"} {log.callType === "video" ? "Video" : "Voice"} | {new Date(log.startedAt).toLocaleString()}
                        </div>
                      </div>
                      {/* Status & Duration */}
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontSize: theme.fontSize.xs, fontWeight: theme.fontWeight.bold, color: statusColor }}>
                          {log.status.charAt(0).toUpperCase() + log.status.slice(1)}
                        </div>
                        <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted, fontVariantNumeric: "tabular-nums" }}>
                          {durStr}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ============================================================ */}
      {/*  SEARCH TAB                                                  */}
      {/* ============================================================ */}
      {!loading && activeTab === "search" && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
          <Card title="Search Messages">
            <form onSubmit={handleSearch} style={{ display: "flex", gap: theme.spacing["2"], alignItems: "center" }}>
              <Input placeholder="Search across all your conversations and channels..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ flex: 1 }} />
              <Button type="submit">Search</Button>
            </form>
          </Card>
          {searchLoading && <p style={{ color: theme.text.muted }}>Searching...</p>}
          {!searchLoading && searchResults.length > 0 && (
            <Card title={`Results (${searchResults.length})`} bodyStyle={{ padding: 0 }}>
              {searchResults.map((msg) => (
                <div key={msg.id} style={{ padding: `${theme.spacing["2"]} 1.25rem`, borderBottom: `1px solid ${theme.surface.border}` }}>
                  <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted }}>
                    <strong>{msg.senderName}</strong> | {msg.kind === "channel" ? `#${msg.channelName}` : "Direct"} | {formatTime(msg.createdAt)}
                  </div>
                  <div style={{ fontSize: theme.fontSize.sm, color: theme.text.primary }}>{msg.body}</div>
                </div>
              ))}
            </Card>
          )}
          {!searchLoading && searchQuery && searchResults.length === 0 && (
            <EmptyState icon="chat" description="No messages match your search." />
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/*  NOTIFICATIONS TAB                                           */}
      {/* ============================================================ */}
      {!loading && activeTab === "notifications" && (
        <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
          <Card title="Notification Preferences">
            <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["3"], maxWidth: 480 }}>
              <label style={{ display: "flex", alignItems: "center", gap: theme.spacing["2"], fontSize: theme.fontSize.base }}>
                <input type="checkbox" checked={notifPrefs.inApp} onChange={(e) => setNotifPrefs((p) => ({ ...p, inApp: e.target.checked }))} />
                In-app notifications
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: theme.spacing["2"], fontSize: theme.fontSize.base }}>
                <input type="checkbox" checked={notifPrefs.sound} onChange={(e) => setNotifPrefs((p) => ({ ...p, sound: e.target.checked }))} />
                Sound alerts
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: theme.spacing["2"], fontSize: theme.fontSize.base }}>
                <input type="checkbox" checked={notifPrefs.desktop} onChange={(e) => setNotifPrefs((p) => ({ ...p, desktop: e.target.checked }))} />
                Desktop push notifications
              </label>
              <div><Button onClick={saveNotifPrefs}>Save Preferences</Button></div>
            </div>
          </Card>
          <Card title="Unread Summary">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: theme.spacing["3"] }}>
              <StatCard label="Total Unread" value={unread.total} />
              <StatCard label="DM Unread" value={Object.values(unread.dm).reduce((a, b) => a + b, 0)} />
              <StatCard label="Channel Unread" value={Object.values(unread.channels).reduce((a, b) => a + b, 0)} />
            </div>
          </Card>
        </div>
      )}

      {/* ============================================================ */}
      {/*  CONTEXT MENU                                                */}
      {/* ============================================================ */}
      {ctxMenu && (
        <div
          style={{ position: "fixed", top: ctxMenu.y, left: ctxMenu.x, background: theme.surface.card, border: `1px solid ${theme.surface.border}`, borderRadius: theme.radius.md, boxShadow: "0 4px 12px rgba(0,0,0,0.15)", zIndex: 1000, minWidth: 160 }}
          onClick={() => setCtxMenu(null)}
        >
          <div onClick={() => setReplyTo(ctxMenu.msg)} style={{ padding: "8px 16px", cursor: "pointer", fontSize: theme.fontSize.sm, borderBottom: `1px solid ${theme.surface.border}` }}>Reply</div>
          {ctxMenu.msg.senderId === me?.id && (
            <>
              <div onClick={() => setEditModal({ msg: ctxMenu.msg, body: ctxMenu.msg.body })} style={{ padding: "8px 16px", cursor: "pointer", fontSize: theme.fontSize.sm, borderBottom: `1px solid ${theme.surface.border}` }}>Edit</div>
              <div onClick={() => handleDeleteMessage(ctxMenu.msg.id)} style={{ padding: "8px 16px", cursor: "pointer", fontSize: theme.fontSize.sm, color: theme.text.danger }}>Delete</div>
            </>
          )}
          {ctxMenu.msg.senderId !== me?.id && (
            <div onClick={() => openThreadReplies(ctxMenu.msg)} style={{ padding: "8px 16px", cursor: "pointer", fontSize: theme.fontSize.sm }}>View Thread</div>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/*  CREATE CHANNEL MODAL                                        */}
      {/* ============================================================ */}
      <Modal open={createChOpen} onClose={() => setCreateChOpen(false)} title="Create New Channel">
        <form onSubmit={handleCreateChannel} style={{ display: "flex", flexDirection: "column", gap: theme.spacing["3"] }}>
          <FormField label="Channel Name" required>
            <Input value={newChName} onChange={(e) => setNewChName(e.target.value)} placeholder="e.g. Ward 3 - Night Shift" />
          </FormField>
          <FormField label="Type" required>
            <Select value={newChType} onChange={(e) => setNewChType(e.target.value)}>
              <option value="department">Department</option>
              <option value="shift">Shift</option>
            </Select>
          </FormField>
          <FormField label="Description">
            <Input value={newChDesc} onChange={(e) => setNewChDesc(e.target.value)} placeholder="What is this channel about?" />
          </FormField>
          <div style={{ display: "flex", gap: theme.spacing["2"], justifyContent: "flex-end" }}>
            <Button type="button" onClick={() => setCreateChOpen(false)}>Cancel</Button>
            <Button type="submit">Create Channel</Button>
          </div>
        </form>
      </Modal>

      {/* ============================================================ */}
      {/*  EDIT MESSAGE MODAL                                          */}
      {/* ============================================================ */}
      <Modal open={!!editModal} onClose={() => setEditModal(null)} title="Edit Message">
        {editModal && (
          <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["3"] }}>
            <Textarea value={editModal.body} onChange={(e) => setEditModal({ ...editModal, body: e.target.value })} style={{ height: 100 }} />
            <div style={{ display: "flex", gap: theme.spacing["2"], justifyContent: "flex-end" }}>
              <Button onClick={() => setEditModal(null)}>Cancel</Button>
              <Button onClick={handleEditMessage}>Save Changes</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ============================================================ */}
      {/*  THREAD REPLY MODAL                                          */}
      {/* ============================================================ */}
      <Modal open={!!threadParent} onClose={() => setThreadParent(null)} title="Thread">
        {threadParent && (
          <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["3"], maxHeight: 400, overflowY: "auto" }}>
            <div style={{ padding: theme.spacing["2"], background: theme.surface.subtle, borderRadius: theme.radius.sm }}>
              <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted }}><strong>{threadParent.senderName}</strong> | {formatTime(threadParent.createdAt)}</div>
              <div style={{ fontSize: theme.fontSize.sm, color: theme.text.primary }}>{threadParent.body}</div>
            </div>
            {threadReplies.length === 0 && <p style={{ color: theme.text.muted, fontSize: theme.fontSize.sm }}>No replies yet.</p>}
            {threadReplies.map((r) => (
              <div key={r.id} style={{ padding: theme.spacing["2"], background: r.senderId === me?.id ? theme.badge.aft.bg : theme.surface.subtle, borderRadius: theme.radius.sm }}>
                <div style={{ fontSize: theme.fontSize.xs, color: theme.text.muted }}><strong>{r.senderName}</strong> | {formatTime(r.createdAt)}</div>
                <div style={{ fontSize: theme.fontSize.sm, color: theme.text.primary }}>{r.body}</div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Call Modal */}
      {selectedPeer && (
        <CallModal
          open={callOpen}
          onClose={() => { setCallOpen(false); setActiveCallId(null); }}
          type={callType}
          participants={[{ name: `${selectedPeer.firstName} ${selectedPeer.lastName}`, isSelf: false, userId: selectedPeer.userId }]}
          onStateChange={handleCallStateChange}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function PaneShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flex: 1, background: theme.surface.card, borderRadius: theme.radius.lg, border: `1px solid ${theme.surface.border}`, overflow: "hidden", minHeight: 480 }}>
      {children}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: theme.surface.subtle, borderRadius: theme.radius.md, padding: theme.spacing["3"], textAlign: "center" }}>
      <div style={{ fontSize: theme.fontSize["2xl"], fontWeight: theme.fontWeight.bold, color: theme.text.primary }}>{value}</div>
      <div style={{ fontSize: theme.fontSize.sm, color: theme.text.muted }}>{label}</div>
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
  padding: `${theme.spacing["3"]} ${theme.spacing["4"]}`,
  borderBottom: `1px solid ${theme.surface.border}`,
  fontWeight: theme.fontWeight.bold,
  fontSize: theme.fontSize.sm,
  color: theme.text.secondary,
} as const;
