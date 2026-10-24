import type { PoolClient } from 'pg';
import { z } from 'zod';
import { AnyStreamedMappingPlanSchema, IntakeLayoutMemorySchema, StreamedMappingReceiptSchema,
  StreamedProfileGenerationSchema, StreamedProfileInputSchema,
  type StreamedMappingPlan, type StreamedProfileGeneration } from '@ulpin/contracts/usp';
import { transaction } from '../../../infrastructure/db';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { localOperatorSubject } from '../principal';
import { assertIngestionBinding, ingestionBinding } from './events';
import { assertIntakeSource, intakeSourceTx, type IntakeSourceRow } from './intake-context';
import { intakeItem } from './intake-ledger';
import { compileStreamedMapping } from './streamed-mapping';
import { loadProvisionalStreamedProfileTx, loadSealedStreamedProfileTx, streamedGenerationHash }
  from './streamed-profile';

const uuid = z.string().uuid();
const defaults = { transaction, sealed: loadSealedStreamedProfileTx, prefix: loadProvisionalStreamedProfileTx };
const receiptSchema = StreamedMappingReceiptSchema.extend({ state: z.enum(['proposed', 'approved', 'executed']) });
type MemoryRow = { body: unknown; inventory: unknown; body_sha256: string; reading_source: IntakeSourceRow };
type Answer = z.infer<typeof IntakeLayoutMemorySchema>;

/** Repin only to check mechanical admission. No publisher evidence or approval crosses to this source. */
function checkLayout(plan: StreamedMappingPlan, profile: StreamedProfileGeneration) {
  const prefix = profile.coverage === 'provisional';
  const repinned = AnyStreamedMappingPlanSchema.parse({ mode: 'streamed_mapping',
    version: prefix ? 'streamed-prefix-mapping/1' : 'streamed-mapping/1',
    scope: prefix ? 'observed_prefix_and_later_compatible_features' : 'accepted_source_features',
    source: profile.source, caseId: plan.caseId, caseRevision: plan.caseRevision,
    rawJobId: profile.rawJobId, profileJobId: profile.jobId,
    profileGeneration: profile.generation, profileHash: profile.generationHash,
    kind: plan.kind, operations: plan.operations, basis: 'officer_stated', semanticEvidence: [],
    ...(prefix ? { prefix: { throughRawChunkIndex: profile.rawChunkIndex,
      rawResultSha256: profile.rawResultSha256, recordsSeen: profile.recordsSeen, accepted: profile.accepted } } : {}),
  });
  compileStreamedMapping(repinned, profile);
}

function mismatch(plan: StreamedMappingPlan, before: StreamedProfileGeneration, now: StreamedProfileGeneration) {
  for (const { sourcePath } of plan.operations) {
    const used = before.paths.find(path => path.path === sourcePath);
    const current = now.paths.find(path => path.path === sourcePath);
    if (!current) return `The earlier layout used ${sourcePath}, which is missing here.`;
    if (!used || fingerprint([...used.types].sort()) !== fingerprint([...current.types].sort())) {
      return `The earlier layout used ${sourcePath}, which holds other kinds of values here.`;
    }
  }
  try {
    checkLayout(plan, now);
    return null;
  } catch (error) {
    if (!(error instanceof AppError) || error.status !== 422) throw error;
    if (error.code === 'STREAMED_MAPPING_COVERAGE') {
      const fields = plan.operations.filter(op => !op.target.endsWith('.geometry')).map(op => op.sourcePath);
      return `The earlier layout used ${fields.join(' and ')}, which do not have complete usable values here.`;
    }
    return 'No earlier layout fits the kinds of shapes and fields read in this file.';
  }
}

function readable(row: MemoryRow, plan: StreamedMappingPlan) {
  if (row.reading_source?.case_id !== plan.caseId || row.reading_source.id !== plan.source.sourceId) return false;
  try {
    const binding = ingestionBinding(plan.caseId);
    assertIntakeSource(row.reading_source, binding);
    assertIngestionBinding(binding);
    return true;
  } catch (error) {
    if (error instanceof AppError && error.status < 500) return false;
    throw error;
  }
}

function approvedLayout(row: MemoryRow, profile: StreamedProfileGeneration, subject: string) {
  const parsed = receiptSchema.safeParse(row.body);
  const inventory = StreamedProfileGenerationSchema.safeParse(row.inventory);
  if (!parsed.success || !inventory.success) return null;
  const receipt = parsed.data, old = inventory.data, plan = receipt.plan;
  if (!['approved', 'executed'].includes(receipt.state) || receipt.approval?.subject !== subject
    || receipt.planHash !== fingerprint(plan) || receipt.approval.planHash !== receipt.planHash
    || (plan.source.sourceId === profile.source.sourceId
      && plan.source.sourceRevision === profile.source.sourceRevision)
    || !readable(row, plan)) return null;
  if (fingerprint(old) !== row.body_sha256 || streamedGenerationHash(old) !== old.generationHash
    || old.jobId !== plan.profileJobId || old.rawJobId !== plan.rawJobId
    || old.generation !== plan.profileGeneration || old.generationHash !== plan.profileHash
    || fingerprint(old.source) !== fingerprint(plan.source)) return null;
  return { receipt, old, plan };
}

