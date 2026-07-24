import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const rootDir = process.cwd();

export function loadLocalEnv() {
  const filePath = path.join(rootDir, '.env.deploy.local');
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const equalIndex = line.indexOf('=');
    if (equalIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalIndex).trim();
    let value = line.slice(equalIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

export function run(command, args, options = {}) {
  const label = options.label || 'deploy';
  console.log(`\n[${label}] ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    shell: options.shell || false,
    stdio: options.input ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    input: options.input,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status}`);
  }
}

/**
 * 执行只读命令并返回标准输出，供部署前置校验读取 Git 状态。
 */
export function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    shell: options.shell || false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`${command} ${args.join(' ')} 执行失败（退出码 ${result.status}）${detail ? `：${detail}` : ''}`);
  }
  return String(result.stdout || '').trim();
}

export function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少 ${name}。请在 .env.deploy.local 中配置，或临时设置环境变量。`);
  }
  return value;
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function getDeployConfig() {
  loadLocalEnv();

  const host = required('DEPLOY_HOST');
  const user = process.env.DEPLOY_USER || 'root';
  const port = process.env.DEPLOY_PORT || '22';
  const remotePath = process.env.DEPLOY_PATH || '/root/chigua';
  const keyPath = process.env.DEPLOY_KEY || '';
  const webPort = process.env.DEPLOY_WEB_PORT || '4396';
  const apiPort = process.env.DEPLOY_API_PORT || '4395';
  const pm2WebName = process.env.DEPLOY_PM2_WEB_NAME || 'chigua-web';
  const pm2ApiName = process.env.DEPLOY_PM2_API_NAME || 'chigua-api';

  const sshArgs = [
    '-p',
    port,
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=10',
    '-o',
    'StrictHostKeyChecking=accept-new',
  ];
  const scpArgs = [
    '-P',
    port,
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=10',
    '-o',
    'StrictHostKeyChecking=accept-new',
  ];

  if (keyPath) {
    sshArgs.unshift('-i', keyPath);
    scpArgs.unshift('-i', keyPath);
  }

  return {
    host,
    user,
    port,
    remotePath,
    keyPath,
    webPort,
    apiPort,
    pm2WebName,
    pm2ApiName,
    remote: `${user}@${host}`,
    sshArgs,
    scpArgs,
  };
}

export function runRemoteScript(config, script, label) {
  run('ssh', [...config.sshArgs, config.remote, 'bash -s'], {
    input: script,
    label,
  });
}
