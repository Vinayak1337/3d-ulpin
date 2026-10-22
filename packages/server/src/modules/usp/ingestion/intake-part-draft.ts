import type { PoolClient } from 'pg';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { ingestProvedAreaPart } from '../../areas/areas';
import { fingerprint } from '../../cases/domain';
import { ChunkMappingService } from './chunk-mapping';
import { intakeSourceTx } from './intake-context';
import { publishIntakePartTx, unfinishedIntakePackagesTx } from './intake-ledger';
import { createIntakeTargetsTx } from './intake-targets';
import type { ProvedAreaPartInput } from './proved-area-part';
import { isRetainedMapOriginal } from './retained-map-original';

export const INTAKE_UNFINISHED_PACKAGE_LIMIT = 8;
/** Features no package takes, counted through a cut's last feature: too large for any package (`held`), wider than
 * one map area (`heldWide`), or outside the area the file is placed in (`heldOutside`). */
export type IntakePartHeld = { held: number; heldWide: number; heldOutside: number };
export const NO_HELD_FEATURES: Readonly<IntakePartHeld> = Object.freeze({ held: 0, heldWide: 0, heldOutside: 0 });

/** Admission and publication share the item lock. */
export async function assertIntakePackagePressureTx(client: PoolClient, itemId: string) {
  if (await unfinishedIntakePackagesTx(client, itemId) >= INTAKE_UNFINISHED_PACKAGE_LIMIT)
    throw new AppError(429, 'INTAKE_PACKAGE_PRESSURE', 'Eight packages of this file are still being prepared.');
}

async function assertClosedMappingTx(client: PoolClient, input: ProvedAreaPartInput, mappingJobId: string) {
  const row = (await client.query(`SELECT m.*,j.payload,r.sealed_chunks raw_parts,r.records raw_records,
    r.state raw_state,r.unknown_remainder raw_unknown FROM usp_chunk_mapping_imports m
    JOIN jobs j ON j.id=m.job_id JOIN usp_streaming_vector_imports r ON r.job_id=m.raw_job_id
    WHERE m.job_id=$1 FOR SHARE OF m,j,r`, [mappingJobId])).rows[0]
    ?? notFound('The retained mapped file is unavailable.');
  if (row.source_id !== input.sourceId || row.source_revision !== input.sourceRevision
    || row.payload.sourceSha256 !== input.sourceSha256 || row.payload.planHash !== input.layoutHash
    || row.payload.route !== 'approved_recipe' || row.sealed_chunks === null || row.unknown_remainder
    || row.next_publish_index !== row.sealed_chunks || row.raw_unknown || row.records !== row.raw_records
    || row.sealed_chunks !== row.raw_parts || !['completed', 'completed_with_rejections'].includes(row.raw_state)
    || !['completed', 'completed_with_rejections', 'needs_input'].includes(row.state))
    conflict('The approved mapped file has not closed its exact source and keys.');
  const conflicts = (await client.query(`SELECT first_feature_index,later_feature_index
    FROM usp_chunk_mapping_conflicts WHERE job_id=$1
      AND (first_feature_index=ANY($2::int[]) OR later_feature_index=ANY($2::int[]))`,
  [mappingJobId, input.features.map(feature => feature.featureIndex)])).rows;
  if (conflicts.length) conflict('Both occurrences of a duplicated source key must stay out of a package.');
  return { rawJobId: row.payload.rawJobId as string, recordsSeen: Number(row.records) };
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
    if (!chunk.current || !chunk.payload) conflict('The approved mapped part is unavailable or stale.');
    for (const featureIndex of indices) {
      const record = chunk.payload.records.find(value => value.featureIndex === featureIndex);
      if (!record || record.disposition !== 'observed' || record.sourceKey.state !== 'known'
        || record.geometryRef?.rawJobId !== rawJobId || record.geometryRef?.chunkIndex !== index)
        conflict('Every package feature must be an exact observed record of this sealed mapping.');
    }
  }
}

/** Sealed-only safe door: no targets exist before whole-file verification and global key closure.
 * `held` is the fold's count of features no package takes, up to this cut's last feature. */
export async function draftIntakePartTx(client: PoolClient, itemId: string, mappingJobId: string,
  input: ProvedAreaPartInput, held: IntakePartHeld = NO_HELD_FEATURES) {
  const lookup = (await client.query('SELECT case_id FROM usp_intake_items WHERE item_id=$1', [itemId])).rows[0]
    ?? notFound('The intake item is unavailable.');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`intake-parts-case:${lookup.case_id}`]);
  const { source } = await intakeSourceTx(client, lookup.case_id, input.sourceId);
  if (!isRetainedMapOriginal(source)) conflict('The file is still being read.');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`intake-parts:${itemId}`]);
  const item = (await client.query('SELECT * FROM usp_intake_items WHERE item_id=$1 FOR UPDATE', [itemId])).rows[0];
  if (item.source_id !== input.sourceId || item.parent_item_id) conflict('This is another original intake item.');
  const { rawJobId, recordsSeen } = await assertClosedMappingTx(client, input, mappingJobId);
  await assertObservedCut(input, item.case_id, mappingJobId, rawJobId);
  const locator = { version: 'intake-package-cut/1', sourceId: input.sourceId, sourceRevision: input.sourceRevision,
    sourceSha256: input.sourceSha256, readerVersion: input.readerVersion, layoutHash: input.layoutHash,
    mappingJobId, cutIndex: input.cutIndex, featureIndices: input.features.map(feature => feature.featureIndex) };
  const prior = (await client.query('SELECT locator FROM usp_intake_parts WHERE item_id=$1 AND part_index=$2',
    [itemId, input.cutIndex])).rows[0];
  if (prior && fingerprint(prior.locator) !== fingerprint(locator))
    conflict('This part index already names another cut.');
  if (!prior) await assertIntakePackagePressureTx(client, itemId);
  const pkg = await ingestProvedAreaPart(input, client);
  const counts = { recordsSeen, features: input.features.length, accepted: pkg.features.length,
    quarantined: pkg.quarantine?.rejected ?? 0, ...held,
    rawBytes: input.features.reduce((sum, feature) => sum + feature.rawBytes.byteLength, 0) };
  await publishIntakePartTx(client, itemId, input.cutIndex, pkg, locator, counts);
  if (!prior) await createIntakeTargetsTx(client, item.case_id, itemId, pkg, input.sourceId);
  return pkg;
}
