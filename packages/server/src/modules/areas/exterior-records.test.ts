import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { PhysicalFeature } from '@ulpin/contracts';
import type { PoolClient } from 'pg';
import { recordCommittedExteriorsTx } from './exterior-records';
import { sha256 } from '../../infrastructure/storage';

const ordinaryGeometry = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
function feature(patch: Record<string, any> = {}): PhysicalFeature {
  const sourceRevisionId = randomUUID();
  return { id: randomUUID(), areaId: randomUUID(), identifier: 'Technical map identity', revision: 1,
    sourceRevisionId, datasetNamespace: 'technical-controls', sourceKey: 'native key', name: 'Technical control',
    kind: 'building', representation: 'physical_exterior', worldStatus: 'observed', properties: {},
    evidence: [{ sourceRevisionId, featureId: 'native key' }], sourceGeometry: ordinaryGeometry,
    geometry: ordinaryGeometry, geographicGeometry: ordinaryGeometry, areaM2: null,
    height: { state: 'unknown', value: null, unit: 'm', meaning: 'unknown', reference: 'unknown' },
    ...patch } as PhysicalFeature;
}

function memory(features: readonly PhysicalFeature[]) {
  const areaId = randomUUID(), siteId = randomUUID();
  const records = features.map(item => ({ feature_id: item.id, id: randomUUID(), site_id: siteId,
    identifier: `Technical record ${item.id}`, kind: item.kind, revision: 0,
    body: { alias: item.sourceKey, name: item.name, kind: item.kind, representation: 'physical_exterior',
      footprint: [], links: [], rights: [], evidence: [], synthetic: false, retainedMetadata: 'untouched' } as any }));
  const history: any[][] = [], queries: string[] = [];
  const state = { siteRevision: 7, changedAfterLookup: false };
  const client = { query: async (sql: string, args: any[] = []) => {
    queries.push(sql);
    let rows: any[] = [];
    if (sql.includes('FROM physical_features p')) {
      assert(sql.includes('r.id=p.record_id'));
      assert(sql.includes('a.site_id=r.site_id'));
      assert.equal(args[0], areaId);
      rows = records.filter(row => args[1].includes(row.feature_id)).map(row => structuredClone(row));
    } else if (sql.includes('FROM registry_sites')) {
      if (state.changedAfterLookup) records[0].revision = 2;
      rows = [{ id: siteId, revision: state.siteRevision }];
    } else if (sql.includes('FROM registry_records')) {
      assert.equal(args[1], siteId);
      rows = records.filter(row => args[0].includes(row.id)).map(row => structuredClone(row));
    } else if (sql.startsWith('UPDATE registry_records')) {
      const record = records.find(row => row.id === args[0])!;
      record.revision = 1;
      record.body = structuredClone(args[1]);
    } else if (sql.startsWith('INSERT INTO registry_revisions')) history.push(structuredClone(args));
    else if (sql.startsWith('UPDATE registry_sites')) state.siteRevision++;
    else throw new Error(`Unexpected SQL: ${sql}`);
    return { rows };
  } } as unknown as PoolClient;
  return { client, areaId, siteId, records, history, queries, state };
}

test('one batch records each reserved identity with its own citations and a shared site revision', async () => {
  const first = feature();
  const second = feature({ evidence: [
    { sourceRevisionId: randomUUID(), featureId: 'different native key' },
    { sourceRevisionId: randomUUID(), featureId: 'another original feature' },
  ] });
  const input = [first, second], before = structuredClone(input), control = memory(input);
  const reserved = structuredClone(control.records);
  assert.equal(await recordCommittedExteriorsTx(control.client, control.areaId, input), 2);
  assert.equal(control.state.siteRevision, 8);
  assert.equal(control.queries.filter(sql => sql.startsWith('UPDATE registry_sites')).length, 1);
  assert.equal(control.queries.filter(sql => sql.includes('FOR UPDATE OF s')).length, 1);
  for (const [index, record] of control.records.entries()) {
    assert.notEqual(record.id, input[index].id);
    assert.equal(record.revision, 1);
    assert.deepEqual(record.body, { ...reserved[index].body, id: record.id, siteId: control.siteId,
      identifier: record.identifier, revision: 1,
      evidence: input[index].evidence.map(entry => ({ sourceId: entry.sourceRevisionId,
        locator: `feature ${entry.featureId}` })) });
    assert.equal(record.body.geometry, undefined);
    assert.deepEqual(record.body.rights, []);
  }
  assert.deepEqual(control.history.map(row => row[2]), [8, 8]);
  assert(control.queries.indexOf(control.queries.find(sql => sql.includes('FOR UPDATE OF s'))!)
    < control.queries.indexOf(control.queries.find(sql => sql.includes('ORDER BY id FOR UPDATE'))!));
  assert.deepEqual(input, before);
  assert.equal(await recordCommittedExteriorsTx(control.client, control.areaId, input), 0);
  assert.equal(control.history.length, 2);
  assert.equal(control.state.siteRevision, 8);
});

