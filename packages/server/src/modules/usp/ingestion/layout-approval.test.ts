import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { SourceProfileSchema, type MappingReceipt } from '@ulpin/contracts/usp';
import { approveWithTx, carriedApprovalTx, carryTx, layoutApprovalTx } from './service';

process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'lc1-protocol-operator';
const subject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
const caseId = '20000000-0000-4000-8000-000000000001';
const otherCase = '20000000-0000-4000-8000-000000000009';
const files = ['20000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-00000000000b',
  '20000000-0000-4000-8000-00000000000c'];
const columns = 'c'.repeat(64);
const profile = SourceProfileSchema.parse({ version: 'manual-geojson/1',
  source: { sourceId: files[0], familyId: files[0], sourceRevision: 1, sourceSha256: '1'.repeat(64),
    schemaFingerprint: columns },
  caseId, workspaceRevision: 0, workspaceFingerprint: 'f'.repeat(64), format: 'geojson', featureCount: 1,
  crs: { value: 'EPSG:4326', evidence: 'Protocol fixture', unit: 'degree' }, geometryTypes: ['Polygon'],
  paths: [], limitations: [] });
const operations = [
  { target: 'building.sourceKey' as const, sourcePath: '/features/*/properties/id',
    conversionId: 'literal_identifier@1' as const },
  { target: 'building.geometry' as const, sourcePath: '/features/*/geometry',
    conversionId: 'geojson_polygon@1' as const },
];
const at = '2026-10-17T09:00:00.000Z';

/** The file `index` of one layout, proposed at its first revision with the plan pinned to that file. */
function proposed(index: number, change: { caseId?: string; columns?: string; sourcePath?: string } = {}) {
  const sourceId = files[index];
  const plan = { version: profile.version, mode: 'manual_mapping' as const, caseId: change.caseId ?? caseId,
    source: { ...profile.source, sourceId, familyId: sourceId, sourceSha256: String(index + 1).repeat(64),
      schemaFingerprint: change.columns ?? columns },
    workspaceRevision: 0, workspaceFingerprint: profile.workspaceFingerprint,
    operations: change.sourcePath ? [{ ...operations[0], sourcePath: change.sourcePath }, operations[1]]
      : operations };
  const receipt: MappingReceipt = { id: sourceId.replace('-00000000000', '-10000000000'), revision: 1,
    state: 'proposed', plan, destination: { kind: 'new_area', name: `File ${index}`, namespace: `file:${index}` },
    planHash: String(index + 4).repeat(64), authoredBy: subject, authoredAt: at, approval: null, execution: null };
  return receipt;
}
function pressed(receipt: MappingReceipt): MappingReceipt {
  return { ...receipt, revision: 2, state: 'approved', approval: { subject, at, planHash: receipt.planHash,
    provenance: 'server_configured_local_operator' } };
}

