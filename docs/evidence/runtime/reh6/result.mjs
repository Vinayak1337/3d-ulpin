import { readFileSync } from 'node:fs';
import { save } from './audit.mjs';

// REH6's index, from its receipts: the run stopped at Docker Desktop's start, before any rehearsal command.
const read = name => JSON.parse(readFileSync(name, 'utf8'));
const first = read('before-docker-down.json').baseline;
const last = read('demo-final.json');
const docker = read('docker-start.json');
const demo = entry => ({ at: entry.at, exit: entry.doctor.exit, commit: entry.commit,
  processes: entry.machine.processes,
  health: entry.health, dockerLine: entry.doctor.output.find(line => line.startsWith('FAIL')) ?? null });
save('result.json', {
  task: 'REH6', gate: ['GF5', 'GF1'], branch: 'task/reh6-large-area-fixes', staging: '2ddefbbb',
  runtime: 'ulpin-reh-02',
  api: 'http://127.0.0.1:21026', status: 'stopped at the Docker start (stop rule); Parts A, B and C not run',
  preCheck: { command: 'git diff --name-only 2acba69a 2ddefbbb -- services/ database/ scripts/platform/ pnpm-lock.yaml',
    output: 'empty', meaning: 'no schema step and no image roll' },
  parts: {
    A: { done: false, reached: 'step 1: the demo doctor, then Docker Desktop started once',
      why: 'Docker Desktop crashed on a stale socket and offered Reset to factory defaults (docker-start.json)',
      notRun: ['serving checkout and install (left at 2acba69a)', 'document runtime build', 'roll', 'start',
        'rehearsal doctor'] },
    B: { done: false, why: 'no engine: the rehearsal could not start' },
    C: { done: false, why: 'no engine: the rehearsal could not start' },
  },
  findings: [
    { where: 'Docker Desktop 4.91.0 start, 2026-10-17 23:40:44 IST',
      what: 'The backend stopped with: initializing Ingest server: rename run/sailor-ingest.sock to '
        + 'sailor-ingest.sock.stale: The file cannot be accessed by the system. Dialog: Quit or Reset to factory '
        + 'defaults. The engine pipe never appeared.',
      evidence: 'docker-start.json backendLog lines 2053, 2127, 2136' },
    { where: 'the same dialog', what: 'Quit was chosen at 23:44:45 IST, not by this run; Reset was not chosen. '
        + 'Docker Desktop then exited; no Docker process ran at the closing read.',
      evidence: 'docker-start.json backendLog lines 2148, 2164; dockerProcessesAtThisRead empty' },
    { where: 'the demo after the reboot', what: 'Already down before this run: no API or dispatcher process, '
        + 'health 000, the doctor fails only its Docker line. This run did not start or change it.',
      evidence: 'before-docker-down.json; demo-final.json' },
    { where: 'before-docker-down.json stagingCommit', what: 'Records 2ddefbbb7, a typo in the argument; the staging '
        + 'commit is 2ddefbbbd5ac. The receipt is otherwise the first demo doctor, kept as written.',
      evidence: 'before-docker-down.json' },
  ],
  needsCode: [],
  demo: { first: demo(first), last: demo(last),
    sameCommitAndProcessIds: last.matchesFirstInCommitAndProcessIds,
    requestsToDemoApi: 'GET /api/v1/health only (inside each doctor read)', reh01: 'not touched' },
  exists: { serving: 'E:/Projects/ulpin-wt/ulpin-reh-02 at 2acba69a, clean, not switched',
    rehearsal: 'not started; its containers and volumes not read (no engine) and not touched',
    docker: 'not running; run/ folder and its stale sockets as Docker left them' },
  restart: {
    owner: 'Docker Desktop must start first. Its recorded recovery after a reboot (owner-approved before): stop the '
      + 'Docker processes, rename %LOCALAPPDATA%/Docker/run and docker-secrets-engine aside together, start once; '
      + 'never Reset. That is an owner or lead step, not this run.',
    then: 'rerun REH6 from Part A step 1 on the same branch: the receipts here are not overwritten (save uses wx)',
    from: 'E:/Projects/ulpin-wt/ulpin-reh-02',
    start: 'pnpm platform:start --profile demo --runtime ulpin-reh-02',
    doctor: 'pnpm platform:doctor --profile demo --runtime ulpin-reh-02',
    stop: 'pnpm platform:stop --profile demo --runtime ulpin-reh-02',
    demoToo: 'the demo is down as well: after Docker starts, its own start is a separate owner step' },
  forDemoRoll: { from: '9d6acc6b', to: '2ddefbbb', proven: false,
    note: 'Not proven by REH6. The steps are REH5 measured ones to 2acba69a; 2acba69a..2ddefbbb changes nothing '
      + 'under services, database, scripts/platform or the lockfile, so no schema step and no image roll.',
    steps: [
      { n: 1, what: 'Docker Desktop up (see restart.owner); confirm runtime ownership', seconds: 'not measured' },
      { n: 2, what: 'stop the demo native processes if running (DEMO-RUNTIME.md step 2)', seconds: 'not measured' },
      { n: 3, what: 'git -C E:/Projects/ulpin-wt/demo checkout --detach 2ddefbbb', secondsReh5: 0.154 },
      { n: 4, what: 'pnpm install --frozen-lockfile', secondsReh5: 0.743 },
      { n: 5, what: 'node scripts/platform/demo-document-runtime.mjs build', secondsReh5: 12.51 },
      { n: 6, what: 'node scripts/platform/processor-image.mjs roll: expect nothing recreated', secondsReh5: 4.583 },
      { n: 7, what: 'pnpm platform:start --profile demo', secondsReh5: 34.5 },
      { n: 8, what: 'pnpm platform:doctor --profile demo: both PASS lines', secondsReh5: 6.345 },
    ] },
  checks: 'node docs/evidence/runtime/reh6/check.mjs; git diff --check (see the commit)',
});