async function rememberedTx(client: PoolClient, profile: StreamedProfileGeneration): Promise<Answer> {
  const subject = localOperatorSubject();
  const rows: MemoryRow[] = (await client.query(`SELECT r.body,g.body inventory,g.body_sha256,
    to_jsonb(s) reading_source FROM usp_mapping_recipes r
    JOIN cases c ON c.id=r.case_id AND NOT c.archived JOIN sources s ON s.id=r.source_id AND s.case_id=c.id
    JOIN usp_streamed_profile_generations g ON g.job_id=(r.body->'plan'->>'profileJobId')::uuid
      AND g.generation=(r.body->'plan'->>'profileGeneration')::int
    WHERE r.state IN ('approved','executed') AND r.body->'approval'->>'subject'=$1
      AND r.body->'plan'->>'version' IN ('streamed-mapping/1','streamed-prefix-mapping/1')
      AND NOT (r.source_id=$2 AND r.body->'plan'->'source'->>'sourceRevision'=$3)
    ORDER BY r.body->'approval'->>'at' DESC,r.id DESC LIMIT 50`,
  [subject, profile.source.sourceId, String(profile.source.sourceRevision)])).rows;
  let words = 'No earlier layout approved by you is available for this file.';
  for (const row of rows.slice(0, 50)) {
    const candidate = approvedLayout(row, profile, subject);
    if (!candidate) continue;
    const { receipt, old, plan } = candidate;
    const reason = mismatch(plan, old, profile);
    if (reason) {
      if (words.startsWith('No earlier layout approved')) words = reason;
      continue;
    }
    const memory = { kind: plan.kind ?? 'building',
      operations: plan.operations.map(({ target, sourcePath }) => ({ target, sourcePath })),
      recipeId: receipt.id, name: row.reading_source.name, approvedAt: receipt.approval!.at };
    return { memory, words: `Filled in from the layout you approved for ${memory.name} on ${memory.approvedAt}; `
      + 'check it and approve.' };
  }
  return { memory: null, words };
}

async function questionProfileTx(client: PoolClient, caseId: string, source: IntakeSourceRow,
  item: ReturnType<typeof intakeItem>, deps: Pick<typeof defaults, 'sealed' | 'prefix'>) {
  const state = (await client.query(`SELECT j.payload,p.sealed_generation,g.body->>'generationHash' hash
    FROM usp_streamed_profile_imports p JOIN jobs j ON j.id=p.job_id
    LEFT JOIN usp_streamed_profile_generations g ON g.job_id=p.job_id AND g.generation=p.sealed_generation
    WHERE p.job_id=$1 AND p.case_id=$2 AND p.source_id=$3`,
  [item.streamedProfileJobId, caseId, source.id])).rows[0] ?? notFound('The field inventory is not available yet.');
  const input = StreamedProfileInputSchema.parse(state.payload), named = item.layoutProfile;
  if (input.jobId !== item.streamedProfileJobId || input.caseId !== caseId || input.sourceId !== source.id
    || input.sourceRevision !== source.revision || input.sourceSha256 !== source.sha256) {
    conflict('The field inventory belongs to another retained source revision.');
  }
  const prefix = named?.coverage === 'provisional';
  const generation = prefix ? named.generation : state.sealed_generation;
  const hash = prefix ? named.generationHash : state.hash;
  if (generation === null || !hash) notFound('The complete field inventory is not available yet.');
  if (named && (named.generation !== generation || named.generationHash !== hash)) {
    conflict('The layout question names a different field inventory.');
  }
  return (await (prefix ? deps.prefix : deps.sealed)(client, input.jobId, generation, hash,
    input.rawJobId, caseId, source.id)).profile;
}

/** Shared by the question and reading card: the question's immutable inventory, not a newer prefix. */
export async function streamedLayoutMemoryTx(client: PoolClient, caseId: string, itemId: string,
  deps: Pick<typeof defaults, 'sealed' | 'prefix'> = defaults) {
  const row = (await client.query(`SELECT i.*,s.name,p.job_id streamed_profile_job_id
    FROM usp_intake_items i JOIN sources s ON s.id=i.source_id
    LEFT JOIN LATERAL (SELECT job_id FROM usp_streamed_profile_imports
      WHERE case_id=i.case_id AND source_id=i.source_id ORDER BY created_at DESC LIMIT 1) p ON true
    WHERE i.case_id=$1 AND i.item_id=$2`, [caseId, itemId])).rows[0]
    ?? notFound('Intake item not found in this case.');
  const { source, binding } = await intakeSourceTx(client, caseId, row.source_id);
  if (row.parent_item_id !== null || source.profile !== 'large-original-v1' || row.card?.format !== 'geojson') {
    throw new AppError(422, 'INTAKE_LAYOUT_MEMORY_ITEM', 'Only a large GeoJSON can reuse a streamed layout.');
  }
  const item = intakeItem(row);
  if (!item.layoutQuestion) conflict('This file has no open layout question.');
  const profile = await questionProfileTx(client, caseId, source, item, deps);
  const answer = IntakeLayoutMemorySchema.parse(await rememberedTx(client, profile));
  assertIngestionBinding(binding);
  return { answer, profile };
}

/** A read only: never authors, approves, answers, queues or changes the original. */
export async function streamedLayoutMemory(caseValue: string, itemValue: string, deps = defaults): Promise<Answer> {
  const caseId = uuid.parse(caseValue), itemId = uuid.parse(itemValue);
  return deps.transaction(async client => (await streamedLayoutMemoryTx(client, caseId, itemId, deps)).answer);
}
