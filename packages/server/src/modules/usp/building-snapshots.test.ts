import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import type { RequestContext } from '@ulpin/contracts/usp';
import { transaction } from '../../infrastructure/db';
import { AppError } from '../../infrastructure/errors';
import { fingerprint } from '../cases/domain';
import { buildingLedger } from '../officer/building-ledger';
import { retainedTower } from '../officer/source-spaces.test-fixture';
import { listBuildingSnapshots } from './building-snapshots';
import { documentInput, documentSourceTx } from './ingestion/document-context';
import { listPropertyCards } from './packets/card-listing';
import { assignProjectCode, resolveProjectIdentity } from './project-identity';
import { captureRegistrySnapshot, readManifest } from './snapshots';
import { control, errorCode, prepare, type SourceFixture } from './source-stated-identity.test-fixture';

type Values = readonly any[];
type Stored = { id: string; scope_id: string; digest: string; body: any; created_at: Date };
type Double = {
  snapshots: Stored[]; buildings: Map<string, string>; jobs: Map<string, object>; statements: string[];
};
const globals = globalThis as unknown as { ulpinPool?: unknown };
const buildingId = retainedTower.buildingId;
const siteId = retainedTower.areaId;
const digest = 'e'.repeat(64);

/** jsonb `left @> right` for objects, arrays and scalars: the containment the page statement asks for. */
function contains(left: unknown, right: unknown): boolean {
  if (Array.isArray(right)) {
    return Array.isArray(left) && right.every(wanted => left.some(held => contains(held, wanted)));
  }
  if (right === null || typeof right !== 'object') return left === right;
  if (left === null || typeof left !== 'object' || Array.isArray(left)) return false;
  const held = left as Record<string, unknown>;
  return Object.entries(right).every(([key, wanted]) => key in held && contains(held[key], wanted));
}

/** The page statement of building-snapshots.ts over the rows this double recorded. */
function page(double: Double, values: Values) {
  const [scopeId, accessViewId, policyVersion, member, limit] = values;
  return double.snapshots
    .filter(row => row.scope_id === scopeId && row.body.accessViewId === accessViewId
      && row.body.policyVersion === policyVersion && contains(row.body.members, JSON.parse(member)))
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
    .slice(0, limit)
    .map(row => ({ ...row, body: structuredClone(row.body) }));
}

/** Rows for the statements the existing protocol double does not hold, or undefined to leave one to it. */
function answer(double: Double, sql: string, values: Values): unknown[] | undefined {
  if (sql.startsWith('SELECT a.site_id FROM physical_features')) {
    return double.buildings.has(values[0]) ? [{ site_id: double.buildings.get(values[0]) }] : [];
  }
  if (sql.startsWith('SELECT id,digest,body,created_at FROM usp_snapshots')) return page(double, values);
  // The ledger's root read of a building this double does not hold, and the card page of a store without cards.
  if (sql.startsWith('SELECT f.id,f.identifier') && !double.buildings.has(values[0])) return [];
  if (sql.startsWith('SELECT c.id,c.revision,c.manifest_id')) return [];
  if (/\bFROM jobs\b/.test(sql)) return double.jobs.has(values[0]) ? [structuredClone(double.jobs.get(values[0]))] : [];
  return undefined;
}

/** Keeps what the snapshot insert writes besides its body; rows are created one second apart, in order. */
function remember(double: Double, sql: string, values: Values) {
  if (!sql.startsWith('INSERT INTO usp_snapshots')) return;
  const [id, scope_id, snapshotDigest, body] = values;
  const created_at = new Date(Date.UTC(2026, 9, 10, 12, 0, double.snapshots.length));
  double.snapshots.push({ id, scope_id, digest: snapshotDigest, body: structuredClone(body), created_at });
}

/** One scenario on the snapshot protocol double with the two statements of the listing added to it. */
function withListing(work: (f: SourceFixture, double: Double) => Promise<void>) {
  return control(async f => {
    const double: Double = { snapshots: [], buildings: new Map([[buildingId, siteId]]), jobs: new Map(),
      statements: [] };
    const query = async (text: string, values: any[] = []) => {
      const sql = text.replace(/\s+/g, ' ').trim();
      double.statements.push(sql);
      remember(double, sql, values);
      const rows = answer(double, sql, values);
      return rows ? { rows, rowCount: rows.length } : f.memory.query(text, values);
    };
    globals.ulpinPool = { connect: async () => ({ query, release() {} }), query };
    await work(f, double);
  });
}

const list = (f: SourceFixture, limit?: number) => listBuildingSnapshots(f.ctx, { buildingId, limit });
const storedScopes = (rows: Stored[]) => rows.map(row => JSON.stringify(row.body.scope));

/** The fixture's capture under another caller context. */
function captureAs(f: SourceFixture, ctx: RequestContext) {
  const revision = f.db.rows.find(row => row.id === f.recorded.spaceId).revision;
  const pins = [{ ref: { namespace: 'registry_record', id: f.recorded.spaceId }, revision }];
  return captureRegistrySnapshot(ctx, siteId, { kind: 'targets', pins });
}

