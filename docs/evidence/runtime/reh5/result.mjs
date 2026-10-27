import { readFileSync } from 'node:fs';
import { evidence, save } from './audit.mjs';

// REH5's index: each part, the findings with needsCode apart, restart commands and the demo roll as proved here.
// Numbers are read from the receipts in this folder; the words are the reviewer's reading of them.
const read = name => JSON.parse(readFileSync(`${evidence}/${name}`, 'utf8'));
const step = name => read(`step-${name}.json`);
const brief = name => ({ step: name, command: step(name).receipt.command.join(''), exit: step(name).receipt.exit,
  seconds: step(name).receipt.seconds });
const before = read('before.json');
const window = read('part-b-window.json');
const map = read('part-b-map.json');
const pick = read('part-b-map-pick.json');
const final = read('demo-final.json');
const doctor = step('a3-doctor').receipt.output;
const roll = step('a3-roll');
const runs = key => window[key].runs.map(run => `${run.features} features ${run.seconds} s`);

const value = {
  task: 'REH5', gate: ['GF5', 'GF1'], branch: 'task/reh5-window-proposals', staging: before.stagingCommit,
  runtime: 'ulpin-reh-02', api: 'http://127.0.0.1:21026',
  status: 'Part A done; Part B done to the register page; rehearsal stopped at 2acba69a; demo untouched',
  preCheck: ['git diff --name-only 01a11f93 2acba69a -- services/ database/ scripts/platform/ pnpm-lock.yaml:',
    'scripts/platform/processor-image.mjs, processor-image.test.mjs, runtime-stop.test.mjs (as the task stated)'],
  parts: {
    A: { done: true, steps: ['a2-checkout', 'a2-install', 'a3-document-runtime', 'a3-roll', 'a3-start', 'a3-doctor']
      .map(brief), servicesTreeIsPin: step('a2-install').servicesTreeIsPin,
    roll: { line: roll.receipt.output.at(-1), containersUnchanged:
      JSON.stringify(roll.containersBefore) === JSON.stringify(roll.containersAfter) },
    rehearsalDoctor: { exit: step('a3-doctor').receipt.exit, pass: doctor.filter(line => line.startsWith('PASS'))
      .length, fail: doctor.filter(line => line.startsWith('FAIL')), required: doctor.filter(line =>
      /^PASS (Document runtimes|Processors run the pinned image)/.test(line)) },
    gateway: 'PASS Model gateway state: enabled false, no provider key; keys and enable never run',
    gpu: 'nvidia-smi compute apps: 25 before, 25 at start and at the doctor, no new pid',
    startNote: 'start took 34.5 s: the rehearsal containers were exited and came up with the two native processes',
    evidence: ['before.json', 'step-a2-checkout.json', 'step-a2-install.json', 'step-a3-document-runtime.json',
      'step-a3-roll.json', 'step-a3-start.json', 'step-a3-doctor.json', 'demo-after-a.json'] },
    B: { done: true, areaId: window.areaId,
      limitReads: { context: [window.limitReads.context.status, window.limitReads.context.refusal],
        canonical: [window.limitReads.canonical.status, window.limitReads.canonical.refusal],
        note: 'both state the limit applied, 10,000 (canonical-area.ts:201 reads with AREA_DISPLAY_LIMIT)' },
      summary: { status: window.summary.status, seconds: window.summary.seconds, bytes: window.summary.bytes,
        featureCount: window.summary.featureCount, extent: window.summary.extent,
        areaRevision: window.summary.areaRevision, displayLimit: window.summary.displayLimit,
        againstReh4: 'REH4 at 01a11f93: featureCount 0, extent null; now 41,809, the count REH3 made',
        split: ['the reply holds no recorded or proposal count;',
          'the pages count 41,809 unrecorded_proposal, 0 recorded'] },
      whole: { pages: window.whole.pageCount, pageSeconds: window.whole.pages.map(page => page.seconds),
        seconds: window.whole.seconds, bytes: window.whole.bytes, features: window.whole.features,
        uniqueIds: window.whole.uniqueIds, sumEqualsFeatureCount: window.whole.sumEqualsFeatureCount,
        noRepeat: window.whole.noRepeat, identifiersStrictlyAscending: window.whole.identifiersStrictlyAscending,
        displayStates: window.whole.displayStates, heightStates: window.whole.heightStates,
        heightMNull: window.whole.heightMNullByState, heightMZero: window.whole.heightMZero,
        outsideExtentPadded100m: window.whole.outsidePaddedExtent, withoutOutline: window.whole.withoutOutline },
      windows: { atCentre500m: runs('window500'), atCentre50m: runs('window50'),
        nearCentre: `${window.nearCentre.identifier}, first vertex ${window.nearCentre.metresFromCentre} m from centre`,
        nearCentre500m: runs('window500Near'), nearCentre50m: runs('window50Near'),
        samples500m: window.window500.samples, samples50mNear: window.window50Near.samples,
        note: 'the 50 m window at the exact centre holds no building; samples of 50 m come from the near window' },
      refusals: Object.fromEntries(Object.entries(window.refusals).map(([label, row]) =>
        [label, [row.status, row.refusal.code, row.refusal.words]])),
      studio: { route: '/studio/areas/:areaId', browser: map.browser, viewport: map.viewport,
        dev: 'pnpm studio:dev from the ulpin-reh-02 checkout, port 5188, ULPIN_API_TARGET=http://127.0.0.1:21026',
        opened: { statusLine: map.open.statusLines, banners: map.open.banners, emptySentence: map.open.emptySentence,
          seen: 'sky gradient only: no ground and no building visible (map-1.png)' },
        zoomed: { statusLine: map.zoomed.statusLines, banners: map.zoomed.banners,
          seen: 'ground and buildings drawn, flat, one or two pixels each, oblique view, 1 km scale (map-2.png)' },
        windowReads: map.windowReads,
        perView: 'one view fills the 15,000 budget in four sequential pages (4,000+4,000+4,000+3,000), 8.4-10 s',
        gridClicks: { clicks: map.clicked.clicks, inspector: map.clicked.inspector, screenshot: 'map-3.png' },
        pickSession: { file: 'map-pick.mjs', why: pick.why, zoomSteps: pick.zoomSteps.length,
          scaleAtPick: pick.afterZoom.scale, clicks: pick.clicks, inspector: pick.inspector,
          inspectorText: pick.inspectorText, registerHref: pick.registerHref, screenshot: 'map-3b.png' },
        register: { url: pick.register.url, text: pick.register.text, reads: pick.register.reads,
          screenshot: 'map-4.png' },
        pageErrors: [...map.pageErrors, ...pick.pageErrors],
        stopped: 'dev server stopped (its vite child by pid, from the ulpin-reh-02 checkout); port 5188 free' },
      harness: ['window.mjs run b made its 20 reads, then failed on the empty 50 m window (sample of undefined);',
        'fixed and run once more as b2 with the near-centre windows added: the same counts (11 pages, 41,809;',
        '500 m 3; 50 m 0). REH4\'s outline test also flagged odd vertex counts as outside; fixed before any run.'],
      evidence: ['part-b-window.json', 'part-b-map.json', 'part-b-map-pick.json', 'map-1.png', 'map-2.png',
        'map-3.png', 'map-3b.png', 'map-4.png', 'demo-after-b.json'] },
  },
  findings: [
    { where: 'GET .../display-summary and .../display-window, Niagara', what: [
      'LA2 holds on real data: 41,809 features, all unrecorded_proposal, paged in 11 pages with no repeat or gap, ',
      'every vertex inside the extent, every height null with state unknown and none 0.'],
    evidence: 'part-b-window.json whole' },
    { where: 'GET .../display-window, every size', what: [
      'Each read costs about 1.5 s whatever it holds (0 features 1.53 s, 1 feature 1.52 s, 4,000 1.1-1.7 s): ',
      'the proposal rule reads the 21 package bodies on every read, as LA2 expected (1-3 s).'],
    evidence: 'part-b-window.json windows, requests' },
    { where: 'Studio window mode at open', what: [
      'The camera fits the 13.3 by 21.6 km extent and the canvas shows sky only, while the line says ',
      '"Showing 4,000 of 41,809 buildings; move closer to see the rest." No banner, no empty sentence.'],
    evidence: 'part-b-map.json open; map-1.png' },
    { where: 'Studio window line', what: [
      'Close up (20 m scale) the line still says "Showing 4,354 of 41,809 buildings; move closer to see the ',
      'rest.": the total is the area\'s count, so moving closer never shows the rest.'],
    evidence: 'map-3b.png' },
    { where: 'Studio inspector', what: [
      'A picked proposal opens the inspector with "Building", its identifier and "Open register" ',
      '(/studio/properties/{id}/register). Picking needs footprints a few pixels wide: 165 grid clicks after 8 ',
      'ticks picked nothing; after more zoom over drawn pixels the 16th click picked one.'],
    evidence: 'part-b-map.json clicked; part-b-map-pick.json; map-3.png, map-3b.png' },
    { where: 'Studio register page of a proposal', what: [
      'Shows "Name unknown", "No register is recorded for this building" and "The record of this building ',
      'could not be read · AREA_LIMIT": register 404, building canonical 422 AREA_LIMIT. The officer gets a ',
      'code, not the candidate sentence registerState.ts:64 holds.'],
    evidence: 'part-b-map-pick.json register; map-4.png' },
    { where: 'map-3b.png', what: 'an empty light box under the inspector at the right (about x 1064-1408, y 565-625)',
      evidence: 'map-3b.png; not traced' },
    { where: 'processor-image.mjs roll (PT1)', what: roll.receipt.output.at(-1) + ' 4.6 s; container ids the same',
      evidence: 'step-a3-roll.json' },
  ],
  needsCode: [
    { file: 'packages/server/src/modules/areas/areas.ts:306-309; registry/canonical-building.ts:768', defect: [
      'areaFeatureContext reads the whole area with the default AREA_FEATURE_LIMIT 2,000, so the canonical read of ',
      'any building in an area over the limit is refused AREA_LIMIT; the register page cannot say what it is.'] },
    { file: 'packages/scene/src/engine.ts:209 (far 20,000), :1850 (fog)', defect: [
      'an extent beyond about 12 km fits the camera past the far plane: nothing visible at open (LA1b gap 1, now ',
      'seen on real data)'] },
    { file: 'apps/studio/src/features/map/areaWindow.ts:56-60 windowLine', defect: [
      '"move closer to see the rest" compares the drawn count with the area total, so it shows at every distance'] },
  ],
  demo: { commit: final.commit, doctorBefore: { exit: before.baseline.doctor.exit },
    doctorAfterPartA: 'demo-after-a.json matchesBaseline true',
    doctorAfterPartB: 'demo-after-b.json matchesBaseline true',
    doctorFinal: { exit: final.doctor.exit, matchesBaseline: final.matchesBaseline },
    processes: final.machine.processes, containers: final.containers, health: final.health,
    checkoutClean: final.checkoutClean, requests: 'GET /api/v1/health only' },
  exists: { stop: brief('end-stop'), containersAllExited: step('end-stop').containersAfter['ulpin-reh-02'],
    volumes: step('end-stop').state.volumes, listeners: 'none on 21021-21026; 5188 free',
    servingCheckout: 'E:/Projects/ulpin-wt/ulpin-reh-02 detached at 2acba69a, installed, git status clean',
    records: 'nothing written by this task: reads only; proposals stay proposals',
    scratch: 'E:/BhuAayam-data/task-data/reh5 (raw answers b-* and b2-*, outputs, Studio dev log)',
    untouched: 'ulpin-reh-01 and the demo' },
  restart: { from: 'E:/Projects/ulpin-wt/ulpin-reh-02',
    start: 'pnpm platform:start --profile demo --runtime ulpin-reh-02',
    doctor: 'pnpm platform:doctor --profile demo --runtime ulpin-reh-02',
    stop: 'pnpm platform:stop --profile demo --runtime ulpin-reh-02',
    caution: 'no --create; no roll needed (nothing to recreate); save() never overwrites a receipt' },
  forDemoRoll: { from: '9d6acc6b', to: '2acba69a',
    schema: 'none: only scripts/platform/processor-image.mjs and two tests changed under the four paths',
    steps: [
      { n: 1, what: 'confirm runtime ownership; the demo idle' },
      { n: 2, what: 'stop the two native processes from the demo checkout (DEMO-RUNTIME.md step 2)',
        seconds: 'not measured (the rehearsal stop, containers too, took 6.5 s)' },
      { n: 3, what: 'git -C E:/Projects/ulpin-wt/demo checkout --detach 2acba69a', seconds: 0.154 },
      { n: 4, what: 'pnpm install --frozen-lockfile (lockfile unchanged)', seconds: 0.743 },
      { n: 5, what: 'node scripts/platform/demo-document-runtime.mjs build', seconds: 12.51 },
      { n: 6, what: 'node scripts/platform/processor-image.mjs roll: "nothing recreated" (or skip)', seconds: 4.583 },
      { n: 7, what: 'pnpm platform:start --profile demo', seconds: [
        '34.5 here with cold containers; REH4 measured 16.4 s with the containers already up, the demo\'s case'] },
      { n: 8, what: 'pnpm platform:doctor --profile demo: require both PASS lines (28 PASS here)', seconds: 6.345 },
      { n: 9, what: 'one job authority dispatched (not exercised in REH5; REH4 Part C ran every intake job)' } ],
    beforeThePresentation: [
      'Niagara draws on the map, but opens to sky (needsCode 2) and its buildings\' register pages answer ',
      'AREA_LIMIT (needsCode 1); fix or rehearse around both before the officer is shown it.'] },
  checks: { scan: 'check.mjs: lines <= 120, JSON parses, no unrecorded 64-hex, no credential text',
    diffCheck: 'git diff --check exit 0 before each commit', pngs: 'each under 230 KB',
    forbidden: 'no SQL, psql, docker exec, build, rm, prune, tag, pull or push; no key, enable or provider call' },
};
save('result.json', value);
console.log('result.json written');
