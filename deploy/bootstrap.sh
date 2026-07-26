#!/usr/bin/env bash
# ─── RushPoint VPS bootstrap ─────────────────────────────────────────────────
#
# Runs the whole VPS-side setup in one shot: build + start the API container,
# install the daily-prune systemd timer, and install + reload Caddy. Idempotent —
# safe to re-run after a `git pull` to redeploy.
#
# Run it from the repo root on the VPS, as root (or with sudo):
#     sudo bash deploy/bootstrap.sh
#
# Prerequisites it CHECKS (and tells you how to fix if missing):
#   • docker + docker compose
#   • ./service-account.json  (Firebase Admin credential, next to the compose file)
#   • docker-compose.api.yml env filled in (GCLOUD_PROJECT, ALLOWED_ORIGINS, QR_SECRET)
#   • for HTTPS: caddy installed, and /etc/caddy/origin.pem + origin.key in place
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="$REPO_DIR/docker-compose.api.yml"
cd "$REPO_DIR"

say()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[1;33m!\033[0m %s\n' "$*"; }
die()  { printf '  \033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── 0. Preflight ─────────────────────────────────────────────────────────────
say "Preflight checks"
command -v docker >/dev/null 2>&1 || die "docker not installed. Install: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "docker compose v2 not available (need the 'docker compose' plugin)."
[ -f "$COMPOSE" ] || die "missing $COMPOSE"
[ -f "$REPO_DIR/service-account.json" ] || die "missing ./service-account.json (Firebase console → Project settings → Service accounts → Generate new private key), place it at $REPO_DIR/service-account.json"
grep -q "example.com" "$COMPOSE" && warn "docker-compose.api.yml still contains 'example.com' — edit ALLOWED_ORIGINS (and GCLOUD_PROJECT / QR_SECRET) before going live."
ok "docker, compose, and the service account are present"

# ── 1. Build + start the API ─────────────────────────────────────────────────
say "Building and starting the API container"
docker compose -f "$COMPOSE" up -d --build
ok "container up"

# ── 2. Health check ──────────────────────────────────────────────────────────
say "Waiting for the API to answer /healthz"
health_url="http://127.0.0.1:8080/healthz"
for i in $(seq 1 40); do
  if curl -fsS "$health_url" >/dev/null 2>&1; then ok "healthy ($health_url)"; break; fi
  [ "$i" = 40 ] && { docker compose -f "$COMPOSE" logs --tail=40 api; die "API did not become healthy — see logs above"; }
  sleep 1
done

# ── 3. Daily retention sweep (systemd timer) ─────────────────────────────────
say "Installing the daily prune timer"
if command -v systemctl >/dev/null 2>&1; then
  # Point the unit's WorkingDirectory at THIS repo (where the compose file lives).
  sed "s#^WorkingDirectory=.*#WorkingDirectory=$REPO_DIR#" \
    "$REPO_DIR/deploy/rushpoint-prune.service" > /etc/systemd/system/rushpoint-prune.service
  cp "$REPO_DIR/deploy/rushpoint-prune.timer" /etc/systemd/system/rushpoint-prune.timer
  systemctl daemon-reload
  systemctl enable --now rushpoint-prune.timer
  ok "rushpoint-prune.timer enabled ($(systemctl is-active rushpoint-prune.timer)); next run: $(systemctl list-timers rushpoint-prune.timer --no-pager 2>/dev/null | awk 'NR==2{print $1, $2}')"
else
  warn "systemd not found — add a daily cron instead: 0 3 * * * cd $REPO_DIR && docker compose -f docker-compose.api.yml run --rm --no-deps api node lib/prune-cron.js"
fi

# ── 4. Caddy (TLS + Cloudflare real-IP) ──────────────────────────────────────
say "Installing the Caddy site config"
if command -v caddy >/dev/null 2>&1; then
  if grep -q "api.example.com" "$REPO_DIR/deploy/Caddyfile"; then
    warn "deploy/Caddyfile still says api.example.com — edit the hostname + tls cert paths before reloading."
  fi
  if [ -f /etc/caddy/Caddyfile ] && ! cmp -s "$REPO_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile; then
    cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%s 2>/dev/null || echo old)"
    warn "backed up your existing /etc/caddy/Caddyfile"
  fi
  cp "$REPO_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile
  if caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    systemctl reload caddy 2>/dev/null || caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
    ok "Caddy config installed and reloaded"
  else
    warn "Caddy config did NOT validate (probably the hostname/cert paths still need editing). Fix /etc/caddy/Caddyfile, then: systemctl reload caddy"
  fi
else
  warn "caddy not installed — install it (https://caddyserver.com/docs/install), then copy deploy/Caddyfile to /etc/caddy/Caddyfile and reload."
fi

# ── Done ─────────────────────────────────────────────────────────────────────
say "Done"
cat <<EOF
  The API is running on 127.0.0.1:8080 (health: /healthz).

  Still to do OFF the box (see RUN_ON_VPS.md + deploy/CLOUDFLARE.md):
    • Cloudflare: proxied A record → this VPS, Full(strict) TLS + Origin cert,
      the WAF rule (ip.geoip.country ne "IL") -> Block, and ufw origin lock.
    • Enable Anonymous sign-in on the Firebase project (if not done).
    • firebase deploy --only firestore:rules,firestore:indexes,storage
    • Set VITE_API_ORIGIN=https://<your-host> in the apps' .env, rebuild
      (npm run play:build / creator:build), deploy the static bundles.

  Redeploy later:  git pull && sudo bash deploy/bootstrap.sh
  Logs:            docker compose -f docker-compose.api.yml logs -f api
EOF
