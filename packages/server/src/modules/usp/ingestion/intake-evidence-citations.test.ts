import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import type { PoolClient } from 'pg';
import type { RegistryRecord, RegistryTableRowCitation } from '@ulpin/contracts';
import { UspPropertyCardFactSchema, type IntakeEvidenceAnchor, type IntakeEvidenceCandidate, type IntakeEvidenceConfirm,
  type IntakeTableRowLocator, type TableWindowRow, type TabularSelection } from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';
import { sha256, type readObjectRange } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import type { ConfirmedEvidence } from '../../registry/registry-document-evidence';
import { assertRegistryTableCitationsTx, citedRowTx, onceTableReads, tableRowCitation, tableRowExcerpt,
  wholeTableRow, type CitedRow, type TableEvidenceDependencies } from '../../registry/registry-table-evidence';
import { CONTROL_SHEET, controlWorkbook } from '../../../../../../tests/fixtures/xlsx-control';
import { evidenceCardValue, evidenceCitationBindings, evidenceExcerptTx,
  evidenceRange } from '../packets/plan-citation-authority';
import { writeEvidenceCitations, type EvidenceCitationSteps } from './intake-evidence-citations';
import { closeEvidence, evidenceAnchor, evidenceLinkManifest, evidenceReceiptKey, tableAssertions,
  windowAssertions } from './intake-evidence';
import { stableUuid } from './intake-run';
import { windowRows } from './table-windows';
import { readTabularSource } from './tabular-source';
import { readTableWindows, readTabularWindows } from './tabular-stream';

// Real public NYC inputs (test_only, foreign geography): DOITT building footprints and the LPC landmark register
// for the same blocks, which share the building identification number (BIN) as written.
const buildingsPath = 'E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson';
const registerPath = 'E:/BhuAayam-data/datasets/nyc-10013-linked/nyc-landmarks-preservation-commission/gpmc-yuvp.csv';
const skip = [buildingsPath, registerPath].some(path => !existsSync(path)) && 'the data drive inputs are not present';
process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'au4-b3-protocol-operator';
const csv: TabularSelection = { format: 'csv', sheet: 'csv', table: null, headerRows: [1] };
// Pins the stores would hold; derived here from the real bytes, never stored as data.
const ids = (name: string) => stableUuid(`test_only:intake-evidence-citations:${name}`);
const caseId = ids('case'), profileId = ids('profile'), profileSha256 = fingerprint('test_only:profile');
const key = { profileId, profileSha256, namespace: 'NYC building identification number', kind: 'integer' as const };
const register = ids('register'), sourceId = ids('source:register'), accessSha256 = fingerprint('test_only:access');
const result = fingerprint('test_only:result'), review = fingerprint('test_only:review');

function anchorsOf(bytes: Buffer): IntakeEvidenceAnchor[] {
  const source = { id: ids('buildings'), revision: 1, sha256: sha256(bytes) };
  const features = JSON.parse(bytes.toString('utf8')).features as { properties: Record<string, unknown> }[];
  return features.flatMap((feature, index) => {
    const anchor = evidenceAnchor({ targetId: ids(`target:${index}`), anchorItemId: ids('map'),
      packageId: ids('package'), packageRevision: 1, locator: `feature ${index}` },
    { id: ids(`feature:${index}`), properties: feature.properties }, source, '/features/*/properties/bin', 'integer');
    return anchor ? [anchor] : [];
  });
}

