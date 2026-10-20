import type { PoolClient } from 'pg';
import { INTAKE_SURFACE_VERSION, INTAKE_SURFACE_LIMITS, RASTER_WINDOW_LIMITS, POINT_BATCH_LIMITS,
  IntakeSurfaceLocatorSchema, IntakeSurfacePartPageSchema, IntakeSurfaceDisplaySchema, type IntakeCard,
  type IntakeSurfaceLocator, type RasterWindowResult, type PointBatchResult } from '@ulpin/contracts/usp';
import { query, transaction } from '../../../infrastructure/db';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { stableUuid } from './intake-run';
import { writeIntakeLargeTx } from './intake-ledger';
import type { IntakeSourceRow } from './intake-context';
import { rasterSourceTx, enqueueRasterWindowTx, rasterReaderSha, rasterWindowCaptureTx } from './raster-window';
import { pointSourceTx, enqueuePointBatchTx, pointReaderSha, pointBatchCaptureTx } from './point-batch';

/**
 * SB1. An orthophoto, terrain raster or point cloud kept in a batch is read in parts by the existing raster-window
 * and point-batch readers and their jobs. This helper plans the parts, admits them inside those readers' caps and
 * records each accepted part against its item. Surfaces are display context only: nothing here writes a record,
 * measurement, height or identity, and an unstated vertical reference stays unknown.
 */
type Operation = IntakeSurfaceLocator['operation'];
type Header = { operation: Operation; crsStated: boolean; authority: string | null;
  vertical: { status: 'known' | 'unknown'; name: string | null }; size: number[]; planned: number; total: number };
type Plan = { version: typeof INTAKE_SURFACE_VERSION; operation: Operation; header: Header | null };
type Item = { item_id: string; case_id: string; source_id: string; plan_ref: Plan };

