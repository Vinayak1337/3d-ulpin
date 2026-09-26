import { query } from '../../infrastructure/db';
import { AppError, conflict, notFound } from '../../infrastructure/errors';
import { preparationContinuation } from '../cases/preparation-continuation';
import { getPackage } from '../areas/areas';
import { importRegistryCase } from '../registry/registry-seed';
import { draftDetail, prepareRegistryReview } from '../registry/registry';
import { buildingDossier } from './officer';
import { appendPreparationFacts, factProperties } from './officer-preparation';
import type { PreparationFactInput } from './officer-preparation';

export async function physicalFeatureRevisions(featureId: string, before: number) {
  const current = (await query(
    "SELECT f.revision FROM physical_features f JOIN map_areas a ON a.id=f.area_id WHERE f.id=$1 AND f.revision>0 AND a.archived_at IS NULL",
    [featureId],
  )).rows[0] ?? notFound();
  const rows = await query(
    'SELECT revision,created_at AS "createdAt",area_revision AS "areaRevision",package_id AS "packageId",body FROM physical_feature_revisions WHERE feature_id=$1 AND revision<$2 ORDER BY revision DESC LIMIT 51',
    [featureId, before],
  );
  const revisions = rows.rows.slice(0, 50);
  return {
    featureId,
    currentRevision: current.revision as number,
    revisions,
    nextBefore: rows.rows.length > 50 ? revisions.at(-1)?.revision as number : null,
    scope: 'Retained physical-feature revisions only; registry and neighbours are not reconstructed at an invented historical date.',
  };
}

export async function propertyDirectory(areaId: string) {
  const rows = await query(
    `WITH RECURSIVE buildings AS (
      SELECT f.id,f.revision FROM physical_features f WHERE f.revision>0 AND f.body->>'kind'='building' AND (f.area_id=$1 OR EXISTS(SELECT 1 FROM block_group_memberships m JOIN block_groups g ON g.id=m.group_id WHERE m.feature_id=f.id AND g.area_id=$1))
    ), roots AS (
      SELECT b.id building_id,r.id record_id FROM buildings b JOIN registry_records r ON r.id=b.id AND r.revision>0
      UNION SELECT b.id,t.id FROM buildings b JOIN property_associations a ON a.from_id=b.id JOIN registry_records t ON t.id=a.to_id WHERE a.relationship IN ('detailed_record','shared_space') AND a.status='confirmed' AND (a.body->>'fromRevision')::int=b.revision AND (a.body->>'toRevision')::int=t.revision
    ), related AS (
      SELECT * FROM roots UNION SELECT x.building_id,l.record_id FROM related x JOIN registry_links l ON l.target_id=x.record_id WHERE l.kind IN ('within','floor','serves')
    ) SELECT b.id "buildingId",count(DISTINCT r.id) FILTER(WHERE r.kind='space')::integer spaces,count(DISTINCT r.id) FILTER(WHERE r.kind='floor')::integer floors FROM buildings b LEFT JOIN related x ON x.building_id=b.id LEFT JOIN registry_records r ON r.id=x.record_id AND r.revision>0 GROUP BY b.id ORDER BY b.id LIMIT 2000`,
    [areaId],
  );
  return rows.rows as { buildingId: string; spaces: number; floors: number }[];
}

export async function workspaceDirectory() {
  const rows = await query(
    `SELECT c.id,c.name,c.revision,c.updated_at "updatedAt",b.building_id "buildingId",b.body->>'areaId' "areaId",f.body->>'name' "propertyName",(SELECT count(*)::integer FROM sources s WHERE s.case_id=c.id) "sourceCount" FROM cases c LEFT JOIN building_preparations b ON b.case_id=c.id LEFT JOIN physical_features f ON f.id=b.building_id WHERE (NOT c.archived OR b.id IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM map_areas a WHERE a.archived_at IS NOT NULL AND (a.site_id=c.site_id OR a.id=f.area_id)) ORDER BY c.updated_at DESC,c.id LIMIT 100`,
  );
  return rows.rows as { id: string; name: string; revision: number; updatedAt: string; buildingId: string | null; areaId: string | null; propertyName: string | null; sourceCount: number }[];
}

export async function reviewBuildingDetails(buildingId: string, expectedRevision: number) {
  const preparation = (await query(
    'SELECT body FROM building_preparations WHERE building_id=$1',
    [buildingId],
  )).rows[0]?.body ?? notFound();
  const continuation = await preparationContinuation(preparation.packageId);
  if (continuation.caseRevision !== expectedRevision ||
      !['ready', 'reviewed', 'recorded'].includes(continuation.status)) {
    conflict('The preparation changed. Build the current source facts before reviewing.');
  }
  if (continuation.review) return { review: continuation.review, created: false };
  const dossier = await buildingDossier(buildingId);
  const draftId = await importRegistryCase(dossier.area.siteId, preparation.caseId, expectedRevision);
  const draft = await draftDetail(draftId);
  return {
    review: await prepareRegistryReview(draftId, draft.revision, dossier.revisions.registry),
    created: true,
  };
}

export async function appendHumanPreparationFact(
  packageId: string,
  input: {
    expectedRevision: number;
    entityId?: string;
    subject?: string;
    property: typeof factProperties[number];
    value: unknown;
    unit?: string;
    referenceFrameId?: string;
    evidence: PreparationFactInput['evidence'];
  },
) {
  const pkg = await getPackage(packageId);
  const entityId = input.entityId ?? pkg.features[0]?.id;
  if (!entityId) throw new AppError(422, 'ENTITY_REQUIRED', 'This preparation has no physical entity to receive a fact.');
  const feature = pkg.features.find(candidate => candidate.id === entityId) ??
    notFound('Choose an entity from this preparation.');
  return appendPreparationFacts(packageId, input.expectedRevision, [{
    entityId,
    subject: input.subject,
    property: input.property,
    value: input.value,
    unit: input.unit,
    referenceFrameId: input.referenceFrameId,
    evidence: input.evidence,
    method: 'human_entry',
    evidenceState: 'source_supported',
    worldStatus: feature.worldStatus,
  }]);
}