/** The register read as the evidence job reads it, closed against the footprints' BINs. */
function realInputs() {
  const bytes = readFileSync(registerPath), table = readTabularSource(bytes, csv);
  const column = table.headers.indexOf('bin');
  const reading = tableAssertions(table, column, 'integer', (index, cells, literal) => ({
    kind: 'table_row', itemId: register, caseId, sourceId, sourceRevision: 1, sourceSha256: sha256(bytes),
    rawJobId: ids('job:register'), rawInputSha256: fingerprint('test_only:input'), rawResultSha256: fingerprint(table),
    acceptedFence: 1, selection: csv, sourceRow: table.sourceRows[index], rowSha256: fingerprint(cells),
    columnIndex: column, columnHeader: 'bin', cell: { state: 'literal', value: literal } }));
  const candidates = closeEvidence({ caseId, key, anchors: anchorsOf(readFileSync(buildingsPath)),
    createdAt: '2026-10-21T00:00:00.000Z', ...reading });
  return { bytes, table, coverage: reading.coverage, candidates };
}
type Inputs = Pick<ReturnType<typeof realInputs>, 'bytes' | 'coverage' | 'candidates'>;

/** The same register as the stream stores it (one window; the reader closes a window at 10,000 records), each
 * row's locator citing its window, byte range and range hash as the evidence job writes it. */
async function streamedInputs() {
  const bytes = readFileSync(registerPath), table = readTabularSource(bytes, csv);
  const column = table.headers.indexOf('bin'), rows: TableWindowRow[] = [];
  let stored = { index: -1, sha256: '', byteStart: 0, byteEnd: 0 };
  await readTabularWindows(Readable.from([bytes]), async (window, headers) => {
    rows.push(...windowRows(window, headers));
    stored = { index: window.index, sha256: window.sha256, byteStart: window.byteStart, byteEnd: window.byteEnd };
  });
  const assertions = windowAssertions(rows, column, 'integer', (row, cells, literal) => ({
    kind: 'table_row', itemId: register, caseId, sourceId, sourceRevision: 1, sourceSha256: sha256(bytes),
    rawJobId: ids('job:stream'), rawInputSha256: fingerprint('test_only:stream'), rawResultSha256: stored.sha256,
    acceptedFence: 1, selection: csv, sourceRow: row.sourceRow, rowSha256: fingerprint(cells), columnIndex: column,
    columnHeader: 'bin', cell: { state: 'literal', value: literal },
    window: { index: stored.index, record: row.record, byteStart: row.byteStart, byteEnd: row.byteEnd,
      sha256: row.sha256 } }));
  const coverage = { state: 'closed' as const, read: rows.length, eligible: assertions.length,
    keyless: rows.length - assertions.length, unread: 0, failed: 0 };
  const candidates = closeEvidence({ caseId, key, anchors: anchorsOf(readFileSync(buildingsPath)),
    createdAt: '2026-10-21T00:00:00.000Z', assertions, coverage });
  return { bytes, table, coverage, candidates, stored };
}

/** The officer's stored confirmation accepting one candidate for its first building. */
function confirmationOf(inputs: Inputs, candidate: IntakeEvidenceCandidate) {
  const decisions = [{ decision: 'accept' as const, candidateId: candidate.candidateId,
    candidateSha256: candidate.candidateSha256, targetId: candidate.anchors[0].targetId,
    evidence: candidate.evidence }];
  const pins: IntakeEvidenceConfirm = { requestKey: ids('confirm'), acknowledgement: 'Checked the register row.',
    profileId, profileSha256, excluded: [], included: [{ itemId: register, sourceId, sourceRevision: 1,
      sourceSha256: sha256(inputs.bytes), bytes: inputs.bytes.length, jobId: ids('job:reading'), resultSha256: result,
      coverage: inputs.coverage }],
    targets: [{ targetId: candidate.anchors[0].targetId, packageId: ids('package'), packageRevision: 1,
      reviewFingerprint: review }],
    additions: { kind: 'citations', linkManifestSha256: evidenceLinkManifest(decisions), decisions } };
  return { confirmation_id: ids(`confirmation:${candidate.candidateId}`), pins,
    acknowledgement: pins.acknowledgement, expires_at: new Date(Date.now() + 3_600_000) };
}

/** The whole register row read again from the real bytes, as the registry reads it. */
const wholeRow = (inputs: Inputs) => async (row: IntakeTableRowLocator): Promise<CitedRow> =>
  ({ excerpt: wholeTableRow(row, inputs.bytes), accessSha256 });

