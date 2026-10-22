// Runs the real docker-guard.ps1 under Windows PowerShell 5.1 against a made-up root in a temporary folder
// (DOCKER_GUARD_TEST_DIR, else the system temp folder) with stand-in docker and pnpm .cmd files. Acting modes
// use -DryRun or a stand-in pnpm under the made-up root; the live Docker and demo are never acted on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./docker-guard.ps1', import.meta.url));
const installer = fileURLToPath(new URL('./docker-guard-install.ps1', import.meta.url));
const base = process.env.DOCKER_GUARD_TEST_DIR || tmpdir();
const powershell = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const psLiteral = value => `'${value.replaceAll("'", "''")}'`;
const stamp = '20261021-030000';
const stubDocker = [
  '@echo off',
  'set /p CODE=<"%~dp0engine.txt"',
  'if not "%CODE%"=="0" exit /b %CODE%',
  'if "%1"=="ps" type "%~dp0ps.txt"',
  'if "%1"=="version" echo 29.8.0',
  'exit /b 0',
  ''
].join('\r\n');
// The stand-in pnpm records its working folder and arguments; its doctor prints two PASS lines and one FAIL line.
const stubPnpm = [
  '@echo off',
  '>>"%~dp0pnpm-calls.txt" echo %CD% %*',
  'if "%1"=="platform:doctor" goto doctor',
  'echo started API and dispatcher',
  'exit /b 0',
  ':doctor',
  'echo PASS Postgres answers',
  'echo FAIL Dispatcher liveness',
  'echo PASS API health',
  'echo Doctor: 1 failure(s); runtime NOT qualified.',
  'exit /b 1',
  ''
].join('\r\n');
// Port 0 is never served, so this health check gets no answer at once.
const closedHealthUrl = 'http://127.0.0.1:0/api/v1/health';
const psLines = [
  { Names: 'ulpin-demo-postgres-1', State: 'running', Status: 'Up 2 minutes (healthy)' },
  { Names: 'ulpin-demo-minio-init-1', State: 'exited', Status: 'Exited (0) 3 days ago' },
  { Names: 'other-ulpin-demo-x', State: 'running', Status: 'Up 1 hour' }
].map(line => JSON.stringify(line)).join('\r\n');

/** A made-up %LOCALAPPDATA% with stale sockets in both folders, a backend log line and a stand-in docker. */
function madeUpRoot({ engine }) {
  const root = mkdtempSync(join(base, 'docker-guard-'));
  const run = join(root, 'Docker', 'run');
  const secrets = join(root, 'docker-secrets-engine');
  const logs = join(root, 'Docker', 'log', 'host');
  const bin = join(root, 'bin');
  for (const dir of [run, secrets, logs, bin]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(run, 'sailor-ingest.sock'), '');
  writeFileSync(join(run, 'userAnalyticsOtlpHttp.sock'), '');
  writeFileSync(join(run, 'notes.txt'), 'kept');
  writeFileSync(join(secrets, 'engine.sock'), '');
  writeFileSync(join(logs, 'com.docker.backend.exe.log'), [
    '[t1][com.docker.backend.exe] started',
    `[t2][com.docker.backend.exe] rename ${run}\\sailor-ingest.sock ${run}\\sailor-ingest.sock.stale: ` +
      'The file cannot be accessed by the system.',
    ''
  ].join('\n'));
  writeFileSync(join(bin, 'docker.cmd'), stubDocker);
  writeFileSync(join(bin, 'ps.txt'), psLines);
  writeFileSync(join(bin, 'pnpm.cmd'), stubPnpm);
  mkdirSync(join(root, 'demo'));
  setEngine(root, engine);
  return { root, run, secrets, ops: join(root, 'ops') };
}

/** A made-up root whose demo start runs the stand-in pnpm (no -DryRun needed; Docker is never acted on). */
function demoRoot({ healthUrl }) {
  const fake = madeUpRoot({ engine: true });
  return { ...fake, healthUrl, pnpm: join(fake.root, 'bin', 'pnpm.cmd'), checkout: join(fake.root, 'demo') };
}

function pnpmCalls(fake) {
  const file = join(fake.root, 'bin', 'pnpm-calls.txt');
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split(/\r?\n/) : [];
}