/** A second document original on the site whose accepted reading was made by a reader that has since changed
 * (the case of snapshot-retained-documents.test.ts). */
async function retainDocumentWithMovedOnReader(f: SourceFixture, double: Double) {
  const id = randomUUID();
  const jobId = randomUUID();
  const original = { version: 'source-document/1', subject: process.env.ULPIN_LOCAL_OPERATOR_SUBJECT,
    format: 'pdf', sha256: digest, bytes: 1, receivedAt: '2026-10-09T23:19:53Z' };
  const source = { id, case_id: f.memory.sources[0].case_id, family_id: id, revision: 1, sha256: digest, bytes: 1,
    object_key: 'memory-only-no-object-read/boundary',
    inspection: { documentOriginal: original, documentAccepted: { jobId, sha256: digest } } };
  f.memory.sources.push(source);
  const context = await transaction(client => documentSourceTx(client, source.case_id, id));
  const input = { ...documentInput(context, jobId, 'native_only'), readerSha256: '0'.repeat(64) };
  double.jobs.set(jobId, { payload: input, status: 'succeeded', input_fingerprint: fingerprint(input),
    input_sha256: fingerprint(input), logical_state: 'succeeded', result_ref: { sha256: digest } });
}

async function refusal(read: () => Promise<unknown>) {
  try {
    await read();
    return null;
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return { status: error.status, code: error.code, message: error.message };
  }
}

// Rows of docs/evidence/gf1/k8/result.json. Written only when K8_EVIDENCE_FILE is set.
const observations: object[] = [];
function observe(condition: string, expected: string, observed: object) {
  observations.push({ condition, expected, observed });
}
after(async () => {
  const file = process.env.K8_EVIDENCE_FILE;
  if (file) await writeFile(file, JSON.stringify(observations));
});

test('two snapshots of one site are listed newest first, each with the scope its manifest stores',
  () => withListing(async (f, double) => {
    const older = await f.capture();
    const newer = await f.capture();
    const mark = double.statements.length;
    const result = await list(f);
    const issued = double.statements.slice(mark).filter(sql => !/^(BEGIN|COMMIT)/.test(sql));

    assert.deepEqual(result.items.map(item => item.scope.manifestId), [newer.id, older.id]);
    assert.deepEqual(result.items.map(item => JSON.stringify(item.scope)),
      storedScopes([...double.snapshots].reverse()));
    assert.deepEqual(result.items.map(item => item.createdAt),
      ['2026-10-10T12:00:01.000Z', '2026-10-10T12:00:00.000Z']);
    assert.deepEqual(result.items[0].members, { total: newer.members.length, documentResultNotCurrent: 0 });
    assert.deepEqual({ ...result, items: [] },
      { buildingId, siteId, items: [], truncated: false, unreadable: 0 });
    assert.equal(issued.length, 2);
    assert.match(issued[1], /scope_id=\$1 AND body->>'accessViewId'=\$2 AND body->>'policyVersion'=\$3/);
    assert.match(issued[1], /body->'members' @> \$4::jsonb ORDER BY created_at DESC,id DESC LIMIT \$5$/);
    assert(!issued.some(sql => /^(INSERT|UPDATE|DELETE)/.test(sql)));
    observe('two snapshots of the tower site', 'both listed newest first; scopes equal the stored manifests byte '
      + 'for byte; two statements, no write', { status: 200, items: result.items.length, statements: issued.length,
      members: result.items[0].members, truncated: result.truncated, unreadable: result.unreadable });
  }));

test('a snapshot captured under another access view or policy is absent and leaves the list as it was',
  () => withListing(async (f, double) => {
    await f.capture();
    const before = await list(f);
    await captureAs(f, { ...f.ctx, accessViewId: 'another-view-1' });
    await captureAs(f, { ...f.ctx, policyVersion: 'usp-local-2' });

    assert.equal(double.snapshots.length, 3);
    assert.deepEqual(await list(f), before);
    assert.deepEqual(await list(f, 1), before);
    observe('two newer snapshots of the same site under another access view and another policy',
      'neither listed; the answer equals the one before them, also at limit 1 (truncated stays false)',
      { status: 200, stored: double.snapshots.length, items: before.items.length, truncated: before.truncated });
  }));

test('a building on another site, or one a site snapshot does not list, sees none of the snapshots',
  () => withListing(async (f, double) => {
    await f.capture();
    const elsewhere = { buildingId: randomUUID(), siteId: randomUUID() };
    const unlisted = randomUUID();
    double.buildings.set(elsewhere.buildingId, elsewhere.siteId);
    double.buildings.set(unlisted, siteId);
    const empty = { items: [], truncated: false, unreadable: 0 };

    assert.deepEqual(await listBuildingSnapshots(f.ctx, { buildingId: elsewhere.buildingId }),
      { ...elsewhere, ...empty });
    assert.deepEqual(await listBuildingSnapshots(f.ctx, { buildingId: unlisted }),
      { buildingId: unlisted, siteId, ...empty });
    observe('a building of another site; a building of the same site that the snapshot does not list',
      'no item for either', { status: 200, otherSiteItems: 0, unlistedItems: 0 });
  }));

