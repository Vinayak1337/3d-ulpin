import type { PoolClient } from 'pg';
import { INTAKE_SURFACE_VERSION, INTAKE_SURFACE_LIMITS, RASTER_WINDOW_LIMITS, POINT_BATCH_LIMITS,
  POINT_BATCH_RECORD_LENGTHS,
  IntakeSurfaceLocatorSchema, IntakeSurfacePartPageSchema, IntakeSurfaceDisplaySchema, type IntakeCard,
  type IntakeSurfaceDisplay, type IntakeSurfaceLocator, type RasterWindowResult, type PointBatchResult }
  from '@ulpin/contracts/usp';
import { query, transaction } from '../../../infrastructure/db';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { stableUuid } from './intake-run';
import { writeIntakeLargeTx } from './intake-ledger';
import { ingestionBinding } from './events';
import type { IntakeSourceRow } from './intake-context';
import { rasterSourceTx, enqueueRasterWindowTx, rasterReaderSha, rasterWindowCaptureTx } from './raster-window';
import { pointSourceTx, enqueuePointBatchTx, pointReaderSha, pointBatchCaptureTx } from './point-batch';
import { sourcePartDestinationTx, sourcePartOwnAreaTx } from './source-building-import';

/**
 * SB1. An orthophoto, terrain raster or point cloud kept in a batch is read in parts by the existing raster-window
 * and point-batch readers and their jobs. This helper plans the parts, admits them inside those readers' caps and
 * records each accepted part against its item. Surfaces are display context only: nothing here writes a record,
 * measurement, height or identity, and an unstated vertical reference stays unknown.
 */
type Operation = IntakeSurfaceLocator['operation'];
type Header = { operation: Operation; crsStated: boolean; authority: string | null;
  vertical: { status: 'known' | 'unknown'; name: string | null }; size: number[]; planned: number; total: number;
  preview?: { step: number }; valueRange?: IntakeSurfaceDisplay['valueRange'] };
type Plan = { version: typeof INTAKE_SURFACE_VERSION; operation: Operation; header: Header | null;
  reread?: { pin: string; parts: number }; admissionIssue?: string; admissionSqlState?: string;
  admissionTriedAt?: string; ownAreaId?: string; placedArea?: string | null };
type Item = { item_id: string; case_id: string; source_id: string; plan_ref: Plan };

const readers = { 'raster-window': () => rasterReaderSha(), 'point-batch': () => pointReaderSha() };
const mib = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1).replace(/\.0$/, '')} MiB`;
const kept = 'so it is not read or on the map; the original is kept with its SHA-256.';

/** The probed kinds the raster-window and point-batch readers read, or refuse in their own words. */
export function surfaceKind(card: Pick<IntakeCard, 'family' | 'format'>): 'raster' | 'point' | null {
  if (card.family === 'raster' && ['tiff', 'geotiff', 'bigtiff'].includes(card.format)) return 'raster';
  if (card.family === 'point_cloud' && ['las', 'laz'].includes(card.format)) return 'point';
  return null;
}

/** Which existing reader takes a probed original, or the limit it is over in officer words (D6), or null. */
export function surfaceReader(card: IntakeCard, bytes: number): { operation: Operation } | { limit: string } | null {
  const kind = surfaceKind(card);
  if (!kind) return null;
  const raster = kind === 'raster';
  const point = kind === 'point';
  const pointFormat = card.point?.format ?? null;
  const noun = raster ? 'raster' : 'point cloud';
  const ceiling = (raster ? RASTER_WINDOW_LIMITS : POINT_BATCH_LIMITS).originalBytes;
  if (bytes > ceiling) return { limit: `Kept (${mib(bytes)}). The batch reads a ${noun} of at most `
    + `${mib(ceiling)} natively, ${kept}` };
  if (point && ((card.formatVersion !== null && !['1.2', '1.3', '1.4'].includes(card.formatVersion))
    || (pointFormat !== null && !Object.hasOwn(POINT_BATCH_RECORD_LENGTHS, pointFormat))
    || (pointFormat !== null && pointFormat >= 6 && card.formatVersion !== null
      && card.formatVersion !== '1.4'))) return { limit: 'Kept. The batch point reader takes '
    + 'LAS or LAZ of LAS 1.2, 1.3 or 1.4, point formats 0–3 or 6–8; waveform formats 4/5/9/10 are not read; '
    + `this is ${card.format.toUpperCase()} `
    + `${card.formatVersion ?? 'of an unread version'}${card.point ? ` format ${card.point.format}` : ''}, ${kept}` };
  if (point && (card.counts.points ?? 0) > POINT_BATCH_LIMITS.sourcePoints) return { limit: 'Kept. The batch reads '
    + `a point cloud of at most ${POINT_BATCH_LIMITS.sourcePoints / 1e6} million points; this one states `
    + `${((card.counts.points ?? 0) / 1e6).toFixed(1)} million, ${kept}` };
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
 * D2. Beside the vector queue in the publishing transaction: a kept TIFF or LAS/LAZ plans its first part and admits
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
  // Over a reader limit, or refused by the reader's own source check, the item rests with words; nothing is queued.
  const refused = 'limit' in reader ? reader.limit : await sourceRefusalTx(client, item, reader.operation);
  if (refused || 'limit' in reader) {
    await writeIntakeLargeTx(client, item.case_id, item.item_id, { state: 'probed', placement: 'not_understood',
      planRef: null, partsPlanned: null, partsDone: 0, recordsSeen: 0, limitReason: refused });
    return true;
  }
  const { operation } = reader, plan: Plan = { version: INTAKE_SURFACE_VERSION, operation, header: null };
  await client.query('UPDATE usp_intake_items SET plan_ref=$2 WHERE item_id=$1', [item.item_id, plan]);
  await insertPartsTx(client, item.item_id, source, 0, [firstLocator(operation)]);
  await admitSurfaceItemTx(client, { ...item, plan_ref: plan });
  await settleSurfaceItemTx(client, item.item_id);
  return true;
}

const refusals = new Set(['RASTER_DENIED', 'RASTER_SOURCE_INTEGRITY', 'POINT_DENIED', 'POINT_SOURCE_INTEGRITY']);

/**
 * The reader's own source check, inside a savepoint so its refusal never fails the publishing transaction. Null
 * when the reader takes the kept original; otherwise the refusal in officer words, naming the reader's bound.
 */
async function sourceRefusalTx(client: PoolClient, item: { case_id: string; source_id: string },
  operation: Operation) {
  await client.query('SAVEPOINT intake_surface_source');
  try {
    await (operation === 'raster-window' ? rasterSourceTx : pointSourceTx)(client, item.case_id, item.source_id);
    await client.query('RELEASE SAVEPOINT intake_surface_source');
    return null;
  } catch (error) {
    if (!(error instanceof AppError) || !refusals.has(error.code)) throw error;
    await client.query('ROLLBACK TO SAVEPOINT intake_surface_source');
    const bound = (operation === 'raster-window' ? RASTER_WINDOW_LIMITS : POINT_BATCH_LIMITS).originalBytes;
    const stated = Number((await client.query(`SELECT inspection->'largeOriginal'->>'verifiedBytes' AS bytes
      FROM sources WHERE case_id=$1 AND id=$2`, [item.case_id, item.source_id])).rows[0]?.bytes);
    const reason = Number.isFinite(stated) && stated > bound
      ? `its kept receipt states ${mib(stated)}, over the reader's ${mib(bound)} bound`
      : error.code.endsWith('_SOURCE_INTEGRITY') ? 'its kept receipt differs from the stored original'
        : 'its kept receipt is not this batch\'s own';
    return `Kept. The ${operation === 'raster-window' ? 'raster' : 'point'} reader reads an original of at most `
      + `${mib(bound)} with this batch's own kept receipt; ${reason}, ${kept}`;
  }
}

