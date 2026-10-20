import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, test } from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { IntakeTableRowLocatorSchema, type DocumentResult, type IntakeEvidenceAnchor, type IntakeEvidenceCandidate,
  type IntakeEvidenceConfirm, type IntakeEvidenceCoverage, type IntakeEvidenceLocator, type IntakeKeyProfileInput,
  type TableWindowRow, type TabularSelection } from '@ulpin/contracts/usp';
import { CONTROL_SHEET, controlWorkbook } from '../../../../../../tests/fixtures/xlsx-control';
import { sha256 } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { closeEvidence, documentAssertions, evidenceAnchor, evidenceConfirmationIssue, evidenceLinkManifest,
  keyLiteral, newerSources, partLiterals, queueFinishedTableEvidenceTx, queueIntakeEvidenceTx, tableAssertions,
  writeIntakeEvidenceTx, type EvidenceState, type IntakeEvidenceInput } from './intake-evidence';
import { windowedTableReading } from './intake-evidence-worker';
import type { IntakeSourceRow } from './intake-context';
import { stableUuid } from './intake-run';
import { windowRows } from './table-windows';
import { readTabularSource } from './tabular-source';
import { readTableWindows, readTabularWindows } from './tabular-stream';

type Part = DocumentResult['native']['parts'][number];
type TableRowLocator = Extract<IntakeEvidenceLocator, { kind: 'table_row' }>;
// Real public NYC inputs (test_only, foreign geography): DOITT building footprints and the LPC landmark register
// for the same blocks, which share the building identification number (BIN) as written.
const buildingsPath = 'E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson';
const registerPath = 'E:/BhuAayam-data/datasets/nyc-10013-linked/nyc-landmarks-preservation-commission/gpmc-yuvp.csv';
const metadataPath = 'E:/BhuAayam-data/datasets/nyc-10013-linked/nyc-office-of-technology-and-innovation/'
  + 'Metadata_BuildingFootprints.md';
const absent = [buildingsPath, registerPath, metadataPath].some(path => !existsSync(path));
const skip = absent && 'the data drive inputs are not present';
const csv: TabularSelection = { format: 'csv', sheet: 'csv', table: null, headerRows: [1] };
// Pins the stores would hold; derived here from the real bytes, never stored as data.
const ids = (name: string) => stableUuid(`test_only:intake-evidence:${name}`);
const caseId = ids('case'), profileId = ids('profile'), profileSha256 = fingerprint('test_only:profile');
const key = { profileId, profileSha256, namespace: 'NYC building identification number', kind: 'integer' as const };
const createdAt = '2026-10-21T00:00:00.000Z';

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

function registerReading(bytes: Buffer, itemId = ids('register')) {
  const table = readTabularSource(bytes, csv);
  const rawResultSha256 = fingerprint(table);
  return tableAssertions(table, table.headers.indexOf('bin'), 'integer', (index, cells, literal) => ({
    kind: 'table_row', itemId, caseId, sourceId: ids(`source:${itemId}`), sourceRevision: 1,
    sourceSha256: sha256(bytes), rawJobId: ids(`job:${itemId}`), rawInputSha256: fingerprint(itemId),
    rawResultSha256, acceptedFence: 1, selection: csv, sourceRow: table.sourceRows[index],
    rowSha256: fingerprint(cells), columnIndex: table.headers.indexOf('bin'), columnHeader: 'bin',
    cell: { state: 'literal', value: literal } }));
}

/** The native part a document reader keeps for a text file: its whole text, hashed as read. */
function textPart(text: string, itemId: string): Part {
  return { id: ids(`part:${itemId}`), sourceId: ids(`source:${itemId}`), sourceRevision: 1,
    sourceSha256: sha256(Buffer.from(text)), text, sha256: sha256(Buffer.from(text)),
    locator: { label: 'text', characterStart: 0, characterEnd: text.length }, method: 'native_text' };
}

