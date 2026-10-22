import type { PoolClient } from 'pg';
import { z } from 'zod';
import { INTAKE_CARD_VERSION, IntakeItemSchema, IntakeItemPlanSchema, IntakeLayerCrsSchema,
  IntakeLayerCrsAnswerSchema, IntakePageImageReadSchema, type IntakeCard } from '@ulpin/contracts/usp';
import { fingerprint } from '../../cases/domain';
import { intakeSizeClass, intakeWave } from './intake-probe';
import type { IntakeSourceRow } from './intake-context';
import { conflict, notFound } from '../../../infrastructure/errors';
import type { ImportPackage } from '@ulpin/contracts';
import { appendIntakeItemTx } from './events';
import { intakeNameWords } from './intake-text';

/** Metadata registration only. It adds/changes no source and deliberately does not advance case revision. */
export async function registerIntakeItemTx(client: PoolClient, source: IntakeSourceRow) {
  const row = (await client.query(`INSERT INTO usp_intake_items(item_id,source_id,case_id,size_bytes,size_class)
    VALUES($1,$1,$2,$3,$4) ON CONFLICT(source_id) WHERE parent_item_id IS NULL DO NOTHING RETURNING *`,
  [source.id, source.case_id, Number(source.bytes), intakeSizeClass(Number(source.bytes))])).rows[0];
  if (row) return row;
  return (await client.query('SELECT * FROM usp_intake_items WHERE source_id=$1 AND parent_item_id IS NULL',
    [source.id])).rows[0];
}

/** Unknown stored projections must not make the rest of the tray unreadable. */
function intakePlan(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const stored = value as Record<string, unknown>;
  const plan = IntakeItemPlanSchema.safeParse({ ...stored, packageId: stored.packageId ?? null });
  return plan.success ? plan.data : null;
}

function existingArea(value: unknown) {
  const areaId = (value as { existingAreaId?: unknown } | null)?.existingAreaId;
  return Boolean(areaId) && IntakeItemSchema.shape.existingAreaId.safeParse(areaId).success;
}

/** G23. A page image's read, kept beside the item's other facts. */
function pageImage(value: unknown) {
  const parsed = IntakePageImageReadSchema.safeParse((value as { pageImage?: unknown } | null)?.pageImage);
  return parsed.success ? { pageImage: parsed.data } : {};
}

const layer = IntakeLayerCrsSchema.shape.layer;
/** CR1. Beside a GeoPackage or shapefile ZIP's item: its layers stating no system, and the officer's answers. */
export const NativeLayersRefSchema = z.strictObject({ unstated: z.array(layer).max(100),
  answers: z.array(IntakeLayerCrsAnswerSchema.extend({ layer })).max(100) });
export type NativeLayersRef = z.infer<typeof NativeLayersRefSchema>;

export function nativeLayersRef(value: unknown): NativeLayersRef {
  const stored = NativeLayersRefSchema.safeParse((value as { nativeLayers?: unknown } | null)?.nativeLayers);
  return stored.success ? stored.data : { unstated: [], answers: [] };
}

/** Each layer asked about, in the order the conversion named it, with its answer once given. */
function layerCrs(value: unknown) {
  const { unstated, answers } = nativeLayersRef(value);
  const layers = [...new Set([...unstated, ...answers.map(answer => answer.layer)])];
  if (!layers.length) return {};
  return { layerCrs: layers.map(name => {
    const answer = answers.find(entry => entry.layer === name);
    return { layer: name, answer: answer ? { crs: answer.crs, state: answer.state, statedAt: answer.statedAt } : null };
  }) };
}

export function intakeItem(row: any) {
  const named = intakeNameWords(row.card, row.name ?? row.member_path ?? '');
  const reason = [named, row.limit_reason].filter(Boolean).join(' ').slice(0, 2000) || null;
  return IntakeItemSchema.parse({
    itemId: row.item_id, sourceId: row.source_id, caseId: row.case_id, parentItemId: row.parent_item_id,
    memberPath: row.member_path, name: row.name ?? row.member_path, family: row.family, format: row.format,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes), sizeClass: row.size_class,
    wave: row.wave, state: row.state,
    placement: row.placement, card: row.card, cardSha256: row.card_sha256, probeVersion: row.probe_version,
    plan: intakePlan(row.plan_ref), streamedProfileJobId: row.streamed_profile_job_id ?? null,
    partsPlanned: row.parts_planned, partsDone: row.parts_done, recordsSeen: Number(row.records_seen),
    limitReason: reason, pinnedByOfficer: row.pinned_by_officer,
    ...(existingArea(row.plan_ref) ? { existingAreaId: row.plan_ref.existingAreaId } : {}), ...pageImage(row.plan_ref),
    ...layerCrs(row.plan_ref),
    ...(IntakeItemSchema.shape.ifcJobId.unwrap().safeParse(row.plan_ref?.ifcJobId).success
      ? { ifcJobId: row.plan_ref.ifcJobId } : {}),
    ...(IntakeItemSchema.shape.nativeReaderJobId.unwrap().safeParse(row.plan_ref?.nativeReaderJobId).success
      ? { nativeReaderJobId: row.plan_ref.nativeReaderJobId } : {}),
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  });
}

