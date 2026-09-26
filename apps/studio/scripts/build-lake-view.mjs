#!/usr/bin/env node
/**
 * Builds the Lake View area: the Studio's reference data set, served through the local API routes in
 * the exact shapes the backend publishes (docs/api/openapi.json) plus the draft contracts in
 * packages/api-client/src/draft. Swap any route to `live` in src/local/routes.ts and the screens keep
 * working on the backend's answers.
 *
 * Frame: local east/north metres from the site origin (EPSG:32643 easting/northing below). Heights:
 * site datum SD-1, ground at 212.40 m. Scene heights are elevation minus ground.
 *
 * Deterministic: IDs are UUIDv5 of stable names. Run: node apps/studio/scripts/build-lake-view.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { round, sha256, uuidV5 } from './lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const outDir = join(root, 'apps/studio/src/local/data/lake-view');
mkdirSync(outDir, { recursive: true });

const id = (name) => uuidV5(`lake-view:${name}`);
const GROUND = 212.4;
const ORIGIN = [373_420, 2_046_180]; // EPSG:32643 easting, northing of the site origin
const ANCHOR = [73.79842, 18.50316]; // WGS 84 lon, lat of the same point
const REF = 'site datum SD-1 (m)';
const RECORDED = '2026-09-24T14:10:00.000+05:30';

// ------------------------------------------------------------------ sources (the batch's five files)
const SOURCES = [
  { key: 'parcels', name: 'parcels.gpkg', profile: 'geopackage-parcels', createdAt: '2026-09-24T11:02:00.000+05:30', kind: 'feature' },
  { key: 'inventory', name: 'unit_inventory.xlsx', profile: 'excel-unit-inventory', createdAt: '2026-09-24T11:03:00.000+05:30', kind: 'table' },
  { key: 'levels', name: 'levels.csv', profile: 'csv-level-schedule', createdAt: '2026-09-24T11:03:30.000+05:30', kind: 'table' },
  { key: 'plan', name: 'plan_F7.pdf', profile: 'sanctioned-plan-pdf', createdAt: '2026-09-24T11:04:00.000+05:30', kind: 'document', title: 'Sanctioned plan' },
  { key: 'deed', name: 'sale_deed_704.pdf', profile: 'registered-deed-pdf', createdAt: '2026-09-24T11:04:30.000+05:30', kind: 'document', title: 'Sale deed' },
  { key: 'declaration', name: 'deed_of_declaration.pdf', profile: 'registered-deed-pdf', createdAt: '2026-09-24T11:05:00.000+05:30', kind: 'document', title: 'Deed of declaration' },
  { key: 'drone', name: 'drone_survey_2026-09-12.laz', profile: 'uav-lidar-survey', createdAt: '2026-09-24T11:06:00.000+05:30', kind: 'feature', title: 'Drone survey' },
  { key: 'survey', name: 'utility_survey_2026.csv', profile: 'utility-survey-csv', createdAt: '2026-09-24T11:05:30.000+05:30', kind: 'table' },
];
for (const s of SOURCES) { s.id = id(`source:${s.key}`); s.revisionId = id(`source-revision:${s.key}`); }
const SRC = Object.fromEntries(SOURCES.map((s) => [s.key, s]));

// ------------------------------------------------------------------ geometry helpers
const rect = (x0, x1, y0, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(([x, y]) => [round(x, 3), round(y, 3)]);
const ellipse = (cx, cy, rx, ry, n = 48) => {
  const ring = Array.from({ length: n }, (_, i) => [round(cx + rx * Math.cos((2 * Math.PI * i) / n), 3), round(cy + ry * Math.sin((2 * Math.PI * i) / n), 3)]);
  return [...ring, ring[0]];
};
const lonLat = ([x, y]) => [
  round(ANCHOR[0] + x / (111_320 * Math.cos((ANCHOR[1] * Math.PI) / 180)), 9),
  round(ANCHOR[1] + y / 110_540, 9),
];
const poly = (ring) => ({ type: 'Polygon', coordinates: [ring] });
const geoPoly = (ring) => ({ type: 'Polygon', coordinates: [ring.map(lonLat)] });
const ringArea = (ring) => Math.abs(ring.slice(0, -1).reduce((a, [x, y], i) => a + x * ring[i + 1][1] - ring[i + 1][0] * y, 0) / 2);
const reference = {
  sourceCrs: 'EPSG:32643',
  analysisCrs: `EPSG:32643 local metres from ${ORIGIN[0]} E, ${ORIGIN[1]} N`,
  origin: ORIGIN,
  anchor: ANCHOR,
  transformVersion: 'utm43n-local/1',
  verticalReference: `Site datum SD-1; ground ${GROUND.toFixed(2)} m`,
};

// ------------------------------------------------------------------ the area
const AREA_ID = id('area');
const SITE_ID = id('site');
const RESIDENCE_ID = id('building:residence');
const MAIN_PARCEL = 'MH2507A1B3C4D5';

/** Main building: 30 × 20 m, G (stilt) + 8, roof; two basements. Scene y = elevation − ground. */
const W = 15, D = 10;
const LEVELS = [
  { key: 'Roof', lower: 239.8, upper: 240.8, source: 'levels', row: 2 },
  ...[8, 7, 6, 5, 4, 3, 2, 1].map((n) => ({ key: `F${n}`, lower: 212.8 + 3 * n, upper: 215.8 + 3 * n, source: 'levels', row: 11 - n })),
  { key: 'G', lower: 212.8, upper: 215.8, source: 'plan', title: 'Ground, stilt parking', open: true },
  { key: 'B1', lower: 209.1, upper: 212.4, source: 'levels', row: 11, belowGround: true },
  { key: 'B2', lower: 205.8, upper: 209.1, belowGround: true, estimated: true },
];

