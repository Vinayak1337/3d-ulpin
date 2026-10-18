import { spawn, spawnSync } from 'node:child_process';

// REH7's process sampler: the API's native process (CPU seconds and working set, from Get-Process every 250 ms in
// one long-lived PowerShell) and the rehearsal's Postgres container (CPU% from `docker stats --no-stream`, called
// back to back; each call takes about a second, so its cadence is what the engine allows, recorded per sample).
// Process reads only: no log, no SQL, no file under the runtime folder.
const container = 'ulpin-reh-02-postgres-1';

export function startSampler(pid) {
  const api = [];
  const postgres = [];
  const script = `while ($true) { $p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; `
    + `if ($p) { '{0} {1} {2}' -f [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(), `
    + `$p.TotalProcessorTime.TotalSeconds, $p.WorkingSet64 } else { 'gone' }; Start-Sleep -Milliseconds 250 }`;
  const shell = spawn('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true });
  let partial = '';
  shell.stdout.on('data', chunk => {
    const lines = (partial + chunk).split(/\r?\n/);
    partial = lines.pop();
    for (const line of lines) {
      const [at, cpu, ws] = line.trim().split(' ').map(Number);
      if (!Number.isFinite(cpu)) continue;
      api.push({ at, cpuSeconds: Number(cpu.toFixed(3)), workingSetMB: Math.round(ws / 1048576) });
    }
  });
  let running = true;
  const docker = (async () => {
    while (running) {
      const result = await new Promise(done => {
        const child = spawn('docker', ['stats', '--no-stream', '--format', '{{.CPUPerc}} {{.MemUsage}}', container],
          { windowsHide: true });
        let out = '';
        child.stdout.on('data', chunk => { out += chunk; });
        child.on('close', () => done(out.trim()));
      });
      const cpu = Number(result.split('%')[0]);
      postgres.push({ at: Date.now(), cpuPercent: Number.isFinite(cpu) ? cpu : null,
        memory: result.split(' ').slice(1, 4).join(' ') || null });
    }
  })();
  return {
    api, postgres,
    async stop() {
      running = false;
      await docker;
      spawnSync('taskkill', ['/PID', String(shell.pid), '/T', '/F'], { windowsHide: true });
    },
  };
}

/** The API's CPU seconds between two instants, read from the nearest samples outside them, and Postgres's mean and
 * peak CPU% over the samples that ended inside the span (plus the first after it). */
export function attribute(samples, from, to) {
  const before = [...samples.api].reverse().find(row => row.at <= from) ?? samples.api[0];
  const after = samples.api.find(row => row.at >= to) ?? samples.api[samples.api.length - 1];
  const pg = samples.postgres.filter(row => row.at >= from && row.at <= to + 1500 && row.cpuPercent !== null);
  const cpu = before && after ? Number((after.cpuSeconds - before.cpuSeconds).toFixed(3)) : null;
  const span = before && after ? (after.at - before.at) / 1000 : null;
  return {
    apiCpuSeconds: cpu, apiSampleSpanSeconds: span === null ? null : Number(span.toFixed(3)),
    apiPeakWorkingSetMB: Math.max(...samples.api.filter(row => row.at >= from && row.at <= to)
      .map(row => row.workingSetMB), 0) || null,
    postgresMeanCpuPercent: pg.length ? Number((pg.reduce((s, row) => s + row.cpuPercent, 0) / pg.length).toFixed(1))
      : null,
    postgresPeakCpuPercent: pg.length ? Math.max(...pg.map(row => row.cpuPercent)) : null,
    postgresSamples: pg.length,
  };
}
