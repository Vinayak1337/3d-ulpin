import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { exteriorOnlySql, isExteriorOnly } from './exterior-only';
import { importRegistryCase } from './registry-seed';
import { bodyOnly, commitRegistryReviewTx, persistRegistryReviewTx, prepareRegistryReview,
  recordBodySchema } from './registry';
import { setPreparationPlacement } from '../officer/officer-preparation';
import { fingerprint } from '../cases/domain';
import { settings } from '../../infrastructure/config';

const stamp = '2026-10-11T00:00:00.000Z';
const frame = { id: 'TEST', horizontalUnit: 'm', verticalUnit: 'm', benchmark: 'unknown' };
const ring = [[0, 0], [2, 0], [2, 2], [0, 2]];
const exterior = {
  alias: 'control', name: 'Technical control', kind: 'building', synthetic: false,
  representation: 'physical_exterior', footprint: [], links: [], rights: [], evidence: [],
};

async function memoryPool<T>(query: (sql: string, args: any[]) => Promise<any>, work: () => Promise<T>) {
  const globals = globalThis as any;
  const previous = globals.ulpinPool;
  globals.ulpinPool = { connect: async () => ({ query, release() {} }) };
  try { return await work(); } finally { globals.ulpinPool = previous; }
}

// A SQL-shape control, not a PostgreSQL execution or durability qualification.
function sqlExterior(body: any, alias = 'r') {
  assert.equal(exteriorOnlySql(alias), `COALESCE(${alias}.body->>'representation' = 'physical_exterior'`
    + ` AND ${alias}.body->'footprint' = '[]'::jsonb`
    + ` AND COALESCE(${alias}.body->'geometry', 'null'::jsonb) = 'null'::jsonb, false)`);
  return body.representation === 'physical_exterior' && JSON.stringify(body.footprint) === '[]'
    && (body.geometry ?? null) === null;
}

test('exterior-only body and SQL conditions agree, including missing fields under NOT', () => {
  for (const [body, expected] of [
    [exterior, true], [{ ...exterior, geometry: null }, true],
    [{ ...exterior, footprint: ring }, false], [{ ...exterior, geometry: {} }, false],
    [{ footprint: [] }, false], [{ representation: 'physical_exterior' }, false],
    [{ ...exterior, footprint: null }, false], [{ ...exterior, representation: null }, false],
    [{ ...exterior, geometry: false }, false],
  ] as const) {
    assert.equal(isExteriorOnly(body), expected);
    assert.equal(sqlExterior(body), expected);
  }
  assert.throws(() => exteriorOnlySql('r; DROP TABLE'), /alias/);
});

test('first detailed datum ignores only citation-only peers; actual and malformed detail still blocks', async () => {
  for (const [peer, blocked] of [[exterior, false], [{ ...exterior, footprint: ring }, true],
    [{ ...exterior, geometry: {} }, true], [{ footprint: [] }, true]] as const) {
    const site = { id: randomUUID(), frame: { ...frame }, revision: 1 };
    const pkg = { id: randomUUID(), areaId: randomUUID(), revision: 1, sourceRevisionIds: [], parts: [], warnings: [] };
    const prep = { id: randomUUID(), areaId: pkg.areaId, caseId: randomUUID(), buildingId: randomUUID(),
      revision: 1, placement: { revision: 1 } };
    let updated = false;
    const query = async (sql: string, args: any[]) => {
      let rows: any[] = [];
      if (sql.includes('FROM building_preparations')) rows = [{ body: structuredClone(prep) }];
      else if (sql.includes('FROM registry_sites')) rows = [structuredClone(site)];
      else if (sql.includes('FROM import_packages')) rows = [{ body: structuredClone(pkg) }];
      else if (sql.includes('SELECT id FROM sources')) rows = [{ id: args[0] }];
      else if (sql.includes('FROM physical_features')) rows = [{ body: { sourceKey: 'control' } }];
      else if (sql.includes('FROM registry_records')) {
        assert(sql.includes(`AND NOT ${exteriorOnlySql('r')}`));
        rows = sqlExterior(peer) ? [] : [{ '?column?': 1 }];
      } else if (sql.startsWith('UPDATE registry_sites')) updated = true;
      else assert(/^(BEGIN|COMMIT|ROLLBACK|SELECT pg_advisory|SELECT id FROM cases|UPDATE|INSERT)/.test(sql), sql);
      return { rows };
    };
    const work = () => setPreparationPlacement(pkg.id, 1, {
      sourceFrame: frame.id, verticalReference: 'technical reviewed datum', verticalOffset: 0,
      evidence: [{ sourceRevisionId: randomUUID(), featureId: 'control' }], reason: 'Technical control',
    });
    await memoryPool(query, async () => {
      if (blocked) await assert.rejects(work, (error: any) => error.code === 'EXISTING_DATUM');
      else assert.equal((await work()).placement.status, 'reviewed');
    });
    assert.equal(updated, !blocked);
  }
});

