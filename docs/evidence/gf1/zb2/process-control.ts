import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';

export async function apiProcesses(result: Record<string, any>) {
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('No loopback port.');
  process.env.API_PORT = String(address.port);
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  let child: ChildProcess | undefined;
  const start = async () => {
    child = spawn(process.execPath, ['--require', './scripts/platform/isolated-env.cjs', '--import', 'tsx',
      'docs/evidence/gf1/zb2/api-process.ts'], { env: { ...process.env, NODE_ENV: 'test' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let stderr = '';
    child.stderr!.on('data', bytes => { stderr += bytes.toString(); });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Owned API start exceeded 30 seconds.')), 30000);
      child!.on('message', (message: any) => {
        if (message.ready) {
          clearTimeout(timer);
          resolve();
        }
        if (message.failure) result.dispatchFailure = message.failure;
      });
      child!.once('exit', code => {
        clearTimeout(timer);
        if (code) reject(new Error(`Owned API exited ${code}: ${stderr.slice(-1000)}`));
      });
    });
  };
  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    const owned = child;
    await new Promise<void>(resolve => {
      owned.once('exit', () => resolve());
      owned.kill('SIGKILL');
    });
    child = undefined;
  };
  return { start, stop };
}
