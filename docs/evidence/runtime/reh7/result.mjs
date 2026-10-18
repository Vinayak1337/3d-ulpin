import { readFileSync } from 'node:fs';
import { save } from './audit.mjs';

// REH7's index: every number below is read from the receipts in this folder.
const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const b = read('./part-b-timing.json');
const runs = ['1', '2', '3'].map(run => read(`./part-c-run${run}.json`));
const profile = read('./part-c-profile-run3.json');
const [before, afterA, afterB, final] = ['before', 'demo-after-a', 'demo-after-b', 'demo-final']
  .map(name => read(`./${name}.json`));
const doctor = read('./step-a3-doctor.json');
const range = values => [Math.min(...values), Math.max(...values)].map(value => Number(value.toFixed(3)));
const ok = b.requests.filter(row => row.status === 200);
const by = test => ok.filter(test).map(row => row.lastByteSeconds);
const cpu = test => ok.filter(test).map(row => row.apiCpuSeconds);
const concurrent = copies => ok.filter(row => row.phase.startsWith(`3 concurrent x${copies} `));

const slow = runs.flatMap(run => run.reads.map(read => ({ run: run.run, ...read })))
  .filter(read => read.nodeEventSeconds > 10);
const split = read => {
  const total = read.nodeEventSeconds * 1000;
  const parts = { browserQueueMs: read.queuedOrStalledMs, serverToFirstByteMs: read.waitingForFirstByteMs,
    downloadWhileMainThreadBlockedMs: read.downloadMs,
    eventDeliveryMs: Number((total - read.networkTotalMs).toFixed(1)) };
  return { run: read.run, stage: read.stage, window: `${read.widthM} x ${read.heightM} m at [${read.centre}]`,
    page: 'page 2 (after cursor), the first page after a new view replaced the drawn 15,000', seconds:
    read.nodeEventSeconds, parts, shares: Object.fromEntries(Object.entries(parts)
      .map(([key, ms]) => [key, `${(100 * ms / total).toFixed(1)}%`])),
    longestMainThreadTaskDuringMs: read.longTasksDuring.longestMs, apiCpuSeconds: read.apiCpuSeconds,
    postgresMeanCpuPercent: read.postgresMeanCpuPercent };
};