/** A stand-in health endpoint in this process; set `status` to change its answer. */
async function healthServer() {
  const server = createServer((request, response) => {
    response.writeHead(request.url === '/api/v1/health' ? server.status : 404).end('{}');
  });
  server.status = 200;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  server.url = `http://127.0.0.1:${server.address().port}/api/v1/health`;
  return server;
}

function setEngine(root, up) {
  writeFileSync(join(root, 'bin', 'engine.txt'), up ? '0' : '1');
}

function guardArgs(fake, mode, extra) {
  const pnpm = fake.pnpm ? ['-PnpmExe', fake.pnpm] : [];
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, `-${mode}`,
    '-Root', fake.root, '-DockerExe', join(fake.root, 'bin', 'docker.cmd'),
    '-DesktopExe', join(fake.root, 'bin', 'desktop.cmd'), '-OpsDir', fake.ops,
    '-RecheckSeconds', '0', '-WaitSeconds', '0', '-Stamp', stamp,
    '-HealthUrl', fake.healthUrl ?? closedHealthUrl, '-DemoCheckout', join(fake.root, 'demo'), ...pnpm, ...extra];
}

function parsed(status, stdout, stderr) {
  assert.equal(stderr, '', stderr);
  const lines = stdout.trim().split(/\r?\n/);
  return { status, json: JSON.parse(lines.at(-1)) };
}

function guard(fake, mode, ...extra) {
  const options = { encoding: 'utf8', windowsHide: true, timeout: 120000, env: fake.env ?? process.env };
  const result = spawnSync(powershell, guardArgs(fake, mode, extra), options);
  return parsed(result.status, result.stdout, result.stderr);
}

/** As guard, but leaves the event loop free so the stand-in health server in this process can answer. */
function guardAsync(fake, mode, ...extra) {
  return new Promise((resolve, reject) => {
    const child = spawn(powershell, guardArgs(fake, mode, extra), {
      windowsHide: true, env: fake.env ?? process.env
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', status => {
      try { resolve(parsed(status, stdout, stderr)); } catch (error) { reject(error); }
    });
  });
}

function runLines(fake) {
  if (!existsSync(fake.ops)) return [];
  return readdirSync(fake.ops).filter(name => name.endsWith('.jsonl'))
    .flatMap(name => readFileSync(join(fake.ops, name), 'utf8').trim().split('\n').filter(Boolean))
    .map(line => JSON.parse(line));
}

/** Loads only function declarations, never the guard entry point, for isolated policy edge cases. */
function guardFunctions(command) {
  const setup = [
    `$ast = [Management.Automation.Language.Parser]::ParseFile(${psLiteral(script)}, [ref]$null, [ref]$null)`,
    '$definitions = $ast.FindAll({',
    '  param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]',
    '}, $false)',
    'foreach ($definition in $definitions) { . ([ScriptBlock]::Create($definition.Extent.Text)) }'
  ].join('\n');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', `${setup}; ${command}`], {
    encoding: 'utf8', windowsHide: true, timeout: 20000
  });
  return parsed(result.status, result.stdout, result.stderr);
}

const listing = dir => readdirSync(dir).sort();
const asideRun = fake => join(fake.root, 'Docker', `run.stale-guard-${stamp}`);
const asideSecrets = fake => join(fake.root, `docker-secrets-engine.stale-guard-${stamp}`);

test('engine up: Check passes with demo containers only, Recover leaves everything as it is', () => {
  const fake = madeUpRoot({ engine: true });
  const check = guard(fake, 'Check');
  assert.equal(check.status, 0);
  assert.equal(check.json.engine.answers, true);
  assert.deepEqual(check.json.demoContainers, [
    { name: 'ulpin-demo-postgres-1', state: 'running', health: 'healthy' },
    { name: 'ulpin-demo-minio-init-1', state: 'exited', health: null }
  ]);
  assert.deepEqual(check.json.sockets.map(entry => entry.count), [2, 1]);
  assert.equal(check.json.backendLog.lines.length, 1);
  assert.match(check.json.backendLog.lines[0], /\{root\}\\Docker\\run\\sailor-ingest\.sock\.stale/);
  assert.equal(JSON.stringify(check.json).includes(fake.root), false);
  const recover = guard(fake, 'Recover', '-DryRun');
  assert.equal(recover.status, 0);
  assert.equal(recover.json.outcome, 'engine_answers');
  assert.equal(recover.json.rename, undefined);
  assert.deepEqual(listing(fake.run), ['notes.txt', 'sailor-ingest.sock', 'userAnalyticsOtlpHttp.sock']);
  assert.equal(existsSync(asideRun(fake)), false);
});

