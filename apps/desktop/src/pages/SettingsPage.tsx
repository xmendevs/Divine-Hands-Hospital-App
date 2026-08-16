import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { apiFetch, downloadInstaller, getBaseUrl, setBaseUrl } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import type { HimsServerInfo } from "../hims";

interface SystemSetting {
  key: string;
  value: string | boolean | number;
  description: string;
  updatedBy?: string | null;
  updatedAt: string;
}

interface BackupJob {
  id: string;
  job_type: string;
  status: string;
  started_at: string;
  finished_at?: string | null;
  target?: string;
  size_bytes?: number;
  error_message?: string;
  created_at: string;
}

interface BackupStatus {
  enabled: boolean;
  local_healthy: boolean;
  cloud_healthy: boolean;
  backup_age_hours?: number;
  storage_bytes: number;
  next_local_at?: string | null;
  next_cloud_at?: string | null;
  next_verify_at?: string | null;
  failed_last_24h: number;
  health_status: string;
  last_local?: BackupJob | null;
  last_cloud?: BackupJob | null;
  last_verification?: BackupJob | null;
  recent_jobs: BackupJob[];
}

interface BackupForm {
  enabled: boolean;
  local_dir: string;
  s3_endpoint: string;
  s3_region: string;
  s3_bucket: string;
  s3_prefix: string;
  s3_access_key: string;
  s3_secret_key: string;
  s3_path_style: boolean;
  retention_daily: string;
  retention_weekly: string;
  retention_monthly: string;
  local_interval: string;
  cloud_interval: string;
  verify_interval: string;
}

