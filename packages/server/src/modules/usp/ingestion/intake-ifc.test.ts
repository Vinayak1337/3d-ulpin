import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { IFC_LIMITS, IFCInputSchema, IFCSummarySchema, IntakeItemSchema, type IntakeCard } from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';
import { sha256 } from '../../../infrastructure/storage';
import { ingestionBinding } from './events';
import { ifcSourceTx } from './ifc';
import { failIFCJob } from './ifc-worker';
import { intakeIfcJobId, intakeIfcReadWords, settleIntakeIfcTx } from './intake-ifc';
import { queueIntakeDraftTx } from './intake-draft';
import { intakeItem } from './intake-ledger';
import { probeOriginal } from './intake-probe';
import real from '../../../../../../docs/evidence/gf1/ifc2/real-structures.json';

// The public IFC2X3 sample IFC1 read (test_only, outside Git); SQL is a protocol double, never a stored record.
const root = process.env.ULPIN_IFC_TEST_ROOT ?? 'E:/BhuAayam-data/task-data/desktop-ifc-native';
const file = `${root}/originals/ifc2x3-building-architecture.ifc`;
const present = existsSync(file);
process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'ifc3-protocol-operator';

/** A batch IFC kept through /uploads and enrolled: its large-original receipt and the card the probe published. */
async function batch(statedBytes?: number) {
  const raw = readFileSync(file), hash = sha256(raw), bytes = statedBytes ?? raw.length;
  const card: IntakeCard = await probeOriginal(async (start, end) => raw.subarray(start, end), raw.length,
    'ifc2x3-building-architecture.ifc');
  const caseId = randomUUID(), sourceId = randomUUID(), binding = ingestionBinding(caseId);
  const source = { id: sourceId, case_id: caseId, family_id: sourceId, revision: 1,
    name: 'ifc2x3-building-architecture.ifc', profile: 'large-original-v1', bytes, sha256: hash,
    object_key: `large-originals/${sourceId}/${hash}`, status: 'needs_input',
    inspection: { profile: 'large-original-v1', largeOriginal: { uploadId: randomUUID(),
      operatorSubject: binding.subject, objectEtag: 'protocol-etag', verifiedSha256: hash, verifiedBytes: bytes,
      provenance: { state: 'not_stated', origin: 'not_stated', acquiredAt: '2026-10-01T00:00:00.000Z' },
      conversion: 'unsupported', bundleCompleteness: 'single_original_only_archive_dependencies_not_assessed' } } };
  const item = { item_id: sourceId, source_id: sourceId, case_id: caseId, parent_item_id: null, member_path: null,
    name: source.name, family: card.family, format: card.format, size_bytes: bytes, size_class: 'S', wave: 2,
    state: 'probed', placement: 'undecided', card, card_sha256: null, probe_version: card.version,
    plan_ref: null as Record<string, unknown> | null, parts_planned: null, parts_done: 0, records_seen: 0,
    limit_reason: null as string | null, pinned_by_officer: false,
    created_at: '2026-10-21T00:00:00.000Z', updated_at: '2026-10-21T00:00:00.000Z' };
  const current = { id: caseId, revision: 3, archived: false, frame: null, context: null, site_id: null };
  const jobs = new Map<string, any>(), meta = new Map<string, any>(), events: any[] = [];
  const query = async (sql: string, args: any[] = []) => {
    let rows: any[] = [];
    if (sql.startsWith('SELECT set_config')) rows = [{ deadline_live: Date.now() < Date.parse(args[1]) }];
    else if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.includes('pg_advisory_xact_lock')) rows = [];
    else if (sql.includes('FROM cases')) rows = args[0] === caseId ? [current] : [];
    else if (sql.includes('max(revision)')) rows = [{ revision: 1 }];
    else if (sql.includes('FROM sources')) rows = [source];
    else if (sql.startsWith('SELECT card FROM usp_intake_items')) rows = [{ card: item.card }];
    else if (sql.includes("plan_ref->>'ifcJobId'=$2"))
      rows = item.plan_ref?.ifcJobId === args[1] ? [{ item_id: item.item_id }] : [];
    else if (sql.startsWith('SELECT item_id,case_id,plan_ref')) rows = [item];
    else if (sql.startsWith('SELECT state,placement,plan_ref')) rows = [item];
    else if (sql.startsWith('UPDATE usp_intake_items SET state=')) Object.assign(item, { state: args[2],
      placement: args[3], plan_ref: args[4], records_seen: args[5], limit_reason: args[6] });
    else if (sql.startsWith('SELECT item_id AS')) rows = [{ itemId: item.item_id, state: item.state,
      family: item.family, format: item.format, sizeClass: item.size_class, wave: item.wave, pinnedByOfficer: false }];
    else if (sql.startsWith('INSERT INTO jobs')) jobs.set(args[0], { id: args[0], case_id: args[1],
      source_id: args[2], operation: 'ifc-native', case_revision: args[3], input_fingerprint: args[4],
      payload: args[5], status: 'queued' });
    else if (sql.includes('FROM jobs')) rows = jobs.has(args[0]) ? [jobs.get(args[0])] : [];
    else if (sql.startsWith('INSERT INTO usp_job_metadata')) meta.set(args[0], { logical_state: 'queued' });
    else if (sql.includes('FROM usp_job_metadata')) rows = meta.has(args[0]) ? [meta.get(args[0])] : [];
    else if (sql.includes('FROM usp_job_attempts') || sql.startsWith('UPDATE usp_job_attempts')) rows = [];
    else if (sql.startsWith('UPDATE usp_job_metadata')) meta.get(args[0]).logical_state = 'failed';
    else if (sql.startsWith('UPDATE jobs')) Object.assign(jobs.get(args[0]), { status: args[1], error: args[2] });
    else if (sql.startsWith('INSERT INTO usp_outbox_streams')) rows = [];
    else if (sql.startsWith('UPDATE usp_outbox_streams')) rows = [{ sequence: String(events.length + 1) }];
    else if (sql.startsWith('INSERT INTO usp_outbox')) events.push(args[2]);
    else throw new Error(`Unexpected protocol query: ${sql}`);
    return { rows: structuredClone(rows), rowCount: rows.length };
  };
  const client = Object.assign(new EventEmitter(), { query, release: () => {} });
  return { raw, hash, card, source, item, jobs, events, client: client as any };
}

