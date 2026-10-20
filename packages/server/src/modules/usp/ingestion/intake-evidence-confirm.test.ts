import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { Pool } from 'pg';
import { IntakeEvidencePageSchema, type IntakeEvidenceConfirm, type IntakeTableRowLocator } from '@ulpin/contracts/usp';
import { fingerprint } from '../../cases/domain';
import { closeEvidence, confirmIntakeEvidence, evidenceLinkManifest, readIntakeEvidence } from './intake-evidence';
import { stableUuid } from './intake-run';

// test_only: one case's evidence stores, built to the published contract; no real record is named.
process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'intake-evidence-confirm-protocol';
const ids = (name: string) => stableUuid(`test_only:intake-evidence-confirm:${name}`);
const caseId = ids('case'), profileId = ids('profile'), profileSha256 = fingerprint('test_only:profile');
const itemId = ids('register'), sourceId = ids('source'), sourceSha256 = fingerprint('test_only:bytes');
const targetId = ids('target'), packageId = ids('package'), review = fingerprint('test_only:review');
const jobId = ids('reading'), resultSha256 = fingerprint('test_only:result'), at = '2026-10-21T00:00:00.000Z';
const coverage = { state: 'closed' as const, read: 2, eligible: 1, keyless: 1, unread: 0, failed: 0 };
const selection = { format: 'csv' as const, sheet: 'csv', table: null, headerRows: [1] };
const row: IntakeTableRowLocator = { kind: 'table_row', itemId, caseId, sourceId, sourceRevision: 2, sourceSha256,
  rawJobId: ids('raw'), rawInputSha256: fingerprint('test_only:raw-input'), rawResultSha256: fingerprint('raw'),
  acceptedFence: 1, selection, sourceRow: 2, rowSha256: fingerprint('test_only:row'), columnIndex: 0,
  columnHeader: 'House no', cell: { state: 'literal', value: '12/4' } };
const [candidate] = closeEvidence({ caseId, createdAt: at, coverage,
  key: { profileId, profileSha256, namespace: 'Ward house register number', kind: 'text' },
  assertions: [{ literal: '12/4', evidence: row }],
  anchors: [{ targetId, anchorItemId: ids('map'), packageId, packageRevision: 3, featureId: ids('feature'),
    locator: 'Feature 14 of outlines.geojson', sourceId: ids('map-source'), sourceRevision: 1,
    sourceSha256: fingerprint('test_only:map'), sourcePath: '/features/*/properties/house no', literal: '12/4' }] });
const decisions = [{ decision: 'accept' as const, candidateId: candidate.candidateId,
  candidateSha256: candidate.candidateSha256, targetId, evidence: candidate.evidence }];
const body = { requestKey: ids('request'), acknowledgement: 'I checked the register row against its building.',
  profileId, profileSha256, excluded: [], included: [{ itemId, sourceId, sourceRevision: 2, sourceSha256, bytes: 87,
    jobId, resultSha256, coverage }],
  targets: [{ targetId, packageId, packageRevision: 3, reviewFingerprint: review }],
  additions: { kind: 'citations' as const, decisions } };

type Statement = { sql: string; args: unknown[] };
type Answer = (args: any[]) => unknown[];
const globals = globalThis as unknown as { ulpinPool?: Pool };
let saved: Pool | undefined;
beforeEach(() => { saved = globals.ulpinPool; });
afterEach(() => { globals.ulpinPool = saved; });

