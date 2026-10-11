import type { PoolClient } from 'pg';
import { INTAKE_CARD_VERSION, IntakeItemSchema, type IntakeCard } from '@ulpin/contracts/usp';
import { fingerprint } from '../../cases/domain';
import { intakeSizeClass, intakeWave } from './intake-probe';
import type { IntakeSourceRow } from './intake-context';
import { notFound } from '../../../infrastructure/errors';
import { appendIntakeItemTx } from './events';

/** Metadata registration only. It adds/changes no source and deliberately does not advance case revision. */
export async function registerIntakeItemTx(client: PoolClient, source: IntakeSourceRow) {
  const row = (await client.query(`INSERT INTO usp_intake_items(item_id,source_id,case_id,size_bytes,size_class)
    VALUES($1,$1,$2,$3,$4) ON CONFLICT(source_id) WHERE parent_item_id IS NULL DO NOTHING RETURNING *`,
  [source.id, source.case_id, Number(source.bytes), intakeSizeClass(Number(source.bytes))])).rows[0];
  if (row) return row;
  return (await client.query('SELECT * FROM usp_intake_items WHERE source_id=$1 AND parent_item_id IS NULL',
    [source.id])).rows[0];
}

export function intakeItem(row: any) {
  return IntakeItemSchema.parse({
    itemId: row.item_id, sourceId: row.source_id, caseId: row.case_id, parentItemId: row.parent_item_id,
    memberPath: row.member_path, name: row.name ?? row.member_path, family: row.family, format: row.format,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes), sizeClass: row.size_class,
    wave: row.wave, state: row.state,
    placement: row.placement, card: row.card, cardSha256: row.card_sha256, probeVersion: row.probe_version,
    partsPlanned: row.parts_planned, partsDone: row.parts_done, recordsSeen: Number(row.records_seen),
    limitReason: row.limit_reason, pinnedByOfficer: row.pinned_by_officer,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  });
}

export type IntakeDraftState = {
  state: 'probed' | 'planned' | 'reading' | 'read';
  placement: 'undecided' | 'needs_answer' | 'on_map';
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
