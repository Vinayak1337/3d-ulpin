import { readFileSync } from 'node:fs';
import { save } from './audit.mjs';

// REH6's index after the resume, from its receipts: Part 0 (Docker recovery), A (roll), B (Niagara register, map
// and line), C (ZIP layers by the dispatcher job) and the end. The first stop's index is result-first-stop.json.
const read = name => JSON.parse(readFileSync(name, 'utf8'));
const step = name => read(`step-${name}.json`).receipt;
const recovery = read('docker-recovery.json');
const before = read('before.json').baseline;
const demoEnd = read('demo-end.json');
const register = read('part-b-register.json');
const map = read('part-b-map.json');
const wait = read('part-b-map-wait.json');
const zip = read('part-c-zip.json');
const doctor = step('a3-doctor');
const line = lines => [lines].flat(2).join('');
const demo = entry => ({ at: entry.at, exit: entry.doctor.exit, commit: entry.commit,
  processes: entry.machine.processes, health: entry.health,
  fails: entry.doctor.output.filter(text => text.startsWith('FAIL')) });
const stage = entry => ({ scale: line(entry.scale), line: line(entry.statusLines),
  reads: entry.reads.filter(read => !read.failed).map(read => `${read.widthM} x ${read.heightM} m: ${read.features}`
    + `${read.next ? ' (next)' : ''} in ${read.seconds} s`) });

