import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { TABULAR_LIMITS, type TabularSelection } from '@ulpin/contracts/usp';
import { UspTextPacketPlanInputSchema } from '../../../../../contracts/src/usp/packets';
import { sha256 } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { tableRowCitation, tableRowExcerpt } from '../../registry/registry-table-evidence';
import { rowCells } from '../ingestion/intake-evidence';
import { readTabularSource } from '../ingestion/tabular-source';
import { generatePropertyCard, readPropertyCard } from './card-service';
import { verifyPropertyCard } from './card-verification';
import { uuid, withFeaturePlan, type FeaturePlanStore } from './feature-plan.test-fixture';
import { evidenceCardValue } from './plan-citation-authority';
import { confirmPacketPlan, createPacketPlan, executePacketPlan } from './plan-service';

// Real public NYC inputs (test_only, foreign geography): DOITT building footprints and the LPC landmark register
// for the same blocks, which share the building identification number (BIN) as written.
const buildingsPath = 'E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson';
const registerPath = 'E:/BhuAayam-data/datasets/nyc-10013-linked/nyc-landmarks-preservation-commission/gpmc-yuvp.csv';
const skip = [buildingsPath, registerPath].some(path => !existsSync(path)) && 'the data drive inputs are not present';
const csv: TabularSelection = { format: 'csv', sheet: 'csv', table: null, headerRows: [1] };
// The card body of NYC feature 0 without evidence, as the code before AU4-B3 generates it (fields that hold a fresh
// id or time left out); recorded by running the first test against card-projection.ts and plan-authority.ts at
// 3a1bdfe2.
const BASE_CARD = '2ca3844c8a07db5540ee4f7c85270ccb9c714dc6994b1537bf360fd785e21b78';

type Entry = { pointer: unknown; required: true; inclusionReason: string; review: { kind: 'direct'; reviewed: true } };
async function cardOf(store: FeaturePlanStore, extra: Entry[] = [], keys = 'au4b3') {
  const base = store.input(), input = UspTextPacketPlanInputSchema.parse({ ...base,
    entries: [...base.entries, ...extra] });
  const plan = await createPacketPlan(store.ctx, { input, guard: { mode: 'create', requestKey: `${keys}-create` } },
    store.io);
  const confirmation = await confirmPacketPlan(store.ctx, { planId: plan.planId, version: plan.version,
    planSha256: plan.planSha256, reviewed: true, guard: { mode: 'update', requestKey: `${keys}-confirm`,
      expectedVersion: plan.version, expectedManifestId: plan.input.scope.manifestId } }, store.io);
  await executePacketPlan(store.ctx, { planId: plan.planId, version: plan.version,
    confirmationId: confirmation.confirmationId, guard: { mode: 'create', requestKey: `${keys}-execute` } }, store.io);
  return generatePropertyCard(store.ctx, { planId: plan.planId, planVersion: plan.version, cardId: null,
    expiresAt: new Date(Date.now() + 3600000).toISOString(), guard: { mode: 'create', requestKey: `${keys}-card` } },
  store.cards.io);
}

/** The card body without the fields that hold a fresh id or time. */
function stable(card: Awaited<ReturnType<typeof cardOf>>) {
  const { cardId, planId, planSha256, confirmationId, packetId, packetSha256, resolverUrl, createdAt, expiresAt,
    artifact, cardSha256, ...rest } = card;
  return rest;
}

test('a building with no confirmed evidence is carded exactly as before', { skip },
  async () => withFeaturePlan(0, async store => {
    const card = await cardOf(store);
    assert(!card.facts.some(fact => fact.key.startsWith('evidence_citation')));
    assert.equal(fingerprint(stable(card)), BASE_CARD);
  }));

/** The first footprint whose BIN is on exactly one register row, and that row. */
function registerRowOfFeature(bytes: Buffer, bin?: string) {
  const table = readTabularSource(bytes, csv), column = table.headers.indexOf('bin');
  const bins = table.rows.map(row => row[column]);
  const features = JSON.parse(readFileSync(buildingsPath, 'utf8')).features as { properties: { bin?: unknown } }[];
  const feature = features.findIndex(item => (bin === undefined || item.properties.bin === bin)
    && bins.filter(bin => bin === item.properties.bin).length === 1);
  return { table, column, feature, row: bins.indexOf(features[feature].properties.bin) };
}

