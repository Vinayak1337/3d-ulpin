import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { IntakeManifestSchema } from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';
import { IntakeService } from './intake-service';

const subject = 'mf1-protocol-operator';
const caseId = '31000000-0000-4000-8000-000000000001';

const id = (kind: number, index: number) => `31000000-0000-4000-${8000 + kind}-${String(index).padStart(12, '0')}`;

/** In-memory protocol control, not a dataset record: one original and one taken-out member per batch file. */
function itemRows(count: number) {
  const at = new Date('2026-10-22T00:00:00Z');
  const base = { case_id: caseId, family: 'table', format: 'csv', wave: 2, state: 'probed', placement: 'undecided',
    card: null, card_sha256: null, probe_version: null, plan_ref: null, parts_planned: null, parts_done: 0,
    records_seen: '0', limit_reason: null, pinned_by_officer: false, created_at: at, updated_at: at };
  return Array.from({ length: count }, (_, index) => [
    { ...base, item_id: id(1, index), source_id: id(1, index), parent_item_id: null, member_path: null,
      name: `file-${index}.zip`, size_bytes: '2048', size_class: 'S' },
    { ...base, item_id: id(2, index), source_id: null, parent_item_id: id(1, index), member_path: 'rows.csv',
      name: null, size_bytes: '512', size_class: 'S' },
  ]).flat();
}

function sourceRow(sourceId: string, actor: string) {
  return { id: sourceId, case_id: caseId, family_id: sourceId, revision: 1, name: 'file.zip',
    profile: 'tabular-manual-v1', bytes: '2048', sha256: 'b'.repeat(64), object_key: `sources/${sourceId}`,
    status: 'received', inspection: { actor } };
}

/** A counting client: every statement the manifest sends, answered from the rows above. */
function control(count: number, actorOf: (sourceId: string) => string | null = () => subject) {
  const items = itemRows(count);
  const statements: string[] = [];
  const client = { query: async (sql: string, values: unknown[]) => {
    statements.push(sql);
    if (sql.includes('FROM cases')) return { rows: [{ id: caseId, revision: 1, archived: false }] };
    if (sql.startsWith('SELECT i.*')) return { rows: values[0] === caseId ? items : [] };
    if (sql.includes('FROM sources')) {
      const asked = values[1] as string[];
      return { rows: asked.flatMap(sourceId => {
        const actor = actorOf(sourceId);
        return actor === null ? [] : [sourceRow(sourceId, actor)];
      }) };
    }
    throw new Error(`Unexpected protocol SQL: ${sql}`);
  } } as unknown as PoolClient;
  const service = new IntakeService({ transaction: async action => action(client) });
  return { service, statements };
}

async function configured(action: () => Promise<void>) {
  const previous = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = subject;
  try { await action(); }
  finally {
    if (previous === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previous;
  }
}

const refused = (status: number, code: string) => (error: unknown) =>
  error instanceof AppError && error.status === status && error.code === code;

test('the manifest reads a fixed number of statements for one batch file and for eighty', async () => {
  await configured(async () => {
    const one = control(1);
    const many = control(80);
    const small = await one.service.manifest(caseId);
    const large = await many.service.manifest(caseId);
    assert.equal(small.items.length, 2);
    assert.equal(large.items.length, 160);
    assert.equal(many.statements.length, one.statements.length);
    assert.equal(many.statements.length, 3);
    assert.deepEqual(IntakeManifestSchema.parse(large), large);
  });
});

test('one source of another access context or missing from the case still refuses the whole manifest', async () => {
  await configured(async () => {
    const foreign = control(5, sourceId => sourceId === id(1, 3) ? 'another-operator' : subject);
    await assert.rejects(foreign.service.manifest(caseId), refused(403, 'INTAKE_SOURCE_DENIED'));
    const missing = control(5, sourceId => sourceId === id(1, 2) ? null : subject);
    await assert.rejects(missing.service.manifest(caseId), refused(404, 'NOT_FOUND'));
  });
});

/** CN1 protocol control: one wide parent whose cell files went to four child batches, each a different outcome. */
function cellControl() {
  const at = new Date('2026-10-22T00:00:00Z');
  const child = (n: number) => ({ cellKey: `utm-20-e${n}-n12-l231-b270`, caseId: id(5, n), itemId: id(6, n),
    sourceId: id(6, n) });
  const refs = [1, 2, 3, 4].map(child);
  const parent = { case_id: caseId, item_id: id(1, 0), source_id: id(1, 0), parent_item_id: null, member_path: null,
    name: 'wide.geojson', family: 'vector', format: 'geojson', size_bytes: '4096', size_class: 'S', wave: 1,
    state: 'read', placement: 'on_map', card: null, card_sha256: null, probe_version: null,
    plan_ref: { recipeId: id(4, 1), recipeRevision: 1, recipeState: 'executed', origin: 'officer', packageId: null,
      cellFiles: refs },
    parts_planned: 1, parts_done: 1, records_seen: '9', limit_reason: null, pinned_by_officer: false,
    created_at: at, updated_at: at };
  // 1 opens; 2 belongs to another access context; 3's case is archived; 4 is no longer listed.
  const childItems = refs.slice(0, 3).map((ref, index) => ({ item_id: ref.itemId, case_id: ref.caseId,
    source_id: ref.sourceId, state: 'read', placement: 'on_map', archived: index === 2 }));
  const childSources = refs.slice(0, 3).map((ref, index) => ({ ...sourceRow(ref.sourceId, index === 1
    ? 'another-operator' : subject), case_id: ref.caseId }));
  const statements: string[] = [];
  const client = { query: async (sql: string, values: unknown[]) => {
    statements.push(sql);
    if (sql.includes('FROM cases')) return { rows: [{ id: caseId, revision: 1, archived: false }] };
    if (sql.startsWith('SELECT i.*')) return { rows: [parent] };
    if (sql.includes('JOIN cases c')) {
      return { rows: childItems.filter(row => (values[0] as string[]).includes(row.item_id)) };
    }
    if (sql.includes('FROM sources') && values.length === 1) {
      return { rows: childSources.filter(row => (values[0] as string[]).includes(row.id)) };
    }
    if (sql.includes('FROM sources')) return { rows: [sourceRow(parent.source_id, subject)] };
    throw new Error(`Unexpected protocol SQL: ${sql}`);
  } } as unknown as PoolClient;
  return { service: new IntakeService({ transaction: async action => action(client) }), statements, refs };
}

test('CN1: a wide file links only the cell batches this officer may already open, in two more reads', async () => {
  await configured(async () => {
    const { service, statements, refs } = cellControl();
    const manifest = await service.manifest(caseId);
    assert.deepEqual(IntakeManifestSchema.parse(manifest), manifest);
    const [item] = manifest.items;
    assert.deepEqual(item.cellBatches, [
      { cellKey: refs[0].cellKey, caseId: refs[0].caseId, itemId: refs[0].itemId, state: 'read', placement: 'on_map' },
      ...refs.slice(1).map(ref => ({ cellKey: ref.cellKey, caseId: null, itemId: null, state: null,
        placement: null })),
    ]);
    assert.equal(statements.length, 5);
    assert.equal(item.plan?.recipeState, 'executed');
    statements.length = 0;
    const one = await service.one(caseId, id(1, 0));
    assert.deepEqual(one.cellBatches, item.cellBatches);
  });
});
