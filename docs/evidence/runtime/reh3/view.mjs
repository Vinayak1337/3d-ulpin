import { readFileSync } from 'node:fs';
import { save } from './audit.mjs';

// Part C 3, reads only: what the Studio would show for the REH3 batch. The batch manifest (state, placement, reason
// per item), packages and their counts, and the map. The Niagara area holds 41809 buildings and both map reads
// refuse it (AREA_LIMIT, 2000), so its place and samples are read from the packages the review page opens.
const API = 'http://127.0.0.1:21026';
const state = JSON.parse(readFileSync('E:/BhuAayam-data/task-data/reh3/state.json', 'utf8'));
const niagaraBox = [-79.2, 42.95, -78.9, 43.2];
const requests = [];

async function get(step, route, pattern) {
  const begin = performance.now();
  const response = await fetch(`${API}${route}`);
  const body = await response.json();
  const seconds = Number(((performance.now() - begin) / 1000).toFixed(3));
  requests.push({ step, route: pattern, status: response.status, seconds,
    refusal: response.ok ? null : { code: body?.error?.code ?? null, message: body?.error?.message ?? null } });
  return { status: response.status, body: body?.data ?? body };
}

const caseId = state.caseId;
const begin = performance.now();
const intake = await get('batch manifest', `/api/v1/ingestion/cases/${caseId}/intake`,
  '/api/v1/ingestion/cases/{caseId}/intake');
const targets = await get('batch packages', `/api/v1/ingestion/cases/${caseId}/targets`,
  '/api/v1/ingestion/cases/{caseId}/targets');
const items = intake.body.items.map(item => ({ itemId: item.itemId, parentItemId: item.parentItemId,
  memberPath: item.memberPath, name: item.name, family: item.family, format: item.format, state: item.state,
  placement: item.placement, reason: item.limitReason ?? null, recordsSeen: item.recordsSeen,
  partsPlanned: item.partsPlanned, partsDone: item.partsDone }));
const packages = targets.body.packages;
const areas = [...new Set(packages.map(entry => entry.areaId))];
const map = {};
for (const areaId of areas) {
  const context = await get('area context (map)', `/api/v1/areas/${areaId}/context`, '/api/v1/areas/{areaId}/context');
  const canonical = await get('area canonical (map)', `/api/v1/areas/${areaId}/canonical`,
    '/api/v1/areas/{areaId}/canonical');
  map[areaId] = { context: context.status, canonical: canonical.status,
    displayFeatures: context.status === 200 ? (context.body.displayFeatures ?? []).length : null };
}
const read = [];
for (const entry of packages) {
  const one = await get('package', `/api/v1/import-packages/${entry.packageId}`, '/api/v1/import-packages/{packageId}');
  read.push({ packageId: entry.packageId, areaId: entry.areaId, state: one.body.state, features: one.body.features,
    geographicExtent: one.body.geographicExtent, warnings: one.body.warnings, counts: entry.counts,
    reviewed: Boolean(entry.reviewFingerprint), reviewRefusal: entry.reviewRefusal ?? null });
}
const within = ([west, south, east, north]) => west >= niagaraBox[0] && east <= niagaraBox[2]
  && south >= niagaraBox[1] && north <= niagaraBox[3];
const all = read.flatMap(entry => entry.features);
const sample = feature => ({ id: feature.id, kind: feature.kind, name: feature.name,
  height: { state: feature.height?.state ?? null, value: feature.height?.value ?? null },
  sourceFeature: feature.evidence?.[0]?.featureId ?? null, geometryType: feature.geometry?.type ?? null,
  areaM2: Number(feature.areaM2?.toFixed(1)) });
save('part-c-view.json', {
  at: new Date().toISOString(), api: API, caseId, seconds: Number(((performance.now() - begin) / 1000).toFixed(1)),
  manifest: items, counts: targets.body.counts,
  packages: read.map(({ features, warnings, ...entry }) => ({ ...entry, features: features.length,
    warnings: warnings.length,
    extentInsideNiagaraBox: entry.geographicExtent ? within(entry.geographicExtent) : null })),
  map,
  niagara: { packages: read.length, features: all.length,
    everyPackageInsideBox: read.every(entry => entry.geographicExtent && within(entry.geographicExtent)),
    box: niagaraBox, heights: [...new Set(all.map(feature => feature.height?.state ?? null))],
    samples: [0, Math.floor(all.length / 2), all.length - 1].map(index => sample(all[index])),
    warningsOfFirstPackage: read[0]?.warnings ?? [] },
  nyc: { packages: 0, why: 'the buildings layer stopped at SOURCE_ALREADY_IN_AREA; part-c-nyc.json' },
  requests,
});
console.log(readFileSync('docs/evidence/runtime/reh3/part-c-view.json', 'utf8').slice(0, 6000));
