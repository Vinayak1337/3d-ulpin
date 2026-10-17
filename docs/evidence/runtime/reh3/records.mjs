import assert from 'node:assert/strict';
import { save } from './audit.mjs';

// Part B 4: REH2's records read back through the product's routes after the roll; reads only.
const API = 'http://127.0.0.1:21026';
const caseId = '55d54ba5-95d1-4596-8fc6-ea5d3a36e1b6';
const reh2 = { nycPackage: '70c207f6-b5c7-45a0-9db2-89f9e1e85dcc', ready: 1661,
  areaId: 'e4874150-ba45-4282-af98-61f2d50007b7', niagaraPlacement: 'not_understood' };

async function get(route) {
  const begin = performance.now();
  const response = await fetch(`${API}${route}`);
  const body = await response.json();
  return { route, status: response.status, seconds: Number(((performance.now() - begin) / 1000).toFixed(3)), body };
}

const detail = await get(`/api/v1/cases/${caseId}`);
const intake = await get(`/api/v1/ingestion/cases/${caseId}/intake`);
const targets = await get(`/api/v1/ingestion/cases/${caseId}/targets`);
const context = await get(`/api/v1/areas/${reh2.areaId}/context`);
const area = context.body?.data ?? context.body;
const value = {
  at: new Date().toISOString(), api: API, caseId, asReh2LeftThem: reh2,
  requests: [detail, intake, targets, context].map(({ route, status, seconds }) => ({ route, status, seconds })),
  case: { revision: detail.body?.case?.revision ?? null, name: detail.body?.case?.name ?? null },
  items: intake.body.items.map(item => ({ itemId: item.itemId, format: item.format, state: item.state,
    placement: item.placement, reason: item.limitReason ?? null, recordsSeen: item.recordsSeen ?? null })),
  packages: targets.body.packages.map(entry => ({ packageId: entry.packageId, areaId: entry.areaId,
    state: entry.state, counts: entry.counts, reviewed: Boolean(entry.reviewFingerprint) })),
  counts: targets.body.counts,
  mapFeatures: (area?.displayFeatures ?? []).length,
};
value.sameAsReh2 = value.packages.length === 1 && value.packages[0].packageId === reh2.nycPackage
  && value.mapFeatures === reh2.ready && value.items.some(item => item.placement === reh2.niagaraPlacement);
assert([detail, intake, targets, context].every(entry => entry.status === 200));
save('step-b4-records.json', value);
console.log(JSON.stringify(value, null, 2));
