// Electron main process entry for the Divine Hands Hospital desktop client.
//
// Named .cjs on purpose: the package.json declares "type": "module" (Vite
// convention), so a .js entry would be loaded as an ES module and `require`
// would crash. Electron treats .cjs as CommonJS regardless of "type".
//
// The packaged app loads the production build produced by `pnpm build`
// (dist/index.html). The renderer talks to the Go API over plain HTTP at
// http://127.0.0.1:8080 (configurable in the Settings page), which the API
// allows cross-origin (Access-Control-Allow-Origin: *).
//
// Server edition: when the installer bundles a server payload (resources/server
// next to the executable), this machine is the hospital server. On launch we
// ensure PostgreSQL and the Go API are running (init once, then start if
// needed) so the operator never touches a terminal. The server keeps running
// when the window closes so the other PCs stay connected over WiFi.
//
// For development against the Vite dev server, run:
//   VITE_DEV_SERVER_URL=http://localhost:1420 electron .
// (start the dev server first with `pnpm dev`.)

const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const net = require("net");
const { spawn, spawnSync } = require("child_process");

const API_PORT = 8080;
const APP_STATE_DIR = path.join(app.getPath("appData"), "Divine Hands Hospital", "server");

// Windows executables carry a .exe suffix; on Linux the bundled PostgreSQL
// and Go binaries are plain executables. The server payload is assembled by
// scripts/build-server-payload.mjs with the same bin/pgsql layout on both
// platforms, so only the suffix differs here.
const IS_WINDOWS = process.platform === "win32";
const EXE = IS_WINDOWS ? ".exe" : "";

// ---------------------------------------------------------------------------
// Server management (server edition only)
// ---------------------------------------------------------------------------

function serverDir() {
  if (process.env.HIMS_SERVER_DIR) return process.env.HIMS_SERVER_DIR;
  if (app.isPackaged && fs.existsSync(path.join(process.resourcesPath, "server"))) {
    return path.join(process.resourcesPath, "server");
  }
  return null;
}

function bin(...parts) {
  return path.join(serverDir(), "bin", ...parts);
}

function state(...parts) {
  return path.join(APP_STATE_DIR, ...parts);
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

function logProgress(msg) {
  try {
    fs.mkdirSync(APP_STATE_DIR, { recursive: true });
    fs.appendFileSync(state("startup.log"), new Date().toISOString() + " " + msg + "\n");
  } catch {
    /* logging is best-effort */
  }
}

function loadServerConfig() {
  const cfgPath = state("server.json");
  const defaults = {
    pgPort: 5432,
    pgUser: "hims",
    pgPassword: randomHex(16),
    apiPort: API_PORT,
    superadminUsername: "superadmin",
    superadminPassword: randomHex(10),
    mfaKey: randomHex(32),
    backupKey: randomHex(32),
  };
  if (!fs.existsSync(cfgPath)) {
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    fs.writeFileSync(cfgPath, JSON.stringify(defaults, null, 2), { mode: 0o600 });
    return defaults;
  }
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(cfgPath, "utf8")) };
  } catch {
    return defaults;
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port, timeout: 800 });
    sock.on("connect", () => {
      sock.destroy();
      resolve(false);
    });
    sock.on("error", () => resolve(true));
    sock.on("timeout", () => {
      sock.destroy();
      resolve(true);
    });
  });
}

