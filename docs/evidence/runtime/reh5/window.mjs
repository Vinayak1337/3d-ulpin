import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { save } from './audit.mjs';

// REH4's window.mjs for REH5 Part B: the Niagara area read as the Studio's window mode reads it (LA1, LA2), through
// the product's routes only. Raw pages stay in scratch, outside Git; the receipt keeps route, status, seconds, sizes
// and the checks. Each centred window is read three times.
const API = 'http://127.0.0.1:21026';
const areaId = 'a1c1252a-949f-42a7-a879-5ad2aaa7cc46';
const scratch = 'E:/BhuAayam-data/task-data/reh5';
// REH3's three package samples: each record states no height (state unknown, value null).
const reh3NoHeight = ['7117844c-597d-4c47-89b2-c336d10c91f5', '322d228f-b10b-4dac-8185-e65c325dbec5',
  '16b49989-b162-4ef0-bf17-def838e173d5'];
const requests = [];
// Each run writes its raw answers under its own prefix; an earlier run's files are kept.
const run = process.argv[2] ?? 'b2';
let count = 0;

async function get(step, path, query = {}) {
  const search = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined)
    .map(([k, v]) => [k, String(v)]));
  const route = `/api/v1/areas/${areaId}/${path}${search.size ? `?${search}` : ''}`;
  const begin = performance.now();
  const response = await fetch(`${API}${route}`);
  const text = await response.text();
  const seconds = Number(((performance.now() - begin) / 1000).toFixed(3));
  const body = text ? JSON.parse(text) : null;
  writeFileSync(`${scratch}/${run}-${String(++count).padStart(3, '0')}.json`, text, { flag: 'wx' });
  const row = { step, route: route.replace(areaId, '{areaId}'), status: response.status, seconds,
    bytes: Buffer.byteLength(text) };
  if (response.status >= 400) row.refusal = { code: body?.error?.code ?? null, words: body?.error?.message ?? null };
  requests.push(row);
  return { status: response.status, body: body?.data ?? body, row };
}

const sample = feature => ({ id: feature.id, identifier: feature.identifier, kind: feature.kind,
  displayState: feature.displayState, ringVertexCount: feature.polygons[0]?.[0]?.length ?? 0,
  rings: feature.polygons.flat().length,
  heightM: feature.heightM, heightState: feature.heightState });

/** Every page of one window by `next`: the features, the pages' seconds and sizes. */
async function pages(label, window) {
  const features = [];
  const trail = [];
  let after;
  do {
    const { status, body, row } = await get(`${label} page ${trail.length + 1}`, 'display-window',
      { ...window, after, limit: 4000 });
    assert.equal(status, 200, `${label}: HTTP ${status}`);
    features.push(...body.features);
    trail.push({ page: trail.length + 1, features: body.features.length, seconds: row.seconds, bytes: row.bytes,
      next: body.next ? 'set' : null, areaRevision: body.areaRevision });
    after = body.next ?? undefined;
  } while (after);
  return { features, trail };
}

function centred(extent, half) {
  const x = (extent[0] + extent[2]) / 2, y = (extent[1] + extent[3]) / 2;
  return { minX: x - half, minY: y - half, maxX: x + half, maxY: y + half };
}

/** limit 0, limit 4001 and a window whose minimum is not below its maximum: each must be refused. */
async function refuse({ minX, minY, maxX, maxY }) {
  const refusals = {};
  for (const [label, query] of [['limit=0', { minX, minY, maxX, maxY, limit: 0 }],
    ['limit=4001', { minX, minY, maxX, maxY, limit: 4001 }],
    ['minX >= maxX', { minX: maxX, minY, maxX: minX, maxY, limit: 10 }],
    ['minX = maxX', { minX, minY, maxX: minX, maxY, limit: 10 }]]) {
    refusals[label] = (await get(`refuse ${label}`, 'display-window', query)).row;
  }
  return refusals;
}

const out = { at: new Date().toISOString(), api: API, areaId };
const context = await get('context', 'context');
const canonical = await get('canonical', 'canonical');
out.limitReads = { context: context.row, canonical: canonical.row };
const tally = (features, key) => features.reduce((counts, feature) =>
  ({ ...counts, [feature[key]]: (counts[feature[key]] ?? 0) + 1 }), {});

const summary = await get('display-summary', 'display-summary');
assert.equal(summary.status, 200);
const { featureCount, extent, areaRevision, displayLimit } = summary.body;
out.summary = { ...summary.row, featureCount, extent, areaRevision, displayLimit, fields: Object.keys(summary.body),
  splitByState: 'not in the reply (the schema has no recorded or proposal count); counted from the pages below',
  againstReh4: 'REH4 (01a11f93) answered featureCount 0 and extent null',
  againstReh3: featureCount === 41809 ? 'equals REH3 41,809' : 'differs from REH3 41,809' };