export type IntakeDraftState = {
  state: 'probed' | 'planned' | 'reading' | 'read' | 'read_to_limit' | 'failed_part';
  placement: 'undecided' | 'needs_answer' | 'on_map' | 'waiting_for_anchor' | 'not_understood';
  planRef: Record<string, unknown> | null;
  recordsSeen: number;
  limitReason: string | null;
};

/** One tray transition and one refresh event; replaying an unchanged transition publishes nothing. */
export async function writeIntakeDraftTx(client: PoolClient, caseId: string, itemId: string,
  next: IntakeDraftState) {
  const current = await readIntakeDraftTx(client, caseId, itemId);
  if (fingerprint(current) === fingerprint(next)) return;
  await client.query(`UPDATE usp_intake_items SET state=$3,placement=$4,plan_ref=$5,records_seen=$6,
    limit_reason=$7,updated_at=now() WHERE case_id=$1 AND item_id=$2`,
  [caseId, itemId, next.state, next.placement, next.planRef, next.recordsSeen, next.limitReason]);
  await appendIntakeItemTx(client, caseId, itemId);
}

/** The durable completion projection is also hashed by the shared job result validator. */
export async function readIntakeDraftTx(client: PoolClient, caseId: string, itemId: string): Promise<IntakeDraftState> {
  const row = (await client.query(`SELECT state,placement,plan_ref,records_seen,limit_reason FROM usp_intake_items
    WHERE case_id=$1 AND item_id=$2 FOR UPDATE`, [caseId, itemId])).rows[0] ?? notFound('Intake draft not found.');
  return { state: row.state, placement: row.placement, planRef: row.plan_ref,
    recordsSeen: Number(row.records_seen), limitReason: row.limit_reason };
}

export type IntakeLargeState = IntakeDraftState & { partsPlanned: number | null; partsDone: number };

/** Counters and tray state publish one refresh together; an exact replay publishes nothing. */
export async function writeIntakeLargeTx(client: PoolClient, caseId: string, itemId: string,
  next: IntakeLargeState) {
  const { partsPlanned, partsDone, ...draft } = next;
  const current = await readIntakeDraftTx(client, caseId, itemId);
  const counters = (await client.query(`SELECT parts_planned,parts_done FROM usp_intake_items
    WHERE case_id=$1 AND item_id=$2`, [caseId, itemId])).rows[0];
  const countersChanged = counters.parts_planned !== partsPlanned || counters.parts_done !== partsDone;
  const draftChanged = fingerprint(current) !== fingerprint(draft);
  if (!countersChanged && !draftChanged) return;
  if (countersChanged) await client.query(`UPDATE usp_intake_items SET parts_planned=$3,parts_done=$4,
    updated_at=now() WHERE case_id=$1 AND item_id=$2`, [caseId, itemId, partsPlanned, partsDone]);
  await writeIntakeDraftTx(client, caseId, itemId, draft);
  if (!draftChanged) await appendIntakeItemTx(client, caseId, itemId);
}

/** Reviewed/committed packages have finished drafting; every other drafted or running part is unfinished. */
export async function unfinishedIntakePackagesTx(client: PoolClient, itemId: string): Promise<number> {
  const row = (await client.query(`SELECT count(*)::int n FROM usp_intake_parts part
    LEFT JOIN import_packages p ON p.id::text=part.result_ref->>'packageId'
    WHERE part.item_id=$1 AND (part.state IN ('queued','running') OR (part.state='published'
      AND p.state<>'COMMITTED'
      AND p.body->'review'->'packageRevision' IS DISTINCT FROM p.body->'revision'))`, [itemId])).rows[0];
  return Number(row.n);
}

