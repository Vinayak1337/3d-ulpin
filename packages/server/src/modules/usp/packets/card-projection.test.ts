import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import type { TabularSelection } from '@ulpin/contracts/usp';
import { UspTextPacketPlanInputSchema } from '../../../../../contracts/src/usp/packets';
import { sha256 } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { tableRowCitation } from '../../registry/registry-table-evidence';
import { rowCells } from '../ingestion/intake-evidence';
import { readTabularSource } from '../ingestion/tabular-source';
import { generatePropertyCard } from './card-service';
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
async function cardOf(store: FeaturePlanStore, extra: Entry[] = []) {
  const base = store.input(), input = UspTextPacketPlanInputSchema.parse({ ...base,
    entries: [...base.entries, ...extra] });
  const plan = await createPacketPlan(store.ctx, { input, guard: { mode: 'create', requestKey: 'au4b3-create' } },
    store.io);
  const confirmation = await confirmPacketPlan(store.ctx, { planId: plan.planId, version: plan.version,
    planSha256: plan.planSha256, reviewed: true, guard: { mode: 'update', requestKey: 'au4b3-confirm',
      expectedVersion: plan.version, expectedManifestId: plan.input.scope.manifestId } }, store.io);
  await executePacketPlan(store.ctx, { planId: plan.planId, version: plan.version,
    confirmationId: confirmation.confirmationId, guard: { mode: 'create', requestKey: 'au4b3-execute' } }, store.io);
  return generatePropertyCard(store.ctx, { planId: plan.planId, planVersion: plan.version, cardId: null,
    expiresAt: new Date(Date.now() + 3600000).toISOString(), guard: { mode: 'create', requestKey: 'au4b3-card' } },
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
function registerRowOfFeature(bytes: Buffer) {
  const table = readTabularSource(bytes, csv), column = table.headers.indexOf('bin');
  const bins = table.rows.map(row => row[column]);
  const features = JSON.parse(readFileSync(buildingsPath, 'utf8')).features as { properties: { bin?: unknown } }[];
  const feature = features.findIndex(item => bins.filter(bin => bin === item.properties.bin).length === 1);
  return { table, column, feature, row: bins.indexOf(features[feature].properties.bin) };
}

/** The register retained as a source of the building's case, and the record citing one row of it. */
function citeRegisterRow(store: FeaturePlanStore, bytes: Buffer, found: ReturnType<typeof registerRowOfFeature>) {
  const { table, column, row } = found, literal = String(table.rows[row][column]);
  const register = { ...store.source, id: uuid(21), name: 'gpmc-yuvp.csv', sha256: sha256(bytes),
    bytes: bytes.length, object_key: 'memory-register-original', profile: 'csv-reference-v2' };
  const evidence = { kind: 'table_row' as const, itemId: uuid(22), caseId: store.source.case_id, sourceId: register.id,
    sourceRevision: 1, sourceSha256: register.sha256, rawJobId: uuid(23), rawInputSha256: fingerprint('test_only:in'),
    rawResultSha256: fingerprint(table), acceptedFence: 1, selection: csv, sourceRow: table.sourceRows[row],
    rowSha256: fingerprint(rowCells(table, row)), columnIndex: column, columnHeader: 'bin',
    cell: { state: 'literal' as const, value: literal } };
  const citation = tableRowCitation({ row: evidence, key: { profileId: uuid(24), profileSha256: fingerprint('profile'),
    namespace: 'NYC building identification number', kind: 'integer', literal },
  confirmation: { confirmationId: uuid(25), candidateId: uuid(26), candidateSha256: fingerprint('candidate') } },
  { table, accessSha256: fingerprint('test_only:access') },
  { recordId: store.record.id, revision: 1, bodySha256: fingerprint(store.record.body) }, 'test_only:officer');
  store.record.body.documentCitations = [citation];
  const fixture = store as unknown as { bodies(): unknown[]; rows(sql: string, values: unknown[]): unknown[] | null };
  const bodies = fixture.bodies.bind(store), rows = fixture.rows.bind(store), read = store.io.read;
  fixture.bodies = () => [...bodies(), { pin: { ref: { namespace: 'source_revision', id: register.id }, revision: 1 },
    body: register, authority: 'source' }];
  fixture.rows = (sql, values) => sql.startsWith('SELECT * FROM sources') && values[0] === register.id ? [register]
    : rows(sql, values);
  store.io.read = async key => key === register.object_key ? bytes : read(key);
  const locator = `CSV logical row ${evidence.sourceRow}`;
  const entry: Entry = { pointer: { ...store.pointer, sourceRevision: { ref: { namespace: 'source_revision',
    id: register.id }, revision: 1 }, locator: { kind: 'verbatim', locator }, legacyLocator: locator },
  required: true, inclusionReason: 'Confirmed by the officer by an exact key',
  review: { kind: 'direct', reviewed: true } };
  return { citation, entry, locator };
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

test('a stored excerpt that is not the row read again refuses the plan', { skip }, async () => {
  const bytes = readFileSync(registerPath), found = registerRowOfFeature(bytes);
  await withFeaturePlan(found.feature, async store => {
    const { citation, entry } = citeRegisterRow(store, bytes, found);
    // test_only: the stored excerpt with its key line repeated.
    citation.excerpt = `${citation.excerpt}\nbin: ${citation.key.literal}`;
    await assert.rejects(cardOf(store, [entry]), /excerpt changed/);
  });
});