// Context buildings: [x, y(north), width, depth, storeys, name]
const CONTEXT = [
  [-20, -58, 18, 14, 5], [5, -56, 14, 16, 8], [25, -60, 12, 12, 3], [-24, -90, 20, 16, 10], [6, -88, 16, 12, 4], [24, -92, 10, 14, 6],
  [62, 2, 18, 22, 7], [66, -58, 16, 14, 4], [64, -92, 20, 14, 9], [90, -20, 14, 18, 3], [92, 30, 16, 14, 5], [62, 44, 18, 16, 11],
  [-22, 36, 16, 14, 6], [4, 38, 18, 14, 4], [24, 34, 12, 12, 8], [-18, 72, 20, 18, 3], [10, 74, 16, 16, 7],
  [-64, 6, 18, 20, 4], [-62, 44, 16, 14, 9], [-90, 40, 14, 14, 5], [-66, -22, 14, 12, 3],
];
const ROADS = [
  ['Lake View Road', -400, 400, -36, -24], ['Service lane', -40, 40, 11, 17],
  ['Link Road 2', -45, -35, -400, 400], ['Link Road 3', 35, 45, -400, 400],
];
const PUBLIC_LAND = [
  ['Garden reserve', -33, -19, -20, 4], ['Municipal school ground', 78, 128, 60, 100], ['Lake park', -150, -60, -120, -40],
];

const parcelCode = (i) => `MH2507A1B3C${'4567890ABCDEFGHJKLMNP'[i]}${'D5E6F7G8H9J2K3L4M5N6P7'.slice(i % 20, i % 20 + 2)}`.slice(0, 14);
const evidence = (key, extra = {}) => [{ sourceRevisionId: SRC[key].revisionId, ...extra }];
const feature = (props) => ({
  revision: 1, areaId: AREA_ID, sourceReference: reference, representation: 'physical_exterior', worldStatus: 'observed', properties: {}, ...props,
});

