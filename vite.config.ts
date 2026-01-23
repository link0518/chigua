import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const readPackageVersion = () => {
  try {
    const raw = fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    return String(parsed.version || '0.0.0');
  } catch {
    return '0.0.0';
  }
};

const readGitCommitCount = () => {
  try {
    const output = execSync('git rev-list --count HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    const count = Number(output);
    return Number.isNaN(count) ? 0 : count;
  } catch {
    return 0;
  }
};

const buildAppVersion = () => {
  const base = readPackageVersion();
  const parts = base.split('.').map((part) => Number(part));
  if (parts.length < 3 || parts.some((value) => Number.isNaN(value))) {
    return base;
  }
  const commitCount = readGitCommitCount();
  const patchOffset = Math.max(commitCount - 1, 0);
  return `${parts[0]}.${parts[1]}.${parts[2] + patchOffset}`;
};

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const appVersion = buildAppVersion();
    return {
      server: {
        port: 4396,
        host: '0.0.0.0',
        strictPort: true,
        proxy: {
          '^/api/': {
            target: 'http://localhost:4395',
            changeOrigin: true,
          },
        },
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
