import { readFileSync, readdirSync, statSync } from 'node:fs';
import { evidence, safe, save } from './audit.mjs';

// Assemble the measured receipts; no runtime access or writes to the application.
const scratch = 'E:/BhuAayam-data/task-data/reh10';
const resumed = `${scratch}/resume-20261022`;
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const receipt = name => json(`${evidence}/${name}.json`);
const log = root => readFileSync(`${root}/dress-log.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
const original = log(scratch);
const current = log(resumed);
const snapshot = json(`${resumed}/final-browser.json`);
const readback = receipt('readback');
const end = current.find(row => row.label === 'resume-browser-finished').at;
const seconds = (from, to) => Number(((to - from) / 1000).toFixed(3));
const originalResult = step => JSON.parse(original.find(row => row.kind === 'result' && row.step === step).value);
const final = receipt('demo-resume-after');
const before = receipt('demo-resume-before');
const card = readback.card;
const firstFrames = originalResult('a1-bo-approve');

function browserErrors(rows, from = 0, to = Infinity) {
  const within = rows.filter(row => row.at >= from && row.at <= to);
  const errors = within.filter(row => row.kind === 'console-error');
  return { consoleErrors: errors.length,
    duplicateKeyWarnings: errors.filter(row => /same key|unique.*key/i.test(row.text)).length,
    pageErrors: within.filter(row => row.kind === 'pageerror').length };
}

function roll() {
  const names = ['b0-stop', 'b1-checkout', 'b1-install', 'b2-document-runtime', 'b3-start', 'b3-doctor'];
  return names.map(step => {
    const { receipt: value } = receipt(`step-${step}`);
    return { step, exit: value.exit, seconds: value.seconds };
  });
}

const keyJob = snapshot.jobs.find(job => job.operation === 'intake-evidence');
const cardTarget = snapshot.confirmation.value.progress[0];
const retained = snapshot.marks['resume-a1-retain'];
const tableRetained = snapshot.marks['resume-act2-retain'];
const tableProfile = current.find(row => row.kind === 'api' && row.page === 'page-2'
  && row.at >= tableRetained && row.path.endsWith('/profile'));
const result = {
  task: 'REH10', gates: ['GF5', 'GF4', 'GF1'], servedCommit: '58559aa35f66289e0184a5c26e76a12004774c0f',
  runtime: 'ulpin-reh-02', runtimeNotEmpty: true, pinUnchanged: true, schemaUnchanged: true,
  roll: roll(), resume: { start: receipt('resume-start').seconds, doctor: '28 PASS, 0 FAIL; gateway disabled' },
  inputVerification: 'act1-files.json and act2-files.json; every byte count and source hash matched',
  retrospective: {
    source: 'Stopped-run screenshots, dress-log.jsonl and product readback; not re-observed live during that drop.',
    caseId: '077acb5d-bf9f-4cec-93f3-44ed5a3cd3f0',
    dropToDialogSeconds: 0.028, retainToBatchSeconds: 2.083,
    layout: 'Remembered: a building; identifier bin; name and height not stated; new area buildings original.',
    approveToDraftObservedSeconds: 23.385,
    surfaceState: 'Both first parts planned, no job; no surface drawn. Register retained as a batch item.',
    key: 'The stopped run had already declared the integer BIN key; its job failed STREAMING_ORIGINAL_REQUIRED.',
    errors: browserErrors(original), frames: { batch: firstFrames.framesBatch, map: firstFrames.framesMap },
    frameCaveat: 'Original map opened the old HDB area, not the new NYC area; its 667 ms worst is not an SF1 test.',
  },
  act1: {
    caseId: '76f1cdb3-1407-40b4-b9a2-20cea1c53380',
    reasonForNewCase: 'Old evidence job failed and surface parts had no job after restart; old case preserved.',
    boundedComparison: {
      hypothesis: 'A fresh case removes stopped-run context as the cause of stalled reading.',
      baseline: 'Old case: failed evidence job, 0 surface parts read.',
      success: 'Fresh drop drafts footprints, starts both surface readers and closes evidence.',
      outcome: 'Same surface stall and evidence failure; no further retry and no product changes.',
    },
    retainToBatchSeconds: seconds(retained, snapshot.marks['resume-a1-batch']),
    layoutApproval: 'Approve layout as proposed: building, bin; name and height not stated.',
    approveToDraftFinishedSeconds: seconds(snapshot.marks['resume-a1-layout-approve'],
      Date.parse(snapshot.jobs.find(job => job.operation === 'intake-draft').completedAt)),
    register: { retainedInBatch: true, tableOpened: false,
      screen: 'CSV item has no Next step button, row selection or Read as a table action in a multi-file batch.' },
    surfaces: { observedForSeconds: seconds(retained, snapshot.at), firstDrawnSeconds: null,
      lastPartSeconds: null, partsRead: 0, placed: false, openMapReloaded: false,
      screen: 'Display only. The first part waits for its reader; its coordinate system and size are not read yet.',
      framesWhileDrawingSurfaces: null },
    evidence: { namespace: 'NYC building identification number (bin), as written in both files',
      kind: 'integer', mapField: 'buildings-original.geojson: /features/*/properties/bin',
      tableColumn: 'gpmc-yuvp.csv: column 0 bin',
      jobSeconds: seconds(Date.parse(keyJob.createdAt), Date.parse(keyJob.completedAt)),
      jobError: keyJob.error, coverage: readback.evidence.coverage, counts: readback.evidence.counts,
      acceptScreen: 'This file has no exact single match under this key.',
      acknowledgement: 'REH10 test_only: no row was read or matched. I accept no register citation; '
        + 'the key read has not closed.',
      confirmPresses: 1, storedConfirmations: 0, storedNote: null,
      refusal: 'gpmc-yuvp.csv can be confirmed when its reading closes. '
        + 'Exclude it with your reason to confirm this key without it.',
      hundredPerConfirmation: 'Not exercised: no matches were read; no exclusion used to pretend success.' },
    fallbackCard: { qualification: 'Feature-only fallback, NOT a matched-evidence card.',
      target: card.target, record: card.record, card: card.card, confirmationId: card.confirmationId,
      acknowledgement: card.acknowledgement, counts: card.counts,
      confirmToStoredCardSeconds: seconds(snapshot.marks['feature 1001601'], Date.parse(cardTarget.updatedAt)),
      confirmToCardObservedSeconds: seconds(snapshot.marks['feature 1001601'],
        snapshot.marks['resume-a1-card-observed']),
      pdfBytes: 6897, verificationSeconds: 1.142,
      verification: 'Consistent: 6 of 6 checks passed; signature not assessed (NO_TRUSTED_KEY_POLICY).',
      citation: 'buildings-original.geojson, feature 1001601', registerRowQuoted: false, registerExcerpt: null },
    errors: browserErrors(current, 0, end), frames: snapshot.frames,
  },
  act2: { caseId: readback.act2.caseId, file: 'lpc-register-two-records-test_only.csv',
    provenance: 'Header and first two records of the retained LPC register, byte-for-byte prefix, final LF.',
    bytes: 302, records: 2, columns: 9, outcome: 'table',
    retainToFirstProfileSeconds: seconds(tableRetained, tableProfile.at),
    completeObservedBySeconds: 60.081,
    timingCaveat: '60 s is an observation bound: the browser wait used the wrong table URL pattern, '
      + 'not a service time.',
    screen: '2 records · 9 columns; Raw rows completed; Field mapping completed; 0 teacher calls.',
    limitation: 'Mapping stays candidate/needs review; licence unconfirmed and personal-data state unknown.' },
  breaks: [
    { step: '2: register table action', code: null, route: 'none: no selection action', status: null,
      words: 'No Next step action on gpmc-yuvp.csv; Read as a table section is unreachable.',
      evidence: 'shots/r03-fresh-batch.png; r18-card-choice; IntakeTray.tsx:45-64' },
    { step: '2: surface readers', code: null, route: 'GET /ingestion/cases/:caseId/intake/items/:itemId/parts',
      status: 200,
      words: 'The first part waits for its reader; its coordinate system and size are not read yet.',
      evidence: 'readback.json: parts; shots/r10-map-tools.png; both old and fresh case' },
    { step: '2: evidence reading and confirmation', code: 'STREAMING_ORIGINAL_REQUIRED',
      route: 'GET /cases/:caseId: failed intake-evidence job; confirmation stopped by client', status: 200,
      words: 'Job failed; UI remains Partial: 0 read. No stored confirmation or note.',
      evidence: 'readback.json; shots/r11-confirm-refused.png' },
    { step: '2: cited register row on card', code: null,
      route: 'GET /usp/property-cards/:cardId/revisions/1', status: 200,
      words: 'Fallback card quotes only its footprint feature; no register row or excerpt.',
      evidence: 'card-act1-feature-only.pdf and .txt in scratch; shots/r23-verification.png' },
  ],
  needsCode: [
    { file: 'apps/studio/src/features/intake/IntakeTray.tsx:45-64',
      action: 'Expose table item selection so BatchTableSection can render in a multi-file batch.' },
    { file: 'packages/server/src/modules/usp/ingestion/intake-evidence-worker.ts:40-45',
      action: 'retained() calls readObject on a kept large-originals key; storage.ts:52 refuses it, even at 85 KB.' },
    { file: 'packages/server/src/modules/usp/ingestion/intake-surface.ts:242-266',
      action: 'Diagnose admission: first planned parts never acquired jobs; root cause not proven without logs.' },
    { file: 'packages/server/src/modules/usp/ingestion/intake-evidence-worker.ts:291-320',
      action: 'Make the read expose the failed job instead of leaving unexplained partial coverage.' },
  ],
  console: { original: browserErrors(original), resumedBeforeShutdown: browserErrors(current, 0, end),
    resumedAfterShutdown: browserErrors(current, end + 1),
    note: '3 pre-shutdown console errors total: one old-map context 422 and two unread-table profile 422s; '
      + '0 key warnings.',
    shutdownNote: '24 additional resource errors while browser video closure overlapped intentional API stop.' },
  demo: { commit: final.commit, doctorBeforeExit: before.doctor.exit, doctorAfterExit: final.doctor.exit,
    matchesResumeBaseline: final.matchesResumeBaseline, processIdsBefore: before.machine.processes,
    processIdsAfter: final.machine.processes,
    limitation: 'Already down on resume: 23 PASS, 5 FAIL, health unavailable; same before and after. Not recovered.',
    stoppedRunDifference: 'Commit and container IDs unchanged; stopped-run native PIDs 33352/33728 now absent.',
    guard: 'Read only; state and watch ledger already reported start_limit_reached; no guard change.' },
  end: { runtime: 'stopped; six containers exited, no native runtime processes; all records and volumes kept',
    stopSeconds: receipt('resume-stop').receipt.seconds, studioStopped: receipt('studio-stop').exit === 0,
    schemaAndHashChecks: 'check.json: exit 0; nine product reads, response schemas and original hashes passed' },
  scratch: [scratch, resumed],
  videos: readdirSync(`${resumed}/video`).map(name => ({ name, bytes: statSync(`${resumed}/video/${name}`).size })),
  verdict: 'NO: do not roll the demo to 58559aa3; table selection, evidence reading and surface admission '
    + 'block the show.',
};
save('result.json', JSON.parse(safe(JSON.stringify(result))));
console.log(result.verdict);
