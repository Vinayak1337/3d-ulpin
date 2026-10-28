// Ported from S1.3 jobs.mjs, telemetry.mjs and REH16 api-watch.ps1: read-only timing and safe exit/pool reads.
import { spawn } from 'node:child_process';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { open, readFile } from 'node:fs/promises';
import os from 'node:os';

export async function runnerActivity(activities, kind, action, page = null) {
  const activity = { kind, page, at: Date.now(), to: null };
  activities.push(activity);
  try { return await action(); }
  finally { activity.to = Date.now(); }
}

// Persistent read-only sampler; names and PIDs only, never process command lines or environment values.
const cpuScript = `while ($true) {
  $at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  try {
    $total = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
    $top = @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process |
      Where-Object { $_.IDProcess -ne 0 -and $_.Name -ne '_Total' } |
      Sort-Object PercentProcessorTime -Descending | Select-Object -First 5 | ForEach-Object {
        @{ name = $_.Name; pid = $_.IDProcess; percent = $_.PercentProcessorTime / [Environment]::ProcessorCount }
      })
    @{ at = $at; percent = $total; top = $top } | ConvertTo-Json -Compress -Depth 4
  } catch { @{ at = $at; percent = $null; top = $null } | ConvertTo-Json -Compress }
  Start-Sleep -Seconds 5
}`;

export function cpuWatch(samples, launch = spawn, platform = process.platform) {
  if (platform !== 'win32') return async () => {}; // Unsupported measurements remain absent, not zero.
  const child = launch('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cpuScript],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let pending = '';
  child.stderr.resume();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) {
      try { samples.push(JSON.parse(line)); }
      catch { /* An incomplete measurement is not a CPU reading. */ }
    }
  });
  const closed = new Promise(resolve => { child.once('close', resolve); child.once('error', resolve); });
  return async () => { child.kill(); await closed; };
}

export function nearestCpu(start, samples) {
  const sample = samples.reduce((best, row) => !best || Math.abs(row.at - start) < Math.abs(best.at - start)
    ? row : best, null);
  return sample ? { at: sample.at, offsetMs: sample.at - start, percent: sample.percent ?? null,
    top: sample.top ?? null } : null;
}

export async function get(api, path, timeoutMs = 4500) {
  const response = await fetch(`${api}${path}`, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

function runtimeTarget(runtime) {
  if (!/^ulpin-reh-[0-9]{2}$/.test(runtime) || runtime.length !== 12 || runtime === 'ulpin-reh-01') {
    throw new Error('Invalid read-only job target');
  }
}

function jobTarget(runtime, caseId) {
  runtimeTarget(runtime);
  if (typeof caseId !== 'string' || caseId.length !== 36
    || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(caseId)) {
    throw new Error('Invalid read-only job target');
  }
}

export async function jobTiming(runtime, caseId, execute = executeQuery) {
  jobTarget(runtime, caseId);
  const sql = `select coalesce(json_agg(row_to_json(t)), '[]') from (
    select j.id, j.operation, j.status, s.name as source, j.attempts,
      round(extract(epoch from coalesce(j.dispatched_at, f.at) - j.created_at)::numeric, 3) as queue_s,
      round(extract(epoch from j.completed_at - coalesce(j.dispatched_at, f.at))::numeric, 3) as exec_s,
      greatest(j.attempts - 1, 0) as retries
    from jobs j left join sources s on s.id = j.source_id
    left join lateral (select min(a.created_at) as at from usp_job_attempts a where a.job_id = j.id) f on true
    where j.case_id = '${caseId}' order by j.created_at, j.id) t;`;
  return await jobQuery(runtime, sql, execute);
}

export async function queueDepth(runtime, caseId, execute = executeQuery) {
  jobTarget(runtime, caseId);
  const at = Date.now();
  const sql = `select json_build_object(
    'queued', count(*) filter (where status = 'queued'),
    'running', count(*) filter (where status = 'running')) from jobs where case_id = '${caseId}';`;
  return { at, counts: await jobQuery(runtime, sql, execute) };
}

function executeQuery(command, args, options) {
  return new Promise((resolve, reject) => {
    const { input, maxBuffer, ...settings } = options;
    const child = spawn(command, args, settings);
    const chunks = [];
    let bytes = 0;
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBuffer) {
        child.kill();
        reject(new Error('Query output limit'));
      } else chunks.push(chunk);
    });
    child.stderr.resume(); // Private stderr is drained, never retained or copied.
    child.once('error', reject);
    child.stdin.on('error', reject);
    child.once('close', status => resolve({ status, stdout: Buffer.concat(chunks).toString('utf8') }));
    child.stdin.end(input);
  });
}