const features = [];
// Parcels
const mainParcelRing = rect(-22, 22, -10.5 - 12.5, 12.5); // road frontage to the south
features.push(feature({
  id: id('parcel:main'), identifier: MAIN_PARCEL, sourceRevisionId: SRC.parcels.revisionId, datasetNamespace: 'mh-parcels', sourceKey: 'fid 118',
  name: `Parcel ${MAIN_PARCEL}`, kind: 'parcel', geometry: poly(mainParcelRing), geographicGeometry: geoPoly(mainParcelRing), sourceGeometry: poly(mainParcelRing),
  height: { state: 'unknown', value: null, unit: 'm', meaning: 'not applicable to a parcel', reference: REF },
  properties: { ulpin: MAIN_PARCEL, survey_no: '118/2B', village: 'Lake View' },
  areaM2: round(ringArea(mainParcelRing), 2), evidence: evidence('parcels', { featureId: 'fid 118' }), geometryRole: 'parcel_boundary',
}));
CONTEXT.forEach(([x, y, w, d, storeys], i) => {
  const code = parcelCode(i);
  const pr = rect(x - w / 2 - 4, x + w / 2 + 4, y - d / 2 - 4, y + d / 2 + 4);
  features.push(feature({
    id: id(`parcel:${i}`), identifier: code, sourceRevisionId: SRC.parcels.revisionId, datasetNamespace: 'mh-parcels', sourceKey: `fid ${120 + i}`,
    name: `Parcel ${code}`, kind: 'parcel', geometry: poly(pr), geographicGeometry: geoPoly(pr), sourceGeometry: poly(pr),
    height: { state: 'unknown', value: null, unit: 'm', meaning: 'not applicable to a parcel', reference: REF },
    properties: { ulpin: code }, areaM2: round(ringArea(pr), 2), evidence: evidence('parcels', { featureId: `fid ${120 + i}` }), geometryRole: 'parcel_boundary',
  }));
  const br = rect(x - w / 2, x + w / 2, y - d / 2, y + d / 2);
  features.push(feature({
    id: id(`building:${i}`), identifier: `${code}/B01`, sourceRevisionId: SRC.parcels.revisionId, datasetNamespace: 'mh-building-footprints', sourceKey: `bldg ${301 + i}`,
    name: `Building ${301 + i}`, kind: 'building', geometry: poly(br), geographicGeometry: geoPoly(br), sourceGeometry: poly(br),
    height: { state: 'source_supported', value: storeys * 3, unit: 'm', meaning: 'roof height above ground', reference: REF, evidence: evidence('parcels', { featureId: `bldg ${301 + i}` }) },
    properties: { storeys, parcel_ulpin: code }, areaM2: round(w * d, 2), evidence: evidence('parcels', { featureId: `bldg ${301 + i}` }),
    representation: 'physical_context', geometryRole: 'footprint', semantics: { geometryRole: 'footprint', evidenceState: 'source_supported', floorCount: storeys },
  }));
});
const residenceRing = rect(-W, W, -D, D);
features.push(feature({
  id: RESIDENCE_ID, identifier: `${MAIN_PARCEL}/S01`, sourceRevisionId: SRC.parcels.revisionId, datasetNamespace: 'mh-building-footprints', sourceKey: 'bldg 300',
  name: 'Lake View Residence', kind: 'building', geometry: poly(residenceRing), geographicGeometry: geoPoly(residenceRing), sourceGeometry: poly(residenceRing),
  height: { state: 'reviewed', value: round(240.8 - GROUND, 2), unit: 'm', meaning: 'roof parapet above ground', reference: REF, evidence: evidence('levels', { row: 2 }) },
  properties: { address: '12 Lake View Road', parcel_ulpin: MAIN_PARCEL, use: 'Residential apartments' },
  areaM2: W * D * 4, evidence: evidence('parcels', { featureId: 'bldg 300' }), geometryRole: 'footprint',
  semantics: { geometryRole: 'footprint', evidenceState: 'reviewed', floorCount: 9, approvalStatus: 'sanctioned' },
  verticalExtent: { lower: round(205.8 - GROUND, 2), upper: round(240.8 - GROUND, 2), unit: 'm', reference: REF, evidenceState: 'reviewed', evidence: evidence('levels') },
}));
ROADS.forEach(([name, x0, x1, y0, y1], i) => {
  const r = rect(x0, x1, y0, y1);
  features.push(feature({
    id: id(`road:${i}`), identifier: `ROAD-${i + 1}`, sourceRevisionId: SRC.parcels.revisionId, datasetNamespace: 'mh-roads', sourceKey: `road ${i + 1}`,
    name, kind: 'road', geometry: poly(r), geographicGeometry: geoPoly(r), sourceGeometry: poly(r),
    height: { state: 'unknown', value: null, unit: 'm', meaning: 'not applicable', reference: REF },
    areaM2: round(ringArea(r), 2), evidence: evidence('parcels', { featureId: `road ${i + 1}` }), representation: 'physical_context', geometryRole: 'carriageway',
  }));
});
PUBLIC_LAND.forEach(([name, x0, x1, y0, y1], i) => {
  const r = rect(x0, x1, y0, y1);
  features.push(feature({
    id: id(`public:${i}`), identifier: `PL-${i + 1}`, sourceRevisionId: SRC.parcels.revisionId, datasetNamespace: 'mh-public-land', sourceKey: `pl ${i + 1}`,
    name, kind: 'public_land', geometry: poly(r), geographicGeometry: geoPoly(r), sourceGeometry: poly(r),
    height: { state: 'unknown', value: null, unit: 'm', meaning: 'not applicable', reference: REF },
    properties: { land_cover: 'open' }, areaM2: round(ringArea(r), 2), evidence: evidence('parcels', { featureId: `pl ${i + 1}` }), representation: 'physical_context', geometryRole: 'land_parcel',
  }));
});
const lake = ellipse(-104, -80, 39, 25.5);
features.push(feature({
  id: id('public:lake'), identifier: 'PL-LAKE', sourceRevisionId: SRC.parcels.revisionId, datasetNamespace: 'mh-public-land', sourceKey: 'pl lake',
  name: 'Lake View lake', kind: 'public_land', geometry: poly(lake), geographicGeometry: geoPoly(lake), sourceGeometry: poly(lake),
  height: { state: 'unknown', value: null, unit: 'm', meaning: 'not applicable', reference: REF },
  properties: { land_cover: 'water' }, areaM2: round(ringArea(lake), 2), evidence: evidence('parcels', { featureId: 'pl lake' }), representation: 'physical_context', geometryRole: 'water_body',
}));
// Utilities under Lake View Road's service lane (north of the building): a water main and a metro corridor.
const UTILITIES = [
  { key: 'water', name: 'Water main DN300', ring: rect(-45, 45, 13.85, 14.15), lower: -1.2, upper: -0.9, profile: { network: 'water', diameter_mm: 300, quality_level: 'B', tolerance: null, owner: 'Municipal water department' } },
  { key: 'metro', name: 'Metro corridor', ring: rect(-45, 45, 12, 16), lower: -18.4, upper: -14.4, profile: { network: 'metro', protection: 'Reserved corridor', owner: 'Metro rail corporation', tolerance: null } },
];
for (const u of UTILITIES) {
  features.push(feature({
    id: id(`utility:${u.key}`), identifier: `UT-${u.key.toUpperCase()}`, sourceRevisionId: SRC.survey.revisionId, datasetNamespace: 'utility-survey', sourceKey: u.key,
    name: u.name, kind: 'utility', geometry: poly(u.ring), geographicGeometry: geoPoly(u.ring), sourceGeometry: poly(u.ring),
    height: { state: 'unknown', value: null, unit: 'm', meaning: 'see vertical extent', reference: REF },
    areaM2: round(ringArea(u.ring), 2), evidence: evidence('survey', { featureId: u.key }), representation: 'physical_context', geometryRole: 'utility_envelope',
    verticalExtent: { lower: u.lower, upper: u.upper, unit: 'm', reference: 'metres below ground', evidenceState: 'source_supported', evidence: evidence('survey', { featureId: u.key }) },
    utilityProfile: u.profile,
  }));
}

