import { capture, getDeployConfig, run, runRemoteScript, shellQuote } from './deploy-utils.mjs';

const assertDeploySourceReady = () => {
  const worktreeStatus = capture('git', ['status', '--porcelain=v1', '--untracked-files=all']);
  if (worktreeStatus) {
    throw new Error('本地工作区存在未提交或未跟踪文件。请先完整提交招募前后端代码，再执行 deploy:app。');
  }

  // 先刷新 upstream 引用，避免本地使用旧的远端指针通过校验。
  run('git', ['fetch', '--quiet', '--prune'], { label: 'deploy:app:preflight' });
  const localHead = capture('git', ['rev-parse', 'HEAD']);
  let upstreamHead;
  try {
    upstreamHead = capture('git', ['rev-parse', '@{upstream}']);
  } catch {
    throw new Error('当前分支没有 upstream。请先设置跟踪分支并推送当前提交。');
  }
  if (localHead !== upstreamHead) {
    throw new Error('本地 HEAD 与 upstream 不一致。请先完成拉取或推送，确保前后端从同一提交部署。');
  }
  return localHead;
};

const expectedCommit = assertDeploySourceReady();

const config = getDeployConfig();

const remoteScript = `
set -euo pipefail
cd ${shellQuote(config.remotePath)}
api_port=${shellQuote(config.apiPort)}
pm2_api_name=${shellQuote(config.pm2ApiName)}
expected_commit=${shellQuote(expectedCommit)}

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

if [ "$after" != "$expected_commit" ]; then
  echo "[deploy:app] ERROR: 服务器拉取后的提交 $after 与本次前端提交 $expected_commit 不一致" >&2
  exit 3
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
