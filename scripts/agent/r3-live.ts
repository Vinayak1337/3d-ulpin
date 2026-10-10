// R3 resumes the Tower 3 identity journey from the existing recorded space. It reuses R2's exchange helpers and
// records every request and response under its own create-once root. No configuration, SQL or provider call.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sourceSpaceStatementLocator } from '../../packages/contracts/src/canonical/source-spaces';
import { UspIdentityCommitReceiptSchema, UspSnapshotManifestSchema } from '../../packages/contracts/src/usp/domain';
import { PACKET_PDF_RECIPE } from '../../packages/contracts/src/usp/packet-pdf';
import { UspPacketPlanConfirmationSchema, UspPacketPlanExecutionSchema, UspPacketPlanSchema,
} from '../../packages/contracts/src/usp/packets';
import { AssignProjectCodeSchema, ProjectIdentityReviewSchema,
} from '../../packages/contracts/src/usp/project-identity';
import { UspPropertyCardListSchema, UspPropertyCardSchema, UspPropertyCardVerificationSchema,
  UspPropertyCardViewSchema } from '../../packages/contracts/src/usp/property-card';
import { accepted, base, buildingId, counts, exchange, readRecorded, reason, save, sourceHash, sourceId, stored,
} from './r2-live';

const root = 'E:/BhuAayam-data/task-data/r3';
const journey = join(root, 'step3');
const magnoliaId = 'e8777ffc-9409-4129-bacf-f680160d8795';
const refusedReads = ['register?profile=consolidated&format=json', 'register', 'ledger', 'dossier'];
const cards = '/api/v1/usp/property-cards';
// The source states no parcel, structure kind, level or use: the review carries the contract's unknown tokens.
const unknownLocation = { anchorState: 'not_supplied', parcels: [],
  locator: { structureKind: '?', structureNumber: 1, levels: ['L?'], spaceKind: '?', spaceNumber: 1 } };

/** The eight reads K6 names: status, the sources that state documentResult, and the ledger's missing notes. */
async function reads() {
  const directory = join(root, 'step2');
  const summary = [];
  for (const [building, id] of [['tower3', buildingId], ['magnolia', magnoliaId]]) {
    for (const read of refusedReads) {
      const name = `${building}-${read.split('?')[0]}${read.includes('consolidated') ? '-consolidated' : ''}`;
      const result = await exchange(directory, name, `/api/v1/buildings/${id}/${read}`);
      const sources = Array.isArray(result.body?.sources) ? result.body.sources : [];
      summary.push({ name, status: result.status, code: result.body?.code ?? null, sources: sources.length,
        documentResults: sources.filter((source: any) => source.documentResult)
          .map((source: any) => ({ id: source.id ?? source.sourceId, ...source.documentResult })),
        missing: Array.isArray(result.body?.missing) ? result.body.missing : null });
    }
  }
  save(directory, 'reads-summary.json', summary);
  console.log(JSON.stringify(summary));
}

/** A step is sent once. A deliberate second run resends the first body, same request key, beside the first. */
function attempt(step: string, build: (requestKey: string) => unknown) {
  const first = join(journey, `${step}-request.json`);
  if (!existsSync(first)) return { name: step, body: build(randomUUID()) };
  return { name: `${step}-retry`, body: JSON.parse(readFileSync(first, 'utf8')).body };
}

/** The accepted data of an earlier step, from its second run when one was needed. */
function earlier(step: string) {
  const name = existsSync(join(journey, `${step}-retry-response.json`)) ? `${step}-retry` : step;
  return stored('step3', name, 'response', root).data;
}

async function send(name: string, path: string, body?: unknown) {
  return accepted(name, await exchange(journey, name, path, body)).data;
}

async function download(name: string, path: string) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(60000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  const pdf = response.ok && response.headers.get('content-type') === 'application/pdf';
  mkdirSync(journey, { recursive: true });
  writeFileSync(join(journey, pdf ? `${name}.pdf` : `${name}-refusal.json`), bytes, { flag: 'wx' });
  save(journey, `${name}-receipt.json`, { path, status: response.status, bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), headers: Object.fromEntries(response.headers),
    at: new Date().toISOString() });
  console.log(`${name}: HTTP ${response.status}, ${bytes.length} bytes`);
  assert(pdf, `${name} did not answer a PDF`);
}

const recordedSpace = () => stored('step2', '02-record') as { spaceId: string; spaceRevision: number };
const expiry = () => new Date(Date.now() + (23 * 60 + 50) * 60 * 1000).toISOString();

/** The entry handle sourceStatementHandle() derives: SHA-256 of the pin with sorted keys (K4c REPORT, step 7). */
function statementHandle(target: { ref: { namespace: string; id: string }; revision: number }) {
  const pin = { target: { ref: { id: target.ref.id, namespace: target.ref.namespace }, revision: target.revision },
    version: 'source-stated-space/1' };
  return createHash('sha256').update(JSON.stringify(pin)).digest('hex');
}

