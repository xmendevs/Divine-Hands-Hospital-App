// Builds the bundled server payload for the "server edition" installer:
//   server-payload/
//     bin/go-api.exe  bin/migrate.exe  bin/seed.exe
//     bin/pgsql/                      (portable PostgreSQL)
//     migrations/*.sql
//
// Run from apps/desktop:  node scripts/build-server-payload.mjs
// (the pnpm script "dist:server" runs it automatically).
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, cpSync, rmSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopDir, "..", "..");
const payloadDir = path.join(desktopDir, "server-payload");
const binDir = path.join(payloadDir, "bin");
const migrationsDir = path.join(payloadDir, "migrations");

// Portable PostgreSQL version (same source as infra/windows-bundle).
const PG_VERSION = process.env.PG_VERSION || "16.15-1";
const PG_ZIP = `postgresql-${PG_VERSION}-windows-x64-binaries.zip`;
const PG_URL = process.env.PG_URL || `https://get.enterprisedb.com/postgresql/${PG_ZIP}`;

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: "inherit", ...opts });
}

console.log("==> Building server payload into", payloadDir);
rmSync(payloadDir, { recursive: true, force: true });
mkdirSync(binDir, { recursive: true });
mkdirSync(migrationsDir, { recursive: true });

console.log("==> Compiling Go binaries for windows/amd64");
run('go build -o "' + path.join(binDir, "go-api.exe") + '" ./cmd/server', {
  cwd: path.join(repoRoot, "apps", "go-api"),
  env: { ...process.env, GOOS: "windows", GOARCH: "amd64", CGO_ENABLED: "0" },
});
run('go build -o "' + path.join(binDir, "migrate.exe") + '" ./cmd/migrate', {
  cwd: path.join(repoRoot, "apps", "go-api"),
  env: { ...process.env, GOOS: "windows", GOARCH: "amd64", CGO_ENABLED: "0" },
});
run('go build -o "' + path.join(binDir, "seed.exe") + '" ./cmd/seed', {
  cwd: path.join(repoRoot, "apps", "go-api"),
  env: { ...process.env, GOOS: "windows", GOARCH: "amd64", CGO_ENABLED: "0" },
});

console.log("==> Copying database migrations");
for (const f of readdirSync(path.join(repoRoot, "db", "migrations"))) {
  if (f.endsWith(".sql"))
    cpSync(path.join(repoRoot, "db", "migrations", f), path.join(migrationsDir, f));
}

function zipIntact(zipPath) {
  try {
    execSync(`unzip -t "${zipPath}"`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

console.log("==> Downloading portable PostgreSQL", PG_VERSION);
const tmpZip = path.join(desktopDir, "pg-download.zip");
if (existsSync(tmpZip) && statSync(tmpZip).size > 0 && zipIntact(tmpZip)) {
  console.log("    (reusing existing", tmpZip, "— delete it to force a fresh download)");
} else {
  if (existsSync(tmpZip)) rmSync(tmpZip, { force: true });
  run(`curl -fL --retry 3 "${PG_URL}" -o "${tmpZip}"`);
}
rmSync(path.join(desktopDir, "pg-extract"), { recursive: true, force: true });
run(`unzip -q "${tmpZip}" -d "${path.join(desktopDir, "pg-extract")}"`);
rmSync(tmpZip, { force: true });
if (!existsSync(path.join(desktopDir, "pg-extract", "pgsql"))) {
  console.error("ERROR: portable PostgreSQL zip did not contain a pgsql/ folder");
  process.exit(1);
}
cpSync(path.join(desktopDir, "pg-extract", "pgsql"), path.join(binDir, "pgsql"), {
  recursive: true,
});
rmSync(path.join(desktopDir, "pg-extract"), { recursive: true, force: true });

console.log("==> Server payload ready at", payloadDir);
