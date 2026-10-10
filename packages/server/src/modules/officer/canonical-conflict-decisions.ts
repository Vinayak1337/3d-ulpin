import type { PoolClient } from 'pg';
import {
  BuildingConflictDecisionRequestSchema, BuildingConflictDecisionSchema,
  type BuildingConflictDecision, type BuildingConflictDecisionRequest,
  type NormalizedBuilding, type PhysicalFeature, type RegistryBody,
} from '@ulpin/contracts';
import { transaction } from '../../infrastructure/db';
import { AppError, conflict, notFound } from '../../infrastructure/errors';
import { canonicalBuilding } from '../registry/canonical-building';
import { localOperatorSubject } from '../usp/principal';
import { sourceBuildingOriginalAccessTx } from '../usp/ingestion/source-building-review';

type DecisionBody = RegistryBody & { canonicalConflictDecisions?: BuildingConflictDecision[] };
type RecordRow = { id: string; site_id: string; revision: number; body: DecisionBody };
type FeatureRow = { id: string; area_id: string; revision: number; body: PhysicalFeature };

export function reviewedConflictDecision(
  building: NormalizedBuilding, input: BuildingConflictDecisionRequest, actor: string, time: string,
  recordRevision: number,
): BuildingConflictDecision {
  if (building.revisionId !== input.expectedCanonicalRevision) conflict('Refresh the current canonical conflict.');
  const retained = [...building.conflicts, ...(building.resolvedConflicts ?? [])];
  const entry = retained.find(item => item.property === input.property) ?? notFound('Choose a retained conflict.');
  const chosenValue = input.outcome === 'selected' ? input.chosenValue : null;
  const checked = entry.alternatives.filter(alternative => input.outcome === 'unresolved'
    || alternative.value === chosenValue);
  const hasCitation = checked.some(alternative => alternative.citations.some(citation => (
    citation.sourceId === input.citation.sourceId && citation.sourceSha256 === input.citation.sourceSha256
    && citation.locator.kind === 'page' && citation.locator.page === input.citation.locator.page
    && citation.locator.text === input.citation.locator.text
  )));
  const validType = input.property === 'building.storeyLabel' ? typeof chosenValue === 'string'
    : typeof chosenValue === 'number';
  if (!hasCitation || (input.outcome === 'selected' && (!checked.length || !validType))) {
    throw new AppError(422, 'CONFLICT_ALTERNATIVE',
      'Choose a retained alternative and its exact checked page citation.');
  }
  return BuildingConflictDecisionSchema.parse({
    ...input, chosenValue, alternatives: entry.alternatives, actor, time, recordRevision,
  });
}

async function protectSourceCases(client: PoolClient, buildingId: string): Promise<void> {
  await client.query(
    `SELECT id FROM cases WHERE id IN (
       SELECT case_id FROM sources WHERE id IN (
         SELECT jsonb_array_elements_text(p.body->'sourceRevisionIds')::uuid
         FROM import_packages p WHERE p.body->'features' @> $1::jsonb
       )
     ) ORDER BY id FOR SHARE`,
    [JSON.stringify([{ id: buildingId }])],
  );
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('physical-area-recording',0))");
}

function replayDecision(
  body: DecisionBody, input: BuildingConflictDecisionRequest,
): BuildingConflictDecision | undefined {
  const decisions = BuildingConflictDecisionSchema.array().max(20).parse(body.canonicalConflictDecisions ?? []);
  const prior = decisions.find(decision => decision.requestKey === input.requestKey);
  if (!prior) return undefined;
  const chosenValue = input.outcome === 'selected' ? input.chosenValue : null;
  if (prior.expectedCanonicalRevision !== input.expectedCanonicalRevision || prior.property !== input.property
    || prior.outcome !== input.outcome || prior.chosenValue !== chosenValue || prior.reason !== input.reason
    || JSON.stringify(prior.citation) !== JSON.stringify(input.citation) || prior.actor !== localOperatorSubject()) {
    conflict('This request key already names a different conflict decision.');
  }
  return prior;
}

