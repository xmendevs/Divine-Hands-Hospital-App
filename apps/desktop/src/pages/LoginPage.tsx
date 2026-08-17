import { useState, type CSSProperties, type FormEvent } from "react";
import { theme, Button, FormField, Input } from "@hims/ui";
import { ApiError, getBaseUrl, setBaseUrl } from "../api/client";
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
  const [showConnection, setShowConnection] = useState(false);
  const [serverUrl, setServerUrl] = useState(() => getBaseUrl());
  const [urlSaved, setUrlSaved] = useState(false);

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
        <h2 style={{ margin: 0, fontSize: theme.fontSize.xl, fontWeight: theme.fontWeight.bold, color: theme.text.primary }}>
          Divine Hands Hospital
        </h2>
        <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted }}>Sign in to continue</p>

        <FormField label="Username">
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            required
            placeholder="username"
          />
        </FormField>

        <FormField label="Password">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="password"
          />
        </FormField>

        {mfaRequired && (
          <FormField label="Authenticator code">
            <Input
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              required
              inputMode="numeric"
              maxLength={6}
              placeholder="6-digit code"
            />
          </FormField>
        )}

        <FormField label="Device name">
          <Input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
        </FormField>

        <button type="button" onClick={() => setShowConnection((s) => !s)} style={linkBtn}>
          Connection settings
        </button>

        {showConnection && (
          <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["2"] }}>
            <FormField label="Server address">
              <Input
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="http://127.0.0.1:8080"
              />
            </FormField>
            <div>
              <Button
                variant="outline"
                type="button"
                onClick={() => {
                  setBaseUrl(serverUrl);
                  setUrlSaved(true);
                  window.setTimeout(() => setUrlSaved(false), 2500);
                }}
              >
                Save address
              </Button>
            </div>
            {urlSaved && <p style={{ margin: 0, fontSize: theme.fontSize.sm, color: theme.action.success }}>Saved.</p>}
            <p style={{ margin: 0, fontSize: theme.fontSize.sm, color: theme.text.muted }}>
              Set this to the main PC&apos;s network address (e.g. http://192.168.1.10:8080).
            </p>
          </div>
        )}

        {error && (
          <p role="alert" style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.danger }}>
            {error}
          </p>
        )}

        <Button type="submit" loading={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}

const outer: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100vh",
  background: theme.surface.canvas,
};

const card: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: theme.spacing["3"],
  width: "360px",
  padding: theme.spacing["6"],
  background: theme.surface.card,
  borderRadius: theme.radius.lg,
  boxShadow: theme.shadow.popover,
};

const linkBtn: CSSProperties = {
  background: "none",
  border: "none",
  color: theme.action.primary,
  fontSize: theme.fontSize.base,
  fontWeight: theme.fontWeight.semibold,
  cursor: "pointer",
  textAlign: "left",
  padding: 0,
};