test('a snapshot whose cited document reader moved on is listed with its count, not refused',
  () => withListing(async (f, double) => {
    await retainDocumentWithMovedOnReader(f, double);
    const manifest = await f.capture();
    const result = await list(f);

    assert.deepEqual(result.items.map(item => item.scope), [manifest.scope]);
    assert.equal(result.items[0].members.documentResultNotCurrent, 1);
    assert.equal(manifest.members.filter(member => member.documentResult?.current === false).length, 1);
    observe('a snapshot holding a document whose reader moved on', 'listed; documentResultNotCurrent 1',
      { status: 200, items: 1, members: result.items[0].members });
  }));

test('a snapshot stays listed while readManifest refuses its scope for an archived case',
  () => withListing(async f => {
    const manifest = await f.capture();
    f.memory.archived = true;

    await assert.rejects(readManifest(f.ctx, manifest.scope), errorCode('DOCUMENT_DENIED'));
    assert.deepEqual((await list(f)).items.map(item => item.scope), [manifest.scope]);
    observe('the case of the cited documents was archived after the capture',
      'still listed; readManifest refuses the listed scope with 403 DOCUMENT_DENIED',
      { status: 200, items: 1, readManifest: 'DOCUMENT_DENIED' });
  }));

test('limit 1 with two snapshots answers the newest one and says the list is truncated',
  () => withListing(async (f, double) => {
    await f.capture();
    const newer = await f.capture();
    const result = await list(f, 1);

    assert.deepEqual(result.items.map(item => item.scope.manifestId), [newer.id]);
    assert.equal(result.truncated, true);
    assert.equal((await list(f, 2)).truncated, false);
    const mark = double.statements.length;
    for (const limit of [0, 21, 1.5]) await assert.rejects(list(f, limit), { name: 'ZodError' });
    assert.equal(double.statements.length, mark);
    observe('two snapshots, limit 1, 2, and 0 / 21 / 1.5', 'one item and truncated true; two and false; a limit '
      + 'outside 1 to 20 is refused before any statement', { items: result.items.length,
      truncated: result.truncated, refused: 'ZodError' });
  }));

test('an unknown building answers the 404 of the building ledger', () => withListing(async f => {
  const unknown = randomUUID();
  const answered = await refusal(() => listBuildingSnapshots(f.ctx, { buildingId: unknown }));

  assert.deepEqual(answered, { status: 404, code: 'NOT_FOUND', message: 'Building not found.' });
  assert.deepEqual(answered, await refusal(() => buildingLedger(unknown)));
  observe('a building id the store does not hold', 'the status, code and message buildingLedger throws for it',
    answered ?? {});
}));

test('a caller who is not the local operator is refused before any statement',
  () => withListing(async (f, double) => {
    await f.capture();
    const mark = double.statements.length;
    const other = { ...f.ctx, principal: { ...f.ctx.principal, subject: 'another-operator' } };

    await assert.rejects(listBuildingSnapshots(other, { buildingId }), errorCode('USP_LOCAL_ONLY'));
    assert.equal(double.statements.length, mark);
    observe('another subject asks', '403 USP_LOCAL_ONLY, no statement', { code: 'USP_LOCAL_ONLY', statements: 0 });
  }));

test('a stored body that is not the manifest of its own row is counted, not listed',
  () => withListing(async (f, double) => {
    const older = await f.capture();
    await f.capture();
    double.snapshots[1].body.schemaVersion = 'usp/0';
    const one = await list(f);
    double.snapshots[0].digest = 'f'.repeat(64);
    const none = await list(f);

    assert.deepEqual(one.items.map(item => item.scope.manifestId), [older.id]);
    assert.deepEqual([one.unreadable, one.truncated], [1, false]);
    assert.deepEqual([none.items.length, none.unreadable], [0, 2]);
    observe('a body that fails the manifest schema, then a row whose digest column differs from its body',
      'left out of items and counted in unreadable', { firstUnreadable: one.unreadable,
      thenUnreadable: none.unreadable, items: none.items.length });
  }));

test('a listed scope is accepted unchanged by the identity resolve read and the card list',
  () => withListing(async f => {
    const { command } = await prepare(f);
    const receipt = await assignProjectCode(f.ctx, command);
    assert('outcome' in receipt);
    const code = (receipt.outcome as any).codes[f.recorded.spaceId];
    const [{ scope }] = (await list(f)).items;

    assert.deepEqual(scope, receipt.snapshot);
    assert.equal((await resolveProjectIdentity(f.ctx, { scope, identifier: code })).projectCode, code);
    const target = { namespace: 'registry_record', id: f.recorded.spaceId };
    assert.deepEqual(await listPropertyCards(f.ctx, { scope, target }), { items: [], truncated: false });
    observe('the newest listed scope after a code was assigned, passed on as returned',
      'the identity resolve read answers the code; the card list answers an empty page (no card in the double)',
      { resolve: 200, cardList: 200, cardItems: 0 });
  }));