test('detailed import at revision one keeps identity, rights, metadata and history without the marker', async () => {
  const site = { id: randomUUID(), identifier: 'technical site', frame, revision: 1, synthetic: false };
  const caseId = randomUUID(), sourceId = randomUUID();
  const modelId = randomUUID(), recordId = randomUUID();
  const evidence = { sourceId, locator: 'feature control' };
  const registryMetadata = { address: { country: { state: 'unknown', value: null,
    evidence: [{ sourceId, sourceRevision: 1, sourceSha256: 'a'.repeat(64), locator: 'feature control' }] } } };
  const body = { ...exterior, evidence: [evidence], registryMetadata,
    rights: [{ type: 'ownership_claim', party: 'Technical control', evidence }] };
  const stored = { id: recordId, site_id: site.id, identifier: 'technical identity',
    kind: 'building', revision: 1, body };
  const before = structuredClone(stored);
  const model = { id: modelId, revision: 1, units: [], inputFingerprint: 'technical input',
    context: [{ alias: 'control', kind: 'building', footprint: ring, evidence }] };
  let imported: any[] = [];
  const query = async (sql: string, args: any[]) => {
    let rows: any[] = [];
    if (sql.includes('FROM cases')) rows = [{ id: caseId, revision: 1, site_id: site.id, frame,
      current_snapshot_id: modelId, created_at: stamp, updated_at: stamp }];
    else if (sql.includes('FROM sources')) rows = [{ id: sourceId, family_id: randomUUID(), created_at: stamp }];
    else if (sql.includes('FROM snapshots')) rows = [{ body: model }];
    else if (sql.includes('FROM registry_sites')) rows = [site];
    else if (sql.includes('FROM registry_case_feature_mappings')) rows = [{ record_id: recordId }];
    else if (sql.includes('FROM registry_records')) rows = [stored];
    else if (sql.startsWith('INSERT INTO registry_drafts')) imported = JSON.parse(args[3]);
    else assert(!/^(UPDATE registry_records|INSERT INTO registry_revisions)/.test(sql), sql);
    return { rows };
  };
  await memoryPool(query, () => importRegistryCase(site.id, caseId, 1));
  assert.equal(imported.length, 1);
  assert.equal(imported[0].representation, undefined);
  for (const key of ['id', 'identifier', 'revision']) assert.equal(imported[0][key], (stored as any)[key]);
  assert.deepEqual(imported[0].rights, body.rights);
  assert.deepEqual(imported[0].registryMetadata, body.registryMetadata);
  assert.deepEqual(stored, before);
  assert(recordBodySchema.safeParse(bodyOnly(imported[0])).success);
});