if (!extent) {
  // No extent to page: one probe of 100 km by 100 km around the area's origin (local 0, 0) and the refusals.
  const probe = { minX: -50000, minY: -50000, maxX: 50000, maxY: 50000 };
  const read = await pages('probe 100 km at the origin', probe);
  out.probe = { window: probe, pages: read.trail, features: read.features.length };
  out.refusals = await refuse(probe);
  out.requests = requests;
  out.stoppedAt = 'display-summary has no extent (featureCount 0): nothing to page or centre a window on';
  save('part-b-window.json', out);
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
}
const [minX, minY, maxX, maxY] = extent;
const whole = await pages('whole extent', { minX, minY, maxX, maxY });
const ids = new Set(whole.features.map(feature => feature.id));
const identifiers = whole.features.map(feature => feature.identifier);
const sorted = identifiers.every((value, index) => index === 0 || identifiers[index - 1] < value);
const pad = [minX - 100, minY - 100, maxX + 100, maxY + 100];
const outside = whole.features.filter(feature => feature.polygons.some(polygon => polygon.some(ring =>
  ring.some(([x, y]) => !(x >= pad[0] && x <= pad[2] && y >= pad[1] && y <= pad[3])))));
const states = tally(whole.features, 'heightState');
const unknownNotNull = whole.features.filter(feature => feature.heightState === 'unknown' && feature.heightM !== null);
const nullHeightStates = tally(whole.features.filter(feature => feature.heightM === null), 'heightState');
const zeroHeights = whole.features.filter(feature => feature.heightM === 0);
const noOutline = whole.features.filter(feature => feature.polygons.length === 0);
out.whole = { window: extent, pages: whole.trail, pageCount: whole.trail.length,
  seconds: Number(whole.trail.reduce((sum, page) => sum + page.seconds, 0).toFixed(3)),
  bytes: whole.trail.reduce((sum, page) => sum + page.bytes, 0),
  features: whole.features.length, uniqueIds: ids.size, uniqueIdentifiers: new Set(identifiers).size,
  sumEqualsFeatureCount: whole.features.length === featureCount, noRepeat: ids.size === whole.features.length,
  identifiersStrictlyAscending: sorted, kinds: [...new Set(whole.features.map(feature => feature.kind))],
  vertices: whole.features.reduce((sum, feature) => sum + feature.polygons.flat(2).length, 0),
  outsidePaddedExtent: outside.length, paddedExtent: pad, displayStates: tally(whole.features, 'displayState'),
  heightStates: states, heightMNullByState: nullHeightStates, unknownHeightNotNull: unknownNotNull.length,
  heightMZero: zeroHeights.length, withoutOutline: noOutline.length,
  reh3NoHeightSamples: reh3NoHeight.map(id => {
    const feature = whole.features.find(entry => entry.id === id);
    return feature ? sample(feature) : { id, found: false };
  }) };

// The extent's centre can fall where no building stands (run b: 3 features within 500 m, none within 50 m), so the
// same two windows are also read centred on the first vertex of the building whose first vertex is nearest it.
const [cx, cy] = [(minX + maxX) / 2, (minY + maxY) / 2];
const near = whole.features.filter(feature => feature.polygons[0]?.[0]?.length).reduce((best, feature) => {
  const [x, y] = feature.polygons[0][0][0];
  const distance = Math.hypot(x - cx, y - cy);
  return !best || distance < best.distance ? { feature, x, y, distance } : best;
}, null);
out.nearCentre = { id: near.feature.id, identifier: near.feature.identifier, vertex: [near.x, near.y],
  metresFromCentre: Number(near.distance.toFixed(1)) };
const around = (x, y, half) => ({ minX: x - half, minY: y - half, maxX: x + half, maxY: y + half });
for (const [label, key, window] of [['window 500 m', 'window500', centred(extent, 250)],
  ['window 50 m', 'window50', centred(extent, 25)],
  ['window 500 m near the centre', 'window500Near', around(near.x, near.y, 250)],
  ['window 50 m near the centre', 'window50Near', around(near.x, near.y, 25)]]) {
  const runs = [];
  for (let attempt = 1; attempt <= 3; attempt++) runs.push(await pages(`${label} run ${attempt}`, window));
  const read = runs[0];
  const picks = read.features.length ? [0, Math.floor(read.features.length / 2), read.features.length - 1]
    .filter((index, position, all) => all.indexOf(index) === position) : [];
  out[key] = { window,
    runs: runs.map((entry, index) => ({ run: index + 1, features: entry.features.length,
      seconds: Number(entry.trail.reduce((sum, page) => sum + page.seconds, 0).toFixed(3)),
      pages: entry.trail.length, bytes: entry.trail.reduce((sum, page) => sum + page.bytes, 0) })),
    sameIdsEachRun: runs.every(entry => entry.features.map(f => f.id).join() === read.features.map(f => f.id).join()),
    features: read.features.length, unique: new Set(read.features.map(f => f.id)).size,
    displayStates: tally(read.features, 'displayState'),
    allInWhole: read.features.every(feature => ids.has(feature.id)),
    samples: picks.map(index => sample(read.features[index])) };
}

out.refusals = await refuse({ minX, minY, maxX, maxY });
out.requests = requests;
save('part-b-window.json', out);
const brief = { ...out, requests: requests.length, whole: { ...out.whole, pages: out.whole.pages.length } };
console.log(JSON.stringify(brief, null, 1));
