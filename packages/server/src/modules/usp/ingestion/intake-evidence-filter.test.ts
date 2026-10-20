import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { Pool } from 'pg';
import { INTAKE_EVIDENCE_LIMITS, IntakeEvidencePageSchema, type IntakeEvidenceCandidate,
  type IntakeTableRowLocator } from '@ulpin/contracts/usp';
import { fingerprint } from '../../cases/domain';
import { closeEvidence, readIntakeEvidence } from './intake-evidence';
import { stableUuid } from './intake-run';

// test_only: one case's stored candidates under two key profiles and two tables; no real record is named.
process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'intake-evidence-filter-protocol';
const ids = (name: string) => stableUuid(`test_only:intake-evidence-filter:${name}`);
const caseId = ids('case'), at = '2026-10-21T00:00:00.000Z';
const coverage = { state: 'closed' as const, read: 1, eligible: 1, keyless: 0, unread: 0, failed: 0 };
const selection = { format: 'csv' as const, sheet: 'csv', table: null, headerRows: [1] };
const profiles = [ids('profile-a'), ids('profile-b')], items = [ids('register'), ids('roll')];

/** One exact single match of a table row; the row number makes each candidate its own. */
function stored(profileId: string, itemId: string, n: number) {
  const literal = `12/${n}`;
  const row: IntakeTableRowLocator = { kind: 'table_row', itemId, caseId, sourceId: ids(`source:${itemId}`),
    sourceRevision: 1, sourceSha256: fingerprint(`test_only:${itemId}`), rawJobId: ids('raw'),
    rawInputSha256: fingerprint('test_only:raw-input'), rawResultSha256: fingerprint('test_only:raw'),
    acceptedFence: 1, selection, sourceRow: n + 1, rowSha256: fingerprint(`test_only:row:${n}`), columnIndex: 0,
    columnHeader: 'House no', cell: { state: 'literal', value: literal } };
  const [candidate] = closeEvidence({ caseId, createdAt: at, coverage,
    key: { profileId, profileSha256: fingerprint(`test_only:${profileId}`), namespace: 'Ward house number',
      kind: 'text' },
    assertions: [{ literal, evidence: row }],
    anchors: [{ targetId: ids(`target:${n}`), anchorItemId: ids('map'), packageId: ids('package'),
      packageRevision: 1, featureId: ids(`feature:${n}`), locator: `Feature ${n}`, sourceId: ids('map-source'),
      sourceRevision: 1, sourceSha256: fingerprint('test_only:map'), sourcePath: '/features/*/properties/house no',
      literal }] });
  return { profile_id: profileId, item_id: itemId, outcome: candidate.outcome, candidate };
}
// 250 of profile a in the register, 30 of profile a in the roll and 20 of profile b in the register.
const rows = [
  ...Array.from({ length: 250 }, (_, n) => stored(profiles[0], items[0], n)),
  ...Array.from({ length: 30 }, (_, n) => stored(profiles[0], items[1], 1000 + n)),
  ...Array.from({ length: 20 }, (_, n) => stored(profiles[1], items[0], 2000 + n)),
].sort((a, b) => a.candidate.candidateId.localeCompare(b.candidate.candidateId));

type Statement = { sql: string; args: unknown[] };
const globals = globalThis as unknown as { ulpinPool?: Pool };
let saved: Pool | undefined;
beforeEach(() => { saved = globals.ulpinPool; });
afterEach(() => { globals.ulpinPool = saved; });

