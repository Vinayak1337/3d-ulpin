import { readFileSync } from 'node:fs';
import { keep, safe, save } from './audit.mjs';

// The NYC phase stopped at its fourth write (409) and walk.ts, as REH2 wrote it, then dropped what it had found.
// This rebuilds that result from the phase's own saved response bodies, in the walk's shapes; no request is sent.
const scratch = 'E:/BhuAayam-data/task-data/reh3';
const plan = JSON.parse(readFileSync('docs/evidence/runtime/reh3/plan-c.json', 'utf8'));
const phase = JSON.parse(readFileSync(`${scratch}/part-c-nyc.raw.json`, 'utf8'));
const raw = n => JSON.parse(readFileSync(`${scratch}/raw/nyc-${String(n).padStart(3, '0')}.json`, 'utf8'));
const itemRow = item => ({ itemId: item.itemId, parentItemId: item.parentItemId, memberPath: item.memberPath,
  name: item.name, sourceId: item.sourceId, family: item.family, format: item.format, state: item.state,
  placement: item.placement, reason: item.limitReason ?? null, sizeBytes: item.sizeBytes,
  recordsSeen: item.recordsSeen ?? null, plan: item.plan ? { recipeState: item.plan.recipeState,
    origin: item.plan.origin, packageId: item.plan.packageId } : null });

const archive = raw(3).body;
const parent = raw(4).body;
const first = raw(5).body;
const detail = raw(6).body;
const card = raw(7).body;
const profile = raw(8).body;
const refusal = raw(9);
const sources = new Map(detail.sources.map(source => [source.id, source]));
const layers = first.items.filter(item => item.parentItemId === parent.itemId).map(member => {
  const child = member.sourceId ? first.items.find(item => item.parentItemId === null
    && item.sourceId === member.sourceId) : null;
  const source = member.sourceId ? sources.get(member.sourceId) : null;
  return { memberPath: member.memberPath, memberRow: itemRow(member), childSourceId: member.sourceId,
    childItem: child ? itemRow(child) : null,
    childOriginal: source ? { name: source.name, profile: source.profile, bytes: source.bytes, sha256: source.sha256,
      status: source.status } : null,
    lineage: source?.inspection?.archiveMember ?? null };
});
const buildings = layers.find(layer => layer.memberPath === plan.expectedLayer.member);
for (const layer of layers) if (layer.childOriginal) keep(layer.childOriginal.sha256);
for (const layer of layers) if (layer.lineage) { keep(layer.lineage.memberSha256); keep(layer.lineage.parentSha256); }
const result = {
  rebuiltFrom: 'raw exchanges nyc-003 to nyc-009 in scratch (response bodies as received)',
  zipRoute: 'intake (walk.ts asserted it before the first request; the case was created only after it)',
  archive,
  parentRegistered: { ...itemRow(parent), cardFormat: parent.card?.format ?? null,
    cardMembers: parent.card?.members.map(member => ({ name: member.name, format: member.format,
      family: member.family, sizeBytes: member.sizeBytes, refusalCode: member.refusalCode })) ?? null },
  parent: itemRow(first.items.find(item => item.itemId === parent.itemId)),
  otherTopLevelItems: first.items.filter(item => item.parentItemId === null && item.itemId !== parent.itemId
    && !layers.some(layer => layer.childSourceId === item.sourceId)).map(itemRow),
  layers,
  buildingsSha256MatchesReh2Member: buildings?.childOriginal?.sha256 === plan.expectedLayer.sha256,
  card: { present: Boolean(card.card), format: card.card?.format ?? null, family: card.family,
    sizeClass: card.sizeClass, crs: card.card?.crs ?? null, features: card.card?.counts.features ?? null,
    geometryTypes: card.card?.geometryTypes ?? null, extent4326: card.card?.extent.epsg4326 ?? null },
  toQuestion: { trail: 'progress.jsonl: probed/undecided at 0 s, planned/needs_answer at 2 s',
    rested: { placement: 'needs_answer', reason: refusal.body?.error?.message ?? null } },
  profile: { version: profile.version, featureCount: profile.featureCount, crs: profile.crs,
    geometryTypes: profile.geometryTypes, identifierCandidates: (profile.paths ?? [])
      .filter(path => path.literalIdEligible || path.integerIdEligible).map(path => path.path),
    limitations: profile.limitations },
  refusal: { step: refusal.step, route: '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/recipes',
    status: refusal.status, code: refusal.body?.error?.code ?? null, message: refusal.body?.error?.message ?? null },
};
save('part-c-nyc.json', JSON.parse(safe(JSON.stringify({ ...phase, result }))));
console.log(JSON.stringify(result, null, 1));