/** A store answering exactly the writer's SQL, and fake registry steps that count what they would write; `cite`
 * reads each confirmed row again as the registry amend does. */
function writerStore(inputs: Inputs, candidate: IntakeEvidenceCandidate, cite = wholeRow(inputs)) {
  const confirmation = confirmationOf(inputs, candidate), targetId = candidate.anchors[0].targetId;
  const record = { id: ids('record'), revision: 1 };
  const store = { packageRevision: 1, sourceSha256: sha256(inputs.bytes), receipts: new Map<string, unknown>(),
    artefacts: [] as unknown[], drafts: 0, commits: 0, citations: [] as RegistryTableRowCitation[], requestKey: '' };
  const answers: [string, (values: any[]) => unknown[]][] = [
    ['SELECT confirmation_id,pins', values =>
      store.receipts.has(evidenceReceiptKey(confirmation.confirmation_id, values[3])) ? [] : [confirmation]],
    ['SELECT profile_sha256', () => [{ profile_sha256: profileSha256 }]],
    ['SELECT i.item_id', () => [{ item_id: register, id: sourceId, revision: 1, sha256: store.sourceSha256,
      bytes: String(inputs.bytes.length), latest: true }]],
    ['SELECT * FROM usp_intake_evidence_coverage', () => [{ item_id: register, job_id: ids('job:reading'),
      result_sha256: result, state: 'closed', read_count: String(inputs.coverage.read),
      eligible_count: String(inputs.coverage.eligible), keyless_count: String(inputs.coverage.keyless),
      unread_count: '0', failed_count: '0' }]],
    ['SELECT t.target_id', () => [{ target_id: targetId, package_id: ids('package'), revision: store.packageRevision,
      review, committed: null }]],
    ['SELECT candidate_id,item_id', () => [{ candidate_id: candidate.candidateId, item_id: register,
      candidate_sha256: candidate.candidateSha256, target_ids: candidate.anchors.map(anchor => anchor.targetId),
      outcome: candidate.outcome, evidence: candidate.evidence }]],
    ['SELECT candidate_id,candidate', () => [{ candidate_id: candidate.candidateId, key: candidate.key }]],
    ['SELECT site_id FROM registry_records', () => [{ site_id: ids('site') }]],
    ['SELECT request_key FROM registry_drafts', () => [{ request_key: store.requestKey }]],
    ['SELECT revision FROM registry_sites', () => [{ revision: 7 }]],
    ['INSERT INTO operations', values => { store.receipts.set(values[1], values[4]); return []; }],
    ['UPDATE usp_intake_targets SET stage=', values => {
      store.artefacts.push(values[4]);
      return [{ case_id: caseId, target_id: values[0], readiness: values[2], stage: values[1] }];
    }],
    ['UPDATE usp_outbox_streams', () => [{ sequence: '1' }]],
    ['INSERT INTO usp_outbox', () => []],
    ['SELECT revision FROM cases', () => [{ revision: 0 }]],
  ];
  const client = { query: async (sql: string, values: unknown[] = []) => {
    const text = sql.replace(/\s+/g, ' ');
    const answer = answers.find(([start]) => text.startsWith(start));
    assert(answer, `Unexpected query: ${text}`);
    return { rows: answer[1](values) };
  } } as unknown as PoolClient;
  const target = { recordId: record.id, revision: record.revision, bodySha256: fingerprint('test_only:body') };
  const steps = {
    draft: async (_client: PoolClient, _site: string, recordId: string, _body: unknown, requestKey: string) => {
      store.drafts++;
      store.requestKey = requestKey;
      return { id: ids('draft'), records: [{ id: recordId, revision: record.revision }] };
    },
    amend: async (_client: PoolClient, _draftId: string, confirmed: ConfirmedEvidence[]) => {
      store.citations = await Promise.all(confirmed.map(async item => {
        const row = item.evidence as IntakeTableRowLocator;
        return tableRowCitation({ row, key: item.key, confirmation: item.confirmation }, await cite(row), target,
          'test_only:officer');
      }));
      return { draftRevision: 2, record: { documentCitations: store.citations } as unknown as RegistryRecord };
    },
    review: async () => ({ id: ids('review') }),
    commit: async () => { store.commits++; },
  } as unknown as EvidenceCitationSteps;
  const write = () => writeEvidenceCitations(work => work(client), { targetId, caseId, record }, steps);
  return { store, write };
}

