import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import { zipSync } from 'fflate';
import { ArchiveMemberLineageSchema, type IntakeCard } from '../packages/contracts/src/usp/intake';
import { probeOriginal } from '../packages/server/src/modules/usp/ingestion/intake-probe';
import { readZipMember } from '../packages/server/src/modules/usp/ingestion/intake-zip';
import { fanOutZipLayers, ZIP_ARCHIVE_PROFILE } from '../packages/server/src/modules/usp/ingestion/intake-zip-layers';
import { AppError } from '../packages/server/src/infrastructure/errors';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
// Real public layers kept in the repository (OSM / Google Open Buildings, test_only); zipped here, never committed.
const real = {
  'uttam/01-google-building-footprints.geojson': readFileSync('fixtures/google-uttam/01-google-building-footprints.geojson'),
  'uttam/02-osm-road-centrelines.geojson': readFileSync('fixtures/google-uttam/02-osm-road-centrelines.geojson'),
  'uttam/block-boundary.geojson': readFileSync('fixtures/google-uttam/block-boundary.geojson'),
  'uttam/README.md': readFileSync('fixtures/google-uttam/README.md'),
};
const reader = (bytes: Uint8Array) => async (start: number, end: number) => bytes.subarray(start, end);

test('a GeoJSON member is read back whole, deflated or stored, and checked against its directory entry', async () => {
  for (const level of [0, 6] as const) {
    const pack = zipSync(Object.fromEntries(Object.entries(real).map(([name, bytes]) => [name, [bytes, { level }]])));
    for (const [ordinal, name] of Object.keys(real).entries()) {
      const member = await readZipMember(reader(pack), pack.length, name, 16 * 1024 * 1024);
      assert.equal(sha(member.bytes), sha(real[name as keyof typeof real]));
      assert.equal(member.ordinal, ordinal);
    }
  }
});

test('a member that is missing, too large or damaged is refused by code', async () => {
  const pack = zipSync({ 'a.geojson': real['uttam/block-boundary.geojson'] });
  const size = real['uttam/block-boundary.geojson'].length;
  const refused = (path: string, max: number, bytes = pack) =>
    readZipMember(reader(bytes), bytes.length, path, max).then(() => 'read', (error: Error) => error.message);
  assert.equal(await refused('b.geojson', size), 'ZIP_MEMBER_NOT_FOUND');
  assert.equal(await refused('a.geojson', size - 1), 'ZIP_LAYER_SIZE');
  const damaged = Buffer.from(pack);
  damaged[60] ^= 0xff; // inside the first member's compressed bytes, past its 30 + 9 byte local header
  assert.match(await refused('a.geojson', size, damaged), /^ZIP_MEMBER_INTEGRITY$/);
});

// In-memory ledger for the fan-out's own statements; no database, object store, processor or runtime is opened.
class Ledger {
  readonly caseId = randomUUID();
  readonly archiveId = randomUUID();
  readonly itemId = randomUUID();
  revision = 7;
  readonly rows = new Map<string, any>();
  readonly events: unknown[] = [];
  archive: any;

  constructor(readonly bytes: Uint8Array, readonly card: IntakeCard) {
    this.archive = { id: this.archiveId, case_id: this.caseId, family_id: this.archiveId, revision: 1,
      name: 'layers.zip', profile: ZIP_ARCHIVE_PROFILE, bytes: bytes.length, sha256: sha(bytes),
      object_key: `sources/${this.archiveId}/${sha(bytes)}`, status: 'needs_input',
      inspection: { actor: 'zip-layer-control' } };
    this.rows.set(this.itemId, { item_id: this.itemId, case_id: this.caseId, source_id: this.archiveId,
      parent_item_id: null, member_path: null, card });
    // The rows registration writes for each member (intake-service childrenTx).
    for (const member of card.members) {
      const id = randomUUID();
      this.rows.set(id, { item_id: id, case_id: this.caseId, source_id: null, parent_item_id: this.itemId,
        member_path: member.name, size_bytes: String(member.sizeBytes), limit_reason: member.refusalCode,
        card: member.card ? { ...member.card, members: [] } : null, state: 'probed', family: member.family,
        format: member.format, size_class: 'S', wave: 4, pinned_by_officer: false });
    }
  }

  member(path: string) { return [...this.rows.values()].find(row => row.member_path === path); }