async function canonicalBefore() {
  const { canonical, space } = await readRecorded('step3', root);
  assert.equal(canonical.levels.filter((level: any) => level.registryFloorId).length, 1, 'Exactly one recorded floor');
  assert.equal(canonical.levels.flatMap((level: any) => level.spaces).length, 1, 'Exactly one recorded unit');
  assert.equal(space.proposedCode.state, 'unknown');
}

/** R2's request, unchanged. It carried no request key and answered 409 before any write. */
async function snapshot() {
  const request = stored('step2', '03-snapshot', 'request');
  const manifest = UspSnapshotManifestSchema.parse(await send('02-snapshot', '/api/v1/usp/snapshots', request));
  const documentResults = manifest.members.filter(member => member.documentResult)
    .map(member => ({ pin: member.pin, authority: member.authority, ...member.documentResult }));
  const summary = { id: manifest.id, digest: manifest.digest, members: manifest.members.length,
    coverage: manifest.coverage, documentResults };
  save(journey, '02-snapshot-summary.json', summary);
  console.log(JSON.stringify(summary));
}

async function review() {
  const manifest = earlier('02-snapshot');
  const { spaceId, spaceRevision } = recordedSpace();
  const evidence = stored('step2', '02-record', 'request').space.evidence;
  const input = ProjectIdentityReviewSchema.parse({ operation: 'assign', scope: manifest.scope, recordIds: [spaceId],
    expectedVersions: { [spaceId]: spaceRevision }, reason, location: unknownLocation,
    evidence: [{ sourceId: evidence.sourceId, revision: evidence.sourceRevision,
      locator: sourceSpaceStatementLocator(evidence) }] });
  const receipt = await send('03-review', '/api/v1/usp/identity/reviews', input);
  assert.equal(receipt.expectedManifestId, manifest.id);
}

async function assign() {
  const manifest = earlier('02-snapshot');
  const { spaceId, spaceRevision } = recordedSpace();
  const { name, body } = attempt('04-assign', requestKey => AssignProjectCodeSchema.parse({ scope: manifest.scope,
    expectedManifestId: manifest.id, reviewId: earlier('03-review').reviewId, requestKey, recordId: spaceId,
    expectedRecordVersion: spaceRevision }));
  const receipt = UspIdentityCommitReceiptSchema.parse(await send(name, '/api/v1/usp/identity/assign', body));
  console.log(JSON.stringify({ code: receipt.outcome.codes[spaceId], after: receipt.after }));
}

function assignment() {
  const receipt = earlier('04-assign');
  const { spaceId } = recordedSpace();
  const target = receipt.after.find((pin: any) => pin.ref.id === spaceId);
  assert(target, 'The assignment receipt does not pin the space');
  return { receipt, target, code: receipt.outcome.codes[spaceId] as string };
}

async function assigned() {
  const { receipt, target, code } = assignment();
  const { space } = await readRecorded('step3-assigned', root, true);
  assert.equal(space.proposedCode.value, code);
  assert.equal(space.proposedCode.state, 'reviewed');
  const resolved = await send('05-resolve', '/api/v1/usp/identity/resolve',
    { scope: receipt.snapshot, identifier: code });
  assert.deepEqual([resolved.recordId, resolved.projectCode, resolved.recordVersion],
    [target.ref.id, code, target.revision]);
}

async function plan() {
  const { receipt, target } = assignment();
  const { name, body } = attempt('06-plan', requestKey => ({ guard: { mode: 'create', requestKey },
    input: { target, scope: receipt.snapshot, purpose: 'record_evidence', format: 'pdf', recipe: PACKET_PDF_RECIPE,
      expiresAt: expiry(), entries: [{ bindingId: statementHandle(target), required: true,
        inclusionReason: 'Officer-cited label UNIT-3B' }] } }));
  const created = UspPacketPlanSchema.parse(await send(name, '/api/v1/usp/packets/plans/create', body));
  console.log(JSON.stringify({ planId: created.planId, entry: created.entries[0].state,
    reasonCode: created.entries[0].reasonCode, requiredContext: created.requiredContext }));
  assert.equal(created.entries[0].state, 'included');
  assert.equal(created.requiredContext, 'available');
}

async function confirm() {
  const created = earlier('06-plan');
  const { name, body } = attempt('07-confirm', requestKey => ({ planId: created.planId, version: created.version,
    planSha256: created.planSha256, reviewed: true, guard: { mode: 'update', requestKey,
      expectedVersion: created.version, expectedManifestId: assignment().receipt.snapshot.manifestId } }));
  UspPacketPlanConfirmationSchema.parse(await send(name, '/api/v1/usp/packets/plans/confirm', body));
}

async function execute() {
  const created = earlier('06-plan');
  const { name, body } = attempt('08-execute', requestKey => ({ planId: created.planId, version: created.version,
    confirmationId: earlier('07-confirm').confirmationId, guard: { mode: 'create', requestKey } }));
  const execution = UspPacketPlanExecutionSchema.parse(await send(name, '/api/v1/usp/packets/plans/execute', body));
  await download('08-packet', `/api/v1/usp/packets/pdf/${execution.packet.packetId}/download`);
}

