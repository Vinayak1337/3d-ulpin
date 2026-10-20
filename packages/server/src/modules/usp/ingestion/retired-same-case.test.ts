import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { bindRetainedCaseTx } from '../../areas/areas';
import { retiredFileAreaWords } from './intake-destination';
import { ManualIngestionService } from './service';

// G20B on the NYC buildings layer (the demo's file), no database opened: a drop in the same batch of a file whose
// area there is retired rests in officer words and changes nothing; a live area keeps today's path.
const path = 'E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson';
const bytes = new Uint8Array(readFileSync(path));
const nyc = createHash('sha256').update(bytes).digest('hex');
const caseId = '10000000-0000-4000-8000-000000000041';
const oldSource = '10000000-0000-4000-8000-0000000000c1';
const words = 'The area this file made in this batch (buildings original) is retired; nothing new is prepared '
  + 'from it here. Start a new batch to read this file again.';
process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'retired-same-case-protocol';

/** The rows a same-bytes drop reads in the case; `retired` is what the retired-area read finds. */
function batch(retired: { name: string } | null) {
  const statements: { sql: string; values: unknown[] }[] = [];
  const rows = (sql: string) => {
    if (sql.startsWith('SELECT id,revision FROM cases')) return [{ id: caseId, revision: 3 }];
    if (sql.startsWith('SELECT id,family_id,revision,sha256 FROM sources'))
      return [{ id: oldSource, family_id: oldSource, revision: 1, sha256: nyc }];
    if (sql.startsWith('SELECT id FROM sources WHERE case_id=$1 AND sha256=$2')) return [{ id: oldSource }];
    if (sql.includes('a.archived_at IS NOT NULL')) return retired ? [retired] : [];
    if (sql.startsWith('SELECT * FROM sources WHERE id=$1')) throw new Error('rests on the old source');
    return [];
  };
  const query = async (sql: string, values: unknown[] = []) => {
    statements.push({ sql, values });
    const found = rows(sql);
    return { rows: found, rowCount: found.length };
  };
  return { statements, pool: { query, connect: async () => ({ query, release: () => {} }) } as unknown as Pool };
}

async function drop(retired: { name: string } | null) {
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  const prior = globals.ulpinPool, control = batch(retired);
  globals.ulpinPool = control.pool;
  try {
    const outcome = await new ManualIngestionService().retain(caseId, { requestKey: crypto.randomUUID(),
      expectedWorkspaceRevision: 3, format: 'geojson' }, { name: 'buildings-original.geojson', bytes })
      .then(() => null, (error: Error) => error);
    return { outcome, statements: control.statements };
  } finally { globals.ulpinPool = prior; }
}

test('small path: the same bytes again in a batch whose area of them is retired are refused in words', async () => {
  const { outcome, statements } = await drop({ name: 'buildings original' });
  assert.deepEqual({ status: (outcome as { status?: number })?.status, code: (outcome as { code?: string })?.code,
    message: outcome?.message }, { status: 409, code: 'AREA_RETIRED', message: words });
  assert.deepEqual(statements.find(statement => statement.sql.includes('archived_at'))?.values, [caseId, nyc]);
  assert(!statements.some(({ sql }) => /^(INSERT|UPDATE|DELETE)/.test(sql)), 'nothing is written');
  assert(!statements.some(({ sql }) => sql.startsWith('SELECT * FROM sources WHERE id=$1')), 'no old source read');
});

test('small path: with the area live the drop keeps today\'s path and rests on the old source', async () => {
  const { outcome, statements } = await drop(null);
  assert.equal(outcome?.message, 'rests on the old source');
  assert(statements.some(({ sql }) => sql.includes('a.archived_at IS NOT NULL')));
});

test('large path: the area this file made here is found by its bytes and gives the row its words', async () => {
  const seen: unknown[][] = [];
  const lookup = (found: { name: string } | undefined) => async (sql: string, values: string[]) => {
    assert.match(sql, /JOIN map_areas a ON a\.site_id=c\.site_id/);
    assert.match(sql, /a\.archived_at IS NOT NULL/);
    assert.match(sql, /p\.area_id=a\.id AND p\.body->>'sourceHash'=\$2/);
    seen.push(values);
    return found;
  };
  assert.equal(await retiredFileAreaWords(caseId, nyc, lookup({ name: 'buildings original' })), words);
  assert.deepEqual(seen[0], [caseId, nyc]);
  assert.equal(await retiredFileAreaWords(caseId, nyc, lookup(undefined)), null);
  assert(words.length < 2000, 'the words fit the row\'s limit_reason');
});

test('no site is rebound: the batch stays bound to its retired area\'s site', async () => {
  const kase = { id: caseId, site_id: '10000000-0000-4000-8000-0000000000a1', archived: false,
    frame: { id: 'UNASSIGNED' } };
  const client = { query: async (sql: string) => ({ rows: sql.includes('FROM cases WHERE id=$1') ? [kase] : [] }) };
  await assert.rejects(bindRetainedCaseTx(client as unknown as PoolClient, caseId,
    { id: '10000000-0000-4000-8000-0000000000b2' }), { status: 403, code: 'AREA_SOURCE_DENIED' });
});