save('result.json', {
  task: 'REH7', gate: 'GF5', at: new Date().toISOString(), runtime: 'ulpin-reh-02',
  stagingCommit: before.stagingCommit, worktreeBranch: 'task/reh7-window-timing',
  outcome: 'reproduced and attributed: one page of 27.0 s, 94% of it in the browser main thread (scene teardown)',
  partA: { rolled: 'done', checkoutSeconds: read('./step-a2-checkout.json').receipt.seconds,
    installSeconds: read('./step-a2-install.json').receipt.seconds,
    roll: read('./step-a3-roll.json').receipt.output[0], startSeconds: read('./step-a3-start.json').receipt.seconds,
    doctor: { pass: doctor.receipt.output.filter(line => line.startsWith('PASS')).length,
      fail: doctor.receipt.output.filter(line => line.startsWith('FAIL')).length }, apiPid: b.apiPid,
    dockerRecovery: 'docker-recovery.json: booted 13:30 IST, two socket folders renamed aside, started once' },
  partB: {
    requests: b.requests.length, over3s: b.over3s, over10s: b.over10s, stopped: b.stopped ?? null,
    coldSeconds: by(row => row.phase === '1 cold'),
    warmSequentialSecondsRange: range(by(row => row.phase.startsWith('2 warm'))),
    floor: { displaySummarySeconds: range(by(row => row.label === 'display-summary')),
      window50mZeroFeaturesSeconds: range(by(row => row.label === '50 m window')),
      apiCpuSecondsPerFloorRead: range(cpu(row => row.phase === '2 floor')) },
    apiCpuSecondsPerWarmPage: range(cpu(row => row.phase.startsWith('2 warm'))),
    concurrentW4Page2: Object.fromEntries([1, 2, 4, 8, 12].map(copies => [`x${copies}`, {
      secondsRange: range(concurrent(copies).map(row => row.lastByteSeconds)),
      ...(copies === 12 ? { firstEight: range(concurrent(12).filter(row => row.inFlightAtStart < 8)
        .map(row => row.lastByteSeconds)), ninthToTwelfth: range(concurrent(12).filter(row => row.inFlightAtStart >= 8)
        .map(row => row.lastByteSeconds)) } : {}) }])),
    w5Page2AloneSecondsRange: range(by(row => row.label === 'W5 page 2' && row.phase.startsWith('2 warm'))),
    w5Page2AfterSixAbandonedSecondsRange: range(by(row => row.label === 'W5 page 2 after the abandoned')),
    apiCpuSecondsDuringReadAfterAbandoned: range(cpu(row => row.label === 'W5 page 2 after the abandoned')),
  },
  partC: {
    runs: runs.map(run => ({ run: run.run, reads: run.reads.length, aborted: run.reads.filter(r => r.aborted).length,
      queuedOrStalledMsMax: Math.max(...run.reads.map(r => r.queuedOrStalledMs)),
      serverToFirstByteMsRange: range(run.reads.map(r => r.waitingForFirstByteMs)),
      over3s: run.reads.filter(r => r.nodeEventSeconds > 3).map(r => ({ seconds: r.nodeEventSeconds,
        downloadMs: r.downloadMs, longestTaskMs: r.longTasksDuring.longestMs })),
      mainThreadLongTasks: run.longTasks.count, mainThreadLongTaskSeconds: Math.round(run.longTasks.totalMs / 1000) })),
    note: 'Run 3 ran with the CPU profiler; its slow page (3.9 s) is the same stage, view and page as run 2\'s 27 s.',
    profile: { longestJsStretch: profile.longestJsStretch, inclusiveTop: profile.inclusiveTime.slice(5, 16),
      selfTop: profile.selfTime.slice(0, 6) },
  },
  requestsOver10s: slow.map(split),
  hypotheses: {
    H1: { verdict: 'not supported', measurement: 'Browser queueing is at most 2 ms on every Studio read (Part C '
      + 'queuedOrStalledMs); through the Vite proxy the server answers in 1.6-2.4 s, direct 1.4-2.1 s. The slow '
      + 'time is in the browser, but on its main thread, not in a queue: see H5.' },
    H2: { verdict: 'not supported as the cause', measurement: 'Pool wait shows only past 8 concurrent reads: copies '
      + '9-12 of W4 page 2 take 5.0-5.7 s against 3.0-3.5 s for the first 8; six abandoned reads lift the next '
      + 'read from 1.4 s to 2.2-2.7 s. A wait is capped at 5 s by connectionTimeoutMillis (db.ts:28), and the '
      + 'slow page had API CPU 0.36 s and Postgres 8% while it waited.' },
    H3: { verdict: 'not supported', measurement: 'API CPU is 0.2-0.7 s per read in Part B; during the 27 s page '
      + 'the API used 0.36 s of CPU.' },
    H4: { verdict: 'not supported', measurement: 'The first read after start took 2.6 s, warm reads 1.6-2.1 s.' },
    H5: { verdict: 'supported', measurement: 'One main-thread task of 26.9 s covers the 27.0 s page; its download '
      + 'phase is 25.4 s (94%). The profiled run puts the 3.5 s instance in SceneEngine.setBuildings ' +
      '(react.tsx:72 effect) -> removeBuilding -> removeBuildingPad -> padGeometry: 3.0 of 3.3 s in removal.' },
  },
  findings: [
    'The slow page is always page 2 of a new view: page 1 replaces the 15,000 drawn buildings, the scene removes '
      + 'them on the main thread, and page 2\'s body waits unread until that task ends (REH6 stages 4 and 5 match).',
    'Every window read costs a fixed 1.8 s (50 m window, 0 features; display-summary 2.2 s), of which the API\'s '
      + 'CPU is about 0.3 s, so a four-page view costs about 7 s before any drawing. The rest was not split by '
      + 'statement: that needs SQL, which this task may not run.',
    'In headless Chromium (software WebGL) the page\'s main thread was never idle while the map was open: about '
      + 'two thirds native time (part-c-profile-run3.json halfSecondSplitMs). A GPU laptop may differ.',
    'With LA7\'s clamp the zoom path now reads 5,555 x 5,681 m at the 200 m stage (REH6: 6,583 x 6,733 m) and '
      + 'issues no new read at the 100 m stage.',
  ],
  needsCode: [
    { at: 'packages/scene/src/engine.ts:1077-1091', what: 'removeBuildingPad rebuilds the merged pad geometry of '
      + 'every remaining building in the batch (padGeometry, look.ts:246) once per removed building; setBuildings '
      + '(engine.ts:705-708) removes one at a time, so a view change costs batch-size squared on the main thread.' },
    { at: 'packages/scene/src/engine.ts:1046', what: 'this.buildings.remove(object) per mesh and edge: three.js '
      + 'Object3D.remove searches and splices the group\'s ~30,000 children each time (0.5 s self in 3.5 s).' },
    { at: 'apps/api/src/modules/intake/area-sources.controller.ts:121-123 and area-display-window.ts:73',
      what: 'A client abort does not reach the read: the transaction has no signal or deadline, so abandoned '
        + 'reads run to the end on pooled connections (Part B step 4).' },
  ],
  demo: { baselineCommit: before.baseline.commit, sameAfterA: afterA.matchesBaseline,
    sameAfterB: afterB.matchesBaseline, sameAtEnd: final.matchesBaseline, health: final.health,
    nativeProcesses: final.machine.processes.length, requests: 'only GET /api/v1/health' },
  left: 'ulpin-reh-02 stopped at 67959045, six exited containers and three volumes kept; dev server stopped',
  restart: ['cd E:/Projects/ulpin-wt/ulpin-reh-02', 'pnpm platform:start --profile demo --runtime ulpin-reh-02',
    'pnpm platform:doctor --profile demo --runtime ulpin-reh-02',
    'ULPIN_API_TARGET=http://127.0.0.1:21026 pnpm studio:dev (port 5188)',
    'node docs/evidence/runtime/reh7/timing.mjs <apiPid>; node .../map-timing.mjs <apiPid> <run> [profile]'],
});