export async function jobQuery(runtime, sql, execute = executeQuery, timeoutMs = 30000) {
  let result, timer;
  const readOnly = 'PGOPTIONS=-c default_transaction_read_only=on';
  // Short samples also stop inside PostgreSQL if killing docker exec leaves its server query alive.
  const pgOptions = timeoutMs < 30000 ? `${readOnly} -c statement_timeout=${timeoutMs}` : readOnly;
  try {
    const expired = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Query timeout')), timeoutMs);
    });
    const query = execute('docker', ['exec', '-i', '-e', pgOptions,
      `${runtime}-postgres-1`, 'sh', '-c', 'psql -X -A -t -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
    { input: sql, encoding: 'utf8', windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
    result = await Promise.race([query, expired]);
  } catch {
    throw new Error('Read-only job query failed; private stderr not copied');
  } finally { clearTimeout(timer); }
  if (result.status !== 0) throw new Error('Read-only job query failed; private stderr not copied');
  return JSON.parse(result.stdout.trim());
}

const redact = value => value.replace(/[A-Z0-9_.%+-]+@[A-Z0-9.-]+/gi, '[redacted-email]')
  .replace(/[a-f0-9]{24,}/gi, '[redacted-hex]');
const safeQuery = alias => `left(regexp_replace(regexp_replace(${alias}.query,
  '[[:alnum:]_.%+-]+@[[:alnum:].-]+', '[redacted-email]', 'gi'),
  '[[:xdigit:]]{24,}', '[redacted-hex]', 'gi'), 300)`;

export async function lockWaits(runtime, execute = executeQuery) {
  runtimeTarget(runtime);
  const sql = `select coalesce(json_agg(row_to_json(t)), '[]') from (
    select now() as at, w.pid, w.wait_event, w.xact_start, w.query_start, ${safeQuery('w')} as query,
      coalesce(l.wait_start, w.state_change) as wait_start,
      extract(epoch from now() - coalesce(l.wait_start, w.state_change)) as waited_s, l.locks,
      (select coalesce(json_agg(json_build_object('pid', p.pid, 'state', b.state,
        'xact_start', b.xact_start, 'query_start', b.query_start, 'wait_event', b.wait_event,
        'query', ${safeQuery('b')}) order by p.pid), '[]')
        from unnest(pg_blocking_pids(w.pid)) p(pid)
        left join pg_stat_activity b on b.pid = p.pid) as blockers
    from pg_stat_activity w
    left join lateral (select min(k.waitstart) as wait_start,
      json_agg(json_build_object('locktype', k.locktype, 'mode', k.mode,
        'relation', k.relation::regclass::text, 'relation_oid', k.relation, 'database', k.database,
        'classid', k.classid, 'objid', k.objid, 'objsubid', k.objsubid,
        'transactionid', k.transactionid, 'virtualxid', k.virtualxid, 'page', k.page, 'tuple', k.tuple)
        order by k.locktype, k.mode, k.relation, k.classid, k.objid, k.objsubid) as locks
      from pg_locks k where k.pid = w.pid and not k.granted) l on true
    where w.datid = (select oid from pg_database where datname = current_database())
      and w.wait_event_type = 'Lock' and now() - coalesce(l.wait_start, w.state_change) > interval '5 seconds'
    order by w.pid) t;`;
  const rows = await jobQuery(runtime, sql, execute, 4000);
  // Redact all strings too, including relation names and recorded executor output used in tests.
  return JSON.parse(JSON.stringify(rows, (key, value) => {
    if (typeof value !== 'string') return value;
    return key === 'query' ? redact(value).slice(0, 300) : redact(value);
  }));
}

export function lockWaitSummary() {
  return { file: 'lock-waits.jsonl', started: false, samples: 0, failedSamples: 0, skippedTicks: 0,
    records: 0, capped: false, waitsOver5s: 0, longestSeconds: null, blockerQueries: [] };
}

async function lockChange(state, record) {
  if (state.summary.records >= 2000) {
    state.summary.capped = true;
    return;
  }
  await state.log.writeFile(`${JSON.stringify(record)}\n`);
  state.summary.records += 1;
}

function blockedSeconds(state, row, previous) {
  const queries = new Set(row.blockers.map(blocker => blocker.query));
  for (const query of queries) {
    let entry = state.summary.blockerQueries.find(entry => entry.query === query);
    if (!entry) state.summary.blockerQueries.push(entry = { query, totalBlockedSeconds: 0 });
    // Only adjacent successful observations of the same wait and blocker query establish an interval.
    if (previous?.at && previous.queries.has(query)) {
      entry.totalBlockedSeconds += Math.max(0, (Date.parse(row.at) - Date.parse(previous.at)) / 1000);
    }
  }
  return queries;
}

async function recordLockSample(state, rows) {
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.pid}:${row.wait_start}`;
    seen.add(key);
    const previous = state.active.get(key);
    if (!previous) state.summary.waitsOver5s += 1;
    state.summary.longestSeconds = Math.max(state.summary.longestSeconds ?? 0, Number(row.waited_s));
    const { at, waited_s, ...values } = row;
    const signature = JSON.stringify(values);
    const queries = blockedSeconds(state, row, previous);
    if (signature !== previous?.signature) await lockChange(state, { event: 'wait', ...row });
    state.active.set(key, { signature, queries, at, pid: row.pid, wait_start: row.wait_start });
  }
  for (const [key, previous] of state.active) {
    if (seen.has(key)) continue;
    await lockChange(state, { event: 'no_longer_observed', at: new Date().toISOString(),
      pid: previous.pid, wait_start: previous.wait_start });
    state.active.delete(key);
  }
}

export async function lockWatch(runtime, path, summary, execute = executeQuery) {
  runtimeTarget(runtime);
  let log;
  try { log = await open(path, 'wx'); }
  catch { summary.failedSamples += 1; return async () => {}; }
  summary.started = true;
  const state = { log, summary, active: new Map() };
  let pending = null;
  const tick = () => {
    if (pending) { summary.skippedTicks += 1; return; }
    pending = lockWaits(runtime, execute).then(rows => recordLockSample(state, rows)).catch(() => {
      summary.failedSamples += 1;
      for (const previous of state.active.values()) previous.at = null;
    }).finally(() => { summary.samples += 1; pending = null; });
  };
  tick();
  const timer = setInterval(tick, 5000);
  return async () => {
    clearInterval(timer);
    await pending;
    await log.close().catch(() => { summary.failedSamples += 1; });
  };
}

export async function exitLines(runtime, read = readFile) {
  const result = {};
  for (const name of ['api', 'dispatcher']) {
    try {
      const text = await read(`E:/ulpin-tmp/${runtime}/${name}-exit.jsonl`, 'utf8');
      result[name] = text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      result[name] = null; // Missing hooks are not proof of zero exits.
    }
  }
  return result;
}

export function dropExits(lines, dropAt) {
  return Object.fromEntries(['api', 'dispatcher'].map(name => {
    const records = lines?.[name] ?? [];
    const started = records.some(line => line.event === 'start');
    return [name, { exitHook: started ? 'present' : 'missing',
      exitsDuringDrop: records.filter(line => line.event === 'exit' && line.at >= dropAt) }];
  }));
}

export function processWatch(api, read = get) {
  const samples = [];
  let pending = Promise.resolve();
  let busy = false;
  const tick = () => {
    if (busy) return;
    busy = true;
    pending = processSample(api, read).then(sample => samples.push(sample)).finally(() => { busy = false; });
  };
  tick();
  const timer = setInterval(tick, 5000);
  return async () => {
    clearInterval(timer);
    await pending;
    return samples;
  };
}

async function processSample(api, read) {
  const at = Date.now();
  const startMono = performance.now();
  const health = await read(api, '/health').catch(() => null);
  return { at, startMono, healthMs: performance.now() - startMono, healthOk: health?.ok ?? null,
    pool: health?.pool ?? null, freeMB: Math.round(os.freemem() / 1048576) };
}

export function runnerLoopWatch(windows, monitor = monitorEventLoopDelay, now = () => performance.now()) {
  const histogram = monitor({ resolution: 20 });
  let at = Date.now();
  let startMono = now();
  let last = startMono;
  let delays = [];
  let stopped = false;
  const heartbeat = () => {
    const endMono = now();
    // Histograms have no timestamps; heartbeat gaps locate delayed samples on the same monotonic clock as reads.
    if (endMono - last > 1000) delays.push({ startMono: last, endMono, ms: endMono - last });
    last = endMono;
  };
  histogram.enable();
  const timer = setInterval(heartbeat, 20);
  timer.unref();
  const capture = () => {
    heartbeat();
    const to = Date.now();
    const endMono = last;
    windows.push({ at, to, startMono, endMono, maxMs: histogram.count ? histogram.max / 1e6 : null,
      p99Ms: histogram.count ? histogram.percentile(99) / 1e6 : null, delays });
    histogram.reset();
    at = to;
    startMono = endMono;
    delays = [];
  };
  return { capture, stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    capture();
    histogram.disable();
  } };
}

export function attributeReads(process) {
  const delays = (process.runnerLoop ?? []).flatMap(window => window.delays);
  const counts = samples => {
    const summary = { runnerBlocked: 0, unblocked: 0 };
    for (const sample of samples) {
      const ms = sample.ms ?? sample.healthMs;
      sample.runnerBlocked = delays.some(delay => sample.startMono < delay.endMono
        && delay.startMono < sample.startMono + ms);
      if (ms > 1000) summary[sample.runnerBlocked ? 'runnerBlocked' : 'unblocked'] += 1;
    }
    return summary;
  };
  process.slowReads = { thresholdMs: 1000, polls: counts(process.polls ?? []), health: counts(process.samples ?? []) };
  return process.slowReads;
}
