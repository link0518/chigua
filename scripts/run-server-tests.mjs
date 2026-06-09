import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const testsDir = path.resolve(process.cwd(), 'server', 'tests');
const files = fs
  .readdirSync(testsDir)
  .filter((file) => file.endsWith('.test.js'))
  .sort()
  .map((file) => path.join(testsDir, file));

if (!files.length) {
  console.error('未找到服务端测试文件');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--experimental-test-isolation=none', '--test', ...files],
  { stdio: 'inherit' }
);

process.exit(result.status ?? 1);
