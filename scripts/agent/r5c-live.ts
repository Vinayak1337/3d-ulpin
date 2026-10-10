// R5c reads the demo after its roll-out: snapshot order, identity reviews, plan entries and the card preview.
// Every request is a read; the two POST routes are reads that store nothing. `ocr` runs the product's own OCR
// entry once with the demo's paths (the owner check after the interpreter switch). It reuses R2's exchange
// helpers and the bodies in docs/evidence/gf4/k12/REQUESTS.md, unchanged.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildingId, exchange, save, type Exchange } from './r2-live';

const root = 'E:/BhuAayam-data/task-data/r5c';
const demoCheckout = 'E:/Projects/ulpin-wt/demo';
const unitId = '46b7265e-ca88-402d-83df-065cf7c45140';
const floorId = '614ca200-1f3d-48ac-b7db-d1b893b352a1';
const siteId = 'ed4bc3ae-1b02-412e-a5cc-02accf693a1b';
const scope = { kind: 'snapshot', scopeId: siteId, world: { namespace: 'world', id: `registry-site/${siteId}` },
  manifestId: 'a9fd4c9d-0a5a-4f4d-9032-527ab7857b78',
  snapshotDigest: 'b7bfa9d7c8f51583d80b985551161bdd758c47315b256267caf62e1d119ff7e0', stage: 'recorded' };
const record = (id: string) => ({ namespace: 'registry_record', id });
const card = { planId: '8f3ebb97-deab-4235-a377-819e5942bfd8', planVersion: 1,
  cardId: '6a997624-6c8d-40a9-8215-8a671a74dc1c' };
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const refusal = (result: Exchange) => ({ status: result.status, code: result.body?.error?.code ?? null,
  message: result.body?.error?.message ?? null });

// docs/evidence/gf1/k9/result.json difficult.newResultSha256, the same bytes as K2f's resultSha256.
const k9ResultSha256 = '3d69916ebbb8a5a802a1996d7ca6582148a5a95015cacc78d709cce9e0e8b81e';

const sheets = 'E:/BhuAayam-data/datasets/rera-storeys/haryana-2831/';
type Region = [number, number, number, number];
type OcrInput = { file: string; sha256: string; region: Region };
// K9's difficult input, and the recorded UNIT-3B label region of the Tower 3 plan sheet.
const sitePlan: OcrInput = { file: 'haryana-2831-site-plan.pdf', region: [280, 860, 960, 2580],
  sha256: '26c2d3101bfe676c8ac66f129439e066b603a555b3c55a35ba509befb707fad9' };
const label: OcrInput = { file: 'haryana-2831-tower3-plan1.pdf', region: [596, 390, 644, 409],
  sha256: '2b9f8803e179c515a694d046ba9c9e5394a79af59e3db75c1748c41fad04c865' };

/** Owner check: one bounded OCR run through the product's entry, with the demo's paths. No text is printed. */
async function ocr(name: string, input: OcrInput) {
  const config = await import(pathToFileURL(join(demoCheckout, 'scripts/platform/demo-config.mjs')).href);
  Object.assign(process.env, config.readDemoOcrPaths());
  const { runSourceOcr } = await import('../../packages/server/src/modules/usp/ingestion/document-ocr');
  const source = readFileSync(sheets + input.file);
  assert.equal(sha256(source), input.sha256);
  const started = Date.now();
  const result = await runSourceOcr({ jobId: randomUUID(), sourceSha256: input.sha256, sourceRevision: 1,
    sourceBytes: source.length, ocrSelection: { page: 1, region: input.region } }, source, started + 120000);
  const worker = result.execution?.worker ?? null;
  const resultSha256 = result.execution?.candidateSha256 ?? null;
  const summary = { file: input.file, region: input.region, python: process.env.ULPIN_DOCUMENT_OCR_PYTHON,
    method: result.method, supervisorExit: result.execution?.exitCode ?? null, workerExit: worker?.exitCode ?? null,
    stopReason: worker?.stopReason ?? null, workerSeconds: worker?.elapsedSeconds ?? null,
    peakJobPrivateBytes: worker?.peakJobPrivateBytes ?? null, resultSha256,
    sameResultBytesAsK9AndK2f: resultSha256 === k9ResultSha256,
    bridge: { toolStatus: result.toolStatus, outputStatus: result.outputStatus, issues: result.issues,
      lines: result.items.length, textSha256: sha256(result.items.map(item => item.text).join('\n')) },
    seconds: Math.round((Date.now() - started) / 1000) };
  save(join(root, 'roll'), `${name}.json`, summary);
  console.log(JSON.stringify(summary));
}

