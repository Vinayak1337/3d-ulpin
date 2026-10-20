import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { PoolClient } from 'pg';
import type { RegistryRecord, RegistryTableRowCitation } from '@ulpin/contracts';
import { UspPropertyCardFactSchema, type IntakeEvidenceAnchor, type IntakeEvidenceCandidate, type IntakeEvidenceConfirm,
  type IntakeTableRowLocator, type TabularSelection } from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';
import { sha256 } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import type { ConfirmedEvidence } from '../../registry/registry-document-evidence';
import { assertRegistryTableCitationsTx, tableRowCitation } from '../../registry/registry-table-evidence';
import { evidenceCardValue, evidenceCitationBindings, evidenceExcerptTx } from '../packets/plan-citation-authority';
import { writeEvidenceCitations, type EvidenceCitationSteps } from './intake-evidence-citations';
import { closeEvidence, evidenceAnchor, evidenceLinkManifest, evidenceReceiptKey,
  tableAssertions } from './intake-evidence';
import { stableUuid } from './intake-run';
import { readTabularSource } from './tabular-source';

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
type Inputs = ReturnType<typeof realInputs>;

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

/** A store answering exactly the writer's SQL, and fake registry steps that count what they would write. */
function writerStore(inputs: Inputs, candidate: IntakeEvidenceCandidate) {
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
      result_sha256: result, state: 'closed', read_count: '753', eligible_count: '753', keyless_count: '0',
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
      store.citations = confirmed.map(item => tableRowCitation({ row: item.evidence as IntakeTableRowLocator,
        key: item.key, confirmation: item.confirmation }, { table: inputs.table, accessSha256 }, target,
      'test_only:officer'));
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
    assert.equal(await evidenceExcerptTx(job, cited, inputs.bytes), citation.excerpt);
    // test_only: a stored excerpt one space longer than the row.
    const longer = { ...citation, excerpt: `${citation.excerpt} ` };
    await assert.rejects(evidenceExcerptTx(job, { ...cited, citation: longer }, inputs.bytes), /excerpt changed/);
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
