import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { PhysicalFeature, RegistryRecord } from '@ulpin/contracts';
import type { PoolClient } from 'pg';
import { recordCommittedExteriorsTx } from '../areas/exterior-records';
import { fingerprint } from '../cases/domain';
import { bodyOnly } from './registry';
import type { RegistryDocumentDependencies } from './registry-document-evidence';
import { readRegistryRecordEvidenceTx } from './registry-record-evidence';
import { attributed } from './registry-recorded-source.test-fixture';

const frame = { id: 'TEST', horizontalUnit: 'm', verticalUnit: 'm', benchmark: 'unknown' };
const polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const strict = (error: any) => error.name === 'ZodError';

/** A GeoJSON building observed by its source, as the committed area package carries it. Values are protocol-only. */
function observedBuilding(): PhysicalFeature {
  const sourceRevisionId = randomUUID();
  return { id: randomUUID(), areaId: randomUUID(), identifier: 'Technical map identity', revision: 1,
    sourceRevisionId, datasetNamespace: 'technical-controls', sourceKey: '1001693', name: 'Technical control',
    kind: 'building', representation: 'physical_exterior', worldStatus: 'observed', properties: {},
    evidence: [{ sourceRevisionId, featureId: '1001693' }], sourceGeometry: polygon, geometry: polygon,
    geographicGeometry: polygon, areaM2: null,
    height: { state: 'unknown', value: null, unit: 'm', meaning: 'unknown', reference: 'unknown' } } as PhysicalFeature;
}

/** The reserved revision-0 identity the area import stores, recorded at revision 1 by the real exterior writer. */
async function writtenRevisionOne() {
  const feature = observedBuilding(), siteId = randomUUID(), areaId = feature.areaId;
  const record = { feature_id: feature.id, id: randomUUID(), site_id: siteId, identifier: 'technical site:B001',
    kind: 'building', revision: 0, body: { alias: '1001693', name: 'Technical control', kind: 'building',
      footprint: [], links: [], rights: [], evidence: [], synthetic: false, representation: 'physical_exterior' } };
  const written: { body?: Record<string, unknown> } = {};
  const query = async (sql: string, args: any[]) => {
    if (sql.includes('FROM physical_features p') || sql.includes('FROM registry_records')) return { rows: [record] };
    if (sql.includes('FROM registry_sites')) return { rows: [{ id: siteId, revision: 4 }] };
    if (sql.startsWith('INSERT INTO registry_revisions')) written.body = structuredClone(args[1]);
    else assert(/^UPDATE registry_(records|sites)/.test(sql), sql);
    return { rows: [] };
  };
  assert.equal(await recordCommittedExteriorsTx({ query } as unknown as PoolClient, areaId, [feature]), 1);
  return { record: { id: record.id, site_id: siteId, identifier: record.identifier, kind: 'building' },
    body: written.body!, site: { id: siteId, identifier: 'technical site', name: 'Technical control', frame,
      revision: 5, synthetic: false } };
}

type Written = Awaited<ReturnType<typeof writtenRevisionOne>>;

/** The SQL the record-evidence read issues for one committed revision, answered from memory. */
function evidenceRead(written: Written, current: { revision: number; body: unknown }, selected: unknown) {
  const capture = { body: current.body, selected_body: selected, project_status: null,
    record: { ...written.record, revision: current.revision },
    history: { record_id: written.record.id, revision: 1, site_revision: 5 }, site: written.site };
  const query = async (sql: string) => {
    if (sql.includes('selected_body')) return { rows: [capture] };
    if (sql.includes('FROM registry_records')) return { rows: [{ ...capture.record, body: current.body,
      project_status: null }] };
    assert(/^SELECT (pg_advisory_xact_lock|id FROM registry_sites)/.test(sql), sql);
    return { rows: [] };
  };
  const unread = async () => assert.fail('a read without document citations opens no document');
  const dependencies = { source: unread, result: unread, citationSource: unread,
    registrySource: async () => ({}) } as unknown as RegistryDocumentDependencies;
  return (revision: number) => readRegistryRecordEvidenceTx({ query } as unknown as PoolClient,
    { recordId: written.record.id, revision }, dependencies);
}

test('the writer stores the record envelope inside the revision-1 exterior-only body', async () => {
  const written = await writtenRevisionOne();
  assert.deepEqual(Object.keys(written.body).filter(key => ['id', 'siteId', 'revision', 'identifier'].includes(key))
    .sort(), ['id', 'identifier', 'revision', 'siteId']);
  assert.deepEqual([written.body.footprint, written.body.representation], [[], 'physical_exterior']);
});

test('a revision-1 exterior-only body repeating its own envelope is read, its stored hash unchanged', () =>
  attributed(async () => {
    const written = await writtenRevisionOne();
    const read = await evidenceRead(written, { revision: 1, body: written.body }, written.body)(1);
    assert.deepEqual([read.recordRevision, read.snapshotState, read.citations], [1, 'current', []]);
    assert.equal(read.recordBodySha256, fingerprint(written.body));
  }));

test('revision 1 stays readable as history once a commit stores revision 2 without the envelope', () =>
  attributed(async () => {
    const written = await writtenRevisionOne();
    const corrected = bodyOnly({ ...written.body, name: 'Technical control corrected' } as unknown as RegistryRecord);
    const read = await evidenceRead(written, { revision: 2, body: corrected }, written.body)(1);
    assert.deepEqual([read.recordRevision, read.currentRecordRevision, read.snapshotState], [1, 2, 'historical']);
  }));

test('an envelope value other than its row value, or any other unknown key, is still refused', () =>
  attributed(async () => {
    const written = await writtenRevisionOne();
    for (const patch of [{ siteId: randomUUID() }, { id: randomUUID() }, { identifier: 'technical site:B002' },
      { revision: 2 }, { retainedMetadata: 'unknown key' }]) {
      const body = { ...written.body, ...patch };
      await assert.rejects(evidenceRead(written, { revision: 1, body }, body)(1), strict, JSON.stringify(patch));
    }
    const stale = await writtenRevisionOne();
    await assert.rejects(evidenceRead(stale, { revision: 2, body: stale.body }, stale.body)(1), strict,
      'a revision-1 envelope on a revision-2 current body is refused');
  }));