  async query(sql: string, values: any[] = []): Promise<{ rows: any[]; rowCount?: number }> {
    if (sql.startsWith('SELECT id,revision,archived FROM cases')) {
      return { rows: [{ id: this.caseId, revision: this.revision, archived: false }] };
    }
    if (sql.startsWith('SELECT revision FROM cases')) return { rows: [{ revision: this.revision }] };
    if (sql.startsWith('SELECT * FROM sources')) return { rows: values[1] === this.archiveId ? [this.archive] : [] };
    if (sql.startsWith('SELECT * FROM usp_intake_items')) {
      const row = this.rows.get(values[1]);
      return { rows: row && !row.parent_item_id ? [row] : [] };
    }
    if (sql.startsWith('SELECT item_id,member_path')) {
      return { rows: [...this.rows.values()].filter(row => row.parent_item_id === values[1]) };
    }
    if (sql.startsWith('SELECT item_id AS')) {
      const row = this.rows.get(values[1]);
      return { rows: [{ itemId: row.item_id, state: row.state, family: row.family, format: row.format,
        sizeClass: row.size_class, wave: row.wave, pinnedByOfficer: row.pinned_by_officer }] };
    }
    if (sql.startsWith('UPDATE usp_intake_items SET source_id')) {
      const row = this.rows.get(values[1]);
      if (row.source_id) return { rows: [], rowCount: 0 };
      Object.assign(row, { source_id: values[2], limit_reason: null });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE usp_intake_items SET limit_reason')) {
      const row = this.rows.get(values[1]);
      if ((sql.includes('source_id IS NULL') && row.source_id) || row.limit_reason === values[2]) {
        return { rows: [], rowCount: 0 };
      }
      row.limit_reason = values[2];
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE usp_outbox_streams')) return { rows: [{ sequence: String(this.events.length + 1) }] };
    if (sql.startsWith('INSERT INTO usp_outbox(')) { this.events.push(values[2]); return { rows: [] }; }
    if (sql.includes('usp_outbox')) return { rows: [] };
    throw new Error(`Unexpected ledger SQL: ${sql}`);
  }
}

async function fanOut(pack: Uint8Array, options: { failRetain?: (name: string) => AppError | null } = {}) {
  const card = await probeOriginal(reader(pack), pack.length, 'layers.zip');
  const ledger = new Ledger(pack, card);
  const client = { query: ledger.query.bind(ledger) } as unknown as PoolClient;
  const order: string[] = [];
  const retained: { name: string; bytes: Uint8Array; lineage: unknown; input: any }[] = [];
  const dependencies = {
    transaction: (async (action: (client: PoolClient) => Promise<unknown>) => action(client)) as never,
    read: async (_key: string, start: number, end: number) => pack.subarray(start, end),
    retain: async (_caseId: string, input: any, file: { name: string; bytes: Uint8Array }, lineage: unknown) => {
      const refusal = options.failRetain?.(file.name);
      if (refusal) throw refusal;
      order.push(`retain:${file.name}`);
      retained.push({ ...file, lineage, input });
      ledger.revision++;
      return { source: { sourceId: randomUUID() } } as never;
    },
    register: async (_caseId: string, input: any) => { order.push(`register:${input.sourceId}`); return {}; },
  };
  const run = () => fanOutZipLayers(ledger.caseId, ledger.itemId, dependencies);
  return { ledger, card, order, retained, run };
}

async function configured(action: () => Promise<void>) {
  const previous = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'zip-layer-control';
  try { await action(); }
  finally {
    if (previous === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previous;
  }
}

test('each GeoJSON layer of a real ZIP becomes its own child original and item; the README does not', () =>
  configured(async () => {
    const pack = zipSync(real);
    const { ledger, order, retained, run } = await fanOut(pack);
    const kept = await run();
    assert.equal(kept.length, 3);
    assert.deepEqual(retained.map(file => file.name),
      ['01-google-building-footprints.geojson', '02-osm-road-centrelines.geojson', 'block-boundary.geojson']);
    for (const [ordinal, file] of retained.entries()) {
      const path = `uttam/${file.name}`;
      assert.equal(sha(file.bytes), sha(real[path as keyof typeof real]));
      const lineage = ArchiveMemberLineageSchema.parse(file.lineage);
      assert.deepEqual({ ...lineage, crc32: 0 }, { version: 'zip-layer/1', parentSourceId: ledger.archiveId,
        parentSourceRevision: 1, parentSha256: sha(pack), parentItemId: ledger.itemId, memberPath: path, ordinal,
        memberBytes: file.bytes.length, compressedBytes: lineage.compressedBytes, crc32: 0,
        memberSha256: sha(file.bytes) });
      assert.equal(file.input.format, 'geojson');
      assert.equal(ledger.member(path).source_id, kept[ordinal]);
    }
    assert.equal(ledger.member('uttam/README.md').source_id, null);
    // Every layer is kept before any is enrolled, so no layer's draft associates the case first.
    assert.deepEqual(order.map(step => step.split(':')[0]), ['retain', 'retain', 'retain',
      'register', 'register', 'register']);
    // Enrolling the archive again keeps nothing twice and enrols the same originals again (idempotent upstream).
    order.length = 0;
    assert.deepEqual(await run(), kept);
    assert.deepEqual(order, kept.map(id => `register:${id}`));
  }));

test('a layer the GeoJSON receipt refuses stays in the archive with a code; its siblings are kept', () =>
  configured(async () => {
    const { ledger, run } = await fanOut(zipSync(real), { failRetain: name => name.startsWith('02-')
      ? new AppError(422, 'GEOJSON_INVALID', 'parser text that must not be stored') : null });
    assert.equal((await run()).length, 2);
    const refused = ledger.member('uttam/02-osm-road-centrelines.geojson');
    assert.equal(refused.source_id, null);
    assert.match(refused.limit_reason, /^GEOJSON_INVALID: this GeoJSON member stays inside the archive/);
    assert.doesNotMatch(refused.limit_reason, /parser text/);
  }));

test('a real mixed ZIP with ArcGIS JSON, PDFs and models keeps no layer', () => configured(async () => {
  const pack = readFileSync('fixtures/lake-view-complete-inputs.zip');
  const { card, retained, run } = await fanOut(pack);
  assert.ok(card.members.length > 30);
  assert.deepEqual(await run(), []);
  assert.equal(retained.length, 0);
}));
