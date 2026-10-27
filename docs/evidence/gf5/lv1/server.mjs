import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

export function freePort(port) {
  return new Promise((accept, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(accept));
  });
}

export function startServer({ root, scratch, port, python }) {
  const child = spawn('bash', ['-lc', `pnpm --config.script-shell=bash studio:demo --port ${port}`], {
    cwd: root,
    env: { ...process.env, ULPIN_DEMO_DIR: `${scratch}/transport`, ULPIN_DEMO_PYTHON: python },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  const ready = new Promise((accept, reject) => {
    const timer = setTimeout(() => reject(new Error('Vite readiness timeout')), 60000);
    child.once('exit', (code) => reject(new Error(`Vite exited ${code}`)));
    const capture = (bytes) => {
      log += bytes.toString().replace(/\x1b\[[0-9;]*m/g, '');
      if (log.includes(`127.0.0.1:${port}`)) {
        clearTimeout(timer);
        accept();
      }
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
  });
  return { child, ready, log: () => log };
}

export async function stopServer(child, port) {
  if (process.platform === 'win32') {
    await new Promise((accept) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      killer.once('exit', accept);
    });
  } else child.kill('SIGTERM');
  await freePort(port);
}