function documentReading(parts: Part[], literals: Set<string>, itemId: string) {
  return documentAssertions(parts, literals, true, (part, quote, start) => ({ kind: 'document_part', itemId,
    caseId, caseRevision: 1, sourceId: part.sourceId, sourceRevision: 1, sourceSha256: part.sourceSha256,
    jobId: ids(`job:${itemId}`), resultSha256: fingerprint(parts), inputSha256: fingerprint(itemId),
    readerSha256: fingerprint('test_only:reader'), acceptedFence: 1, partId: part.id, partSha256: part.sha256,
    page: null, quote, quoteStart: start, quoteEnd: start + quote.length }));
}

const close = (reading: { assertions: Parameters<typeof closeEvidence>[0]['assertions'];
  coverage: IntakeEvidenceCoverage }, anchors: IntakeEvidenceAnchor[]) =>
  closeEvidence({ caseId, key, anchors, createdAt, ...reading });
const tally = (candidates: IntakeEvidenceCandidate[]) => candidates.reduce<Record<string, number>>(
  (counts, candidate) => ({ ...counts, [candidate.outcome]: (counts[candidate.outcome] ?? 0) + 1 }), {});
const pinsOf = (candidates: IntakeEvidenceCandidate[]) =>
  candidates.map(candidate => `${candidate.candidateId}:${candidate.candidateSha256}`).sort();

test('a key is the literal as written: no trimming, folding or coercion, and integers are digits', () => {
  assert.equal(keyLiteral('1002421', 'integer'), '1002421');
  for (const value of [' 1002421', '1002421 ', '01002421', '1,002,421', '1002421.0', 1002421, '', '  ', null]) {
    assert.equal(keyLiteral(value, 'integer'), null, String(value));
  }
  assert.equal(keyLiteral(' A-12 ', 'text'), ' A-12 ');
  assert.equal(keyLiteral(1002421, 'text'), null, 'a JSON number has lost its spelling');
  // test_only: the edges of a literal inside text, which no real file here shows.
  const found = partLiterals('BIN 1002421; 21002421 and 10024210, A-12b, A-12.', new Set(['1002421', 'A-12']));
  assert.deepEqual([...found], [['1002421', 4], ['A-12', 43]]);
  assert.deepEqual([...partLiterals('a１００２４２１', new Set(['1002421']))], [], 'no width folding');
});

test('the LPC register and the footprints sharing BINs: matched, a real conflict and a real no-match', { skip },
  () => {
    const anchors = anchorsOf(readFileSync(buildingsPath));
    const reading = registerReading(readFileSync(registerPath));
    assert.deepEqual(reading.coverage, { state: 'closed', read: 753, eligible: 753, keyless: 0, unread: 0, failed: 0 });
    const candidates = close(reading, anchors);
    assert.equal(candidates.length, 753);
    // 693 rows hold a footprint's BIN; 81 of them repeat a BIN on another row, and 60 name no footprint here.
    assert.deepEqual(tally(candidates), { matched: 612, conflicting: 81, no_match: 60 });
    for (const candidate of candidates) {
      assert.equal(candidate.state, 'candidate');
      assert.equal(candidate.qualification, 'not_assessed');
      const evidence = candidate.evidence as Extract<IntakeEvidenceLocator, { kind: 'table_row' }>;
      assert.equal(evidence.cell.value, candidate.key.literal);
      for (const anchor of candidate.anchors) assert.equal(anchor.literal, candidate.key.literal);
    }
    const conflict = candidates.filter(candidate => candidate.key.literal === '1002123');
    assert.deepEqual(conflict.map(candidate => candidate.outcome), ['conflicting', 'conflicting']);
    assert.equal(new Set(conflict.map(candidate => candidate.conflictGroup)).size, 1);
    const missing = candidates.find(candidate => candidate.outcome === 'no_match')!;
    assert.equal(anchors.some(anchor => anchor.literal === missing.key.literal), false);
  });

