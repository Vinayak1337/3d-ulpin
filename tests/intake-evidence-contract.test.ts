import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import {
  IntakeEvidenceCandidateSchema, IntakeEvidenceConfirmSchema, IntakeEvidenceQuerySchema, IntakeEvidenceSourceSchema,
  IntakeKeyProfileInputSchema,
} from '../packages/contracts/src/usp';
import { RegistryTableRowCitationSchema } from '../packages/contracts/src/registry-document-evidence';
import { migrateIntakeLedgerTx } from '../packages/server/src/modules/usp/ingestion/intake-migration';
import { sql } from '../packages/server/src/infrastructure/sql-loader';

const id = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const hash = 'a'.repeat(64);
const at = '2026-10-20T00:00:00.000Z';
const closed = { state: 'closed', read: 3, eligible: 2, keyless: 1, unread: 0, failed: 0 };
const key = { profileId: id, profileSha256: hash, namespace: 'Survey building number', kind: 'text', literal: '12-A' };
const row = { kind: 'table_row', itemId: id, caseId: id, sourceId: id, sourceRevision: 1, sourceSha256: hash,
  rawJobId: id, rawInputSha256: hash, rawResultSha256: hash, acceptedFence: 1,
  selection: { format: 'csv', sheet: 'csv', table: null, headerRows: [1] }, sourceRow: 4, rowSha256: hash,
  columnIndex: 0, columnHeader: 'BIN', cell: { state: 'literal', value: '12-A' } };
const quote = 'Building 12-A, ground floor';
const part = { kind: 'document_part', itemId: id, caseId: id, caseRevision: 2, sourceId: id, sourceRevision: 1,
  sourceSha256: hash, jobId: id, resultSha256: hash, inputSha256: hash, readerSha256: hash, acceptedFence: 1,
  partId: id, partSha256: hash, page: 3, quote, quoteStart: 10, quoteEnd: 10 + quote.length };
const anchor = { targetId: id, anchorItemId: id, packageId: id, packageRevision: 1, featureId: id,
  locator: 'feature 7', sourceId: id, sourceRevision: 1, sourceSha256: hash,
  sourcePath: '/features/*/properties/BIN', literal: '12-A' };
const candidate = { version: 'intake-evidence/1', candidateId: id, caseId: id, candidateSha256: hash, key,
  evidence: row, outcome: 'matched', anchors: [anchor], conflictGroup: null, sourceCoverage: null,
  state: 'candidate', qualification: 'not_assessed', createdAt: at };
const confirm = { requestKey: id, acknowledgement: 'I checked each row against its building.', profileId: id,
  profileSha256: hash, excluded: [{ itemId: other, sourceId: other, sourceRevision: 1, sourceSha256: hash,
    bytes: 9, reason: 'A scanned letter outside this batch.' }],
  included: [{ itemId: id, sourceId: id, sourceRevision: 1, sourceSha256: hash, bytes: 10, jobId: id,
    resultSha256: hash, coverage: closed }],
  targets: [{ targetId: id, packageId: id, packageRevision: 1, reviewFingerprint: hash }],
  additions: { kind: 'citations', linkManifestSha256: hash, decisions: [
    { decision: 'accept', candidateId: id, candidateSha256: hash, targetId: id, evidence: row }] } };
