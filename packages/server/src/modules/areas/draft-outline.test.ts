import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { PoolClient } from 'pg';
import type { PhysicalFeature } from '@ulpin/contracts';
import { writeDraftFeaturesTx } from './areas';

/** Every statement that reads a physical feature's stored outline, each matched within one SQL string and required
 * to keep only recorded rows: a draft row now holds its outline in geographic_geometry, so a reader without the
 * revision filter would take a proposal as recorded. */
const AREAS = 'packages/server/src/modules/areas/';
const READERS: [string, string, RegExp][] = [
  ['site snapshot', 'packages/server/src/modules/usp/snapshots.ts',
    /ST_AsGeoJSON\(f\.geographic_geometry\)[^`]*WHERE a\.site_id=\$1 AND f\.revision>0 ORDER BY/],
  ['targeted snapshot', 'packages/server/src/modules/usp/snapshots.ts',
    /ST_AsGeoJSON\(f\.geographic_geometry\)[^`]*WHERE a\.site_id=\$1 AND f\.revision>0 AND f\.record_id=ANY/],
  ['area read', `${AREAS}areas.ts`,
    /ST_Transform\(f\.geographic_geometry[^`]*FROM physical_features f WHERE f\.revision>0/],
  ['area neighbours', `${AREAS}areas.ts`,
    /ST_Transform\(geographic_geometry[^`]*revision>0 AND \(\(\$10::boolean/],
  ['review context, own area', `${AREAS}areas.ts`,
    /WHERE area_id=\$1 AND revision>0[^`]*ST_Intersects\(geometry,/],
  ['review context, neighbours', `${AREAS}areas.ts`,
    /WHERE area_id<>\$1 AND revision>0[^`]*ST_Intersects\(ST_SetSRID\(ST_Translate\(ST_Transform\(geographic_geometry/],
  ['review context, parcels', `${AREAS}areas.ts`, /a\.status='confirmed'\s+AND f\.revision>0 AND f\.id<>ALL/],
  ['review context, group members', `${AREAS}areas.ts`, /g\.area_id=\$1 AND f\.area_id<>\$1 AND f\.revision>0/],
  ['area check', `${AREAS}areas.ts`,
    /const CHECKED_FEATURES_SQL = `physical_features f WHERE f\.revision>0/],
  ['window read', `${AREAS}area-display-window.ts`, /const MEMBERS = `f\.revision>0 AND/],
  ['officer feature', 'packages/server/src/modules/officer/officer.ts',
    /"SELECT body FROM physical_features WHERE id=\$1 AND revision>0"/],
  ['officer dossier parcels', 'packages/server/src/modules/officer/officer.ts',
    /WHERE b\.id=\$1 AND p\.revision>0[^`]*ST_Intersects\(p\.geographic_geometry,b\.geographic_geometry\)/],
  ['spatial core read', 'packages/server/src/modules/spatial/spatial-core-read.ts',
    /FROM physical_features f JOIN map_areas a[^`]*f\.revision>0/],
  ['area resolver', `${AREAS}area-resolver.ts`,
    /area_id=\$1 AND revision>0 AND body->>'kind'='building' AND ST_Intersects\(geometry/],
];

test('every reader of a stored outline keeps only recorded rows', () => {
  for (const [reader, file, statement] of READERS) {
    assert.match(readFileSync(file, 'utf8'), statement, reader);
  }
});

/** The statements a draft write sends, against a client that records them. */
async function draftStatements(linkedRevision?: number) {
  const sent: [string, unknown[]][] = [];
  const client = {
    query: async (sql: string, values: unknown[]) => { sent.push([sql, values]); return { rows: [] }; },
  };
  const ring = [[-79.05, 43.09], [-79.04, 43.09], [-79.04, 43.1], [-79.05, 43.09]];
  const outline = { type: 'Polygon', coordinates: [ring] };
  const feature = { id: 'f-1', areaId: 'a-1', identifier: 'S:B001', geometry: { type: 'Polygon', coordinates: [] },
    geographicGeometry: outline } as unknown as PhysicalFeature;
  await writeDraftFeaturesTx(client as unknown as PoolClient, 'test_only',
    [{ feature, recordId: 'r-1', linkedRevision }]);
  return { sent, outline: JSON.stringify(outline) };
}

test('a draft row carries its outline in geographic_geometry and none in geometry', async () => {
  const { sent: [[sql, values]], outline } = await draftStatements();
  assert.match(sql, /INSERT INTO physical_features\(id,area_id,record_id,identifier,body,geographic_geometry\)/);
  assert.match(sql, /ST_SetSRID\(ST_GeomFromGeoJSON\(outline::text\),4326\)/);
  assert.equal(JSON.stringify(JSON.parse(values[0] as string)[0].outline), outline);
  assert.doesNotMatch(sql, /[(,]geometry[,)=]/);
});

test('a redraft moves only a never-recorded row to its newer outline; a recorded row is left alone', async () => {
  const { sent: [[sql, values]], outline } = await draftStatements(0);
  assert.match(sql, /^UPDATE physical_features\s+SET geographic_geometry=/);
  assert.match(sql, /WHERE id=\$1 AND revision=0$/);
  assert.deepEqual(values, ['f-1', outline]);
  assert.deepEqual((await draftStatements(3)).sent, []);
});
