import type { PoolClient } from 'pg';
import { z } from 'zod';
import { STREAMING_VECTOR_LIMITS, type IntakeCard } from '@ulpin/contracts/usp';
import { conflict, notFound } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { lockSourceCaseDestinationTx } from '../../cases/source-case-lock';
import { intakeCaseTx, intakeSourceTx, intakeSourcePin, type IntakeSourceRow } from './intake-context';
import { writeIntakeDraftTx, writeIntakeLargeTx } from './intake-ledger';
import { intakeLargeFailureReason, queueIntakeLargeTx } from './intake-large';
import { stableUuid } from './intake-run';

const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const IntakeDraftInputSchema = z.strictObject({
  version: z.literal('intake-draft/1'), jobId: uuid, itemId: uuid, caseId: uuid,
  caseRevision: z.number().int().nonnegative(), sourceId: uuid, sourceRevision: z.number().int().positive(),
  sourceSha256: hash, sourcePin: hash, recipeRevision: z.number().int().nonnegative(),
  subject: z.string().min(1).max(256), accessSha256: hash,
});
export type IntakeDraftInput = z.infer<typeof IntakeDraftInputSchema>;
export type DraftItem = {
  item_id: string; case_id: string; source_id: string; parent_item_id: string | null;
  state: string; family: string; card: IntakeCard | null; plan_ref: Record<string, any> | null;
};

/** Stable keys distinguish each recipe phase, while replay sends exactly the same UUID. */
export function intakeDraftKey(itemId: string, revision: number, phase: string): string {
  return stableUuid(`intake-draft/1:${itemId}:${revision}:${phase}`);
}

const shapefileZip = (card: IntakeCard | null) =>
  card?.format === 'zip' && card.members.some(member => member.format === 'shapefile');

/** Names entries within `budget` characters (limit_reason holds 2000); the rest are counted, never cut. */
function listWords(entries: string[], budget: number): string {
  let shown = 0;
  for (let used = 0; shown < entries.length && used + entries[shown].length + 2 <= budget; shown++) {
    used += entries[shown].length + 2;
  }
  const rest = entries.length - shown;
  if (!rest) return entries.join(', ');
  return shown ? `${entries.slice(0, shown).join(', ')} and ${rest} more` : `${rest} with long paths`;
}

/**
 * ZF2. A ZIP's own item asks nothing: its words, from its card alone, say which members became their own files.
 * A layer is what `zipLayerMembers` keeps: a GeoJSON member the probe read without refusal.
 */
function zipParentWords(card: IntakeCard): string {
  const members = card.members.filter(member => !member.name.endsWith('/'));
  const layers = members.filter(member => member.format === 'geojson' && !member.refusalCode)
    .map(member => member.name);
  const others = members.filter(member => member.format !== 'geojson' || member.refusalCode)
    .map(member => `${member.name} (${member.refusalCode ?? 'not a map layer'})`);
  if (!layers.length) return 'This ZIP holds no map layer this batch can take in. '
    + (others.length ? `Its members: ${listWords(others, 1800)}.` : 'No member of it could be listed.');
  const taken = layers.length === 1 ? '1 map layer in this ZIP is taken in as its own file'
    : `${layers.length} map layers in this ZIP are taken in as their own files`;
  return `${taken}: ${listWords(layers, 800)}.` + (others.length ? ` Not taken in: ${listWords(others, 900)}.` : '');
}