const matchedOf = (inputs: Inputs) => inputs.candidates.find(candidate => candidate.outcome === 'matched')!;
const refusedWith = (code: string, words?: RegExp) => (error: unknown) =>
  error instanceof AppError && error.code === code && (!words || words.test(error.message));

test('a matched register row is written once as a citation; a replay writes nothing', { skip }, async () => {
  const inputs = realInputs(), matched = matchedOf(inputs);
  const { store, write } = writerStore(inputs, matched);
  const written = await write();
  assert.deepEqual(written?.record, { id: ids('record'), revision: 2 }, 'the snapshot pins the cited revision');
  assert.deepEqual(store.artefacts, [{ evidence: written }]);
  assert.equal(store.receipts.size, 1);
  assert.equal(await write(), null, 'a replay finds the receipt and writes nothing');
  assert.deepEqual([store.drafts, store.commits, store.receipts.size], [1, 1, 1]);
  const [citation] = store.citations;
  assert.equal(citation.row.cell.value, matched.key.literal, 'the cited cell holds the key literal as written');
  assert.deepEqual(citation.row, matched.evidence);
});

test('the citation quotes its row exactly, is checked against the original, and the card line keeps it', { skip },
  async () => {
    const inputs = realInputs(), { store, write } = writerStore(inputs, matchedOf(inputs));
    await write();
    const [citation] = store.citations;
    // Independent of the reader: the register line as written (every field quoted), split at its separators.
    const line = inputs.bytes.toString('utf8').split(/\r?\n/)[citation.row.sourceRow - 1];
    const values = line.slice(1, -1).split('","');
    assert.equal(citation.excerpt, inputs.table.headers.flatMap((header, index) =>
      values[index] ? [`${header}: ${values[index]}`] : []).join('\n'));
    const job = { query: async () => ({ rows: [{ accepted_fence: 1 }] }) } as unknown as PoolClient;
    const source = (async () => ({ case_id: caseId, revision: 1, sha256: sha256(inputs.bytes),
      object_key: 'test_only:register', bytes: inputs.bytes.length, accessSha256 })) as any;
    await assertRegistryTableCitationsTx(job, ids('site'), [citation], { source, bytes: async () => inputs.bytes });
    // test_only: one byte of the cited row changed in the retained original.
    const changed = Buffer.from(inputs.bytes);
    changed[changed.indexOf(Buffer.from(line)) + 1] ^= 1;
    await assert.rejects(assertRegistryTableCitationsTx(job, ids('site'), [citation],
      { source, bytes: async () => changed }), /differs from its pins/);
    const [cited] = evidenceCitationBindings({ documentCitations: [citation] });
    assert.equal(cited.locator, `CSV logical row ${citation.row.sourceRow}`);
    const original = { object_key: 'test_only:register', bytes: inputs.bytes.length };
    assert.equal(await evidenceExcerptTx(job, cited, original, { whole: inputs.bytes }), citation.excerpt);
    // test_only: a stored excerpt one space longer than the row.
    const longer = { ...citation, excerpt: `${citation.excerpt} ` };
    await assert.rejects(evidenceExcerptTx(job, { ...cited, citation: longer }, original, { whole: inputs.bytes }),
      /excerpt changed/);
    const value = evidenceCardValue(cited.excerpt, 'gpmc-yuvp.csv', cited.locator);
    UspPropertyCardFactSchema.parse({ key: 'evidence_citation_1', label: 'Confirmed evidence', state: 'available',
      value, reasonCode: null });
    const tail = ` (gpmc-yuvp.csv, ${cited.locator}). Evidence confirmed by the officer by an exact key; it states no `
      + 'right or owner.';
    assert(value.endsWith(tail));
    assert.equal(JSON.parse(value.slice(0, -tail.length)), citation.excerpt, 'the excerpt reads back exactly');
  });

