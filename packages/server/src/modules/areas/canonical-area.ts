import {
  NormalizedAreaSchema,
  RetainedImagerySchema,
  SourceAdministrativeContextSchema,
  type AreaContext,
  type AreaFrame,
  type BuildingCitation,
  type BuildingValueState,
  type NormalizedArea,
  type PhysicalFeature,
} from '@ulpin/contracts';
import { AREA_DISPLAY_LIMIT, areaContext } from './areas';
import { query } from '../../infrastructure/db';
import { AppError } from '../../infrastructure/errors';
import {
  assertCanonicalAreaScope,
  buildingState,
  canonicalCitations,
  canonicalFeatureName,
  canonicalFrame,
  canonicalValue,
  geographicToEnu,
  geographicPointToEnu,
  ENU_METHOD,
  projectHeight,
  projectionDigest,
  revalidateCanonicalSources,
} from '../registry/canonical-building';
import { localOperatorSubject } from '../usp/principal';
import { addRoofprintCandidates } from '../spatial/spatial-ml-canonical-candidates';

type BaseFeature = NormalizedArea['baseFeatures'][number];
type BuildingSummary = NormalizedArea['buildings'][number];
type ContextFeature = NonNullable<AreaContext['displayFeatures']>[number];
type FeatureCitations = Map<string, { evidence: BuildingCitation[]; height: BuildingCitation[] }>;

const NO_TILESET_GAP =
  'No qualified overlay/tileset supplied by the area context; presentation scene assets are not analytical tilesets.';
const SUMMARY_GAP = "Area building summaries show each recorded feature's own name, footprint and height; "
  + "its retained claims, levels and parcels are in the building's own record.";

function contextFeatures(context: AreaContext): ContextFeature[] {
  return context.displayFeatures ?? context.features;
}

function isUnrecordedProposal(feature: ContextFeature): boolean {
  return feature.revision === 0 || ('displayState' in feature && feature.displayState === 'unrecorded_proposal');
}

function footprintState(feature: ContextFeature, hasPolygons: boolean): BuildingValueState {
  if (!hasPolygons) return 'unknown';
  return isUnrecordedProposal(feature) ? 'candidate' : 'source_supported';
}

/**
 * Every feature's citations from one read per cited original: an area cites few originals across many features,
 * so the citations of all features are read together and split back in order. A converted layer's source that
 * records this area as its own map area (S9.5a) is read here although its batch case keeps the batch area's site.
 */
async function areaCitations(
  features: readonly ContextFeature[], area: AreaContext['area'],
): Promise<FeatureCitations> {
  const entries = features.flatMap(feature => [...feature.evidence, ...(feature.height.evidence ?? [])]);
  const citations = await canonicalCitations(entries, area.siteId, area.id);
  const result: FeatureCitations = new Map();
  let offset = 0;
  for (const feature of features) {
    const evidence = citations.slice(offset, offset + feature.evidence.length);
    offset += evidence.length;
    const height = citations.slice(offset, offset + (feature.height.evidence?.length ?? 0));
    offset += height.length;
    result.set(feature.id, { evidence, height });
  }
  return result;
}

/** One building of the area from its own recorded feature, content-addressed by what it shows. */
function summarizeBuilding(feature: ContextFeature, frame: AreaFrame, citations: FeatureCitations): BuildingSummary {
  const proposal = isUnrecordedProposal(feature);
  const cited = citations.get(feature.id)!;
  const polygons = geographicToEnu(feature.geographicGeometry, frame);
  const state = buildingState(feature, proposal);
  const heightM = projectHeight(feature, cited.height);
  const summary: BuildingSummary = {
    buildingId: feature.id,
    revisionId: 'pending',
    recordState: proposal ? 'candidate' : 'reviewed',
    name: canonicalFeatureName(feature, cited.evidence),
    footprint: canonicalValue(polygons, polygons ? state : 'unknown', cited.evidence, ENU_METHOD, 'm'),
    heightM,
    heightState: heightM.state,
  };
  summary.revisionId = projectionDigest(summary);
  for (const value of [summary.name, summary.footprint, summary.heightM]) value.revisionId = summary.revisionId;
  return summary;
}

function bandState(band: PhysicalFeature['verticalExtent']): BuildingValueState {
  if (band?.evidenceState === 'unresolved') return 'candidate';
  return band?.evidenceState ?? 'unknown';
}

function projectBaseFeature(
  feature: ContextFeature,
  frame: AreaFrame,
  citations: BuildingCitation[],
): { base: BaseFeature; hasPolygons: boolean } {
  const polygons = geographicToEnu(feature.geographicGeometry, frame);
  const band = feature.verticalExtent;
  const state = bandState(band);
  const base: BaseFeature = {
    id: feature.id,
    kind: feature.kind as BaseFeature['kind'],
    polygons: canonicalValue(polygons, footprintState(feature, polygons !== null), citations, ENU_METHOD, 'm'),
    name: canonicalValue(feature.name, 'source_supported', citations),
    lowerM: canonicalValue(band?.lower ?? null, state, citations, 'source_literal', 'm'),
    upperM: canonicalValue(band?.upper ?? null, state, citations, 'source_literal', 'm'),
    network: canonicalValue<string>(null),
  };
  return { base, hasPolygons: polygons !== null };
}

function addBaseFeatures(result: NormalizedArea, features: ContextFeature[], citations: FeatureCitations): void {
  for (const feature of features.filter(item => item.kind !== 'building')) {
    const { base, hasPolygons } = projectBaseFeature(feature, result.frame, citations.get(feature.id)!.evidence);
    result.baseFeatures.push(base);
    if (!hasPolygons) {
      result.gaps.push(`${feature.id}: non-polygon context retained in source; no guessed ribbon width or area.`);
    }
  }
}