test('the same sources read in any order give the same candidates and closure', { skip }, () => {
  const anchors = anchorsOf(readFileSync(buildingsPath));
  const literals = new Set(anchors.map(anchor => anchor.literal));
  const register = registerReading(readFileSync(registerPath));
  const metadata = documentReading([textPart(readFileSync(metadataPath, 'utf8'), ids('metadata'))], literals,
    ids('metadata'));
  assert.deepEqual(metadata.coverage, { state: 'closed', read: 1, eligible: 0, keyless: 1, unread: 0, failed: 0 },
    'the footprint metadata names no BIN, and a document never proposes absence');
  const forward = [register, metadata].flatMap(reading => close(reading, anchors));
  const reversed = [metadata, register].flatMap(reading => close(reading, [...anchors].reverse()));
  assert.deepEqual(pinsOf(reversed), pinsOf(forward));
});

function confirmationOf(candidates: IntakeEvidenceCandidate[], coverage: IntakeEvidenceCoverage) {
  const accepted = candidates.find(candidate => candidate.outcome === 'matched')!;
  const decisions = [{ decision: 'accept' as const, candidateId: accepted.candidateId,
    candidateSha256: accepted.candidateSha256, targetId: accepted.anchors[0].targetId, evidence: accepted.evidence }];
  const input: IntakeEvidenceConfirm = { requestKey: ids('confirm'), acknowledgement: 'Checked each row.',
    profileId, profileSha256, excluded: [], included: [{ itemId: ids('register'),
      sourceId: ids(`source:${ids('register')}`), sourceRevision: 1, sourceSha256: accepted.evidence.sourceSha256,
      bytes: 87352,
      jobId: ids('reading'), resultSha256: fingerprint('test_only:result'), coverage }],
    targets: [{ targetId: accepted.anchors[0].targetId, packageId: ids('package'), packageRevision: 1,
      reviewFingerprint: fingerprint('test_only:review') }],
    additions: { kind: 'citations', linkManifestSha256: evidenceLinkManifest(decisions), decisions } };
  const state: EvidenceState = { profileSha256,
    sources: new Map([[ids('register'), { ...input.included[0], latest: true }]]),
    coverage: new Map([[ids('register'), { jobId: ids('reading'), resultSha256: fingerprint('test_only:result'),
      coverage }]]),
    targets: new Map([[input.targets[0].targetId, { packageId: ids('package'), packageRevision: 1,
      reviewFingerprint: fingerprint('test_only:review') }]]),
    candidates: new Map([[accepted.candidateId, { itemId: ids('register'), candidateSha256: accepted.candidateSha256,
      targetIds: accepted.anchors.map(anchor => anchor.targetId), outcome: accepted.outcome,
      evidence: accepted.evidence }]]) };
  return { input, state };
}

test('a confirmation holds every pin; a stale pin or an unnamed newer source refuses it', { skip }, () => {
  const reading = registerReading(readFileSync(registerPath));
  const { input, state } = confirmationOf(close(reading, anchorsOf(readFileSync(buildingsPath))), reading.coverage);
  assert.equal(evidenceConfirmationIssue(input, state), null);
  const decision = input.additions.kind === 'citations' ? input.additions.decisions[0] : undefined;
  const reading0 = state.coverage.get(ids('register'))!;
  const candidate = state.candidates.get(decision!.candidateId)!;
  const target = state.targets.get(input.targets[0].targetId)!;
  const stale: [string, EvidenceState][] = [
    ['profile', { ...state, profileSha256: fingerprint('other') }],
    ['source', { ...state, sources: new Map([[ids('register'), { ...input.included[0], latest: false }]]) }],
    ['reading', { ...state, coverage: new Map([[ids('register'), { ...reading0,
      resultSha256: fingerprint('newer') }]]) }],
    ['newer source', { ...state, coverage: new Map([...state.coverage, [ids('late'), reading0]]) }],
    ['candidate', { ...state, candidates: new Map([[decision!.candidateId, { ...candidate,
      candidateSha256: fingerprint('other') }]]) }],
    ['package', { ...state, targets: new Map([[input.targets[0].targetId, { ...target, packageRevision: 2 }]]) }],
  ];
  for (const [name, changed] of stale) assert.notEqual(evidenceConfirmationIssue(input, changed), null, name);
  assert.notEqual(evidenceConfirmationIssue({ ...input, additions: { ...input.additions,
    linkManifestSha256: fingerprint('other') } as IntakeEvidenceConfirm['additions'] }, state), null);
  assert.deepEqual(newerSources(input, [ids('register'), ids('late')]), [ids('late')],
    'a stored confirmation is unchanged; the read names the source read after it');
});

