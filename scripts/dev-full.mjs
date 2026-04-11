import { spawn } from 'node:child_process';

const tasks = [
  { name: 'server', args: ['run', 'server'] },
  { name: 'dev', args: ['run', 'dev'] },
];

const children = [];
let shuttingDown = false;
let finalExitCode = 0;

const writePrefixed = (prefix, writer) => {
  let atLineStart = true;
  return (chunk) => {
    const text = String(chunk);
    for (const char of text) {
      if (atLineStart) {
        writer.write(`${prefix} `);
        atLineStart = false;
      }
      writer.write(char);
      if (char === '\n') {
        atLineStart = true;
      }
    }
  };
};

const stopChild = (child) => {
  if (!child?.pid || child.killed || child.exitCode !== null) {
    return;
  }

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
};

const shutdown = (exitCode = 0) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  finalExitCode = exitCode;
  process.exitCode = finalExitCode;
  children.forEach(stopChild);
  setTimeout(() => process.exit(finalExitCode), 500);
};

const createSpawnConfig = (args) => {
  if (process.platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', ['npm', ...args].join(' ')],
    };
  }
  return {
    command: 'npm',
    args,
  };
};

tasks.forEach((task, index) => {
  const spawnConfig = createSpawnConfig(task.args);
  const child = spawn(spawnConfig.command, spawnConfig.args, {
    cwd: process.cwd(),
    env: process.env,
    detached: process.platform !== 'win32',
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  children.push(child);

  const prefix = `[${index}]`;
  child.stdout.on('data', writePrefixed(prefix, process.stdout));
  child.stderr.on('data', writePrefixed(prefix, process.stderr));

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }
    const exitCode = typeof code === 'number' ? code : signal ? 1 : 0;
    shutdown(exitCode);
  });
});

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));