const xs = features.flatMap((f) => f.geometry.coordinates[0].map(([x]) => x)).filter((x) => Math.abs(x) < 200);
const ys = features.flatMap((f) => f.geometry.coordinates[0].map(([, y]) => y)).filter((y) => Math.abs(y) < 200);
const extent = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
const area = {
  id: AREA_ID, siteId: SITE_ID, name: 'Lake View', revision: 3, reference, extent,
  geographicExtent: [...lonLat([extent[0], extent[1]]), ...lonLat([extent[2], extent[3]])],
  administrativeUnits: [
    { id: id('admin:village'), kind: 'village', name: 'Lake View', code: '556734', authority: 'Revenue department' },
    { id: id('admin:district'), kind: 'district', name: 'Pune', code: '521', authority: 'Revenue department' },
  ],
  dataKind: 'demonstration', featureCount: features.length,
};

// ------------------------------------------------------------------ the register
const levelId = (key) => id(`level:${key}`);
const spaceId = (key) => id(`space:${key}`);
const binding = (key, locator) => ({ sourceId: SRC[key].id, locator });
const UNIT_W = 10, UNIT_D = D - 1.5; // corridor is 3 m wide down the middle
const FLAT_SLOTS = [
  ['01', -W, -W + UNIT_W, 1.5, D], ['02', -W + UNIT_W, -W + 2 * UNIT_W, 1.5, D], ['03', -W + 2 * UNIT_W, W, 1.5, D],
  ['04', -W, -W + UNIT_W, -D, -1.5], ['05', -W + UNIT_W, -W + 2 * UNIT_W, -D, -1.5], ['06', -W + 2 * UNIT_W, W, -D, -1.5],
];
const register = [];
const spaceMeta = []; // for the ledger
for (const level of LEVELS) {
  register.push({
    id: levelId(level.key), identifier: `${MAIN_PARCEL}/S01/${level.key}`, ulpin3d: `${MAIN_PARCEL}/S01/${level.key}`,
    name: level.key, kind: 'floor', revision: 3, use: level.title ?? (level.belowGround ? 'basement parking' : level.key === 'Roof' ? 'roof' : 'residential floor'),
    footprint: level.belowGround ? rect(-W - 2, W + 2, -D - 2, D + 2) : residenceRing,
    geometry: {
      id: levelId(level.key), alias: level.key, name: level.title ?? level.key, kind: 'level',
      footprint: level.belowGround ? rect(-W - 2, W + 2, -D - 2, D + 2) : residenceRing,
      lower: level.lower, upper: level.upper, lowerVerified: !level.estimated, upperVerified: !level.estimated,
      bindings: level.source ? { lower: binding(level.source, level.row ? `row ${level.row}` : 'p.1'), upper: binding(level.source, level.row ? `row ${level.row}` : 'p.1') } : {},
      revision: 3, levelLabel: level.key,
    },
    links: [{ targetId: RESIDENCE_ID, type: 'within' }],
    evidence: level.source ? [binding(level.source, level.row ? `row ${level.row}` : 'p.1')] : [],
  });
  const spaces = [];
  if (/^F\d$/.test(level.key)) {
    const n = level.key.slice(1);
    for (const [slot, x0, x1, y0, y1] of FLAT_SLOTS) spaces.push({ key: `Flat ${n}${slot}`, use: 'apartment', rights: 'exclusive', ring: rect(x0 + 0.1, x1 - 0.1, y0 + 0.1, y1 - 0.1) });
    spaces.push({ key: `Stair S1 ${level.key}`, name: 'Stair S1', use: 'stair', rights: 'shared', ring: rect(-W + 0.1, -W + 4, -1.4, 1.4) });
    spaces.push({ key: `Lift L1 ${level.key}`, name: 'Lift L1', use: 'lift', rights: 'shared', ring: rect(-W + 4.1, -W + 6.5, -1.4, 1.4) });
    // F8's corridor stops short of the east wall: the partition check reports that void.
    spaces.push({ key: `Corridor ${level.key}`, name: 'Corridor', use: 'corridor', rights: 'shared', ring: rect(-W + 6.6, level.key === 'F8' ? W - 0.456 : W - 0.1, -1.4, 1.4) });
  } else if (level.key === 'G') {
    spaces.push({ key: 'Stilt parking', use: 'parking', rights: 'shared', ring: rect(-W + 0.1, W - 0.1, -D + 0.1, D - 0.1) });
  } else if (level.key === 'Roof') {
    spaces.push({ key: 'Roof terrace', use: 'terrace', rights: 'shared', ring: rect(-W + 0.1, W - 0.1, -D + 0.1, D - 0.1) });
  } else {
    spaces.push({ key: `Parking ${level.key}`, use: 'parking', rights: level.key === 'B2' ? 'unknown' : 'shared', ring: rect(-W - 1.9, W + 1.9, -D - 1.9, D + 1.9) });
  }
  for (const s of spaces) {
    let lower = level.lower, upper = level.key === 'Roof' ? level.lower + 3 : level.upper;
    let lowerVerified = !level.estimated, upperVerified = !level.estimated;
    let ring = s.ring;
    if (s.key === 'Flat 101') { upper = 218.9; } // overlaps Flat 201 by 0.20 m
    if (s.key === 'Flat 201') { lower = 218.7; lowerVerified = false; }
    register.push({
      id: spaceId(s.key), identifier: `${MAIN_PARCEL}/S01/${level.key}/${s.key.replace(/\s+/g, '-')}`, ulpin3d: `${MAIN_PARCEL}/S01/${level.key}/${s.key.replace(/\s+/g, '-')}`,
      name: s.name ?? s.key, kind: 'space', revision: 3, use: s.use, footprint: ring,
      geometry: {
        id: spaceId(s.key), alias: s.key, name: s.name ?? s.key, kind: s.use === 'apartment' ? 'unit' : 'shared_space', footprint: ring,
        lower, upper, lowerVerified, upperVerified,
        bindings: { footprint: binding(level.key === 'F7' ? 'plan' : 'inventory', level.key === 'F7' ? 'p.3 · r2' : `row ${register.length}`), ...(level.source ? { lower: binding(level.source, level.row ? `row ${level.row}` : 'p.1') } : {}) },
        revision: 3, levelLabel: level.key, area: round(ringArea(ring), 2), height: round(upper - lower, 2), volume: round(ringArea(ring) * (upper - lower), 2),
      },
      links: [{ targetId: levelId(level.key), type: 'floor' }, { targetId: RESIDENCE_ID, type: 'within' }],
      evidence: [binding(level.key === 'F7' ? 'plan' : 'inventory', level.key === 'F7' ? 'p.3 · r2' : `unit ${s.key}`)],
    });
    spaceMeta.push({ ...s, level: level.key, id: spaceId(s.key), area: ringArea(ring) });
  }
}