/** Later parts wait while a vector may bind an area; the overview can be read now and again under that area. */
async function waitsForAreaTx(client: PoolClient, caseId: string) {
  return Boolean((await client.query(`SELECT 1 FROM cases c WHERE c.id=$1 AND c.site_id IS NULL AND EXISTS (
    SELECT 1 FROM usp_intake_items i WHERE i.case_id=c.id AND i.family='vector' AND i.placement='undecided'
      AND i.state IN ('received','probed','planned','reading','preparing'))`, [caseId])).rowCount);
}

/** A job read under another case context, access or reader than now: the pins the readers' stale check compares. */
const elsewhere = (at: number) => `(j.payload->>'caseContextSha256',j.payload->>'accessSha256',
  j.payload->>'readerSha256') IS DISTINCT FROM ($${at}::text,$${at + 1}::text,$${at + 2}::text)`;

/**
 * D4. The first part read again under a pin marks every part read elsewhere (or being read again), so the item's
 * words can count them; a later part of the same pin finds them marked.
 */
async function markRereadTx(client: PoolClient, item: Item, pin: string, now: string[]) {
  if (item.plan_ref.reread?.pin === pin) return;
  const marked = await client.query(`UPDATE usp_intake_parts p
    SET result_ref=p.result_ref||jsonb_build_object('rereadPin',$2::text),updated_at=now()
    WHERE p.item_id=$1 AND p.result_ref IS NOT NULL AND p.state<>'quarantined' AND (p.state<>'published'
      OR EXISTS (SELECT 1 FROM jobs j WHERE j.id=p.job_id AND ${elsewhere(3)}))`, [item.item_id, pin, ...now]);
  await client.query('UPDATE usp_intake_items SET plan_ref=$2 WHERE item_id=$1',
    [item.item_id, { ...item.plan_ref, reread: { pin, parts: marked.rowCount } }]);
}

/**
 * Admit the item's next part to its reader's existing job, inside the reader's caps: the lowest part that is planned,
 * or published from a job of another context (D1). The same source, part and context pin is the same job (D7). A
 * busy reader leaves the part as it is for the next tick; the earlier job and its read are kept (D2).
 * Returns whether admission changed a part or the visible item.
 */
