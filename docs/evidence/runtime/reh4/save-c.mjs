import { readFileSync } from 'node:fs';
import { save } from './audit.mjs';

// Part C's receipt from walk.ts's saved exchanges (no request sent here), with each layer's member path joined from
// the raw case answer: the walk's parsed case schema drops `inspection`, so its own join came back empty. Then one
// read of the buildings layer's item, the route the Studio's tray opens for an item.
const API = 'http://127.0.0.1:21026';
const scratch = 'E:/BhuAayam-data/task-data/reh4';
const walk = JSON.parse(readFileSync(`${scratch}/part-c.raw.json`, 'utf8'));
const exchange = n => JSON.parse(readFileSync(`${scratch}/c/${String(n).padStart(3, '0')}.json`, 'utf8'));
const detail = exchange(6);
const manifest = exchange(5);
const sources = new Map((detail.body.data ?? detail.body).sources.map(source => [source.id, source]));
const { result } = walk;
const row = item => ({ itemId: item.itemId, parentItemId: item.parentItemId, memberPath: item.memberPath,
  name: item.name, sourceId: item.sourceId, family: item.family, format: item.format, state: item.state,
  placement: item.placement, reason: item.limitReason ?? null, existingAreaId: item.existingAreaId ?? null });
const items = manifest.body.items.map(row);
const parent = items.find(item => item.itemId === result.parent.itemId);
const layers = items.filter(item => item.parentItemId === null && item.itemId !== parent.itemId).map(item => {
  const lineage = sources.get(item.sourceId)?.inspection?.archiveMember ?? null;
  return { member: lineage?.memberPath ?? null, memberSha256: lineage?.memberSha256 ?? null, ...item };
});
const buildings = layers.find(layer => layer.member === 'layers/buildings-original.geojson');
const begin = performance.now();
const response = await fetch(`${API}/api/v1/ingestion/cases/${result.caseId}/intake/items/${buildings.itemId}`);
const item = await response.json();
const seconds = Number(((performance.now() - begin) / 1000).toFixed(3));
const value = {
  at: new Date().toISOString(), api: API, caseId: result.caseId, wallSeconds: walk.wallSeconds,
  restSeconds: result.restSeconds, stoppedAt: walk.stoppedAt, input: result.input, zipRoute: result.zipRoute,
  archive: result.archive, requests: walk.requests, quietManifestReads: walk.quietReads, trail: result.trail,
  parent, layers, membersKeptInsideArchive: items.filter(entry => entry.parentItemId === parent.itemId)
    .filter(entry => !layers.some(layer => layer.member === entry.memberPath))
    .map(entry => ({ memberPath: entry.memberPath, state: entry.state, placement: entry.placement })),
  buildingsItemAsTheStudioReadsIt: { route: 'GET /api/v1/ingestion/cases/{caseId}/intake/items/{itemId}',
    status: response.status, seconds, ...row(item), cardFeatures: item.card?.counts?.features ?? null,
    cardCrs: item.card?.crs?.code ?? null, cardSha256Present: Boolean(item.cardSha256) },
  expected: {
    parentReadUndecidedWithWords: parent.state === 'read' && parent.placement === 'undecided'
      && /^6 map layers in this ZIP are taken in as their own files: /.test(parent.reason ?? ''),
    buildingsReadUndecidedWithSentence: buildings.state === 'read' && buildings.placement === 'undecided'
      && /^This file is already the source of the area /.test(buildings.reason ?? ''),
    buildingsExistingAreaIsReh2: buildings.existingAreaId?.startsWith('e4874150') ?? false,
    buildingsNotNeedsAnswer: buildings.placement !== 'needs_answer',
  },
};
save('part-c-nyc.json', value);
console.log(JSON.stringify(value, null, 1));
