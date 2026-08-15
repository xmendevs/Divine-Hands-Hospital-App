import { useState, type CSSProperties, type FormEvent } from "react";
import { apiFetch, getBaseUrl, setBaseUrl } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export default function SettingsPage() {
  const { me, logout } = useAuth();
  const [serverUrl, setServerUrl] = useState(() => getBaseUrl());
  const [saved, setSaved] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwdError, setPwdError] = useState("");
  const [pwdOk, setPwdOk] = useState("");
  const [busy, setBusy] = useState(false);

  function handleSaveUrl(e: FormEvent) {
    e.preventDefault();
    setBaseUrl(serverUrl);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setPwdError("");
    setPwdOk("");
    setBusy(true);
    try {
      await apiFetch<unknown>("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setPwdOk("Password changed. Other sessions were signed out.");
    } catch (err) {
      setPwdError(err instanceof Error ? err.message : "Could not change password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={wrap}>
      <h2 style={heading}>Settings</h2>

      {me?.mustChangePassword && (
        <p style={{ padding: "0.75rem", borderRadius: "6px", background: "#fef2f2", color: "#b91c1c", fontSize: "0.85rem", margin: "0 0 1rem" }}>
          You must change your password before continuing.
        </p>
      )}

      <section style={section}>
        <h3 style={sub}>Server connection</h3>
        <p style={hint}>
          The address of the main PC running the backend. Other PCs set this to the main PC&apos;s
          network address (e.g. http://192.168.1.10:8080).
        </p>
        <form onSubmit={handleSaveUrl} style={row}>
          <input
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            style={input}
            placeholder="http://127.0.0.1:8080"
          />
          <button type="submit" style={button}>
            Save
          </button>
        </form>
        {saved && <p style={{ color: "#15803d", fontSize: "0.8rem" }}>Saved. Reconnect to apply.</p>}
      </section>

      <section style={section}>
        <h3 style={sub}>Account</h3>
        <p style={hint}>
          Signed in as <strong>{me?.username}</strong>
          {me?.roles?.length ? ` — ${me.roles.map((r) => r.name).join(", ")}` : ""}
        </p>
      </section>

      <section style={section}>
        <h3 style={sub}>Change password</h3>
        <form onSubmit={handleChangePassword} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            style={input}
            placeholder="Current password"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            style={input}
            placeholder="New password (min 8 characters)"
          />
          <button type="submit" disabled={busy} style={button}>
            {busy ? "Changing…" : "Change password"}
          </button>
        </form>
        {pwdError && <p style={{ color: "#b91c1c", fontSize: "0.8rem" }}>{pwdError}</p>}
        {pwdOk && <p style={{ color: "#15803d", fontSize: "0.8rem" }}>{pwdOk}</p>}
      </section>

      <button onClick={() => void logout()} style={logoutBtn}>
        Sign out
      </button>
    </div>
  );
}

const wrap: CSSProperties = { padding: "1.5rem", maxWidth: "640px" };
const heading: CSSProperties = { margin: "0 0 1rem", fontSize: "1.3rem", fontWeight: 800, color: "#0f172a" };
const sub: CSSProperties = { margin: "0 0 0.25rem", fontSize: "1rem", fontWeight: 700, color: "#0f172a" };
const hint: CSSProperties = { margin: "0 0 0.5rem", fontSize: "0.8rem", color: "#64748b" };
const section: CSSProperties = {
  background: "#fff",
  borderRadius: "8px",
  padding: "1rem",
  marginBottom: "1rem",
  border: "1px solid #e2e8f0",
};
const row: CSSProperties = { display: "flex", gap: "0.5rem" };
const input: CSSProperties = {
  flex: 1,
  padding: "0.6rem",
  borderRadius: "6px",
  border: "1px solid #cbd5e1",
  fontSize: "0.9rem",
};
const button: CSSProperties = {
  padding: "0.6rem 1rem",
  borderRadius: "6px",
  border: "none",
  background: "#0f172a",
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer",
};
const logoutBtn: CSSProperties = {
  padding: "0.6rem 1rem",
  borderRadius: "6px",
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: "#b91c1c",
  fontWeight: 700,
  cursor: "pointer",
};