// Findings, computed from the records above.
const f101 = register.find((r) => r.id === spaceId('Flat 101'));
const f201 = register.find((r) => r.id === spaceId('Flat 201'));
const overlapH = round(f101.geometry.upper - f201.geometry.lower, 2);
const overlapA = round(f101.geometry.area, 1);
const overlapV = round(overlapH * overlapA, 1);
const voidRing = rect(W - 0.456, W - 0.1, -1.4, 1.4);
const voidV = round(ringArea(voidRing) * 3, 1);
const flat704 = spaceMeta.find((s) => s.key === 'Flat 704');
const CARPET_704 = 69.3, DECLARED_704 = 72.0;
const carpetPct = round(((DECLARED_704 - CARPET_704) / CARPET_704) * 100, 1);
const units = spaceMeta.filter((s) => s.use === 'apartment');
const findings = [
  {
    id: id('finding:overlap'), category: 'blocking', code: 'exclusive_overlap',
    message: `Flat 101 / Flat 201: ${overlapV.toFixed(1)} m³ overlap`, featureIds: [f101.id, f201.id], areaM2: overlapA, volumeM3: overlapV,
    geometry: poly(f101.footprint), method: 'Check v1.4',
    quantities: { lowerM: f201.geometry.lower, upperM: f101.geometry.upper, depthM: overlapH },
    evidence: [{ sourceRevisionId: SRC.levels.revisionId, row: 10 }], limitations: ['Flat 201 lower limit is estimated and not verified'],
  },
  {
    id: id('finding:void'), category: 'blocking', code: 'partition_void',
    message: `F8: ${voidV.toFixed(1)} m³ unexplained void`, featureIds: [levelId('F8')], areaM2: round(ringArea(voidRing), 2), volumeM3: voidV,
    geometry: poly(voidRing), method: 'Check v1.4',
    quantities: { lowerM: 236.8, upperM: 239.8 },
    evidence: [], limitations: [],
  },
  {
    id: id('finding:carpet'), category: 'needs_review', code: 'carpet_area_deviation',
    message: `Flat 704: carpet area +${carpetPct} %`, featureIds: [flat704.id], method: 'Check v1.4',
    quantities: { carpetM2: CARPET_704, declaredM2: DECLARED_704, deviationPct: carpetPct, thresholdPct: 2 },
    evidence: [{ sourceRevisionId: SRC.plan.revisionId, page: 3 }, { sourceRevisionId: SRC.deed.revisionId, page: 2 }], limitations: [],
  },
  {
    id: id('finding:shares'), category: 'needs_review', code: 'share_total',
    message: 'Shares total 99.50 %', featureIds: [RESIDENCE_ID], method: 'Check v1.4',
    quantities: { unitsDeclared: units.length, units: units.length, totalPct: 99.5 },
    evidence: [{ sourceRevisionId: SRC.declaration.revisionId }], limitations: [],
  },
  {
    id: id('finding:parking'), category: 'needs_review', code: 'missing_evidence',
    message: 'Flat 704 parking: needs evidence', featureIds: [flat704.id], method: 'Check v1.4',
    quantities: {}, evidence: [], limitations: ['No source linked'],
  },
];