async function card() {
  const created = earlier('06-plan');
  const { name, body } = attempt('09-card', requestKey => ({ planId: created.planId, planVersion: created.version,
    cardId: null, expiresAt: expiry(), guard: { mode: 'create', requestKey } }));
  const generated = UspPropertyCardSchema.parse(await send(name, `${cards}/generate`, body));
  console.log(JSON.stringify({ cardId: generated.cardId, revision: generated.revision,
    expiresAt: generated.expiresAt, resolverUrl: generated.resolverUrl }));
}

async function cardRead() {
  const { cardId, revision } = earlier('09-card');
  UspPropertyCardViewSchema.parse(await send('10-card-read', `${cards}/read`, { cardId, revision }));
  await download('11-card', `${cards}/${cardId}/revisions/${revision}`);
  const report = UspPropertyCardVerificationSchema.parse(
    await send('12-card-verification', `${cards}/${cardId}/revisions/${revision}/verification`));
  assert.equal(report.result, 'consistent');
  assert.equal(report.checks.filter(check => check.state === 'pass').length, 6);
  assert.deepEqual([report.lifecycle.superseded, report.lifecycle.expired, report.lifecycle.revocation],
    [false, false, null]);
}

/** A read: it writes nothing. The unit must list exactly the generated card; the building's answer is recorded. */
async function list() {
  const generated = earlier('09-card');
  const body = (id: string) => ({ scope: generated.scope, target: { namespace: 'registry_record', id } });
  const building = await exchange(journey, '14-list-building', `${cards}/list`, body(buildingId));
  console.log(JSON.stringify({ building: building.status, code: building.body?.error?.code ?? null,
    items: building.body?.data?.items?.length ?? null }));
  const listed = UspPropertyCardListSchema.parse(await send('13-list-unit', `${cards}/list`,
    body(recordedSpace().spaceId)));
  assert.equal(listed.items.length, 1);
  const [item] = listed.items;
  assert.deepEqual([item.cardId, item.revision, item.integrity, item.revoked, listed.truncated],
    [generated.cardId, generated.revision, 'consistent', false, false]);
}

/** Existing routes only, no stored byte altered: each case must answer as an unknown card does. */
async function tamper() {
  const { cardId } = earlier('09-card');
  const changed = cardId.slice(0, -1) + (cardId.endsWith('0') ? '1' : '0');
  const cases = [['unknown-card', randomUUID(), 1], ['changed-id', changed, 1], ['revision-2', cardId, 2]] as const;
  const summary: { label: string; route: string; status: number; code: string | null; message: string | null }[] = [];
  for (const [label, id, revision] of cases) {
    const verification = await exchange(journey, `15-${label}-verification`,
      `${cards}/${id}/revisions/${revision}/verification`);
    const read = await exchange(journey, `15-${label}-read`, `${cards}/read`, { cardId: id, revision });
    for (const [route, result] of [['verification', verification], ['read', read]] as const) {
      summary.push({ label, route, status: result.status, code: result.body?.error?.code ?? null,
        message: result.body?.error?.message ?? null });
    }
  }
  save(journey, '15-tamper-summary.json', summary);
  console.log(JSON.stringify(summary));
  const [first] = summary;
  assert(summary.every(row => row.status === 404 && row.code === first.code && row.message === first.message));
}

/** Step 4: the reads behind the Studio's review and register pages, after the journey or where it stopped. */
async function studio() {
  const directory = join(root, 'step4');
  const assignedCode = existsSync(join(journey, '04-assign-response.json')) ? assignment().code : null;
  const { space } = await readRecorded('step4', root, assignedCode !== null);
  assert.equal(space.proposedCode.value, assignedCode);
  const query = `revision=1&sha256=${sourceHash}&offset=0&limit=1`;
  accepted('cited page', await exchange(directory, 'cited-page', `/api/v1/sources/${sourceId}/pages?${query}`));
  for (const read of ['ledger', 'register?profile=consolidated&format=json']) {
    const path = `/api/v1/buildings/${buildingId}/${read}`;
    const text = JSON.stringify(accepted(read, await exchange(directory, read.split('?')[0], path)));
    console.log(JSON.stringify({ read, floorLabel: text.includes('2ND FLOOR PLAN'), unitLabel: text.includes('UNIT-3B'),
      assignedCode: assignedCode !== null && text.includes(assignedCode) }));
  }
}

async function main() {
  const [action, stage] = process.argv.slice(2);
  if (action === 'counts') {
    assert(stage && /^[a-z0-9-]+$/.test(stage));
    return counts(stage, root);
  }
  const actions: Record<string, () => Promise<void>> = { reads, canonical: canonicalBefore, snapshot, review, assign,
    assigned, plan, confirm, execute, card, 'card-read': cardRead, list, tamper, studio };
  assert(actions[action], `Use counts <stage> | ${Object.keys(actions).join(' | ')}`);
  await actions[action]();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