function store(...receipts: MappingReceipt[]) {
  const recipes = new Map(receipts.map(receipt => [receipt.id, structuredClone(receipt)]));
  const operationRows = new Map<string, unknown>();
  const statements: string[] = [];
  const rows = (sql: string, values: any[]): any[] => {
    const held = [...recipes.values()].filter(body => ['approved', 'executed'].includes(body.state));
    if (sql.startsWith('SELECT body FROM usp_mapping_recipes WHERE case_id=$1 AND source_id<>$2'))
      return held.filter(body => body.plan.caseId === values[0] && body.plan.source.sourceId !== values[1]
        && body.approval?.subject === values[2] && body.plan.source.schemaFingerprint === values[3])
        .sort((a, b) => b.approval!.at.localeCompare(a.approval!.at) || b.id.localeCompare(a.id))
        .map(body => ({ body }));
    if (sql.startsWith('SELECT body FROM usp_mapping_recipes WHERE id=$1 AND case_id=$2'))
      return held.filter(body => body.id === values[0] && body.plan.caseId === values[1]).map(body => ({ body }));
    if (sql.startsWith('SELECT result FROM operations'))
      return operationRows.has(values[1]) ? [{ result: operationRows.get(values[1]) }] : [];
    if (sql.startsWith('UPDATE usp_mapping_recipes SET')) {
      recipes.set(values[0], structuredClone(values[3]));
      return [];
    }
    if (sql.startsWith('INSERT INTO operations')) {
      operationRows.set(values[1], values[3]);
      return [];
    }
    if (sql.startsWith('SELECT revision FROM cases')) return [{ revision: 0 }];
    if (sql.startsWith('UPDATE usp_outbox_streams')) return [{ sequence: '1' }];
    if (sql.startsWith('INSERT INTO usp_mapping_recipe_revisions') || sql.startsWith('INSERT INTO usp_outbox'))
      return [];
    throw new Error(`Unexpected layout approval SQL: ${sql}`);
  };
  const client = { query: async (sql: string, values: any[]) => {
    statements.push(sql);
    const result = rows(sql, values);
    return { rows: result, rowCount: result.length };
  } } as unknown as PoolClient;
  return { client, recipes, operationRows, statements };
}

test('two files of one layout: one press drafts both, and the second records the press it used', async () => {
  const press = pressed(proposed(0));
  const { client, recipes, operationRows } = store(press, proposed(1));
  assert.equal(await carriedApprovalTx(client, press), null);
  const second = recipes.get(proposed(1).id)!;
  const found = await layoutApprovalTx(client, second.plan, subject);
  assert.deepEqual(found && { recipeId: found.recipeId, sourceId: found.sourceId, approval: found.approval },
    { recipeId: press.id, sourceId: files[0], approval: press.approval });
  const carried = await approveWithTx(client, second, found!);
  assert.equal(carried.state, 'approved');
  assert.equal(carried.revision, 2);
  assert.deepEqual(carried.approval, { ...press.approval, planHash: second.planHash });
  assert.deepEqual(recipes.get(second.id), carried);
  assert.deepEqual(await carriedApprovalTx(client, carried), found);
  assert.equal(operationRows.size, 1);
  // A third file of the layout cites the officer's press, not the approval carried to the second file.
  const third = proposed(2);
  recipes.set(third.id, third);
  assert.equal((await layoutApprovalTx(client, third.plan, subject))?.recipeId, press.id);
});

test('a renamed or retyped column and a changed layout ask again', async () => {
  const { client } = store(pressed(proposed(0)));
  assert.equal(await layoutApprovalTx(client, proposed(1, { columns: 'd'.repeat(64) }).plan, subject), null);
  assert.equal(await layoutApprovalTx(client,
    proposed(1, { sourcePath: '/features/*/properties/name' }).plan, subject), null);
});

test('another case asks again', async () => {
  const { client } = store(pressed(proposed(0)));
  assert.equal(await layoutApprovalTx(client, proposed(1, { caseId: otherCase }).plan, subject), null);
  assert.equal(await layoutApprovalTx(client, proposed(1).plan, 'another-operator'), null);
});

test('a refused or corrected plan is never carried, and a withdrawn press stops its carried files', async () => {
  const press = pressed(proposed(0));
  const { client, recipes, statements } = store(press, proposed(1));
  const corrected = { ...proposed(1), revision: 3 };
  assert.equal(await carryTx(client, { revision: 0, fingerprint: 'f'.repeat(64) }, corrected, subject), corrected);
  assert.equal(statements.length, 0);
  const second = recipes.get(proposed(1).id)!;
  const carried = await approveWithTx(client, second, (await layoutApprovalTx(client, second.plan, subject))!);
  recipes.set(press.id, { ...press, revision: 3, state: 'proposed', approval: null });
  assert.equal(await layoutApprovalTx(client, proposed(2).plan, subject), null);
  await assert.rejects(carriedApprovalTx(client, carried), { status: 409, code: 'RECIPE_APPROVAL' });
});
