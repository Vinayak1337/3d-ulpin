import { save } from './audit.mjs';

// One read through the batch's target page: REH3's case still holds the Niagara area and its 21 packages.
const API = 'http://127.0.0.1:21026';
const caseId = '50f6f915-7e3f-4f11-988b-f2825b286295';
const areaId = 'a1c1252a-949f-42a7-a879-5ad2aaa7cc46';
const begin = performance.now();
const response = await fetch(`${API}/api/v1/ingestion/cases/${caseId}/targets`);
const page = await response.json();
const seconds = Number(((performance.now() - begin) / 1000).toFixed(3));
const niagara = page.packages.filter(entry => entry.areaId === areaId);
const value = { at: new Date().toISOString(), route: 'GET /api/v1/ingestion/cases/{caseId}/targets', caseId,
  status: response.status, seconds, counts: page.counts, packages: page.packages.length,
  niagaraArea: { areaId, packages: niagara.length, allReviewed: niagara.every(entry => entry.reviewFingerprint),
    states: [...new Set(niagara.map(entry => entry.state))] },
  otherAreas: [...new Set(page.packages.map(entry => entry.areaId).filter(id => id !== areaId))] };
save('step-a3-records.json', value);
console.log(JSON.stringify(value, null, 2));
