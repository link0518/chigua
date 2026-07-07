import { getDeployConfig, run, runRemoteScript, shellQuote } from './deploy-utils.mjs';

const config = getDeployConfig();

const remoteScript = `
set -euo pipefail
cd ${shellQuote(config.remotePath)}
api_port=${shellQuote(config.apiPort)}
pm2_api_name=${shellQuote(config.pm2ApiName)}

if [ ! -d .git ]; then
  echo "[deploy:app] ERROR: ${config.remotePath} 不是 Git 仓库，无法自动更新后端代码" >&2
  exit 2
fi

before=$(git rev-parse HEAD)
stash_created=0
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[deploy:app] 服务器存在已跟踪文件改动，先临时 stash"
  git stash push -m "deploy-app auto stash $(date +%Y%m%d%H%M%S)"
  stash_created=1
fi

git fetch --all --prune
git pull --ff-only
after=$(git rev-parse HEAD)

if [ "$stash_created" = "1" ]; then
  echo "[deploy:app] 恢复服务器本地改动"
  git stash pop
fi

deps_changed=0
if [ ! -d node_modules ]; then
  deps_changed=1
elif [ "$before" != "$after" ] && git diff --name-only "$before" "$after" -- package.json package-lock.json | grep -q .; then
  deps_changed=1
fi

if [ "$deps_changed" = "1" ]; then
  npm install --include=optional
else
  echo "[deploy:app] package 文件未变化，跳过 npm install"
fi

if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe "$pm2_api_name" >/dev/null 2>&1; then
    pm2 restart "$pm2_api_name" --update-env
  else
    pm2 start npm --name "$pm2_api_name" -- run server
  fi
  pm2 save
else
  echo "[deploy:app] ERROR: pm2 not found" >&2
  exit 4
fi

attempt=1
until curl -fsS --max-time 5 "http://127.0.0.1:$api_port/api/health" >/tmp/chigua-api-health.json 2>/dev/null; do
  if [ "$attempt" -ge 30 ]; then
    echo "[deploy:app] ERROR: API health check failed after $attempt attempts" >&2
    pm2 logs "$pm2_api_name" --lines 30 --nostream >&2 || true
    exit 5
  fi
  sleep 1
  attempt=$((attempt + 1))
done
echo "[deploy:app] api health ok"
cat /tmp/chigua-api-health.json
echo
`;

runRemoteScript(config, remoteScript, 'deploy:app');
run('npm', ['run', 'deploy:web'], { shell: process.platform === 'win32', label: 'deploy:app' });
console.log('\n[deploy:app] 前后端部署完成');
