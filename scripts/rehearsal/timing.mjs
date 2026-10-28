// Ported from S1.3 jobs.mjs, telemetry.mjs and REH16 api-watch.ps1: read-only timing and safe exit/pool reads.
import { spawn } from 'node:child_process';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
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

function jobTarget(runtime, caseId) {
  if (!/^ulpin-reh-[0-9]{2}$/.test(runtime) || runtime.length !== 12 || runtime === 'ulpin-reh-01'
    || typeof caseId !== 'string' || caseId.length !== 36
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

export async function jobQuery(runtime, sql, execute = executeQuery) {
  let result;
  try {
    result = await execute('docker', ['exec', '-i', '-e', 'PGOPTIONS=-c default_transaction_read_only=on',
      `${runtime}-postgres-1`, 'sh', '-c', 'psql -X -A -t -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
    { input: sql, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
  } catch {
    throw new Error('Read-only job query failed; private stderr not copied');
  }
  if (result.status !== 0) throw new Error('Read-only job query failed; private stderr not copied');
  return JSON.parse(result.stdout.trim());
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