/** The stores answer exactly the statements the confirm and the page read issue; any other statement fails. */
function install(sources: Record<string, unknown>[]) {
  const seen: Statement[] = [];
  const coverageRow = { profile_id: profileId, item_id: itemId, case_id: caseId, family: 'table', job_id: jobId,
    result_sha256: resultSha256, state: 'closed', read_count: '2', eligible_count: '1', keyless_count: '1',
    unread_count: '0', failed_count: '0' };
  const answers: [string, Answer][] = [
    ['BEGIN', () => []], ['COMMIT', () => []], ['ROLLBACK', () => []], ['SET TRANSACTION', () => []],
    ['SELECT id,revision,archived FROM cases', () => [{ id: caseId, revision: 4, archived: false }]],
    ['SELECT revision FROM cases', () => [{ revision: 4 }]],
    ['SELECT * FROM usp_intake_evidence_confirmations WHERE case_id=$1 AND request_key', () => []],
    ['SELECT * FROM usp_intake_evidence_confirmations WHERE case_id=$1 ORDER BY', () => []],
    ['SELECT profile_sha256 FROM usp_intake_key_profiles', () => [{ profile_sha256: profileSha256 }]],
    ['SELECT * FROM usp_intake_key_profiles', () => []],
    ['SELECT i.item_id,s.id', () => [{ item_id: itemId, id: sourceId, revision: 2, sha256: sourceSha256,
      bytes: '87', latest: true }]],
    ['SELECT * FROM usp_intake_evidence_coverage', () => [coverageRow]],
    ['SELECT c.*,s.id source_id', () => sources.map(source => ({ ...coverageRow, ...source }))],
    ['SELECT t.target_id', () => [{ target_id: targetId, package_id: packageId, revision: 3, review,
      committed: null }]],
    ['SELECT candidate_id,item_id', () => [{ candidate_id: candidate.candidateId, item_id: itemId,
      candidate_sha256: candidate.candidateSha256, target_ids: [targetId], outcome: 'matched',
      evidence: structuredClone(candidate.evidence) }]],
    ['SELECT candidate FROM', () => [{ candidate }]],
    ['SELECT outcome,count', () => [{ outcome: 'matched', n: 1 }]],
    ['INSERT INTO usp_intake_evidence_confirmations', ([id, , , digest, , , additions, , pins, subject, , expires,
      created]) => [{ confirmation_id: id, case_id: caseId, input_sha256: digest, profile_id: profileId, additions,
      pins, subject, expires_at: expires, created_at: created }]],
    ['SELECT item_id AS', () => [{ itemId, state: 'read', family: 'table', format: 'csv', sizeClass: 'S', wave: 1,
      pinnedByOfficer: false }]],
    ['INSERT INTO usp_outbox_streams', () => []],
    ['UPDATE usp_outbox_streams', () => [{ sequence: '1' }]],
    ['INSERT INTO usp_outbox', () => []],
    ['SELECT target_id,readiness FROM usp_intake_targets', () => [{ target_id: targetId, readiness: 'ready' }]],
  ];
  const query = async (text: string, args: unknown[] = []) => {
    const sql = text.replace(/\s+/g, ' ').trim();
    const answer = answers.find(([prefix]) => sql.startsWith(prefix));
    if (!answer) throw new Error(`Unexpected statement: ${sql.slice(0, 120)}`);
    seen.push({ sql, args });
    const rows = answer[1](args);
    return { rows, rowCount: rows.length };
  };
  globals.ulpinPool = { query, connect: async () => ({ query, release() {} }) } as never;
  return seen;
}

const stored = (seen: Statement[]) =>
  seen.find(statement => statement.sql.startsWith('INSERT INTO usp_intake_evidence_confirmations'));

test('a confirmation without the link manifest hash stores the hash the server computes from its decisions',
  async () => {
    const seen = install([]);
    const confirmation = await confirmIntakeEvidence(caseId, body);
    const computed = evidenceLinkManifest(decisions);
    const insert = stored(seen)!;
    const pins = insert.args[8] as IntakeEvidenceConfirm;
    assert.equal(insert.args[7], computed, 'the stored link manifest column');
    assert.deepEqual(pins.additions, { kind: 'citations', linkManifestSha256: computed, decisions });
    assert.equal(insert.args[3], fingerprint(pins), 'the request digest is of the pins as stored');
    assert.deepEqual(confirmation.input.additions, pins.additions);
    assert.equal(confirmation.registryWritten, false);
    // The same body sent with the computed hash names the same pins.
    const again = install([]);
    await confirmIntakeEvidence(caseId, { ...body, additions: { ...body.additions, linkManifestSha256: computed } });
    assert.equal(stored(again)!.args[3], insert.args[3]);
  });

test('a link manifest hash that is not the decisions\' own is refused and nothing is stored', async () => {
  const seen = install([]);
  await assert.rejects(confirmIntakeEvidence(caseId, { ...body, additions: { ...body.additions,
    linkManifestSha256: fingerprint('test_only:other') } }), (error: { status: number; code: string;
    message: string }) => error.status === 409 && error.code === 'INTAKE_EVIDENCE_STALE'
    && error.message === 'The link manifest hash does not match the decisions sent.');
  assert.equal(stored(seen), undefined);
});

test('the page read carries each source\'s current pins; an item without a retained source is refused', async () => {
  install([{ source_id: sourceId, source_revision: 2, source_sha256: sourceSha256, source_bytes: '87' }]);
  const page = IntakeEvidencePageSchema.parse(await readIntakeEvidence(caseId, {}));
  assert.deepEqual(page.sources, [{ itemId, profileId, family: 'table', jobId, resultSha256, coverage, sourceId,
    sourceRevision: 2, sourceSha256, bytes: 87 }]);
  const { family: _family, profileId: _profile, ...read } = page.sources[0];
  assert.deepEqual(read, body.included[0], 'a closed source read is the included pins a confirmation names');
  install([{ source_id: null, source_revision: null, source_sha256: null, source_bytes: null }]);
  await assert.rejects(readIntakeEvidence(caseId, {}), (error: { status: number; code: string }) =>
    error.status === 422 && error.code === 'INTAKE_EVIDENCE_ITEM');
});
