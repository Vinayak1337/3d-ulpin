// Ported from S1.3 jobs.mjs, telemetry.mjs and REH16 api-watch.ps1: read-only timing and safe exit/pool reads.
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';

export async function get(api, path) {
  const response = await fetch(`${api}${path}`, { signal: AbortSignal.timeout(4500), redirect: 'error' });
  if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

export function jobTiming(runtime, caseId) {
  if (!/^ulpin-reh-[0-9]{2}$/.test(runtime) || runtime.length !== 12 || runtime === 'ulpin-reh-01'
    || !/^[0-9a-f-]{36}$/.test(caseId) || caseId.length !== 36) throw new Error('Invalid read-only job target');
  const sql = `select coalesce(json_agg(row_to_json(t)), '[]') from (
    select j.id, j.operation, j.status, s.name as source, j.attempts,
      round(extract(epoch from coalesce(j.dispatched_at, f.at) - j.created_at)::numeric, 3) as queue_s,
      round(extract(epoch from j.completed_at - coalesce(j.dispatched_at, f.at))::numeric, 3) as exec_s,
      greatest(j.attempts - 1, 0) as retries
    from jobs j left join sources s on s.id = j.source_id
    left join lateral (select min(a.created_at) as at from usp_job_attempts a where a.job_id = j.id) f on true
    where j.case_id = '${caseId}' order by j.created_at, j.id) t;`;
  const result = spawnSync('docker', ['exec', '-i', '-e', 'PGOPTIONS=-c default_transaction_read_only=on',
    `${runtime}-postgres-1`, 'sh', '-c', 'psql -X -A -t -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
  { input: sql, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('Read-only job query failed; private stderr not copied');
  return JSON.parse(result.stdout.trim());
}

export async function exitLines(runtime) {
  const result = {};
  for (const name of ['api', 'dispatcher']) {
    try {
      const text = await readFile(`E:/ulpin-tmp/${runtime}/${name}-exit.jsonl`, 'utf8');
      result[name] = text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      result[name] = null; // Missing hooks are not proof of zero exits.
    }
  }
  return result;
}

export function processWatch(api) {
  const samples = [];
  let pending = Promise.resolve();
  let busy = false;
  const tick = () => {
    if (busy) return;
    busy = true;
    pending = processSample(api).then(sample => samples.push(sample)).finally(() => { busy = false; });
  };
  tick();
  const timer = setInterval(tick, 5000);
  return async () => {
    clearInterval(timer);
    await pending;
    return samples;
  };
}

async function processSample(api) {
  const at = Date.now();
  const health = await get(api, '/health').catch(() => null);
  return { at, healthMs: Date.now() - at, healthOk: health?.ok ?? null,
    pool: health?.pool ?? null, freeMB: Math.round(os.freemem() / 1048576) };
}
