import { spawn } from 'child_process';
import net from 'net';

const runCommand = (command, args, options = {}) => new Promise((resolve, reject) => {
  const spawnOptions = { stdio: 'inherit', ...options };
  if (process.platform === 'win32' && typeof spawnOptions.shell === 'undefined') {
    spawnOptions.shell = true;
  }
  const child = spawn(command, args, spawnOptions);
  child.on('error', reject);
  child.on('exit', (code) => {
    if (code === 0) {
      resolve();
      return;
    }
    reject(new Error(`${command} ${args.join(' ')} 退出码 ${code}`));
  });
});

const getFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : null;
    server.close(() => {
      if (!port) {
        reject(new Error('无法获取空闲端口'));
        return;
      }
      resolve(port);
    });
  });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fetchJson = async (url) => {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`请求失败 ${response.status} ${response.statusText}: ${url}`);
  }
  return response.json();
};

const waitForHealth = async (baseUrl, timeoutMs = 60000) => {
  const startedAt = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await fetchJson(`${baseUrl}/api/health`);
      return;
    } catch {
      // ignore
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`等待服务启动超时（${timeoutMs}ms）：${baseUrl}`);
    }
    await sleep(300);
  }
};

const pickAnyPostId = async (baseUrl) => {
  const candidates = [
    `${baseUrl}/api/posts/home?limit=1&offset=0`,
    `${baseUrl}/api/posts/feed?filter=week`,
  ];
  for (const url of candidates) {
    try {
      const data = await fetchJson(url);
      const items = Array.isArray(data?.items) ? data.items : [];
      const id = items?.[0]?.id;
      if (typeof id === 'string' && id.trim()) {
        return id.trim();
      }
    } catch {
      // ignore
    }
  }
  return null;
};

const getNpmBin = () => 'npm';
const getNpxBin = () => 'npx';

const main = async () => {
  const quick = process.argv.includes('--quick');

  console.log('开始构建前端（npm run build）...');
  await runCommand(getNpmBin(), ['run', 'build']);

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  console.log(`启动本地服务：${baseUrl} ...`);
  const server = spawn(
    'node',
    ['server/index.js'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'production',
      },
    }
  );

  const stopServer = async () => {
    if (server.exitCode !== null) return;
    server.kill('SIGTERM');
    await sleep(1500);
    if (server.exitCode === null) {
      server.kill('SIGKILL');
    }
  };

  process.on('exit', () => {
    try {
      if (server.exitCode === null) {
        server.kill();
      }
    } catch {
      // ignore
    }
  });

  try {
    await waitForHealth(baseUrl, 60000);

    const postId = await pickAnyPostId(baseUrl);
    const urls = [
      `${baseUrl}/`,
      `${baseUrl}/search`,
      `${baseUrl}/tiancai`,
    ];
    if (postId) {
      urls.push(`${baseUrl}/post/${encodeURIComponent(postId)}`);
    } else {
      console.warn('未能从 API 获取任意 postId，将跳过 /post/:id 的测量（可能不符合“所有路由”的口径）');
    }

    const finalUrls = quick ? urls.slice(0, 1) : urls;
    const urlArgs = finalUrls.flatMap((url) => [`--collect.url=${url}`]);

    console.log(`将测量 ${finalUrls.length} 个 URL：`);
    finalUrls.forEach((u) => console.log(`- ${u}`));

    const npx = getNpxBin();
    const mobileConfig = 'lighthouserc.mobile.cjs';
    const desktopConfig = 'lighthouserc.desktop.cjs';

    console.log('运行 Lighthouse CI（Mobile）...');
    await runCommand(npx, ['lhci', 'autorun', `--config=${mobileConfig}`, ...urlArgs]);

    console.log('运行 Lighthouse CI（Desktop）...');
    await runCommand(npx, ['lhci', 'autorun', `--config=${desktopConfig}`, ...urlArgs]);

    console.log('完成：报告已输出到 .lighthouseci/mobile 与 .lighthouseci/desktop');
    if (quick) {
      console.log('提示：你使用了 --quick（仅测量 1 个 URL）。要跑全量请执行 npm run perf:budget');
    }
  } finally {
    await stopServer();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
