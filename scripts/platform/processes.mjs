import { spawn } from 'node:child_process';
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { command, root } from './runtime.mjs';
import { definedRuntime, demoRuntime, freePort, safeEnvironment } from './demo-config.mjs';
const labels = ['api', 'dispatcher'];
// Every function takes the runtime it acts for and reads or writes that runtime's folder only; the demo's
// stopped-on-purpose marker in the Docker guard's ops folder is the one exception.
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
/**
 * The recorded process, or null when it has exited. A PID now held by a process created at another time means the
 * recorded one exited and the PID was reused: its record is moved aside, never deleted, and a later launch writes anew.
 */
export function ownedProcess(label, name = demoRuntime, { info = processInfo } = {}) {
  const runtime = definedRuntime(name);
  if (!labels.includes(label)) throw new Error('Unknown native process label.');
  const file = recordFile(runtime, label);
  if (!existsSync(file)) return null;
  const record = JSON.parse(readFileSync(file, 'utf8'));
  if (record.project !== runtime.project || record.label !== label) {
    throw new Error('Unexpected process ownership record.');
  }
  const current = info(record.pid);
  if (!current) return null;
  if (current.CreationDate !== record.creationDate) {
    renameSync(file, `${file}.exited-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`);
    console.log(`${label} process record moved aside: recorded creation ${record.creationDate}, `
      + `PID now held by a process created ${current.CreationDate}.`);
    return null;
  }
  if (!current.CommandLine.includes(record.entry)
    || resolve(current.ExecutablePath).toLowerCase() !== resolve(record.executable).toLowerCase()
    || !current.CommandLine.includes(record.preload)) throw new Error(`${label} PID identity changed; refusing to stop or adopt it.`);
  return record;
}
export async function launchProcesses(env, name = demoRuntime) {
  const runtime = definedRuntime(name);
  const exitDir = join('E:/ulpin-tmp', runtime.name);
  mkdirSync(exitDir, { recursive: true });
  for (const label of labels) {
    if (ownedProcess(label, runtime)) continue;
    if (label === 'api') await freePort(env.API_PORT);
    const entry = join(root, label === 'api' ? 'apps/api/src/main.ts' : 'scripts/dispatcher.ts');
    const preload = join(root, 'scripts/platform/isolated-env.cjs');
    const exitPreload = join(root, 'scripts/platform/exit-record.cjs');
    const log = openSync(join(runtime.dir, 'logs', `${label}.log`), 'a', 0o600);
    const child = spawn(process.execPath, ['--require', preload, '--require', exitPreload, '--import', 'tsx', entry], {
      cwd: root, env: { ...safeEnvironment(env), ULPIN_EXIT_RECORD_FILE: join(exitDir, `${label}-exit.jsonl`),
        ...(label === 'api' ? { TSX_TSCONFIG_PATH: join(root, 'apps/api/tsconfig.json') } : {}) },
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
/** The Docker guard's ops folder; ULPIN_DOCKER_GUARD_OPS_DIR stands in for it in tests. */
export const guardOpsDir = () => process.env.ULPIN_DOCKER_GUARD_OPS_DIR || 'E:/BhuAayam-data/ops/docker-guard';
export const stoppedOnPurposeFile = (opsDir = guardOpsDir()) => join(opsDir, 'demo-stopped-on-purpose.json');
/**
 * While this marker exists the Docker guard does not start the demo. Only the demo runtime writes or removes it;
 * a rehearsal does neither. A demo start removes it once the API answers.
 */
function markStoppedOnPurpose(runtime, opsDir) {
  if (runtime.rehearsal) return;
  mkdirSync(opsDir, { recursive: true });
  writeFileSync(stoppedOnPurposeFile(opsDir), JSON.stringify({ stoppedAt: new Date().toISOString() }) + '\n');
}
export function clearStoppedOnPurpose(name = demoRuntime, opsDir = guardOpsDir()) {
  if (!definedRuntime(name).rehearsal) rmSync(stoppedOnPurposeFile(opsDir), { force: true });
}
/**
 * Stops the two processes recorded in this runtime's folder and no other; the records themselves stay. For the demo
 * the stopped-on-purpose marker is written first, so a stop that fails partway still leaves it.
 */
export async function stopProcesses(name = demoRuntime, opsDir = guardOpsDir()) {
  const runtime = definedRuntime(name);
  markStoppedOnPurpose(runtime, opsDir);
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
