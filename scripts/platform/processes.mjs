import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { command, root } from './runtime.mjs';
import { definedRuntime, demoRuntime, freePort, safeEnvironment } from './demo-config.mjs';
const labels = ['api', 'dispatcher'];
// Every function takes the runtime it acts for and reads or writes that runtime's folder only.
const recordFile = (runtime, label) => join(runtime.dir, `${label}.process.json`);
const delay = ms => new Promise(ok => setTimeout(ok, ms));
export function processInfo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid process ID.');
  if (process.platform === 'win32') {
    const output = command('powershell.exe', ['-NoProfile', '-Command', `$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if($p){$p|Select-Object ProcessId,ExecutablePath,CommandLine,CreationDate|ConvertTo-Json -Compress}`]);
    return output ? JSON.parse(output) : null;
  }
  try { return { CreationDate: readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ')[21],
    CommandLine: readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' '), ExecutablePath: process.execPath }; }
  catch { return null; }
}
export function ownedProcess(label, name = demoRuntime) {
  const runtime = definedRuntime(name);
  if (!labels.includes(label)) throw new Error('Unknown native process label.');
  if (!existsSync(recordFile(runtime, label))) return null;
  const record = JSON.parse(readFileSync(recordFile(runtime, label), 'utf8'));
  if (record.project !== runtime.project || record.label !== label) {
    throw new Error('Unexpected process ownership record.');
  }
  const current = processInfo(record.pid);
  if (!current) return null;
  if (current.CreationDate !== record.creationDate || !current.CommandLine.includes(record.entry)
    || resolve(current.ExecutablePath).toLowerCase() !== resolve(record.executable).toLowerCase()
    || !current.CommandLine.includes(record.preload)) throw new Error(`${label} PID identity changed; refusing to stop or adopt it.`);
  return record;
}
export async function launchProcesses(env, name = demoRuntime) {
  const runtime = definedRuntime(name);
  for (const label of labels) {
    if (ownedProcess(label, runtime)) continue;
    if (label === 'api') await freePort(env.API_PORT);
    const entry = join(root, label === 'api' ? 'apps/api/src/main.ts' : 'scripts/dispatcher.ts');
    const preload = join(root, 'scripts/platform/isolated-env.cjs');
    const log = openSync(join(runtime.dir, 'logs', `${label}.log`), 'a', 0o600);
    const child = spawn(process.execPath, ['--require', preload, '--import', 'tsx', entry], {
      cwd: root, env: { ...safeEnvironment(env), ...(label === 'api' ? { TSX_TSCONFIG_PATH: join(root, 'apps/api/tsconfig.json') } : {}) },
      detached: true, windowsHide: true, stdio: ['ignore', log, log],
    });
    closeSync(log); child.unref();
    if (!child.pid) throw new Error(`${label} failed to spawn; inspect its private log.`);
    let info;
    for (let n = 0; n < 30; n++) {
      info = processInfo(child.pid);
      if (info?.CommandLine?.includes(entry)) break;
      await delay(100);
    }
    if (!info?.CommandLine?.includes(entry)) throw new Error(`${label} exited before ownership could be recorded; inspect its private log.`);
    const record = { project: runtime.project, label, pid: child.pid, creationDate: info.CreationDate,
      executable: process.execPath, entry, preload };
    writeFileSync(recordFile(runtime, label), JSON.stringify(record) + '\n', { mode: 0o600 });
  }
}
/** Stops the two processes recorded in this runtime's folder and no other; the records themselves stay. */
export async function stopProcesses(name = demoRuntime) {
  const runtime = definedRuntime(name);
  for (const label of labels) {
    const record = ownedProcess(label, runtime);
    if (record) process.kill(record.pid, 'SIGTERM');
  }
  for (let n = 0; n < 40; n++) {
    if (labels.every(label => !ownedProcess(label, runtime))) return;
    await delay(250);
  }
  throw new Error('Recorded native processes did not stop within ten seconds; no unrelated process was killed.');
}
export async function waitForApi(env, name = demoRuntime) {
  const runtime = definedRuntime(name);
  for (let n = 0; n < 60; n++) {
    if (!labels.every(label => ownedProcess(label, runtime))) {
      throw new Error('A native process exited; inspect its private log.');
    }
    try {
      const response = await fetch(`http://127.0.0.1:${env.API_PORT}/api/v1/health`, { signal: AbortSignal.timeout(8000) });
      const health = await response.json();
      if (response.ok && health.ok && health.databaseReadiness?.schema?.ready) return;
      if (health.databaseReadiness?.status === 'schema_missing') throw new Error('Demo schema missing after explicit bootstrap migrations.');
    } catch (error) { if (error.message === 'Demo schema missing after explicit bootstrap migrations.') throw error; }
    await delay(1000);
  }
  throw new Error('API readiness timed out; preserve the checkpoint and inspect private logs.');
}
