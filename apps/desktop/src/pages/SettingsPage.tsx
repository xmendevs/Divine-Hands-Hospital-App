import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import {
  theme,
  Button,
  Card,
  Checkbox,
  DataTable,
  FormField,
  Input,
  PageHeader,
  StatusBadge,
  type StatusVariant,
} from "@hims/ui";
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
  cloud_destination: string; // "s3" (object storage) or "neon" (serverless Postgres)
  local_dir: string;
  neon_connection_string: string;
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
  cloud_destination: "s3",
  local_dir: "",
  neon_connection_string: "",
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

function jobStatusBadge(status: string): StatusVariant {
  if (status === "success") return "approved";
  if (status === "failed") return "error";
  if (status === "running" || status === "pending") return "running";
  return "draft";
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
  const [neonTestMsg, setNeonTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [neonTesting, setNeonTesting] = useState(false);

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
        const settings = (await apiFetch<SystemSetting[]>("/admin/settings")) ?? [];
        if (cancelled) return;
        const get = (key: string) => settings.find((s) => s.key === key)?.value;
        setBackupForm({
          enabled: bool(get("backup.enabled")),
          cloud_destination: str(get("backup.cloud_destination")) || "s3",
          local_dir: str(get("backup.local_dir")),
          // The Neon connection string is a secret: never load it back, keep
          // the field blank so a blank save preserves the stored value.
          neon_connection_string: "",
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
        ["backup.cloud_destination", backupForm.cloud_destination],
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
      // Only write the secrets when the user typed one, so a blank field
      // keeps the previously stored value.
      if (backupForm.s3_secret_key.trim() !== "") {
        puts.push(["backup.s3.secret_key", backupForm.s3_secret_key.trim()]);
      }
      if (backupForm.neon_connection_string.trim() !== "") {
        puts.push(["backup.neon.connection_string", backupForm.neon_connection_string.trim()]);
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

  async function testNeon() {
    setNeonTestMsg(null);
    setNeonTesting(true);
    try {
      const typed = backupForm.neon_connection_string.trim();
      const res = await apiFetch<{
        ok: boolean;
        serverVersion?: string;
        database?: string;
        error?: string;
      }>("/backups/test-neon", {
        method: "POST",
        body: JSON.stringify(typed !== "" ? { connectionString: typed } : {}),
      });
      setNeonTestMsg(
        res.ok
          ? {
              ok: true,
              text: `Connected to Neon database \u201c${res.database ?? ""}\u201d (${res.serverVersion ?? ""})`,
            }
          : { ok: false, text: res.error ?? "Connection failed." },
      );
    } catch (err) {
      setNeonTestMsg({
        ok: false,
        text: err instanceof Error ? err.message : "Connection failed.",
      });
    } finally {
      setNeonTesting(false);
    }
  }

  async function runBackup(target: "local" | "cloud") {
    setBackupMsg("");
    try {
      const res = await apiFetch<{ success: boolean; target?: string; error?: string }>(
        "/backups/run",
        {
          method: "POST",
          body: JSON.stringify({ target }),
        },
      );
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

  const healthColor =
    backupStatus?.health_status === "healthy" ? theme.action.success : theme.action.warning;
  const lastLocal = backupStatus?.last_local;
  const lastCloud = backupStatus?.last_cloud;

  const jobsColumns = [
    { key: "type", header: "Type", render: (j: BackupJob) => j.job_type },
    {
      key: "status",
      header: "Status",
      render: (j: BackupJob) => <StatusBadge variant={jobStatusBadge(j.status)} label={j.status} />,
    },
    {
      key: "started",
      header: "Started",
      render: (j: BackupJob) => new Date(j.started_at).toLocaleString(),
    },
    {
      key: "size",
      header: "Size",
      render: (j: BackupJob) =>
        j.size_bytes ? `${(j.size_bytes / 1024 / 1024).toFixed(2)} MB` : "—",
    },
    { key: "error", header: "Error", render: (j: BackupJob) => j.error_message ?? "—" },
  ];

  return (
    <div style={{ maxWidth: 860 }}>
      <PageHeader
        title="System Settings & Administration"
        description="Server connection, hospital network, backups and account security."
      />

      {me?.mustChangePassword && (
        <div
          role="alert"
          style={{
            padding: theme.spacing["3"],
            borderRadius: theme.radius.md,
            background: theme.surface.error,
            color: theme.text.danger,
            fontSize: theme.fontSize.base,
            marginBottom: theme.spacing["4"],
            border: `1px solid ${theme.surface.errorBorder}`,
          }}
        >
          You must change your password before continuing.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["4"] }}>
        <Card
          title="Server Connection"
          hint="The address of the main PC running the backend. Other PCs set this to the main PC's network address (e.g. http://192.168.1.10:8080)."
        >
          <form
            onSubmit={handleSaveUrl}
            style={{
              display: "flex",
              gap: theme.spacing["2"],
              alignItems: "center",
              maxWidth: 480,
            }}
          >
            <Input
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://127.0.0.1:8080"
              style={{ flex: 1 }}
            />
            <Button type="submit">Save</Button>
          </form>
          {saved && (
            <p
              style={{
                margin: `${theme.spacing["2"]} 0 0`,
                color: theme.action.success,
                fontSize: theme.fontSize.base,
              }}
            >
              Saved. Reconnect to apply.
            </p>
          )}
        </Card>

        <Card
          title="Hospital Network & App Updates"
          hint="This PC is the hospital server. Other PCs connect over WiFi (no internet needed) by entering this address in their Connection settings. When a new version is installed here, staff PCs can download it straight from this server."
        >
          <Button onClick={() => void handleDownloadUpdate()} loading={dlBusy}>
            Download app update
          </Button>
          {dlError && (
            <p
              style={{
                margin: `${theme.spacing["2"]} 0 0`,
                color: theme.text.danger,
                fontSize: theme.fontSize.base,
              }}
            >
              {dlError}
            </p>
          )}
          {dlError === "" && (
            <p
              style={{
                margin: `${theme.spacing["2"]} 0 0`,
                fontSize: theme.fontSize.sm,
                color: theme.text.muted,
              }}
            >
              Note: the server serves the installer only when APP_INSTALLER_PATH is set on the main
              PC.
            </p>
          )}
        </Card>

        {serverInfo?.isServer && (
          <Card
            title="Hospital Server (This PC)"
            hint="This install bundles the database and server, which are started automatically in the background - no terminal needed. Keep this PC powered on; it runs the hospital."
          >
            {serverInfo.running ? (
              <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.action.success }}>
                ● Server running on port 8080
              </p>
            ) : (
              <p style={{ margin: 0, fontSize: theme.fontSize.base, color: theme.text.danger }}>
                ● Server failed to start: {serverInfo.error || "unknown error"}
              </p>
            )}
            {serverInfo.superadminUsername && (
              <div
                style={{
                  marginTop: theme.spacing["3"],
                  display: "flex",
                  flexDirection: "column",
                  gap: theme.spacing["2"],
                }}
              >
                <div style={{ fontSize: theme.fontSize.base, color: theme.text.secondary }}>
                  <strong>First sign-in:</strong> username{" "}
                  <code style={codeStyle}>{serverInfo.superadminUsername}</code>
                </div>
                <div style={{ display: "flex", gap: theme.spacing["2"], alignItems: "center" }}>
                  <span style={{ fontSize: theme.fontSize.base, color: theme.text.secondary }}>
                    password <code style={codeStyle}>{serverInfo.superadminPassword}</code>
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void copyText("password", serverInfo.superadminPassword ?? "")}
                  >
                    {copied === "password" ? "Copied!" : "Copy"}
                  </Button>
                </div>
                <p style={{ margin: 0, fontSize: theme.fontSize.sm, color: theme.action.warning }}>
                  Change it after signing in (Settings → Change password). Keep this PC's screen and
                  network secure.
                </p>
              </div>
            )}
          </Card>
        )}

        {isSuperAdmin && (
          <Card
            title="Backup & Cloud Storage"
            hint={
              <>
                Backups are encrypted before leaving this PC. Choose a cloud destination below —{" "}
                <strong>Neon Postgres</strong> (a serverless cloud database) or any S3-compatible
                object store (Amazon S3, Backblaze B2, Cloudflare R2, MinIO…) — so the hospital data
                is safe even if the building is not. The encryption key is set on the server
                (BACKUP_ENCRYPTION_KEY) and is never stored here.
              </>
            }
          >
            {statusError && (
              <p
                style={{
                  margin: `0 0 ${theme.spacing["3"]}`,
                  color: theme.text.danger,
                  fontSize: theme.fontSize.base,
                }}
              >
                {statusError}
              </p>
            )}

            {backupStatus && (
              <div
                style={{
                  background: theme.surface.subtle,
                  border: `1px solid ${theme.surface.border}`,
                  borderRadius: theme.radius.md,
                  padding: theme.spacing["3"],
                  marginBottom: theme.spacing["3"],
                  fontSize: theme.fontSize.base,
                }}
              >
                <strong style={{ color: healthColor }}>
                  {backupStatus.health_status === "healthy"
                    ? "Backups healthy"
                    : `Health: ${backupStatus.health_status || "unknown"}`}
                </strong>
                {backupStatus.enabled ? (
                  <span style={{ color: theme.text.muted }}>
                    {" "}
                    · automatic backups enabled
                    {backupStatus.next_local_at
                      ? ` · next local ${new Date(backupStatus.next_local_at).toLocaleString()}`
                      : ""}
                    {backupStatus.next_cloud_at
                      ? ` · next cloud ${new Date(backupStatus.next_cloud_at).toLocaleString()}`
                      : ""}
                  </span>
                ) : (
                  <span style={{ color: theme.action.warning }}> · backups disabled</span>
                )}
                <div style={{ marginTop: theme.spacing["1"], color: theme.text.muted }}>
                  Last local:{" "}
                  {lastLocal
                    ? `${lastLocal.status}${lastLocal.error_message ? ` — ${lastLocal.error_message}` : ""} (${new Date(lastLocal.started_at).toLocaleString()})`
                    : "none"}
                  {" · "}Last cloud:{" "}
                  {lastCloud
                    ? `${lastCloud.status}${lastCloud.error_message ? ` — ${lastCloud.error_message}` : ""} (${new Date(lastCloud.started_at).toLocaleString()})`
                    : "none"}
                  {" · "}Storage:{" "}
                  {backupStatus.storage_bytes
                    ? `${(backupStatus.storage_bytes / 1024 / 1024).toFixed(1)} MB`
                    : "0 MB"}
                </div>
              </div>
            )}

            {!backupLoaded && (
              <p
                style={{
                  margin: `0 0 ${theme.spacing["2"]}`,
                  fontSize: theme.fontSize.base,
                  color: theme.text.muted,
                }}
              >
                Loading backup settings…
              </p>
            )}

            <form
              onSubmit={handleSaveBackup}
              style={{ display: "flex", flexDirection: "column", gap: theme.spacing["3"] }}
            >
              <Checkbox
                checked={backupForm.enabled}
                onChange={(e) => setBackupForm((f) => ({ ...f, enabled: e.target.checked }))}
                label="Enable automatic backups"
              />

              <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["1"] }}>
                <span
                  style={{
                    fontSize: theme.fontSize.sm,
                    fontWeight: theme.fontWeight.bold,
                    color: theme.text.secondary,
                  }}
                >
                  Cloud backup destination
                </span>
                <label style={checkLabel}>
                  <input
                    type="radio"
                    name="cloud_destination"
                    checked={backupForm.cloud_destination === "neon"}
                    onChange={() => setBackupForm((f) => ({ ...f, cloud_destination: "neon" }))}
                    style={{ accentColor: theme.action.primary }}
                  />
                  Neon Postgres (serverless cloud database)
                </label>
                <label style={checkLabel}>
                  <input
                    type="radio"
                    name="cloud_destination"
                    checked={backupForm.cloud_destination === "s3"}
                    onChange={() => setBackupForm((f) => ({ ...f, cloud_destination: "s3" }))}
                    style={{ accentColor: theme.action.primary }}
                  />
                  S3-compatible object storage (Amazon S3, Backblaze B2, Cloudflare R2, MinIO…)
                </label>
              </div>

              <FormField label="Local backup folder">
                <Input
                  value={backupForm.local_dir}
                  onChange={(e) => setBackupForm((f) => ({ ...f, local_dir: e.target.value }))}
                  placeholder="./backups"
                />
              </FormField>

              {backupForm.cloud_destination === "neon" && (
                <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["2"] }}>
                  <p style={hint}>
                    Each cloud backup replaces the data in your Neon database with a fresh copy of
                    the hospital database (a point-in-time snapshot). Create a free project at
                    neon.tech, then paste its <strong>connection string</strong> (Neon console →
                    Connect → Connection string, e.g.{" "}
                    <code style={codeStyle}>
                      postgresql://user:password@ep-…aws.neon.tech/dbname
                    </code>
                    ).
                  </p>
                  <p style={hint}>
                    In the Neon console, open <strong>Settings → IP Allow</strong> and add{" "}
                    <code style={codeStyle}>0.0.0.0/0</code>: the hospital&apos;s internet address
                    changes, so it cannot be allowlisted by IP. Use a strong password and keep this
                    PC on the hospital network only.
                  </p>
                  <FormField label="Neon connection string">
                    <Input
                      type="password"
                      value={backupForm.neon_connection_string}
                      onChange={(e) =>
                        setBackupForm((f) => ({ ...f, neon_connection_string: e.target.value }))
                      }
                      placeholder="postgresql://user:password@ep-…aws.neon.tech/dbname (blank keeps the stored one)"
                    />
                  </FormField>
                  <div>
                    <Button variant="outline" onClick={() => void testNeon()} loading={neonTesting}>
                      Test Neon connection
                    </Button>
                  </div>
                  {neonTestMsg && (
                    <p
                      style={{
                        color: neonTestMsg.ok ? theme.action.success : theme.text.danger,
                        fontSize: theme.fontSize.base,
                        margin: 0,
                      }}
                    >
                      {neonTestMsg.text}
                    </p>
                  )}
                </div>
              )}

              {backupForm.cloud_destination === "s3" && (
                <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing["2"] }}>
                  <div style={twoCol}>
                    <FormField label="Cloud endpoint">
                      <Input
                        value={backupForm.s3_endpoint}
                        onChange={(e) =>
                          setBackupForm((f) => ({ ...f, s3_endpoint: e.target.value }))
                        }
                        placeholder="https://s3.amazonaws.com"
                      />
                    </FormField>
                    <FormField label="Region">
                      <Input
                        value={backupForm.s3_region}
                        onChange={(e) =>
                          setBackupForm((f) => ({ ...f, s3_region: e.target.value }))
                        }
                        placeholder="us-east-1"
                      />
                    </FormField>
                    <FormField label="Bucket">
                      <Input
                        value={backupForm.s3_bucket}
                        onChange={(e) =>
                          setBackupForm((f) => ({ ...f, s3_bucket: e.target.value }))
                        }
                        placeholder="hims-backups"
                      />
                    </FormField>
                    <FormField label="Prefix (optional)">
                      <Input
                        value={backupForm.s3_prefix}
                        onChange={(e) =>
                          setBackupForm((f) => ({ ...f, s3_prefix: e.target.value }))
                        }
                        placeholder="hospital/"
                      />
                    </FormField>
                    <FormField label="Access key">
                      <Input
                        value={backupForm.s3_access_key}
                        onChange={(e) =>
                          setBackupForm((f) => ({ ...f, s3_access_key: e.target.value }))
                        }
                        placeholder="AKIA…"
                      />
                    </FormField>
                    <FormField label="Secret key">
                      <Input
                        type="password"
                        value={backupForm.s3_secret_key}
                        onChange={(e) =>
                          setBackupForm((f) => ({ ...f, s3_secret_key: e.target.value }))
                        }
                        placeholder="leave blank to keep the current key"
                      />
                    </FormField>
                  </div>

                  <Checkbox
                    checked={backupForm.s3_path_style}
                    onChange={(e) =>
                      setBackupForm((f) => ({ ...f, s3_path_style: e.target.checked }))
                    }
                    label="Use path-style URLs (required for MinIO and some self-hosted storage)"
                  />
                </div>
              )}

              <div style={twoCol}>
                <FormField label="Keep daily backups">
                  <Input
                    value={backupForm.retention_daily}
                    onChange={(e) =>
                      setBackupForm((f) => ({ ...f, retention_daily: e.target.value }))
                    }
                  />
                </FormField>
                <FormField label="Keep weekly backups">
                  <Input
                    value={backupForm.retention_weekly}
                    onChange={(e) =>
                      setBackupForm((f) => ({ ...f, retention_weekly: e.target.value }))
                    }
                  />
                </FormField>
                <FormField label="Keep monthly backups">
                  <Input
                    value={backupForm.retention_monthly}
                    onChange={(e) =>
                      setBackupForm((f) => ({ ...f, retention_monthly: e.target.value }))
                    }
                  />
                </FormField>
                <FormField label="Local interval">
                  <Input
                    value={backupForm.local_interval}
                    onChange={(e) =>
                      setBackupForm((f) => ({ ...f, local_interval: e.target.value }))
                    }
                    placeholder="24h"
                  />
                </FormField>
                <FormField label="Cloud upload interval">
                  <Input
                    value={backupForm.cloud_interval}
                    onChange={(e) =>
                      setBackupForm((f) => ({ ...f, cloud_interval: e.target.value }))
                    }
                    placeholder="24h"
                  />
                </FormField>
                <FormField label="Verify interval">
                  <Input
                    value={backupForm.verify_interval}
                    onChange={(e) =>
                      setBackupForm((f) => ({ ...f, verify_interval: e.target.value }))
                    }
                    placeholder="24h"
                  />
                </FormField>
              </div>

              <div style={{ display: "flex", gap: theme.spacing["2"], flexWrap: "wrap" }}>
                <Button type="submit" loading={backupSaving}>
                  Save backup settings
                </Button>
                <Button variant="outline" onClick={() => void runBackup("local")}>
                  Run backup now
                </Button>
                <Button variant="outline" onClick={() => void runBackup("cloud")}>
                  Upload to cloud now
                </Button>
                <Button variant="outline" onClick={() => void runVerify()}>
                  Verify latest backup
                </Button>
              </div>
              {backupMsg && (
                <p
                  style={{
                    color:
                      backupMsg.startsWith("Save failed") || backupMsg.includes("failed")
                        ? theme.text.danger
                        : theme.action.success,
                    fontSize: theme.fontSize.base,
                  }}
                >
                  {backupMsg}
                </p>
              )}
            </form>
          </Card>
        )}

        {isSuperAdmin && backupStatus && backupStatus.recent_jobs.length > 0 && (
          <Card
            title="Backup Activity & Logs"
            hint="Recent backup jobs across local, cloud and verification targets."
          >
            <DataTable
              columns={jobsColumns}
              rows={backupStatus.recent_jobs.slice(0, 8)}
              rowKey={(j) => j.id}
              dense
            />
          </Card>
        )}

        <Card title="User Account & Password">
          <p
            style={{
              margin: `0 0 ${theme.spacing["3"]}`,
              fontSize: theme.fontSize.base,
              color: theme.text.secondary,
            }}
          >
            Signed in as <strong>{me?.username}</strong>
            {me?.roles?.length ? ` — ${me.roles.map((r) => r.name).join(", ")}` : ""}
          </p>
          <form
            onSubmit={handleChangePassword}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: theme.spacing["2"],
              maxWidth: 480,
            }}
          >
            <FormField label="Current password">
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                placeholder="Current password"
              />
            </FormField>
            <FormField label="New password">
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                placeholder="New password (min 8 characters)"
              />
            </FormField>
            <div>
              <Button type="submit" loading={busy}>
                Change password
              </Button>
            </div>
          </form>
          {pwdError && (
            <p
              style={{
                margin: `${theme.spacing["2"]} 0 0`,
                color: theme.text.danger,
                fontSize: theme.fontSize.base,
              }}
            >
              {pwdError}
            </p>
          )}
          {pwdOk && (
            <p
              style={{
                margin: `${theme.spacing["2"]} 0 0`,
                color: theme.action.success,
                fontSize: theme.fontSize.base,
              }}
            >
              {pwdOk}
            </p>
          )}
        </Card>

        <div>
          <Button variant="danger" onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}

const hint: CSSProperties = { margin: 0, fontSize: theme.fontSize.base, color: theme.text.muted };
const twoCol: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: theme.spacing["3"],
};
const checkLabel: CSSProperties = {
  display: "flex",
  gap: theme.spacing["2"],
  alignItems: "center",
  fontSize: theme.fontSize.base,
  color: theme.text.secondary,
  fontWeight: theme.fontWeight.semibold,
  cursor: "pointer",
};
const codeStyle: CSSProperties = {
  background: theme.surface.subtle,
  padding: "0.1rem 0.35rem",
  borderRadius: theme.radius.sm,
  fontSize: theme.fontSize.base,
};
