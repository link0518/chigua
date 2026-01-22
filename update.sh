#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(pwd)"

log() {
  printf "[update] %s\n" "$1"
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

ensure_repo() {
  if [ ! -d "$APP_DIR/.git" ]; then
    log "No git repo found in current directory. Abort."
    exit 1
  fi
}

sync_repo() {
  ensure_repo
  log "Updating repo..."
  local dirty=0
  if ! git diff --quiet || ! git diff --cached --quiet; then
    dirty=1
    log "Local changes detected; stashing before pull..."
    git stash push -u -m "update.sh auto stash"
  fi

  git pull

  if [ "$dirty" -eq 1 ]; then
    log "Re-applying local changes..."
    if ! git stash pop; then
      log "Stash pop had conflicts. Resolve manually."
    fi
  fi
}

install_deps() {
  log "Installing dependencies..."
  npm install
}

build_app() {
  log "Building frontend..."
  npm run build
}

restart_services() {
  log "Restarting API (pm2)..."
  if pm2 describe chigua-api >/dev/null 2>&1; then
    pm2 restart chigua-api
  else
    pm2 start npm --name chigua-api -- run server
  fi

  log "Restarting frontend (pm2 serve)..."
  if pm2 describe chigua-web >/dev/null 2>&1; then
    pm2 restart chigua-web
  else
    pm2 serve dist 4396 --spa --name chigua-web
  fi

  pm2 save
}

main() {
  ensure_git
  ensure_node
  ensure_pm2
  sync_repo
  install_deps
  build_app
  restart_services
  log "Done. API: 4395, Web: 4396"
}

main "$@"