const ok = (schema: { safeParse(value: unknown): { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

test('a candidate holds the exact key literal on both sides; a normalised or invented key is refused', () => {
  assert(ok(IntakeEvidenceCandidateSchema, candidate));
  assert(ok(IntakeEvidenceCandidateSchema, { ...candidate, evidence: part }));
  for (const literal of ['12A', '12-a', ' 12-A', '12-A ', '１２-A']) {
    assert(!ok(IntakeEvidenceCandidateSchema, { ...candidate, key: { ...key, literal } }), literal);
    assert(!ok(IntakeEvidenceCandidateSchema, { ...candidate, anchors: [{ ...anchor, literal }] }), literal);
    assert(!ok(IntakeEvidenceCandidateSchema,
      { ...candidate, evidence: { ...row, cell: { state: 'literal', value: literal } } }), literal);
  }
  assert(!ok(IntakeEvidenceCandidateSchema, { ...candidate, evidence: { ...part, quote: 'Building 12, ground',
    quoteEnd: 10 + 'Building 12, ground'.length } }));
  assert(!ok(IntakeEvidenceCandidateSchema, { ...candidate, evidence: { ...part, quoteEnd: part.quoteEnd + 1 } }));
  assert(!ok(IntakeEvidenceCandidateSchema, { ...candidate, evidence: { ...row, cell: { state: 'unknown' } } }));
  const integer = (literal: string) => ({ ...candidate, key: { ...key, kind: 'integer', literal },
    evidence: { ...row, cell: { state: 'literal', value: literal } }, anchors: [{ ...anchor, literal }] });
  assert(ok(IntakeEvidenceCandidateSchema, integer('120')));
  for (const literal of ['007', '7.0', '+7', '1e3']) assert(!ok(IntakeEvidenceCandidateSchema, integer(literal)));
  assert(!ok(IntakeKeyProfileInputSchema, { requestKey: id, version: 'exact-key/1', namespace: 'BIN', kind: 'text',
    map: { anchorItemId: id, sourcePath: '/features/*/geometry' }, tables: [], documents: [id] }));
});

test('coverage may be null; unread coverage is never absence and closed coverage states every count', () => {
  const pins = { sourceId: id, sourceRevision: 1, sourceSha256: hash, bytes: 10 };
  assert(ok(IntakeEvidenceSourceSchema, { itemId: id, profileId: id, family: 'table', jobId: null,
    resultSha256: null, coverage: null, ...pins }));
  assert(ok(IntakeEvidenceSourceSchema, { itemId: id, profileId: id, family: 'document', jobId: id,
    resultSha256: null, coverage: { state: 'reading', read: 12, eligible: null, keyless: null, unread: null,
      failed: null }, ...pins }));
  assert(!ok(IntakeEvidenceSourceSchema, { itemId: id, profileId: id, family: 'table', jobId: null,
    resultSha256: null, coverage: closed, ...pins }));
  assert(!ok(IntakeEvidenceSourceSchema, { itemId: id, profileId: id, family: 'table', jobId: id,
    resultSha256: hash, coverage: { ...closed, unread: null }, ...pins }));
  for (const field of Object.keys(pins)) {
    const { [field as keyof typeof pins]: _, ...rest } = pins;
    assert(!ok(IntakeEvidenceSourceSchema, { itemId: id, profileId: id, family: 'table', jobId: null,
      resultSha256: null, coverage: null, ...rest }), `a source read names its ${field}`);
  }
  const noMatch = { ...candidate, outcome: 'no_match', anchors: [] };
  assert(!ok(IntakeEvidenceCandidateSchema, noMatch));
  assert(!ok(IntakeEvidenceCandidateSchema, { ...noMatch, sourceCoverage: { ...closed, state: 'partial',
    unread: 4 } }));
  assert(ok(IntakeEvidenceCandidateSchema, { ...noMatch, sourceCoverage: closed }));
  assert(!ok(IntakeEvidenceCandidateSchema, { ...candidate, outcome: 'several' }));
  assert(!ok(IntakeEvidenceCandidateSchema, { ...candidate, outcome: 'conflicting' }));
  assert(ok(IntakeEvidenceCandidateSchema, { ...candidate, outcome: 'conflicting', conflictGroup: other }));
});

test('a failed reading carries job state, code and words without inventing coverage or closing it', () => {
  const pins = { sourceId: id, sourceRevision: 1, sourceSha256: hash, bytes: 10 };
  const failure = { state: 'failed', code: 'INTAKE_SOURCE_INTEGRITY', message: 'The original differs from its pins.' };
  const source = { itemId: id, profileId: id, family: 'table', jobId: id, resultSha256: null, ...pins,
    coverage: { state: 'partial', read: 0, eligible: null, keyless: null, unread: null, failed: null, failure } };
  assert(ok(IntakeEvidenceSourceSchema, source));
  assert(!ok(IntakeEvidenceSourceSchema, { ...source, resultSha256: hash, coverage: { ...closed, failure } }));
});

test('the evidence read may name one key profile and one file; each is a uuid and no other field is taken', () => {
  assert(ok(IntakeEvidenceQuerySchema, {}));
  assert(ok(IntakeEvidenceQuerySchema, { featureId: id }));
  assert(ok(IntakeEvidenceQuerySchema, { outcome: 'matched', cursor: id, profileId: id, itemId: other,
    featureId: id }));
  for (const field of ['profileId', 'itemId', 'featureId']) {
    assert(!ok(IntakeEvidenceQuerySchema, { [field]: 'register.csv' }));
  }
  assert(!ok(IntakeEvidenceQuerySchema, { key: '12-A' }));
});

test('an evidence confirmation refuses a missing pin, an unread source and any right or issuance field', () => {
  assert(ok(IntakeEvidenceConfirmSchema, confirm));
  assert(ok(IntakeEvidenceConfirmSchema, { ...confirm, additions: { kind: 'no_additions' } }));
  const without = (value: Record<string, unknown>, field: string) =>
    Object.fromEntries(Object.entries(value).filter(([name]) => name !== field));
  for (const field of Object.keys(confirm)) assert(!ok(IntakeEvidenceConfirmSchema, without(confirm, field)), field);
  for (const field of Object.keys(confirm.included[0]!)) {
    assert(!ok(IntakeEvidenceConfirmSchema, { ...confirm, included: [without(confirm.included[0]!, field)] }), field);
  }
  for (const field of Object.keys(confirm.targets[0]!)) {
    assert(!ok(IntakeEvidenceConfirmSchema, { ...confirm, targets: [without(confirm.targets[0]!, field)] }), field);
  }
  const accept = confirm.additions.decisions[0]!;
  for (const field of Object.keys(accept)) {
    assert(!ok(IntakeEvidenceConfirmSchema, { ...confirm, additions: { ...confirm.additions,
      decisions: [without(accept, field)] } }), field);
  }
  // EVS2: the server computes an omitted link manifest hash; a malformed one is still refused.
  assert(ok(IntakeEvidenceConfirmSchema, { ...confirm, additions: without(confirm.additions, 'linkManifestSha256') }));
  assert(!ok(IntakeEvidenceConfirmSchema, { ...confirm, additions: { ...confirm.additions,
    linkManifestSha256: 'abc' } }));
  assert(!ok(IntakeEvidenceConfirmSchema, { ...confirm, included: [{ ...confirm.included[0]!,
    coverage: { ...closed, state: 'partial', unread: 1 } }] }));
  assert(!ok(IntakeEvidenceConfirmSchema, { ...confirm, additions: { ...confirm.additions,
    decisions: [{ ...accept, targetId: other }] } }));
  assert(!ok(IntakeEvidenceConfirmSchema, { ...confirm, excluded: [{ ...confirm.excluded[0]!, itemId: id }] }));
  for (const extra of [{ rights: 'owner' }, { issuance: true }, { ownership: 'x' }])
    assert(!ok(IntakeEvidenceConfirmSchema, { ...confirm, ...extra }));
});

test('a table-row citation cites the exact key cell of its confirmed candidate', () => {
  const citation = { version: 'registry-table-row-citation/1', id: hash, row, key,
    confirmation: { confirmationId: id, candidateId: id, candidateSha256: hash },
    target: { recordId: id, revision: 2, bodySha256: hash },
    selection: { subject: 'officer', accessSha256: hash, selectedAt: at },
    associationState: 'operator_selected', qualification: 'not_assessed' };
  assert(ok(RegistryTableRowCitationSchema, citation));
  assert(!ok(RegistryTableRowCitationSchema, { ...citation, key: { ...key, literal: '12a' } }));
  assert(!ok(RegistryTableRowCitationSchema, { ...citation, confirmation: { confirmationId: id, candidateId: id } }));
});

test('the evidence SQL runs after the targets SQL and only creates what is absent', async () => {
  const text = sql('ingestion.intake.evidence');
  const code = text.replace(/--.*$/gm, '');
  const statements = code.split(';').map(part => part.trim()).filter(Boolean);
  assert.equal(statements.length, 6);
  for (const statement of statements) assert.match(statement, /^CREATE (TABLE|INDEX) IF NOT EXISTS /);
  assert.doesNotMatch(code, /\b(DROP|RENAME|ALTER|TRUNCATE|DELETE|UPDATE|INSERT)\b/i);
  assert.doesNotMatch(code, /right|owner|issu/i);
  const query = mock.fn(async (_text: string) => ({ rows: [], rowCount: 0 }));
  const client = { query } as unknown as PoolClient;
  await migrateIntakeLedgerTx(client);
  const first = query.mock.calls.map(call => call.arguments[0]);
  await migrateIntakeLedgerTx(client);
  const calls = query.mock.calls.map(call => call.arguments[0]);
  assert.deepEqual(calls.slice(first.length), first);
  // A later additive step (G13's table windows) may follow; evidence still runs right after targets.
  assert.deepEqual(first.slice(0, 3), [sql('ingestion.intake.schema'), sql('ingestion.intake.targets'), text]);
  const manifest = JSON.parse(readFileSync('database/manifest.json', 'utf8'));
  const ids = manifest.steps.map((step: { id: string }) => step.id);
  assert.equal(ids.indexOf('ingestion.intake.evidence'), ids.indexOf('ingestion.intake.targets') + 1);
});