/** A refusal is tray metadata, not permission to use a different reader or split an original. */
export function intakeDraftLimit(item: DraftItem, source: IntakeSourceRow): string | null {
  const format = item.card?.format;
  const count = source.inspection?.manualProfile?.featureCount;
  if (format === 'geopackage' || format === 'gpkg')
    return 'This GeoPackage can be imported through POST /api/v1/import-packages with format=gpkg '
      + 'and one selected layer within 16 MiB and 2000 features; intake recipe drafting and '
      + 'decoded binary-record citations for its card are not built.';
  if (format === 'shapefile' || format === 'shapefile_zip' || shapefileZip(item.card))
    return 'This shapefile needs its matching .shp/.shx/.dbf/.prj set in a ZIP for '
      + 'POST /api/v1/import-packages with format=shapefile_zip and one selected set within 16 MiB '
      + 'and 2000 features; intake recipe drafting and decoded binary-record citations for its card are not built.';
  if (item.card?.format === 'zip') return zipParentWords(item.card);
  if (format === 'kml' || format === 'kmz')
    return 'This KML/KMZ has a native-inspection route at POST /api/v1/ingestion/cases/:caseId/kml '
      + 'within 16 MiB; no area-import adapter or intake recipe drafts its map package or card.';
  if (Number(source.bytes) > 16 * 1024 * 1024) {
    if (format === 'geojson' || source.profile === 'geojson-manual-v1')
      return `This GeoJSON original has ${Number(source.bytes)} bytes, above the 16777216-byte intake drafting `
        + 'and POST /api/v1/import-packages bound; /api/v1/ingestion/cases/:caseId/uploads can retain it, '
        + 'but no package or card is drafted from this oversized original.';
    return `Drafting accepts at most 16777216 bytes; this original has ${Number(source.bytes)} bytes.`;
  }
  if (Number.isSafeInteger(count) && count > 2000)
    return `Drafting accepts at most 2000 features; this receipt has ${count} features.`;
  if (source.profile !== 'geojson-manual-v1' || source.inspection?.manualProfile?.version !== 'manual-geojson/1'
    || source.inspection?.manualProfile?.format !== 'geojson')
    return 'Drafting accepts only a retained GeoJSON recipe original.';
  if (!Number.isSafeInteger(count) || count < 1)
    return 'Drafting needs a retained count of 1 to 2000 features; the count is unknown.';
  if (item.card?.crs.state !== 'stated' || !source.inspection?.manualProfile?.crs?.evidence)
    return 'Drafting needs a stated, nonconflicting coordinate reference system.';
  return null;
}

async function draftItemTx(client: PoolClient, sourceId: string): Promise<DraftItem | undefined> {
  return (await client.query('SELECT * FROM usp_intake_items WHERE source_id=$1 AND parent_item_id IS NULL FOR UPDATE',
    [sourceId])).rows[0];
}

async function priorJobTx(client: PoolClient, input: IntakeDraftInput): Promise<string | null> {
  const prior = (await client.query("SELECT id,payload FROM jobs WHERE id=$1 AND operation='intake-draft'",
    [input.jobId])).rows[0];
  if (prior) {
    if (prior.payload.sourcePin !== input.sourcePin) conflict('The retained intake source changed.');
    return prior.id;
  }
  const active = (await client.query(`SELECT id,payload FROM jobs WHERE source_id=$1 AND operation='intake-draft'
    AND status IN ('queued','running') ORDER BY created_at LIMIT 1`, [input.sourceId])).rows[0];
  if (active && active.payload.sourcePin !== input.sourcePin) conflict('The retained intake source changed.');
  return active?.id ?? null;
}

/** Caller holds the case; enrollment and probe/approval publication share its transaction. */
export async function queueIntakeDraftTx(client: PoolClient, source: IntakeSourceRow,
  publishedCard?: IntakeCard): Promise<string | null> {
  if (publishedCard?.format === 'zip' && !shapefileZip(publishedCard)) return settleZipParentTx(client, source);
  // Nonvector readers keep their own behavior. Unsupported vectors receive a reason, never another reader.
  if (source.profile !== 'geojson-manual-v1' && publishedCard?.family !== 'vector') return null;
  const item = await draftItemTx(client, source.id);
  if (!item || item.parent_item_id || item.family !== 'vector'
    || !['probed', 'planned', 'reading'].includes(item.state)) return null;
  if (publishedCard && item.plan_ref) return null;
  if (source.profile === 'large-original-v1' && item.card?.format === 'geojson') {
    // A large GeoJSON is read in parts by its own chain of step jobs; above the reader's ceiling it rests.
    if (Number(source.bytes) <= STREAMING_VECTOR_LIMITS.sourceBytes) return queueIntakeLargeTx(client, source.id);
    await writeIntakeLargeTx(client, item.case_id, item.item_id, {
      state: 'probed', placement: 'not_understood', planRef: item.plan_ref,
      partsPlanned: null, partsDone: 0, recordsSeen: 0,
      limitReason: intakeLargeFailureReason('STREAMING_SOURCE_BUDGET', Number(source.bytes)),
    });
    return null;
  }
  const reason = intakeDraftLimit(item, source);
  if (reason) {
    await writeIntakeDraftTx(client, item.case_id, item.item_id, {
      state: 'probed', placement: 'needs_answer', planRef: item.plan_ref, recordsSeen: 0, limitReason: reason,
    });
    return null;
  }
  return enrollDraftTx(client, item, source);
}