type StoredWindow = { window_index: number; first_record: number; records: number; fence: number;
  window_sha256: string; rows: unknown[] };
type RawState = { state: string; records: number; windows: StoredWindow[] };
const globals = globalThis as unknown as { ulpinPool?: Pool };
const rawJobId = ids('raw-stream');
let savedPool: Pool | undefined;
beforeEach(() => { savedPool = globals.ulpinPool; });
afterEach(() => { globals.ulpinPool = savedPool; });

/** The register as G13's reader stores it. The reader closes a window at 10,000 records, so the register is one
 * window; regrouped (test_only) into windows of `size` records, each window's SHA-256 stays the hash of exactly its
 * byte range of the original, as the reader defines it. */
async function storedWindows(bytes: Buffer, size: number): Promise<StoredWindow[]> {
  const rows: TableWindowRow[] = [];
  await readTabularWindows(Readable.from([bytes]), async (window, headers) => {
    rows.push(...windowRows(window, headers));
  });
  const windows: StoredWindow[] = [];
  for (let first = 0; first < rows.length; first += size) {
    const part = rows.slice(first, first + size);
    windows.push({ window_index: windows.length, first_record: first, records: part.length, fence: 1,
      window_sha256: sha256(bytes.subarray(part[0].byteStart, part.at(-1)!.byteEnd)), rows: part });
  }
  return windows;
}

/** The statements the windowed reading issues, answered from one raw job's stored windows. */
function installRawJob(raw: RawState) {
  const answer = (text: string, args: unknown[] = []) => {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('BEGIN') || sql === 'COMMIT' || sql === 'ROLLBACK') return [];
    if (sql.startsWith('SELECT j.id FROM jobs j')) return raw.windows.length ? [{ id: rawJobId }] : [];
    if (sql.startsWith('SELECT job_id AS id,state,records,input_sha256 FROM usp_streaming_vector_imports'))
      return [{ id: rawJobId, state: raw.state, records: raw.records, input_sha256: fingerprint('test_only:raw') }];
    if (sql.startsWith('SELECT window_index,records,fence FROM usp_table_windows'))
      return raw.windows.map(({ window_index, records, fence }) => ({ window_index, records, fence }));
    if (sql.startsWith('SELECT window_index,first_record,records,window_sha256,rows FROM usp_table_windows'))
      return raw.windows.filter(window => window.window_index === args[1]).map(window => structuredClone(window));
    throw new Error(`Unexpected statement: ${sql.slice(0, 120)}`);
  };
  const query = async (text: string, args?: unknown[]) => {
    const rows = answer(text, args);
    return { rows, rowCount: rows.length };
  };
  globals.ulpinPool = { query, connect: async () => ({ query, release() {} }) } as never;
}

function streamedRegister(bytes: Buffer, literals: ReadonlySet<string>) {
  const itemId = ids('register'), headers = readTabularSource(bytes, csv).headers;
  const input = { itemId, caseId, sourceId: ids(`source:${itemId}`), sourceRevision: 1,
    sourceSha256: sha256(bytes) } as IntakeEvidenceInput;
  const profile = { kind: 'integer', tables: [{ itemId, selection: csv, columnIndex: headers.indexOf('bin') }] };
  const source = { sha256: sha256(bytes), bytes: bytes.length,
    inspection: { manualProfile: { headers, tabular: { selection: csv } } } };
  return (raw: RawState) => {
    installRawJob(raw);
    return windowedTableReading(input, profile as IntakeKeyProfileInput, source as unknown as IntakeSourceRow,
      literals);
  };
}

