// Thin typed HTTP client for the Go API. No external dependencies: plain fetch,
// with the server base URL and session token persisted in localStorage so the
// same build can point at the main PC's LAN address on each workstation.

export interface ApiErrorBody {
  code: string;
  message: string;
  requestId: string;
}

export interface ApiErrorEnvelope {
  error: ApiErrorBody;
}

export class ApiError extends Error {
  status: number;
  code: string;
  requestId: string;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message || `Request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.requestId = body.requestId;
  }
}

const DEFAULT_BASE_URL = "http://127.0.0.1:8080";
const SERVER_URL_KEY = "hims_server_url";
const TOKEN_KEY = "hims_token";

export function getBaseUrl(): string {
  const stored = localStorage.getItem(SERVER_URL_KEY);
  return stored && stored.trim() ? stored.trim().replace(/\/+$/, "") : DEFAULT_BASE_URL;
}

export function setBaseUrl(url: string): void {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (trimmed) {
    localStorage.setItem(SERVER_URL_KEY, trimmed);
  } else {
    localStorage.removeItem(SERVER_URL_KEY);
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

function fallbackError(status: number, statusText: string): ApiErrorBody {
  return { code: "unknown", message: statusText || `request failed (${status})`, requestId: "" };
}

/**
 * Downloads the Windows installer from the server (requires an authenticated
 * session). Used so other hospital PCs can update the app from the Super Admin
 * PC over the local network, without internet.
 */
export async function downloadInstaller(): Promise<void> {
  const base = getBaseUrl();
  const token = getToken();
  const res = await fetch(`${base}/api/v1/downloads/installer`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const text = await res.text();
    let message = `Download failed (${res.status})`;
    try {
      const env = JSON.parse(text) as ApiErrorEnvelope;
      message = env.error?.message || message;
    } catch {
      // not JSON; keep the generic message
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "Divine Hands Hospital Setup.exe";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Performs an authenticated JSON request against the configured base URL.
 * All paths are relative to `/api/v1`, e.g. `apiFetch("/patients/search?q=x")`.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getBaseUrl();
  const token = getToken();

  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let res: Response;
  try {
    res = await fetch(`${base}/api/v1${path}`, { ...init, headers });
  } catch {
    throw new Error(
      `Cannot reach the server at ${base}. Check the main PC is on and the address is correct in Settings.`,
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }

  if (!res.ok) {
    const envelope = data as ApiErrorEnvelope | undefined;
    throw new ApiError(res.status, envelope?.error ?? fallbackError(res.status, res.statusText));
  }

  return data as T;
}