const readers = { 'raster-window': rasterReaderSha, 'point-batch': pointReaderSha };
const mib = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1).replace(/\.0$/, '')} MB`;
const kept = 'so it is not read or on the map; the original is kept with its SHA-256.';

/** Which existing reader takes a probed original, or the limit it is over in officer words (D6), or null. */
export function surfaceReader(card: IntakeCard, bytes: number): { operation: Operation } | { limit: string } | null {
  const raster = card.family === 'raster' && ['tiff', 'geotiff', 'bigtiff'].includes(card.format);
  const point = card.family === 'point_cloud' && ['las', 'laz'].includes(card.format);
  if (!raster && !point) return null;
  const noun = raster ? 'raster' : 'point cloud';
  const ceiling = (raster ? RASTER_WINDOW_LIMITS : POINT_BATCH_LIMITS).originalBytes;
  if (bytes > ceiling) return { limit: `Kept (${mib(bytes)}). The batch reads a ${noun} of at most `
    + `${mib(ceiling)} natively, ${kept}` };
  if (raster && card.raster?.width && card.raster.height
    && card.raster.width * card.raster.height > RASTER_WINDOW_LIMITS.sourcePixels) return { limit: 'Kept. The '
    + `batch reads a raster of at most 100 million pixels; this one has ${card.raster.width} × `
    + `${card.raster.height}, ${kept}` };
  if (raster && (card.counts.bands ?? 0) > RASTER_WINDOW_LIMITS.sourceBands) return { limit: 'Kept. The batch reads '
    + `a raster of at most 4 bands; this one has ${card.counts.bands}, ${kept}` };
  if (point && (card.format !== 'laz' || (card.formatVersion !== null && card.formatVersion !== '1.4')
    || (card.point !== null && card.point.format !== 6))) return { limit: 'Kept. The batch point reader takes '
    + `compressed LAZ of LAS 1.4 point format 6 only; this is ${card.format.toUpperCase()} `
    + `${card.formatVersion ?? 'of an unread version'}${card.point ? ` format ${card.point.format}` : ''}, ${kept}` };
  if (point && (card.counts.points ?? 0) > POINT_BATCH_LIMITS.sourcePoints) return { limit: 'Kept. The batch reads '
    + `a point cloud of at most 5 million points; this one states ${card.counts.points}, ${kept}` };
  return { operation: raster ? 'raster-window' : 'point-batch' };
}

const firstLocator = (operation: Operation): IntakeSurfaceLocator =>
  operation === 'raster-window' ? { operation, window: null } : { operation, batch: null };

/** The part's identity: the exact original, reader and locator (proposal jobIdentity). */
function partKey(source: { sha256: string }, locator: IntakeSurfaceLocator) {
  return fingerprint({ version: INTAKE_SURFACE_VERSION, sourceSha256: source.sha256,
    readerSha256: readers[locator.operation](), locator });
}

async function insertPartsTx(client: PoolClient, itemId: string, source: { sha256: string }, from: number,
  locators: IntakeSurfaceLocator[]) {
  if (!locators.length) return;
  await client.query(`INSERT INTO usp_intake_parts(item_id,part_index,locator,state)
    SELECT $1,$2::integer+n-1,locator,'planned' FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY t(locator,n)
    ON CONFLICT(item_id,part_index) DO NOTHING`,
  [itemId, from, JSON.stringify(locators.map(locator => ({ ...locator, partKey: partKey(source, locator) })))]);
}

/**
 * D2. Beside the vector queue in the publishing transaction: a kept TIFF or LAZ plans its first part and admits
 * it when the reader has room. True when this helper owns the item; an enrolment replay changes nothing.
 */
export async function queueIntakeSurfaceTx(client: PoolClient, source: IntakeSourceRow, card: IntakeCard) {
  const reader = source.profile === 'large-original-v1' ? surfaceReader(card, Number(source.bytes)) : null;
  if (!reader) return false;
  const item = (await client.query(`SELECT * FROM usp_intake_items WHERE source_id=$1 AND parent_item_id IS NULL
    FOR UPDATE`, [source.id])).rows[0];
  if (!item) return false;
  // A re-probe clears the tray words; the part rows give them back unchanged.
  if (item.plan_ref?.version === INTAKE_SURFACE_VERSION) await settleSurfaceItemTx(client, item.item_id);
  if (item.plan_ref) return true;
  if ('limit' in reader) {
    await writeIntakeLargeTx(client, item.case_id, item.item_id, { state: 'probed', placement: 'not_understood',
      planRef: null, partsPlanned: null, partsDone: 0, recordsSeen: 0, limitReason: reader.limit });
    return true;
  }
  const plan: Plan = { version: INTAKE_SURFACE_VERSION, operation: reader.operation, header: null };
  await client.query('UPDATE usp_intake_items SET plan_ref=$2 WHERE item_id=$1', [item.item_id, plan]);
  await insertPartsTx(client, item.item_id, source, 0, [firstLocator(reader.operation)]);
  await admitSurfaceItemTx(client, { ...item, plan_ref: plan });
  await settleSurfaceItemTx(client, item.item_id);
  return true;
}

/** Before a batch has an area, a vector still drafting may bind one; a part read now would be stale then. */
async function waitsForAreaTx(client: PoolClient, caseId: string) {
  return Boolean((await client.query(`SELECT 1 FROM cases c WHERE c.id=$1 AND c.site_id IS NULL AND EXISTS (
    SELECT 1 FROM usp_intake_items i WHERE i.case_id=c.id AND i.family='vector' AND i.placement='undecided'
      AND i.state IN ('received','probed','planned','reading'))`, [caseId])).rowCount);
}

/**
 * Admit the item's next planned part to its reader's existing job, inside the reader's caps. The same source,
 * part and context pin is the same job (D7). A busy reader leaves the part planned for the next tick.
 */
async function admitSurfaceItemTx(client: PoolClient, item: Item) {
  const operation = item.plan_ref.operation;
  if (await waitsForAreaTx(client, item.case_id)) return;
  let partIndex: number | undefined;
  try {
    // The case and source authority is taken before the admission lock, in the publishing transaction's order.
    const ctx = operation === 'raster-window' ? await rasterSourceTx(client, item.case_id, item.source_id, true)
      : await pointSourceTx(client, item.case_id, item.source_id, true);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${operation}-admission-v1`]);
    const part = (await client.query(`SELECT part_index,locator FROM usp_intake_parts WHERE item_id=$1
      AND state='planned' AND NOT EXISTS (SELECT 1 FROM usp_intake_parts q WHERE q.item_id=$1 AND q.state='queued')
      ORDER BY part_index LIMIT 1 FOR UPDATE`, [item.item_id])).rows[0];
    if (!part) return;
    partIndex = part.part_index as number;
    const { partKey: key, ...stored } = part.locator;
    const locator = IntakeSurfaceLocatorSchema.parse(stored);
    const pin = fingerprint({ context: ctx.context, access: ctx.binding.access });
    const jobId = stableUuid(`${INTAKE_SURFACE_VERSION}:${item.item_id}:${ctx.source.revision}:${key}:${pin}`);
    if (locator.operation === 'raster-window') await enqueueRasterWindowTx(client, ctx, locator.window, jobId);
    else await enqueuePointBatchTx(client, ctx, locator.batch, jobId);
    // The same pin names the same job; one that already ended is not queued again under that pin.
    const job = (await client.query('SELECT status,error FROM jobs WHERE id=$1', [jobId])).rows[0];
    if (['failed', 'stale'].includes(job?.status)) return quarantineTx(client, item.item_id, partIndex, job.error);
    await client.query(`UPDATE usp_intake_parts SET state='queued',job_id=$3,updated_at=now()
      WHERE item_id=$1 AND part_index=$2`, [item.item_id, partIndex, jobId]);
    await settleSurfaceItemTx(client, item.item_id);
  } catch (error) {
    // A busy reader leaves the part planned; a refusal of the reader's own authority rests on the part.
    if (error instanceof AppError && error.code.endsWith('_WORKER_BUSY')) return;
    if (!(error instanceof AppError) || error.status === 500 || partIndex === undefined) throw error;
    return quarantineTx(client, item.item_id, partIndex, error.code);
  }
}