test('engine down: both folders move aside together, nothing is deleted, one start is recorded', () => {
  const fake = madeUpRoot({ engine: false });
  const check = guard(fake, 'Check');
  assert.equal(check.status, 3);
  assert.equal(check.json.demoContainers, null);
  const recover = guard(fake, 'Recover', '-DryRun');
  assert.equal(recover.status, 0, JSON.stringify(recover.json));
  assert.equal(recover.json.outcome, 'dry_run');
  assert.deepEqual(recover.json.engineChecks, [1, 1, 1]);
  assert.equal(recover.json.stop.planned, true);
  assert.equal(recover.json.rename.ok, true);
  assert.equal(recover.json.rename.moved.length, 2);
  assert.equal(existsSync(fake.run), false);
  assert.equal(existsSync(fake.secrets), false);
  assert.deepEqual(listing(asideRun(fake)), ['notes.txt', 'sailor-ingest.sock', 'userAnalyticsOtlpHttp.sock']);
  assert.deepEqual(listing(asideSecrets(fake)), ['engine.sock']);
  const lines = runLines(fake);
  assert.equal(lines.length, 1);
  assert.equal(lines.filter(line => line.start === 'planned').length, 1);
});

test('second rename fails: the first folder is put back and the run stops with words', () => {
  const fake = madeUpRoot({ engine: false });
  mkdirSync(asideSecrets(fake));
  const recover = guard(fake, 'Recover', '-DryRun');
  assert.equal(recover.status, 4);
  assert.equal(recover.json.outcome, 'rename_failed_put_back');
  assert.equal(recover.json.rename.putBack, true);
  assert.match(recover.json.rename.error, /^could not rename \{root\}\\docker-secrets-engine to /);
  assert.equal(recover.json.start, undefined);
  assert.deepEqual(listing(fake.run), ['notes.txt', 'sailor-ingest.sock', 'userAnalyticsOtlpHttp.sock']);
  assert.deepEqual(listing(fake.secrets), ['engine.sock']);
  assert.equal(existsSync(asideRun(fake)), false);
});

test('Watch: the paused file stops it; one silent engine waits, the second recovers', () => {
  const paused = madeUpRoot({ engine: false });
  mkdirSync(paused.ops);
  writeFileSync(join(paused.ops, 'paused'), '');
  const idle = guard(paused, 'Watch', '-DryRun');
  assert.equal(idle.status, 0);
  assert.equal(idle.json.outcome, 'paused');
  assert.deepEqual(readdirSync(paused.ops), ['paused']);
  assert.equal(existsSync(paused.run), true);

  const fake = madeUpRoot({ engine: true });
  assert.equal(guard(fake, 'Watch', '-DryRun').json.outcome, 'engine_answers');
  const state = JSON.parse(readFileSync(join(fake.ops, 'state.json'), 'utf8'));
  assert.deepEqual(state.lastRunning, ['ulpin-demo-postgres-1']);
  setEngine(fake.root, false);
  const first = guard(fake, 'Watch', '-DryRun');
  assert.equal(first.json.outcome, 'engine_silent_waiting', JSON.stringify(first.json));
  assert.equal(first.status, 3);
  assert.equal(existsSync(fake.run), true);
  const second = guard(fake, 'Watch', '-DryRun');
  assert.equal(second.status, 0);
  assert.equal(second.json.outcome, 'dry_run');
  assert.deepEqual(second.json.recover.expectedContainers, ['ulpin-demo-postgres-1']);
  assert.equal(existsSync(fake.run), false);
  assert.equal(existsSync(asideRun(fake)), true);
  assert.equal(runLines(fake).length, 3);
});

test('a made-up root without -DryRun is refused before anything happens', () => {
  const fake = madeUpRoot({ engine: false });
  const refused = guard(fake, 'Recover');
  assert.equal(refused.status, 2);
  assert.equal(existsSync(fake.ops), false);
  assert.equal(existsSync(fake.run), true);
});

