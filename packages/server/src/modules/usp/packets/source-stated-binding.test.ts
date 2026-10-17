import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { SourceSpaceRequestSchema, type RegistryRegionCitation } from '@ulpin/contracts';
import { PacketRegionProvenanceSchema } from '../../../../../contracts/src/packet-region';
import { PACKET_PDF_RECIPE, UspPdfPacketPlanInputSchema } from '../../../../../contracts/src/usp/packet-pdf';
import { PROPERTY_CARD_UNICODE_PROFILE } from '../../../../../contracts/src/usp/property-card';
import { transaction } from '../../../infrastructure/db';
import { towerRequest } from '../../officer/source-spaces.test-fixture';
import { assignProjectCode } from '../project-identity';
import { control, errorCode, prepare, type SourceFixture } from '../source-stated-identity.test-fixture';
import { projectCardFactsTx } from './card-projection';
import { propertyCardResolverUrl } from './card-render';
import { renderPropertyCardProfile, selectPropertyCardProfile } from './card-render-profile';
import { printedFact } from './card-wording';
import { packetRegionTransform } from './region-extract';
import { createPdfPacketPlan, readPdfPacketPlan, type PdfPacketIo } from './pdf-service';
import { sourceStatementBindingsTx, sourceStatementHandle } from './source-stated-binding';

// Technical region over the real retained Tower 3 sheet: the retained crop of exactly this region supplies the
// renderer bytes and proof, so no native execution or original I/O is needed.
const cropRoot = 'E:/BhuAayam-data/task-data/desktop-packet-region-extract-20261002/real-crop-02';
const worker = JSON.parse(readFileSync(`${cropRoot}/result.json`, 'utf8'));
const png = readFileSync(`${cropRoot}/region.png`);
const request = SourceSpaceRequestSchema.parse({ ...towerRequest, requestKey: randomUUID(), space: {
  label: 'UNIT-3B', evidence: { ...towerRequest.space.evidence, region: [2265, 1545, 2530, 1680] } } });

type Plan = Awaited<ReturnType<typeof createPdfPacketPlan>>;
type Projection = Awaited<ReturnType<typeof projectCardFactsTx>>;

/**
 * The projected rows drawn as a one-page card by each renderer, written only when K10_CARD_DIR is set, so the
 * layout can be looked at. It is not a stored card: the plan of this fixture is not executed, so the confirmation
 * id, the packet id and the packet hash are zero placeholders.
 */
async function writeDrawnCards(directory: string, plan: Plan, projection: Projection) {
  const none = '00000000-0000-4000-8000-000000000000', cardId = '00000000-0000-4000-8000-000000000010';
  const card = { cardId, revision: 1, previousRevision: null,
    profile: selectPropertyCardProfile(projection.facts), mode: 'local_operator' as const, planId: plan.planId,
    planVersion: plan.version, planSha256: plan.planSha256, confirmationId: none, packetId: none,
    packetSha256: '0'.repeat(64), target: plan.input.target, scope: plan.input.scope,
    targetBodySha256: plan.targetBodySha256, ...projection, creator: plan.creator,
    accessViewId: plan.accessViewId, policyVersion: plan.policyVersion,
    evidenceEntrySha256: plan.entries.filter(entry => entry.state === 'included').map(entry => entry.entrySha256),
    omissions: [], resolverUrl: propertyCardResolverUrl(cardId, 1), createdAt: plan.createdAt,
    expiresAt: plan.input.expiresAt };
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'card.pdf'), await renderPropertyCardProfile(card));
  await writeFile(join(directory, 'card-unicode.pdf'),
    await renderPropertyCardProfile({ ...card, profile: PROPERTY_CARD_UNICODE_PROFILE }));
}

function io(f: SourceFixture, pageWidth = 2586): PdfPacketIo {
  const extract = async (sourceId: string, _page: number, raw: any) => ({ bytes: png,
    provenance: PacketRegionProvenanceSchema.parse({ ...worker, version: 'packet-region/1', selection: raw.selection,
      transform: packetRegionTransform(raw.selection), purpose: raw.purpose, sourceId, sourceRevision: 1,
      caseRevision: 1,
      caseId: f.memory.sources.find(source => source.id === sourceId)!.case_id }) });
  const pages = async (sourceId: string, raw: any) => {
    const result = await f.db.deps.pages(sourceId, raw);
    result.pages.forEach((page: any) => { page.frame.width = pageWidth; page.mediaBox[2] = pageWidth;
      page.cropBox[2] = pageWidth; });
    return result;
  };
  return { extract, pages } as unknown as PdfPacketIo;
}

async function assigned(f: SourceFixture) {
  const { command } = await prepare(f);
  const receipt = await assignProjectCode(f.ctx, command);
  const target = { ref: { namespace: 'registry_record' as const, id: f.recorded.spaceId },
    revision: receipt.after[0].revision };
  const input = (revision = target.revision) => UspPdfPacketPlanInputSchema.parse({ scope: receipt.snapshot,
    purpose: 'record_evidence', format: 'pdf', recipe: PACKET_PDF_RECIPE, target: { ...target, revision },
    expiresAt: new Date(Date.now() + 3600000).toISOString(), entries: [{ bindingId: sourceStatementHandle(target),
      required: true, inclusionReason: 'Officer-recorded citation of the unit label' }] });
  const create = (raw: ReturnType<typeof input>, pageWidth?: number) => createPdfPacketPlan(f.ctx,
    { input: raw, guard: { mode: 'create', requestKey: randomUUID() } }, io(f, pageWidth));
  return { receipt, target, input, create };
}

