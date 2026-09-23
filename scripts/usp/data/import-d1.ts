/** Bounded 3DBAG D1 receipt into the existing area/source authorities. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ImportPackage } from '../../../packages/contracts/src';
import { assertUspIsolation } from '../local-isolation.mjs';
import { verifyUspPack } from './verify-pack';

const root = path.resolve('fixtures/usp/D1/single-roof');
const namespace = 'usp-d1-3dbag-single-roof-v1';
const name = '3DBAG single roof · real source';
const buildingId = 'NL.IMBAG.Pand.1655100000500568';
const originalSha256 = '5dcfc3bb7ded9bbe4c6f5ed2b73fbe3ae0c27131812b221ec14996379c441af2';
const attribution = '© 3DBAG by tudelft3d and 3DGI — https://docs.3dbag.nl/en/copyright/';
const acknowledgement = 'Reviewed 3DBAG LoD 0 source footprint derived from a retained, byte-identical CityJSONFeature (EPSG:7415 RD New + NAP). The 2D outline is a building-source observation only. No measured height, interior, unit, parcel right, qualified NAP-to-global placement or analytical mesh is asserted.';
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const limitations = [
  'Only the supplied LoD 0 horizontal footprint is imported as analytical 2D geometry; roof mesh remains in the retained original.',
  'The current geometry-role vocabulary has no building_footprint value, so the footprint role is unknown.',
  'NAP-to-ellipsoid/global placement is unqualified; do not infer an elevation correction or cross-source measurement.',
  'No source-backed height, internal floors, units, parcel rights or analytical 3D mesh is available.',
];

type Derived = {
  original: Buffer;
  sourceSha256: string;
  sourceBuildingId: string;
  gisBytes: Buffer;
  derivedGisSha256: string;
  featureSet: {
    spatialReference: { wkid: 28992 };
    features: [{ attributes: Record<string, string>; geometry: { rings: number[][][] } }];
  };
};

/** No service imports or writes: suitable for the default plan and source-oracle tests. */
export async function deriveD1(): Promise<Derived> {
  const checked = await verifyUspPack(path.join(root, 'manifest.json'));
  assert.equal(checked.packId, 'D1');
  assert.equal(checked.profile, 'single-roof');
  const original = await readFile(path.join(root, 'original.json'));
  const sourceSha256 = sha256(original);
  assert.equal(sourceSha256, originalSha256, 'D1 original differs from the acquired source');
  const source = JSON.parse(original.toString('utf8'));
  const metadata = source.metadata;
  assert.equal(source.id, buildingId);
  assert.equal(source.feature?.id, buildingId);
  assert.equal(source.feature?.type, 'CityJSONFeature');
  assert.equal(metadata?.type, 'CityJSON');
  assert.equal(metadata?.version, '2.0');
  assert.equal(metadata?.metadata?.referenceSystem, 'https://www.opengis.net/def/crs/EPSG/0/7415');
  const scale = metadata?.transform?.scale;
  const translate = metadata?.transform?.translate;
  assert.deepEqual(scale, [0.001, 0.001, 0.001]);
  assert.deepEqual(translate, [91447.4215, 398435.80225, 0.0005041809082015902]);
  const vertices = source.feature.vertices;
  assert.ok(Array.isArray(vertices) && vertices.length === 62);
  const building = source.feature.CityObjects?.[buildingId];
  assert.equal(building?.type, 'Building');
  assert.deepEqual(building?.children, [`${buildingId}-0`]);
  assert.equal(building?.attributes?.b3_bouwlagen, null);
  const footprint = building.geometry?.find((geometry: { lod: string }) => geometry.lod === '0');
  assert.equal(footprint?.type, 'MultiSurface');
  assert.equal(footprint.boundaries.length, 1, 'D1 requires one supplied LoD 0 surface');
  assert.equal(footprint.boundaries[0].length, 1, 'D1 requires one exterior ring and no unsupported hole');
  const indices: unknown[] = footprint.boundaries[0][0];
  assert.ok(Array.isArray(indices) && indices.length >= 3 && indices.length <= 64);
  const ring = indices.map(index => {
    assert.ok(Number.isInteger(index) && Number(index) >= 0 && Number(index) < vertices.length);
    const integer = vertices[Number(index)];
    assert.ok(Array.isArray(integer) && integer.length === 3 && integer.every(Number.isInteger));
    assert.equal(integer[2], 0, 'LoD 0 ring must be horizontal');
    return [integer[0] * scale[0] + translate[0], integer[1] * scale[1] + translate[1]];
  });
  assert.equal(new Set(ring.map(point => point.join(','))).size, ring.length, 'LoD 0 ring contains a repeated vertex');
  assert.ok(ring.every(point => point.every(Number.isFinite)));
  const closed = [...ring, ring[0]];
  const signedArea = ring.reduce((sum, point, index) => {
    const next = ring[(index + 1) % ring.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
  assert.ok(Math.abs(signedArea) > 1, 'LoD 0 source ring has no bounded area');
  const featureSet: Derived['featureSet'] = {
    spatialReference: { wkid: 28992 },
    features: [{
      attributes: {
        id: buildingId,
        name: '3DBAG building 1655100000500568',
        source_provider: '3DBAG',
        attribution,
        external_cityjson_sha256: sourceSha256,
        external_cityjson_id: buildingId,
      },
      geometry: { rings: [closed] },
    }],
  };
  const gisBytes = Buffer.from(JSON.stringify(featureSet));
  assert.ok(gisBytes.length < 16 * 1024 * 1024);
  return { original, sourceSha256, sourceBuildingId: buildingId, gisBytes,
    derivedGisSha256: sha256(gisBytes), featureSet };
}

async function apply(derived: Derived) {
  const isolation = assertUspIsolation(process.env);
  const { areaContext, attachDocument, commitPackage, ingestArea, reviewPackage } = await import('../../../apps/web/lib/server/areas');
  const { pool, query } = await import('../../../apps/web/lib/server/db');
  const { readObject } = await import('../../../apps/web/lib/server/storage');
  const lock = await pool().connect();
  try {
    const claimed = (await lock.query("SELECT pg_try_advisory_lock(hashtext('usp-d1-3dbag-single-roof-v1-import')) ok")).rows[0]?.ok;
    if (!claimed) throw Error('Another D1 import is active');
    const previous = (await query(
      "SELECT body FROM import_packages WHERE body->>'datasetNamespace'=$1 ORDER BY created_at LIMIT 2",
      [namespace],
    )).rows.map(row => row.body as ImportPackage);
    if (previous.length > 1) throw Error('D1 namespace has multiple packages; inspect them before import');
    let pkg: ImportPackage;
    if (previous[0]) {
      pkg = previous[0];
      if (pkg.state !== 'COMMITTED') throw Error(`D1 package ${pkg.id} is ${pkg.state}; inspect before resuming`);
    } else {
      pkg = await ingestArea({
        bytes: derived.gisBytes, filename: '3dbag-lod0-footprint.arcgis.json', format: 'arcgis',
        namespace, name, worldStatus: 'observed', sourceCrs: 'EPSG:28992',
        mapping: {
          idField: 'id', nameField: 'name', kind: 'building', geometryRole: 'unknown',
          identifierFields: ['source_provider', 'attribution', 'external_cityjson_sha256', 'external_cityjson_id'],
        },
      });
      if (pkg.features.length !== 1 || pkg.features[0].sourceKey !== buildingId || pkg.sourceRevisionIds.length !== 1)
        throw Error('D1 intake did not produce exactly one source-backed building');
      pkg = await attachDocument(pkg.id, pkg.revision, {
        bytes: derived.original, name: '3dbag-cityjsonfeature-original.json', format: 'text',
        entityIds: [pkg.features[0].id], requestKey: `d1-original-${derived.sourceSha256}`,
      });
      if (pkg.sourceRevisionIds.length !== 2 || !pkg.parts.some(part =>
        part.sourceRevisionId === pkg.sourceRevisionIds[1] && part.entityIds?.includes(pkg.features[0].id)))
        throw Error('D1 original did not retain an associated source part');
      pkg = await reviewPackage(pkg.id, pkg.revision);
      pkg = await commitPackage(pkg.id, pkg.revision, acknowledgement);
    }
    if (pkg.name !== name || pkg.datasetNamespace !== namespace || pkg.features.length !== 1 || pkg.sourceRevisionIds.length !== 2)
      throw Error('D1 committed package identity or source membership is incomplete');
    const feature = pkg.features[0];
    if (feature.kind !== 'building' || feature.sourceKey !== buildingId || feature.worldStatus !== 'observed'
      || feature.height.value !== null || feature.properties.external_cityjson_sha256 !== derived.sourceSha256
      || feature.properties.external_cityjson_id !== buildingId || feature.properties.source_provider !== '3DBAG'
      || feature.properties.attribution !== attribution)
      throw Error('D1 feature identity, source markers or null height differs from the bounded plan');
    const sources = (await query(
      'SELECT id,sha256,bytes,object_key,profile FROM sources WHERE id=ANY($1::uuid[])',
      [pkg.sourceRevisionIds],
    )).rows;
    if (sources.length !== 2) throw Error('D1 source revisions missing');
    const gis = sources.find(row => row.sha256 === derived.derivedGisSha256 && row.profile === 'arcgis-area-v2');
    const original = sources.find(row => row.sha256 === derived.sourceSha256 && row.profile === 'text-reference-v2');
    if (!gis || !original || gis.id === original.id || Number(gis.bytes) !== derived.gisBytes.length
      || Number(original.bytes) !== derived.original.length)
      throw Error('D1 derived GIS or original source revision/hash is ambiguous');
    if (!pkg.parts.some(part => part.sourceRevisionId === original.id && part.entityIds?.includes(feature.id)))
      throw Error('D1 original has no package part associated with the building');
    if (sha256(await readObject(original.object_key)) !== derived.sourceSha256)
      throw Error('D1 stored original bytes differ from the fixture');
    const context = await areaContext(pkg.areaId);
    const current = context.features.find(item => item.id === feature.id);
    if (!current || current.sourceKey !== buildingId || current.properties.external_cityjson_sha256 !== derived.sourceSha256
      || current.properties.external_cityjson_id !== buildingId)
      throw Error('D1 current building is missing or its source markers changed; preserve edits and inspect');
    return {
      schemaVersion: 'usp-d1-import-receipt/1', isolationId: isolation.id,
      packageId: pkg.id, areaId: pkg.areaId, featureId: feature.id,
      sourceRevisionId: original.id, sourceSha256: derived.sourceSha256,
      sourceBuildingId: derived.sourceBuildingId, derivedSourceRevisionId: gis.id,
      derivedGisSha256: derived.derivedGisSha256, limitations,
    };
  } finally {
    await lock.query("SELECT pg_advisory_unlock(hashtext('usp-d1-3dbag-single-roof-v1-import'))").catch(() => {});
    lock.release();
    await pool().end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--apply'))
    throw Error('Usage: tsx scripts/usp/data/import-d1.ts [--apply]');
  const derived = await deriveD1();
  if (!args.length) {
    console.log(JSON.stringify({ schemaVersion: 'usp-d1-import-plan/1', action: 'plan-only; no service or database writes',
      namespace, name, sourceSha256: derived.sourceSha256, sourceBuildingId: derived.sourceBuildingId,
      derivedGisSha256: derived.derivedGisSha256, derivedGisBytes: derived.gisBytes.length,
      spatialReference: derived.featureSet.spatialReference, geometryRole: 'unknown',
      ringVertices: derived.featureSet.features[0].geometry.rings[0].length, limitations }, null, 2));
    return;
  }
  const receipt = await apply(derived);
  const receiptPath = path.resolve(`.runtime/engineering/usp-d1-import-${receipt.isolationId}.json`);
  await mkdir(path.dirname(receiptPath), { recursive: true });
  try {
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const prior = JSON.parse(await readFile(receiptPath, 'utf8'));
    assert.deepEqual(prior, receipt, 'Existing D1 receipt differs; preserving both data and receipt for review');
  }
  console.log(JSON.stringify({ ...receipt, receiptPath }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'D1 import failed'); process.exitCode = 1; });
}
