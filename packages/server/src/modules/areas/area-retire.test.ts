import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { assertAreaRowLive, assertLiveArea, restoreArea, retireArea } from './area-retire';

// In-memory protocol control: one area row and its event rows. No database is opened.
const areaId = '10000000-0000-4000-8000-000000000020';
class AreaControl {
  row: Record<string, unknown> = {
    id: areaId, revision: 3, archived_at: null, archive_reason: null, archived_by: null,
  };
  events: unknown[][] = [];
  statements: string[] = [];
  async query(sql: string, values: unknown[] = []) {
    this.statements.push(sql);
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
    if (sql.startsWith('SELECT')) return { rows: values[0] === areaId ? [{ ...this.row }] : [] };
    if (sql.startsWith('UPDATE map_areas')) {
      const at = new Date('2026-10-20T10:00:00.000Z');
      this.row = { ...this.row, archived_at: values.length > 1 ? at : null, archive_reason: values[1] ?? null,
        archived_by: values[2] ?? null };
      return { rows: [{ at }] };
    }
    if (sql.startsWith('INSERT INTO map_area_events')) { this.events.push(values); return { rows: [] }; }
    throw new Error(`Unexpected query: ${sql}`);
  }
}

async function withControl(run: (control: AreaControl) => Promise<void>) {
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  const prior = { pool: globals.ulpinPool, subject: process.env.ULPIN_LOCAL_OPERATOR_SUBJECT };
  const control = new AreaControl();
  globals.ulpinPool = { query: control.query.bind(control),
    connect: async () => ({ query: control.query.bind(control), release: () => {} }) } as unknown as Pool;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'area-retire-control';
  try { await run(control); } finally {
    globals.ulpinPool = prior.pool;
    if (prior.subject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = prior.subject;
  }
}

test('retire keeps the row, records who, when and why, and writes one event; restore clears it with its own', () =>
  withControl(async control => {
    const reason = 'Cleaned for the presentation; the NYC file goes into a new case.';
    const retired = await retireArea(areaId, { expectedRevision: 3, reason: `  ${reason} ` });
    assert.deepEqual({ ...retired, eventId: 'id' }, { areaId, state: 'retired', areaRevision: 3, eventId: 'id',
      actor: 'area-retire-control', reason, at: '2026-10-20T10:00:00.000Z' });
    assert.equal(control.row.archived_by, 'area-retire-control');
    assert.equal(control.row.archive_reason, reason);
    assert.match(control.statements.find(sql => sql.startsWith('SELECT'))!, /FOR UPDATE$/);
    assert(!control.statements.some(sql => /^DELETE|DROP|TRUNCATE/i.test(sql)));
    await assert.rejects(assertLiveArea(areaId), { status: 404, code: 'AREA_RETIRED' });
    assert.throws(() => assertAreaRowLive(control.row), { status: 409, code: 'AREA_RETIRED' });
    await assert.rejects(retireArea(areaId, { expectedRevision: 3, reason }), { code: 'AREA_RETIRED' });

    const restored = await restoreArea(areaId, { expectedRevision: 3, reason: 'Retired by mistake.' });
    assert.equal(restored.state, 'active');
    assert.equal(control.row.archived_at, null);
    await assertLiveArea(areaId);
    assert.deepEqual(control.events.map(values => values.slice(1, 6)), [
      [areaId, 3, 'retired', 'area-retire-control', reason],
      [areaId, 3, 'restored', 'area-retire-control', 'Retired by mistake.'],
    ]);
    await assert.rejects(restoreArea(areaId, { expectedRevision: 3, reason: 'Again' }), { code: 'AREA_NOT_RETIRED' });
  }));

test('a stale revision or an unknown area changes nothing', () => withControl(async control => {
  await assert.rejects(retireArea(areaId, { expectedRevision: 2, reason: 'Stale view' }), { code: 'STALE_REVISION' });
  await assert.rejects(retireArea('10000000-0000-4000-8000-000000000099', { expectedRevision: 3, reason: 'Gone' }),
    { status: 404 });
  assert.equal(control.row.archived_at, null);
  assert.equal(control.events.length, 0);
  assert(control.statements.includes('ROLLBACK'));
}));
