// Builds the bundled server payload for the "server edition" installer:
//   server-payload/
//     bin/go-api[.exe]  bin/migrate[.exe]  bin/seed[.exe]
//     bin/pgsql/                          (portable PostgreSQL)
//     migrations/*.sql
//
// Platform:
//   Windows (default, TARGET_OS=windows): cross-compiles the Go binaries for
//     windows/amd64 and downloads the portable PostgreSQL zip from EDB.
//   Linux (TARGET_OS=linux): cross-compiles the Go binaries for linux/amd64
//     and assembles bin/pgsql from a system PostgreSQL 16 installation
//     (Debian/Ubuntu layout: /usr/lib/postgresql/16). The shared libraries the
//     postgres binaries link against are harvested with `ldd` into
//     bin/pgsql/lib, and main.cjs points LD_LIBRARY_PATH there, so the bundle
//     runs on any glibc >= 2.39 Linux without a system PostgreSQL. The build
//     host should be Ubuntu 24.04 (the same distro the CI runner uses).
//
// Run from apps/desktop:  node scripts/build-server-payload.mjs
// (the pnpm script "dist:server" / "dist:server:linux" runs it automatically.)
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, cpSync, rmSync, readdirSync, realpathSync, symlinkSync, statSync, openSync, readSync, closeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopDir, "..", "..");
const payloadDir = path.join(desktopDir, "server-payload");
const binDir = path.join(payloadDir, "bin");
const pgsqlDir = path.join(binDir, "pgsql");
const pgsqlBinDir = path.join(pgsqlDir, "bin");
const pgsqlLibDir = path.join(pgsqlDir, "lib");
const pgsqlShareDir = path.join(pgsqlDir, "share");
const migrationsDir = path.join(payloadDir, "migrations");

const TARGET_OS = process.env.TARGET_OS || "windows";
const IS_WINDOWS = TARGET_OS === "windows";
const EXE = IS_WINDOWS ? ".exe" : "";
const GOOS = IS_WINDOWS ? "windows" : "linux";
const GOARCH = process.env.TARGET_ARCH || "amd64";

// The Linux payload is built for glibc >= 2.39 (Ubuntu 24.04 / Debian 13+).
// These glibc internals must come from the target system, never be bundled.
const GLIBC_CORE = new Set([
  "linux-vdso.so.1",
  "ld-linux.so.2",
  "ld-linux-x86-64.so.2",
  "libc.so.6",
  "libm.so.6",
  "libdl.so.2",
  "libpthread.so.0",
  "librt.so.1",
  "libresolv.so.2",
  "libnsl.so.1",
  "libutil.so.1",
  "libgcc_s.so.1",
  "libstdc++.so.6",
]);

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: "inherit", ...opts });
}

console.log(`==> Building server payload for ${TARGET_OS}/${GOARCH} into ${payloadDir}`);
rmSync(payloadDir, { recursive: true, force: true });
mkdirSync(binDir, { recursive: true });
mkdirSync(migrationsDir, { recursive: true });

console.log(`==> Compiling Go binaries for ${GOOS}/${GOARCH}`);
run(`go build -o "${path.join(binDir, "go-api" + EXE)}" ./cmd/server`, {
  cwd: path.join(repoRoot, "apps", "go-api"),
  env: { ...process.env, GOOS, GOARCH, CGO_ENABLED: "0" },
});
run(`go build -o "${path.join(binDir, "migrate" + EXE)}" ./cmd/migrate`, {
  cwd: path.join(repoRoot, "apps", "go-api"),
  env: { ...process.env, GOOS, GOARCH, CGO_ENABLED: "0" },
});
run(`go build -o "${path.join(binDir, "seed" + EXE)}" ./cmd/seed`, {
  cwd: path.join(repoRoot, "apps", "go-api"),
  env: { ...process.env, GOOS, GOARCH, CGO_ENABLED: "0" },
});

console.log("==> Copying database migrations");
for (const f of readdirSync(path.join(repoRoot, "db", "migrations"))) {
  if (f.endsWith(".sql")) cpSync(path.join(repoRoot, "db", "migrations", f), path.join(migrationsDir, f));
}

if (IS_WINDOWS) {
  assembleWindowsPostgres();
} else {
  assembleLinuxPostgres();
}

console.log("==> Server payload ready at", payloadDir);

