import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { save } from './audit.mjs';

// REH6 Part B1-B2, through the product's routes only: Niagara's display summary and one 500 m window at the extent's
// centre (as REH5's window.mjs), then the two reads the Studio register page makes (queries.ts:288 canonical,
// queries.ts:495 register) for each building of that window, and the same two for an id that is not a building
// (the area's own id). Raw answers stay in scratch, outside Git; revision digests are not copied here.
// A first run's receipt held them and is kept in scratch as part-b-register.first-run.json.
const API = 'http://127.0.0.1:21026';
const areaId = 'a1c1252a-949f-42a7-a879-5ad2aaa7cc46';
const scratch = 'E:/BhuAayam-data/task-data/reh6';
const requests = [];
let count = 0;

async function get(step, route) {
  const begin = performance.now();
  const response = await fetch(`${API}${route}`);
  const text = await response.text();
  const seconds = Number(((performance.now() - begin) / 1000).toFixed(3));
  writeFileSync(`${scratch}/b2-${String(++count).padStart(3, '0')}.json`, text, { flag: 'wx' });
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  const row = { step, route: route.replace(areaId, '{areaId}'), status: response.status, seconds,
    bytes: Buffer.byteLength(text) };
  if (response.status >= 400) row.refusal = { code: body?.error?.code ?? null, words: body?.error?.message ?? null };
  requests.push(row);
  return { status: response.status, body: body?.data ?? body, row };
}

/** The first sentence-like string under any key named gaps, found depth first. */
function firstGap(value) {
  if (!value || typeof value !== 'object') return null;
  for (const [key, entry] of Object.entries(value)) {
    if (/gaps?$/i.test(key) && Array.isArray(entry) && entry.length) {
      const gap = entry[0];
      return typeof gap === 'string' ? { key, gap } : { key, gap: gap.message ?? gap.reason ?? gap.text ?? gap };
    }
  }
  for (const entry of Object.values(value)) {
    const found = firstGap(entry);
    if (found) return found;
  }
  return null;
}

const out = { at: new Date().toISOString(), api: API, areaId };
const summary = await get('display-summary', `/api/v1/areas/${areaId}/display-summary`);
assert.equal(summary.status, 200);
const { featureCount, extent, areaRevision } = summary.body;
out.summary = { ...summary.row, featureCount, extent, areaRevision, reh5: { featureCount: 41809, seconds: 1.76 } };
const [minX, minY, maxX, maxY] = extent;
const [cx, cy] = [(minX + maxX) / 2, (minY + maxY) / 2];
const window = { minX: cx - 250, minY: cy - 250, maxX: cx + 250, maxY: cy + 250, limit: 4000 };
const query = new URLSearchParams(Object.entries(window).map(([k, v]) => [k, String(v)]));
const read = await get('window 500 m at the centre', `/api/v1/areas/${areaId}/display-window?${query}`);
assert.equal(read.status, 200);
const features = read.body.features;
out.window500 = { ...read.row, window, features: features.length, next: read.body.next ? 'set' : null,
  displayStates: [...new Set(features.map(feature => feature.displayState))],
  reh5: { features: 3, seconds: [1.52, 1.52, 1.53] } };

const ids = features.slice(0, 3).map(feature => ({ id: feature.id, identifier: feature.identifier,
  displayState: feature.displayState }));
out.buildings = [];
for (const building of ids) {
  const canonical = await get(`canonical ${building.identifier}`, `/api/v1/buildings/${building.id}/canonical`);
  const register = await get(`register ${building.identifier}`, `/api/v1/buildings/${building.id}/register`);
  const body = canonical.body ?? {};
  out.buildings.push({ ...building, canonical: canonical.row, register: register.row,
    recordState: body.recordState ?? null, footprintState: body.footprint?.state ?? null,
    heightM: body.heightM ? { value: body.heightM.value, state: body.heightM.state, unit: body.heightM.unit } : null,
    heightState: body.heightState ?? null, firstGap: firstGap(body),
    topLevelKeys: Object.keys(body) });
}
const notBuilding = { id: areaId, what: 'the area id: a real record, not a building' };
out.notABuilding = { ...notBuilding,
  canonical: (await get('canonical not a building', `/api/v1/buildings/${areaId}/canonical`)).row,
  register: (await get('register not a building', `/api/v1/buildings/${areaId}/register`)).row };
out.expected = { canonical200: out.buildings.every(entry => entry.canonical.status === 200),
  candidate: out.buildings.every(entry => entry.recordState === 'candidate'),
  notABuilding404: out.notABuilding.canonical.status === 404 };
out.requests = requests;
save('part-b-register.json', out);
console.log(JSON.stringify(out, null, 1));