test('the never list: no reset, prune, volume or WSL removal, deletion or Docker setting edit', () => {
  const never = [
    /\breset\b/i, /factory/i, /--unregister/i, /--shutdown/i, /\bprune\b/i, /volume\s+rm/i, /compose\s+down/i,
    /\bdown\s+-v\b/i, /rm\s+-rf/i, /Remove-Item/i, /\.vhdx/i, /settings-store|settings\.json|daemon\.json/i,
    /::Delete\(/i, /\b(rmdir|rd)\s+\/s/i, /\bdel\s/i, /Clear-Content|Set-Content|Out-File|Add-Content/i,
    /--create/i, /platform:stop/i, /--runtime/i, /\.env\b/i
  ];
  const text = readFileSync(script, 'utf8');
  for (const pattern of never) assert.doesNotMatch(text, pattern);
  const commands = new Set(text.match(/platform:\w+(?: [-\w]+)*/g));
  assert.deepEqual([...commands].sort(), ['platform:doctor --profile demo', 'platform:start --profile demo']);
  const install = readFileSync(installer, 'utf8');
  for (const pattern of never.filter(pattern => !/unregister|settings/.test(pattern.source))) {
    assert.doesNotMatch(install, pattern);
  }
  assert.doesNotMatch(install, /WriteAll|ConvertTo-Json[^\n]*settings|Register-ScheduledTask[^\n]*-RunLevel Highest/i);
});

test('demo start: an answering API starts nothing; a silent one is started once in the demo checkout', async () => {
  const server = await healthServer();
  try {
    const fake = demoRoot({ healthUrl: server.url });
    const answering = await guardAsync(fake, 'Prestart');
    assert.equal(answering.json.outcome, 'engine_answers', JSON.stringify(answering.json));
    assert.deepEqual(answering.json.demo, { apiStatus: 200, outcome: 'api_answers' });
    assert.deepEqual(pnpmCalls(fake), []);

    server.status = 503;
    const silent = await guardAsync(fake, 'Prestart');
    assert.equal(silent.status, 0);
    assert.deepEqual(pnpmCalls(fake), [
      `${fake.checkout} platform:start --profile demo`, `${fake.checkout} platform:doctor --profile demo`
    ]);
    const { demo } = silent.json;
    assert.equal(demo.apiStatus, 503);
    assert.equal(demo.outcome, 'doctor_failed');
    assert.deepEqual(demo.start, { exitCode: 0, timedOut: false });
    assert.deepEqual(demo.doctor, {
      exitCode: 1, timedOut: false, lastLine: 'Doctor: 1 failure(s); runtime NOT qualified.', pass: 2, fail: 1,
      failureTail: [
        'PASS Postgres answers', 'FAIL Dispatcher liveness', 'PASS API health',
        'Doctor: 1 failure(s); runtime NOT qualified.'
      ]
    });
    const log = readFileSync(join(fake.ops, demo.log), 'utf8');
    assert.match(log, /started API and dispatcher/);
    assert.match(log, /PASS Postgres answers/);
    const line = JSON.stringify(runLines(fake).at(-1));
    assert.equal(line.includes('started API'), false);
    assert.equal(line.includes('PASS Postgres'), true);
    assert.equal(line.includes(fake.root.replaceAll('\\', '\\\\')), false);
  } finally {
    server.close();
  }
});

test('demo start: no-demo-start stops only the demo start, and -DryRun plans it without pnpm', () => {
  const optedOut = demoRoot({});
  mkdirSync(optedOut.ops);
  writeFileSync(join(optedOut.ops, 'no-demo-start'), '');
  const skipped = guard(optedOut, 'Prestart');
  assert.equal(skipped.json.outcome, 'engine_answers');
  assert.deepEqual(skipped.json.demo, { apiStatus: null, outcome: 'opted_out' });
  assert.deepEqual(pnpmCalls(optedOut), []);

  const dry = demoRoot({});
  const planned = guard(dry, 'Prestart', '-DryRun');
  assert.equal(planned.json.outcome, 'engine_answers');
  assert.deepEqual(planned.json.demo, { apiStatus: null, outcome: 'planned' });
  assert.deepEqual(pnpmCalls(dry), []);
});

test('Watch: one silent API waits, the second starts the demo, at most twice in six hours', () => {
  const fake = demoRoot({});
  const outcomes = [];
  for (let run = 0; run < 6; run++) {
    const watch = guard(fake, 'Watch');
    assert.equal(watch.json.outcome, 'engine_answers', JSON.stringify(watch.json));
    outcomes.push([watch.json.demo.outcome, pnpmCalls(fake).length]);
  }
  assert.deepEqual(outcomes, [
    ['api_silent_waiting', 0], ['doctor_failed', 2], ['api_silent_waiting', 2], ['doctor_failed', 4],
    ['api_silent_waiting', 4], ['start_limit_reached', 4]
  ]);
  const state = JSON.parse(readFileSync(join(fake.ops, 'state.json'), 'utf8'));
  assert.equal(state.demoStarts.length, 2);
  assert.equal(state.apiFailures, 2);
});

test('a demo stopped on purpose is never started by Watch or Prestart; the engine is still looked after', () => {
  const fake = demoRoot({});
  mkdirSync(fake.ops);
  writeFileSync(join(fake.ops, 'demo-stopped-on-purpose.json'), '{"stoppedAt":"2026-10-21T03:00:00.000Z"}\n');
  for (let run = 0; run < 3; run++) {
    const watch = guard(fake, 'Watch');
    assert.equal(watch.json.outcome, 'engine_answers');
    assert.deepEqual(watch.json.demo, { apiStatus: null, outcome: 'stopped_on_purpose' });
  }
  const prestart = guard(fake, 'Prestart');
  assert.deepEqual(prestart.json.demo, { apiStatus: null, outcome: 'stopped_on_purpose' });
  assert.deepEqual(pnpmCalls(fake), []);
  assert.equal(JSON.parse(readFileSync(join(fake.ops, 'state.json'), 'utf8')).demoStarts.length, 0);
  assert.equal(existsSync(join(fake.ops, 'demo-stopped-on-purpose.json')), true);

  setEngine(fake.root, false);
  assert.equal(guard(fake, 'Watch', '-DryRun').json.outcome, 'engine_silent_waiting');
  assert.equal(guard(fake, 'Watch', '-DryRun').json.outcome, 'dry_run');
});

test('SelfTest: machine PATH has no Git Bash, but the shared child environment runs it without ops writes', () => {
  const fake = madeUpRoot({ engine: true });
  const command = [
    '$env:PATH = [Environment]::GetEnvironmentVariable("Path", "Machine")',
    '$bash = Get-Command bash -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1',
    'if ($bash) { $bash.Source } else { "bash_not_on_machine_path" }',
    `& ${psLiteral(script)} -SelfTest -OpsDir ${psLiteral(fake.ops)}`
  ].join('; ');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8', windowsHide: true, timeout: 20000
  });
  const report = parsed(result.status, result.stdout, result.stderr);
  assert.match(result.stdout.split(/\r?\n/)[0], /(?:\\System32\\bash\.exe|bash_not_on_machine_path)$/i);
  assert.equal(report.status, 0);
  assert.equal(report.json.ok, true);
  assert.match(report.json.output[0], /^\d+\.\d+/);
  assert.match(report.json.output[1], /^(MINGW|MSYS)/);
  assert.match(report.json.bash, /\\Git\\bin\\bash\.exe$/i);
  assert.equal(report.json.scriptShell, report.json.bash);
  assert.equal(existsSync(fake.ops), false);
});