// ---------------------------------------------------------------------------
// Windows: portable PostgreSQL zip from EDB (self-contained, includes DLLs).
// ---------------------------------------------------------------------------
function assembleWindowsPostgres() {
  const PG_VERSION = process.env.PG_VERSION || "16.15-1";
  const PG_ZIP = `postgresql-${PG_VERSION}-windows-x64-binaries.zip`;
  const PG_URL = process.env.PG_URL || `https://get.enterprisedb.com/postgresql/${PG_ZIP}`;

  console.log("==> Downloading portable PostgreSQL", PG_VERSION);
  const tmpZip = path.join(desktopDir, "pg-download.zip");
  run(`curl -fL "${PG_URL}" -o "${tmpZip}"`);
  rmSync(path.join(desktopDir, "pg-extract"), { recursive: true, force: true });
  run(`unzip -q "${tmpZip}" -d "${path.join(desktopDir, "pg-extract")}"`);
  rmSync(tmpZip, { force: true });
  if (!existsSync(path.join(desktopDir, "pg-extract", "pgsql"))) {
    console.error("ERROR: portable PostgreSQL zip did not contain a pgsql/ folder");
    process.exit(1);
  }
  cpSync(path.join(desktopDir, "pg-extract", "pgsql"), pgsqlDir, { recursive: true });
  rmSync(path.join(desktopDir, "pg-extract"), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Linux: assemble bin/pgsql from a system PostgreSQL 16 (Debian/Ubuntu layout)
// and harvest the shared libraries the binaries need with `ldd`.
// ---------------------------------------------------------------------------
function assembleLinuxPostgres() {
  // Debian/Ubuntu install PostgreSQL 16 to /usr/lib/postgresql/16. Both the
  // server tools (initdb, pg_ctl, postgres, ...) and the client tools (psql,
  // createdb, pg_dump, pg_isready, ...) live in its bin/ directory.
  const PG_VERSION = process.env.PG_VERSION || "16";
  const PG_LIB_BASE = process.env.PG_LIB_BASE || `/usr/lib/postgresql/${PG_VERSION}`;
  const PG_SHARE_BASE = process.env.PG_SHARE_BASE || `/usr/share/postgresql/${PG_VERSION}`;

  if (!existsSync(path.join(PG_LIB_BASE, "bin", "initdb"))) {
    console.error(`ERROR: PostgreSQL ${PG_VERSION} not found at ${PG_LIB_BASE}.`);
    console.error("Install it on this Ubuntu 24.04 build host first:");
    console.error("  sudo apt-get update && sudo apt-get install -y postgresql-16 postgresql-client-16");
    process.exit(1);
  }

  console.log(`==> Assembling bin/pgsql from system PostgreSQL ${PG_VERSION} (${PG_LIB_BASE})`);
  mkdirSync(pgsqlBinDir, { recursive: true });
  mkdirSync(pgsqlLibDir, { recursive: true });
  mkdirSync(pgsqlShareDir, { recursive: true });

  // All postgres tools (server + client).
  for (const f of readdirSync(path.join(PG_LIB_BASE, "bin"))) {
    cpSync(path.join(PG_LIB_BASE, "bin", f), path.join(pgsqlBinDir, f));
  }

  // Postgres extension modules (pgcrypto, ...). llvmjit.so is skipped on
  // purpose: it pulls in the whole LLVM runtime and PostgreSQL degrades
  // gracefully to non-JIT execution when it is absent.
  const PG_LIB_DIR = path.join(PG_LIB_BASE, "lib");
  if (existsSync(PG_LIB_DIR)) {
    for (const f of readdirSync(PG_LIB_DIR)) {
      if (f === "llvmjit.so" || f === "llvmjit_types.bc" || f === "bitcode") continue;
      const src = path.join(PG_LIB_DIR, f);
      // Only runtime extension modules are needed; skip subdirectories such
      // as pgxs/ (build-system Makefiles) and bitcode/.
      if (!statSync(src).isFile()) continue;
      cpSync(src, path.join(pgsqlLibDir, f));
    }
  }

  // Catalog data (postgres.bki, system_views.sql, extension control/SQL, ...).
  // PostgreSQL derives pkglibdir/sharedir relative to the executable, so a
  // bin/pgsql/{bin,lib,share} layout is picked up automatically.
  if (existsSync(PG_SHARE_BASE)) {
    for (const f of readdirSync(PG_SHARE_BASE)) {
      if (f === "man") continue; // no docs needed in the bundle
      cpSync(path.join(PG_SHARE_BASE, f), path.join(pgsqlShareDir, f), { recursive: true });
    }
  }

  console.log("==> Harvesting shared libraries with ldd");
  // The extension modules (pgcrypto.so etc.) are dlopen'd by postgres at
  // runtime, so their dependencies must be harvested too, not just the
  // binaries'. libpq5 is a dependency of the client tools and gets picked up
  // here as well.
  harvestLibraries(pgsqlBinDir, pgsqlLibDir);
  harvestLibraries(pgsqlLibDir, pgsqlLibDir);
}

// Copies every shared library the binaries in `binDir` link against into
// `libDir` (preserving sonames), except the glibc core which must come from
// the target system. `main.cjs` sets LD_LIBRARY_PATH to libDir at runtime.
function harvestLibraries(binDir, libDir) {
  const copied = new Set();
  for (const f of readdirSync(binDir)) {
    const bin = path.join(binDir, f);
    if (!isElf(bin)) continue;
    let out;
    try {
      out = execSync(`ldd "${bin}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      continue; // not dynamically linked (static Go binary)
    }
    for (const line of out.split("\n")) {
      const m = line.match(/^\s*(\S+)\s+=>\s+(\S+)/);
      if (!m) continue;
      const soname = m[1];
      const resolved = m[2];
      if (GLIBC_CORE.has(soname) || resolved === "not found") continue;
      if (copied.has(soname)) continue;
      let real;
      try {
        real = realpathSync(resolved);
      } catch {
        continue;
      }
      const target = path.join(libDir, path.basename(real));
      if (!existsSync(target)) {
        cpSync(real, target);
      }
      // Recreate the soname symlink (e.g. libpq.so.5 -> libpq.so.5.16) so the
      // dynamic loader finds the library by the name the binary asks for.
      const link = path.join(libDir, soname);
      if (!existsSync(link) && path.basename(real) !== soname) {
        try {
          symlinkSync(path.basename(real), link);
        } catch {
          /* best-effort */
        }
      }
      copied.add(soname);
    }
  }
  console.log(`    bundled ${copied.size} shared libraries into ${libDir}`);
}

function isElf(file) {
  try {
    const buf = Buffer.alloc(4);
    const fd = openSync(file, "r");
    readSync(fd, buf, 0, 4, 0);
    closeSync(fd);
    return buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46;
  } catch {
    return false;
  }
}