/** The register retained as a source of the building's case, and the record citing one row of it. */
function citeRegisterRow(store: FeaturePlanStore, bytes: Buffer, found: ReturnType<typeof registerRowOfFeature>,
  retained = false) {
  const { table, column, row } = found, literal = String(table.rows[row][column]);
  const register = { ...store.source, id: uuid(21), name: 'gpmc-yuvp.csv', sha256: sha256(bytes),
    bytes: bytes.length, object_key: 'memory-register-original', profile: 'csv-reference-v2' };
  if (retained) Object.assign(register, { profile: 'large-original-v1', status: 'needs_input',
    object_key: `large-originals/${register.id}/${register.sha256}`,
    inspection: { status: 'needs_input', referenceParts: [],
      largeOriginal: { uploadId: uuid(27), operatorSubject: store.ctx.principal.subject, objectEtag: register.sha256,
        verifiedSha256: register.sha256, verifiedBytes: bytes.length, conversion: 'unsupported',
        bundleCompleteness: 'single_original_only_archive_dependencies_not_assessed',
        provenance: { origin: 'not_stated', acquiredAt: '2026-10-21T00:00:00.000Z', state: 'not_stated' } } } });
  const evidence = { kind: 'table_row' as const, itemId: uuid(22), caseId: store.source.case_id, sourceId: register.id,
    sourceRevision: 1, sourceSha256: register.sha256, rawJobId: uuid(23), rawInputSha256: fingerprint('test_only:in'),
    rawResultSha256: fingerprint(table), acceptedFence: 1, selection: csv, sourceRow: table.sourceRows[row],
    rowSha256: fingerprint(rowCells(table, row)), columnIndex: column, columnHeader: 'bin',
    cell: { state: 'literal' as const, value: literal } };
  const citation = tableRowCitation({ row: evidence, key: { profileId: uuid(24), profileSha256: fingerprint('profile'),
    namespace: 'NYC building identification number', kind: 'integer', literal },
  confirmation: { confirmationId: uuid(25), candidateId: uuid(26), candidateSha256: fingerprint('candidate') } },
  { excerpt: tableRowExcerpt(table, row, column), accessSha256: fingerprint('test_only:access') },
  { recordId: store.record.id, revision: 1, bodySha256: fingerprint(store.record.body) }, 'test_only:officer');
  store.record.body.documentCitations = [citation];
  const access = installRegisterSource(store, register, bytes, retained);
  const locator = `CSV logical row ${evidence.sourceRow}`;
  const entry: Entry = { pointer: { ...store.pointer, sourceRevision: { ref: { namespace: 'source_revision',
    id: register.id }, revision: 1 }, locator: { kind: 'verbatim', locator }, legacyLocator: locator },
  required: true, inclusionReason: 'Confirmed by the officer by an exact key',
  review: { kind: 'direct', reviewed: true } };
  return { citation, entry, locator, register, access };
}

/** Snapshot and live source rows are separate; access can be withdrawn without rewriting the capture. */
function installRegisterSource(store: FeaturePlanStore, register: Record<string, any>, bytes: Buffer,
  retained: boolean) {
  const fixture = store as unknown as { bodies(): unknown[]; rows(sql: string, values: unknown[]): unknown[] | null };
  const bodies = fixture.bodies.bind(store), rows = fixture.rows.bind(store), read = store.io.read;
  const access = { confirmed: true, archived: false, siteId: store.scope.scopeId };
  const captured = structuredClone(register);
  fixture.bodies = () => [...bodies(), { pin: { ref: { namespace: 'source_revision', id: register.id }, revision: 1 },
    body: captured, authority: 'source' }];
  fixture.rows = (sql, values) => {
    if (retained && sql.startsWith('SELECT 1 FROM usp_intake_evidence_confirmations')) {
      return access.confirmed ? [{}] : [];
    }
    if (retained && sql.startsWith('SELECT 1 FROM import_packages')) return [];
    if (retained && sql.startsWith('SELECT s.*,c.site_id') && values[0] === register.id) {
      return [{ ...register, source_site_id: access.siteId, source_archived: access.archived }];
    }
    return sql.startsWith('SELECT * FROM sources') && values[0] === register.id ? [register] : rows(sql, values);
  };
  store.io.read = async key => key === register.object_key ? bytes : read(key);
  return access;
}

test('a confirmed register row is quoted on the card exactly, with its file, row and the officer line', { skip },
  async () => {
    const bytes = readFileSync(registerPath), found = registerRowOfFeature(bytes);
    await withFeaturePlan(found.feature, async store => {
      const { citation, entry, locator } = citeRegisterRow(store, bytes, found);
      const card = await cardOf(store, [entry]);
      const keys = card.facts.map(fact => fact.key);
      assert.equal(keys.indexOf('evidence_citation_1'), keys.indexOf('source_citation') + 1);
      assert.deepEqual(card.facts.find(fact => fact.key === 'evidence_citation_1'), { key: 'evidence_citation_1',
        label: 'Confirmed evidence', state: 'available', reasonCode: null,
        value: evidenceCardValue(citation.excerpt!, 'gpmc-yuvp.csv', locator) });
      assert(citation.excerpt!.includes(`bin: ${citation.key.literal}`));
    });
  });