test('demo child: System32-first PATH still runs Git Bash and failed start tails reach the ledger', () => {
  const fake = demoRoot({});
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'));
  fake.env = { ...env, Path: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}` };
  writeFileSync(fake.pnpm, [
    '@echo off',
    'if "%1"=="platform:doctor" exit /b 1',
    'bash -c "echo $BASH_VERSION; uname -s"',
    'echo script-shell=%npm_config_script_shell%',
    'echo diagnostic one',
    'echo diagnostic two',
    'echo diagnostic three',
    'echo API_KEY=not-a-real-key',
    'echo ELIFECYCLE Command failed with exit code 1.',
    'exit /b 1',
    ''
  ].join('\r\n'));
  const result = guard(fake, 'Prestart');
  assert.equal(result.status, 0);
  assert.equal(result.json.demo.outcome, 'start_failed');
  const log = readFileSync(join(fake.ops, result.json.demo.log), 'utf8');
  assert.match(log, /\d+\.\d+[^\r\n]*\r?\n(?:MINGW|MSYS)/);
  assert.match(log, /script-shell=.*\\Git\\bin\\bash\.exe/i);
  assert.doesNotMatch(log, /WSL|execvpe/);
  assert.deepEqual(runLines(fake).at(-1).demo.start.failureTail, [
    'diagnostic one', 'diagnostic two', 'diagnostic three', 'API_KEY=[redacted]',
    'ELIFECYCLE Command failed with exit code 1.'
  ]);
});

test('missing Git Bash refuses before invoking pnpm and gives a clear reason', () => {
  const fake = demoRoot({});
  const result = guardFunctions([
    `$OpsDir = ${psLiteral(fake.ops)}`,
    `$DemoCheckout = ${psLiteral(fake.checkout)}`,
    `$PnpmExe = ${psLiteral(fake.pnpm)}`,
    `function Get-GitInstallRoots { ${psLiteral(fake.root)} }`,
    'Write-Json (Start-Demo ([ordered]@{ outcome = $null }))'
  ].join('; '));
  assert.equal(result.status, 0);
  assert.equal(result.json.outcome, 'git_bash_missing');
  assert.match(result.json.reason, /not found; demo start refused/);
  assert.deepEqual(pnpmCalls(fake), []);
  assert.equal(existsSync(fake.ops), false);
});

test('start budget expires at local midnight even when attempts are less than six hours old', () => {
  const result = guardFunctions([
    'function Get-Date { [DateTime]::Parse("2026-10-23T00:01:00") }',
    '$DemoStartLimitHours = 6',
    '$state = @{ demoStarts = @("2026-10-22T23:51:00", "2026-10-22T23:56:00") }',
    '$demo = [ordered]@{}',
    'Update-DemoStartWindow $state $demo',
    'Write-Json @{ state = $state; demo = $demo }'
  ].join('; '));
  assert.deepEqual(result.json.state.demoStarts, []);
  assert.equal(result.json.demo.startLimitCleared, 'new_day');
});

test('a doctor PASS clears the watch budget, while API health alone does not claim a doctor PASS', async () => {
  const server = await healthServer();
  try {
    const fake = demoRoot({ healthUrl: server.url });
    mkdirSync(fake.ops);
    const attempts = [new Date().toISOString(), new Date().toISOString()];
    writeFileSync(join(fake.ops, 'state.json'), JSON.stringify({ demoStarts: attempts, apiFailures: 52 }));
    const answering = await guardAsync(fake, 'Watch');
    assert.equal(answering.json.demo.outcome, 'api_answers');
    assert.deepEqual(JSON.parse(readFileSync(join(fake.ops, 'state.json'), 'utf8')).demoStarts, attempts);
    // Prestart has no watch limit; run only the stand-in that prints a qualified doctor summary.
    server.status = 503;
    writeFileSync(fake.pnpm, [
      '@echo off',
      'if "%1"=="platform:start" exit /b 0',
      'echo PASS API health',
      'echo Doctor: all checks passed.',
      'exit /b 0',
      ''
    ].join('\r\n'));
    const qualified = await guardAsync(fake, 'Prestart');
    assert.equal(qualified.json.demo.outcome, 'started');
    assert.equal(qualified.json.demo.startLimitCleared, 'doctor_pass');
    const state = JSON.parse(readFileSync(join(fake.ops, 'state.json'), 'utf8'));
    assert.deepEqual(state.demoStarts, []);
    assert.equal(state.apiFailures, 0);
    // The next failed health run is eligible after two checks, not stuck at start_limit_reached.
    assert.equal((await guardAsync(fake, 'Watch')).json.demo.outcome, 'api_silent_waiting');
    const watch = await guardAsync(fake, 'Watch');
    assert.equal(watch.json.demo.outcome, 'started');
    assert.equal(watch.json.demo.startLimitCleared, 'doctor_pass');
    assert.deepEqual(JSON.parse(readFileSync(join(fake.ops, 'state.json'), 'utf8')).demoStarts, []);
  } finally {
    server.close();
  }
});