const EMPTY_BACKUP_FORM: BackupForm = {
  enabled: false,
  local_dir: "",
  s3_endpoint: "",
  s3_region: "",
  s3_bucket: "",
  s3_prefix: "",
  s3_access_key: "",
  s3_secret_key: "",
  s3_path_style: false,
  retention_daily: "7",
  retention_weekly: "4",
  retention_monthly: "3",
  local_interval: "24h",
  cloud_interval: "24h",
  verify_interval: "24h",
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function bool(v: unknown): boolean {
  return typeof v === "boolean" ? v : false;
}

function numStr(v: unknown): string {
  return typeof v === "number" ? String(v) : str(v);
}

export default function SettingsPage() {
  const { me, logout } = useAuth();
  const isSuperAdmin = me?.roles?.some((r) => r.code === "super_admin") ?? false;

  const [serverUrl, setServerUrl] = useState(() => getBaseUrl());
  const [saved, setSaved] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwdError, setPwdError] = useState("");
  const [pwdOk, setPwdOk] = useState("");
  const [busy, setBusy] = useState(false);

  const [backupForm, setBackupForm] = useState<BackupForm>(EMPTY_BACKUP_FORM);
  const [backupLoaded, setBackupLoaded] = useState(false);
  const [backupSaving, setBackupSaving] = useState(false);
  const [backupMsg, setBackupMsg] = useState("");
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [statusError, setStatusError] = useState("");

  const [dlError, setDlError] = useState("");
  const [dlBusy, setDlBusy] = useState(false);

  const [serverInfo, setServerInfo] = useState<HimsServerInfo | null>(null);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    if (!window.hims) return;
    let cancelled = false;
    window.hims
      .getServerInfo()
      .then((info) => {
        if (!cancelled) setServerInfo(info);
      })
      .catch(() => {
        /* preload unavailable */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isSuperAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const settings = await apiFetch<SystemSetting[]>("/admin/settings");
        if (cancelled) return;
        const get = (key: string) => settings.find((s) => s.key === key)?.value;
        setBackupForm({
          enabled: bool(get("backup.enabled")),
          local_dir: str(get("backup.local_dir")),
          s3_endpoint: str(get("backup.s3.endpoint")),
          s3_region: str(get("backup.s3.region")),
          s3_bucket: str(get("backup.s3.bucket")),
          s3_prefix: str(get("backup.s3.prefix")),
          s3_access_key: str(get("backup.s3.access_key")),
          s3_secret_key: "",
          s3_path_style: bool(get("backup.s3.path_style")),
          retention_daily: numStr(get("backup.retention_daily")) || "7",
          retention_weekly: numStr(get("backup.retention_weekly")) || "4",
          retention_monthly: numStr(get("backup.retention_monthly")) || "3",
          local_interval: str(get("backup.local_interval")) || "24h",
          cloud_interval: str(get("backup.cloud_interval")) || "24h",
          verify_interval: str(get("backup.verify_interval")) || "24h",
        });
      } catch {
        setStatusError("Could not load backup settings.");
      } finally {
        if (!cancelled) setBackupLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin]);

  async function refreshStatus() {
    setStatusError("");
    try {
      setBackupStatus(await apiFetch<BackupStatus>("/backups/status"));
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "Could not load backup status.");
    }
  }

  useEffect(() => {
    if (isSuperAdmin) void refreshStatus();
    // refreshStatus is intentionally not a dependency: it only reads live status.
  }, [isSuperAdmin]);

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

  async function handleSaveBackup(e: FormEvent) {
    e.preventDefault();
    setBackupMsg("");
    setBackupSaving(true);
    try {
      const puts: Array<[string, unknown]> = [
        ["backup.enabled", backupForm.enabled],
        ["backup.local_dir", backupForm.local_dir.trim()],
        ["backup.retention_daily", parseInt(backupForm.retention_daily || "0", 10) || 0],
        ["backup.retention_weekly", parseInt(backupForm.retention_weekly || "0", 10) || 0],
        ["backup.retention_monthly", parseInt(backupForm.retention_monthly || "0", 10) || 0],
        ["backup.local_interval", backupForm.local_interval.trim() || "24h"],
        ["backup.cloud_interval", backupForm.cloud_interval.trim() || "24h"],
        ["backup.verify_interval", backupForm.verify_interval.trim() || "24h"],
        ["backup.s3.endpoint", backupForm.s3_endpoint.trim()],
        ["backup.s3.region", backupForm.s3_region.trim()],
        ["backup.s3.bucket", backupForm.s3_bucket.trim()],
        ["backup.s3.prefix", backupForm.s3_prefix.trim()],
        ["backup.s3.access_key", backupForm.s3_access_key.trim()],
        ["backup.s3.path_style", backupForm.s3_path_style],
      ];
      // Only write the secret when the user typed one, so a blank field keeps
      // the previously stored key.
      if (backupForm.s3_secret_key.trim() !== "") {
        puts.push(["backup.s3.secret_key", backupForm.s3_secret_key.trim()]);
      }
      for (const [key, value] of puts) {
        await apiFetch<unknown>(`/admin/settings/${encodeURIComponent(key)}`, {
          method: "PUT",
          body: JSON.stringify({ value }),
        });
      }
      setBackupForm((f) => ({ ...f, s3_secret_key: "" }));
      setBackupMsg("Backup settings saved and applied.");
      await refreshStatus();
    } catch (err) {
      setBackupMsg(err instanceof Error ? `Save failed: ${err.message}` : "Save failed.");
    } finally {
      setBackupSaving(false);
    }
  }

  async function runBackup(target: "local" | "cloud") {
    setBackupMsg("");
    try {
      const res = await apiFetch<{ success: boolean; target?: string; error?: string }>("/backups/run", {
        method: "POST",
        body: JSON.stringify({ target }),
      });
      setBackupMsg(
        res.success
          ? `${target === "cloud" ? "Cloud" : "Local"} backup finished.`
          : `${target === "cloud" ? "Cloud" : "Local"} backup failed: ${res.error ?? "unknown error"}`,
      );
    } catch (err) {
      setBackupMsg(`Backup failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      await refreshStatus();
    }
  }

  async function runVerify() {
    setBackupMsg("");
    try {
      await apiFetch<{ success: boolean }>("/backups/verify", { method: "POST" });
      setBackupMsg("Verification finished. See job history below for the result.");
    } catch (err) {
      setBackupMsg(`Verification failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      await refreshStatus();
    }
  }

  async function handleDownloadUpdate() {
    setDlError("");
    setDlBusy(true);
    try {
      await downloadInstaller();
    } catch (err) {
      setDlError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setDlBusy(false);
    }
  }

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  const healthColor = backupStatus?.health_status === "healthy" ? "#15803d" : "#b45309";
  const lastLocal = backupStatus?.last_local;
  const lastCloud = backupStatus?.last_cloud;

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
          <input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} style={input} placeholder="http://127.0.0.1:8080" />
          <button type="submit" style={button}>
            Save
          </button>
        </form>
        {saved && <p style={{ color: "#15803d", fontSize: "0.8rem" }}>Saved. Reconnect to apply.</p>}
      </section>

      <section style={section}>
        <h3 style={sub}>Hospital network &amp; app updates</h3>
        <p style={hint}>
          This PC is the hospital server. Other PCs connect over WiFi (no internet needed) by
          entering this address in their Connection settings. When a new version is installed here,
          staff PCs can download it straight from this server.
        </p>
        <div style={row}>
          <button type="button" onClick={handleDownloadUpdate} disabled={dlBusy} style={button}>
            {dlBusy ? "Downloading…" : "Download app update"}
          </button>
        </div>
        {dlError && <p style={{ color: "#b91c1c", fontSize: "0.8rem" }}>{dlError}</p>}
        <p style={hint}>
          {dlError === ""
            ? "Note: the server serves the installer only when APP_INSTALLER_PATH is set on the main PC."
            : ""}
        </p>
      </section>

      {serverInfo?.isServer && (
        <section style={section}>
          <h3 style={sub}>Hospital server (this PC)</h3>
          <p style={hint}>
            This install bundles the database and server, which are started automatically in the
            background - no terminal needed. Keep this PC powered on; it runs the hospital.
          </p>
          {serverInfo.running ? (
            <p style={{ fontSize: "0.85rem", color: "#15803d" }}>● Server running on port 8080</p>
          ) : (
            <p style={{ fontSize: "0.85rem", color: "#b91c1c" }}>
              ● Server failed to start: {serverInfo.error || "unknown error"}
            </p>
          )}
          {serverInfo.superadminUsername && (
            <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              <div style={{ fontSize: "0.85rem", color: "#334155" }}>
                <strong>First sign-in:</strong> username <code style={codeStyle}>{serverInfo.superadminUsername}</code>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <span style={{ fontSize: "0.85rem", color: "#334155" }}>
                  password <code style={codeStyle}>{serverInfo.superadminPassword}</code>
                </span>
                <button
                  type="button"
                  onClick={() => void copyText("password", serverInfo.superadminPassword ?? "")}
                  style={secondaryBtn}
                >
                  {copied === "password" ? "Copied!" : "Copy"}
                </button>
              </div>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "#b45309" }}>
                Change it after signing in (Settings → Change password). Keep this PC's screen and
                network secure.
              </p>
            </div>
          )}
        </section>
      )}

      {isSuperAdmin && (
        <section style={section}>
          <h3 style={sub}>Backup &amp; cloud storage (Super Admin)</h3>
          <p style={hint}>
            Backups are encrypted before leaving this PC. Enter your cloud object-storage details
            (any S3-compatible provider: Amazon S3, Backblaze B2, Cloudflare R2, MinIO…) so the
            hospital data is safe even if the building is not. The encryption key is set on the
            server (BACKUP_ENCRYPTION_KEY) and is never stored here.
          </p>

          {statusError && <p style={{ color: "#b91c1c", fontSize: "0.8rem" }}>{statusError}</p>}

          {backupStatus && (
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "0.75rem", marginBottom: "0.75rem", fontSize: "0.85rem" }}>
              <strong style={{ color: healthColor }}>
                {backupStatus.health_status === "healthy" ? "Backups healthy" : `Health: ${backupStatus.health_status || "unknown"}`}
              </strong>
              {backupStatus.enabled ? (
                <span style={{ color: "#64748b" }}>
                  {" "}· automatic backups enabled
                  {backupStatus.next_local_at ? ` · next local ${new Date(backupStatus.next_local_at).toLocaleString()}` : ""}
                  {backupStatus.next_cloud_at ? ` · next cloud ${new Date(backupStatus.next_cloud_at).toLocaleString()}` : ""}
                </span>
              ) : (
                <span style={{ color: "#b45309" }}> · backups disabled</span>
              )}
              <div style={{ marginTop: "0.25rem", color: "#64748b" }}>
                Last local: {lastLocal ? `${lastLocal.status}${lastLocal.error_message ? ` — ${lastLocal.error_message}` : ""} (${new Date(lastLocal.started_at).toLocaleString()})` : "none"}
                {" · "}Last cloud: {lastCloud ? `${lastCloud.status}${lastCloud.error_message ? ` — ${lastCloud.error_message}` : ""} (${new Date(lastCloud.started_at).toLocaleString()})` : "none"}
                {" · "}Storage: {backupStatus.storage_bytes ? `${(backupStatus.storage_bytes / 1024 / 1024).toFixed(1)} MB` : "0 MB"}
              </div>
            </div>
          )}

          {!backupLoaded && <p style={hint}>Loading backup settings…</p>}

          <form onSubmit={handleSaveBackup} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <label style={checkLabel}>
              <input
                type="checkbox"
                checked={backupForm.enabled}
                onChange={(e) => setBackupForm((f) => ({ ...f, enabled: e.target.checked }))}
              />
              Enable automatic backups
            </label>

            <div style={twoCol}>
              <label style={label}>
                Local backup folder
                <input value={backupForm.local_dir} onChange={(e) => setBackupForm((f) => ({ ...f, local_dir: e.target.value }))} style={input} placeholder="./backups" />
              </label>
              <label style={label}>
                Cloud endpoint
                <input value={backupForm.s3_endpoint} onChange={(e) => setBackupForm((f) => ({ ...f, s3_endpoint: e.target.value }))} style={input} placeholder="https://s3.amazonaws.com" />
              </label>
              <label style={label}>
                Region
                <input value={backupForm.s3_region} onChange={(e) => setBackupForm((f) => ({ ...f, s3_region: e.target.value }))} style={input} placeholder="us-east-1" />
              </label>
              <label style={label}>
                Bucket
                <input value={backupForm.s3_bucket} onChange={(e) => setBackupForm((f) => ({ ...f, s3_bucket: e.target.value }))} style={input} placeholder="hims-backups" />
              </label>
              <label style={label}>
                Prefix (optional)
                <input value={backupForm.s3_prefix} onChange={(e) => setBackupForm((f) => ({ ...f, s3_prefix: e.target.value }))} style={input} placeholder="hospital/" />
              </label>
              <label style={label}>
                Access key
                <input value={backupForm.s3_access_key} onChange={(e) => setBackupForm((f) => ({ ...f, s3_access_key: e.target.value }))} style={input} placeholder="AKIA…" />
              </label>
              <label style={label}>
                Secret key
                <input
                  type="password"
                  value={backupForm.s3_secret_key}
                  onChange={(e) => setBackupForm((f) => ({ ...f, s3_secret_key: e.target.value }))}
                  style={input}
                  placeholder="leave blank to keep the current key"
                />
              </label>
            </div>

            <label style={checkLabel}>
              <input
                type="checkbox"
                checked={backupForm.s3_path_style}
                onChange={(e) => setBackupForm((f) => ({ ...f, s3_path_style: e.target.checked }))}
              />
              Use path-style URLs (required for MinIO and some self-hosted storage)
            </label>

            <div style={twoCol}>
              <label style={label}>
                Keep daily backups
                <input value={backupForm.retention_daily} onChange={(e) => setBackupForm((f) => ({ ...f, retention_daily: e.target.value }))} style={input} />
              </label>
              <label style={label}>
                Keep weekly backups
                <input value={backupForm.retention_weekly} onChange={(e) => setBackupForm((f) => ({ ...f, retention_weekly: e.target.value }))} style={input} />
              </label>
              <label style={label}>
                Keep monthly backups
                <input value={backupForm.retention_monthly} onChange={(e) => setBackupForm((f) => ({ ...f, retention_monthly: e.target.value }))} style={input} />
              </label>
              <label style={label}>
                Local interval
                <input value={backupForm.local_interval} onChange={(e) => setBackupForm((f) => ({ ...f, local_interval: e.target.value }))} style={input} placeholder="24h" />
              </label>
              <label style={label}>
                Cloud upload interval
                <input value={backupForm.cloud_interval} onChange={(e) => setBackupForm((f) => ({ ...f, cloud_interval: e.target.value }))} style={input} placeholder="24h" />
              </label>
              <label style={label}>
                Verify interval
                <input value={backupForm.verify_interval} onChange={(e) => setBackupForm((f) => ({ ...f, verify_interval: e.target.value }))} style={input} placeholder="24h" />
              </label>
            </div>

            <div style={{ ...row, flexWrap: "wrap" }}>
              <button type="submit" disabled={backupSaving} style={button}>
                {backupSaving ? "Saving…" : "Save backup settings"}
              </button>
              <button type="button" onClick={() => void runBackup("local")} style={secondaryBtn}>
                Run backup now
              </button>
              <button type="button" onClick={() => void runBackup("cloud")} style={secondaryBtn}>
                Upload to cloud now
              </button>
              <button type="button" onClick={() => void runVerify()} style={secondaryBtn}>
                Verify latest backup
              </button>
            </div>
            {backupMsg && <p style={{ color: backupMsg.startsWith("Save failed") || backupMsg.includes("failed") ? "#b91c1c" : "#15803d", fontSize: "0.8rem" }}>{backupMsg}</p>}
          </form>

          {backupStatus && backupStatus.recent_jobs.length > 0 && (
            <div style={{ marginTop: "1rem" }}>
              <h4 style={{ margin: "0 0 0.35rem", fontSize: "0.85rem", fontWeight: 700, color: "#0f172a" }}>Recent backup jobs</h4>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                <thead>
                  <tr style={{ color: "#64748b", textAlign: "left" }}>
                    <th style={th}>Type</th>
                    <th style={th}>Status</th>
                    <th style={th}>Started</th>
                    <th style={th}>Size</th>
                    <th style={th}>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {backupStatus.recent_jobs.slice(0, 8).map((j) => (
                    <tr key={j.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                      <td style={td}>{j.job_type}</td>
                      <td style={td}>
                        <span style={{ color: j.status === "success" ? "#15803d" : j.status === "failed" ? "#b91c1c" : "#b45309" }}>{j.status}</span>
                      </td>
                      <td style={td}>{new Date(j.started_at).toLocaleString()}</td>
                      <td style={td}>{j.size_bytes ? `${(j.size_bytes / 1024 / 1024).toFixed(2)} MB` : "—"}</td>
                      <td style={td}>{j.error_message ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

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
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required style={input} placeholder="Current password" />
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} style={input} placeholder="New password (min 8 characters)" />
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

const wrap: CSSProperties = { padding: "1.5rem", maxWidth: "720px" };
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
const row: CSSProperties = { display: "flex", gap: "0.5rem", alignItems: "center" };
const twoCol: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "0.5rem",
};
const label: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "#334155",
};
const checkLabel: CSSProperties = { display: "flex", gap: "0.4rem", alignItems: "center", fontSize: "0.85rem", color: "#334155", fontWeight: 600 };
const input: CSSProperties = {
  padding: "0.5rem",
  borderRadius: "6px",
  border: "1px solid #cbd5e1",
  fontSize: "0.85rem",
  width: "100%",
  boxSizing: "border-box",
};
const button: CSSProperties = {
  padding: "0.55rem 1rem",
  borderRadius: "6px",
  border: "none",
  background: "#0f172a",
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer",
};
const secondaryBtn: CSSProperties = {
  padding: "0.55rem 1rem",
  borderRadius: "6px",
  border: "1px solid #cbd5e1",
  background: "#f8fafc",
  color: "#334155",
  fontWeight: 600,
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
const th: CSSProperties = { padding: "0.3rem 0.5rem", fontWeight: 700 };
const td: CSSProperties = { padding: "0.3rem 0.5rem", color: "#334155", verticalAlign: "top" };
const codeStyle: CSSProperties = { background: "#f1f5f9", padding: "0.1rem 0.35rem", borderRadius: "4px", fontSize: "0.8rem" };
