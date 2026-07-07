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
    pm2 restart "$pm2_web_name"
  else
    pm2 serve dist "$web_port" --spa --name "$pm2_web_name"
  fi
  pm2 save
else
  echo "[deploy:web] WARNING: pm2 not found, skipped frontend restart"
fi
echo "[deploy:web] backup=dist.bak.$ts"
attempt=1
until curl -sS -I --max-time 5 "http://127.0.0.1:$web_port/" >/tmp/chigua-web-head.txt 2>/dev/null; do
  if [ "$attempt" -ge 30 ]; then
    echo "[deploy:web] ERROR: frontend health check failed after $attempt attempts" >&2
    pm2 logs "$pm2_web_name" --lines 30 --nostream >&2 || true
    exit 5
  fi
  sleep 1
  attempt=$((attempt + 1))
done
sed -n '1,8p' /tmp/chigua-web-head.txt
`;

  runRemoteScript(config, remoteScript, 'deploy:web');
  console.log('\n[deploy:web] 前端部署完成');
} finally {
  if (existsSync(localArchive)) {
    rmSync(localArchive, { force: true });
  }
}