test('the register read from its stored windows gives the outcomes, ids and row hashes of the whole read',
  { skip }, async () => {
    const bytes = readFileSync(registerPath), anchors = anchorsOf(readFileSync(buildingsPath));
    const whole = new Map(close(registerReading(bytes), anchors).map(candidate => [candidate.candidateId, candidate]));
    const read = streamedRegister(bytes, new Set(anchors.map(anchor => anchor.literal)));
    for (const size of [10_000, 100]) {
      const windows = await storedWindows(bytes, size);
      assert.equal(windows.length, size === 100 ? 8 : 1);
      const reading = (await read({ state: 'completed', records: 753, windows }))!;
      assert.deepEqual(reading.coverage, { state: 'closed', read: 753, eligible: 753, keyless: 0, unread: 0,
        failed: 0 });
      const candidates = close(reading, anchors);
      assert.deepEqual(tally(candidates), { matched: 612, conflicting: 81, no_match: 60 });
      assert.equal(candidates.length, whole.size);
      for (const candidate of candidates) {
        const same = whole.get(candidate.candidateId)!;
        assert.equal(candidate.outcome, same.outcome);
        assert.equal(candidate.conflictGroup, same.conflictGroup);
        const [streamed, wholeRow] = [candidate.evidence, same.evidence] as TableRowLocator[];
        assert.equal(streamed.rowSha256, wholeRow.rowSha256);
        assert.equal(streamed.sourceRow, wholeRow.sourceRow);
        assert.equal('window' in wholeRow, false, 'a whole-file row keeps its locator');
        const cited = bytes.subarray(streamed.window!.byteStart, streamed.window!.byteEnd);
        assert.equal(sha256(cited), streamed.window!.sha256);
        assert.ok(cited.toString('utf8').includes(streamed.cell.value));
      }
    }
  });

// The workbook reader needs the native reader's packages (services/geo) and the private scratch the demo runtime
// gives its local readers; here a test folder outside the repository.
const geoPython = 'E:/BhuAayam-data/ml/venv-k3a-geo/Scripts/python.exe';
const python = existsSync(process.env.ULPIN_PROFILE_PYTHON ?? geoPython) ? false : 'needs ULPIN_PROFILE_PYTHON';

test('a workbook row read from its stored window cites the sheet\'s stored bytes, its sheet and physical row; '
  + 'a formula key cell is unknown, never a key', { skip: python }, async () => {
  process.env.ULPIN_PROFILE_PYTHON ??= geoPython;
  process.env.ULPIN_DOCUMENT_OCR_SCRATCH ??= join(tmpdir(), 'ulpin-table-scratch-evidence');
  const control = controlWorkbook(30), bytes = control.bytes, rows: TableWindowRow[] = [];
  const selection: TabularSelection = { format: 'xlsx', sheet: 'Register', table: null, headerRows: [2] };
  let headers: string[] = [], windowSha256 = '';
  await readTableWindows(Readable.from([bytes]), { selection, bytes: bytes.length }, async (window, names) => {
    rows.push(...windowRows(window, names));
    [headers, windowSha256] = [names, window.sha256];
  });
  const itemId = ids('workbook');
  const input = { itemId, caseId, sourceId: ids(`source:${itemId}`), sourceRevision: 1,
    sourceSha256: sha256(bytes) } as IntakeEvidenceInput;
  const source = { sha256: sha256(bytes), bytes: bytes.length, inspection: { manualProfile: { headers,
    tabular: { selection } } } } as unknown as IntakeSourceRow;
  installRawJob({ state: 'completed', records: 30, windows: [{ window_index: 0, first_record: 0, records: 30,
    fence: 1, window_sha256: windowSha256, rows }] });
  const read = (header: string) => windowedTableReading(input, { kind: 'integer', tables: [{ itemId, selection,
    columnIndex: headers.indexOf(header) }] } as IntakeKeyProfileInput, source, new Set());
  const area = (await read('Area'))!;
  assert.deepEqual(area.coverage, { state: 'closed', read: 30, eligible: 30, keyless: 0, unread: 0, failed: 0 });
  const [byteStart, byteEnd] = control.ranges.get(CONTROL_SHEET)!;
  for (const [at, { evidence }] of area.assertions.entries()) {
    const locator = IntakeTableRowLocatorSchema.parse(evidence);
    assert.deepEqual(locator.window, { index: 0, record: at, byteStart, byteEnd, sha256: windowSha256,
      sheet: 'Register', physicalRow: at + 3, sheetSha256: control.sheetSha256 });
    assert.equal(sha256(bytes.subarray(byteStart, byteEnd)), locator.window!.sha256);
  }
  const doubled = (await read('Doubled'))!;
  assert.deepEqual([doubled.assertions, doubled.coverage.keyless], [[], 30], 'a cached formula result is no key');
});

