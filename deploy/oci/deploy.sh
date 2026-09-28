#!/usr/bin/env bash
set -euo pipefail
PUBLIC_HOST="${1:?Pass the HTTPS hostname}"
LEGACY_HOST="${2:-}"
if [[ ! "$PUBLIC_HOST" =~ ^[a-z0-9.-]+$ ]] || { [[ -n "$LEGACY_HOST" ]] && [[ ! "$LEGACY_HOST" =~ ^[a-z0-9.-]+$ ]]; }; then
  echo 'Invalid public hostname.' >&2
  exit 1
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
SHARED=/opt/ulpin/shared
install -d -m 700 "$SHARED" "$SHARED/backups"
exec 9>"$SHARED/deploy.lock"
flock -n 9 || { echo 'Another deployment is active.' >&2; exit 1; }
bash scripts/platform-env.sh
if grep -Eq '^REPO_DATA=true$' .env; then
  echo 'Repository snapshot mode cannot be deployed.' >&2
  exit 1
fi
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$SHARED/backups/$STAMP"
install -d -m 700 "$BACKUP"
install -m 600 .env "$BACKUP/server.env"
if [[ -f /etc/caddy/Caddyfile ]]; then sudo cp /etc/caddy/Caddyfile "$BACKUP/Caddyfile"; fi
if sudo docker inspect ulpin-postgres-1 >/dev/null 2>&1; then
  (umask 077; sudo docker exec ulpin-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP/database.dump")
fi
node deploy/oci/configure-env.mjs
if [[ ! -x "$SHARED/demo-venv/bin/pip" ]]; then python3 -m venv "$SHARED/demo-venv"; fi
"$SHARED/demo-venv/bin/pip" install --only-binary=:all: --disable-pip-version-check -q -r scripts/demo-import/requirements.txt
pnpm install --frozen-lockfile
NODE_OPTIONS=--max-old-space-size=4096 pnpm build
VITE_HOSTED_DEMO=1 VITE_LOCAL_DATA=on VITE_DEMO_IMPORT=1 NODE_OPTIONS=--max-old-space-size=4096 pnpm studio:build
chmod -R a+rX apps/studio/dist
node scripts/demo-import/prepare-hosted.mjs "$SHARED/bootstrap.json"
COMPOSE=(sudo docker compose -f compose.yaml -f deploy/oci/compose.yaml --profile app)
"${COMPOSE[@]}" build postgres geo
"${COMPOSE[@]}" up -d --no-build --wait
pnpm db:migrate
for service in ulpin-api ulpin-demo ulpin-dispatcher; do
  sudo install -m 0644 "deploy/oci/$service.service" "/etc/systemd/system/$service.service"
done
sudo systemctl daemon-reload
sudo systemctl enable ulpin-api ulpin-demo ulpin-dispatcher
sudo systemctl restart ulpin-api ulpin-demo
wait_for() {
  for _ in {1..30}; do
    if curl -fsS -o /dev/null "$1"; then return; fi
    sleep 2
  done
  echo "Service did not become ready: $1" >&2
  return 1
}
wait_for http://127.0.0.1:3188/api/v1/health
wait_for http://127.0.0.1:3190/healthz
node scripts/demo-import/seed-hosted.mjs "$SHARED/datasets/nyc-10013/files"
CADDY_TMP="$(mktemp)"
trap 'rm -f "$CADDY_TMP"' EXIT
sed "s/__PUBLIC_HOST__/$PUBLIC_HOST/g" deploy/oci/Caddyfile.template > "$CADDY_TMP"
if [[ -n "$LEGACY_HOST" && "$LEGACY_HOST" != "$PUBLIC_HOST" ]]; then
  printf '\n' >> "$CADDY_TMP"
  sed "s/__PUBLIC_HOST__/$LEGACY_HOST/g" deploy/oci/Caddyfile.template >> "$CADDY_TMP"
fi
sudo caddy validate --config "$CADDY_TMP" --adapter caddyfile >/dev/null
sudo install -m 0644 "$CADDY_TMP" /etc/caddy/Caddyfile
sudo systemctl reload caddy.service
if systemctl is-active --quiet ulpin.service; then sudo systemctl stop ulpin.service; fi
sudo systemctl disable ulpin.service >/dev/null 2>&1 || true
sudo systemctl restart ulpin-dispatcher
sudo install -m 0644 deploy/oci/ulpin-web-firewall.service /etc/systemd/system/ulpin-web-firewall.service
sudo systemctl daemon-reload
sudo systemctl enable --now ulpin-web-firewall.service
printf 'Deployed %s at https://%s; previous database/config retained in %s\n' "$(git rev-parse HEAD)" "$PUBLIC_HOST" "$BACKUP"
