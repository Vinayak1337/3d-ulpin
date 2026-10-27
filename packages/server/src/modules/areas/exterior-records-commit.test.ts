import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { commitPackage } from './areas';
import { canonical, fingerprint } from '../cases/domain';
import { sha256 } from '../../infrastructure/storage';
import { captureRegistrySnapshotTx } from '../usp/snapshots';
import { localRequestContext } from '../usp/principal';

function packageControl() {
  const siteId = randomUUID(), areaId = randomUUID(), sourceId = randomUUID();
  const featureId = randomUUID(), recordId = randomUUID();
  const geometry = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 0]]] };
  const feature = { id: featureId, areaId, identifier: 'Technical map identity', revision: 0,
    sourceRevisionId: sourceId, datasetNamespace: 'technical-control', sourceKey: 'exact native key',
    name: 'Technical control', kind: 'building', representation: 'physical_exterior', worldStatus: 'observed',
    properties: {}, evidence: [{ sourceRevisionId: sourceId, featureId: 'exact native key' }],
    sourceGeometry: geometry, geometry, geographicGeometry: geometry, areaM2: null,
    height: { state: 'unknown', value: null, unit: 'm', meaning: 'unknown', reference: 'unknown' } };
  const area = { id: areaId, site_id: siteId, revision: 0, reference: null, extent: [0, 0, 2, 2],
    geographic_extent: [0, 0, 2, 2] };
  const site = { id: siteId, revision: 0, frame: { id: 'TEST', benchmark: 'unknown', horizontalUnit: 'm' } };
  const record = { id: recordId, site_id: siteId, identifier: 'Technical registry identity', kind: 'building',
    revision: 0, body: { alias: feature.sourceKey, name: feature.name, kind: 'building',
      representation: 'physical_exterior', footprint: [], links: [], rights: [], evidence: [], synthetic: false } };
  const pkg: any = { id: randomUUID(), areaId, revision: 1, state: 'REVIEWED', sourceRevisionIds: [sourceId],
    parts: [], features: [feature], extent: area.extent, geographicExtent: area.geographic_extent,
    review: { packageRevision: 1, areaRevision: 0, inputFingerprint: '' } };
  function pinReview() {
    const extent = [-255, -255, 257, 257];
    pkg.review = { packageRevision: pkg.revision, areaRevision: area.revision,
      scope: { validator: 'area-check-officer-v2', marginMetres: 255, extent, contextCount: 0,
        unqualifiedInScope: 0, areaRevisionAtReview: area.revision },
      inputFingerprint: sha256(canonical({ features: pkg.features, associations: [], reference: area.reference,
        context: [], extent, marginMetres: 255, packageRevision: pkg.revision, validator: 'area-check-officer-v2' })) };
    pkg.reviewDependencyPins = { reference: sha256(canonical(area.reference)),
      ownFeatures: sha256(canonical(pkg.features)), associations: sha256(canonical([])), context: [] };
  }
  pinReview();
  const queries: string[] = [], history: any[][] = [], captures: any[][] = [];
  let physicalRevision = 0;
  const query = async (sql: string, args: any[] = []) => {
    queries.push(sql);
    let rows: any[] = [];
    if (sql.startsWith('SELECT DISTINCT ON(q.namespace')) rows = [];
    else if (sql.startsWith('WITH bounds')) rows = [{ body: null, unqualified_count: 0 }];
    else if (sql.includes('FROM import_packages')) rows = [{ body: structuredClone(pkg) }];
    else if (sql.includes('FROM sources')) {
      rows = sql.includes('JOIN cases') ? [] : [{ id: sourceId, status: 'interpreted', profile: 'area-geojson-v2' }];
    } else if (sql.includes('FROM map_areas')) rows = [structuredClone(area)];
    else if (sql.includes('FROM physical_features p JOIN registry_records')) {
      assert(sql.includes('r.id=p.record_id'));
      rows = [{ ...structuredClone(record), feature_id: featureId }];
    } else if (sql.includes('FROM physical_features f JOIN map_areas')) {
      rows = physicalRevision ? [{ id: featureId, area_id: areaId, record_id: recordId,
        identifier: feature.identifier, revision: physicalRevision, body: structuredClone(pkg.features[0]) }] : [];
    } else if (sql.includes('FROM physical_features')) {
      rows = sql.includes('SELECT revision') ? [{ revision: physicalRevision }] : [];
    } else if (sql.includes('FROM registry_sites')) rows = [structuredClone(site)];
    else if (sql.includes('FROM registry_records')) rows = record.revision > 0 || sql.includes('FOR UPDATE')
      ? [structuredClone(record)] : [];
    else if (sql.startsWith('UPDATE physical_features')) physicalRevision = args[1];
    else if (sql.startsWith('UPDATE registry_records')) {
      assert.equal(args[0], recordId);
      record.revision = 1;
      record.body = structuredClone(args[1]);
    } else if (sql.startsWith('INSERT INTO registry_revisions')) history.push(structuredClone(args));
    else if (sql.startsWith('UPDATE registry_sites')) site.revision++;
    else if (sql.startsWith('UPDATE map_areas')) area.revision++;
    else if (sql.startsWith('UPDATE import_packages')) Object.assign(pkg, structuredClone(args[3]));
    else if (sql.startsWith('INSERT INTO usp_snapshot_bodies')) captures.push(structuredClone(args));
    else assert(/^(BEGIN|COMMIT|ROLLBACK|SELECT pg_advisory|INSERT INTO|UPDATE external_identifiers)/.test(sql)
      || ['property_associations', 'usp_project_lineage', 'registry_aliases', 'usp_geometry_qualifications',
        'usp_declaration_revisions', 'usp_applicability_revisions'].some(table => sql.includes(table)), sql);
    return { rows, rowCount: rows.length };
  };
  return { pkg, area, site, record, featureId, queries, history, captures, query, pinReview };
}