test('a card plan for the source-only space binds its recorded citation and shows only recorded literals',
  async () => control(async f => {
    const { receipt, input, create } = await assigned(f);
    const plan = await create(input());
    const [entry] = plan.entries;
    const binding = entry.binding as RegistryRegionCitation;
    assert.equal(entry.state, 'included');
    assert.equal(plan.requiredContext, 'available');
    assert.equal(plan.targetLabel, 'UNIT-3B');
    assert.equal(binding.page, 1);
    const original = f.memory.sources.find(source => source.id === request.space.evidence.sourceId)!;
    assert.equal(binding.document.sourceSha256, original.sha256);
    assert.equal(binding.target.revision, receipt.after[0].revision);
    const view = await readPdfPacketPlan(f.ctx, { planId: plan.planId, version: 1 });
    assert.equal(view.plan.planSha256, plan.planSha256);
    const projection = await transaction(client => projectCardFactsTx(client, f.ctx, plan));
    if (process.env.K10_CARD_DIR) await writeDrawnCards(process.env.K10_CARD_DIR, plan, projection);
    const byKey = new Map(projection.facts.map(fact => [fact.key, fact]));
    assert.match(byKey.get('source_space_label')!.value!, /^UNIT-3B;/);
    assert.match(byKey.get('source_floor_label')!.value!, /^2ND FLOOR PLAN;/);
    assert.equal(byKey.get('source_building')!.value, 'TOWER 3');
    assert.match(byKey.get('source_citation')!.value!,
      /page 1; region pt \[2265, 1545, 2530, 1680\]; .*sha256 [a-f0-9]{64}/);
    assert.match(byKey.get('project_identity')!.value!, new RegExp(`^${f.memory.codes.get(f.recorded.spaceId).code}`));
    for (const key of ['geometry', 'measurements', 'render', 'parcel_assertions', 'level_ordinal', 'use']) {
      assert.equal(byKey.get(key)!.state, 'unavailable', key);
    }
    assert.equal(byKey.get('rights')!.state, 'not_assessed');
  }, request));

test('the card of a source-stated unit states an unknown location, state and author in words',
  async () => control(async f => {
    const { input, create } = await assigned(f);
    const { facts } = await transaction(async client => projectCardFactsTx(client, f.ctx, await create(input())));
    const value = (key: string) => facts.find(fact => fact.key === key)!.value;
    const printed = facts.map(fact => `${fact.label}  ${printedFact(fact)}`);

    // An anchorless unknown locator is worded field by field and keeps the formal locator.
    // Since K11 a source-stated review sends no location, so no structure or space number is recorded.
    assert.equal(value('vertical_locator'), 'No parcel anchor supplied. Structure number not recorded, '
      + 'kind not recorded; level not recorded; space number not recorded, kind not recorded. '
      + '(Locator: NO-ANCHOR / ? / L? / ?)');
    assert.equal(value('parcel_assertions'),
      'Selected evidence does not support a parent parcel assertion. No parcel anchor supplied.');
    // No row prints a stored word: neither an underscore-joined one nor a state in lower case before its colon.
    assert.deepEqual(printed.filter(row => /[a-z]_[a-z]/i.test(row) || /  [a-z_ ]+: /.test(row)), []);
    assert.equal(printed.filter(row => /  (Unavailable|Not assessed): [A-Z]/.test(row)).length, 8);
    // The record holds the subject that recorded the label and no role, so the row names no officer.
    assert.equal(value('source_space_label'),
      'UNIT-3B; entered by the recording operator from the cited source region; not a boundary');
    assert.deepEqual(printed.filter(row => /officer/i.test(row)), []);
    const [floorSegment] = value('identifier')!.split(':').slice(-2);
    assert.equal(value('level_ordinal'), 'Not recorded; the floor caption is only a literal. '
      + `${floorSegment} in the registry identifier is a record sequence, not a floor number`);
  }, request));

test('source-only planning refuses a revision outside the snapshot and a region outside the page box',
  async () => control(async f => {
    const { input, create } = await assigned(f);
    await assert.rejects(create(input(1)), /Select one exact building, floor or space snapshot/);
    await assert.rejects(create(input(), 2000), errorCode('PACKET_SOURCE_STATEMENT'));
  }, request));

test('source-only binding refuses a changed original hash, a changed retained original and geometry-bearing records',
  async () => control(async f => {
    const { input, create } = await assigned(f);
    const raw = input();
    const plan = await create(raw);
    const row = f.db.rows.find(item => item.id === f.recorded.spaceId);
    const snapshotTarget = { id: row.id, site_id: row.site_id, kind: row.kind, revision: row.revision, body: row.body };
    const bind = (target: typeof snapshotTarget) => transaction(client => sourceStatementBindingsTx(
      client, f.ctx, raw, target, [plan.entries[0].binding as RegistryRegionCitation]));
    const withEvidence = (change: object) => ({ ...snapshotTarget, body: { ...row.body, sourceOnly: {
      ...row.body.sourceOnly, evidence: { ...row.body.sourceOnly.evidence, ...change } } } });
    await assert.rejects(bind(withEvidence({ sourceSha256: 'e'.repeat(64) })), errorCode('PACKET_SOURCE_STATEMENT'));
    await assert.rejects(bind(withEvidence({ region: [2265, 1545, 2530, 1700] })),
      errorCode('PACKET_SOURCE_STATEMENT'));
    await assert.rejects(bind({ ...snapshotTarget, body: { ...row.body, footprint: [[0, 0]] } }),
      errorCode('PACKET_SOURCE_STATEMENT'));
    f.memory.sources.find(source => source.id === request.space.evidence.sourceId)!.sha256 = 'f'.repeat(64);
    await assert.rejects(create(raw), errorCode('DOCUMENT_SOURCE_INTEGRITY'));
  }, request));