const sources = SOURCES.map((s) => ({
  id: s.id, name: s.name, sha256: sha256(`lake-view:${s.name}`), revision: s.key === 'plan' ? 2 : 1, profile: s.profile, createdAt: s.createdAt,
  url: `/api/v1/sources/${s.id}/file`, evidence: [],
}));
const registerBody = {
  schemaVersion: 'ulpin-officer-export/1', exportedAt: RECORDED,
  property: {
    id: RESIDENCE_ID, identifier: `${MAIN_PARCEL}/S01`, ulpin3d: `${MAIN_PARCEL}/S01`, name: 'Lake View Residence', revision: 3,
    geometryRole: 'footprint', worldStatus: 'observed', geometry: poly(residenceRing), geographicGeometry: geoPoly(residenceRing),
    height: { state: 'reviewed', value: round(240.8 - GROUND, 2), unit: 'm', meaning: 'roof parapet above ground', reference: REF, evidence: evidence('levels', { row: 2 }) },
  },
  area,
  associations: [{
    id: id('assoc:parcel'), revision: 1, fromId: RESIDENCE_ID, toId: id('parcel:main'), relationship: 'on_parcel', status: 'reviewed',
    evidence: [], reason: 'Footprint lies within the parcel boundary', actor: 'R. Iyer', updatedAt: RECORDED, fromRevision: 3, toRevision: 1,
  }],
  parcelIdentifiers: [{ parcelId: id('parcel:main'), scheme: 'ULPIN', value: MAIN_PARCEL, issuer: 'Land records department', evidence: { sourceRevisionId: SRC.parcels.revisionId, locator: 'fid 118' } }],
  register, sources, missing: [],
  selection: { id: RESIDENCE_ID, kind: 'building', name: 'Lake View Residence', ulpin3d: `${MAIN_PARCEL}/S01` },
  ulpin3d: `${MAIN_PARCEL}/S01`, buildingUlpin3d: `${MAIN_PARCEL}/S01`, findingsScope: 'building',
  geometryQualification: { state: 'qualified', purpose: 'identity_assignment', missing: [] },
  findings,
  findingQualification: { state: 'partial', missing: [{ findingId: 'exclusive_overlap:F3', participantId: spaceId('Flat 305'), reason: 'Not assessed: open shell on Flat 305' }] },
  scope: 'Technical record of the building. Not a title, certificate or legal order.',
};