/** The retained native run of the same sample (docs/evidence/gf1/ifc2/real-structures.json). */
function realSummary() {
  const house = real.files['ifc2x3-building-architecture.ifc'], facts = house.retainedNativeFacts;
  const nodes = house.structure.nodes as { entityType: string }[];
  const count = (type: string) => nodes.filter(node => node.entityType === type).length;
  return IFCSummarySchema.parse({ schemaVersion: 'ulpin-native-ifc/1', sourceSha256: house.sha256,
    sourceBytes: house.bytes, schema: facts.schema, entityCount: facts.sourceEntities,
    recordCount: facts.projectedRecords, buildingCount: count('IfcBuilding'), storeyCount: count('IfcBuildingStorey'),
    spaceCount: count('IfcSpace'), georeferenceState: facts.georeferenceState, inspectionFrame: 'source_local',
    metadataOnly: true, geometry: 'unsupported', globalPlacement: 'not_qualified', unitConversionApplied: false,
    storeysAreLegalUnits: false, rights: 'not_assessed', structure: house.structure });
}

test('an enrolled batch IFC queues one native IFC job and the item carries it; a replay queues none',
  { skip: !present }, async () => {
    const f = await batch();
    assert.deepEqual([f.card.format, f.card.family], ['ifc', 'model3d']);
    const jobId = await queueIntakeDraftTx(f.client, f.source as any, f.card);
    assert.equal(jobId, intakeIfcJobId(f.item.item_id, f.source as any));
    assert.equal(f.jobs.size, 1);
    const input = IFCInputSchema.parse(f.jobs.get(jobId!).payload);
    assert.deepEqual([input.sourceId, input.sourceSha256, input.sourceBytes, input.objectKey, input.selection],
      [f.source.id, f.hash, f.raw.length, f.source.object_key, 'complete_bounded_source']);
    assert.deepEqual([f.item.state, f.item.placement, f.item.plan_ref, f.item.limit_reason],
      ['reading', 'undecided', { ifcJobId: jobId }, null]);
    assert.equal(intakeItem(f.item).ifcJobId, jobId);
    assert.ok(f.events.some(event => event.change.kind === 'ifc-native.changed' && event.change.jobId === jobId));
    const published = f.events.length;
    assert.equal(await queueIntakeDraftTx(f.client, f.source as any, f.card), jobId);
    assert.deepEqual([f.jobs.size, f.events.length], [1, published]);
  });

