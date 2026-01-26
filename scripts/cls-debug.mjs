import { spawn } from 'node:child_process';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import chromeLauncher from 'chrome-launcher';
import puppeteer from 'puppeteer-core';

const getFreePort = async () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('无法分配空闲端口')));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });

const waitForHealth = async (baseUrl, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`, { cache: 'no-store' });
      if (res.ok) {
        return;
      }
    } catch {
      // ignore
    }
    await delay(250);
  }
  throw new Error(`Healthcheck 超时：${baseUrl}/api/health`);
};

const startServer = async (port) => {
  const child = spawn('node', ['server/index.js'], {
    env: { ...process.env, PORT: String(port) },
    stdio: 'inherit',
    windowsHide: true,
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl);
  return { child, baseUrl };
};

const getArgValue = (name) => {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
};

const collectLayoutShifts = async (url, waitMs, cpuThrottleRate) => {
  const installations = chromeLauncher.Launcher.getInstallations();
  if (!installations || installations.length === 0) {
    throw new Error('未找到可用的 Chrome 安装');
  }

  const browser = await puppeteer.launch({
    executablePath: installations[0],
    headless: 'new',
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-breakpad',
      '--disable-client-side-phishing-detection',
      '--disable-default-apps',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-hang-monitor',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--disable-sync',
      '--metrics-recording-only',
      '--no-sandbox',
      '--password-store=basic',
      '--use-mock-keychain',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: 360,
      height: 640,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });

    if (cpuThrottleRate > 1) {
      const client = await page.target().createCDPSession();
      await client.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottleRate });
    }

    await page.evaluateOnNewDocument(() => {
      const buildSelector = (node) => {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return '';
        const el = node;
        if (el.id) return `#${el.id}`;
        const parts = [];
        let cur = el;
        for (let i = 0; i < 5 && cur && cur.nodeType === Node.ELEMENT_NODE; i += 1) {
          let part = cur.tagName.toLowerCase();
          const className = typeof cur.className === 'string' ? cur.className.trim() : '';
          if (className) {
            const cls = className
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 3)
              .join('.');
            if (cls) part += `.${cls}`;
          }
          const parent = cur.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter((n) => n.tagName === cur.tagName);
            if (siblings.length > 1) {
              const index = siblings.indexOf(cur) + 1;
              part += `:nth-of-type(${index})`;
            }
          }
          parts.unshift(part);
          cur = parent;
        }
        return parts.join(' > ');
      };

      const state = {
        total: 0,
        entries: [],
      };

      window.__CLS_DEBUG__ = state;

      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.hadRecentInput) continue;
          state.total += entry.value;
          state.entries.push({
            value: entry.value,
            startTime: entry.startTime,
            sources: (entry.sources || []).map((source) => ({
              selector: source.node ? buildSelector(source.node) : '',
              previousRect: source.previousRect,
              currentRect: source.currentRect,
            })),
          });
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });

    await page.goto(url, { waitUntil: 'networkidle2' });
    await delay(waitMs);

    const result = await page.evaluate(() => {
      const supported = (typeof PerformanceObserver !== 'undefined' && Array.isArray(PerformanceObserver.supportedEntryTypes))
        ? PerformanceObserver.supportedEntryTypes
        : [];
      const raw = performance.getEntriesByType('layout-shift') || [];
      const rawTotal = raw.reduce((sum, entry) => sum + (entry.hadRecentInput ? 0 : entry.value), 0);
      return {
        ...window.__CLS_DEBUG__,
        rawEntries: raw.length,
        rawTotal,
        supportedEntryTypes: supported,
      };
    });
    return result;
  } finally {
    await browser.close();
  }
};

const main = async () => {
  const waitMs = Math.min(Math.max(Number(getArgValue('wait-ms') || 3000), 0), 60000);
  const cpuThrottleRate = Math.min(Math.max(Number(getArgValue('cpu') || 4), 1), 20);
  const port = await getFreePort();
  const { child, baseUrl } = await startServer(port);

  try {
    const result = await collectLayoutShifts(`${baseUrl}/`, waitMs, cpuThrottleRate);

    const bySelector = new Map();
    for (const entry of result.entries || []) {
      const sources = entry.sources || [];
      for (const source of sources) {
        const key = source.selector || '(unknown)';
        bySelector.set(key, (bySelector.get(key) || 0) + entry.value);
      }
    }
    const top = Array.from(bySelector.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([selector, score]) => ({ selector, score: Number(score.toFixed(6)) }));

    process.stdout.write(
      `${JSON.stringify(
        {
          url: `${baseUrl}/`,
          total: Number((result.total || 0).toFixed(6)),
          rawTotal: Number((result.rawTotal || 0).toFixed(6)),
          rawEntries: Number(result.rawEntries || 0),
          supportsLayoutShift: Boolean((result.supportedEntryTypes || []).includes('layout-shift')),
          entries: (result.entries || []).length,
          top,
          sample: (result.entries || []).slice(0, 3),
        },
        null,
        2
      )}\n`
    );
  } finally {
    child.kill();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