/** A cut and its package are one transaction. Large items never put one package ID in their plan. */
export async function publishIntakePartTx(client: PoolClient, itemId: string, partIndex: number,
  pkg: ImportPackage, locator: Record<string, unknown>, counts: Record<string, unknown>) {
  const item = (await client.query('SELECT * FROM usp_intake_items WHERE item_id=$1 FOR UPDATE', [itemId])).rows[0]
    ?? notFound('The intake item is unavailable.');
  if (item.parent_item_id || !pkg.sourceRevisionIds.includes(item.source_id))
    conflict('The package does not belong to this original intake item.');
  const prior = (await client.query('SELECT * FROM usp_intake_parts WHERE item_id=$1 AND part_index=$2 FOR UPDATE',
    [itemId, partIndex])).rows[0];
  const result = { packageId: pkg.id };
  if (prior) {
    if (prior.state !== 'published' || fingerprint(prior.locator) !== fingerprint(locator)
      || fingerprint(prior.counts) !== fingerprint(counts) || fingerprint(prior.result_ref) !== fingerprint(result))
      conflict('The retained package part differs from its exact replay.');
    return;
  }
  const next = Number((await client.query('SELECT count(*)::int n FROM usp_intake_parts WHERE item_id=$1',
    [itemId])).rows[0].n);
  if (partIndex !== next) conflict('An intake package part cannot skip the original cut order.');
  if (!Number.isSafeInteger(counts.recordsSeen) || Number(counts.recordsSeen) < 0)
    conflict('The published package part needs the exact closed reader count.');
  await client.query(`INSERT INTO usp_intake_parts(item_id,part_index,locator,state,counts,result_ref)
    VALUES($1,$2,$3,'published',$4,$5)`, [itemId, partIndex, locator, counts, result]);
  await client.query(`UPDATE usp_intake_items SET parts_done=parts_done+1,state='reading',placement='on_map',
    records_seen=GREATEST(records_seen,$2),updated_at=now() WHERE item_id=$1`, [itemId, counts.recordsSeen]);
  await appendIntakeItemTx(client, item.case_id, itemId);
}

function sourceCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^(?:EPSG:\d+|urn:ogc:def:crs:EPSG::\d+)$/.test(value) ? value : null;
}

/** Cite retained source metadata, not a second whole-file count or CRS calculation. Values are never copied. */
export function citeIntakeReceipt(card: IntakeCard, source: IntakeSourceRow): IntakeCard {
  const inspection = source.inspection ?? {};
  const profile = inspection.manualProfile;
  const count = profile?.featureCount ?? profile?.records ?? inspection.featureCount;
  if (Number.isSafeInteger(count) && count >= 0) {
    if (profile?.records !== undefined) card.counts.rows = count;
    else card.counts.features = count;
    card.citations.push({ locator: 'source.inspection:retained_count', sha256: source.sha256 });
    card.limits.push('Count cited from retained receipt; its accepted coverage is not a recomputed raw-file total.');
  }
  const crs = sourceCode(profile?.crs?.value ?? inspection.gis?.sourceCrs);
  if (crs) {
    if (card.crs.code && card.crs.code !== crs) {
      card.crs.state = 'conflicting';
      card.extent.epsg4326 = null;
    }
    else card.crs = { state: 'stated', code: crs, sidecarSha256: card.crs.sidecarSha256 };
    card.citations.push({ locator: 'source.inspection:retained_crs', sha256: source.sha256 });
  }
  const types = profile?.geometryTypes ?? inspection.gis?.geometryTypes;
  const allowed = /^(?:Point|MultiPoint|LineString|MultiLineString|Polygon|MultiPolygon|GeometryCollection)[ZM]?$/;
  if (Array.isArray(types) && types.every(type => typeof type === 'string' && allowed.test(type))) {
    card.geometryTypes = types.slice(0, 32);
    card.citations.push({ locator: 'source.inspection:retained_geometry_types', sha256: source.sha256 });
  }
  for (const key of ['documentAccepted', 'rasterAccepted', 'pointAccepted', 'ifcAccepted', 'dxfAccepted',
    'kmlAccepted', 'citygmlAccepted', 'cityjsonAccepted', 'gltfAccepted', 'objAccepted', 'geoparquetAccepted']) {
    const hash = inspection[key]?.sha256;
    if (typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)) {
      card.citations.push({ locator: `source.inspection.${key}:accepted_result`, sha256: hash });
    }
  }
  return card;
}

export async function saveIntakeCardTx(client: PoolClient, itemId: string, card: IntakeCard) {
  await client.query(`UPDATE usp_intake_items SET card=$2,card_sha256=$3,probe_version=$4,family=$5,format=$6,
    wave=CASE WHEN pinned_by_officer THEN wave ELSE $7 END,
    state=CASE WHEN plan_ref IS NULL THEN 'probed' ELSE state END,
    limit_reason=CASE WHEN placement='needs_answer' THEN limit_reason ELSE NULL END,updated_at=now()
    WHERE item_id=$1`,
  [itemId, card, fingerprint(card), INTAKE_CARD_VERSION, card.family, card.format, intakeWave(card)]);
}
