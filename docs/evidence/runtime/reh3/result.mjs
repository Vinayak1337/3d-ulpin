import { readFileSync } from 'node:fs';
import { image, oldImage, pinnedImage, save } from './audit.mjs';

// REH3's index: every number read from the receipts in this folder.
const folder = 'docs/evidence/runtime/reh3';
const read = name => JSON.parse(readFileSync(`${folder}/${name}`, 'utf8'));
const joined = value => Array.isArray(value) ? value.join('') : value;
const step = name => {
  const value = read(`step-${name}.json`);
  return { step: name, command: joined(value.receipt.command), exit: value.receipt.exit,
    seconds: value.receipt.seconds };
};
const before = read('before.json');
const doctor = read('step-b3-doctor.json').receipt.output.map(joined);
const nyc = read('part-c-nyc.json');
const niagara = read('part-c-niagara.json');
const view = read('part-c-view.json');
const records = read('step-b4-records.json');
const demoFinal = read('demo-final.json');
const demoMid = read('demo-after-b.json');
const roll = read('step-b2-roll.json');
const gpuPids = receipt => receipt.output.slice(1).map(line => Number(String(line).split(',')[0])).filter(Boolean);
const ids = rows => rows.map(row => row.split(' ').slice(0, 3).join(' '));
const pinned = image(pinnedImage);
const old = image(oldImage);
const n = niagara.result;
const steps = Object.fromEntries(['a2-checkout', 'a2-install', 'a3-build', 'b1-document-runtime', 'b2-roll',
  'b3-start', 'b3-doctor', 'end-stop'].map(name => [name, step(name)]));

