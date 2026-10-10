// R4 proves the building snapshot listing against the demo database and passes listed scopes on, unchanged.
// Every request is a read. It reuses R2's exchange helpers and compares with the exchanges R3 saved.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { UspBuildingSnapshotListSchema, UspSnapshotManifestSchema, type SnapshotManifest,
} from '../../packages/contracts/src/usp/domain';
import { UspPropertyCardListSchema } from '../../packages/contracts/src/usp/property-card';
import { buildingId, exchange, save, stored, type Exchange } from './r2-live';

const root = 'E:/BhuAayam-data/task-data/r4';
const r3 = 'E:/BhuAayam-data/task-data/r3';
const listings = join(root, 'step3');
const magnoliaId = 'e8777ffc-9409-4129-bacf-f680160d8795';
const limits = [['default', ''], ['limit-1', '?limit=1'], ['limit-20', '?limit=20']];

/** What one listing answered: the listed manifests with their counts, or the refusal. */
function answered(name: string, result: Exchange) {
  if (result.status !== 200) {
    return { name, status: result.status, code: result.body?.error?.code ?? null,
      message: result.body?.error?.message ?? null };
  }
  const list = UspBuildingSnapshotListSchema.parse(result.body);
  return { name, status: 200, siteId: list.siteId, truncated: list.truncated, unreadable: list.unreadable,
    items: list.items.map(item => ({ manifestId: item.scope.manifestId, createdAt: item.createdAt,
      total: item.members.total, documentResultNotCurrent: item.members.documentResultNotCurrent })) };
}

/** Step 3: three limits for each building, then an unknown building and two refused limits. */
async function listing() {
  const summary = [];
  for (const [building, id] of [['tower3', buildingId], ['magnolia', magnoliaId]]) {
    for (const [limit, query] of limits) {
      const name = `${building}-${limit}`;
      summary.push(answered(name, await exchange(listings, name, `/api/v1/buildings/${id}/snapshots${query}`)));
    }
  }
  const refused = [['unknown-building', `${randomUUID()}/snapshots`], ['limit-0', `${buildingId}/snapshots?limit=0`],
    ['limit-abc', `${buildingId}/snapshots?limit=abc`]];
  for (const [name, path] of refused) {
    summary.push(answered(name, await exchange(listings, name, `/api/v1/buildings/${path}`)));
  }
  save(listings, 'listing-summary.json', summary);
  console.log(JSON.stringify(summary));
}

const savedListing = (name: string) => UspBuildingSnapshotListSchema.parse(stored('step3', name, 'response', root));
const listedItems = (name: string) => savedListing(name).items;
const sent = (name: string) => stored('step3', name, 'request', r3);
const unitId = () => stored('step2', '02-record').spaceId as string;

/** What a stored manifest holds: its counts, and the revision at which it pins the recorded unit. */
function held(manifest: SnapshotManifest) {
  const unit = manifest.members.find(member => member.pin.ref.id === unitId());
  return { capturedAt: manifest.capturedAt, total: manifest.members.length,
    documentResultNotCurrent: manifest.members.filter(member => member.documentResult?.current === false).length,
    unitRevision: unit?.pin.revision ?? null };
}

/** One listed snapshot against the scope R3 sent in its own requests: the same serialised text, key order included. */
function scopeEquality(items: ReturnType<typeof listedItems>, manifestId: string, requests: [string, unknown][]) {
  const position = items.findIndex(candidate => candidate.scope.manifestId === manifestId);
  const item = position < 0 ? null : items[position];
  return { manifestId, listed: item !== null, position, members: item?.members ?? null,
    equalToSaved: requests.map(([name, scope]) => ({ request: name,
      equal: item !== null && JSON.stringify(item.scope) === JSON.stringify(scope) })) };
}

/** No request: the Tower 3 listings against what R3 saved (its scopes, the first capture's members, the order). */
function compare() {
  const all = listedItems('tower3-limit-20');
  const one = savedListing('tower3-limit-1');
  const captured = UspSnapshotManifestSchema.parse(stored('step3', '02-snapshot', 'response', r3).data);
  const stamps = all.map(item => item.createdAt);
  const comparison = {
    listedManifests: all.map(item => item.scope.manifestId),
    newestFirst: stamps.every((stamp, index) => index === 0 || stamps[index - 1] >= stamp),
    createdAtSharedByTwo: stamps.filter((stamp, index) => stamps.indexOf(stamp) !== index),
    firstCapture: scopeEquality(all, captured.id, [['03-review', sent('03-review').scope],
      ['04-assign', sent('04-assign').scope]]),
    firstCaptureSeenInR3: held(captured),
    postAssign: scopeEquality(all, sent('05-resolve').scope.manifestId, [['05-resolve', sent('05-resolve').scope],
      ['06-plan', sent('06-plan').input.scope], ['13-list-unit', sent('13-list-unit').scope]]),
    limitOne: { items: one.items.length, truncated: one.truncated,
      sameAsNewest: JSON.stringify(one.items[0]) === JSON.stringify(all[0]) },
  };
  save(listings, 'tower3-comparison.json', comparison);
  console.log(JSON.stringify(comparison));
}

/** An added read: each listed scope, unchanged, to the manifest read, to count what the listing counted and to
 * see at which revision each snapshot holds the unit. */
async function manifests() {
  const summary = [];
  for (const building of ['tower3', 'magnolia']) {
    for (const [index, item] of listedItems(`${building}-limit-20`).entries()) {
      const name = `${building}-manifest-${index + 1}`;
      const result = await exchange(listings, name, '/api/v1/usp/snapshots/read', { scope: item.scope });
      const manifest = result.status === 200 ? UspSnapshotManifestSchema.parse(result.body.data) : null;
      summary.push({ name, manifestId: item.scope.manifestId, status: result.status,
        code: result.body?.error?.code ?? null, listed: { createdAt: item.createdAt, ...item.members },
        read: manifest && held(manifest) });
    }
  }
  save(listings, 'manifests-summary.json', summary);
  console.log(JSON.stringify(summary));
}

/** Step 4: the newest listed Tower 3 scope first, then each older one, to the card list of the recorded unit. */
async function cards() {
  const directory = join(root, 'step4');
  const generated = stored('step3', '09-card', 'response', r3).data as { cardId: string };
  const items = listedItems('tower3-limit-20');
  assert.deepEqual(listedItems('tower3-default')[0], items[0], 'The default listing names the same newest snapshot');
  const summary = [];
  for (const [index, item] of items.entries()) {
    const name = index === 0 ? 'newest-list-unit' : `older-${index}-list-unit`;
    const result = await exchange(directory, name, '/api/v1/usp/property-cards/list',
      { scope: item.scope, target: { namespace: 'registry_record', id: unitId() } });
    const list = result.status === 200 ? UspPropertyCardListSchema.parse(result.body.data) : null;
    summary.push({ name, manifestId: item.scope.manifestId, status: result.status,
      code: result.body?.error?.code ?? null, truncated: list?.truncated ?? null,
      items: list?.items.map(card => ({ cardId: card.cardId, revision: card.revision, integrity: card.integrity,
        revoked: card.revoked, superseded: card.superseded, expired: card.expired,
        snapshotState: card.snapshotState, isTheR3Card: card.cardId === generated.cardId })) ?? null });
  }
  save(directory, 'cards-summary.json', summary);
  console.log(JSON.stringify(summary));
}

async function main() {
  const actions: Record<string, () => void | Promise<void>> = { listing, compare, manifests, cards };
  const action = process.argv[2];
  assert(actions[action], `Use ${Object.keys(actions).join(' | ')}`);
  await actions[action]();
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