save('result.json', {
  task: 'REH6', gate: ['GF5', 'GF1'], branch: 'task/reh6-large-area-fixes', staging: '2ddefbbb',
  runtime: 'ulpin-reh-02', api: 'http://127.0.0.1:21026', status: 'done: Parts 0, A, B and C; the rehearsal is stopped',
  preCheck: { command: 'git diff --name-only 2acba69a 2ddefbbb -- services/ database/ scripts/platform/ pnpm-lock.yaml',
    output: 'empty', meaning: 'no schema step and no image roll' },
  firstStop: 'result-first-stop.json: Docker Desktop crashed on a stale socket; the lead then authorised Part 0',
  parts: {
    0: { done: true, what: 'run and docker-secrets-engine renamed aside in one command; Docker started once',
      dockerUpSeconds: 6.7, volumes: recovery.volumes.count, volumesMissing: recovery.volumes.missing,
      evidence: 'docker-recovery.json' },
    A: { done: true, checkoutSeconds: step('a2-checkout').seconds, installSeconds: step('a2-install').seconds,
      servicesTreeIsPin: read('step-a2-install.json').servicesTreeIsPin,
      documentRuntimeSeconds: step('a3-document-runtime').seconds, rollSeconds: step('a3-roll').seconds,
      roll: step('a3-roll').output.at(-1), startSeconds: step('a3-start').seconds,
      doctor: { exit: doctor.exit, seconds: doctor.seconds, pass: doctor.output.filter(text => text.startsWith('PASS'))
        .length, fail: doctor.output.filter(text => text.startsWith('FAIL')).length,
      required: doctor.output.filter(text => /^PASS (Processors run the pinned image|Document runtimes)/.test(text)),
      gateway: doctor.output.filter(text => text.trim() === 'enabled: false') } },
    B: { done: true,
      summary: { status: register.summary.status, seconds: register.summary.seconds,
        featureCount: register.summary.featureCount },
      window500: { status: register.window500.status, seconds: register.window500.seconds,
        features: register.window500.features },
      register: register.buildings.map(entry => ({ identifier: entry.identifier, canonical: entry.canonical.status,
        seconds: entry.canonical.seconds, bytes: entry.canonical.bytes, recordState: entry.recordState,
        firstGap: entry.firstGap?.gap ?? null, registerRoute: entry.register.status })),
      notABuilding: { canonical: register.notABuilding.canonical.status,
        words: register.notABuilding.canonical.refusal?.words ?? null },
      map: {
        open: { line: line(map.open.statusLines), scale: line(map.open.scale), key: map.open.key,
          clearShare: map.open.canvas.clearShare, drawnShare: map.open.canvas.drawnShare,
          screenshot: 'map-1.png: the line in the picture, taken while paging, reads 4,000 in view of 41,809' },
        zoomed8: { line: line(map.zoomed.statusLines), scale: line(map.zoomed.scale), cut: true,
          screenshot: 'map-2.png' },
        picked: { identifier: 'B10638', inspector: line(map.picked.inspectorText),
          flatClearCells: map.picked.canvas.flatClearCells, screenshot: 'map-3.png' },
        register: { text: map.register.text, screenshot: 'map-4.png' },
        windowReads: map.windowReads,
        settled: wait.stages.map(stage), settledScreenshot: 'map-6.png at a 100 m scale' } },
    C: { done: true, caseId: zip.caseId, enrolSeconds: zip.enrol.seconds, job: { id: zip.job.id,
      states: zip.job.rightAfterEnrol.concat(zip.job.status),
      queuedToCompletedSeconds: zip.job.queuedToCompletedSeconds,
      attempts: zip.job.attempts, dispatcherLog: zip.job.dispatcherLog },
    layers: zip.layers.map(layer => `${layer.member}: ${layer.state}/${layer.placement}`),
    secondEnrolment: zip.again, expected: zip.expected },
  },
  findings: [
    { where: 'Part 0, Docker Desktop after the reboot', what: 'The stale-socket crash cleared by renaming run and '
      + 'docker-secrets-engine aside together; the engine answered in 6.7 s with all 23 volumes listed.',
    evidence: 'docker-recovery.json' },
    { where: 'Part A', what: 'Roll as proven: nothing recreated; 28 PASS and 0 FAIL with both required lines; the '
      + 'gateway disabled. The document runtime build took 48.4 s (REH5: 12.5 s), the first run after the reboot.',
    evidence: 'step-a3-*.json' },
    { where: 'Part B, register (RG1)', what: 'Three proposals of the centre window answer canonical 200 with '
      + 'recordState candidate in about 1.6 s each (REH5: 422 AREA_LIMIT); the area id answers 404. The register '
      + 'page shows the candidate sentence and no code.', evidence: 'part-b-register.json; map-4.png' },
    { where: 'Part B, opening view (LA4)', what: 'No sky: the ground fills the canvas (clear colour 0 %). The '
      + 'buildings are drawn but small at the 2 km opening scale (1.6 % of the canvas differs from the ground).',
    evidence: 'part-b-map.json open.canvas; map-1.png' },
    { where: 'Part B, the line (LA5)', what: 'True once the view on screen is read: at a 100 m scale the window '
      + 'was 3.1 by 3.2 km and held 4,354 (not cut, "4,354 buildings in view of 41,809 (4,354 proposed, not yet '
      + 'confirmed)"); at 200 m and above each window held more than 15,000 and the cut sentence showed.',
    evidence: 'part-b-map-wait.json; map-6.png' },
    { where: 'Part B, the line while paging', what: 'Until the last page, a view the budget will cut reads as a '
      + 'complete count ("4,000 buildings in view of 41,809" in map-1.png, 12,000 a few seconds later).',
    evidence: 'map-1.png; part-b-map.json open' },
    { where: 'Part B, window size', what: 'The read window is far wider than the screen: the ground footprint '
      + 'reaches four camera distances, so a 200 m scale view reads 6.6 by 6.7 km and the budget cuts it, and '
      + '"move closer" shows until about a 100 m scale. Each cut view costs 4 pages, about 9 s.',
    evidence: 'part-b-map-wait.json stages' },
    { where: 'Part B, two slow pages', what: 'Two window pages took 31.2 s and 34.8 s, against 1.7 to 2.6 s for '
      + 'the other pages. The cause is not established: the API log lies under the runtime folder, not opened.',
    evidence: 'part-b-map-wait.json stages 4 and 5' },
    { where: 'Part B, the flat background patch', what: 'Not seen: no 16 px block of flat clear colour in any '
      + 'picture, the inspector open included (map-3.png).', evidence: 'part-b-map.json canvas.flatClearCells' },
    { where: 'Part B, ghosts and Key (LA3)', what: 'The Key shows, open, with Recorded and Proposed, not yet '
      + 'confirmed; the line and inspector carry the proposal words. Its two swatches look alike at this size; '
      + 'no recorded building is in this area to compare.', evidence: 'map-1.png; map-3.png' },
    { where: 'Part C (ZJ1)', what: 'The enrolment returned in 0.16 s with one intake-zip-layers job queued; the '
      + 'job succeeded 1.6 s after it was queued; six layer items followed; enrolling again returned the same item '
      + 'and queued no second job.', evidence: 'part-c-zip.json' },
    { where: 'Part C, the ZIP words', what: 'The enrol answer already says "6 map layers in this ZIP are taken in '
      + 'as their own files", while the job is still queued and no layer item exists yet.',
    evidence: 'part-c-zip.json enrol.item.reason; trail at 0 s' },
    { where: 'Part C, the buildings layer', what: 'Its intake-draft job ends failed with SOURCE_ALREADY_IN_AREA '
      + 'while the item rests read/undecided with the already-in-area sentence (REH4 behaviour).',
    evidence: 'part-c-zip.json layers[1].draftJob' },
    { where: 'Part C, what could not be read', what: 'No product route reports a job attempt count; the '
      + 'dispatcher log lies under E:/BhuAayam-data/runtime/** and was not opened.', evidence: 'part-c-zip.json job' },
  ],
  needsCode: [
    { file: 'apps/studio/src/features/map/areaWindow.ts:114', what: 'publish passes cut false for every page but '
      + 'the last, so windowLine (:62-67) shows a partial read as "<n> in view of <total>"; a paging state, or '
      + 'holding the line until the read ends, would keep it true.' },
    { file: 'packages/scene/src/engine.ts:462', what: 'viewFootprint reach is four camera distances; the window '
      + 'read is far wider than the screen, so the budget cuts views down to about a 100 m scale. A decision '
      + 'for the lead: a shorter reach, or windows bounded by what is drawn large enough to see.' },
  ],
  demo: { first: demo(before), last: demo(demoEnd), sameCommitProcessesAndContainers: demoEnd.matchesBaseline,
    note: 'The demo native API and dispatcher have not run since the reboot; this task did not start them. Its '
      + 'containers came back by their restart policy when Docker started (same ids).',
    requestsToDemoApi: 'GET /api/v1/health only (inside each doctor read)', reh01: 'not touched' },
  exists: { serving: 'E:/Projects/ulpin-wt/ulpin-reh-02 at 2ddefbbb, clean',
    rehearsal: 'stopped: six exited containers, three volumes, everything kept', case: zip.caseId,
    devServer: 'stopped; port 5188 free',
    dockerFoldersAside: ['%LOCALAPPDATA%/Docker/run-stale-20261017-2350',
      '%LOCALAPPDATA%/docker-secrets-engine.saved-reh6-20261017'] },
  restart: { from: 'E:/Projects/ulpin-wt/ulpin-reh-02',
    start: 'pnpm platform:start --profile demo --runtime ulpin-reh-02',
    doctor: 'pnpm platform:doctor --profile demo --runtime ulpin-reh-02',
    stop: 'pnpm platform:stop --profile demo --runtime ulpin-reh-02',
    caution: 'no --create; no roll needed (nothing to recreate); walk.ts runs once (its raw file blocks a rerun)' },
  forDemoRoll: { from: '9d6acc6b', to: '2ddefbbb', proven: true, schema: 'none', image: 'none (nothing recreated)',
    steps: [
      { n: 1, what: 'Docker up; after a reboot, Part 0 (rename run and docker-secrets-engine aside, start once)',
        seconds: 6.7 },
      { n: 2, what: 'stop the demo native processes if running (DEMO-RUNTIME.md step 2); none run now',
        seconds: 'not measured' },
      { n: 3, what: 'git -C E:/Projects/ulpin-wt/demo checkout --detach 2ddefbbb',
        seconds: step('a2-checkout').seconds },
      { n: 4, what: 'pnpm install --frozen-lockfile', seconds: step('a2-install').seconds },
      { n: 5, what: 'node scripts/platform/demo-document-runtime.mjs build',
        seconds: step('a3-document-runtime').seconds },
      { n: 6, what: 'node scripts/platform/processor-image.mjs roll: nothing recreated',
        seconds: step('a3-roll').seconds },
      { n: 7, what: 'pnpm platform:start --profile demo', seconds: step('a3-start').seconds },
      { n: 8, what: 'pnpm platform:doctor --profile demo: both PASS lines', seconds: doctor.seconds },
      { n: 9, what: 'one dispatcher job: a ZIP enrolment runs intake-zip-layers (Part C: 1.6 s)', seconds: 1.6 },
    ] },
  checks: { evidenceScan: 'node docs/evidence/runtime/reh6/check.mjs', diffCheck: 'git diff --check',
    pngsUnder1MB: true },
});
