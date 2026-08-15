#!/usr/bin/env bash
#
# Builds the Windows "main PC" server bundle:
#   go-api.exe + migrate.exe + seed.exe + portable PostgreSQL + migrations + launcher.
#
# Run from a Linux/macOS box or CI. Produces dist/windows-bundle, which you zip
# and copy to the main PC. See README.md in this directory.
set -euo pipefail
cd "$(dirname "$0")/../.."   # repository root

OUT="dist/windows-bundle"

# Portable PostgreSQL version. Check the exact filename on:
#   https://www.enterprisedb.com/download-postgresql-binaries
PG_VERSION="${PG_VERSION:-16.15-1}"
PG_ZIP="postgresql-${PG_VERSION}-windows-x64-binaries.zip"
PG_URL="${PG_URL:-https://get.enterprisedb.com/postgresql/${PG_ZIP}}"

echo "==> Building the Windows main-PC bundle into $OUT"
rm -rf "$OUT"
mkdir -p "$OUT/bin" "$OUT/migrations"

echo "==> Compiling Go binaries for windows/amd64"
(
  cd apps/go-api
  export GOOS=windows GOARCH=amd64 CGO_ENABLED=0
  go build -o "../../$OUT/bin/go-api.exe"  ./cmd/server
  go build -o "../../$OUT/bin/migrate.exe" ./cmd/migrate
  go build -o "../../$OUT/bin/seed.exe"    ./cmd/seed
)

echo "==> Copying database migrations"
cp db/migrations/*.sql "$OUT/migrations/"

echo "==> Downloading portable PostgreSQL $PG_VERSION"
curl -fL "$PG_URL" -o /tmp/hims-pg.zip
rm -rf /tmp/hims-pg
unzip -q /tmp/hims-pg.zip -d /tmp/hims-pg
mv /tmp/hims-pg/pgsql "$OUT/bin/pgsql"

echo "==> Copying launcher scripts"
cp infra/windows-bundle/Start.bat infra/windows-bundle/Stop.bat infra/windows-bundle/config.example.bat "$OUT/"

# Windows batch files must use CRLF line endings.
for f in "$OUT/Start.bat" "$OUT/Stop.bat" "$OUT/config.example.bat"; do
  sed -i 's/\r$//; s/$/\r/' "$f"
done

echo ""
echo "==> Bundle ready: $OUT"
echo "    Zip the folder, copy it to the main PC, then follow infra/windows-bundle/README.md"
