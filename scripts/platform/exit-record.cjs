// Opt-in, redacted exit diagnostics. Observing a crash must not turn it into a successful exit.
if (process.env.ULPIN_EXIT_RECORD_FILE) {
  const { appendFileSync } = require('node:fs');
  const { isAbsolute, relative, resolve, sep } = require('node:path');
  const { fileURLToPath } = require('node:url');
  const { getHeapStatistics } = require('node:v8');
  const file = process.env.ULPIN_EXIT_RECORD_FILE;
  const root = resolve(__dirname, '../..');
  let recorded = false;
  let rejection;
  try {
    appendFileSync(file, JSON.stringify({ event: 'start', pid: process.pid, at: Date.now() }) + '\n', { mode: 0o600 });
  } catch {
    // A diagnostic failure must not prevent startup or print private details.
  }

  function firstFrame(error) {
    if (!(error instanceof Error) || typeof error.stack !== 'string') return null;
    for (const line of error.stack.split('\n')) {
      if (!/^\s+at /.test(line)) continue;
      const match = line.match(/\(?((?:file:\/\/\/|[A-Za-z]:[\\/]|\/).+):(\d+):\d+\)?$/);
      if (!match) continue;
      const path = match[1].startsWith('file:') ? fileURLToPath(match[1]) : match[1];
      const local = relative(root, path);
      if (!local || isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) continue;
      return `${local.split(sep).join('/')}:${match[2]}`;
    }
    return null;
  }

  function errorCode(error) {
    const own = typeof error === 'object' && error !== null && Object.hasOwn(error, 'code')
      ? error.code : undefined;
    if (typeof own === 'string' && /^[A-Z0-9_]{1,40}$/.test(own)) return own;
    return error instanceof Error ? error.name : 'unknown';
  }

  function record(code, signal = null, error) {
    if (recorded) return;
    recorded = true;
    try {
      const memory = process.memoryUsage();
      const mib = bytes => bytes / 1024 / 1024;
      appendFileSync(file, JSON.stringify({
        event: 'exit', at: Date.now(),
        code, signal, error: error === undefined ? null : errorCode(error),
        frame: firstFrame(error), uptimeS: process.uptime(),
        rssMiB: mib(memory.rss), heapUsedMiB: mib(memory.heapUsed),
        heapLimitMiB: mib(getHeapStatistics().heap_size_limit),
      }) + '\n', { mode: 0o600 });
    } catch {
      // A diagnostic failure must not replace the original exit outcome or print private details.
    }
  }

  process.once('exit', code => record(code, null, rejection));
  // Unlike uncaughtException, the monitor preserves Node's default fatal exception handling.
  process.on('uncaughtExceptionMonitor', error => record(1, null, error));
  process.on('unhandledRejection', error => {
    rejection = error;
    // Installing a rejection listener suppresses Node's default throw; restore it when no app handler exists.
    if (process.listenerCount('unhandledRejection') === 1) throw error;
  });
  process.once('SIGTERM', () => {
    record(null, 'SIGTERM', rejection);
    // A once-listener has already removed itself. Keep app shutdown handlers, or restore default termination.
    if (process.listenerCount('SIGTERM') === 0) process.kill(process.pid, 'SIGTERM');
  });
}
