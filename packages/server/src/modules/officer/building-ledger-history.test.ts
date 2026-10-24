import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ledgerRegistryHistoryEntry, ledgerRegistryHistorySql, type LedgerRegistryRevision,
} from './building-ledger-history';

const { rows } = JSON.parse(readFileSync('docs/evidence/gf5/br1/history-inputs.json', 'utf8')) as {
  rows: LedgerRegistryRevision[];
};

test('Tower 3 building, floor and space history names each immutable record and its bound actor', () => {
  const entries = rows.map(ledgerRegistryHistoryEntry);
  assert.deepEqual(entries.map(entry => [entry.recordKind, entry.recordName, entry.actor]), [
    ['building', 'TOWER 3', 'selection-demo-runtime'],
    ['building', 'TOWER 3', 'selection-demo-runtime'],
    ['building', 'TOWER 3', 'selection-demo-runtime'],
    ['building', 'TOWER 3', 'selection-demo-runtime'],
    ['building', 'TOWER 3', null],
    ['floor', '2ND FLOOR PLAN', 'selection-demo-runtime'],
    ['space', 'UNIT-3B', null],
    ['space', 'UNIT-3B', 'selection-demo-runtime'],
  ]);
  assert.deepEqual(entries.map(({ recordId, revision, recordedAt }) => ({ recordId, revision, recordedAt })),
    rows.map(row => ({ recordId: row.record_id, revision: row.revision, recordedAt: row.created_at })));
});

test('missing name, kind or actor stays null; a carried or ambiguous actor is not attributed', () => {
  const row = rows[4];
  const empty = ledgerRegistryHistoryEntry({ ...row, body: {} });
  assert.deepEqual([empty.recordKind, empty.recordName, empty.actor], [null, null, null]);
  const carried = ledgerRegistryHistoryEntry({ ...row, revision: 6, body: rows[0].body });
  assert.equal(carried.actor, null);
  const conflict = ledgerRegistryHistoryEntry({ ...row, revision: 2, body: {
    ...rows[3].body, sourceSpaceCommands: [{ receipt: { recordRevision: 2, actor: 'different-actor-control' } }],
  } });
  assert.equal(conflict.actor, null);
});

test('history SQL reads the revision body without a current-record or actor join and preserves bounds/order', () => {
  const sql = ledgerRegistryHistorySql.replace(/\s+/g, ' ').trim();
  assert.equal(sql, 'SELECT record_id,revision,created_at,body FROM registry_revisions '
    + 'WHERE record_id=ANY($1::uuid[]) ORDER BY created_at DESC LIMIT 201');
  assert(!sql.includes('JOIN'));
});