async function quarantineTx(client: PoolClient, itemId: string, partIndex: number, code: unknown) {
  const issue = typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(code) ? code : 'SURFACE_PART_FAILED';
  await client.query(`UPDATE usp_intake_parts SET state='quarantined',issue_code=$3,updated_at=now()
    WHERE item_id=$1 AND part_index=$2`, [itemId, partIndex, issue]);
  await settleSurfaceItemTx(client, itemId);
}

/** One dispatcher tick: each kept surface with a planned part and none queued, oldest first, one part each. */
export async function admitIntakeSurfaceParts() {
  const items = (await query(`SELECT i.item_id FROM usp_intake_items i
    WHERE i.plan_ref->>'version'=$1 AND EXISTS (SELECT 1 FROM usp_intake_parts p WHERE p.item_id=i.item_id
      AND p.state='planned') AND NOT EXISTS (SELECT 1 FROM usp_intake_parts p WHERE p.item_id=i.item_id
      AND p.state='queued')
    ORDER BY (SELECT max(p.updated_at) FROM usp_intake_parts p WHERE p.item_id=i.item_id) LIMIT $2`,
  [INTAKE_SURFACE_VERSION, INTAKE_SURFACE_LIMITS.page])).rows;
  for (const { item_id: itemId } of items) await transaction(async client => {
    const item = (await client.query('SELECT * FROM usp_intake_items WHERE item_id=$1', [itemId])).rows[0];
    if (item?.plan_ref?.version === INTAKE_SURFACE_VERSION) await admitSurfaceItemTx(client, item);
  });
}

