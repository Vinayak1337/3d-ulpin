import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Pool, PoolClient } from 'pg';
import type { SpatialMlItem } from '@ulpin/contracts';
import { fingerprint } from '../cases/domain';
import {
  assertUndecidedFootprintComponentsTx, createSpatialMlFootprintDraft, recordRejectedFootprintsTx,
  spatialMlFootprintDraftSchema,
} from './spatial-ml-footprints';

const root = 'docs/evidence/gf-backend/k2c';
const read = (name: string) => JSON.parse(readFileSync(`${root}/${name}.json`, 'utf8'));
const items: SpatialMlItem[] = read('inference-items');
const item = items.find(value => value.result?.components.length)!;
const input = spatialMlFootprintDraftSchema.parse({ requestKey: item.id, expectedRevision: 2,
  expectedAreaRevision: 1, georeference: 'source_geotiff', selections: [],
  rejected: [{ componentId: item.result!.components[0].id, reason: 'K3c contract fixture rejection' }] });

function storedReceipt() {
  return { ...read('roofprint-draft').receipt, itemId: item.id, jobId: item.currentJobId,
    selections: [], decisions: [{ ...input.rejected![0], outcome: 'rejected',
      actor: 'fixture-operator', time: '2026-10-10T09:00:00Z' }] };
}

const selectionError = (error: unknown) => (error as { status: number; code: string }).status === 422
  && (error as { code: string }).code === 'ML_REVIEW_SELECTION';

test('reject-only needs a rejected component but no top-level acceptance reason', () => {
  assert.equal(input.reason, undefined);
  assert.equal(spatialMlFootprintDraftSchema.safeParse({ ...input, rejected: undefined }).success, false);
  assert.equal(spatialMlFootprintDraftSchema.safeParse({ ...input, rejected: [] }).success, false);
  assert.equal(spatialMlFootprintDraftSchema.safeParse({ ...input, rejected: [
    { componentId: input.rejected![0].componentId, reason: 'ab' },
  ] }).success, false);
});

test('the unchanged real K2c accept plus reject request still requires and retains its acceptance reason', () => {
  const accepted = read('roofprint-request');
  const parsed = spatialMlFootprintDraftSchema.parse(accepted);
  assert.deepEqual(parsed, accepted);
  assert(parsed.selections.length && parsed.rejected?.length && parsed.reason);
  assert.equal(spatialMlFootprintDraftSchema.safeParse({ ...accepted, reason: undefined }).success, false);
});

test('reject-only writes one null-package receipt without package, feature or item mutations', async () => {
  const statements: { sql: string; values: unknown[] }[] = [];
  const client = { query: async (sql: string, values: unknown[]) => {
    statements.push({ sql, values });
    return { rows: [] };
  } } as unknown as PoolClient;
  const receipt = storedReceipt();
  const result = await recordRejectedFootprintsTx(client, item.id, input, fingerprint(input), receipt);
  assert.equal(result.package, null);
  assert.deepEqual(result.receipt, receipt);
  assert.equal(statements.length, 1);
  assert.match(statements[0].sql, /^INSERT INTO spatial_ml_footprint_drafts/);
  assert.equal(statements[0].values[3], null);
  assert.deepEqual(statements[0].values[4], receipt);
  assert.deepEqual(receipt.selections, []);
  assert.equal(receipt.decisions[0].outcome, 'rejected');
});

test('a later acceptance cannot overwrite a rejection of this exact current inference component', async () => {
  const client = { query: async () => ({ rows: [{ body: storedReceipt() }] }) } as unknown as PoolClient;
  const accepted = { ...input, selections: [{ componentId: input.rejected![0].componentId, subject: 'fixture' }],
    rejected: [], reason: 'Later acceptance is not allowed' };
  await assert.rejects(() => assertUndecidedFootprintComponentsTx(client, item, accepted), selectionError);
});

test('null-package request-key replay returns the exact receipt and refuses a changed digest without package reads',
  async () => {
    const receipt = storedReceipt();
    const statements: string[] = [];
    const client = { release: () => {}, query: async (sql: string) => {
      statements.push(sql);
      if (sql.includes('FROM spatial_ml_items')) return { rows: [{ body: item, private_input: {} }] };
      if (sql.includes('FROM spatial_ml_footprint_drafts')) {
        return { rows: [{ request_digest: fingerprint(input), package_id: null, body: receipt }] };
      }
      assert(['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.includes('pg_advisory_xact_lock'), sql);
      return { rows: [] };
    } } as unknown as PoolClient;
    const globals = globalThis as unknown as { ulpinPool?: Pool };
    const previous = globals.ulpinPool;
    globals.ulpinPool = { query: client.query, connect: async () => client } as unknown as Pool;
    try {
      assert.deepEqual(await createSpatialMlFootprintDraft(item.id, input), { package: null, receipt });
      await assert.rejects(() => createSpatialMlFootprintDraft(item.id, { ...input, reason: 'Changed input' }),
        (error: unknown) => (error as { code: string }).code === 'ML_APPLY_KEY');
      assert(statements.every(sql => !sql.includes('FROM import_packages')));
    } finally {
      globals.ulpinPool = previous;
    }
  });
