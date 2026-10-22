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
