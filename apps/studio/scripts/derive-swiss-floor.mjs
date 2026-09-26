#!/usr/bin/env node
/**
 * Derives the Studio's local responses for one real multi-unit floor from the retained Swiss Dwellings
 * sample (fixtures/usp/D5/gf0-multiunit-v1, CC BY 4.0). Deterministic; verifies the sample's SHA-256.
 *
 * What the source supports, and what it does not:
 * - Room polygons (entity_type "area"), their apartment and unit IDs, and the source floor ID.
 * - No coordinate reference system and no stated coordinate unit, so the building is parked in its
 *   own local frame: not placed on any map, and no area in m² is claimed.
 * - No heights or level elevations: every lower/upper stays null (Unknown), drawn flat, never guessed.
 * - No rights or parties: rights stay Unknown.
 *
 * Run: node apps/studio/scripts/derive-swiss-floor.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, parseWktPolygon, round, sha256, uuidV5 } from './lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const packDir = join(root, 'fixtures/usp/D5/gf0-multiunit-v1');
const outDir = join(root, 'apps/studio/src/local/data');
const expected = JSON.parse(readFileSync(join(packDir, 'expected.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(packDir, 'manifest.json'), 'utf8'));
const sampleFile = 'swiss-floor-127-164-717.csv';
const bytes = readFileSync(join(packDir, sampleFile));
const hash = sha256(bytes);
if (hash !== expected.sampleSha256) throw new Error(`Sample hash ${hash} does not match ${expected.sampleSha256}`);
const rows = parseCsv(bytes.toString('utf8'));
if (rows.length !== expected.rowCount) throw new Error(`Row count ${rows.length} differs from ${expected.rowCount}`);

const asset = manifest.assets[0];
const { site_id: siteKey, building_id: buildingKey, floor_id: floorKey } = expected.sourceKey;
const sourceId = uuidV5(`source:${hash}`);
const areaId = uuidV5(`area:swiss-dwellings:${siteKey}:${hash}`);
const siteId = uuidV5(`site:swiss-dwellings:${siteKey}`);
const buildingId = uuidV5(`building:${hash}:${buildingKey}`);
const floorId = uuidV5(`floor:${hash}:${floorKey}`);
const now = '2026-09-26T00:00:00.000Z';
const levelLabel = `Source floor ${floorKey}`;
const NOT_STATED = 'not stated by the source';
const title = (s) => s.toLowerCase().split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const locator = (index) => `${sampleFile} row ${index + 2}`; // header is row 1

const rooms = rows.map((row, index) => ({ row, index })).filter(({ row }) => row.entity_type === 'area');
const units = [...new Set(rooms.map(({ row }) => row.unit_id))].sort();

const unitRecords = units.map((unitKey) => {
  const first = rows.findIndex((r) => r.unit_id === unitKey);
  return {
    id: uuidV5(`unit:${hash}:${unitKey}`), identifier: `SD-${siteKey}-${buildingKey}-${unitKey}`, ulpin3d: `SD-${siteKey}-${buildingKey}-${unitKey}`,
    name: `Unit ${unitKey}`, kind: 'space', revision: 1, use: 'apartment', footprint: [],
    links: [{ targetId: floorId, type: 'floor' }, { targetId: buildingId, type: 'within' }],
    evidence: [{ sourceId, locator: `${locator(first)} (unit_id ${unitKey}, apartment_id ${rows[first].apartment_id})` }],
  };
});
const unitIdByKey = new Map(units.map((key, i) => [key, unitRecords[i].id]));

const roomRecords = rooms.map(({ row, index }) => {
  const rings = parseWktPolygon(row.geometry).map((ring) => ring.map(([x, y]) => [round(x, 4), round(y, 4)]));
  const id = uuidV5(`room:${hash}:${row.area_id}`);
  return {
    id, identifier: `SD-${siteKey}-${buildingKey}-${row.unit_id}-${Number(row.area_id)}`, ulpin3d: `SD-${siteKey}-${buildingKey}-${row.unit_id}-${Number(row.area_id)}`,
    name: `${title(row.entity_subtype)} · unit ${row.unit_id}`, kind: 'space', revision: 1, use: 'unspecified',
    footprint: rings[0],
    geometry: {
      id, alias: `room-${Number(row.area_id)}`, name: title(row.entity_subtype), kind: 'room', footprint: rings[0],
      lower: null, upper: null, lowerVerified: false, upperVerified: false,
      bindings: { footprint: { sourceId, locator: locator(index) } }, revision: 1, levelLabel,
    },
    links: [{ targetId: unitIdByKey.get(row.unit_id), type: 'within' }, { targetId: floorId, type: 'floor' }],
    evidence: [{ sourceId, locator: locator(index) }],
  };
});

const floorRecord = {
  id: floorId, identifier: `SD-${siteKey}-${buildingKey}-F${floorKey}`, ulpin3d: `SD-${siteKey}-${buildingKey}-F${floorKey}`,
  name: levelLabel, kind: 'floor', revision: 1, footprint: [],
  links: [{ targetId: buildingId, type: 'within' }],
  evidence: [{ sourceId, locator: `${sampleFile} floor_id ${floorKey}` }],
};

const allRings = roomRecords.map((r) => r.footprint);
const xs = allRings.flat().map((p) => p[0]);
const ys = allRings.flat().map((p) => p[1]);
const extent = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => round(v, 3));
const buildingGeometry = { type: 'MultiPolygon', coordinates: allRings.map((ring) => [ring]) };
const height = { state: 'unknown', value: null, unit: 'm', meaning: 'building height', reference: NOT_STATED, evidence: [] };

const area = {
  id: areaId, siteId, name: `Swiss Dwellings site ${siteKey} · local source frame, not placed`, revision: 1,
  reference: null, extent, geographicExtent: null, administrativeUnits: [], dataKind: 'real', featureCount: 1,
};
const buildingFeature = {
  id: buildingId, identifier: `SD-${siteKey}-${buildingKey}`, areaId, revision: 1, sourceRevisionId: sourceId,
  datasetNamespace: 'swiss-dwellings', sourceKey: `${siteKey}/${buildingKey}`, name: `Swiss Dwellings building ${buildingKey}`,
  kind: 'building', geometry: buildingGeometry, geographicGeometry: buildingGeometry, sourceGeometry: null,
  height, worldStatus: 'observed', properties: { site_id: siteKey, building_id: buildingKey, floors_in_sample: [floorKey] },
  areaM2: null, evidence: [{ sourceRevisionId: sourceId, jsonPointer: `/${sampleFile}` }], representation: 'physical_exterior',
  geometryRole: 'source_room_polygons',
  semantics: { geometryRole: 'source_room_polygons', evidenceState: 'source_supported', levelReference: NOT_STATED },
};
const context = { area, features: [buildingFeature], packages: [], latestCheck: null, parcelAssociations: [], parcelIdentifiers: [], sceneAssets: [] };

const source = {
  id: sourceId, name: sampleFile, sha256: hash, revision: 1, profile: 'swiss-dwellings-geometries-csv', createdAt: asset.provenance.acquiredAt,
  url: `/api/v1/sources/${sourceId}/file`, evidence: [],
};
const register = {
  schemaVersion: 'ulpin-officer-export/1', exportedAt: now,
  property: { id: buildingId, identifier: buildingFeature.identifier, ulpin3d: buildingFeature.identifier, name: buildingFeature.name,
    revision: 1, geometryRole: 'source_room_polygons', worldStatus: 'observed', geometry: buildingGeometry, geographicGeometry: buildingGeometry, height },
  area, associations: [], parcelIdentifiers: [],
  register: [floorRecord, ...unitRecords, ...roomRecords],
  sources: [source],
  missing: [
    'Level elevations and heights are not stated by the source.',
    'The source states no coordinate reference system or unit, so the building is not placed on a map and areas are not assessed.',
    'No rights, parties or parcel association are in the source.',
    `The sample holds one floor (${floorKey}) of building ${buildingKey}; other floors were not acquired.`,
  ],
  selection: { id: buildingId, kind: 'building', name: buildingFeature.name, ulpin3d: buildingFeature.identifier },
  ulpin3d: buildingFeature.identifier, buildingUlpin3d: buildingFeature.identifier,
  findingsScope: 'building',
  geometryQualification: { state: 'not_assessed', purpose: 'retained_source_inspection', missing: [] },
  findings: [],
  findingQualification: { state: 'not_assessed', missing: [] },
  scope: 'Local technical record from a retained source; no official title, certificate or legal order.',
};

const lineage = {
  derivation: relative(root, fileURLToPath(import.meta.url)),
  source: { pack: relative(root, join(packDir, 'manifest.json')), file: relative(root, join(packDir, sampleFile)), sha256: hash,
    record: expected.sourceRecord, attribution: asset.attribution, licence: 'CC BY 4.0', geography: 'Switzerland (foreign test geography; never placed on Indian coordinates)' },
  limits: register.missing,
  outputs: {},
};
const write = (name, value) => { const text = `${JSON.stringify(value, null, 1)}\n`; writeFileSync(join(outDir, name), text); lineage.outputs[name] = sha256(text); };
write('swiss-floor-area.json', area);
write('swiss-floor-context.json', context);
write('swiss-floor-register.json', register);
writeFileSync(join(outDir, 'swiss-floor-lineage.json'), `${JSON.stringify(lineage, null, 1)}\n`);
console.log(`Derived ${units.length} units and ${roomRecords.length} rooms on ${levelLabel}`);
