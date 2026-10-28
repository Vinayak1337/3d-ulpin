import type { PoolClient } from 'pg';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { ingestProvedAreaPart } from '../../areas/areas';
import { fingerprint } from '../../cases/domain';
import { ChunkMappingService } from './chunk-mapping';
import { intakeSourceTx } from './intake-context';
import { publishIntakePartTx, unfinishedIntakePackagesTx } from './intake-ledger';
import { createIntakeTargetsTx } from './intake-targets';
import { partStageTimer, type PartTiming, type ProvedAreaPartInput } from './proved-area-part';
import { isRetainedMapOriginal } from './retained-map-original';
import { prefixSealCheckKey } from './streamed-mapping';

export const INTAKE_UNFINISHED_PACKAGE_LIMIT = 8;
/** Features no package takes, counted through a cut's last feature: too large for any package (`held`), wider than
 * one map area (`heldWide`), outside the area the file is placed in (`heldOutside`), or with a position that could
 * not be measured (`heldUnmeasured`). */
export type IntakePartHeld = { held: number; heldWide: number; heldOutside: number; heldUnmeasured: number };
export const NO_HELD_FEATURES: Readonly<IntakePartHeld> = Object.freeze({ held: 0, heldWide: 0, heldOutside: 0,
  heldUnmeasured: 0 });

/** Admission and publication share the item lock. */
export async function assertIntakePackagePressureTx(client: PoolClient, itemId: string) {
  if (await unfinishedIntakePackagesTx(client, itemId) >= INTAKE_UNFINISHED_PACKAGE_LIMIT)
    throw new AppError(429, 'INTAKE_PACKAGE_PRESSURE', 'Eight packages of this file are still being prepared.');
}

export class IntakeMappingCutPending extends AppError {
  constructor() { super(409, 'STALE_REVISION', 'The mapping has not published every chunk of this cut yet.'); }
}

async function assertOpenMappingTx(client: PoolClient, input: ProvedAreaPartInput, mappingJobId: string,
  check: Record<string, any> | undefined) {
  const current = (await client.query(`SELECT r.body->>'planHash' plan_hash,g.body->>'generationHash' sealed_hash
    FROM usp_mapping_recipes r JOIN usp_streamed_profile_imports p
      ON p.job_id=(r.body->'plan'->>'profileJobId')::uuid
    JOIN usp_streamed_profile_generations g ON g.job_id=p.job_id AND g.generation=p.sealed_generation
    WHERE r.source_id=$1 AND r.state='approved' AND p.state='sealed' AND g.sealed FOR SHARE OF r,p,g`,
  [input.sourceId])).rows[0];
  if (!current || current.plan_hash !== input.layoutHash || check?.changed !== false
    || check.mappingJobId !== mappingJobId
    || check.key !== prefixSealCheckKey(current.plan_hash, current.sealed_hash, mappingJobId))
    conflict('The approved mapped file has not passed its exact source and key check.');
  const conflicts = new Set<number>(check.conflicts ?? []);
  if (input.features.some(feature => conflicts.has(feature.featureIndex)))
    conflict('Both occurrences of a duplicated source key must stay out of a package.');
}

async function assertMappingTx(client: PoolClient, input: ProvedAreaPartInput, mappingJobId: string) {
  const row = (await client.query(`SELECT m.*,j.payload,r.sealed_chunks raw_parts,r.records raw_records,
    r.state raw_state,r.unknown_remainder raw_unknown,s.inspection->'intakePrefixSealCheck' seal_check
    FROM usp_chunk_mapping_imports m JOIN sources s ON s.id=m.source_id
    JOIN jobs j ON j.id=m.job_id JOIN usp_streaming_vector_imports r ON r.job_id=m.raw_job_id
    WHERE m.job_id=$1 FOR SHARE OF m,j,r,s`, [mappingJobId])).rows[0]
    ?? notFound('The retained mapped file is unavailable.');
  const open = ['queued', 'running'].includes(row.state);
  const rawClosed = row.raw_parts !== null && !row.raw_unknown
    && ['completed', 'completed_with_rejections'].includes(row.raw_state);
  const closed = row.sealed_chunks !== null && !row.unknown_remainder
    && row.next_publish_index === row.sealed_chunks && row.records === row.raw_records
    && row.sealed_chunks === row.raw_parts
    && ['completed', 'completed_with_rejections', 'needs_input'].includes(row.state);
  if (row.source_id !== input.sourceId || row.source_revision !== input.sourceRevision
    || row.payload.sourceSha256 !== input.sourceSha256 || row.payload.planHash !== input.layoutHash
    || row.payload.route !== 'approved_recipe' || !rawClosed || (!open && !closed))
    conflict('The approved mapped file has not closed its exact source and keys.');
  if (open) await assertOpenMappingTx(client, input, mappingJobId, row.seal_check);
  const conflicts = (await client.query(`SELECT first_feature_index,later_feature_index
    FROM usp_chunk_mapping_conflicts WHERE job_id=$1
      AND (first_feature_index=ANY($2::int[]) OR later_feature_index=ANY($2::int[]))`,
  [mappingJobId, input.features.map(feature => feature.featureIndex)])).rows;
  if (conflicts.length) conflict('Both occurrences of a duplicated source key must stay out of a package.');
  if (open && input.features.some(feature => feature.rawChunkIndex >= row.next_publish_index))
    throw new IntakeMappingCutPending();
  return { rawJobId: row.payload.rawJobId as string,
    recordsSeen: Number(open ? row.raw_records : row.records) };
}

