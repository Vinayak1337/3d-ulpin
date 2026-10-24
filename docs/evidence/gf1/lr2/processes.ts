import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

// The product's own entry points: the API listener and the job dispatcher, each in its own process.
const entries = { api: 'apps/api/src/main.ts', dispatcher: 'scripts/dispatcher.ts' };
type Name = keyof typeof entries;
type Running = { child: ChildProcess; started: number; exited?: number | null };
const running = new Map<Name, Running>();
const log: { name: Name; at: string; event: string; lines?: string[] }[] = [];
const tails = new Map<Name, string[]>();

export async function freePort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  await new Promise<void>(resolve => server.close(() => resolve()));
  return address.port;
}

function keepTail(name: Name, chunk: Buffer) {
  const lines = [...(tails.get(name) ?? []), ...chunk.toString().split(/\r?\n/).filter(Boolean)];
  tails.set(name, lines.slice(-40));
}

function launch(name: Name) {
  const child = spawn(process.execPath, ['--require', './scripts/platform/isolated-env.cjs',
    '--require', './docs/evidence/gf1/lr2/loopback.cjs', '--import', 'tsx', entries[name]],
  { windowsHide: true, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const entry: Running = { child, started: Date.now() };
  child.stdout!.on('data', chunk => keepTail(name, chunk));
  child.stderr!.on('data', chunk => keepTail(name, chunk));
  child.on('exit', code => {
    entry.exited = code;
    log.push({ name, at: new Date().toISOString(), event: `exit ${code}`, lines: tails.get(name) });
  });
  running.set(name, entry);
  log.push({ name, at: new Date().toISOString(), event: `start pid ${child.pid}` });
  return entry;
}

async function apiAnswers() {
  for (let attempt = 0; attempt < 240; attempt++) {
    assert.equal(running.get('api')?.exited, undefined, `API exited: ${tails.get('api')?.join(' | ')}`);
    const ok = await fetch(`http://127.0.0.1:${process.env.API_PORT}/api`).then(r => r.ok, () => false);
    if (ok) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('The API did not answer within 60 seconds.');
}

async function dispatcherRunning() {
  for (let attempt = 0; attempt < 240; attempt++) {
    assert.equal(running.get('dispatcher')?.exited, undefined,
      `Dispatcher exited: ${tails.get('dispatcher')?.join(' | ')}`);
    if (tails.get('dispatcher')?.includes('Application job dispatcher running.')) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('The dispatcher did not start within 60 seconds.');
}

export async function startProcesses() {
  launch('api');
  await apiAnswers();
  launch('dispatcher');
  await dispatcherRunning();
}

/** A hard stop, as a crash or a power cut leaves it: no shutdown hook runs and open transactions roll back. */
export async function killProcesses() {
  for (const [name, entry] of running) {
    if (entry.exited !== undefined) continue;
    const exited = new Promise(resolve => entry.child.once('exit', resolve));
    entry.child.kill('SIGKILL');
    await exited;
    log.push({ name, at: new Date().toISOString(), event: 'killed' });
  }
  tails.clear();
}

export function processLog() {
  return log;
}