async function administrativeContext(
  context: AreaContext, frame: AreaFrame,
): Promise<NonNullable<NormalizedArea['administrativeContext']>> {
  const result: NonNullable<NormalizedArea['administrativeContext']> = [];
  for (const pkg of context.packages) {
    if (pkg.state !== 'COMMITTED' || !('administrativeContext' in pkg)) continue;
    const source = SourceAdministrativeContextSchema.parse(pkg.administrativeContext);
    for (const unit of source.units) {
      const citations = await canonicalCitations([
        { sourceRevisionId: source.sourceId, featureId: unit.sourceKey },
      ], context.area.siteId, context.area.id);
      const geometry = { type: 'Polygon', coordinates: unit.rings };
      const row = (await query<{ geometry: PhysicalFeature['geographicGeometry'] }>(
        'SELECT ST_AsGeoJSON(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1),$2),4326))::jsonb geometry',
        [JSON.stringify(geometry), Number(source.sourceCrs.split(':')[1])],
      )).rows[0];
      const polygons = geographicToEnu(row.geometry, frame);
      result.push({
        id: unit.id, kind: unit.kind, role: 'administrative_context', analyticalEligibility: 'not_assessed',
        sourceCrs: source.sourceCrs, name: canonicalValue(unit.name, 'source_supported', citations),
        polygons: canonicalValue(polygons, polygons ? 'candidate' : 'unknown', citations,
          'deterministic:administrative-boundary-source-to-enu@1', 'm'),
      });
    }
  }
  return result;
}

function imageryCorners(
  chip: NonNullable<NormalizedArea['imagery']>[number]['chips'][number], frame: AreaFrame,
): [number, number][] | null {
  const [scaleX, , originX, , scaleY, originY] = chip.affine;
  const corners = [[0, 0], [chip.width, 0], [chip.width, chip.height], [0, chip.height]]
    .map(([x, y]) => geographicPointToEnu([originX + scaleX * x, originY + scaleY * y], frame));
  return corners.every(corner => corner !== null) ? corners as [number, number][] : null;
}

export function imageryOriginalUrl(sourceId: string): string {
  return `/api/v1/sources/${sourceId}/file`;
}

async function addImagery(result: NormalizedArea, context: AreaContext): Promise<void> {
  for (const pkg of context.packages) {
    if (pkg.state === 'RECEIVED' || !('imagery' in pkg)) continue;
    const imagery = RetainedImagerySchema.parse(pkg.imagery);
    result.imagery ??= [];
    result.imagery.push(imagery);
    const rows = (await query<{ source_id: string; body: { result?: { raster: { url: string } } } }>(
      `SELECT source_id,body FROM spatial_ml_items WHERE package_id=$1
        AND body->>'state' IN ('succeeded','empty') ORDER BY created_at DESC`, [pkg.id],
    )).rows;
    for (const chip of imagery.chips) {
      const corners = imageryCorners(chip, result.frame);
      if (!corners) continue;
      const citations = await canonicalCitations([
        { sourceRevisionId: chip.sourceId, jsonPointer: `publisher chip ${chip.chipId}` },
      ], context.area.siteId, context.area.id);
      const preview = rows.find(row => row.source_id === chip.sourceId)?.body.result?.raster.url;
      result.overlays.push({ id: chip.sourceId, kind: 'image', corners: corners as [
        [number, number], [number, number], [number, number], [number, number],
      ], originalUrl: preview ?? imageryOriginalUrl(chip.sourceId), citations });
    }
  }
  if (result.imagery?.length) {
    result.gaps.push('RAMP imagery is test_only display context; '
      + 'native GeoTIFF display needs a decoder or ML RGB preview.');
  }
}

export async function canonicalArea(areaId: string): Promise<NormalizedArea> {
  localOperatorSubject();
  const context = await areaContext(areaId, AREA_DISPLAY_LIMIT);
  const frame = canonicalFrame(context.area);
  await assertCanonicalAreaScope(context.area);
  const features = contextFeatures(context);
  const citations = await areaCitations(features, context.area);
  const result: NormalizedArea = {
    schemaVersion: 'normalized-building/1',
    revisionId: 'pending',
    frame,
    buildings: features.filter(feature => feature.kind === 'building')
      .map(feature => summarizeBuilding(feature, frame, citations)),
    baseFeatures: [],
    overlays: [],
    tilesets: [],
    gaps: [NO_TILESET_GAP, SUMMARY_GAP],
  };
  if (!context.area.reference) result.gaps.push('Geographic placement unknown; no invented ENU origin.');
  addBaseFeatures(result, features, citations);
  await addImagery(result, context);
  await addRoofprintCandidates(result, context);
  const administration = await administrativeContext(context, frame);
  if (administration.length) {
    result.administrativeContext = administration;
    result.gaps.push('Sector boundaries are administrative context, not parcel/public-land or analytical geometry.');
  }
  result.revisionId = projectionDigest(result);
  // Building values retain their building dependency revision. Context values pin the complete area projection.
  for (const feature of result.baseFeatures) {
    for (const value of [feature.polygons, feature.name, feature.lowerM, feature.upperM, feature.network]) {
      value.revisionId = result.revisionId;
    }
  }
  for (const unit of result.administrativeContext ?? []) {
    unit.name.revisionId = result.revisionId;
    unit.polygons.revisionId = result.revisionId;
  }
  await revalidateCanonicalSources(result, context.area.siteId, context.area.id);
  if ((await assertCanonicalAreaScope(context.area)).revision !== context.area.revision) {
    throw new AppError(409, 'CANONICAL_INPUT_CHANGED', 'The area changed during projection; read again.');
  }
  return NormalizedAreaSchema.parse(result);
}
