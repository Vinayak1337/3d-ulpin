import { readFileSync } from 'node:fs';
import { save } from './audit.mjs';

// REH8's result: Act 1 from act1.json, Act 2 from the presenter's log (task-data/reh8/dress-log.jsonl), the breaks
// against INGESTION-ARCHITECTURE.md section 13, the code lines behind them (read, not changed) and every answer the
// presenter gave. Seconds are from the drop or the press named; frames are the page's own recorder.
const act1 = JSON.parse(readFileSync('act1.json', 'utf8'));
const doctor = name => JSON.parse(readFileSync(name, 'utf8'));
const demoRows = ['before.json', 'demo-after-a.json', 'demo-after-act1.json', 'demo-final.json'].map(name => {
  const value = doctor(name);
  const row = value.baseline ?? value;
  return { file: name, exit: row.doctor.exit, commit: row.commit, health: row.health,
    processes: row.machine.processes.length, matchesBaseline: value.matchesBaseline ?? 'is the baseline' };
});
const sealed = 'c69e35ad-d041-4cd5-9653-8e9d67f6b53d';
const act2 = {
  act: 2, label: 'the sealed DQ1 set, unseen until this act; all five chosen in one drop', caseId: sealed,
  caseName: 'REH8 act 2 sealed set test_only', droppedAt: '2026-10-18T14:02:33Z',
  dropScreen: 'Retain files lists 3 of 5: "Other files stay separate. Continue with them from the batch after these '
    + 'files are retained." (the CSV and XLSX)',
  files: [
    { file: 'hdb-existing-building.geojson', bytes: 57012074, outcome: 'card',
      seconds: { upload: 'about 2.2 to 4.3 (54.4 MiB)', inventoryRead: 'under 340 (13,436 records)',
        useLayoutToFirstPackage: 40.2, useLayoutToLastPackage: 164.9 },
      officerAnswer: 'a building; identifier OBJECTID (whole number); name not stated; height not offered',
      parts: { packages: 11, buildingsReady: 13432, notAcceptedByReader: 4 },
      framesBatchPageWhileStreaming: { frames: 9843, largestMs: 100, over50: 10, over100: 0, longestTaskMs: 113 },
      map: { area: 'hdb existing building (new)', firstWordsSeconds: 15.3, firstPageSeconds: 23.3,
        allDrawnSeconds: 38.9, screen: '13,432 buildings', contextRoute: 'GET /areas/:id/context 422 AREA_LIMIT',
        framesWhileLoading: { frames: 1469, largestMs: 683, over100: 66, longestTaskMs: 695 },
        afterDrawn: 'every frame over 100 ms: headless software WebGL repaints 13,432 buildings at about 2 to 8 '
          + 'fps' } },
    { file: 'hdb-annual-report-price-range-footnotes.pdf', bytes: 251862, outcome: 'held',
      screen: 'Not understood. Kept as a PDF document (246 KB). No reader in a batch takes this kind of file yet, so '
        + 'it is not on the map; the original is kept with its SHA-256.' },
    { file: 'sla-cadastral-land-parcel.geojson', bytes: 144816566, outcome: 'refused',
      screen: 'The upload stopped at part 1 of 18: The large-original/2 storage reservation is not configured on this '
        + 'service..', route: `POST /api/v1/ingestion/cases/${sealed}/uploads`, status: 503,
      code: 'UPLOAD_CAPACITY_UNCONFIGURED', attempts: 2,
      after: 'Cancel upload answered "Send the same request again to find the upload before cancelling it."; the '
        + 'dialog stayed at "Retaining files..." and was left through Batches' },
    { file: 'hdb-property-information.csv', bytes: 948464, outcome: 'refused',
      attempts: [
        { choice: 'the batch case (the field came empty; the id was copied from the address)', screen: 'Choose an '
          + 'active, unassigned source case. This table cannot be attached to a site.', route: 'none (client check)' },
        { choice: 'Create an unassigned source case "REH8 act 2 sealed tables test_only"', route: 'POST '
          + '/api/v1/ingestion/cases/8498aac7-3bb0-4ae9-a67e-f8f01d5d0163/sources', status: 422,
          code: 'TABULAR_HEADER_OR_READER', screen: 'The literal reader requires valid headers, at most 2,000 rows and '
            + '256 columns.', left: 'an empty case 8498aac7-... (kept)' }] },
    { file: 'bca-building-energy-performance-2019.xlsx', bytes: 98040, outcome: 'held',
      question: 'Exact sheet name. The API cannot list sheets. Enter the name from the workbook.',
      stopped: 'the Studio does not show the sheet names, so no answer from the screen; stopped, nothing sent' },
  ],
  card: {
    target: 'feature 945332 of hdb-existing-building.geojson',
    acknowledgement: 'Rehearsal REH8, test_only data: record these packages from the retained HDB file and make one '
      + 'card for feature 945332.',
    seconds: { pressToAllRecorded: 247.6, pressToCardMadeAndVerified: 257.6 }, recorded: 13432,
    card: '53e58373-da46-4d20-9f3f-5c06922437de revision 1', pdf: { bytes: 6836, contentType: 'application/pdf' },
    verification: { verdict: 'Consistent', checks: '6 of 6 passed', signature: 'not assessed (NO_TRUSTED_KEY_POLICY)' },
  },
  pageErrors: 0,
};
const brk = (act, file, step, screen, route, status, code, expected, evidence) =>
  ({ act, file, step, screen, route, status, code, expected, evidence });