test('a stale pin refuses the write before any draft', { skip }, async () => {
  const inputs = realInputs();
  for (const change of [{ packageRevision: 3 }, { sourceSha256: fingerprint('test_only:newer') }]) {
    const { store, write } = writerStore(inputs, matchedOf(inputs));
    Object.assign(store, change);
    await assert.rejects(write(), refusedWith('INTAKE_EVIDENCE_STALE'), JSON.stringify(change));
    assert.deepEqual([store.drafts, store.commits, store.receipts.size], [0, 0, 0]);
  }
});

test('a conflicting candidate is never written: the write is refused in words', { skip }, async () => {
  const inputs = realInputs();
  const conflicting = inputs.candidates.find(candidate => candidate.key.literal === '1002123')!;
  assert.equal(conflicting.outcome, 'conflicting');
  const { store, write } = writerStore(inputs, conflicting);
  await assert.rejects(write(), refusedWith('INTAKE_EVIDENCE_NOT_MATCHED', /only a matched candidate/));
  assert.deepEqual([store.drafts, store.commits, store.receipts.size], [0, 0, 0]);
});

test('a streamed register row is cited once and its excerpt is read again from its byte range alone', { skip },
  async () => {
    const inputs = await streamedInputs(), matched = matchedOf(inputs);
    const row = matched.evidence as IntakeTableRowLocator, window = row.window!;
    assert.equal(window.sha256, sha256(inputs.bytes.subarray(window.byteStart, window.byteEnd)));
    const reads: number[][] = [];
    const range = (async (_key: string, start: number, end: number) => {
      reads.push([start, end]);
      return inputs.bytes.subarray(start, end);
    }) as typeof readObjectRange;
    const source = (async () => ({ case_id: caseId, revision: 1, sha256: sha256(inputs.bytes),
      object_key: 'test_only:register', bytes: inputs.bytes.length, accessSha256,
      inspection: { manualProfile: { headers: inputs.table.headers } } })) as any;
    const deps: TableEvidenceDependencies = { source, range,
      bytes: async () => assert.fail('a streamed row never reads its original whole') };
    const { stored } = inputs, windows = { query: async (sql: string) => {
      assert.match(sql, /FROM usp_table_windows/);
      return { rows: [{ fence: 1, window_sha256: stored.sha256, byte_start: stored.byteStart,
        byte_end: stored.byteEnd }] };
    } } as unknown as PoolClient;
    const { store, write } = writerStore(inputs, matched, cited => citedRowTx(windows, ids('site'), cited, deps));
    await write();
    assert.equal(await write(), null, 'a replay finds the receipt and writes nothing');
    assert.deepEqual([store.drafts, store.commits, store.receipts.size, store.citations.length], [1, 1, 1, 1]);
    const [citation] = store.citations, index = inputs.table.sourceRows.indexOf(row.sourceRow);
    assert.deepEqual(citation.row, row);
    assert.equal(citation.excerpt, tableRowExcerpt(inputs.table, index, row.columnIndex),
      'the range gives the excerpt the whole read gives');
    await assertRegistryTableCitationsTx(windows, ids('site'), [citation], deps);
    const [cited] = evidenceCitationBindings({ documentCitations: [citation] });
    assert.deepEqual(evidenceRange(cited), { byteStart: window.byteStart, byteEnd: window.byteEnd });
    const original = { object_key: 'test_only:register', bytes: inputs.bytes.length,
      inspection: { manualProfile: { headers: inputs.table.headers } } };
    assert.equal(await evidenceExcerptTx(windows, cited, original, { table: { range } }), citation.excerpt);
    assert.deepEqual(reads, Array(3).fill([window.byteStart, window.byteEnd]), 'only the range of the row is read');
    // test_only: one byte of the cited range changed in the retained original.
    const changed = Buffer.from(inputs.bytes);
    changed[window.byteStart + 1] ^= 1;
    const changedRange = (async (_key: string, start: number, end: number) =>
      changed.subarray(start, end)) as typeof readObjectRange;
    await assert.rejects(evidenceExcerptTx(windows, cited, original, { table: { range: changedRange } }),
      /differs from its window/);
  });

