import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { save } from './audit.mjs';

// IL1/CC1 timing for REH15: every job of one case, read in a read-only transaction from the ulpin-reh-02 database
// through its own container (the container's settings name the role; nothing is printed but rows). Queue delay is
// the claim (dispatched_at, else the first fenced attempt) less created_at; execution is completed_at less that
// claim; retries are attempts above one.
// Usage: node jobs.mjs <receipt name> <case id> [source name fragment]
const [name, caseId, fragment = ''] = process.argv.slice(2);
if (!/^[0-9a-f-]{36}$/.test(caseId ?? '')) throw new Error('Usage: node jobs.mjs <name> <case id> [source fragment]');
const like = fragment.replace(/[^A-Za-z0-9_.-]/g, '');
const sql = `select coalesce(json_agg(row_to_json(t) order by t.created_at), '[]') from (
  select j.operation, j.status, s.name as source, j.attempts, j.error is not null as failed,
    j.created_at, j.dispatched_at, j.started_at, j.completed_at, j.next_attempt_at,
    round(extract(epoch from coalesce(j.dispatched_at, f.at) - j.created_at)::numeric, 3) as queue_s,
    round(extract(epoch from j.completed_at - coalesce(j.dispatched_at, f.at))::numeric, 3) as exec_s,
    (select json_agg(json_build_object('n', a.number, 'state', a.state, 'leaseUntil', a.lease_until,
      'at', a.created_at) order by a.number) from usp_job_attempts a where a.job_id = j.id) as leases
  from jobs j left join sources s on s.id = j.source_id
  left join lateral (select min(a.created_at) as at from usp_job_attempts a where a.job_id = j.id) f on true
  where j.case_id = '${caseId}' and ('${like}' = '' or coalesce(s.name, '') like '%${like}%')) t`;
const result = spawnSync('docker', ['exec', '-i', '-e', 'PGOPTIONS=-c default_transaction_read_only=on',
  'ulpin-reh-02-postgres-1', 'sh', '-c', 'psql -X -A -t -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
{ input: sql, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
if (result.status !== 0) throw new Error(`Read-only job query failed: ${result.stderr.slice(0, 300)}`);
const rows = JSON.parse(result.stdout.trim());
writeFileSync(`E:/BhuAayam-data/task-data/reh15/jobs-${name}.json`, JSON.stringify(rows, null, 2));
const sum = key => Number(rows.reduce((total, row) => total + Number(row[key] ?? 0), 0).toFixed(3));
const byOperation = {};
for (const row of rows) {
  const entry = byOperation[row.operation] ??= { jobs: 0, queueMaxS: 0, execMaxS: 0, retries: 0, notDone: 0 };
  entry.jobs += 1;
  entry.queueMaxS = Math.max(entry.queueMaxS, Number(row.queue_s ?? 0));
  entry.execMaxS = Math.max(entry.execMaxS, Number(row.exec_s ?? 0));
  entry.retries += Math.max(0, row.attempts - 1);
  if (row.status !== 'succeeded') entry.notDone += 1;
}
const span = rows.length ? { firstCreated: rows[0].created_at,
  lastCompleted: rows.map(row => row.completed_at).filter(Boolean).sort().at(-1) ?? null } : null;
const summary = { at: new Date().toISOString(), caseId, source: like || 'all', jobs: rows.length, span,
  queueSumS: sum('queue_s'), execSumS: sum('exec_s'), byOperation };
save(`jobs-${name}.json`, summary);
console.log(JSON.stringify(summary));
