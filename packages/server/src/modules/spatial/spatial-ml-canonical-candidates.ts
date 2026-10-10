import type { AreaContext, NormalizedArea, SpatialMlItem } from '@ulpin/contracts';
import { BuildingCandidateRefSchema, RetainedImagerySchema } from '@ulpin/contracts';
import { query } from '../../infrastructure/db';
import { canonicalCitations, geographicToEnu } from '../registry/canonical-building';
import { geographicMlComponent } from './spatial-ml-georeference';

async function retainedReviews(item: SpatialMlItem) {
  const reviews = new Map<string, NonNullable<NormalizedArea['candidates']>[number]['review']>();
  const rows = (await query<{ body: { jobId: string; decisions?: unknown[] } }>(
    `SELECT body FROM spatial_ml_footprint_drafts WHERE item_id=$1
      ORDER BY body#>>'{decisions,0,time}' DESC NULLS LAST,request_key DESC`, [item.id],
  )).rows;
  for (const { body } of rows) {
    if (body.jobId !== item.currentJobId) continue;
    for (const raw of body.decisions ?? []) {
      const value = raw as { componentId?: string };
      if (!value.componentId || reviews.has(value.componentId)) continue;
      const { componentId: _, ...review } = raw as Record<string, unknown>;
      reviews.set(value.componentId, BuildingCandidateRefSchema.shape.review.unwrap().parse(review));
    }
  }
  return reviews;
}

/** Expose current retained outputs, never publisher polygons or cached replacement truth. */
export async function addRoofprintCandidates(result: NormalizedArea, context: AreaContext): Promise<void> {
  result.candidates = [];
  for (const pkg of context.packages) {
    if (!('imagery' in pkg)) continue;
    const imagery = RetainedImagerySchema.parse(pkg.imagery);
    const rows = (await query<{ body: SpatialMlItem }>(
      "SELECT body FROM spatial_ml_items WHERE package_id=$1 AND body->>'state'='succeeded' ORDER BY id", [pkg.id],
    )).rows;
    for (const { body: item } of rows) {
      const chip = imagery.chips.find(value => value.sourceId === item.sourceRevisionId);
      if (!chip || !item.result) continue;
      const citations = await canonicalCitations([{ sourceRevisionId: chip.sourceId, page: item.page }],
        context.area.siteId);
      const reviews = await retainedReviews(item);
      for (const component of item.result.components) {
        const geographic = geographicMlComponent(item, chip, component);
        const review = reviews.get(component.id);
        result.candidates.push({ candidateId: component.id, task: 'building_roofprints', taskVersion: '1',
          inputManifest: `source:${chip.sourceId}@${chip.sourceSha256}`,
          outputRef: `/api/v1/spatial-ml/items/${item.id}#components/${component.id}`,
          state: review ? 'reviewed' : 'candidate', kind: 'roofprint', review,
          method: `model:${item.modelId}@${item.modelSha256}`, modelId: item.modelId, modelHash: item.modelSha256,
          confidence: component.score, confidenceCalibration: 'uncalibrated', citations,
          polygons: geographicToEnu(geographic.geometry, result.frame), coordinateFrame: `area:${context.area.id}:enu`,
          levelId: null, limitations: ['test_only', 'Recall below preregistered target',
            'Roof projection, not surveyed ground footprint; no height, level, ownership or rights',
            'Confidence is uncalibrated; no new evaluation or analytical qualification',
            'Review is source-candidate selection only, not registry recording or independent ground truth'] });
      }
    }
  }
}