const breaks = [
  brk(2, 'sla-cadastral-land-parcel.geojson (144.8 MB)', 'upload', act2.files[2].screen,
    'POST /ingestion/cases/:id/uploads', 503, 'UPLOAD_CAPACITY_UNCONFIGURED', 'any file, any size (section 0)',
    'a2-03-refused.png, a2-04-retry.png'),
  brk(2, 'sla-cadastral-land-parcel.geojson', 'cancel after refusal', 'Send the same request again to find the '
    + 'upload before cancelling it.', null, null, null, 'a stopped step stays visible and the batch opens',
    'a2-05-cancelled.png'),
  brk(2, 'hdb-property-information.csv, bca-...xlsx', 'drop', act2.dropScreen, null, null, null,
    'one drop, one batch', 'a2-01-picked.png'),
  brk(2, 'hdb-property-information.csv', 'retain table', act2.files[3].attempts[1].screen,
    'POST /ingestion/cases/:id/sources', 422, 'TABULAR_HEADER_OR_READER', 'tables attach to buildings (step 4)',
    'a2-14-csv-new-case.png'),
  brk(2, 'hdb-property-information.csv', 'retain table into the batch', act2.files[3].attempts[0].screen, null,
    null, null, 'the table joins its batch', 'a2-12-csv-disabled.png, a2-13-csv-result.png'),
  brk(2, 'bca-building-energy-performance-2019.xlsx', 'question', act2.files[4].question, null, null, null,
    'the Studio offers the answers the file holds', 'a2-15-xlsx.png'),
  brk(1, 'nyc-10013-multimodal.zip / buildings-original.geojson', 'probe', act1.files[0].layers[
    'buildings-original.geojson'].screen, null, null, null, 'new case drafts its own buildings (runtime not empty: '
    + 'an earlier rehearsal made that area)', 'a1-f1-02-batch.png'),
  brk(1, '5 NYC ZIP layers', 'layout', 'Needs an answer. No approved layout matches this file.', null, null, null,
    'not a break by itself; parks, sidewalk, hydrography, boundary left: the kinds offered do not fit what the '
      + 'file states', 'a1-f1-04-parks-layout.png'),
  brk(1, 'DA6 GeoJSON (43 MB)', 'read', 'Reading file (for about 260 s, no count; the server had 37,600 records)',
    'GET /ingestion/cases/:id/intake', 200, null, 'progress in words', 'a1-f2-03-after-read.png'),
  brk(1, 'DA6 GeoJSON', 'draw while streaming', 'The buildings in view could not be read. A local service could not '
    + 'complete this operation.', 'GET /areas/:id/display-window', 503, 'SERVICE_UNAVAILABLE',
    'the map draws each part as it lands', 'a1-map-02.png (17.1 and 17.7 s, twice)'),
  brk(1, 'DA6 GeoJSON', 'map context', 'Choose an area with at most 10,000 display features.',
    'GET /areas/:id/context', 422, 'AREA_LIMIT', 'any size', 'act 1 and act 2 map opens'),
  brk(1, 'DA6 GeoJSON', 'area', 'Area: not supplied by the record; the 48,683 buildings joined the area "roadbed"',
    null, null, null, 'a building file gets its own area, not the roads layer\'s', 'a1-card-08-record.png'),
  brk(1, 'DA6 GeoJSON', 'first drawn part', 'nothing drawn until after the confirmation; 15,000 drawn 89 s after '
    + 'the map opened', null, null, null, 'first part drawn within seconds', 'a1-map-05-loaded.png'),
  brk(1, 'DA6 GeoJSON', 'batch page frames', '23 frames over 100 ms, worst growing 117 to 267 ms with each package',
    null, null, null, 'no frame over 100 ms', 'act1.json framesBatchPageWhileStreaming'),
  brk(1, 'DA6 GeoJSON', 'map frames', 'single frames of 750 ms (act 1) and 683 ms (act 2) on opening; 532 and 66 '
    + 'frames over 100 ms while loading', null, null, null, 'no frame over 100 ms', 'act1.json, act2 map'),
  brk(1, 'DA6 card', 'record page', 'Property Card: Blocked: select a unit with an assigned proposed code', null,
    null, null, 'the record page shows the card made', 'a1-card-08-record.png'),
  brk(1, 'DA6 card', 'card PDF', 'Geometry / frame / datum: Unavailable: Not supplied by the executed text/CSV '
    + 'profile', null, null, null, 'words true to a map file', 'card-act1.pdf'),
  brk(1, 'all PDFs', 'read', 'Not understood. No reader in a batch takes this kind of file yet', null, null, null,
    'documents attach to the recorded building (step 4, known not built)', 'a1-f3-01-batch.png'),
  brk(2, 'the act 2 batch', 'batches list', 'not on the Batches page by its name; opened by its address', null,
    null, null, 'the new batch is listed', 'a2-06-batch.png'),
  brk(1, 'live updates', 'events stream', '153 aborted reads of /ingestion/cases/:id/events in act 1; the page '
    + 'falls back to polling every 2 to 3 s', 'GET /ingestion/cases/:id/events', null, 'net::ERR_ABORTED',
    'one live stream per batch page', 'dress-log.jsonl'),
];
save('result.json', {
  task: 'REH8', gate: ['GF5', 'GF4', 'GF1'], runtime: 'ulpin-reh-02',
  rolledTo: '8eeba26f9053fcb6d9357736d2667e5a3273bcdb',
  runtimeNotEmpty: true, doctor: '28 PASS, 0 FAIL (step-a3-doctor.json); gateway enabled: false',
  browser: 'Playwright Chromium headless, 1440x900, video on; software WebGL',
  scratch: 'E:/BhuAayam-data/task-data/reh8 (dress-log.jsonl, shots/, video/, card-act1.pdf, card-act2.pdf)',
  interruption: 'session limit after act 1; the browser stayed open idle about 90 min and was then stopped; act 2 '
    + 'ran in a new browser (separate video)',
  acts: [
    { act: 1, evidence: 'act1.json', outcomes: Object.fromEntries(act1.files.map(f => [f.file.split(' ')[0],
      f.outcome])), card: act1.card.card, verdict: act1.card.verification.verdict },
    act2,
  ],
  worstFrameMs: 750,
  breaks,
  needsCode: [
    { what: 'large-original/2 capacity is read from ULPIN_LARGE_ORIGINAL_V2_CAPACITY_BYTES, which no platform '
      + 'script sets, so every file on that profile is refused', where: ['packages/server/src/modules/usp/ingestion/'
      + 'large-original.ts:25-28', 'packages/server/src/modules/usp/ingestion/large-original.ts:107'],
      owner: 'lead or owner: the capacity is a runtime setting' },
    { what: 'cancel needs a receipt the refused create never gave; the dialog cannot close to its batch',
      where: ['apps/studio/src/features/intake/upload-command.ts:147'] },
    { what: 'tables and workbooks are split from the drop', where: ['apps/studio/src/features/intake/'
      + 'IntakeDropDialog.tsx:45'] },
    { what: 'a table cannot join a batch whose case has a site; the case field comes empty',
      where: ['apps/studio/src/features/intake/table/retain.ts:41'] },
    { what: 'workbook sheet names are not listed', where: ['apps/studio/src/features/intake/table/'
      + 'TableImportFields.tsx:49'] },
    { what: 'the batch table says "Reading file" with no count; the count words exist but only the tray uses them',
      where: ['apps/studio/src/features/intake/batch-model.ts:8', 'apps/studio/src/features/intake/batch-model.ts:'
        + '25-27', 'apps/studio/src/features/intake/IntakeTray.tsx:28'] },
    { what: 'the record page decides the card button from a unit, not from a card already made',
      where: ['apps/studio/src/features/register/RegisterPage.tsx:160'] },
    { what: 'card prints "text/CSV profile" for a map feature', where: ['packages/server/src/modules/usp/packets/'
      + 'card-projection.ts:111'] },
    { what: 'area context refuses over 10,000 display features', where: ['packages/server/src/modules/areas/areas.ts'
      + ':280', 'packages/server/src/modules/areas/area-display-proposals.ts:64'] },
    { what: 'a second copy of a file is refused across cases', where: ['packages/server/src/modules/usp/ingestion/'
      + 'service.ts:116'] },
  ],
  officerActions: [
    { act: 1, step: 'Retain files', screen: 'Source case / New case name', chosen: 'Create an unassigned source case '
      + '"REH8 act 1 our data test_only"' },
    { act: 1, step: 'Layout roadbed.geojson', screen: 'What is each feature / Which field identifies each one',
      chosen: 'a road; id; name and height not stated' },
    { act: 1, step: 'Layout DA6 GeoJSON', screen: 'same', chosen: 'a building; doitt_id; name not stated' },
    { act: 1, step: 'One confirmation', screen: 'Your acknowledgement', chosen: 'ticked feature 122062; typed the '
      + 'words in act1.json; pressed "Record packages and make chosen cards" once' },
    { act: 2, step: 'Retain files', screen: 'Source case / New case name', chosen: 'Create an unassigned source case '
      + '"REH8 act 2 sealed set test_only"' },
    { act: 2, step: 'parcel upload refused', screen: 'Try again / Cancel upload', chosen: 'Try again once, then '
      + 'Cancel upload' },
    { act: 2, step: 'Layout hdb-existing-building.geojson', screen: 'same', chosen: 'a building; OBJECTID; name '
      + 'not stated' },
    { act: 2, step: 'Import as a table (CSV)', screen: 'Case ID', chosen: 'the batch case id, then a new unassigned '
      + 'case "REH8 act 2 sealed tables test_only"' },
    { act: 2, step: 'Import as a table (XLSX)', screen: 'Exact sheet name', chosen: 'not answered; stopped' },
    { act: 2, step: 'One confirmation', screen: 'Your acknowledgement', chosen: 'ticked feature 945332; typed the '
      + 'words above; pressed once' },
  ],
  teacher: 'not offered on any screen reached; the gateway stayed disabled and no key or provider was used',
  demo: demoRows,
  rehearsalAtEnd: 'stopped: six exited containers, volumes kept (step-end-stop.json)',
});