async function assertObservedCut(input: ProvedAreaPartInput, caseId: string, mappingJobId: string, rawJobId: string) {
  const service = new ChunkMappingService();
  const groups = new Map<number, number[]>();
  for (const feature of input.features) {
    const indices = groups.get(feature.rawChunkIndex) ?? [];
    indices.push(feature.featureIndex);
    groups.set(feature.rawChunkIndex, indices);
  }
  for (const [index, indices] of groups) {
    const chunk = await service.chunk(caseId, input.sourceId, mappingJobId, index);
    // `current` proves source/access/code freshness, not whole-mapping closure; published open chunks qualify.
    if (!chunk.current || !chunk.payload) conflict('The approved mapped part is unavailable or stale.');
    for (const featureIndex of indices) {
      const record = chunk.payload.records.find(value => value.featureIndex === featureIndex);
      if (!record || record.disposition !== 'observed' || record.sourceKey.state !== 'known'
        || record.geometryRef?.rawJobId !== rawJobId || record.geometryRef?.chunkIndex !== index)
        conflict('Every package feature must be an exact observed record of this sealed mapping.');
    }
  }
}

/** Under the case/source/item and mapping locks, sealed admission is unchanged; a queued/running approved
 * mapping may cut only a finished, sealed raw file after an unchanged whole-file check keyed to the current
 * recipe plan, sealed profile hash and mapping job. Every cut chunk must be below next_publish_index and every
 * feature absent from both check conflicts and stored mapping conflicts; observed known keys and exact geometry
 * references remain mandatory. `held` counts features no package takes through this cut's last feature. */
export async function draftIntakePartTx(client: PoolClient, itemId: string, mappingJobId: string,
  input: ProvedAreaPartInput, held: IntakePartHeld = NO_HELD_FEATURES, timing?: PartTiming) {
  const mark = partStageTimer(timing);
  const lookup = (await client.query('SELECT case_id FROM usp_intake_items WHERE item_id=$1', [itemId])).rows[0]
    ?? notFound('The intake item is unavailable.');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`intake-parts-case:${lookup.case_id}`]);
  const { source } = await intakeSourceTx(client, lookup.case_id, input.sourceId);
  if (!isRetainedMapOriginal(source)) conflict('The file is still being read.');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`intake-parts:${itemId}`]);
  const item = (await client.query('SELECT * FROM usp_intake_items WHERE item_id=$1 FOR UPDATE', [itemId])).rows[0];
  if (item.source_id !== input.sourceId || item.parent_item_id) conflict('This is another original intake item.');
  const { rawJobId, recordsSeen } = await assertMappingTx(client, input, mappingJobId);
  await assertObservedCut(input, item.case_id, mappingJobId, rawJobId);
  const locator = { version: 'intake-package-cut/1', sourceId: input.sourceId, sourceRevision: input.sourceRevision,
    sourceSha256: input.sourceSha256, readerVersion: input.readerVersion, layoutHash: input.layoutHash,
    mappingJobId, cutIndex: input.cutIndex, featureIndices: input.features.map(feature => feature.featureIndex) };
  const prior = (await client.query('SELECT locator FROM usp_intake_parts WHERE item_id=$1 AND part_index=$2',
    [itemId, input.cutIndex])).rows[0];
  if (prior && fingerprint(prior.locator) !== fingerprint(locator))
    conflict('This part index already names another cut.');
  if (!prior) await assertIntakePackagePressureTx(client, itemId);
  mark('draftAdmission');
  const pkg = await ingestProvedAreaPart(input, client, timing);
  mark('ingestProvedAreaPart');
  const counts = { recordsSeen, features: input.features.length, accepted: pkg.features.length,
    quarantined: pkg.quarantine?.rejected ?? 0, ...held,
    rawBytes: input.features.reduce((sum, feature) => sum + feature.rawBytes.byteLength, 0) };
  await publishIntakePartTx(client, itemId, input.cutIndex, pkg, locator, counts);
  mark('partPublish');
  if (!prior) await createIntakeTargetsTx(client, item.case_id, itemId, pkg, input.sourceId);
  mark('targetsReviewEnqueue');
  return pkg;
}