async function waitFor(fn, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function startPostgres(cfg) {
  const pgData = state("pgdata");
  const pgCtl = bin("pgsql", "bin", "pg_ctl" + EXE);
  const initdb = bin("pgsql", "bin", "initdb" + EXE);
  const createdb = bin("pgsql", "bin", "createdb" + EXE);
  const psql = bin("pgsql", "bin", "psql" + EXE);
  const pgIsReady = bin("pgsql", "bin", "pg_isready" + EXE);

  if (!fs.existsSync(pgData)) {
    logProgress("initdb: starting");
    const pwFile = state("pgpass.tmp");
    fs.writeFileSync(pwFile, cfg.pgPassword);
    const init = spawnSync(initdb, ["-D", pgData, "-U", cfg.pgUser, "--auth=scram-sha-256", "--pwfile=" + pwFile, "--encoding=UTF8"], { encoding: "utf8", env: pgEnv(cfg), timeout: 180000 });
    try {
      fs.unlinkSync(pwFile);
    } catch {
      /* ignore */
    }
    if (init.error) throw new Error("initdb error: " + init.error.message);
    if (init.status !== 0) throw new Error("initdb failed: " + (init.stderr || init.stdout || "unknown error"));
    logProgress("initdb: done");
  }

  if (!(await portFree(cfg.pgPort))) {
    // Something already listens on the port - try an alternate port so this
    // portable instance does not clash with an existing PostgreSQL install.
    logProgress("port " + cfg.pgPort + " busy - using 55432");
    cfg.pgPort = 55432;
  }

  logProgress("pg_ctl: starting on port " + cfg.pgPort);
  // Launch pg_ctl detached with no stdio pipes: postgres.exe inherits pg_ctl's
  // handles, so a pipe-based spawnSync would never see EOF and would hang the
  // main process forever. We detect readiness via pg_isready below instead.
  const pgCtlProc = spawn(pgCtl, ["-D", pgData, "-l", state("postgres.log"), "-o", "-p " + cfg.pgPort, "start"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: pgEnv(cfg),
  });
  pgCtlProc.unref();

  const dbReady = await waitFor(
    () => spawnSync(pgIsReady, ["-h", "127.0.0.1", "-p", String(cfg.pgPort), "-U", cfg.pgUser], { encoding: "utf8", env: pgEnv(cfg), timeout: 15000 }).status === 0,
    60000,
    1000,
  );
  logProgress("pg_isready: " + (dbReady ? "ready" : "NOT ready"));
  if (!dbReady) throw new Error("PostgreSQL did not become ready on port " + cfg.pgPort);

  // Create the `hims` database if missing. -w makes psql/createdb fail instead
  // of prompting for a password (a prompt would hang the GUI app forever).
  const check = spawnSync(psql, ["-w", "-h", "127.0.0.1", "-p", String(cfg.pgPort), "-U", cfg.pgUser, "-d", "postgres", "-tAc", "SELECT 1 FROM pg_database WHERE datname='hims'"], { encoding: "utf8", env: pgEnv(cfg), timeout: 30000 });
  logProgress("psql hims check status=" + check.status + (check.error ? " error=" + check.error.message : "") + " stdout=" + JSON.stringify(check.stdout || "").slice(0, 80));
  if (check.status !== 0 || !/1/.test(check.stdout || "")) {
    const mk = spawnSync(createdb, ["-w", "-h", "127.0.0.1", "-p", String(cfg.pgPort), "-U", cfg.pgUser, "hims"], { encoding: "utf8", env: pgEnv(cfg), timeout: 30000 });
    if (mk.error) throw new Error("createdb error: " + mk.error.message);
    if (mk.status !== 0) throw new Error("createdb failed: " + (mk.stderr || "unknown error"));
    logProgress("created hims database");
  }
}

function pgEnv(cfg) {
  const env = {
    ...process.env,
    PGPASSWORD: cfg.pgPassword,
  };
  if (!IS_WINDOWS) {
    // On Linux the bundled PostgreSQL binaries dynamically link against the
    // shared libraries shipped next to them in bin/pgsql/lib (harvested by
    // build-server-payload.mjs). Point the dynamic loader at that directory
    // first so the bundle runs without a system PostgreSQL installation.
    const libDir = path.join(serverDir(), "bin", "pgsql", "lib");
    env.LD_LIBRARY_PATH = [libDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");
  }
  return env;
}

function databaseURL(cfg) {
  return `postgres://${cfg.pgUser}:${cfg.pgPassword}@127.0.0.1:${cfg.pgPort}/hims?sslmode=disable`;
}

function applyMigrationsAndSeed(cfg) {
  const env = { ...process.env, DATABASE_URL: databaseURL(cfg) };
  logProgress("migrate" + EXE + ": running");
  const migrate = spawnSync(bin("migrate" + EXE), ["-command", "up", "-dir", path.join(serverDir(), "migrations")], { encoding: "utf8", env, timeout: 180000 });
  if (migrate.error) throw new Error("migrate error: " + migrate.error.message);
  if (migrate.status !== 0) throw new Error("migrations failed: " + (migrate.stderr || migrate.stdout || "unknown error"));
  logProgress("migrate" + EXE + ": done");

  logProgress("seed" + EXE + ": running");
  const seed = spawnSync(bin("seed" + EXE), [], {
    encoding: "utf8",
    env: {
      ...env,
      SEED_SUPERADMIN_USERNAME: cfg.superadminUsername,
      SEED_SUPERADMIN_PASSWORD: cfg.superadminPassword,
    },
    timeout: 60000,
  });
  if (seed.error) throw new Error("seed error: " + seed.error.message);
  if (seed.status !== 0) throw new Error("seed failed: " + (seed.stderr || seed.stdout || "unknown error"));
  logProgress("seed" + EXE + ": done");
}

function startGoApi(cfg) {
  const env = {
    ...process.env,
    HOST: "0.0.0.0",
    PORT: String(cfg.apiPort),
    DATABASE_URL: databaseURL(cfg),
    MFA_ENCRYPTION_KEY: cfg.mfaKey,
    BACKUP_ENABLED: "true",
    BACKUP_ENCRYPTION_KEY: cfg.backupKey,
    BACKUP_PG_DUMP_PATH: bin("pgsql", "bin", "pg_dump" + EXE),
    MIGRATIONS_DIR: path.join(serverDir(), "migrations"),
  };
  if (!IS_WINDOWS) {
    // The Go API shells out to pg_dump for backups; pg_dump links against the
    // bundled shared libraries, so the API process must inherit the loader
    // path that resolves them.
    const libDir = path.join(serverDir(), "bin", "pgsql", "lib");
    env.LD_LIBRARY_PATH = [libDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");
  }
  const child = spawn(bin("go-api" + EXE), [], {
    detached: true,
    stdio: "ignore",
    env,
    windowsHide: true,
  });
  child.unref();
}

async function apiHealthy() {
  try {
    const res = await fetch(`http://127.0.0.1:${API_PORT}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

let serverState = { isServer: false, running: false, error: "" };

async function ensureServer() {
  if (!serverDir()) {
    serverState = { isServer: false, running: false, error: "" };
    return;
  }
  try {
    logProgress("ensureServer: starting");
    const cfg = loadServerConfig();
    await startPostgres(cfg);
    logProgress("ensureServer: postgres ready on " + cfg.pgPort);
    applyMigrationsAndSeed(cfg);
    logProgress("ensureServer: migrations + seed done");
    if (!(await apiHealthy())) {
      startGoApi(cfg);
    }
    logProgress("ensureServer: go-api spawned");
    const up = await waitFor(apiHealthy, 90000, 1500);
    if (!up) throw new Error("API did not become ready on port " + API_PORT);
    logProgress("ensureServer: API healthy");
    serverState = {
      isServer: true,
      running: true,
      error: "",
      superadminUsername: cfg.superadminUsername,
      superadminPassword: cfg.superadminPassword,
    };
  } catch (err) {
    serverState = { isServer: true, running: false, error: err instanceof Error ? err.message : String(err) };
    logProgress("ensureServer: FAILED - " + serverState.error);
    console.error("[server] startup failed:", serverState.error);
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: "Divine Hands Hospital",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.removeMenu();

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    win.loadURL(devServerUrl);
  } else {
    win.loadFile(path.join(__dirname, "dist", "index.html"));
  }

  // Open external links (e.g. receipt HTML/PDF served by the Go API) in the
  // user's default browser instead of inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  ipcMain.handle("hims:server-info", () => serverState);

  app.whenReady().then(async () => {
    await ensureServer();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
