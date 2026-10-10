import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

const sites = [];
for (const siteId of ['e5742536-cedd-455b-b59d-c8172875c6f2', 'ed4bc3ae-1b02-412e-a5cc-02accf693a1b']) {
  const response = await fetch(`http://127.0.0.1:3194/api/v1/sites/${siteId}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert(body.site && Array.isArray(body.records));
  sites.push({ siteId, frame: body.site.frame, revision: body.site.revision,
    recordedFloors: body.records.filter(record => record.kind === 'floor' && record.revision > 0).length,
    recordedSpaces: body.records.filter(record => record.kind === 'space' && record.revision > 0).length,
    exchangeFrameSupported: /^EPSG:[1-9][0-9]{2,6}$/.test(body.site.frame.id),
  });
}
writeFileSync('docs/evidence/gf1/k4a/site-readiness.json', JSON.stringify({
  observedAt: new Date().toISOString(), method: 'GET site details; no product writes', sites,
}) + '\n', { flag: 'wx' });
console.log('Inspected registry floor/space counts and the actual exchange-frame guard.');