// ------------------------------------------------------------------ draft: building ledger (rights, areas, shares, readiness, checks, history)
const share = (s) => (s.key === 'Flat 704' ? 1.84 : round(99.5 / units.length, 2));
const ledger = {
  buildingId: RESIDENCE_ID, revision: 3, status: 'reviewed', address: '12 Lake View Road', parcelUlpin: MAIN_PARCEL,
  declaration: 'Apartment declaration', siteDatum: 'SD-1', groundElevationM: GROUND,
  shareBasis: 'carpet area', shareTotalPct: 99.5,
  shareEvidence: { sourceId: SRC.declaration.id, source: 'Deed of declaration', locator: 'schedule B' },
  spaces: spaceMeta.map((s) => ({
    spaceId: s.id, rights: s.rights,
    status: s.key === 'Flat 704' ? 'needs_review' : s.level === 'F7' ? 'draft' : 'reviewed',
    carpetAreaM2: s.use === 'apartment'
      ? (s.key === 'Flat 704' ? { value: CARPET_704, sourceId: SRC.plan.id, source: 'Plan F7', locator: 'p.3 · r2' } : s.level === 'F7' ? null : { value: round(s.area * 0.815, 2), sourceId: SRC.inventory.id, source: 'unit_inventory.xlsx', locator: `row ${units.indexOf(s) + 2}` })
      : null,
    declaredAreaM2: s.key === 'Flat 704' ? { value: DECLARED_704, sourceId: SRC.deed.id, source: 'Sale deed', locator: 'cl.2' } : null,
    sharePct: s.use === 'apartment' ? (s.key === 'Flat 704' || s.level !== 'F7' ? { value: share(s), sourceId: SRC.declaration.id, source: 'Declaration', locator: 'schedule B' } : null) : null,
    parking: s.key === 'Flat 704' ? { value: 'Covered stilt', sourceId: null, source: null, locator: 'Needs evidence' } : null,
  })),
  readiness: {
    task: 'Assign proposed 3D ULPIN',
    dimensions: [
      { name: 'Evidence', value: 1 }, { name: 'Geometry', value: 1 }, { name: 'Association', value: 1 },
      { name: 'Consistency', value: 0.5, label: '2 findings' }, { name: 'Review', value: 1 }, { name: 'Freshness', value: null },
    ],
  },
  checks: [
    { name: 'Exclusive overlap', detail: `Flat 101 / Flat 201 · ${overlapV.toFixed(1)} m³`, state: 'blocking', findingId: findings[0].id },
    { name: 'Partition completeness', detail: `${voidV.toFixed(1)} m³ void on F8`, state: 'blocking', findingId: findings[1].id },
    { name: 'Carpet area', detail: `Flat 704 · ${carpetPct} %`, state: 'needs_review', findingId: findings[2].id },
    { name: 'Shares', detail: '99.50 %', state: 'needs_review', findingId: findings[3].id },
    { name: 'Exclusive overlap · F3', detail: 'Not assessed: open shell on Flat 305', state: 'not_assessed', findingId: null },
    { name: 'Stack consistency', detail: null, state: 'passed', findingId: null },
    { name: 'Anchoring', detail: null, state: 'passed', findingId: null },
  ],
  checkMethod: 'Check v1.4',
  findingDetails: [
    { findingId: findings[0].id, calculation: [`Flat 101 top ${f101.geometry.upper.toFixed(2)} m · Flat 201 bottom ${f201.geometry.lower.toFixed(2)} m`, `${overlapH.toFixed(2)} m × ${overlapA.toFixed(1)} m² = ${overlapV.toFixed(1)} m³`],
      evidence: [{ kind: 'table', sourceId: SRC.levels.id, source: 'levels.csv', locator: 'row 10' }, { state: 'estimated', sourceId: null, source: 'Flat 201 lower', locator: 'unverified' }],
      actions: ['Request evidence', 'Apply level evidence'] },
    { findingId: findings[1].id, calculation: ['Partition completeness · F8', `${voidV.toFixed(1)} m³ not assigned to any space`], evidence: [], actions: ['Request evidence'] },
    { findingId: findings[2].id, calculation: [`${DECLARED_704.toFixed(2)} − ${CARPET_704.toFixed(2)} = ${(DECLARED_704 - CARPET_704).toFixed(2)} m²`, `${(DECLARED_704 - CARPET_704).toFixed(2)} ÷ ${CARPET_704.toFixed(2)} = ${carpetPct} % · threshold 2 %`],
      evidence: [{ kind: 'document', sourceId: SRC.plan.id, source: 'Plan F7', locator: 'p.3 · r2' }, { kind: 'document', sourceId: SRC.deed.id, source: 'Sale deed', locator: 'cl.2' }], actions: ['Review area'] },
    { findingId: findings[3].id, calculation: [`${units.length} of ${units.length} units declared`, '100.00 − 99.50 = 0.50 % unexplained'],
      evidence: [{ kind: 'document', sourceId: SRC.declaration.id, source: 'Deed of declaration', locator: null }], actions: ['Request evidence'] },
    { findingId: findings[4].id, calculation: ['Covered stilt, allotted by association', 'No source linked'], evidence: [{ state: 'missing', sourceId: null, source: null, locator: 'Needs evidence' }], actions: ['Request evidence'] },
  ],
  revisions: [
    { kind: 'recorded', title: 'r3 Recorded', actor: 'R. Iyer', at: '2026-09-24T14:10:00+05:30', hash: '7f3a91c0e4b2d8f6a1c3e5b7d9f0a2c4e6b8d0f2a4c6e8b0d2f4a6c8e0b2c2e1', previousHash: '91be27d4c6a8e0b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c604d7' },
    { kind: 'evidence', title: 'r2 Evidence applied', actor: 'R. Iyer', at: '2026-09-24T13:52:00+05:30', hash: '91be27d4c6a8e0b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c604d7', previousHash: '2c80e6a4b2d0f8e6c4a2b0d8f6e4c2a0b8d6f4e2c0a8b6d4f2e0c8a6b4d29a13' },
    { kind: 'draft', title: 'r1 Draft from 5 sources', actor: 'Import agent', at: '2026-09-24T11:05:00+05:30', hash: '2c80e6a4b2d0f8e6c4a2b0d8f6e4c2a0b8d6f4e2c0a8b6d4f2e0c8a6b4d29a13', previousHash: null },
  ],
  deviation: {
    state: 'needs_review',
    sanctioned: { label: 'Sanctioned · G + 8', storeys: 9, heightM: 27.0, sourceId: SRC.plan.id, source: 'Sanctioned plan', locator: 'r2' },
    observed: { label: 'Observed · drone survey', storeys: 10, heightM: 30.0, rooftopAreaM2: 118, surveyedAt: '2026-09-12', sourceId: SRC.drone.id, source: 'Drone survey', locator: '12 Sep 2026 · checkpoint RMSE 0.08 m' },
    setback: 'not_comparable',
    exclusions: 'Stair cabin and water tank excluded by rule.',
    volume: { geometry: poly(rect(-W + 0.3, -W + 12.1, -5, 5)), lowerM: 239.8, upperM: 242.8 },
    note: 'Observed from drone survey; not a legal determination.',
  },
  sources: SOURCES.map((s) => ({ sourceId: s.id, kind: s.kind, name: s.title ?? s.name, file: s.name, summary: {
    parcels: `${1 + CONTEXT.length} features`, inventory: `${units.length} rows`, levels: `${LEVELS.length - 1} rows`, plan: 'p.3 · r2', deed: 'cl.2', declaration: 'schedule B', survey: `${UTILITIES.length} features`, drone: '12 Sep 2026',
  }[s.key] })),
};