async function memoryPool<T>(control: ReturnType<typeof packageControl>, work: () => Promise<T>) {
  const globals = globalThis as any, previous = globals.ulpinPool;
  globals.ulpinPool = { connect: async () => ({ query: control.query, release() {} }) };
  try { return await work(); } finally { globals.ulpinPool = previous; }
}

test('reviewed native package records after physical history and before area bump; replay and correction keep records',
  async () => {
    const control = packageControl();
    await memoryPool(control, async () => {
      const committed = await commitPackage(control.pkg.id, 1, 'Technical observation acknowledgement');
      assert.equal(committed.state, 'COMMITTED');
      assert.equal(control.area.revision, 1);
      assert.equal(control.site.revision, 1);
      assert.equal(control.record.revision, 1);
      assert.equal(control.history.length, 1);
      const physicalHistory = control.queries.findIndex(sql =>
        sql.startsWith('INSERT INTO physical_feature_revisions'));
      const registryHistory = control.queries.findIndex(sql => sql.startsWith('INSERT INTO registry_revisions'));
      const areaBump = control.queries.findIndex(sql => sql.startsWith('UPDATE map_areas'));
      const areaLock = control.queries.findIndex(sql =>
        sql.includes('FROM map_areas') && sql.includes('FOR UPDATE'));
      const siteLock = control.queries.findIndex(sql =>
        sql.includes('FROM registry_sites') && sql.includes('FOR UPDATE'));
      assert(physicalHistory < registryHistory && registryHistory < areaBump && areaLock < siteLock);
      const recorded = fingerprint(control.record);
      control.queries.length = 0;
      assert.equal((await commitPackage(control.pkg.id, 1, '')).state, 'COMMITTED');
      assert(!control.queries.some(sql => /^(UPDATE|INSERT)/.test(sql)));
      control.pkg.id = randomUUID();
      control.pkg.state = 'REVIEWED';
      control.pkg.revision = 1;
      control.pkg.features[0].name = 'Technical corrected observation';
      control.pinReview();
      await commitPackage(control.pkg.id, 1, 'Technical correction acknowledgement');
      assert.equal(fingerprint(control.record), recorded);
      assert.equal(control.history.length, 1);
      assert.equal(control.area.revision, 2);
      assert.equal(control.site.revision, 1);
    });
  });

test('stale review, changed physical baseline and missing acknowledgement never reach registry recording', async () => {
  for (const change of ['reference', 'physical', 'fingerprint', 'acknowledgement']) {
    const control = packageControl();
    if (change === 'reference') (control.area as any).reference = { analysisCrs: 'EPSG:32618', origin: [0, 0] };
    if (change === 'physical') { control.pkg.features[0].revision = 3; control.pinReview(); }
    if (change === 'fingerprint') control.pkg.review.inputFingerprint = 'changed';
    await memoryPool(control, () => assert.rejects(() => commitPackage(control.pkg.id, 1,
      change === 'acknowledgement' ? '' : 'Technical control'),
    (error: any) => ['STALE_REVISION', 'ACKNOWLEDGEMENT_REQUIRED'].includes(error.code)));
    assert.equal(control.record.revision, 0);
    assert.deepEqual(control.history, []);
    assert(!control.queries.some(sql => sql.includes('FROM registry_sites')));
  }
});

test('canonical snapshot includes the lifted revision-one identity without rights, geometry or project issuance',
  async () => {
    const control = packageControl();
    await memoryPool(control, () => commitPackage(control.pkg.id, 1, 'Technical control'));
    const previous = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'technical-ca1-control';
    try {
      // Snapshot reads/writes use memory only; source authority is a separate CA4/runtime qualification.
      const ctx = localRequestContext(randomUUID());
      const manifest = await captureRegistrySnapshotTx({ query: control.query } as any, ctx, control.site.id,
        { kind: 'targets', pins: [{ ref: { namespace: 'registry_record', id: control.record.id }, revision: 1 }] });
      assert(manifest.members.some(member => member.pin.ref.namespace === 'registry_record'
        && member.pin.ref.id === control.record.id && member.pin.revision === 1));
      const row = control.captures.find(args => args[1] === 'registry_record')![5];
      assert.equal(row.projectIdentity, null);
      assert.deepEqual(row.body.rights, []);
      assert.deepEqual(row.body.footprint, []);
      assert.equal(row.body.geometry, undefined);
      assert.notEqual(control.record.id, control.featureId);
    } finally {
      if (previous === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
      else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previous;
    }
  });
