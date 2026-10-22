import { readFileSync, readdirSync, statSync } from 'node:fs';
import { save } from './audit.mjs';

const scratch = 'E:/BhuAayam-data/task-data/reh11';
const load = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const external = name => JSON.parse(readFileSync(`${scratch}/${name}`, 'utf8'));
const log = readFileSync(`${scratch}/dress-log.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
const browser = external('c01-final-browser.json').value;
const state = load('final-state.json');
const readback = load('readback.json');
const before = load('before.json');
const after = load('demo-after.json');
const end = load('step-end.json');
const mark = label => browser.marks.find(row => row.label === label).at;
const observed = step => log.find(row => row.kind === 'result' && row.step === step).at;
const seconds = (from, to) => Number(((to - from) / 1000).toFixed(3));
const words = value => [value].flat().join('');
const completed = (label, operation) => state.cases[label].jobs
  .filter(row => row.operation === operation && row.completedAt)
  .sort((left, right) => left.completedAt.localeCompare(right.completedAt));
const first = (label, operation) => Date.parse(completed(label, operation)[0].completedAt);
const last = (label, operation) => Date.parse(completed(label, operation).at(-1).completedAt);
const retain = mark('act1-retain');
const surfaceItems = state.cases.act1.items.filter(row => row.partsPlanned);
const firstIntake = log.find(row => row.kind === 'api' && row.at > retain && row.method === 'GET'
  && row.path === `/api/v1/ingestion/cases/${state.cases.act1.caseId}/intake`);
const uploads = log.filter(row => row.kind === 'api' && row.at > retain && row.at < mark('act1-approve')
  && row.path.endsWith('/finalize'));
const journey = external('journey-final.json');
const transports = readdirSync(scratch).filter(name => name.startsWith('journey-transport-'))
  .map(external).flatMap(value => value.requests);
const errors = log.filter(row => row.kind === 'console-error');

const result = {
  task: 'REH11', gates: ['GF5', 'GF4', 'GF1'], runtime: 'ulpin-reh-02', servedCommit: '065a323f',
  runtimeNotEmpty: true, roll: load('roll.json'),
  steps: ['stop', 'checkout', 'install', 'documents', 'start', 'doctor'].map(step => ({
    step, exit: load(`step-${step}.json`).receipt.exit, seconds: load(`step-${step}.json`).receipt.seconds,
  })),
  act1: {
    caseId: state.cases.act1.caseId, areaId: '67d764ed-a347-48fe-aedf-ec49992cc581',
    dropToForecastSeconds: seconds(mark('act1-drop'), mark('act1-dialog')),
    readerForecast: [
      { file: 'gpmc-yuvp.csv', words: 'Will be read by the table reader (within 7 GiB). '
        + 'Choose Read as a table after upload.' },
      { file: 'buildings-original.geojson', words: 'Will be read by the GeoJSON reader (within 1 GiB)' },
      { file: 'nyc-10013-ortho-2018.tif', words: 'Will be read by the raster reader (within 16 MiB)' },
      { file: 'nyc-10013-lidar-2017.laz', words: 'Will be read by the point cloud reader (within 16 MiB)' },
    ],
    upload: {
      words: 'The batch opens before upload finishes. Keep its page open to send the files and see progress.',
      firstBatchReadSeconds: seconds(retain, firstIntake.at),
      finalUploadFinishedSeconds: seconds(retain, uploads.at(-1).at),
      batchReadBeforeFinalUpload: firstIntake.at < uploads.at(-1).at,
      qualification: 'Act 1 navigation observer used the wrong URL pattern; network order proves early batch '
        + 'opening. Act 2 separately captured the visible Retaining files state before upload completed.',
      firstRetainedProbeWordsObservedBySeconds: seconds(retain, observed('a06-state')),
    },
    layout: {
      words: 'Remembered from an approved layout of the same columns; a building; identifier bin; '
        + 'name and height not stated; new area buildings original.',
      action: 'Approve layout',
      approveToDraftJobFinishedSeconds: seconds(mark('act1-approve'), last('act1', 'intake-draft')),
      approveToReadyJobFinishedSeconds: seconds(mark('act1-approve'), first('act1', 'intake-run')),
      ready: 1661, skipped: 1, reason: 'INVALID_GEOMETRY: Ring Self-intersection; original unchanged, no repair.',
    },
    register: {
      retainedInBatch: true, tableOpened: true,
      actions: ['Open the table: gpmc-yuvp.csv', 'Read as a table'],
      readPressToTableSeconds: seconds(mark('act1-read-table'), mark('act1-table-page')),
      words: '753 records · 9 columns; Draft; Needs review; tables produce mapped draft rows, not buildings.',
      staleTrayWords: 'No reader in a batch takes this kind of file yet',
    },
    surfaces: {
      mapActions: ['Open package', 'Done', 'Tools → Layers'], mapReloads: 0,
      firstPublishedSecondsFromRetain: {
        tiff: seconds(retain, first('act1', 'raster-window')),
        laz: seconds(retain, first('act1', 'point-batch')),
      },
      firstDrawnWordsObservedBySecondsFromRetain: seconds(retain, observed('a24-evidence-tools')),
      tiffLastPartReadSecondsFromRetain: seconds(retain, last('act1', 'raster-window')),
      lazLastPartReadSecondsFromRetain: null,
      final: surfaceItems.map(row => ({ file: row.name, read: row.partsDone, planned: row.partsPlanned,
        placement: row.placement, words: words(row.limitReason) })),
      mapWords: browser.map.slice(browser.map.indexOf('nyc-10013-lidar'), browser.map.indexOf('Details')).trim(),
      incrementalProof: 'Same open map: LAZ 2 → 6 drawn parts; TIFF 5 → 9. No reload.',
      framesAfterMapOpen: browser.surfaceFrames,
      incomplete: 'Stopped after the structural card failure and remaining acts; full LAZ completion not qualified.',
    },
    evidence: {
      namespace: 'NYC building identification number (bin), as written in both files', kind: 'integer',
      mapField: '/features/*/properties/bin', tableColumn: 'gpmc-yuvp.csv column 0, bin',
      coverageWords: 'Closed: 753 read, 753 with a key, 0 without a key, 0 unread, 0 could not be read.',
      counts: readback.evidence.counts,
      declareToClosedJobSeconds: seconds(mark('act1-key-declare'), first('act1', 'intake-evidence')),
      closedWordsObservedBySeconds: seconds(mark('act1-key-declare'), mark('act1-evidence-observed')),
      acceptAction: 'Accept every exact single match of this file',
      limitWords: 'This file has 612 exact single matches; one confirmation takes 100. '
        + 'Confirm these, then accept the next 100.',
      accepted: 100, confirmations: 1, remainingExactMatches: 512, conflictingRowsAccepted: 0,
      acknowledgement: 'REH11 test_only: I confirm the first 100 exact single BIN matches from the closed '
        + '753-row LPC reading. The 81 conflicting and 60 unmatched rows remain unresolved; '
        + 'no field, right or ownership is asserted.',
      confirmationId: 'f005f62a-3e83-41dd-bc3f-44c76c6c7436',
      confirmToStoredWordsSeconds: seconds(mark('act1-evidence-confirm'), mark('act1-evidence-stored')),
      storedNote: 'Stored with every pin it names. Nothing was written to the registry: the citation step adds '
        + 'accepted rows and parts to recorded buildings under this confirmation.',
    },
    card: {
      target: 'feature 1001960', registerLocator: 'gpmc-yuvp.csv, column bin, row 702',
      confirmationId: readback.confirmation.confirmationId, acknowledgement: readback.confirmation.acknowledgement,
      counts: readback.confirmation.counts, record: readback.confirmation.progress[0].artefacts.record,
      code: 'REGISTRY_SOURCE_UNAVAILABLE', screen: 'Work stopped; the completed steps are kept. '
        + 'A cited source is not currently available.',
      confirmToStoppedJobSeconds: seconds(mark('act1-card-confirm'), last('act1', 'intake-run')),
      stoppedScreenObservedBySeconds: seconds(mark('act1-card-confirm'), observed('a32-card-result')),
      cardId: null, revision: null, quotedRegisterRow: false, excerpt: null, verification: null,
      retry: 'Not pressed: structural refusal. No feature-only fallback substituted for the requested cited card.',
    },
  },
  act2: {
    shortCsv: {
      caseId: state.cases.shortCsv.caseId, input: 'lpc-register-two-records-test_only.csv', bytes: 302,
      finalLF: true, records: 2, columns: 9,
      actions: ['Import as a table', 'Create an unassigned source case', 'Retain table and start mapping'],
      retainToTableSeconds: seconds(mark('act2-short-retain'), mark('act2-short-table')),
      retainToJobsCompleteSeconds: seconds(mark('act2-short-retain'), last('shortCsv', 'chunk-mapping')),
      words: '2 records · 9 columns. Raw rows completed; Field mapping completed. Draft; Needs review. '
        + '0 teacher calls; 7 unanswered; 9 open questions. CASE_ORIGINAL_TEACHER_REFUSED.',
      qualification: 'Case named test_only; the source panel calls this officer_supplied, licence unconfirmed, '
        + 'personal-data state unknown, not a development/evaluation asset. No provider call or training claim.',
    },
    judges: {
      caseId: state.cases.judges.caseId, provenance: 'Team-chosen public foreign test_only files, not unseen.',
      forecast: 'Both ZIP and Markdown: Kind not known yet: will be kept and recognised after upload',
      retainToVisibleUploadingBatchSeconds: seconds(mark('act2-judges-retain'), mark('act2-judges-batch')),
      uploadingWords: 'Retaining files. File 1 of 2: nyc-map-and-report-test_only.zip. '
        + 'Keep this page open while files are sent, one at a time. Metadata_BuildingFootprints.md: Waiting.',
      archive: { words: '2 members. 1 GeoJSON layer, 1 PDF taken out as their own items: '
        + 'buildings-original.geojson, 2537.pdf.',
      retainToFanOutJobCompleteSeconds: seconds(mark('act2-judges-retain'), first('judges', 'intake-zip-layers')) },
      geojsonMember: { layoutAction: 'Approve layout: building, bin; name and height not stated.',
        approveToDraftSeconds: seconds(mark('act2-zip-approve'), last('judges', 'intake-draft')),
        approveToReadySeconds: seconds(mark('act2-zip-approve'), first('judges', 'intake-run')),
        words: 'Read; On the map; 1661 ready to record. One invalid source geometry skipped, unchanged.',
        outcome: 'ready_not_recorded' },
      pdfMember: { retainToCompletedReadSeconds: seconds(mark('act2-judges-retain'), first('judges',
        'document-extraction')), words: '18 pages read. Text was found on pages 1–18. 7 passages on pages '
        + '5–8, 10 and 16 name floors, storeys, levels or rooms: candidates cited to their page and lines, '
        + 'for your review. Nothing is recorded until you confirm it.', outcome: 'read_candidates' },
      unread: { file: 'Metadata_BuildingFootprints.md', words: 'Not understood. Kept (13 KB); '
        + 'its kind was not recognised from its first and last bytes.',
        retainedWordsObservedBySeconds: seconds(mark('act2-judges-retain'), observed('b09-zip-status')),
        outcome: 'kept_not_read' },
      memberHashesUnchanged: true, evidence: 'readback.json: judgeHashes; no originals changed.',
    },
  },
  failures: [
    { step: 'Act 1 carry to cited card', code: 'REGISTRY_SOURCE_UNAVAILABLE',
      words: 'A cited source is not currently available.', status: 'Asynchronous intake-run failed; GET case 200.',
      consequence: '1661 exteriors recorded, selected target stopped at revision 1; no cited card or verification.',
      evidence: 'readback.json; shots/a33-card-stopped.png' },
    { step: 'Act 1 tray words', words: 'No reader in a batch takes this kind of file yet',
      consequence: 'False for this retained CSV: table reading and key evidence both succeeded.' },
    { step: 'Streaming performance', words: 'Observed frames exceed the 100 ms target.',
      consequence: 'Map-open interval worst 183 ms, 2 frames over 100 ms; entire map worst 467 ms.' },
  ],
  frames: browser.frames,
  frameQualification: 'Batch recorder restarted at a15 document navigation; draft-interval frames were lost. '
    + 'Other page metrics include document startup. No claim of zero stalls or a complete draft frame trace.',
  console: { errors: errors.length, duplicateKeyWarnings: errors.filter(row => /same key|same.*key/i.test(row.text))
    .length, pageErrors: log.filter(row => row.kind === 'pageerror').length,
  failedReads: log.filter(row => row.kind === 'api' && row.status >= 400)
    .map(({ page, path, status }) => ({ page, path, status })),
  explanation: 'Two expected pre-profile CSV 422 reads; one event-stream 409. Saved progress continued. '
    + 'Browser closed before intentional API shutdown; no shutdown console errors counted.' },
  harnessQualifications: [
    'Add files is a link, not a button. Work-queue anchors have role row, not link.',
    'The first batch wait used /studio/cases instead of /studio/work/cases; upload itself succeeded.',
    'Exact Key kind label lookup failed twice; switched to the inspected form select. No declaration repeated.',
    'Premature act1-draft-observed mark is excluded: the screenshot still showed Layout prepared.',
    'Short-CSV Continue is disabled; Import as a table is the offered action.',
    'Initial check.mjs failed on wrapped long path arrays; joined path pieces, then 11 reads passed.',
  ],
  runbookCorrections: [
    'Evidence boundary: REH10 files now exist on staging; do not state their receipts are absent.',
    'Act 1 A: reader forecasts and explicit limits appear before upload; batch opens while files are sent.',
    'Act 1 A/D: CSV is retained in the same batch, not held back for Continue with other files.',
    'Act 1 C: Open package → Done → Tools/Layers reveals the drawn surface counts. No reload needed.',
    'Act 1 C: read/placed distinction remains valid, but both surfaces now place against drafted footprints.',
    'Act 1 C: do not reuse REH9 completion times; this LAZ remained partial when rehearsal stopped.',
    'Act 1 D: Open the table → Read as a table opens 753 rows without selecting a separate case.',
    'Act 1 D: Link a register by a key → namespace/integer/map BIN/table BIN → Declare the key; '
      + 'wait for Closed coverage, then confirm. First 100 exact matches only per confirmation.',
    'Act 1 E: matched feature 1001960 stopped on unavailable cited source; cited card/QR success is not proved.',
    'Act 1 E: ready and recorded counts were both 1661, not the unexplained REH9 1661/1660 difference.',
    'Act 2: alone, a CSV uses Import as a table, not the multi-file Retain files dialog.',
    'Act 2: this mixed ZIP fans out unchanged GeoJSON/PDF members; PDF read all 18 pages, not kept unread.',
    'Preflight: current demo doctor is 28 PASS with gateway enabled; health is not a live-answer receipt.',
  ],
  journey: { commandReceipt: 'journey-final-command.json', exit: 0, summary: journey.summary,
    requests: journey.requests,
    steps: journey.steps.map(({ id, state, observed, ms }) => ({ id, state, observed, ms })),
    transport: { requests: transports.length, allGET: transports.every(row => row.method === 'GET'),
      onlyTarget: transports.every(row => row.target === 'http://127.0.0.1:21026'),
      caveat: 'run.ts hardcodes 3194 and has no API flag. journey-target.cjs redirects GETs to 21026 '
        + 'before network access; command JSON API label remains 3194. No request reached demo.',
      raw: `${scratch}/journey-transport-*.json` },
    qualification: 'Exit 0 includes skipped card and citation checks; not a completed card/identity gate.' },
  demo: { beforeExit: before.baseline.doctor.exit, afterExit: after.doctor.exit,
    commit: after.commit, unchanged: after.matchesBaseline,
    processIdsBefore: before.baseline.machine.processes.map(row => row.pid),
    processIdsAfter: after.machine.processes.map(row => row.pid),
    doctor: '28 PASS, 0 FAIL both times; no restart, roll, recovery or provider call.' },
  end: { runtime: 'Stopped; six containers exited, records and all volumes preserved.',
    exit: end.receipt.exit, seconds: end.receipt.seconds, studioStopped: true, browserClosedBeforeStop: true,
    volumesUnchanged: JSON.stringify(before.state.volumes) === JSON.stringify(end.state.volumes) },
  scratch, videos: readdirSync(`${scratch}/video`)
    .map(name => ({ name, bytes: statSync(`${scratch}/video/${name}`).size })),
  verdict: 'NO: 065a323f opens the table, confirms exact-key evidence and draws surfaces, '
    + 'but the matched building stops with REGISTRY_SOURCE_UNAVAILABLE before its cited card.',
};
save('result.json', result);
console.log(result.verdict);