// ------------------------------------------------------------------ work queue (API shape) + draft board fields
const WORK = [
  { key: 'bundle', name: 'Lake View bundle', kind: 'import', state: 'NEEDS_INPUT', sub: '5 files', stage: 'add_files', next: 'Review 1 mapping', target: 'add-files', readiness: [3, 1], at: '14:10' },
  { key: 'f1f2', name: 'Lake View Residence · F1–F2', kind: 'case', state: 'REVIEWED', stage: 'check', next: `Resolve ${overlapV.toFixed(1)} m³ overlap`, target: 'finding:overlap', readiness: [4, 1], at: '14:02' },
  { key: 'f7', name: 'Lake View Residence · F7', kind: 'case', state: 'READY_FOR_REVIEW', stage: 'review', next: 'Review 6 room candidates', target: 'review:F7', readiness: [3, 1], at: '13:58' },
  { key: 'f7units', name: 'Lake View Residence · F7 units', kind: 'case', state: 'COMMITTED', stage: 'recorded', next: 'Assign codes for 6 units', target: 'level:F7', readiness: [6, 0], at: '13:40' },
  { key: 'f8', name: 'Lake View Residence · F8', kind: 'case', state: 'REVIEWED', stage: 'check', next: `Resolve ${voidV.toFixed(1)} m³ void`, target: 'finding:void', readiness: [4, 1], at: '13:31' },
  { key: 'shares', name: 'Lake View Residence · shares', kind: 'case', state: 'REVIEWED', stage: 'check', next: 'Explain 0.50 % in shares', target: 'register', readiness: [5, 0], at: '13:12' },
  { key: '704', name: 'Flat 704', kind: 'case', state: 'READY_FOR_REVIEW', stage: 'review', next: `Review carpet area +${carpetPct} %`, target: 'space:Flat 704', readiness: [5, 0], at: '12:55' },
  { key: 'basements', name: 'Lake View Residence · basements', kind: 'case', state: 'READY_FOR_REVIEW', stage: 'review', next: 'Confirm B2 levels', target: 'review:B2', readiness: [4, 2], at: '12:40' },
];
const workQueue = {
  total: WORK.length, page: 1, pageSize: 25,
  items: WORK.map((w) => ({
    id: id(`work:${w.key}`), kind: w.kind, name: w.name, areaId: AREA_ID, areaName: 'Lake View', dataKind: 'demonstration',
    buildingId: w.kind === 'import' ? null : RESIDENCE_ID, sourceCount: w.kind === 'import' ? 5 : 3,
    updatedAt: `2026-09-24T${w.at}:00.000+05:30`, state: w.state, jobStatus: null,
    recordedHistory: w.state === 'COMMITTED', currentRecorded: w.state === 'COMMITTED',
    provenance: { classification: 'official', basis: 'Issued by the uploading office' },
  })),
};
const resolveTarget = (t) => {
  if (t === 'add-files') return { kind: 'add-files' };
  if (t === 'register') return { kind: 'register', buildingId: RESIDENCE_ID };
  const [k, v] = t.split(':');
  if (k === 'finding') return { kind: 'finding', areaId: AREA_ID, buildingId: RESIDENCE_ID, findingId: id(`finding:${v}`) };
  if (k === 'review') return { kind: 'review', areaId: AREA_ID, buildingId: RESIDENCE_ID, levelId: levelId(v) };
  if (k === 'level') return { kind: 'level', areaId: AREA_ID, buildingId: RESIDENCE_ID, levelId: levelId(v) };
  return { kind: 'space', areaId: AREA_ID, buildingId: RESIDENCE_ID, levelId: levelId('F7'), spaceId: spaceId(v) };
};
const board = {
  items: WORK.map((w) => ({
    id: id(`work:${w.key}`), stage: w.stage, detail: w.sub ?? null, nextAction: { label: w.next, target: resolveTarget(w.target) },
    readiness: { met: w.readiness[0], unknown: w.readiness[1], of: 6 },
  })),
  counts: [
    { key: 'imports_running', value: WORK.filter((w) => w.kind === 'import').length, label: WORK.filter((w) => w.kind === 'import').length === 1 ? 'import needs input' : 'imports need input', target: { kind: 'add-files' } },
    { key: 'findings_open', value: findings.length, label: 'findings need review', target: { kind: 'finding', areaId: AREA_ID, buildingId: RESIDENCE_ID, findingId: findings[0].id } },
    { key: 'units_ready', value: units.filter((u) => u.level === 'F7').length, label: 'units ready for codes', target: { kind: 'level', areaId: AREA_ID, buildingId: RESIDENCE_ID, levelId: levelId('F7') } },
  ],
};

// ------------------------------------------------------------------ source files (served by /sources/{id}/file)
const csv = (rows) => rows.map((r) => r.map((v) => (/[,"]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\n') + '\n';
const files = {
  [SRC.levels.id]: { type: 'text/csv', body: csv([['level', 'lower_m', 'upper_m', 'datum'], ...LEVELS.filter((l) => l.source === 'levels').map((l) => [l.key, l.lower.toFixed(1), l.upper.toFixed(1), 'SD-1'])]) },
  [SRC.inventory.id]: { type: 'text/csv', body: csv([['unit', 'level', 'carpet_sqft', 'use'], ...units.map((u) => [u.key, u.level, u.level === 'F7' && u.key !== 'Flat 704' ? '' : round((u.key === 'Flat 704' ? CARPET_704 : u.area * 0.815) / 0.092903, 1), 'apartment'])]) },
  [SRC.survey.id]: { type: 'text/csv', body: csv([['asset', 'network', 'depth_top_m', 'depth_bottom_m', 'quality_level'], ['Water main DN300', 'water', '0.9', '1.2', 'B'], ['Metro corridor', 'metro', '14.4', '18.4', '']]) },
  [SRC.parcels.id]: { type: 'application/geo+json', body: JSON.stringify({ type: 'FeatureCollection', features: features.filter((f) => f.kind === 'parcel').map((f) => ({ type: 'Feature', id: f.sourceKey, properties: f.properties, geometry: f.geographicGeometry })) }, null, 1) },
};

const write = (name, body) => writeFileSync(join(outDir, name), `${JSON.stringify(body, null, 1)}\n`);
write('areas.json', [area]);
write('context.json', { area, features, packages: [], latestCheck: null, parcelAssociations: [], parcelIdentifiers: [], sceneAssets: [] });
write('register.json', registerBody);
write('ledger.json', ledger);
write('work-queue.json', workQueue);
write('work-board.json', board);
write('files.json', files);
console.log(`Lake View: ${features.length} features, ${register.length} register records, ${findings.length} findings → ${outDir}`);