test('a batch-kept CSV quotes row 702 on a card through the bounded original reader, then reads and verifies',
  { skip }, async () => {
    const bytes = readFileSync(registerPath), found = registerRowOfFeature(bytes, '1001960');
    await withFeaturePlan(found.feature, async store => {
      const { citation, entry, locator, register, access } = citeRegisterRow(store, bytes, found, true);
      assert.equal(citation.row.sourceRow, 702);
      const read = store.io.read, reads: unknown[][] = [];
      store.io.read = async key => {
        assert(!key.startsWith('large-originals/'), 'a retained CSV must never reach readObject');
        return read(key);
      };
      store.io.original = async (...args) => {
        reads.push(args);
        assert.deepEqual(args.slice(0, 4), [register.object_key, bytes.length, register.sha256, TABULAR_LIMITS.bytes]);
        return bytes;
      };
      const card = await cardOf(store, [entry], 'rc1');
      assert(reads.length > 0, 'the plan reads its register through readRetainedOriginal');
      assert.equal(card.facts.find(fact => fact.key === 'evidence_citation_1')?.value,
        evidenceCardValue(citation.excerpt!, 'gpmc-yuvp.csv', locator));
      await readPropertyCard(store.ctx, { cardId: card.cardId, revision: 1 }, store.cards.io);
      const verified = await verifyPropertyCard(store.ctx, { cardId: card.cardId, revision: 1 }, store.cards.io);
      assert.equal(verified.report.result, 'consistent');
      await assertRetainedCardRefusals(store, card.cardId, register, access);
    });
  });

async function assertRetainedCardRefusals(store: FeaturePlanStore, cardId: string, register: Record<string, any>,
  access: ReturnType<typeof installRegisterSource>) {
  const readCard = () => readPropertyCard(store.ctx, { cardId, revision: 1 }, store.cards.io);
  access.confirmed = false;
  await assert.rejects(readCard, { code: 'REGISTRY_SOURCE_UNAVAILABLE' });
  access.confirmed = true;
  access.archived = true;
  await assert.rejects(readCard, { code: 'REGISTRY_SOURCE_DENIED' });
  access.archived = false;
  register.inspection.largeOriginal.operatorSubject = 'another-operator';
  await assert.rejects(readCard, { code: 'REGISTRY_SOURCE_DENIED' });
  register.inspection.largeOriginal.operatorSubject = store.ctx.principal.subject;
  register.inspection.largeOriginal.verifiedSha256 = '0'.repeat(64);
  await assert.rejects(readCard, { code: 'INTAKE_SOURCE_INTEGRITY' });
}

test('a stored excerpt that is not the row read again refuses the plan', { skip }, async () => {
  const bytes = readFileSync(registerPath), found = registerRowOfFeature(bytes);
  await withFeaturePlan(found.feature, async store => {
    const { citation, entry } = citeRegisterRow(store, bytes, found);
    // test_only: the stored excerpt with its key line repeated.
    citation.excerpt = `${citation.excerpt}\nbin: ${citation.key.literal}`;
    await assert.rejects(cardOf(store, [entry]), /excerpt changed/);
  });
});

test('a late confirmation gives the building a new card that quotes the row; its first card stays as stored',
  { skip }, async () => {
    const bytes = readFileSync(registerPath), found = registerRowOfFeature(bytes);
    await withFeaturePlan(found.feature, async store => {
      const first = await cardOf(store);
      const objects = () => [...store.cards.objects].map(([key, value]) => [key, sha256(value)]);
      const kept = structuredClone(store.cards.cards), keptObjects = objects();
      const { citation, entry, locator } = citeRegisterRow(store, bytes, found);
      // test_only: the fixture answers one plan's confirmation, execution and packet; the late plan makes its own.
      Object.assign(store, { confirmations: [], executions: [], packets: [] });
      const late = await cardOf(store, [entry], 'au4b3-late');
      assert.notEqual(late.cardId, first.cardId);
      assert.deepEqual(late.facts.find(fact => fact.key === 'evidence_citation_1')?.value,
        evidenceCardValue(citation.excerpt!, 'gpmc-yuvp.csv', locator));
      assert(!first.facts.some(fact => fact.key.startsWith('evidence_citation')));
      assert.deepEqual(store.cards.cards.slice(0, kept.length), kept, 'the first card row is not edited');
      assert.deepEqual(objects().slice(0, keptObjects.length), keptObjects, 'nor its stored bytes');
      assert.equal(store.cards.cards.length, kept.length + 1);
    });
  });