/** K8b: the Tower 3 listing; every item's capturedAt, and whether it ever rises from one item to the next. */
async function snapshots() {
  const path = `/api/v1/buildings/${buildingId}/snapshots?limit=20`;
  const result = await exchange(join(root, 'k8b'), 'tower3-limit-20', path);
  const items: any[] = result.body.items ?? [];
  const stamps = items.map(item => item.capturedAt);
  const summary = { status: result.status, items: items.length, truncated: result.body.truncated,
    unreadable: result.body.unreadable, everyItemHasCapturedAt: stamps.every(stamp => typeof stamp === 'string'),
    neverRises: stamps.every((stamp, index) => index === 0 || stamps[index - 1] >= stamp),
    listed: items.map(item => ({ manifestId: item.scope.manifestId, capturedAt: item.capturedAt,
      createdAt: item.createdAt })) };
  save(join(root, 'k8b'), 'summary.json', summary);
  console.log(JSON.stringify(summary));
}

/** K11b: the reviews of the recorded unit, three refusals, and a recorded floor that was never reviewed. */
async function reviews() {
  const directory = join(root, 'k11b');
  const path = (id: string, query: string) => `/api/v1/usp/identity/records/${id}/reviews${query}`;
  const unit = await exchange(directory, 'unit-limit-5', path(unitId, '?limit=5'));
  const floor = await exchange(directory, 'floor-no-review', path(floorId, '?limit=5'));
  const refused = [['unknown-record', path(randomUUID(), '?limit=5')], ['limit-0', path(unitId, '?limit=0')],
    ['limit-abc', path(unitId, '?limit=abc')]];
  const summary: Record<string, unknown> = { unit: { status: unit.status, body: unit.body },
    floor: { status: floor.status, body: floor.body } };
  for (const [name, target] of refused) summary[name] = refusal(await exchange(directory, name, target));
  save(directory, 'summary.json', summary);
  console.log(JSON.stringify(summary));
}

/** K12: the recorded unit's plan entries, then the building record of the same snapshot (another profile). */
async function entries() {
  const directory = join(root, 'k12');
  const route = '/api/v1/usp/packets/plans/entries';
  const target = (id: string, revision: number) => ({ scope, target: { ref: record(id), revision } });
  const unit = await exchange(directory, 'entries-unit', route, target(unitId, 2));
  const building = await exchange(directory, 'entries-building', route, target(buildingId, 5));
  const summary = { unit: unit.status === 200 ? { status: 200, target: unit.body.data.target,
    entries: unit.body.data.entries } : refusal(unit), building: refusal(building) };
  save(directory, 'entries-summary.json', summary);
  console.log(JSON.stringify(summary));
}

async function cardList(name: string) {
  const result = await exchange(join(root, 'k12', 'preview'), name, '/api/v1/usp/property-cards/list',
    { scope, target: record(unitId) });
  assert.equal(result.status, 200, `card list ${name}: HTTP ${result.status}`);
  return result.body.data;
}

/** K12: the revision preview, sent twice between two card lists. Only meta.requestId may differ between the two
 * answers of a pair; the lists' data must be the same text if nothing was stored. */
async function preview() {
  const directory = join(root, 'k12', 'preview');
  const before = await cardList('cards-before');
  const expiresAt = new Date(Date.now() + 23 * 3600000).toISOString();
  const guard = { mode: 'update', expectedVersion: 1, expectedManifestId: scope.manifestId };
  const body = { ...card, expiresAt, guard };
  const first = await exchange(directory, 'preview-1', '/api/v1/usp/property-cards/preview', body);
  const second = await exchange(directory, 'preview-2', '/api/v1/usp/property-cards/preview', body);
  const after = await cardList('cards-after');
  const counted = (list: any) => ({ items: list.items.length, truncated: list.truncated,
    newestRevision: Math.max(...list.items.map((item: any) => item.revision)),
    cards: list.items.map((item: any) => ({ cardId: item.cardId, revision: item.revision, expired: item.expired,
      revoked: item.revoked, superseded: item.superseded, expiresAt: item.expiresAt ?? null })) });
  const same = (one: unknown, other: unknown) => JSON.stringify(one) === JSON.stringify(other);
  const answer = first.status === 200 ? { status: 200, ...first.body.data } : refusal(first);
  const summary = { expiresAtSent: expiresAt, first: answer,
    repeatAnswersTheSame: same(first.body.data, second.body.data), cardsBefore: counted(before),
    cardsAfter: counted(after), cardListUnchanged: same(before, after) };
  save(directory, 'preview-summary.json', summary);
  console.log(JSON.stringify(summary));
}

async function main() {
  const actions: Record<string, () => Promise<void>> = { 'ocr-site-plan': () => ocr('ocr-site-plan', sitePlan),
    'ocr-label': () => ocr('ocr-label', label), snapshots, reviews, entries, preview };
  const action = process.argv[2];
  assert(actions[action], `Use ${Object.keys(actions).join(' | ')}`);
  await actions[action]();
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
