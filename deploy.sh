#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/link0518/chigua"
APP_DIR="$(pwd)"
DOMAIN="${DOMAIN:-:80}"
CADDY_DIR="/etc/caddy"
CADDYFILE="${CADDY_DIR}/Caddyfile"
CADDY_SNIPPET="${CADDY_DIR}/conf.d/chigua.caddy"

log() {
  printf "[deploy] %s\n" "$1"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1
}

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

ensure_git() {
  if require_cmd git; then
    return
  fi
  log "Installing git..."
  as_root apt-get update -y
  as_root apt-get install -y git
}

ensure_node() {
  if require_cmd node; then
    local major
    major="$(node -v | sed 's/v//' | cut -d. -f1)"
    if [ "$major" -ge 18 ]; then
      return
    fi
  fi
  log "Installing Node.js 18..."
  as_root apt-get update -y
  as_root apt-get install -y curl
  curl -fsSL https://deb.nodesource.com/setup_18.x | as_root bash -
  as_root apt-get install -y nodejs
}

ensure_pm2() {
  if require_cmd pm2; then
    return
  fi
  log "Installing pm2..."
  as_root npm install -g pm2
}

ensure_caddy() {
  if require_cmd caddy; then
    return
  fi
  log "Installing Caddy..."
  as_root apt-get update -y
  as_root apt-get install -y caddy
}

configure_caddy() {
  ensure_caddy
  log "Configuring Caddy reverse proxy..."
  as_root mkdir -p "${CADDY_DIR}/conf.d"

  local snippet
  snippet=$(cat <<EOF
${DOMAIN} {
  reverse_proxy /api/* 127.0.0.1:4395
  reverse_proxy 127.0.0.1:4396
}
EOF
)

  printf "%s\n" "$snippet" | as_root tee "$CADDY_SNIPPET" >/dev/null

  if [ ! -f "$CADDYFILE" ]; then
    printf "%s\n" "import ${CADDY_DIR}/conf.d/*.caddy" | as_root tee "$CADDYFILE" >/dev/null
  elif ! grep -q "${CADDY_DIR}/conf.d/*.caddy" "$CADDYFILE"; then
    printf "\nimport %s\n" "${CADDY_DIR}/conf.d/*.caddy" | as_root tee -a "$CADDYFILE" >/dev/null
  fi

  if require_cmd systemctl; then
    as_root systemctl reload caddy || as_root systemctl restart caddy
  fi
}

sync_repo() {
  if [ -d "$APP_DIR/.git" ]; then
    log "Updating existing repo..."
    git fetch --all
    git reset --hard origin/main
    return
  fi

local entries
entries="$(ls -A 2>/dev/null | tr '\n' ' ')"
if [ -n "$entries" ]; then
    log "Current directory is not empty. Abort to avoid overwriting files."
    exit 1
  fi

  log "Cloning repo into current directory..."
  git clone "$REPO_URL" .
}

install_deps() {
  log "Installing dependencies..."
  npm install
}

build_app() {
  log "Building frontend..."
  npm run build
}

start_services() {
  log "Starting API (pm2)..."
  if pm2 describe chigua-api >/dev/null 2>&1; then
    pm2 delete chigua-api
  fi
  pm2 start npm --name chigua-api -- run server

  log "Starting frontend (pm2 serve)..."
  if pm2 describe chigua-web >/dev/null 2>&1; then
    pm2 delete chigua-web
  fi
  pm2 serve dist 4396 --spa --name chigua-web

  pm2 save
}

main() {
  ensure_git
  ensure_node
  ensure_pm2
  sync_repo
  install_deps
  build_app
  start_services
  configure_caddy
  log "Done. API: 4395, Web: 4396"
}

main "$@"
