#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/link0518/chigua"
APP_DIR="$(pwd)"
DOMAIN="${DOMAIN:-:80}"
CADDY_DIR="/etc/caddy"
CADDYFILE="${CADDY_DIR}/Caddyfile"
CADDY_SNIPPET="${CADDY_DIR}/conf.d/chigua.caddy"
ENV_FILE="${APP_DIR}/.env.local"
ENV_EXAMPLE="${APP_DIR}/.env.example"

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
    if [ "$major" -ge 20 ]; then
      return
    fi
  fi
  log "Installing Node.js 20..."
  as_root apt-get update -y
  as_root apt-get install -y curl
  curl -fsSL https://deb.nodesource.com/setup_20.x | as_root bash -
  as_root apt-get install -y nodejs
}

ensure_pm2() {
  if require_cmd pm2; then
    return
  fi
  log "Installing pm2..."
  as_root npm install -g pm2
}

write_env_file() {
  cat > "$ENV_FILE" <<EOF
VITE_TURNSTILE_SITE_KEY=${VITE_TURNSTILE_SITE_KEY:-}
TURNSTILE_SECRET_KEY=${TURNSTILE_SECRET_KEY:-}
PORT=${PORT:-4395}
SESSION_SECRET=${SESSION_SECRET:-}
ADMIN_USERNAME=${ADMIN_USERNAME:-}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-}
EOF
}

ensure_env() {
  if [ ! -f "$ENV_FILE" ]; then
    log "Creating .env.local..."
    write_env_file
    if [ -f "$ENV_EXAMPLE" ]; then
      log "Review .env.local or .env.example for required values."
    fi
  fi

  if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
  fi

  if [ -z "${VITE_TURNSTILE_SITE_KEY:-}" ] || [ -z "${TURNSTILE_SECRET_KEY:-}" ]; then
    log "Turnstile keys are missing. Update .env.local before using posting features."
  fi
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
  reverse_proxy /post/* 127.0.0.1:4395
  reverse_proxy /robots.txt 127.0.0.1:4395
  reverse_proxy /sitemap.xml 127.0.0.1:4395
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

install_tailwind_oxide_binding() {
  local oxide_version platform arch libc_suffix oxide_package
  oxide_version="$(node -p "require('./node_modules/@tailwindcss/oxide/package.json').version")"
  platform="$(node -p "process.platform")"
  arch="$(node -p "process.arch")"

  if [ "$platform" != "linux" ]; then
    log "Unsupported Tailwind native binding fallback platform: ${platform}/${arch}"
    return 1
  fi

  libc_suffix="gnu"
  if command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl; then
    libc_suffix="musl"
  fi

  case "$arch" in
    x64)
      oxide_package="@tailwindcss/oxide-linux-x64-${libc_suffix}@${oxide_version}"
      ;;
    arm64)
      oxide_package="@tailwindcss/oxide-linux-arm64-${libc_suffix}@${oxide_version}"
      ;;
    arm)
      oxide_package="@tailwindcss/oxide-linux-arm-gnueabihf@${oxide_version}"
      ;;
    *)
      log "Unsupported Tailwind native binding fallback architecture: ${arch}"
      return 1
      ;;
  esac

  log "Installing Tailwind native binding fallback: ${oxide_package}"
  npm install --include=optional --no-save --package-lock=false "$oxide_package"
}

install_deps() {
  log "Installing dependencies..."
  npm install --include=optional
  if ! node -e "require('@tailwindcss/oxide')" >/dev/null 2>&1; then
    log "Tailwind native binding is missing; reinstalling dependencies..."
    rm -rf node_modules
    npm install --include=optional
    if ! node -e "require('@tailwindcss/oxide')" >/dev/null 2>&1; then
      install_tailwind_oxide_binding
      node -e "require('@tailwindcss/oxide')"
    fi
  fi
}

build_app() {
  log "Building frontend..."
  BUILD_NODE_HEAP_MB="${BUILD_NODE_HEAP_MB:-2048}"
  case " ${NODE_OPTIONS:-} " in
    *" --max-old-space-size="*) ;;
    *" --max_old_space_size="*) ;;
    *)
      if [ -z "${NODE_OPTIONS:-}" ]; then
        export NODE_OPTIONS="--max-old-space-size=${BUILD_NODE_HEAP_MB}"
      else
        export NODE_OPTIONS="${NODE_OPTIONS} --max-old-space-size=${BUILD_NODE_HEAP_MB}"
      fi
      ;;
  esac
  log "Using NODE_OPTIONS=${NODE_OPTIONS}"
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
  ensure_env
  install_deps
  build_app
  start_services
  configure_caddy
  log "Done. API: 4395, Web: 4396"
}

main "$@"
