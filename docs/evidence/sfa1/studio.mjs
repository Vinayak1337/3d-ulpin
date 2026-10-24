import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { serving } from '../runtime/reh10/audit.mjs';

const scratch = 'E:/BhuAayam-data/task-data/sfa1';
mkdirSync(scratch, { recursive: true });
if (process.argv[2] === 'start') {
  const vite = spawn(process.execPath, [`${serving}/apps/studio/node_modules/vite/bin/vite.js`], {
    cwd: `${serving}/apps/studio`, env: { ...process.env, ULPIN_API_TARGET: 'http://127.0.0.1:21026' },
    detached: true, windowsHide: true,
    stdio: ['ignore', openSync(`${scratch}/vite.log`, 'a'), openSync(`${scratch}/vite-error.log`, 'a')],
  });
  vite.unref();
  const control = spawn(process.execPath, ['docs/evidence/runtime/reh10/dress.mjs'], {
    cwd: serving, env: { ...process.env, REH10_SCRATCH: scratch }, detached: true, windowsHide: true,
    stdio: ['ignore', openSync(`${scratch}/control.log`, 'a'), openSync(`${scratch}/control-error.log`, 'a')],
  });
  control.unref();
  writeFileSync(`${scratch}/processes.json`, JSON.stringify({ vite: vite.pid, control: control.pid }) + '\n',
    { flag: 'wx' });
  console.log(JSON.stringify({ vite: vite.pid, control: control.pid }));
} else {
  assert.equal(process.argv[2], 'stop');
  const pids = JSON.parse(readFileSync(`${scratch}/processes.json`, 'utf8'));
  const result = spawnSync('taskkill', ['/PID', String(pids.vite), '/T', '/F'], { encoding: 'utf8' });
  console.log(result.stdout.trim());
  process.exitCode = result.status;
}