/**
 * ZF2. The ZIP's own item rests read and unplaced: settled in the tray, its words its reason, no question asked.
 * Its layers are drafted as their own items; a shapefile ZIP keeps its direct-import words and no transition.
 */
async function settleZipParentTx(client: PoolClient, source: IntakeSourceRow): Promise<null> {
  const item = await draftItemTx(client, source.id);
  if (!item || item.parent_item_id || item.state !== 'probed' || item.card?.format !== 'zip') return null;
  await writeIntakeDraftTx(client, item.case_id, item.item_id, { state: 'read', placement: 'undecided',
    planRef: item.plan_ref, recordsSeen: 0, limitReason: zipParentWords(item.card) });
  return null;
}

async function enrollDraftTx(client: PoolClient, item: DraftItem, source: IntakeSourceRow) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`intake-draft:${item.item_id}`]);
  const scope = await intakeCaseTx(client, item.case_id);
  const recipe = (await client.query('SELECT revision FROM usp_mapping_recipes WHERE source_id=$1',
    [source.id])).rows[0];
  const revision = Number(recipe?.revision ?? 0);
  const input = IntakeDraftInputSchema.parse({ version: 'intake-draft/1',
    jobId: intakeDraftKey(item.item_id, revision, 'job'), itemId: item.item_id, caseId: item.case_id,
    caseRevision: scope.current.revision, sourceId: source.id, sourceRevision: source.revision,
    sourceSha256: source.sha256, sourcePin: intakeSourcePin(source, scope.binding), recipeRevision: revision,
    subject: scope.binding.subject, accessSha256: scope.binding.access,
  });
  const prior = await priorJobTx(client, input);
  if (prior) return prior;
  const digest = fingerprint(input);
  await client.query(`INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,payload)
    VALUES($1,$2,$3,'intake-draft',$4,$5,$6)`,
  [input.jobId, input.caseId, input.sourceId, input.caseRevision, digest, input]);
  const { registerUspJobInputTx } = await import('../jobs');
  await registerUspJobInputTx(client, input.jobId,
    { kind: 'intake', workspaceId: input.caseId, version: input.caseRevision + 1 }, input.sourceId, digest);
  return input.jobId;
}

export type IntakeSourcePins = Pick<IntakeDraftInput, 'itemId' | 'caseId' | 'caseRevision' | 'sourceId'
  | 'sourceRevision' | 'sourceSha256' | 'sourcePin' | 'subject' | 'accessSha256'>;

/** Case-first locking matches recipe execution; source pins remain exact across unrelated case edits.
 * Without `lockCase` the case row is left to callers whose readers share-lock it in their own transactions. */
export async function assertIntakeDraftTx(client: PoolClient, input: IntakeSourcePins, lockCase = true) {
  await lockSourceCaseDestinationTx(client, input.caseId);
  const scope = await intakeCaseTx(client, input.caseId, lockCase);
  const { source, binding } = await intakeSourceTx(client, input.caseId, input.sourceId);
  const latest = (await client.query(`SELECT max(revision)::int revision FROM sources
    WHERE case_id=$1 AND family_id=$2`,
    [input.caseId, source.family_id])).rows[0]?.revision;
  if (scope.current.revision < input.caseRevision || binding.subject !== input.subject
    || binding.access !== input.accessSha256 || source.revision !== input.sourceRevision
    || source.sha256 !== input.sourceSha256 || latest !== source.revision
    || intakeSourcePin(source, binding) !== input.sourcePin) conflict('The retained intake source changed.');
  const item = await draftItemTx(client, source.id) ?? notFound('Intake draft item not found.');
  if (item.item_id !== input.itemId || item.case_id !== input.caseId) conflict('The intake draft context changed.');
  return { item, source };
}