test('a raw job still running or failed leaves the rest unknown; a window that does not read back is failed',
  { skip }, async () => {
    const bytes = readFileSync(registerPath), anchors = anchorsOf(readFileSync(buildingsPath));
    const read = streamedRegister(bytes, new Set(anchors.map(anchor => anchor.literal)));
    const windows = await storedWindows(bytes, 100);
    const running = (await read({ state: 'running', records: 300, windows: windows.slice(0, 3) }))!;
    assert.deepEqual(running.coverage, { state: 'partial', read: 300, eligible: 300, keyless: 0, unread: null,
      failed: null });
    const seen = tally(close(running, anchors));
    assert.equal(seen.no_match, undefined, 'unread coverage is never absence');
    assert.ok(seen.matched > 0 && running.assertions.length < 300, 'only the keys a building holds are proposed');
    const failed = await read({ state: 'failed', records: 300, windows: windows.slice(0, 3) });
    assert.deepEqual(failed!.coverage, running.coverage);
    // test_only: a stored window whose record numbers no longer run on from its first record.
    const broken = windows.map(window => window.window_index !== 1 ? window
      : { ...window, rows: [...window.rows].reverse() });
    const finished = await read({ state: 'completed', records: 753, windows: broken });
    assert.deepEqual(finished!.coverage, { state: 'partial', read: 653, eligible: 653, keyless: 0, unread: 0,
      failed: 100 });
    assert.equal(await read({ state: 'running', records: 0, windows: [] }), null, 'no stored window: not read here');
  });

type Coverage = { job_id: string; state: string; read: number | null; result_sha256: string | null };
type QueuedJob = { id: string; case_revision: number; input_fingerprint: string; payload: IntakeEvidenceInput;
  status: string };
type Handler = (args: any[]) => unknown[];

/** test_only: one case's evidence stores in memory, answering the statements ER1's queue and a reading's write
 * issue; `raw` is the register's raw streaming job. */
