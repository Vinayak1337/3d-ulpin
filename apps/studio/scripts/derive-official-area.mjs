#!/usr/bin/env node
/**
 * Derives the Studio's local `GET /areas` and `GET /areas/{areaId}/context` responses from the
 * retained NYC OTI Bronx crop (fixtures/real-area). Deterministic: same original bytes, same output.
 *
 * - Verifies the original's SHA-256 against its manifest before reading it.
 * - Keeps every source value as recorded; adds nothing the source does not state.
 * - IDs are UUIDv5 from the original hash and DOITT_ID, so they are stable and traceable.
 * - Positions: WGS 84 longitude/latitude → local east/north metres on a tangent plane at the
 *   crop's first-feature centroid. Roof height is converted with the manifest's metres-per-foot.
 *   Heights stay building-relative: the source does not state a per-feature vertical datum.
 *
 * Run: node apps/studio/scripts/derive-official-area.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const sourceDir = join(root, 'fixtures/real-area');
const outDir = join(root, 'apps/studio/src/local/data');
const TRANSFORM = 'studio-local/wgs84-enu-tangent/1';

const manifest = JSON.parse(readFileSync(join(sourceDir, 'manifest.json'), 'utf8'));
const originalBytes = readFileSync(join(sourceDir, manifest.sourceFile));
const sha256 = createHash('sha256').update(originalBytes).digest('hex');
if (sha256 !== manifest.sourceSha256) throw new Error(`Original hash ${sha256} does not match manifest ${manifest.sourceSha256}`);
const original = JSON.parse(originalBytes.toString('utf8'));
if (original.features.length !== manifest.countAfter) throw new Error('Feature count differs from the manifest count');

const NAMESPACE = uuidV5('ulpin-studio-local-derivation', '6ba7b811-9dad-11d1-80b4-00c04fd430c8');
const sourceRevisionId = uuidV5(`source:${sha256}`, NAMESPACE);
const areaId = uuidV5(`area:${manifest.areaKey}:${sha256}`, NAMESPACE);
const siteId = uuidV5(`site:${manifest.areaKey}`, NAMESPACE);

// Tangent-plane origin: centroid of the first feature's outer ring (the source's own order).
const firstRing = original.features[0].geometry.coordinates[0][0];
const origin = centroid(firstRing);
const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F);
const lat0 = (origin[1] * Math.PI) / 180;
const sinLat = Math.sin(lat0);
const metresPerDegLat = (Math.PI / 180) * A * (1 - E2) / Math.pow(1 - E2 * sinLat * sinLat, 1.5);
const metresPerDegLon = (Math.PI / 180) * A * Math.cos(lat0) / Math.sqrt(1 - E2 * sinLat * sinLat);
const toLocal = ([lon, lat]) => [round((lon - origin[0]) * metresPerDegLon, 3), round((lat - origin[1]) * metresPerDegLat, 3)];

const metresPerFoot = manifest.vertical.metresPerFoot;
const verticalReference = 'building ground (per-feature datum not stated by the source)';
const reference = {
  sourceCrs: manifest.sourceCRS,
  analysisCrs: `local east/north metres, tangent plane at ${origin[0]}, ${origin[1]} (WGS 84)`,
  origin: [0, 0],
  anchor: origin,
  transformVersion: TRANSFORM,
  verticalReference,
};

const features = original.features.map((feature, index) => {
  const p = feature.properties;
  const id = uuidV5(`feature:${sha256}:${p.doitt_id}`, NAMESPACE);
  const heightFeet = p.height_roof === null || p.height_roof === undefined ? null : Number(p.height_roof);
  const heightM = heightFeet === null || Number.isNaN(heightFeet) ? null : round(heightFeet * metresPerFoot, 3);
  const localGeometry = { type: 'MultiPolygon', coordinates: feature.geometry.coordinates.map((poly) => poly.map((ring) => ring.map(toLocal))) };
  const pointer = `/features/${index}`;
  const evidence = [{ sourceRevisionId, featureId: String(p.doitt_id), jsonPointer: pointer }];
  return {
    id,
    identifier: `DOITT ${p.doitt_id}`,
    areaId,
    revision: 1,
    sourceRevisionId,
    datasetNamespace: manifest.sourceCatalogId,
    sourceKey: String(p.doitt_id),
    name: `BIN ${p.bin}`,
    kind: 'building',
    geometry: localGeometry,
    geographicGeometry: feature.geometry,
    sourceGeometry: feature.geometry,
    sourceReference: reference,
    height: heightM === null
      ? { state: 'unknown', value: null, unit: 'm', meaning: manifest.vertical.meaning, reference: verticalReference, evidence }
      : {
          state: 'source_supported', value: heightM, unit: 'm', meaning: manifest.vertical.meaning, reference: verticalReference,
          evidence: [{ ...evidence[0], jsonPointer: `${pointer}/properties/height_roof` }],
          method: `height_roof × ${metresPerFoot} m/ft`, originalValue: p.height_roof, originalUnit: manifest.vertical.unit,
        },
    worldStatus: 'observed',
    properties: {
      doitt_id: p.doitt_id, bin: p.bin, base_bbl: p.base_bbl, ground_elevation: p.ground_elevation,
      height_roof: p.height_roof, feature_code: p.feature_code, geom_source: p.geom_source, last_edited_date: p.last_edited_date,
    },
    areaM2: round(localGeometry.coordinates.reduce((sum, poly) => sum + Math.abs(ringArea(poly[0])) - poly.slice(1).reduce((h, r) => h + Math.abs(ringArea(r)), 0), 0), 2),
    evidence,
    representation: 'physical_exterior',
    geometryRole: 'footprint',
    semantics: {
      geometryRole: 'footprint', evidenceState: heightM === null ? 'unknown' : 'source_supported',
      levelReference: verticalReference, sourceDate: p.last_edited_date,
    },
  };
});

const xs = features.flatMap((f) => f.geometry.coordinates.flat(2).map((c) => c[0]));
const ys = features.flatMap((f) => f.geometry.coordinates.flat(2).map((c) => c[1]));
const lons = original.features.flatMap((f) => f.geometry.coordinates.flat(2).map((c) => c[0]));
const lats = original.features.flatMap((f) => f.geometry.coordinates.flat(2).map((c) => c[1]));
const area = {
  id: areaId,
  siteId,
  name: manifest.name,
  revision: 1,
  reference,
  extent: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  geographicExtent: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
  administrativeUnits: [],
  dataKind: 'real',
  featureCount: features.length,
};

const context = { area, features, packages: [], latestCheck: null, parcelAssociations: [], parcelIdentifiers: [], sceneAssets: [] };
const lineage = {
  derivation: relative(root, fileURLToPath(import.meta.url)),
  transformVersion: TRANSFORM,
  source: {
    manifest: relative(root, join(sourceDir, 'manifest.json')),
    file: relative(root, join(sourceDir, manifest.sourceFile)),
    sha256,
    provider: manifest.provider,
    datasetUrl: manifest.datasetUrl,
    retrievedAt: manifest.retrievedAt,
    attribution: manifest.license.attribution,
    termsUrl: manifest.license.termsUrl,
    geography: 'New York, USA (foreign test geography; never placed on Indian coordinates)',
  },
  limits: [
    'Building-relative constant-height envelopes; no floors, rooms, parcels, rights or ULPIN associations.',
    manifest.vertical.note,
  ],
  outputs: {},
};
const write = (name, value) => {
  const text = `${JSON.stringify(value, null, 1)}\n`;
  writeFileSync(join(outDir, name), text);
  lineage.outputs[name] = createHash('sha256').update(text).digest('hex');
};
write('nyc-bronx-areas.json', [area]);
write('nyc-bronx-context.json', context);
writeFileSync(join(outDir, 'nyc-bronx-lineage.json'), `${JSON.stringify(lineage, null, 1)}\n`);
console.log(`Derived ${features.length} buildings into area ${areaId}`);

function centroid(ring) {
  const pts = ring.slice(0, -1);
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length].map((v) => round(v, 9));
}
function ringArea(ring) {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return s / 2;
}
function round(v, d) { const k = 10 ** d; return Math.round(v * k) / k; }
function uuidV5(name, namespace) {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf8')])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