/** The stores answer the page read's statements; the candidate read keeps each row its parameters name. */
function install() {
  const seen: Statement[] = [];
  const answers: [string, (args: any[]) => unknown[]][] = [
    ['BEGIN', () => []], ['COMMIT', () => []], ['ROLLBACK', () => []], ['SET TRANSACTION', () => []],
    ['SELECT id,revision,archived FROM cases', () => [{ id: caseId, revision: 1, archived: false }]],
    ['SELECT * FROM usp_intake_key_profiles', () => []],
    ['SELECT c.*,s.id source_id', () => []],
    ['SELECT * FROM usp_intake_evidence_confirmations', () => []],
    ['SELECT candidate FROM', ([, outcome, cursor, profileId, itemId, limit]) => rows
      .filter(row => (outcome === null || row.outcome === outcome)
        && (cursor === null || row.candidate.candidateId > cursor)
        && (profileId === null || row.profile_id === profileId) && (itemId === null || row.item_id === itemId))
      .slice(0, limit).map(row => ({ candidate: row.candidate }))],
    ['SELECT outcome,count', () => [{ outcome: 'matched', n: rows.length }]],
  ];
  const query = async (text: string, args: unknown[] = []) => {
    const sql = text.replace(/\s+/g, ' ').trim();
    const answer = answers.find(([prefix]) => sql.startsWith(prefix));
    if (!answer) throw new Error(`Unexpected statement: ${sql.slice(0, 120)}`);
    seen.push({ sql, args });
    const found = answer[1](args);
    return { rows: found, rowCount: found.length };
  };
  globals.ulpinPool = { query, connect: async () => ({ query, release() {} }) } as never;
  return seen;
}

const read = async (query: Parameters<typeof readIntakeEvidence>[1]) =>
  IntakeEvidencePageSchema.parse(await readIntakeEvidence(caseId, query));
const idsOf = (candidates: IntakeEvidenceCandidate[]) => candidates.map(candidate => candidate.candidateId);
const expected = (profileId: string | null, itemId: string | null) => rows.filter(row =>
  (profileId === null || row.profile_id === profileId) && (itemId === null || row.item_id === itemId))
  .map(row => row.candidate.candidateId);

test('the profile and item filters narrow the page in SQL; the counts stay case-wide', async () => {
  const seen = install();
  const page = await read({ outcome: 'matched', profileId: profiles[0], itemId: items[1] });
  assert.deepEqual(idsOf(page.candidates), expected(profiles[0], items[1]));
  assert.equal(page.candidates.length, 30);
  assert.equal(page.nextCursor, null);
  assert.deepEqual(page.counts, { matched: rows.length, no_match: 0, several: 0, conflicting: 0 });
  const select = seen.find(statement => statement.sql.startsWith('SELECT candidate FROM'))!;
  assert.match(select.sql, /\(\$4::uuid IS NULL OR profile_id=\$4\) AND \(\$5::uuid IS NULL OR item_id=\$5\)/);
  assert.deepEqual(select.args, [caseId, 'matched', null, profiles[0], items[1], INTAKE_EVIDENCE_LIMITS.page + 1]);
  install();
  assert.deepEqual(idsOf((await read({ profileId: profiles[1] })).candidates), expected(profiles[1], null));
  install();
  await assert.rejects(read({ itemId: 'not-a-uuid' }));
});

test('the cursor pages one file of one key, and no filter reads as before', async () => {
  install();
  const filter = { outcome: 'matched', profileId: profiles[0], itemId: items[0] };
  const first = await read(filter);
  assert.equal(first.candidates.length, INTAKE_EVIDENCE_LIMITS.page);
  assert.equal(first.nextCursor, first.candidates.at(-1)!.candidateId);
  const second = await read({ ...filter, cursor: first.nextCursor! });
  assert.equal(second.nextCursor, null);
  assert.deepEqual([...idsOf(first.candidates), ...idsOf(second.candidates)], expected(profiles[0], items[0]));
  assert.equal(second.candidates.length, 50);
  const seen = install();
  const all = await read({});
  assert.deepEqual(idsOf(all.candidates), expected(null, null).slice(0, INTAKE_EVIDENCE_LIMITS.page));
  assert.equal(all.nextCursor, all.candidates.at(-1)!.candidateId);
  const select = seen.find(statement => statement.sql.startsWith('SELECT candidate FROM'))!;
  assert.deepEqual(select.args, [caseId, null, null, null, null, INTAKE_EVIDENCE_LIMITS.page + 1]);
});