async function admitSurfaceItemTx(client: PoolClient, item: Item): Promise<boolean> {
  const operation = item.plan_ref.operation;
  let partIndex: number | undefined;
  try {
    // The case and source authority is taken before the admission lock, in the publishing transaction's order.
    const ctx = operation === 'raster-window' ? await rasterSourceTx(client, item.case_id, item.source_id, true)
      : await pointSourceTx(client, item.case_id, item.source_id, true);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${operation}-admission-v1`]);
    const now = [ctx.context, ctx.binding.access, readers[operation]()];
    const part = (await client.query(`SELECT p.part_index,p.locator,p.result_ref FROM usp_intake_parts p
      LEFT JOIN jobs j ON j.id=p.job_id WHERE p.item_id=$1
      AND (p.state='planned' OR p.state='published' AND $2 AND ${elsewhere(3)})
      AND NOT EXISTS (SELECT 1 FROM usp_intake_parts q WHERE q.item_id=$1 AND q.state='queued')
      ORDER BY p.part_index LIMIT 1 FOR UPDATE OF p`, [item.item_id, ctx.latest, ...now])).rows[0];
    if (!part) return false;
    partIndex = part.part_index as number;
    if (partIndex !== 0 && await waitsForAreaTx(client, item.case_id)) return false;
    const { partKey: key, ...stored } = part.locator;
    const parsed = IntakeSurfaceLocatorSchema.safeParse(stored);
    if (!parsed.success || parsed.data.operation !== operation)
      throw new AppError(422, 'SURFACE_LOCATOR_INVALID', 'The stored part locator is invalid for its reader.');
    let locator = parsed.data;
    const header = item.plan_ref.header;
    // Legacy part 0 was a first window or batch, not an overview: its reread must cover that same old area.
    if (partIndex === 0 && header && !header.preview) locator = operation === 'raster-window'
      ? { operation, window: { x: 0, y: 0, width: Math.min(256, header.size[0]),
        height: Math.min(256, header.size[1]) } }
      : { operation, batch: { start: 0, count: Math.min(8192, header.size[0]) } };
    // Stored part keys keep their original reader; each new admission also pins the reader running now.
    const pin = fingerprint({ context: ctx.context, access: ctx.binding.access, readerSha256: now[2] });
    const jobId = stableUuid(`${INTAKE_SURFACE_VERSION}:${item.item_id}:${ctx.source.revision}:${key}:${pin}`);
    if (locator.operation === 'raster-window') await enqueueRasterWindowTx(client, ctx, locator.window, jobId);
    else await enqueuePointBatchTx(client, ctx, locator.batch, jobId);
    // The same pin names the same job; one that already ended is not queued again under that pin.
    const job = (await client.query('SELECT status,error FROM jobs WHERE id=$1', [jobId])).rows[0];
    if (['failed', 'stale'].includes(job?.status)) {
      await quarantineTx(client, item.item_id, partIndex, job.error);
      return true;
    }
    if (job?.status === 'succeeded') {
      await currentAgainTx(client, item, partIndex, jobId, pin, now);
      return true;
    }
    if (part.result_ref) await markRereadTx(client, item, pin, now);
    await client.query(`UPDATE usp_intake_parts SET state='queued',job_id=$3,updated_at=now()
      WHERE item_id=$1 AND part_index=$2`, [item.item_id, partIndex, jobId]);
    await settleSurfaceItemTx(client, item.item_id);
    return true;
  } catch (error) {
    // A busy reader leaves the part as it is; a refusal of the reader's own authority rests on the part.
    if (error instanceof AppError && error.code.endsWith('_WORKER_BUSY')) return false;
    if (error instanceof AppError && partIndex === undefined && refusals.has(error.code)) {
      // The kept original is refused by its reader after enrolment: no later part is offered to it again.
      await client.query(`UPDATE usp_intake_parts SET state='quarantined',issue_code=$2,updated_at=now()
        WHERE item_id=$1 AND state='planned'`, [item.item_id, error.code]);
      await settleSurfaceItemTx(client, item.item_id);
      return true;
    }
    if (!(error instanceof AppError) || error.status === 500 || partIndex === undefined) throw error;
    await quarantineTx(client, item.item_id, partIndex, error.code);
    return true;
  }
}

async function quarantineTx(client: PoolClient, itemId: string, partIndex: number, code: unknown) {
  const issue = typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(code) ? code : 'SURFACE_PART_FAILED';
  await client.query(`UPDATE usp_intake_parts SET state='quarantined',issue_code=$3,updated_at=now()
    WHERE item_id=$1 AND part_index=$2`, [itemId, partIndex, issue]);
  await settleSurfaceItemTx(client, itemId);
}

/**
 * The context came back to the pin of the part's accepted read before its read again ended: that read is current
 * again, and the parts still read elsewhere are counted again under this pin.
 */
async function currentAgainTx(client: PoolClient, item: Item, partIndex: number, jobId: string, pin: string,
  now: string[]) {
  await client.query(`UPDATE usp_intake_parts SET state='published',job_id=$3,result_ref=result_ref-'rereadPin',
    updated_at=now() WHERE item_id=$1 AND part_index=$2 AND result_ref->>'jobId'=$3::text`,
  [item.item_id, partIndex, jobId]);
  await markRereadTx(client, item, pin, now);
  await settleSurfaceItemTx(client, item.item_id);
}

type Due = { item_id: string; case_id: string; operation: Operation; planned: boolean; pins: string[][] | null;
  case_now: [unknown, unknown, string | null, boolean]; moved?: boolean; unbound?: boolean; far?: boolean };

/** D1. A published part's job pins another case context, access or reader than the case has now (the readers' pins). */
function readElsewhere(row: Due) {
  const [frame, context, siteId, archived] = row.case_now;
  if (archived || !row.pins) return false;
  const now = [fingerprint({ frame, context, siteId }), ingestionBinding(row.case_id).access, readers[row.operation]()];
  return row.pins.some(pin => pin.some((value, n) => value !== now[n]));
}

/** A failed admission is deferred, not attributed to a reader that may never have received the part. */
const admissionWords = (code: string) => `Admission deferred (${code}); the original and any earlier reads are kept. `
  + 'A later tick will check this item again.';

/** Private scheduling only: a stalled attempt must not invalidate the officer's public updatedAt. */
const touchAdmissionTx = (client: PoolClient, itemId: string) => client.query(
  `UPDATE usp_intake_items SET plan_ref=jsonb_set(plan_ref,'{admissionTriedAt}',
    to_jsonb(to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))
    WHERE item_id=$1`, [itemId]);

/** Record visible words outside the rolled-back admission, then yield its place in the next page. */
async function recordAdmissionIssueTx(client: PoolClient, itemId: string, code: string, sqlState?: string) {
  const item = (await client.query('SELECT * FROM usp_intake_items WHERE item_id=$1 FOR UPDATE', [itemId])).rows[0];
  if (item?.plan_ref?.version !== INTAKE_SURFACE_VERSION) return;
  const { admissionSqlState: _previous, ...plan } = item.plan_ref;
  await writeIntakeLargeTx(client, item.case_id, itemId, { state: item.state, placement: item.placement,
    planRef: { ...plan, admissionIssue: code, ...(sqlState ? { admissionSqlState: sqlState } : {}) },
    partsPlanned: item.parts_planned, partsDone: item.parts_done,
    recordsSeen: Number(item.records_seen), limitReason: admissionWords(code) });
  await touchAdmissionTx(client, itemId);
}

/** Publication holds case SHARE: never upgrade it behind source/job/item locks. The tick starts a separate,
 * case-first transaction for the first accepted footprint, then the normal context reread keeps its old receipt. */
async function createSurfaceAreaTx(client: PoolClient, row: Due) {
  const part = (await client.query(`SELECT i.plan_ref->'header'->>'authority' authority,
      p.result_ref->'sourceCorners' corners FROM usp_intake_items i
    JOIN usp_intake_parts p ON p.item_id=i.item_id WHERE i.item_id=$1 AND p.state='published'
      AND jsonb_typeof(p.result_ref->'sourceCorners')='array' ORDER BY p.part_index LIMIT 1`,
  [row.item_id])).rows[0];
  if (!part?.authority || !part.corners?.length) return false;
  return sourcePartDestinationTx(client, row.case_id, part.authority, part.corners);
}

/**
 * S9.4d. A source whose read parts meet none of its batch's areas gets one map area of its own, from its first read
 * part's corners, recorded in its plan as ownAreaId; never a second one. The case lock comes first (S5.49) and
 * serialises two ticks; the item is not locked ahead of its source, and the plan gains only its ownAreaId.
 */
async function createOwnAreaTx(client: PoolClient, row: Due) {
  if ((await caseAreasTx(client, row.case_id)).length >= INTAKE_AREA_LIMIT) return false;
  const current = (await client.query('SELECT site_id,archived FROM cases WHERE id=$1 FOR UPDATE',
    [row.case_id])).rows[0];
  if (!current?.site_id || current.archived) return false;
  const item = (await client.query('SELECT name,plan_ref FROM usp_intake_items WHERE item_id=$1',
    [row.item_id])).rows[0];
  const plan: Plan | undefined = item?.plan_ref;
  if (plan?.version !== INTAKE_SURFACE_VERSION || !plan.header?.crsStated || !plan.header.authority
    || plan.ownAreaId) return false;
  const parts = (await client.query(`SELECT state,result_ref FROM usp_intake_parts WHERE item_id=$1
    ORDER BY part_index`, [row.item_id])).rows;
  const corners = parts.find(part => part.state === 'published' && part.result_ref?.sourceCorners?.length)
    ?.result_ref.sourceCorners;
  const areas = await caseAreasTx(client, row.case_id);
  if (!corners || areas.length >= INTAKE_AREA_LIMIT) return false;
  if ((await itemPlacementTx(client, row.case_id, plan, parts, areas)).placement === 'on_map') return false;
  const areaId = await sourcePartOwnAreaTx(client, item.name, plan.header.authority, corners);
  if (!areaId) return false;
  await client.query(`UPDATE usp_intake_items SET plan_ref=plan_ref||jsonb_build_object('ownAreaId',$2::text)
    WHERE item_id=$1`, [row.item_id, areaId]);
  return true;
}

/** One item's rollback or failed issue recording must never end the remaining items' admissions. */
async function admitDueSurface(row: Due) {
  try {
    await transaction(async client => {
      if ((row.unbound && await createSurfaceAreaTx(client, row)) || (row.far && await createOwnAreaTx(client, row))) {
        await settleSurfaceItemTx(client, row.item_id);
        return;
      }
      const item = (await client.query('SELECT * FROM usp_intake_items WHERE item_id=$1', [row.item_id])).rows[0];
      if (item?.plan_ref?.version !== INTAKE_SURFACE_VERSION) return;
      const hadIssue = Boolean(item.plan_ref.admissionIssue);
      const progressed = (row.planned || readElsewhere(row)) && await admitSurfaceItemTx(client, item);
      // Clear only after admission has taken source authority; never lock the item ahead of the source.
      if (hadIssue) await client.query(`UPDATE usp_intake_items
        SET plan_ref=plan_ref-'admissionIssue'-'admissionSqlState' WHERE item_id=$1`, [row.item_id]);
      if (row.moved || hadIssue) await settleSurfaceItemTx(client, row.item_id);
      if (!progressed && !row.moved && !hadIssue) await touchAdmissionTx(client, row.item_id);
    });
  } catch (error) {
    const code = error instanceof AppError && /^[A-Z][A-Z0-9_]{0,127}$/.test(error.code)
      ? error.code : 'SURFACE_ADMISSION_FAILED';
    const state = !(error instanceof AppError) && error !== null && typeof error === 'object'
      && 'code' in error ? error.code : undefined;
    const sqlState = typeof state === 'string' && state.length === 5 && /^[A-Za-z0-9]+$/.test(state)
      ? state : undefined;
    try { await transaction(client => recordAdmissionIssueTx(client, row.item_id, code, sqlState)); }
    catch {
      // No exception text: it can include source content. The original transaction has already rolled back.
      console.warn(`Surface admission issue ${code} for item ${row.item_id} could not be recorded; check deferred.`);
    }
  }
}

/** Keep a malformed stored item's pin check inside its own admission error boundary. */
function surfaceDue(row: Due) {
  try { return row.planned || row.moved || row.unbound || row.far || readElsewhere(row); }
  catch { return true; }
}

/**
 * One dispatcher tick: each kept surface with none queued and a part to read, least recently tried first. A part to
 * read is planned, or published from a job of another context; the item's transaction checks that again. SF1 D2: an
 * item read under its area whose extent or drafted footprints moved since it was settled is settled again, so its
 * words and placement follow; no part is read again for it and every earlier read is kept.
 */
export async function admitIntakeSurfaceParts() {
  const rows = (await query<Due>(`SELECT i.item_id,i.case_id,i.plan_ref->>'operation' AS operation,
      EXISTS (SELECT 1 FROM usp_intake_parts p WHERE p.item_id=i.item_id AND p.state='planned') AS planned,
      (SELECT jsonb_build_array(c.frame,c.context,c.site_id,c.archived) FROM cases c WHERE c.id=i.case_id) AS case_now,
      (SELECT jsonb_agg(DISTINCT jsonb_build_array(j.payload->>'caseContextSha256',j.payload->>'accessSha256',
        j.payload->>'readerSha256')) FROM usp_intake_parts p JOIN jobs j ON j.id=p.job_id
        WHERE p.item_id=i.item_id AND p.state='published') AS pins,
      i.plan_ref->'header'->>'crsStated'='true' AND i.plan_ref->'header'->>'authority' IS NOT NULL
        AND EXISTS (SELECT 1 FROM cases c WHERE c.id=i.case_id AND c.site_id IS NULL
          AND NOT c.archived AND c.frame->>'id'='UNASSIGNED')
        AND EXISTS (SELECT 1 FROM usp_intake_parts p WHERE p.item_id=i.item_id AND p.state='published'
          AND jsonb_typeof(p.result_ref->'sourceCorners')='array') AS unbound,
      i.plan_ref->'header'->>'crsStated'='true' AND i.plan_ref->'header'->>'authority' IS NOT NULL
        AND NOT i.plan_ref ? 'ownAreaId' AND i.placement='not_understood'
        AND EXISTS (SELECT 1 FROM cases c WHERE c.id=i.case_id AND c.site_id IS NOT NULL AND NOT c.archived)
        AND EXISTS (SELECT 1 FROM usp_intake_parts p WHERE p.item_id=i.item_id AND p.state='published'
          AND jsonb_typeof(p.result_ref->'sourceCorners')='array') AS far,
      jsonb_typeof(i.plan_ref->'header')='object' AND i.plan_ref->>'placedOn' IS DISTINCT FROM
        (SELECT string_agg(k.key,',' ORDER BY k.created_at,k.id)
          FROM (${caseAreas('i.case_id', `${areaKey} AS key,a.created_at,a.id`)}) k) AS moved
    FROM usp_intake_items i
    WHERE i.plan_ref->>'version'=$1 AND NOT EXISTS (SELECT 1 FROM usp_intake_parts p WHERE p.item_id=i.item_id
      AND p.state='queued')
    ORDER BY i.plan_ref->>'admissionTriedAt' NULLS FIRST,i.item_id`,
  [INTAKE_SURFACE_VERSION])).rows;
  const items = rows.filter(surfaceDue).slice(0, INTAKE_SURFACE_LIMITS.page);
  for (const row of items) await admitDueSurface(row);
}

function rasterPlan(result: RasterWindowResult) {
  const { sourceWidth: width, sourceHeight: height } = result.metadata, side = INTAKE_SURFACE_LIMITS.windowSide;
  let step = 1;
  while (Math.ceil(Math.max(width, height) / step) > INTAKE_SURFACE_LIMITS.previewSide) step *= 2;
  const windows: IntakeSurfaceLocator[] = [];
  for (let y = 0; y < height; y += side * step) for (let x = 0; x < width; x += side * step) windows.push({
    operation: 'raster-window', window: { x, y, width: Math.min(side, Math.ceil((width - x) / step)),
      height: Math.min(side, Math.ceil((height - y) / step)), step } });
  return windows;
}

function pointPlan(result: PointBatchResult) {
  const total = result.metadata.sourcePointCount, side = INTAKE_SURFACE_LIMITS.batchPoints;
  const step = Math.max(1, Math.ceil(total / (side * INTAKE_SURFACE_LIMITS.previewParts)));
  const batches: IntakeSurfaceLocator[] = [];
  for (let start = 0; start < total; start += side * step) batches.push({ operation: 'point-batch',
    batch: { start, count: Math.min(side, Math.ceil((total - start) / step)), step } });
  return batches;
}

/** Preview parts after the whole-extent part 0, from its accepted source size; also used by the real-input test. */
export function surfacePlan(result: { operation: 'raster-window'; value: RasterWindowResult }
  | { operation: 'point-batch'; value: PointBatchResult }) {
  return result.operation === 'raster-window' ? rasterPlan(result.value) : pointPlan(result.value);
}

/** Native LAS formats share int32 X and Y at bytes 0 and 4; the accepted metadata supplies their stride. */
export function pointRecordsExtent(records: Uint8Array, scale: number[], offset: number[], recordLength = 30) {
  const view = new DataView(records.buffer, records.byteOffset, records.byteLength);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let at = 0; at + recordLength <= records.byteLength; at += recordLength) {
    const x = view.getInt32(at, true) * scale[0] + offset[0], y = view.getInt32(at + 4, true) * scale[1] + offset[1];
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

type Accepted = { jobId: string; resultSha256: string }
  & ({ operation: 'raster-window'; value: RasterWindowResult }
    | { operation: 'point-batch'; value: PointBatchResult; extent: number[] | null });

/** One display range from the first accepted metadata, never from this server's sampled pixels or records. */
function acceptedValueRange(accepted: Accepted): IntakeSurfaceDisplay['valueRange'] {
  if (accepted.operation === 'raster-window') {
    const m = accepted.value.metadata, band = m.bands?.[0];
    if (m.sourceBands === 1 && band?.validMin != null && band.validMax != null)
      return { kind: 'band', low: band.validMin, high: band.validMax,
        basis: 'First accepted overview band valid min and max.' };
    return undefined;
  }
  const m = accepted.value.metadata, scale = m.scale?.[2], offset = m.offset?.[2];
  if (!scale || offset == null || !m.sourceBounds) return undefined;
  const bounds = [m.sourceBounds[2], m.sourceBounds[5]].map(z => Math.round((z - offset) / scale));
  if (!bounds.every(Number.isFinite)) return undefined;
  return { kind: 'z', low: Math.min(...bounds), high: Math.max(...bounds),
    basis: 'LAS header Z bounds converted to raw record integers using the header Z scale and offset.' };
}

function acceptedHeader(accepted: Accepted, planned: number, step: number): Header {
  const m = accepted.value.metadata;
  const vertical = { status: m.verticalReferenceStatus, name: m.verticalReference };
  const preview = { step }, total = planned, valueRange = acceptedValueRange(accepted);
  if (accepted.operation === 'raster-window') {
    const r = accepted.value.metadata;
    return { operation: 'raster-window', crsStated: Boolean(r.sourceCrsWkt), authority: r.sourceCrsAuthority,
      vertical, size: [r.sourceWidth, r.sourceHeight, r.sourceBands], planned, total, preview, valueRange };
  }
  const p = accepted.value.metadata;
  return { operation: 'point-batch', crsStated: Boolean(p.crsWkt), authority: p.horizontalAuthority, vertical,
    size: [p.sourcePointCount], planned, total, preview, valueRange };
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
  // D2. A part read again names the jobs of its earlier reads; those jobs, results and artifacts are kept.
  const earlier = part.result_ref ? [part.result_ref.jobId, ...part.result_ref.earlier ?? []] : [];
  await client.query(`UPDATE usp_intake_parts SET state='published',counts=$3,result_ref=$4,updated_at=now()
    WHERE item_id=$1 AND part_index=$2`, [part.item_id, part.part_index, counts,
    earlier.length ? { ...result, earlier } : result]);
  const plan: Plan = part.plan_ref;
  if (!plan.header) {
    const all = accepted.operation === 'raster-window' ? rasterPlan(accepted.value) : pointPlan(accepted.value);
    const preview = all.slice(0, INTAKE_SURFACE_LIMITS.previewParts), first = preview[0];
    const step = (first.operation === 'raster-window' ? first.window?.step : first.batch?.step)!;
    const source = { sha256: accepted.value.input.sourceSha256 };
    await insertPartsTx(client, part.item_id, source, 1, preview);
    await client.query('UPDATE usp_intake_items SET plan_ref=$2 WHERE item_id=$1',
      [part.item_id, { ...plan, header: acceptedHeader(accepted, 1 + preview.length, step) }]);
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

/** The batch area as stored, the bounds of the batch's own drafted footprints, and the key of both (SF1). */
type Area = { id: string; revision: number; reference: any; extent: number[] | null; drafted: number[] | null;
  key: string };
type NotPlaced = { state: 'not_placed'; reason: 'no_batch_area' | 'no_area_reference' | 'no_area_extent'
  | 'no_stated_crs' | 'transform_unavailable' | 'outside_area'; words: string };
/** The extent a part is placed against, and whether the batch's drafted footprints gave or widened it. */
type Frame = { area: Area; extent: number[]; drafted: boolean; from: number; to: number };

const notPlaced = (reason: NotPlaced['reason'], words: string): NotPlaced => ({ state: 'not_placed', reason, words });
const outside = 'Read, outside this area: its corners do not meet the batch area\'s extent.';
const older = 'This part was read under an older batch context, so it is not shown as current.';

/**
 * SF1 D1. The bounds of the batch's drafted footprint packages in its area, in the area's local frame: the
 * package extent the recording step merges into the area's extent (areas.ts commitPackage). Recorded packages are
 * already in that extent; source workspaces and packages with no accepted geometry give none. A package's
 * reconstruction case may differ from the intake case: follow its item/part link, as the target listing does.
 * Partial quarantine keeps the accepted features' bounds. No package gives null, never a zero box.
 */
const draftedBounds = `LEFT JOIN LATERAL (SELECT CASE WHEN count(*)>0 THEN jsonb_build_array(
    min((p.body->'extent'->>0)::float8),min((p.body->'extent'->>1)::float8),
    max((p.body->'extent'->>2)::float8),max((p.body->'extent'->>3)::float8)) END AS extent
  FROM import_packages p WHERE p.area_id=a.id AND p.state<>'COMMITTED' AND EXISTS (
    SELECT 1 FROM usp_intake_items anchor WHERE anchor.case_id=c.id AND (
      anchor.plan_ref->>'packageId'=p.id::text OR EXISTS (
        SELECT 1 FROM usp_intake_parts part WHERE part.item_id=anchor.item_id
          AND part.state='published' AND part.result_ref->>'packageId'=p.id::text)))
    AND NOT p.body ? 'sourceWorkspace'
    AND (NOT p.body ? 'quarantine' OR (p.body->'quarantine'->>'accepted')::integer>0)
    AND CASE WHEN jsonb_typeof(p.body->'extent')='array' THEN jsonb_array_length(p.body->'extent')=4
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p.body->'extent') v WHERE jsonb_typeof(v)<>'number')
      ELSE false END) d ON true`;
/** SF1 D2. What an item's placement was settled against: the dispatcher tick compares it in the same words. */
const areaKey = 'md5(jsonb_build_array(a.id,a.reference,a.extent,d.extent)::text)';
/** S9.4d. A batch has at most this many areas: its site's area and the own areas of its far sources. */
const INTAKE_AREA_LIMIT = 16;
/** The areas a batch's parts may be placed in, oldest first: its site's area, then those its far sources made. */
const caseAreas = (caseRef: string, columns: string) => `SELECT ${columns} FROM cases c JOIN map_areas a
    ON a.site_id=c.site_id OR a.id::text IN (SELECT o.plan_ref->>'ownAreaId' FROM usp_intake_items o
      WHERE o.case_id=c.id AND o.plan_ref ? 'ownAreaId')
  ${draftedBounds} WHERE c.id=${caseRef} ORDER BY a.created_at,a.id LIMIT ${INTAKE_AREA_LIMIT}`;

async function caseAreasTx(client: PoolClient, caseId: string) {
  return (await client.query(caseAreas('$1', `a.id,a.revision,a.reference,a.extent,d.extent AS drafted,${areaKey}
    AS key`), [caseId])).rows as Area[];
}

const within = (inner: number[], outer: number[]) => inner[0] >= outer[0] && inner[1] >= outer[1]
  && inner[2] <= outer[2] && inner[3] <= outer[3];

/**
 * The batch area's local frame for a stated source CRS, or why a part read in it is not placed. The extent is the
 * area's recorded one, widened by the batch's drafted footprints (SF1 D1); with neither, today's words (D3).
 */
async function frameTx(client: PoolClient, header: Pick<Header, 'authority' | 'crsStated'>,
  area: Area | null): Promise<Frame | NotPlaced> {
  if (!header.crsStated) return notPlaced('no_stated_crs',
    'Read but not placed: the file states no coordinate system.');
  const authority = header.authority;
  if (!authority) return notPlaced('transform_unavailable',
    'Read but not placed: the stated coordinate system does not resolve to an EPSG reference.');
  if (!area) {
    const from = Number(/^EPSG:(\d+)$/.exec(authority)?.[1]);
    const known = from > 0 && (await client.query(`SELECT 1 FROM spatial_ref_sys
      WHERE auth_name='EPSG' AND auth_srid=$1`, [from])).rowCount;
    if (!known) return notPlaced('transform_unavailable',
      `Read but not placed: the stated coordinate system ${authority} does not resolve to an EPSG reference.`);
    return notPlaced('no_batch_area', 'Read but not placed: the batch has no map area yet.');
  }
  if (!area.reference) return notPlaced('no_area_reference',
    'Read but not placed: the batch area has no reference system yet.');
  const { extent: recorded, drafted } = area;
  if (!recorded && !drafted) return notPlaced('no_area_extent',
    'Read but not placed: the batch area has no extent yet.');
  const extent = recorded && drafted ? [Math.min(recorded[0], drafted[0]), Math.min(recorded[1], drafted[1]),
    Math.max(recorded[2], drafted[2]), Math.max(recorded[3], drafted[3])] : (recorded ?? drafted)!;
  const [from, to] = [authority, area.reference.analysisCrs].map(code => Number(/^EPSG:(\d+)$/.exec(code)?.[1]));
  const known = from > 0 && to > 0 && Number((await client.query(`SELECT count(DISTINCT auth_srid)::int n
    FROM spatial_ref_sys WHERE auth_name='EPSG' AND auth_srid IN ($1,$2)`, [from, to])).rows[0].n)
    === new Set([from, to]).size;
  if (!known) return notPlaced('transform_unavailable',
    `Read but not placed: no transform from ${authority} to the batch reference is available.`);
  return { area, extent: extent.map(Number), drafted: Boolean(drafted && (!recorded || !within(drafted, recorded))),
    from, to };
}

/**
 * One statement for the display read and the tray: each part's source corners transformed into the area's analysis
 * CRS minus its origin, and whether that part's extent meets the area's local extent.
 */
async function localPartsTx(client: PoolClient, frame: Frame, parts: number[][][]) {
  const flat = parts.flatMap((corners, part) => corners.map(([x, y]) => [x, y, part]));
  const [ox, oy] = frame.area.reference.origin, [x0, y0, x1, y1] = frame.extent;
  const rows = (await client.query(`SELECT c.part,array_agg(ST_X(t.p) ORDER BY c.n) xs,
      array_agg(ST_Y(t.p) ORDER BY c.n) ys,ST_Intersects(ST_SetSRID(ST_Envelope(ST_Collect(t.p)),0),
      ST_MakeEnvelope($8,$9,$10,$11,0)) meets
    FROM unnest($1::float8[],$2::float8[],$3::int[]) WITH ORDINALITY c(x,y,part,n),
      LATERAL (SELECT ST_Translate(ST_Transform(ST_SetSRID(ST_MakePoint(c.x,c.y),$4),$5::integer),
        -($6::float8),-($7::float8)) p) t
    GROUP BY c.part ORDER BY c.part`,
  [flat.map(c => c[0]), flat.map(c => c[1]), flat.map(c => c[2]), frame.from, frame.to, ox, oy, x0, y0, x1, y1]))
    .rows;
  return rows.map(row => ({ corners: (row.xs as number[]).map((x, n) => [Number(x), Number(row.ys[n])]),
    meets: row.meets === true }));
}

function surfaceWords(header: Header | null, state: string, done: number, failed: string | null, where: string,
  again: string) {
  if (failed === 'SURFACE_LOCATOR_INVALID') return 'A part was not sent to its reader because its stored locator '
    + `is invalid (${failed}); the original and any earlier reads are kept.`;
  if (failed) return `A part could not be read (${failed}); the original is kept with its SHA-256.`;
  if (!header) return `The first part ${state === 'reading' ? 'is being read' : 'waits for its reader'}; `
    + 'its coordinate system and size are not read yet.';
  const raster = header.operation === 'raster-window';
  const what = raster ? `${header.size[0]} × ${header.size[1]} pixels, ${header.size[2]} band`
    + `${header.size[2] === 1 ? '' : 's'}` : `${header.size[0]} points`;
  const parts = `Read ${done} of ${header.planned} ${raster ? 'windows' : 'batches'} (${what}`
    + `${header.authority ? `, ${header.authority}` : ''}).`;
  let preview = '';
  if (header.preview) {
    const step = header.preview.step;
    const suffix = step % 100 >= 11 && step % 100 <= 13 ? 'th'
      : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[step % 10] ?? 'th';
    preview = raster ? ` A preview at 1:${step}${step === 1 ? ' (full resolution)' : ''}.`
      : ` A preview taking every ${step}${suffix} point.`;
  }
  const limit = header.total > header.planned ? ` The reader takes at most ${header.planned} parts of one original, `
    + `so ${header.total - header.planned} are not read.` : '';
  const vertical = header.vertical.status === 'known' ? ` Vertical reference stated: ${header.vertical.name}.`
    : ' The file states no vertical reference.';
  return `${again ? `${again} ` : ''}${parts}${preview}${limit}${where ? ` ${where}` : ''}${vertical}`
    + ' Display only: no height, measurement or record is taken from it.';
}

/**
 * The item is on the map only when a part read so far meets the extent of its own area (S9.4d), else of the first
 * of its batch's areas it meets; otherwise its words say why it is not placed against the batch area, or that it is
 * read outside this area.
 */
async function itemPlacementTx(client: PoolClient, caseId: string, plan: Plan, parts: any[], areas: Area[]) {
  const header = plan.header;
  if (!header) return { placement: 'undecided' as const, where: '', areaId: null };
  const read = parts.filter(part => part.state === 'published' && part.result_ref?.sourceCorners)
    .map(part => part.result_ref.sourceCorners as number[][]);
  const own = areas.find(area => area.id === plan.ownAreaId);
  const tried = own ? [own] : areas;
  const first = await frameTx(client, header, tried[0] ?? null);
  for (const [n, area] of tried.entries()) {
    const frame = n ? await frameTx(client, header, area) : first;
    if ('reason' in frame || !read.length || !(await localPartsTx(client, frame, read)).some(part => part.meets))
      continue;
    return { placement: 'on_map' as const, where: placedWords(frame, own, n), areaId: frame.area.id };
  }
  if ('reason' in first) return { where: first.words, areaId: null,
    placement: ['no_stated_crs', 'transform_unavailable'].includes(first.reason) ? 'not_understood' as const
      : 'waiting_for_anchor' as const };
  if (!read.length) return { placement: 'waiting_for_anchor' as const, areaId: null,
    where: 'Read but not placed: no part read so far has records to place.' };
  return { placement: 'not_understood' as const, where: outside, areaId: null };
}

/** S9.4d. Where a placed item is: its own area, another far file's area, or the batch area as SF1 words it. */
function placedWords(frame: Frame, own: Area | undefined, n: number) {
  if (own) return 'Placed in its own map area, far from the batch area.';
  if (n) return 'Placed in the map area of another far file of this batch.';
  return frame.drafted ? draftedWords(frame) : '';
}

/** SF1 D1. Where the extent came from, when the batch's drafted footprints gave or widened it. */
const draftedWords = (frame: Frame) => frame.area.extent
  ? 'Placed against the area\'s recorded extent, widened by this batch\'s drafted footprints.'
  : 'Placed against the extent of this batch\'s drafted footprints; the area has no recorded extent yet.';

/** The item's tray state, placement and words follow its part rows; an unchanged state publishes nothing. */
export async function settleSurfaceItemTx(client: PoolClient, itemId: string) {
  const item = (await client.query('SELECT case_id,plan_ref FROM usp_intake_items WHERE item_id=$1 FOR UPDATE',
    [itemId])).rows[0] ?? notFound('Intake item not found.');
  const parts = (await client.query(`SELECT state,counts,issue_code,result_ref FROM usp_intake_parts
    WHERE item_id=$1 ORDER BY part_index`, [itemId])).rows;
  const plan: Plan = item.plan_ref, header = plan.header;
  const done = parts.filter(part => part.state === 'published').length;
  const failed = parts.find(part => part.state === 'quarantined')?.issue_code ?? null;
  // D4. The parts marked under the current re-read pin and not read again yet.
  const reread = plan.reread, pending = reread ? parts.filter(part => part.state !== 'quarantined'
    && part.result_ref?.rereadPin === reread.pin).length : 0;
  const again = reread && pending ? `Read again under the batch's area: ${reread.parts - pending} of ${reread.parts} `
    + 'parts.' : '';
  // SF1 D2. The areas the placement is settled against are kept in the plan; a tick re-settles when one moves.
  const areas = header ? await caseAreasTx(client, item.case_id) : [];
  const { placement, where, areaId } = await itemPlacementTx(client, item.case_id, plan, parts, areas);
  const planRef = header ? { ...item.plan_ref, placedArea: areaId,
    placedOn: areas.length ? areas.map(area => area.key).join(',') : null } : item.plan_ref;
  const state = failed ? 'failed_part' : header && done === parts.length && !pending
    ? (header.total > header.planned ? 'read_to_limit' : 'read')
    : done > 0 || parts.some(part => part.state === 'queued') ? 'reading' : 'planned';
  const recordsSeen = parts.reduce((sum, part) => sum + Number(part.counts?.points ?? 0), 0);
  await writeIntakeLargeTx(client, item.case_id, itemId, { state, placement, planRef,
    partsPlanned: header?.planned ?? null, partsDone: done, recordsSeen,
    limitReason: plan.admissionIssue ? admissionWords(plan.admissionIssue)
      : surfaceWords(header, state, done, failed, where, again) });
}