function rasterPlan(result: RasterWindowResult) {
  const { sourceWidth: width, sourceHeight: height } = result.metadata, side = INTAKE_SURFACE_LIMITS.windowSide;
  const windows: IntakeSurfaceLocator[] = [];
  for (let y = 0; y < height; y += side) for (let x = 0; x < width; x += side) windows.push({ operation:
    'raster-window', window: { x, y, width: Math.min(side, width - x), height: Math.min(side, height - y) } });
  return windows;
}

function pointPlan(result: PointBatchResult) {
  const total = result.metadata.sourcePointCount, side = INTAKE_SURFACE_LIMITS.batchPoints;
  const batches: IntakeSurfaceLocator[] = [];
  for (let start = 0; start < total; start += side) batches.push({ operation: 'point-batch',
    batch: { start, count: Math.min(side, total - start) } });
  return batches;
}

/** Every planned part of a whole original, as its first accepted read found it. Exported for the real-input test. */
export function surfacePlan(result: { operation: 'raster-window'; value: RasterWindowResult }
  | { operation: 'point-batch'; value: PointBatchResult }) {
  return result.operation === 'raster-window' ? rasterPlan(result.value) : pointPlan(result.value);
}

/** The XY extent of native LAS 1.4 format-6 records: int32 X and Y at bytes 0 and 4, scaled and offset. */
export function pointRecordsExtent(records: Uint8Array, scale: number[], offset: number[]) {
  const view = new DataView(records.buffer, records.byteOffset, records.byteLength);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let at = 0; at + 30 <= records.byteLength; at += 30) {
    const x = view.getInt32(at, true) * scale[0] + offset[0], y = view.getInt32(at + 4, true) * scale[1] + offset[1];
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

type Accepted = { jobId: string; resultSha256: string }
  & ({ operation: 'raster-window'; value: RasterWindowResult }
    | { operation: 'point-batch'; value: PointBatchResult; extent: number[] | null });

function acceptedHeader(accepted: Accepted, planned: number, total: number): Header {
  const m = accepted.value.metadata;
  const vertical = { status: m.verticalReferenceStatus, name: m.verticalReference };
  if (accepted.operation === 'raster-window') {
    const r = accepted.value.metadata;
    return { operation: 'raster-window', crsStated: Boolean(r.sourceCrsWkt), authority: r.sourceCrsAuthority,
      vertical, size: [r.sourceWidth, r.sourceHeight, r.sourceBands], planned, total };
  }
  const p = accepted.value.metadata;
  return { operation: 'point-batch', crsStated: Boolean(p.crsWkt), authority: p.horizontalAuthority, vertical,
    size: [p.sourcePointCount], planned, total };
}

/** The accepted read as the part cites it: exact job, result, artifact, locator read and source-frame corners. */
function partResult(accepted: Accepted) {
  const { artifact } = accepted.value;
  const base = { jobId: accepted.jobId, resultSha256: accepted.resultSha256,
    artifact: { sha256: artifact.sha256, bytes: artifact.bytes, mediaType: artifact.mediaType } };
  if (accepted.operation === 'raster-window') {
    const m = accepted.value.metadata, [a, b, c, d, e, f] = m.windowTransform, { width: w, height: h } = m.window;
    const at = (col: number, row: number) => [a * col + b * row + c, d * col + e * row + f];
    return { result: { ...base, read: { operation: 'raster-window', window: m.window },
      sourceCorners: [at(0, 0), at(w, 0), at(w, h), at(0, h)] }, counts: { pixels: w * h } };
  }
  const m = accepted.value.metadata, box = accepted.extent;
  return { result: { ...base, read: { operation: 'point-batch', batch: m.batch },
    sourceCorners: box && [[box[0], box[3]], [box[2], box[3]], [box[2], box[1]], [box[0], box[1]]] },
  counts: { points: m.batch.count } };
}

/**
 * Inside the reader's acceptance transaction: the part of this job is published with the accepted read. The first
 * accepted part plans the rest from what the reader found (D3); a job of the dedicated routes has no part.
 */
export async function acceptIntakeSurfacePartTx(client: PoolClient, accepted: Accepted) {
  const part = (await client.query(`SELECT p.*,i.plan_ref FROM usp_intake_parts p
    JOIN usp_intake_items i ON i.item_id=p.item_id WHERE p.job_id=$1 FOR UPDATE OF p,i`, [accepted.jobId])).rows[0];
  if (!part || part.state === 'published') return;
  const { result, counts } = partResult(accepted);
  await client.query(`UPDATE usp_intake_parts SET state='published',counts=$3,result_ref=$4,updated_at=now()
    WHERE item_id=$1 AND part_index=$2`, [part.item_id, part.part_index, counts, result]);
  const plan: Plan = part.plan_ref;
  if (!plan.header) {
    const all = accepted.operation === 'raster-window' ? rasterPlan(accepted.value) : pointPlan(accepted.value);
    const cap = accepted.operation === 'raster-window' ? RASTER_WINDOW_LIMITS.jobsPerSource
      : POINT_BATCH_LIMITS.jobsPerSource, planned = Math.min(all.length, cap);
    const source = { sha256: accepted.value.input.sourceSha256 };
    await insertPartsTx(client, part.item_id, source, 1, all.slice(1, planned));
    await client.query('UPDATE usp_intake_items SET plan_ref=$2 WHERE item_id=$1',
      [part.item_id, { ...plan, header: acceptedHeader(accepted, planned, all.length) }]);
  }
  await settleSurfaceItemTx(client, part.item_id);
}

/** A stale read returns its part to planned under a fresh pin; any other failure quarantines the part. */
export async function failIntakeSurfacePartTx(client: PoolClient, jobId: string, code: string) {
  const part = (await client.query(`SELECT item_id,part_index,state FROM usp_intake_parts WHERE job_id=$1
    FOR UPDATE`, [jobId])).rows[0];
  if (!part || part.state !== 'queued') return;
  if (code.endsWith('_INPUT_STALE')) await client.query(`UPDATE usp_intake_parts SET state='planned',job_id=NULL,
    updated_at=now() WHERE item_id=$1 AND part_index=$2`, [part.item_id, part.part_index]);
  else return quarantineTx(client, part.item_id, part.part_index, code);
  await settleSurfaceItemTx(client, part.item_id);
}

async function batchAreaTx(client: PoolClient, caseId: string) {
  return (await client.query(`SELECT a.id,a.revision,a.reference FROM cases c JOIN map_areas a ON a.site_id=c.site_id
    WHERE c.id=$1`, [caseId])).rows[0] as { id: string; revision: number; reference: any } | undefined;
}

function surfaceWords(header: Header | null, state: string, done: number, failed: string | null, placement: string) {
  if (failed) return `A part could not be read (${failed}); the original is kept with its SHA-256.`;
  if (!header) return `The first part ${state === 'reading' ? 'is being read' : 'waits for its reader'}; `
    + 'its coordinate system and size are not read yet.';
  const raster = header.operation === 'raster-window';
  const what = raster ? `${header.size[0]} × ${header.size[1]} pixels, ${header.size[2]} band`
    + `${header.size[2] === 1 ? '' : 's'}` : `${header.size[0]} points`;
  const parts = `Read ${done} of ${header.planned} ${raster ? 'windows' : 'batches'} (${what}`
    + `${header.authority ? `, ${header.authority}` : ''}).`;
  const limit = header.total > header.planned ? ` The reader takes at most ${header.planned} parts of one original, `
    + `so ${header.total - header.planned} are not read.` : '';
  const where = placement === 'not_understood' ? ' The file states no coordinate system, so it is read but not placed.'
    : placement === 'waiting_for_anchor' ? ' It is read but not placed until the batch has a map reference.' : '';
  const vertical = header.vertical.status === 'known' ? ` Vertical reference stated: ${header.vertical.name}.`
    : ' The file states no vertical reference.';
  return `${parts}${limit}${where}${vertical} Display only: no height, measurement or record is taken from it.`;
}

/** The item's tray state, placement and words follow its part rows; an unchanged state publishes nothing. */
export async function settleSurfaceItemTx(client: PoolClient, itemId: string) {
  const item = (await client.query('SELECT case_id,plan_ref FROM usp_intake_items WHERE item_id=$1 FOR UPDATE',
    [itemId])).rows[0] ?? notFound('Intake item not found.');
  const parts = (await client.query(`SELECT state,counts,issue_code FROM usp_intake_parts WHERE item_id=$1
    ORDER BY part_index`, [itemId])).rows;
  const header: Header | null = item.plan_ref.header;
  const done = parts.filter(part => part.state === 'published').length;
  const failed = parts.find(part => part.state === 'quarantined')?.issue_code ?? null;
  const area = header?.authority ? await batchAreaTx(client, item.case_id) : undefined;
  const placement = !header ? 'undecided' : !header.authority ? 'not_understood'
    : area?.reference ? 'on_map' : 'waiting_for_anchor';
  const state = failed ? 'failed_part' : header && done === parts.length
    ? (header.total > header.planned ? 'read_to_limit' : 'read')
    : done > 0 || parts.some(part => part.state === 'queued') ? 'reading' : 'planned';
  const recordsSeen = parts.reduce((sum, part) => sum + Number(part.counts?.points ?? 0), 0);
  await writeIntakeLargeTx(client, item.case_id, itemId, { state, placement, planRef: item.plan_ref,
    partsPlanned: header?.planned ?? null, partsDone: done, recordsSeen,
    limitReason: surfaceWords(header, state, done, failed, placement) });
}

const partSelect = `SELECT p.*,i.source_id,i.plan_ref FROM usp_intake_parts p
  JOIN usp_intake_items i ON i.item_id=p.item_id WHERE i.case_id=$1 AND p.item_id=$2`;

function partOf(row: any) {
  const { partKey: key, ...locator } = row.locator;
  return { partIndex: row.part_index, state: row.state === 'running' ? 'queued' : row.state,
    locator: IntakeSurfaceLocatorSchema.parse(locator), partKey: key, jobId: row.job_id,
    resultSha256: row.result_ref?.resultSha256 ?? null, issueCode: row.issue_code };
}

/** The item's parts in order, a page at a time; the caller has checked the item's authority. */
export async function surfacePartsTx(client: PoolClient, caseId: string, itemId: string, after = -1) {
  const item = (await client.query('SELECT plan_ref,parts_planned FROM usp_intake_items WHERE item_id=$1',
    [itemId])).rows[0];
  if (item?.plan_ref?.version !== INTAKE_SURFACE_VERSION) notFound('This intake item is not read in surface parts.');
  const rows = (await client.query(`${partSelect} AND p.part_index>$3 ORDER BY p.part_index LIMIT $4`,
    [caseId, itemId, after, INTAKE_SURFACE_LIMITS.page + 1])).rows;
  const page = rows.slice(0, INTAKE_SURFACE_LIMITS.page);
  return IntakeSurfacePartPageSchema.parse({ caseId, itemId, operation: item.plan_ref.operation,
    partsPlanned: item.parts_planned, parts: page.map(partOf),
    next: rows.length > page.length ? page[page.length - 1].part_index : null });
}

async function placedTx(client: PoolClient, caseId: string, header: Header, corners: number[][]) {
  const area = await batchAreaTx(client, caseId);
  if (!area) return { state: 'not_placed', reason: 'no_batch_area',
    words: 'Read but not placed: the batch has no map area yet.' } as const;
  if (!area.reference) return { state: 'not_placed', reason: 'no_area_reference',
    words: 'Read but not placed: the batch area has no reference system yet.' } as const;
  if (!header.authority) return { state: 'not_placed', reason: 'no_stated_crs',
    words: 'Read but not placed: the file states no coordinate system.' } as const;
  const [from, to] = [header.authority, area.reference.analysisCrs].map(code => Number(/^EPSG:(\d+)$/.exec(code)?.[1]));
  const known = from > 0 && to > 0 && Number((await client.query(`SELECT count(DISTINCT auth_srid)::int n
    FROM spatial_ref_sys WHERE auth_name='EPSG' AND auth_srid IN ($1,$2)`, [from, to])).rows[0].n)
    === new Set([from, to]).size;
  if (!known) return { state: 'not_placed', reason: 'transform_unavailable',
    words: `Read but not placed: no transform from ${header.authority} to the batch reference is available.` } as const;
  const [ox, oy] = area.reference.origin;
  const rows = (await client.query(`SELECT ST_X(p) x,ST_Y(p) y FROM unnest($1::float8[],$2::float8[])
    WITH ORDINALITY c(x,y,n), LATERAL (SELECT ST_Translate(ST_Transform(ST_SetSRID(ST_MakePoint(c.x,c.y),$3),$4),
      -($5::float8),-($6::float8)) p) t ORDER BY n`,
  [corners.map(c => c[0]), corners.map(c => c[1]), from, to, ox, oy])).rows;
  return { state: 'placed', areaId: area.id, areaRevision: Number(area.revision),
    analysisCrs: area.reference.analysisCrs, origin: [ox, oy],
    operation: `postgis:ST_Transform(${header.authority}->${area.reference.analysisCrs}) minus area origin`,
    corners: rows.map(row => [Number(row.x), Number(row.y)]) } as const;
}

/**
 * D5. A published part's display read: its corners in the batch's local frame and the accepted artifact. The
 * reader's accepted fence is checked again; a part read under an older context is refused, never shown as current.
 */
export async function surfacePartDisplayTx(client: PoolClient, caseId: string, itemId: string, partIndex: number) {
  const row = (await client.query(`${partSelect} AND p.part_index=$3`, [caseId, itemId, partIndex])).rows[0]
    ?? notFound('Intake part not found.');
  const plan: Plan = row.plan_ref;
  if (plan?.version !== INTAKE_SURFACE_VERSION || row.state !== 'published' || !plan.header)
    throw new AppError(409, 'INTAKE_PART_NOT_READ', 'This part has no accepted read yet.');
  const capture = plan.operation === 'raster-window' ? rasterWindowCaptureTx : pointBatchCaptureTx;
  const { ctx, job, stale } = await capture(client, caseId, row.source_id, row.job_id);
  if (stale || job.status !== 'succeeded' || job.result_ref?.sha256 !== row.result_ref.resultSha256)
    conflict('This part was read under an older batch context, so it is not shown as current.');
  const result = row.result_ref, { partKey: _key, ...locator } = row.locator;
  const corners = result.sourceCorners as number[][] | null;
  if (!corners) throw new AppError(409, 'INTAKE_PART_EMPTY', 'This part read no records to place.');
  const family = plan.operation === 'raster-window' ? 'raster-windows' : 'point-batches';
  return IntakeSurfaceDisplaySchema.parse({ version: INTAKE_SURFACE_VERSION, caseId, itemId, partIndex,
    jobId: row.job_id, original: { sourceId: row.source_id, sourceRevision: ctx.source.revision,
      sha256: ctx.source.sha256, bytes: Number(ctx.source.bytes) },
    locator, read: result.read, resultSha256: result.resultSha256,
    artifact: { ...result.artifact,
      path: `/api/v1/ingestion/cases/${caseId}/sources/${row.source_id}/${family}/jobs/${row.job_id}/artifact` },
    sourceCrs: { state: plan.header.crsStated ? 'stated' : 'not_stated', authority: plan.header.authority },
    verticalReference: plan.header.vertical, sourceCorners: corners,
    placement: await placedTx(client, caseId, plan.header, corners), use: 'display_only' });
}
