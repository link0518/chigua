import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getDeployConfig, run, runRemoteScript, shellQuote } from './deploy-utils.mjs';

const config = getDeployConfig();
const stamp = new Date().toISOString().replaceAll(/[-:T.Z]/g, '').slice(0, 14);
const archiveName = `chigua-dist-${stamp}.tar.gz`;
const localArchive = path.join(tmpdir(), archiveName);
const remoteArchive = `/tmp/${archiveName}`;

try {
  run('npm', ['run', 'build'], { shell: process.platform === 'win32', label: 'deploy:web' });
  run('tar', ['-czf', localArchive, '-C', 'dist', '.'], { label: 'deploy:web' });
  run('scp', [...config.scpArgs, localArchive, `${config.remote}:${remoteArchive}`], { label: 'deploy:web' });

  const remoteScript = `
set -euo pipefail
cd ${shellQuote(config.remotePath)}
archive=${shellQuote(remoteArchive)}
remote_path=${shellQuote(config.remotePath)}
web_port=${shellQuote(config.webPort)}
pm2_web_name=${shellQuote(config.pm2WebName)}
ts=$(date +%Y%m%d%H%M%S)
new_dir=$(mktemp -d "$remote_path/.dist-new.XXXXXX")
tar -xzf "$archive" -C "$new_dir"
test -f "$new_dir/index.html"
find "$new_dir" -type d -exec chmod 755 {} +
find "$new_dir" -type f -exec chmod 644 {} +
if [ -d dist ]; then
  mv dist "dist.bak.$ts"
fi
mv "$new_dir" dist
rm -f "$archive"
if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe "$pm2_web_name" >/dev/null 2>&1; then
    echo "[deploy:web] recreating $pm2_web_name to enforce dist/$web_port/--spa configuration"
    pm2 delete "$pm2_web_name"
  fi
  pm2 serve dist "$web_port" --spa --name "$pm2_web_name"
  pm2 save
else
  echo "[deploy:web] WARNING: pm2 not found, skipped frontend restart"
fi
echo "[deploy:web] backup=dist.bak.$ts"

health_body=$(mktemp /tmp/chigua-web-health.XXXXXX)
trap 'rm -f "$health_body"' EXIT
health_error=""

check_frontend_route() {
  route="$1"
  if ! health_meta=$(curl -fsS --max-time 5 -o "$health_body" -w '%{http_code}\n%{content_type}' "http://127.0.0.1:$web_port$route" 2>/dev/null); then
    health_error="$route request failed"
    return 1
  fi

  health_status=$(printf '%s\n' "$health_meta" | sed -n '1p')
  health_content_type=$(printf '%s\n' "$health_meta" | sed -n '2p')
  if [ "$health_status" != "200" ]; then
    health_error="$route returned HTTP $health_status"
    return 1
  fi
  case "$health_content_type" in
    text/html*) ;;
    *)
      health_error="$route returned non-HTML content type: $health_content_type"
      return 1
      ;;
  esac
  if ! grep -Eiq '<!doctype[[:space:]]+html|<html([[:space:]>])' "$health_body"; then
    health_error="$route response body is not HTML"
    return 1
  fi
  if ! grep -Fq 'id="root"' "$health_body"; then
    health_error="$route response is missing the application root"
    return 1
  fi
}

attempt=1
while ! check_frontend_route "/" || ! check_frontend_route "/feed"; do
  if [ "$attempt" -ge 30 ]; then
    echo "[deploy:web] ERROR: frontend health check failed after $attempt attempts: $health_error" >&2
    pm2 logs "$pm2_web_name" --lines 30 --nostream >&2 || true
    exit 5
  fi
  sleep 1
  attempt=$((attempt + 1))
done
rm -f "$health_body"
trap - EXIT
echo "[deploy:web] frontend health ok: / and /feed returned HTTP 200 HTML"
`;

  runRemoteScript(config, remoteScript, 'deploy:web');
  console.log('\n[deploy:web] 前端部署完成');
} finally {
  if (existsSync(localArchive)) {
    rmSync(localArchive, { force: true });
  }
}
