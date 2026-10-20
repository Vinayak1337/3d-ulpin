import { save } from './audit.mjs';

// REH9's result: the roll stopped at its first runtime step. The step receipts beside this file hold the outputs.
save('result.json', {
  task: 'REH9', gate: ['GF5', 'GF4', 'GF1'], runtime: 'ulpin-reh-02', state: 'blocked_before_roll',
  rollCommit: '36834da87fac12014ae7f3c61807e3bf0a86b85e',
  base: 'a809ac35 (staging) plus the processor pin commit 36834da8',
  pin: { commit: 'a40b6023872819367ab4b3db43afbb7ffba892b0', servicesTree: 'eab382a5cdd44dd62df5789d46df12dc3937640d',
    image: 'ulpin-geo:git-a40b60238728', treeCheck: 'git rev-parse a40b6023:services/geo = the pinned tree' },
  steps: [
    { step: 'b0-stop', exit: 1, screen: 'api PID identity changed; refusing to stop or adopt it.',
      receipt: 'step-b0-stop.json' },
    { step: 'b0-processes', exit: 0, finding: 'no process names the serving checkout and nothing listens on '
      + '21021-21026: the rehearsal API and dispatcher do not run; the recorded api PID belongs to an unrelated '
      + 'process started after the reboot of 20 October 23:15', receipt: 'step-b0-processes.json' },
    { step: 'b1-checkout', exit: 0, head: '36834da8', servicesTreeIsPin: true, receipt: 'step-b1-checkout.json' },
    { step: 'b1-install', exit: 0, receipt: 'step-b1-install.json' },
    { step: 'b2-build', exit: 0, image: 'ulpin-geo:git-a40b60238728', labels: 'revision a40b6023, tree eab382a5',
      seconds: 5.9, receipt: 'step-b2-build.json' },
    { step: 'b3-roll', exit: 1, screen: 'api PID identity changed; refusing to stop or adopt it.',
      receipt: 'step-b3-roll.json', note: 'second failure of the same cause: stop rule' },
  ],
  notRun: ['b3-migrate (four additive schema steps since 8eeba26f: area.retire, intake-evidence, '
    + 'streaming-vector-capacity, table-windows)', 'b3-document-runtime', 'b4-start', 'b4-doctor',
  'act 1', 'act 2 (DQ1 regression)', 'G22 lane reads', 'card'],
  acts: { act1: { outcome: 'not_run' }, act2: { outcome: 'not_run' } },
  breaks: [{ act: null, file: null, step: 'b0-stop and b3-roll',
    screen: 'api PID identity changed; refusing to stop or adopt it.', route: null, status: null, code: 'exit 1',
    expected: 'a stale process record (its process gone with the reboot) reads as not running',
    evidence: 'step-b0-stop.json, step-b3-roll.json, step-b0-processes.json' }],
  needsCode: [{ file: 'scripts/platform/processes.mjs', lines: '28-32',
    defect: 'ownedProcess throws when the recorded PID is now held by a process with another CreationDate; a '
      + 'different creation date proves the recorded process has exited, so after a reboot the record blocks '
      + 'stop, roll (processor-image.mjs:80-83) and start (launchProcesses) of that runtime until the PID frees',
    proposal: 'return null when CreationDate differs (the recorded process is gone); keep the refusal when the '
      + 'creation date matches but the command line, executable or preload differ' }],
  needsOwner: 'move aside the stale api.process.json (and dispatcher.process.json if it collides too) in the '
    + 'ulpin-reh-02 runtime folder, or merge the processes.mjs fix; this worker may not open that folder',
  servingCheckoutLeftAt: '36834da8 (detached, clean, installed); containers exited on ulpin-geo:git-22003ea3d878, '
    + 'unchanged; nothing removed',
  demo: { before: 'before.json', after: 'demo-final.json', commit: '9d6acc6b', doctor: 'all checks passed (exit 0)',
    health: 200, processIds: [8136, 14636], matchesBaseline: true },
  resume: ['the owner clears the stale record', 'REH9_COMMIT=36834da8... node steps.mjs b3-roll (new receipt name)',
    'b3-migrate', 'b3-document-runtime', 'b4-start', 'b4-doctor', 'then act 1, act 2 and the G22 reads'],
  verdict: 'no: the roll commit was not served; nothing about it is proven on a runtime yet',
});
