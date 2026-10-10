import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { readDemo, safeEnvironment, redact } from '../platform/demo-config.mjs';

function main() {
  const [directory, kind] = process.argv.slice(2);
  const inside = relative(resolve('E:/BhuAayam-data/task-data/a3c'), resolve(directory));
  assert(inside && !inside.startsWith('..') && !isAbsolute(inside), 'A3C_RECEIPT_PATH_DENIED');
  assert(['raw', 'mapped', 'approved'].includes(kind), 'A3C_JOB_KIND_DENIED');
  const receipt = JSON.parse(readFileSync(join(directory, 'receipt.json'), 'utf8'));
  const jobId = kind === 'mapped' ? receipt.jobId : JSON.parse(readFileSync(join(directory,
    kind === 'raw' ? 'raw.json' : 'approval-job.json'), 'utf8')).jobId;
  const env = readDemo(); // Existing platform loader; never expose or directly open credentials in this runner.
  const root = resolve('.');
  const preload = join(root, 'scripts/platform/isolated-env.cjs');
  const run = spawnSync(process.execPath, ['--require', preload, '--import', 'tsx',
    join(root, 'scripts/agent/a3c-work-job.ts'), kind === 'raw' ? 'streaming-vector' : 'chunk-mapping',
    jobId, receipt.caseId], { cwd: root, encoding: 'utf8', timeout: 150000,
    env: { ...safeEnvironment(env), ULPIN_MAPPING_TEACHER_ADAPTER: 'manual' }, windowsHide: true });
  console.log(redact((run.stdout ?? '') + (run.stderr ?? ''), env));
  process.exitCode = run.status ?? 1;
}

try { main(); }
catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