const partSelect = `SELECT p.*,i.source_id,i.plan_ref FROM usp_intake_parts p
  JOIN usp_intake_items i ON i.item_id=p.item_id WHERE i.case_id=$1 AND p.item_id=$2`;

function partOf(row: any) {
  const { partKey: key, ...locator } = row.locator;
  return { partIndex: row.part_index, state: row.state === 'running' ? 'queued' : row.state,
    locator: IntakeSurfaceLocatorSchema.parse(locator), partKey: key, jobId: row.job_id,
    resultSha256: row.state === 'published' ? row.result_ref?.resultSha256 ?? null : null, issueCode: row.issue_code };
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

/** A part's placement for its display read, in the area its item is placed in; exported for the placement test. */
export async function surfacePartPlacementTx(client: PoolClient, caseId: string, header: Header,
  corners: number[][], areaId: string | null = null) {
  const areas = await caseAreasTx(client, caseId);
  const frame = await frameTx(client, header, areas.find(area => area.id === areaId) ?? areas[0] ?? null);
  if ('reason' in frame) return frame;
  const [part] = await localPartsTx(client, frame, [corners]);
  if (!part?.meets) return notPlaced('outside_area', outside);
  return { state: 'placed', areaId: frame.area.id, areaRevision: Number(frame.area.revision),
    analysisCrs: frame.area.reference.analysisCrs, origin: frame.area.reference.origin,
    operation: `postgis:ST_Transform(${header.authority}->${frame.area.reference.analysisCrs}) minus area origin`
      + (frame.drafted ? '; area extent from the batch\'s drafted footprints' : ''),
    corners: part.corners } as const;
}

/**
 * D5. A published part's display read: its corners in the batch's local frame and the accepted artifact. The
 * reader's accepted fence is checked again; a part read under an older context is refused, never shown as current.
 */
export async function surfacePartDisplayTx(client: PoolClient, caseId: string, itemId: string, partIndex: number) {
  const row = (await client.query(`${partSelect} AND p.part_index=$3`, [caseId, itemId, partIndex])).rows[0]
    ?? notFound('Intake part not found.');
  const plan: Plan = row.plan_ref;
  // D2. A part being read again keeps the words of a part read under an older context.
  if (row.state !== 'published' && row.result_ref) conflict(older);
  if (plan?.version !== INTAKE_SURFACE_VERSION || row.state !== 'published' || !plan.header)
    throw new AppError(409, 'INTAKE_PART_NOT_READ', 'This part has no accepted read yet.');
  const capture = plan.operation === 'raster-window' ? rasterWindowCaptureTx : pointBatchCaptureTx;
  const { ctx, job, stale } = await capture(client, caseId, row.source_id, row.job_id);
  if (stale || job.status !== 'succeeded' || job.result_ref?.sha256 !== row.result_ref.resultSha256) conflict(older);
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
    verticalReference: plan.header.vertical, valueRange: plan.header.valueRange, sourceCorners: corners,
    placement: await surfacePartPlacementTx(client, caseId, plan.header, corners,
      plan.ownAreaId ?? plan.placedArea ?? null), use: 'display_only' });
}
