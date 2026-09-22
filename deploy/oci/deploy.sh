#!/usr/bin/env bash
set -euo pipefail

PUBLIC_HOST="${1:?Pass the HTTPS hostname, such as 80-225-204-171.sslip.io}"
if [[ ! "$PUBLIC_HOST" =~ ^[a-z0-9.-]+$ ]]; then
  echo 'Invalid public hostname.' >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# The hosted store is separate from local and committed repository fixtures.
# Keep the generated credentials and Docker volumes across every deployment.
bash scripts/platform-env.sh
if grep -Eq '^REPO_DATA=true$' .env; then
  echo 'Refusing to deploy repository snapshot mode on the hosted server.' >&2
  exit 1
fi

pnpm install --frozen-lockfile

COMPOSE=(sudo docker compose -f compose.yaml -f deploy/oci/compose.yaml --profile app)
"${COMPOSE[@]}" build postgres
"${COMPOSE[@]}" build geo
"${COMPOSE[@]}" up -d --no-build --wait

pnpm db:migrate
if systemctl is-active --quiet ulpin.service; then
  sudo systemctl stop ulpin.service
  trap 'sudo systemctl start ulpin.service' EXIT
fi
NODE_OPTIONS=--max-old-space-size=4096 pnpm build

sudo install -m 0644 deploy/oci/ulpin.service /etc/systemd/system/ulpin.service
sudo systemctl daemon-reload
sudo systemctl enable --now ulpin.service
sudo systemctl restart ulpin.service
trap - EXIT

sudo install -m 0644 deploy/oci/ulpin-web-firewall.service /etc/systemd/system/ulpin-web-firewall.service
sudo systemctl daemon-reload
sudo systemctl enable --now ulpin-web-firewall.service

CADDY_TMP="$(mktemp)"
trap 'rm -f "$CADDY_TMP"' EXIT
sed "s/__PUBLIC_HOST__/$PUBLIC_HOST/g" deploy/oci/Caddyfile.template > "$CADDY_TMP"
sudo caddy validate --config "$CADDY_TMP" --adapter caddyfile >/dev/null
sudo install -m 0644 "$CADDY_TMP" /etc/caddy/Caddyfile
sudo systemctl reload caddy.service

for _ in {1..30}; do
  if curl -fsS -o /dev/null http://127.0.0.1:3000/api/v1/health; then
    echo "ULPIN application healthy at https://$PUBLIC_HOST"
    exit 0
  fi
  sleep 2
done
echo 'Web health endpoint did not become ready.' >&2
exit 1