// The native workbook reader runs in the geo interpreter the deployment names; here a test folder outside the repo.
const geoPython = 'E:/BhuAayam-data/ml/venv-k3a-geo/Scripts/python.exe';
const python = !existsSync(process.env.ULPIN_PROFILE_PYTHON ?? geoPython) && 'needs ULPIN_PROFILE_PYTHON';
const xlsx: TabularSelection = { format: 'xlsx', sheet: 'Register', table: null, headerRows: [2] };

/** test_only: XW1's generated control workbook read by the real stream reader into one stored window, keyed by its
 * Area column; two buildings hold the areas of records 0 and 1. Each row's locator cites the sheet's stored bytes,
 * the sheet and the physical row, as the evidence job writes it. */
async function workbookInputs() {
  process.env.ULPIN_PROFILE_PYTHON ??= geoPython;
  process.env.ULPIN_DOCUMENT_OCR_SCRATCH ??= join(tmpdir(), 'ulpin-table-scratch-citations');
  const control = controlWorkbook(30), bytes = control.bytes, rows: TableWindowRow[] = [];
  let headers: string[] = [], windowSha256 = '';
  await readTableWindows(Readable.from([bytes]), { selection: xlsx, bytes: bytes.length }, async (window, names) => {
    rows.push(...windowRows(window, names));
    [headers, windowSha256] = [names, window.sha256];
  });
  const column = headers.indexOf('Area');
  const assertions = windowAssertions(rows, column, 'integer', (row, cells, literal) => ({
    kind: 'table_row', itemId: register, caseId, sourceId, sourceRevision: 1, sourceSha256: sha256(bytes),
    rawJobId: ids('job:workbook'), rawInputSha256: fingerprint('test_only:workbook'), rawResultSha256: windowSha256,
    acceptedFence: 1, selection: xlsx, sourceRow: row.sourceRow, rowSha256: fingerprint(cells), columnIndex: column,
    columnHeader: 'Area', cell: { state: 'literal', value: literal },
    window: { index: 0, record: row.record, byteStart: row.byteStart, byteEnd: row.byteEnd, sha256: row.sha256,
      sheet: row.sheet, physicalRow: row.sourceRow, sheetSha256: row.sheetSha256 } }));
  const source = { id: ids('buildings'), revision: 1, sha256: fingerprint('test_only:buildings') };
  const anchors = [0, 1].map(record => evidenceAnchor({ targetId: ids(`target:${record}`), anchorItemId: ids('map'),
    packageId: ids('package'), packageRevision: 1, locator: `feature ${record}` },
  { id: ids(`feature:${record}`), properties: { area: rows[record].cells[column] } }, source,
  '/features/*/properties/area', 'integer')!);
  const coverage = { state: 'closed' as const, read: rows.length, eligible: assertions.length,
    keyless: rows.length - assertions.length, unread: 0, failed: 0 };
  const candidates = closeEvidence({ caseId, key, anchors, createdAt: '2026-10-21T00:00:00.000Z', assertions,
    coverage });
  const stored = { fence: 1, window_sha256: windowSha256, byte_start: rows[0].byteStart, byte_end: rows[0].byteEnd,
    window_index: 0, first_record: 0, records: rows.length, rows };
  return { bytes, headers, coverage, candidates, stored, control };
}

/** A store of the one stored window, answering the stored-window check and readTableWindowTx. */
function windowStore(stored: Awaited<ReturnType<typeof workbookInputs>>['stored']) {
  return { query: async (sql: string) => {
    assert.match(sql, /FROM usp_table_windows/);
    return { rows: [stored] };
  } } as unknown as PoolClient;
}