function evidenceStore(raw: { state: string }, bytes: { sha256: string; length: number }) {
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'intake-evidence-protocol';
  const itemId = ids('register'), sourceId = ids(`source:${itemId}`);
  const jobs = new Map<string, QueuedJob>(), coverage = new Map<string, Coverage>();
  const candidates = new Map<string, IntakeEvidenceCandidate>();
  const handlers: [string, Handler][] = [
    ['SELECT source_id,state FROM usp_streaming_vector_imports', () => [{ source_id: sourceId, state: raw.state }]],
    ['SELECT j.id FROM jobs j', () => []],
    // The coverage rows the finish reads again: partial, or reading under a job already running.
    ['SELECT c.item_id,p.profile_id', () => [...coverage].filter(([, row]) => row.state === 'partial'
      || row.state === 'reading' && jobs.get(row.job_id)?.status === 'running')
      .map(([item]) => ({ item_id: item, profile_id: profileId, profile_sha256: profileSha256 }))],
    ['SELECT family,source_id FROM usp_intake_items', () => [{ family: 'table', source_id: sourceId }]],
    ['SELECT id,revision,archived FROM cases', () => [{ id: caseId, revision: 4, archived: false }]],
    ['SELECT revision FROM cases', () => [{ revision: 4 }]],
    ['SELECT * FROM sources', () => [{ id: sourceId, case_id: caseId, revision: 1, sha256: bytes.sha256,
      bytes: bytes.length, object_key: 'test_only/register', profile: 'tabular-manual-v1',
      inspection: { actor: process.env.ULPIN_LOCAL_OPERATOR_SUBJECT } }]],
    ['SELECT id FROM jobs', ([id]) => jobs.has(id) ? [{ id }] : []],
    ['INSERT INTO jobs', ([id, , , revision, digest, payload]) => {
      jobs.set(id, { id, case_revision: revision, input_fingerprint: digest, payload, status: 'queued' });
      return [];
    }],
    ['SELECT * FROM jobs', ([id]) => [{ ...jobs.get(id), case_id: caseId, source_id: sourceId,
      operation: 'intake-evidence' }]],
    ['SELECT * FROM usp_job_metadata', () => []],
    ['INSERT INTO usp_job_metadata', () => []],
    ['INSERT INTO usp_intake_evidence_coverage', ([, item, , , jobId]) => {
      coverage.set(item, { job_id: jobId, state: 'reading', read: null, result_sha256: null });
      return [];
    }],
    ['SELECT item_id AS', ([, item]) => [{ itemId: item, state: 'read', family: 'table', format: 'csv',
      sizeClass: 'L', wave: 1, pinnedByOfficer: false }]],
    ['INSERT INTO usp_outbox_streams', () => []],
    ['UPDATE usp_outbox_streams', () => [{ sequence: '1' }]],
    ['INSERT INTO usp_outbox', () => []],
    ['SELECT job_id FROM usp_intake_evidence_coverage', ([, item]) => [coverage.get(item)]],
    ['DELETE FROM usp_intake_evidence_candidates', ([, , keep]) => {
      for (const id of candidates.keys()) if (!keep.includes(id)) candidates.delete(id);
      return [];
    }],
    ['INSERT INTO usp_intake_evidence_candidates', ([, , , rows]) => {
      for (const { candidate } of JSON.parse(rows)) candidates.set(candidate.candidateId, candidate);
      return [];
    }],
    ['UPDATE usp_intake_evidence_coverage SET state', ([, item, state, resultSha256, read]) => {
      Object.assign(coverage.get(item)!, { state, result_sha256: resultSha256, read });
      return [];
    }],
  ];
  const client = { query: async (text: string, args: unknown[] = []) => {
    const sql = text.replace(/\s+/g, ' ').trim();
    const handler = handlers.find(([prefix]) => sql.startsWith(prefix));
    if (!handler) throw new Error(`Unexpected statement: ${sql.slice(0, 120)}`);
    const rows = handler[1](args);
    return { rows, rowCount: rows.length };
  } } as unknown as PoolClient;
  return { client, jobs, coverage, candidates, itemId, sourceId };
}

/** A queued reading run as its job runs it: read, closed against the buildings, written under its own job. */
async function runReading(store: ReturnType<typeof evidenceStore>, jobId: string,
  reading: Awaited<ReturnType<typeof windowedTableReading>>, anchors: IntakeEvidenceAnchor[]) {
  const job = store.jobs.get(jobId)!;
  job.status = 'running';
  const candidates = close(reading!, anchors);
  const resultSha256 = fingerprint({ coverage: reading!.coverage, candidates: pinsOf(candidates) });
  await writeIntakeEvidenceTx(store.client, job.payload, reading!.coverage, resultSha256, candidates);
  job.status = 'succeeded';
}

const evidenceProfile = { profile_id: profileId, profile_sha256: profileSha256 };