function reviewControl(peerBody: any = exterior, proposedBody?: any) {
  const site = { id: randomUUID(), identifier: 'technical site', name: 'Technical control',
    frame, revision: 1, synthetic: false };
  const caseId = randomUUID(), sourceId = randomUUID();
  const detailedBody = { alias: 'detailed', name: 'Technical detailed control', kind: 'building',
    footprint: ring, synthetic: false, links: [], rights: [], evidence: [{ sourceId, locator: 'feature detailed' }] };
  const proposed = { ...(proposedBody ?? detailedBody), id: randomUUID(), siteId: site.id,
    identifier: 'technical detail', revision: 0 };
  const peer = { id: randomUUID(), site_id: site.id, identifier: 'technical exterior', revision: 1, body: peerBody };
  const draft = { id: randomUUID(), site_id: site.id, case_id: caseId, revision: 1, status: 'draft',
    records: [proposed], created_at: stamp };
  const combined = [proposed];
  const review = { id: randomUUID(), draftId: draft.id, draftRevision: 1, siteRevision: 1,
    records: [proposed], before: [], findings: [], committed: false,
    inputFingerprint: fingerprint({ validatorVersion: 'registry-relationships-v2', records: combined,
      frame, draftRevision: 1, siteRevision: 1 }) };
  const queries: string[] = [];
  const query = async (sql: string, _args: any[]) => {
    queries.push(sql);
    let rows: any[] = [];
    if (sql.includes('FROM registry_sites')) rows = [site];
    else if (sql.includes('FROM registry_drafts')) rows = [draft];
    else if (sql.includes('FROM registry_reviews')) rows = [{ draft_id: draft.id, body: review, committed: false }];
    else if (sql.includes('FROM registry_records')) rows = [peer];
    else if (sql.includes('FROM sources')) rows = [{ id: sourceId, status: 'ready', profile: 'levels-csv-v1',
      case_id: caseId, created_at: stamp }];
    else assert(/^(SELECT|UPDATE|INSERT|DELETE|BEGIN|COMMIT|ROLLBACK|SET)/.test(sql), sql);
    return { rows, rowCount: rows.length };
  };
  const snapshot = { d: { id: draft.id, siteId: site.id, caseId, revision: 1, status: 'draft',
    records: draft.records, createdAt: stamp }, site, combined };
  return { client: { query } as unknown as PoolClient, snapshot, review, peer, queries };
}

test('prepare checks only detailed inputs; malformed peers and exterior proposals still fail', async () => {
  const previous = globalThis.fetch;
  const geoUrl = Object.getOwnPropertyDescriptor(settings, 'geoUrl')!;
  const geoToken = Object.getOwnPropertyDescriptor(settings, 'geoToken')!;
  Object.defineProperty(settings, 'geoUrl', { value: 'http://technical-control.invalid', configurable: true });
  Object.defineProperty(settings, 'geoToken', { value: 'technical-control-only', configurable: true });
  let checked = 0;
  globalThis.fetch = (async (_url: unknown, input: any) => {
    const payload = JSON.parse(input.body);
    assert.equal(payload.records.length, 1);
    assert.equal(payload.records[0].alias, 'detailed');
    checked++;
    return new Response(JSON.stringify({ units: [], findings: [] }));
  }) as typeof fetch;
  try {
    const control = reviewControl();
    await memoryPool(control.client.query.bind(control.client) as any,
      () => prepareRegistryReview(control.snapshot.d.id, 1, 1));
    for (const invalid of [reviewControl({ ...exterior, footprint: ring }), reviewControl(exterior, exterior)]) {
      await memoryPool(invalid.client.query.bind(invalid.client) as any,
        () => assert.rejects(() => prepareRegistryReview(invalid.snapshot.d.id, 1, 1),
          (error: any) => error.name === 'ZodError'));
    }
    assert.equal(checked, 1);
  } finally {
    globalThis.fetch = previous;
    Object.defineProperty(settings, 'geoUrl', geoUrl);
    Object.defineProperty(settings, 'geoToken', geoToken);
  }
});

test('persist and commit exclude unchanged exterior peers but never bypass proposed-body checks', async () => {
  const control = reviewControl();
  const before = structuredClone(control.peer);
  await persistRegistryReviewTx(control.client, control.snapshot as any, control.review as any);
  const result = await commitRegistryReviewTx(control.client, control.review.id, 'Technical control');
  assert.equal(result.committed, true);
  assert.deepEqual(control.peer, before);
  assert.equal(control.queries.filter(sql => sql.startsWith('INSERT INTO registry_revisions')).length, 1);
  const invalid = reviewControl(exterior, exterior);
  await assert.rejects(() => persistRegistryReviewTx(invalid.client, invalid.snapshot as any, invalid.review as any));
  await assert.rejects(() => commitRegistryReviewTx(invalid.client, invalid.review.id, 'Technical control'));
});

test('a malformed non-exterior peer cannot disappear from persisted or committed review inputs', async () => {
  const invalid = reviewControl({ ...exterior, footprint: ring });
  await assert.rejects(() => persistRegistryReviewTx(invalid.client, invalid.snapshot as any, invalid.review as any),
    (error: any) => error.code === 'STALE_REVISION');
  await assert.rejects(() => commitRegistryReviewTx(invalid.client, invalid.review.id, 'Technical control'),
    (error: any) => error.code === 'STALE_REVISION');
});