async function appendReviewedRevision(
  client: PoolClient, record: RecordRow, feature: FeatureRow, decision: BuildingConflictDecision,
): Promise<void> {
  const decisions = [...(record.body.canonicalConflictDecisions ?? []), decision];
  if (decisions.length > 20) throw new AppError(422, 'CONFLICT_DECISION_LIMIT', 'At most 20 decisions per record.');
  const site = (await client.query(
    'UPDATE registry_sites SET revision=revision+1 WHERE id=$1 RETURNING revision', [record.site_id],
  )).rows[0];
  const area = (await client.query(
    'UPDATE map_areas SET revision=revision+1 WHERE id=$1 RETURNING revision', [feature.area_id],
  )).rows[0];
  const body = { ...record.body, revision: decision.recordRevision, canonicalConflictDecisions: decisions };
  await client.query('UPDATE registry_records SET revision=$2,body=$3 WHERE id=$1', [
    record.id, decision.recordRevision, body,
  ]);
  await client.query('INSERT INTO registry_revisions(record_id,revision,body,site_revision) VALUES($1,$2,$3,$4)', [
    record.id, decision.recordRevision, body, site.revision,
  ]);
  await recordConflictFeatureRevisionTx(client, feature, decision, area.revision);
}

/** Physical history requires the original package lineage even when only an officer note changes. */
export async function recordConflictFeatureRevisionTx(
  client: PoolClient, feature: FeatureRow, decision: BuildingConflictDecision, areaRevision: number,
): Promise<void> {
  const lineage = (await client.query(
    'SELECT package_id FROM physical_feature_revisions WHERE feature_id=$1 AND revision=$2',
    [feature.id, feature.revision],
  )).rows[0] ?? notFound('The retained physical revision lineage is unavailable.');
  const physical = { ...feature.body, revision: feature.revision + 1,
    properties: { ...feature.body.properties, officerConflictDecision: decision } };
  await client.query('UPDATE physical_features SET revision=$2,body=$3 WHERE id=$1', [
    feature.id, physical.revision, physical,
  ]);
  await client.query(
    'INSERT INTO physical_feature_revisions(feature_id,revision,body,package_id,area_revision) VALUES($1,$2,$3,$4,$5)',
    [feature.id, physical.revision, physical, lineage.package_id, areaRevision],
  );
}

/** Append existing registry/physical histories; neither source claims nor originals are replaced. */
export async function decideCanonicalConflict(buildingId: string, raw: unknown): Promise<BuildingConflictDecision> {
  const input = BuildingConflictDecisionRequestSchema.parse(raw);
  const actor = localOperatorSubject();
  return transaction(async client => {
    await protectSourceCases(client, buildingId);
    const feature: FeatureRow = (await client.query(
      'SELECT * FROM physical_features WHERE id=$1 AND revision>0', [buildingId],
    )).rows[0] ?? notFound();
    await client.query('SELECT id FROM map_areas WHERE id=$1 FOR UPDATE', [feature.area_id]);
    await client.query(
      'SELECT id FROM registry_sites WHERE id=(SELECT site_id FROM map_areas WHERE id=$1) FOR UPDATE',
      [feature.area_id],
    );
    const locked: FeatureRow = (await client.query(
      'SELECT * FROM physical_features WHERE id=$1 FOR UPDATE', [buildingId],
    )).rows[0];
    if (locked.area_id !== feature.area_id) conflict('The building area changed.');
    const record: RecordRow = (await client.query(
      'SELECT * FROM registry_records WHERE id=$1 AND revision>0 FOR UPDATE', [buildingId],
    )).rows[0] ?? notFound();
    const building = await canonicalBuilding(buildingId);
    const source = await sourceBuildingOriginalAccessTx(client, record.site_id, input.citation.sourceId);
    if (source.sha256 !== input.citation.sourceSha256) conflict('The checked original hash changed.');
    const prior = replayDecision(record.body, input);
    if (prior) return prior;
    const decision = reviewedConflictDecision(building, input, actor, new Date().toISOString(), record.revision + 1);
    await appendReviewedRevision(client, record, locked, decision);
    return decision;
  });
}