test('ER1: a reading partial while the raw job ran is read again once when it finishes, and closes', { skip },
  async () => {
    const bytes = readFileSync(registerPath), anchors = anchorsOf(readFileSync(buildingsPath));
    const read = streamedRegister(bytes, new Set(anchors.map(anchor => anchor.literal)));
    const windows = await storedWindows(bytes, 100), raw = { state: 'running' };
    const store = evidenceStore(raw, { sha256: sha256(bytes), length: bytes.length });
    const first = (await queueIntakeEvidenceTx(store.client, caseId, evidenceProfile, store.itemId))!;
    assert.equal(first, stableUuid(`intake-evidence/1:${profileId}:${profileSha256}:${store.itemId}:`
      + `${store.sourceId}:1:${sha256(bytes)}`), 'a reading without a raw job keeps its id');
    await runReading(store, first, await read({ state: 'running', records: 300, windows: windows.slice(0, 3) }),
      anchors);
    assert.equal(store.coverage.get(store.itemId)!.state, 'partial');
    const earlier = new Map(store.candidates);
    // The officer's stored decisions on two candidates of the partial reading: one accepted, one rejected.
    const [accepted, rejected] = [...earlier.values()].filter(candidate => candidate.outcome === 'matched');
    const decisions = structuredClone([{ decision: 'accept', candidateId: accepted.candidateId,
      targetId: accepted.anchors[0].targetId, evidence: accepted.evidence },
    { decision: 'reject', candidateId: rejected.candidateId, targetId: null, evidence: rejected.evidence }]);

    for (const state of ['failed', 'stale', 'running']) {
      raw.state = state;
      await queueFinishedTableEvidenceTx(store.client, caseId, rawJobId);
      assert.deepEqual([store.jobs.size, store.coverage.get(store.itemId)!.job_id], [1, first], state);
    }
    raw.state = 'completed';
    await queueFinishedTableEvidenceTx(store.client, caseId, rawJobId);
    const again = stableUuid(`intake-evidence/1:${profileId}:${profileSha256}:${store.itemId}:${store.sourceId}:1:`
      + `${sha256(bytes)}:raw:${rawJobId}`);
    assert.deepEqual([...store.jobs.keys()], [first, again], 'one new reading, named by the raw job');
    assert.deepEqual(store.coverage.get(store.itemId), { job_id: again, state: 'reading', read: null,
      result_sha256: null });
    assert.equal(store.jobs.get(first)!.status, 'succeeded', 'the earlier reading\'s job is kept');
    assert.deepEqual(store.candidates, earlier, 'and its candidates, until the new reading writes');
    await queueFinishedTableEvidenceTx(store.client, caseId, rawJobId);
    assert.equal(store.jobs.size, 2, 'a replay of the finish queues nothing');

    await runReading(store, again, await read({ state: 'completed', records: 753, windows }), anchors);
    assert.equal(store.coverage.get(store.itemId)!.state, 'closed');
    assert.equal(store.candidates.size, 753);
    assert.deepEqual(tally([...store.candidates.values()]), { matched: 612, conflicting: 81, no_match: 60 });
    for (const id of earlier.keys()) assert.ok(store.candidates.has(id), 'a candidate read before is read again');
    for (const decision of decisions) {
      const cited = [...store.candidates.values()].filter(candidate =>
        fingerprint(candidate.evidence) === fingerprint(decision.evidence));
      assert.deepEqual(cited.map(candidate => candidate.candidateId), [decision.candidateId],
        'the row a decision names has one candidate, under the same id');
      if (decision.targetId) assert.ok(cited[0].anchors.some(anchor => anchor.targetId === decision.targetId));
    }
    await queueFinishedTableEvidenceTx(store.client, caseId, rawJobId);
    assert.equal(store.jobs.size, 2, 'a closed reading is not read again');
  });

test('ER1: on the finish a reading still running is read again; one still queued reads the finished job',
  async () => {
    const store = evidenceStore({ state: 'completed_with_rejections' },
      { sha256: fingerprint('test_only:register'), length: 87352 });
    const queued = (await queueIntakeEvidenceTx(store.client, caseId, evidenceProfile, store.itemId))!;
    await queueFinishedTableEvidenceTx(store.client, caseId, rawJobId);
    assert.deepEqual([store.jobs.size, store.coverage.get(store.itemId)!.job_id], [1, queued]);
    store.jobs.get(queued)!.status = 'running';
    await queueFinishedTableEvidenceTx(store.client, caseId, rawJobId);
    assert.equal(store.jobs.size, 2);
    assert.notEqual(store.coverage.get(store.itemId)!.job_id, queued, 'the running reading is replaced');
  });