test('a streamed workbook row is cited from its stored window once its sheet\'s stored bytes are proven unchanged; '
  + 'two rows of one sheet read it once', { skip: python }, async () => {
  const inputs = await workbookInputs(), { bytes, stored, control } = inputs;
  const [first, second] = [0, 1].map(record => inputs.candidates.find(candidate => candidate.outcome === 'matched'
    && (candidate.evidence as IntakeTableRowLocator).window!.record === record)!);
  const [byteStart, byteEnd] = control.ranges.get(CONTROL_SHEET)!;
  const reads: number[][] = [];
  const range = (async (_key: string, start: number, end: number) => {
    reads.push([start, end]);
    return bytes.subarray(start, end);
  }) as typeof readObjectRange;
  const source = (async () => ({ case_id: caseId, revision: 1, sha256: sha256(bytes), object_key: 'test_only:book',
    bytes: bytes.length, accessSha256, inspection: { manualProfile: { headers: inputs.headers } } })) as any;
  const deps: TableEvidenceDependencies = { source, range,
    bytes: async () => assert.fail('a streamed workbook row never reads its original whole') };
  const windows = windowStore(stored);
  const { store, write } = writerStore(inputs, first, cited => citedRowTx(windows, ids('site'), cited, deps));
  await write();
  assert.equal(await write(), null, 'a replay finds the receipt and writes nothing');
  assert.deepEqual([store.drafts, store.commits, store.receipts.size, store.citations.length], [1, 1, 1, 1]);
  const [citation] = store.citations, row = first.evidence as IntakeTableRowLocator;
  const lines = citation.excerpt!.split('\n');
  assert.equal(lines[0], 'Sheet Register, row 3', 'the excerpt names the sheet and the physical row');
  assert.ok(lines.includes(`Area: ${row.cell.value}`) && lines.includes('Doubled: unknown')
    && lines.includes('Tripled: unknown'), 'a formula cell is shown as unknown');
  assert.equal(evidenceCitationBindings({ documentCitations: [citation] })[0].locator, 'Sheet Register, row 3');
  // The later check: two cited rows of one sheet read its stored bytes once, in the registry and in the plan.
  const other = tableRowCitation({ row: second.evidence as IntakeTableRowLocator, key: second.key,
    confirmation: citation.confirmation }, await citedRowTx(windows, ids('site'), second.evidence as
    IntakeTableRowLocator, deps), citation.target, 'test_only:officer');
  reads.length = 0;
  await assertRegistryTableCitationsTx(windows, ids('site'), [citation, other], deps);
  const table = onceTableReads({ range }), original = { object_key: 'test_only:book', bytes: bytes.length,
    inspection: { manualProfile: { headers: inputs.headers } } };
  for (const cited of evidenceCitationBindings({ documentCitations: [citation, other] })) {
    assert.equal(await evidenceExcerptTx(windows, cited, original, { table }), cited.excerpt);
  }
  assert.deepEqual(reads, [[byteStart, byteEnd], [byteStart, byteEnd]], 'one sheet read per check, not per row');
  // test_only: a stored window row whose Ward cell was changed after it was written.
  const tampered = { ...stored, rows: stored.rows.map(item => item.record !== 0 ? item
    : { ...item, cells: item.cells.map((cell, column) => column === 0 ? `${cell}x` : cell) }) };
  await assert.rejects(assertRegistryTableCitationsTx(windowStore(tampered), ids('site'), [citation], deps),
    /row, its key cell or its header changed/);
  // test_only: one stored byte of the sheet changed in the retained original.
  const changed = Buffer.from(bytes);
  changed[byteStart + 1] ^= 1;
  const changedRange = (async (_key: string, start: number, end: number) =>
    changed.subarray(start, end)) as typeof readObjectRange;
  await assert.rejects(assertRegistryTableCitationsTx(windows, ids('site'), [citation], { ...deps,
    range: changedRange }), /stored bytes in the original differ from its window/);
});