test('planned, hypothetical, synthetic, non-building and derived observations never lock a site', async () => {
  const input = [feature({ worldStatus: 'planned' }), feature({ worldStatus: 'hypothetical' }),
    feature({ worldStatus: 'synthetic' }), feature({ kind: 'parcel' }), feature({ kind: 'road' }),
    feature({ properties: { spatialExtraction: { retained: 'receipt' } } }),
    feature({ properties: { spatialExtraction: null } }), feature({ evidence: [] }),
    feature({ evidence: [{ sourceRevisionId: randomUUID(), page: 1 }] })];
  const control = memory(input), before = structuredClone(control.records);
  assert.equal(await recordCommittedExteriorsTx(control.client, control.areaId, input), 0);
  assert.deepEqual(control.queries, []);
  assert.deepEqual(control.records, before);
});

test('recorded, detailed, populated and malformed reservations are kept unchanged without a site lock', async () => {
  for (const patch of [{ revision: 1 }, { revision: 2 }, { body: { footprint: [[0, 0]] } },
    { body: { geometry: {} } }, { body: { rights: [{}] } }, { body: { evidence: [{}] } },
    { body: { footprint: null } }, { body: { evidence: null } }, { body: { representation: null } }]) {
    const input = [feature()], control = memory(input);
    const { body, ...columns } = patch;
    Object.assign(control.records[0], columns);
    Object.assign(control.records[0].body, body);
    const before = structuredClone(control.records);
    assert.equal(await recordCommittedExteriorsTx(control.client, control.areaId, input), 0);
    assert.deepEqual(control.records, before);
    assert(!control.queries.some(sql => sql.includes('FOR UPDATE')));
  }
});

test('a reservation changed while waiting is rechecked and never overwritten or advances its site', async () => {
  const input = [feature()], control = memory(input);
  control.state.changedAfterLookup = true;
  assert.equal(await recordCommittedExteriorsTx(control.client, control.areaId, input), 0);
  assert.equal(control.records[0].revision, 2);
  assert.equal(control.state.siteRevision, 7);
  assert.deepEqual(control.history, []);
});

test('foreign or missing mapped identities stay out; shared identities fail before site locking', async () => {
  const input = [feature(), feature()], control = memory(input);
  control.records.splice(0, control.records.length);
  assert.equal(await recordCommittedExteriorsTx(control.client, control.areaId, input), 0);
  assert(!control.queries.some(sql => sql.includes('FOR UPDATE')));
  const shared = memory(input);
  shared.records[1].id = shared.records[0].id;
  await assert.rejects(() => recordCommittedExteriorsTx(shared.client, shared.areaId, input),
    (error: any) => error.code === 'STALE_REVISION');
  assert(!shared.queries.some(sql => sql.includes('FOR UPDATE')));
});

test('ordinary and sparse NYC upload-pack features retain exact feature citations, absent detail and original bytes',
  async () => {
    const path = 'E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson';
    const bytes = await readFile(path);
    assert.equal(sha256(bytes), '107561166456f2c3aa4d6c6510c46e3b9a7c9eb91824762fbf7ba47b0d05ac8e');
    const original = JSON.parse(bytes.toString());
    assert.equal(original.features.length, 1662);
    const input = [0, 1620].map(index => {
      const native = original.features[index];
      const sourceKey = String(native.properties.doitt_id);
      // Only the helper's persisted feature shape is under test; no normalization/placement is claimed.
      return feature({ sourceKey, sourceFeatureIndex: index, name: sourceKey, properties: native.properties,
        sourceGeometry: native.geometry, geometry: native.geometry, geographicGeometry: native.geometry,
        semantics: { evidenceState: 'unresolved' },
        evidence: [{ sourceRevisionId: randomUUID(), featureId: sourceKey }] });
    });
    assert.equal(input[1].properties.ground_elevation, null);
    const control = memory(input);
    assert.equal(await recordCommittedExteriorsTx(control.client, control.areaId, input), 2);
    assert.deepEqual(control.records.map(record => record.body.evidence[0].locator),
      ['feature 345', 'feature 1272393']);
    for (const record of control.records) {
      assert.deepEqual(record.body.footprint, []);
      assert.deepEqual(record.body.rights, []);
      assert.equal(record.body.geometry, undefined);
      assert.equal(record.body.height, undefined);
      assert.equal(record.body.registryMetadata, undefined);
      assert.equal(record.body.officialUlpin, undefined);
    }
    assert.equal(sha256(await readFile(path)), sha256(bytes));
  });
