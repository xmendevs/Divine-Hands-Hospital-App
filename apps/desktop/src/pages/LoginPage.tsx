import { useState, type CSSProperties, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [deviceName, setDeviceName] = useState("Desktop");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(username, password, mfaRequired ? totpCode : undefined, deviceName);
    } catch (err) {
      if (err instanceof ApiError && err.code === "mfa_required") {
        setMfaRequired(true);
        setError("Enter the 6-digit code from your authenticator app.");
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Login failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={outer}>
      <form onSubmit={handleSubmit} style={card}>
        <h2 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 800, color: "#0f172a" }}>Divine Hands Hospital</h2>
        <p style={{ margin: 0, fontSize: "0.85rem", color: "#64748b" }}>Sign in to continue</p>

        <label style={label}>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            required
            style={input}
            placeholder="username"
          />
        </label>

        <label style={label}>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={input}
            placeholder="password"
          />
        </label>

        {mfaRequired && (
          <label style={label}>
            Authenticator code
            <input
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              required
              inputMode="numeric"
              maxLength={6}
              style={input}
              placeholder="6-digit code"
            />
          </label>
        )}

        <label style={label}>
          Device name
          <input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} style={input} />
        </label>

        {error && (
          <p role="alert" style={{ margin: 0, fontSize: "0.8rem", color: "#b91c1c" }}>
            {error}
          </p>
        )}

        <button type="submit" disabled={busy} style={button}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

const outer: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100vh",
  background: "#f1f5f9",
  fontFamily: "system-ui, sans-serif",
};

const card: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
  width: "360px",
  padding: "1.5rem",
  background: "#fff",
  borderRadius: "10px",
  boxShadow: "0 10px 30px rgba(15, 23, 42, 0.1)",
};

const label: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.3rem",
  fontSize: "0.8rem",
  fontWeight: 600,
  color: "#334155",
};

const input: CSSProperties = {
  padding: "0.6rem",
  borderRadius: "6px",
  border: "1px solid #cbd5e1",
  fontSize: "0.9rem",
};

const button: CSSProperties = {
  padding: "0.65rem",
  borderRadius: "6px",
  border: "none",
  background: "#0f172a",
  color: "#fff",
  fontWeight: 700,
  fontSize: "0.9rem",
  cursor: "pointer",
};