save('result.json', {
  task: 'REH3', gate: ['GF5', 'GF1'],
  status: 'Parts A and B done; Part C done to packages for Niagara, NYC stopped at an explained refusal; '
    + 'rehearsal stopped on the new image and commit, everything kept; the demo untouched',
  branch: 'task/reh3-image-roll-rehearsal', staging: before.stagingCommit, runtime: 'ulpin-reh-02',
  servingCheckout: 'E:/Projects/ulpin-wt/ulpin-reh-02 (detached at 9d6acc6b, installed, git status clean)',
  api: 'http://127.0.0.1:21026',
  image: { tag: pinned.name, id: pinned.id, created: pinned.created, labels: pinned.labels,
    pin: 'scripts/platform/processor-image.json at 9d6acc6b: commit 22003ea3, servicesTree dd59ed7f',
    servingServicesGeo: read('step-a2-install.json').servingServicesGeo, previous: { tag: old.name, id: old.id,
      labels: 'none (<no value> for both)' } },
  parts: {
    A: { done: true, steps: [steps['a2-checkout'], steps['a2-install'], steps['a3-build']],
      build: 'exit 0 in 6.2 s: every layer up to COPY geo came from the engine cache; two labels as pinned',
      containersDuringBuild: 'unchanged (step-a3-build.json containersBefore = containersAfter)',
      evidence: ['before.json', 'step-a2-checkout.json', 'step-a2-install.json', 'step-a3-build.json'] },
    B: { done: true, steps: [steps['b1-document-runtime'], steps['b2-roll'], steps['b3-start'], steps['b3-doctor']],
      roll: { recreated: { geo: 'c1f8fcd635e9 -> 736d6ce4f6ab', worker: '48fb9d79e2fe -> 240cba0b33c6' },
        storesKept: ids(roll.containersAfter['ulpin-reh-02']).filter(row => !/geo-1|worker-1/.test(row)),
        demoContainersUnchanged: JSON.stringify(ids(roll.containersBefore['ulpin-demo']))
          === JSON.stringify(ids(roll.containersAfter['ulpin-demo'])) },
      rehearsalDoctor: { exit: steps['b3-doctor'].exit, pass: doctor.filter(line => line.startsWith('PASS')).length,
        fail: doctor.filter(line => line.startsWith('FAIL')),
        required: doctor.filter(line => /^PASS (Processors run the pinned image|Document runtimes)/.test(line)) },
      gateway: { enabled: false, providerKeysNamed: 0, providerKeysPresent: 0 },
      gpu: { reading: 'nvidia-smi compute apps by pid; WDDM reports memory N/A', before: gpuPids(before.gpu).length,
        afterStart: gpuPids(read('step-b3-start.json').gpu).length,
        rehearsalPidsOnGpu: [44736, 40060].filter(pid => gpuPids(read('step-b3-doctor.json').gpu).includes(pid)),
        newSinceBefore: gpuPids(read('step-b3-doctor.json').gpu).filter(pid => !gpuPids(before.gpu).includes(pid)) },
      reh2Records: { sameAsReh2: records.sameAsReh2, caseRevision: records.case.revision,
        packages: records.packages.length, ready: records.counts.ready, mapFeatures: records.mapFeatures,
        niagaraItem: records.items.find(item => item.placement === 'not_understood') },
      evidence: ['step-b1-document-runtime.json', 'step-b2-roll.json', 'step-b3-start.json', 'step-b3-doctor.json',
        'step-b4-records.json', 'demo-after-b.json'] },
    C: { done: 'Niagara to packages (map read refused); NYC ZIP kept and fanned out, buildings layer refused',
      caseId: nyc.caseId,
      wallSeconds: { nyc: nyc.wallSeconds, niagara: niagara.wallSeconds, view: view.seconds,
        total: Number((nyc.wallSeconds + niagara.wallSeconds + view.seconds).toFixed(1)) },
      nycZip: { zipRoute: 'intake', archive: nyc.result.archive,
        parent: { itemId: nyc.result.parent.itemId, family: 'archive', state: nyc.result.parent.state,
          placement: nyc.result.parent.placement, reason: nyc.result.parent.reason },
        layers: nyc.result.layers.filter(layer => layer.lineage).map(layer => ({ member: layer.memberPath,
          childSourceId: layer.childSourceId, childItemId: layer.childItem?.itemId ?? null,
          placementAfterFanOut: layer.childItem?.placement ?? null,
          placementNow: view.manifest.find(item => item.itemId === layer.childItem?.itemId)?.placement ?? null,
          reasonNow: joined(view.manifest.find(item => item.itemId === layer.childItem?.itemId)?.reason ?? null),
          lineage: layer.lineage })),
        keptInsideArchive: nyc.result.layers.filter(layer => !layer.lineage).map(layer => layer.memberPath),
        buildingsLayer: { sha256EqualsReh2Member: nyc.result.buildingsSha256MatchesReh2Member, card: nyc.result.card,
          question: 'needs_answer 2 s after the fan-out, with the reason below already in the manifest',
          refusal: nyc.result.refusal,
          explained: 'service.ts:111-116 (d43a8322): an area seeded from the same file SHA-256 exists in this '
            + 'runtime, REH2 area e4874150 "buildings original" (case 55d54ba5); no other NYC layer is buildings' },
        packages: 0, evidence: ['part-c-nyc.json', 'part-c-view.json'] },
      niagara: { retained: n.retained, registered: { itemId: n.registered.itemId, sizeClass: n.registered.sizeClass,
        crs: n.registered.crs, cardPresent: n.registered.cardPresent },
      streamedProfileJobId: n.toQuestion.trail.at(-1).streamedProfileJobId,
      toQuestionSeconds: n.toQuestion.seconds, readProgress: n.readProgress, inventory: n.inventory,
      layout: { recipeId: n.layout.recipeId, pinnedCaseRevision: n.layout.plan.caseRevision,
        operations: n.layout.operations, approvedState: n.layout.approvedState },
      toPackagesSeconds: n.toPackages.seconds, packagesSettledSeconds: n.packagesSettledSeconds,
      final: { state: 'read', placement: 'on_map', reason: joined(n.toPackages.trail.at(-1).limitReason) },
      packages: { count: view.niagara.packages, allReviewed: view.packages.every(entry => entry.reviewed),
        features: view.niagara.features, ready: view.counts.ready,
        everyExtentInsideNiagara: view.niagara.everyPackageInsideBox,
        heights: view.niagara.heights, samples: view.niagara.samples },
      map: { areaId: Object.keys(view.map)[0], context: 422, canonical: 422, code: 'AREA_LIMIT',
        words: 'Choose an area with at most 2,000 display features.' },
      evidence: ['part-c-niagara.json', 'part-c-view.json'] },
      notDone: ['The batch confirmation (register, property cards) was not sent: the brief ends at packages.',
        'No browser was driven; what the Studio shows is read through the routes its pages call.',
        '"Card confirmation" read as the layer\'s holdings card read and present: the Studio has no other card '
          + 'step before the layout question (its intake routes listed in report.md).'] },
  },
  findings: [
    { where: 'GET /api/v1/areas/{areaId}/context and /canonical for the Niagara area',
      what: 'The large file reaches 21 reviewed packages (41809 buildings) in one area, and both map reads the '
        + 'Studio makes refuse that area (422 AREA_LIMIT, 2000 display features). The officer sees the item on_map '
        + 'in the batch, but the map page cannot draw it.',
      evidence: 'part-c-niagara.json stoppedAt; part-c-view.json map' },
    { where: 'POST .../sources/{sourceId}/recipes for the NYC buildings layer',
      what: 'The layer from our ZIP is refused 409 SOURCE_ALREADY_IN_AREA: REH2 already made an area from the same '
        + 'bytes in this runtime. The rule is runtime-wide (seed key file:<sha256>), across cases. On the demo the '
        + 'same happens if the demo already holds an area seeded from buildings-original.geojson; that cannot be '
        + 'read from here (only /health of the demo is allowed).', evidence: 'part-c-nyc.json refusal' },
    { where: 'intake-draft-worker.ts:139 (officerQuestion); manifest of the buildings layer',
      what: 'An item whose every answer is refused (SOURCE_ALREADY_IN_AREA) is placed needs_answer; the reason says '
        + 'to open the other area, but the batch counts it as waiting for an officer answer for good.',
      evidence: 'part-c-view.json manifest: buildings-original.geojson planned / needs_answer' },
    { where: 'ZF1 fan-out of nyc-10013-multimodal.zip',
      what: 'Six GeoJSON layers kept with full zip-layer/1 lineage (member SHA-256 of the buildings '
        + 'layer equals REH2\'s '
        + 'extraction). The DEM, ortho, LiDAR and manifest.json stay as member rows with no item, and the archive '
        + 'item stays probed / undecided with no reason: the pack gives the presentation vectors only.',
      evidence: 'part-c-nyc.json layers; part-c-view.json manifest' },
    { where: 'Fixed since REH2, seen on the rolled image',
      what: 'Niagara (declared EPSG:2958) sealed in 88 s where REH2 stopped not_understood after 286 s; the manifest '
        + 'count moved through 43 values while reading (RM1); the doctor now checks the image (PASS). REH2\'s '
        + 'failed item now reads recordsSeen 42247 instead of 300.',
      evidence: 'part-c-niagara.json; step-b4-records.json' },
    { where: 'docs/evidence/runtime/reh3/walk.ts (our harness)',
      what: 'REH2\'s walk dropped a phase\'s findings when a step was refused; the NYC record was rebuilt from its own '
        + 'saved response bodies (nyc-raw.mjs, no request sent) and the walk now keeps partial results.',
      evidence: 'part-c-nyc.json rebuiltFrom' },
  ],
  needsCode: [
    { file: 'packages/server/src/modules/areas/areas.ts:222,279-281; canonical-area.ts:201',
      defect: 'an area over 2000 display features cannot be read by the map at all; a large file\'s area always is' },
    { file: 'packages/server/src/modules/usp/ingestion/intake-draft-worker.ts:139',
      defect: 'SOURCE_ALREADY_IN_AREA is turned into an officer question that no answer can satisfy' },
  ],
  demo: { commit: demoFinal.commit, doctorBefore: { exit: before.baseline.doctor.exit, pass: 27 },
    doctorAfterPartB: { exit: demoMid.doctor.exit, matchesBaseline: demoMid.matchesBaseline },
    doctorFinal: { exit: demoFinal.doctor.exit, matchesBaseline: demoFinal.matchesBaseline,
      pass: demoFinal.doctor.output.filter(line => String(line).startsWith('PASS')).length },
    processes: demoFinal.machine.processes, containers: ids(demoFinal.containers), health: demoFinal.health,
    checkoutClean: demoFinal.checkoutClean, evidence: ['before.json', 'demo-after-b.json', 'demo-final.json'] },
  exists: {
    folder: 'E:/BhuAayam-data/runtime/ulpin-reh-02 (entries by name in step-end-stop.json; no file opened)',
    volumes: ['ulpin-reh-02_minio-data', 'ulpin-reh-02_postgres-data', 'ulpin-reh-02_redis-data'],
    network: 'ulpin-reh-02_default',
    containersAllExited: ids(read('step-end-stop.json').containersAfter['ulpin-reh-02']),
    processes: 'none; no listener on 21021-21026', image: `${pinned.name} (kept; the demo will use the same one)`,
    records: ['REH2 case 55d54ba5 as REH2 left it', `REH3 case ${nyc.caseId}: the NYC archive, six layer originals `
      + 'and items, Niagara with 21 reviewed packages in one area'],
    scratch: 'E:/BhuAayam-data/task-data/reh3 (raw exchanges, state.json, progress.jsonl, package reads)',
    untouched: 'ulpin-reh-01 (no command named it) and the demo' },
  restart: { from: 'E:/Projects/ulpin-wt/ulpin-reh-02',
    start: 'pnpm platform:start --profile demo --runtime ulpin-reh-02',
    doctor: 'pnpm platform:doctor --profile demo --runtime ulpin-reh-02',
    stop: 'pnpm platform:stop --profile demo --runtime ulpin-reh-02',
    caution: 'no --create; no roll needed (already on the pin); do not rerun walk.ts phases' },
  forDemoRoll: {
    from: '99e0026e', to: '9d6acc6b',
    schema: 'none: no file under database/, no migration, schema or lockfile changed between the two commits '
      + '(git diff --name-only); the API structural admission check passed on reh-02 at 9d6acc6b',
    steps: [
      { n: 1, what: 'confirm runtime ownership; the demo idle (no import running: the roll recreates its processors)' },
      { n: 2, what: 'stop the two native processes from the demo checkout (DEMO-RUNTIME.md step 2)',
        seconds: 'not measured here (the rehearsal stop, which also stops containers, took 6.2 s)' },
      { n: 3, what: 'git -C E:/Projects/ulpin-wt/demo checkout --detach 9d6acc6b',
        seconds: steps['a2-checkout'].seconds },
      { n: 4, what: 'pnpm install --frozen-lockfile (lockfile unchanged; done anyway)',
        seconds: steps['a2-install'].seconds },
      { n: 5, what: 'node scripts/platform/demo-document-runtime.mjs build',
        seconds: steps['b1-document-runtime'].seconds },
      { n: 6, what: `image build: none, ${pinned.name} is on the shared engine (built here in `
        + `${steps['a3-build'].seconds} s); then node scripts/platform/processor-image.mjs roll (no --runtime)`,
      seconds: steps['b2-roll'].seconds },
      { n: 7, what: 'pnpm platform:start --profile demo', seconds: steps['b3-start'].seconds },
      { n: 8, what: 'pnpm platform:doctor --profile demo: require PASS Processors run the pinned image and PASS '
        + 'Document runtimes (28 PASS here)', seconds: steps['b3-doctor'].seconds },
      { n: 9, what: 'one job authority dispatched: here every intake job ran (case jobs read through the case route)' },
    ],
    downtimeMeasuredSeconds: Number((steps['a2-checkout'].seconds + steps['a2-install'].seconds
      + steps['b1-document-runtime'].seconds + steps['b2-roll'].seconds + steps['b3-start'].seconds).toFixed(1)),
    beforeThePresentation: [
      'Decide how the map shows a large file\'s area (needsCode 1); today Niagara is on_map but not drawable.',
      'Check through the Studio on the demo whether an area seeded from buildings-original.geojson exists; if so '
        + 'our ZIP\'s buildings layer answers "already the source of the area ..." as here.',
    ] },
  checks: { scan: 'check.mjs: every file <=120 columns, JSON parses, no unrecorded 64-hex, no credential text',
    diffCheck: 'git diff --check exit 0 before each commit',
    originalsUnchanged: 'zip and Niagara SHA-256 re-read after the walk: unchanged',
    forbidden: 'no SQL, psql, docker exec, rm, prune, tag, pull or push; one build by processor-image.mjs; '
      + 'no key, enable or provider call; no push' },
});
console.log(readFileSync(`${folder}/result.json`, 'utf8').length);