test('an IFC above the reader byte limit queues nothing and its item says why', { skip: !present }, async () => {
  // test_only: the receipt states a size above IFC_LIMITS.originalBytes; no file of that size is read or kept.
  const f = await batch(40_000_000);
  assert.equal(await queueIntakeDraftTx(f.client, f.source as any, f.card), null);
  assert.equal(f.jobs.size, 0);
  assert.deepEqual([f.item.state, f.item.placement, f.item.plan_ref], ['probed', 'not_understood', null]);
  assert.match(f.item.limit_reason!, /^This IFC has 38\.1 MiB, above the 32 MiB limit of the IFC reader, /);
  assert.doesNotMatch(f.item.limit_reason!, /\d{5}/);
  assert.equal(intakeItem(f.item).ifcJobId, undefined);
});

test('the IFC authority takes a batch original only when its receipt and probed card say IFC',
  { skip: !present }, async () => {
    const f = await batch();
    assert.equal((await ifcSourceTx(f.client, f.source.case_id, f.source.id)).source.id, f.source.id);
    const denied = (error: unknown) => error instanceof AppError && error.code === 'IFC_DENIED';
    f.item.card = { ...f.card, format: 'unknown' };
    await assert.rejects(ifcSourceTx(f.client, f.source.case_id, f.source.id), denied);
    f.item.card = f.card;
    f.source.inspection.largeOriginal.operatorSubject = 'another-operator';
    await assert.rejects(ifcSourceTx(f.client, f.source.case_id, f.source.id), denied);
  });

test('the ended job writes the item read: words from the result, or the reason it stopped', { skip: !present },
  async () => {
    const f = await batch();
    const jobId = (await queueIntakeDraftTx(f.client, f.source as any, f.card))!;
    await settleIntakeIfcTx(f.client, f.source.case_id, jobId, { summary: realSummary() });
    assert.deepEqual([f.item.state, f.item.placement, f.item.records_seen], ['read', 'undecided', 2046]);
    assert.equal(f.item.limit_reason, 'The file states 1 building, 1 storey and 2 spaces; they are candidates.');
    const g = await batch(), stopped = (await queueIntakeDraftTx(g.client, g.source as any, g.card))!;
    const globals = globalThis as any, pool = globals.ulpinPool;
    globals.ulpinPool = { connect: async () => g.client, query: g.client.query };
    try { await failIFCJob(stopped, g.source.case_id, 'IFC_TIMEOUT'); }
    finally { globals.ulpinPool = pool; }
    assert.deepEqual([g.jobs.get(stopped).status, g.item.state, g.item.placement],
      ['failed', 'read', 'not_understood']);
    assert.match(g.item.limit_reason!, /^The IFC reading stopped \(IFC_TIMEOUT\), so the building, storeys and spaces/);
    assert.equal(IntakeItemSchema.parse(intakeItem(g.item)).ifcJobId, stopped);
  });

test('outline words use only the accepted count, including zero; older readings keep their words', () => {
  const summary = realSummary(), before = intakeIfcReadWords(summary);
  for (const count of [0, 1, 2]) {
    assert.equal(intakeIfcReadWords({ ...summary, storeyOutlineCount: count }), before
      + ` ${count} storey outlines in the file's own frame, not placed on the map.`);
  }
  assert.doesNotMatch(before, /outlines/);
});

test('a structure the scan did not read is said in its own words, never counted', () => {
  const summary = { ...realSummary(), structure: { state: 'not_read' as const, code: 'STRUCTURE_ENTITY_LIMIT',
    reason: 'The IFC holds more structure entities than the scan keeps.' } };
  assert.equal(intakeIfcReadWords(summary), 'The IFC was read, but not the building, storeys and spaces it states '
    + '(STRUCTURE_ENTITY_LIMIT): The IFC holds more structure entities than the scan keeps.');
});
