import {
  NormalizedAreaSchema,
  RetainedImagerySchema,
  SourceAdministrativeContextSchema,
  type AreaContext,
  type AreaFrame,
  type BuildingValueState,
  type NormalizedArea,
  type NormalizedBuilding,
  type PhysicalFeature,
} from '@ulpin/contracts';
import { areaContext } from './areas';
import { query } from '../../infrastructure/db';
import { AppError } from '../../infrastructure/errors';
import {
  assertCanonicalAreaScope,
  canonicalBuilding,
  canonicalCitations,
  canonicalFrame,
  canonicalValue,
  geographicToEnu,
  geographicPointToEnu,
  ENU_METHOD,
  projectionDigest,
  revalidateCanonicalSources,
} from '../registry/canonical-building';
import { localOperatorSubject } from '../usp/principal';
import { addRoofprintCandidates } from '../spatial/spatial-ml-canonical-candidates';

type BaseFeature = NormalizedArea['baseFeatures'][number];
type ContextFeature = NonNullable<AreaContext['displayFeatures']>[number];

const BUILDING_BATCH_SIZE = 4;
const NO_TILESET_GAP =
  'No qualified overlay/tileset supplied by the area context; presentation scene assets are not analytical tilesets.';

function contextFeatures(context: AreaContext): ContextFeature[] {
  return context.displayFeatures ?? context.features;
}

/** Bound concurrent use of the existing register reader (no competing graph/SQL authority). */
async function projectBuildings(context: AreaContext): Promise<NormalizedBuilding[]> {
  const buildings: NormalizedBuilding[] = [];
  const features = contextFeatures(context).filter(feature => feature.kind === 'building');
  for (let start = 0; start < features.length; start += BUILDING_BATCH_SIZE) {
    const batch = features.slice(start, start + BUILDING_BATCH_SIZE);
    buildings.push(...await Promise.all(batch.map(feature => canonicalBuilding(feature.id, 'current', context))));
  }
  return buildings;
}

function summarizeBuilding(building: NormalizedBuilding): NormalizedArea['buildings'][number] {
  return {
    buildingId: building.buildingId,
    revisionId: building.revisionId,
    recordState: building.recordState,
    name: building.name,
    footprint: building.footprint,
    heightM: building.heightM,
    heightState: building.heightState,
  };
}

function isUnrecordedProposal(feature: ContextFeature): boolean {
  return feature.revision === 0 || ('displayState' in feature && feature.displayState === 'unrecorded_proposal');
}

function footprintState(feature: ContextFeature, hasPolygons: boolean): BuildingValueState {
  if (!hasPolygons) return 'unknown';
  return isUnrecordedProposal(feature) ? 'candidate' : 'source_supported';
}

function bandState(band: PhysicalFeature['verticalExtent']): BuildingValueState {
  if (band?.evidenceState === 'unresolved') return 'candidate';
  return band?.evidenceState ?? 'unknown';
}

async function projectBaseFeature(
  feature: ContextFeature,
  context: AreaContext,
  frame: AreaFrame,
): Promise<{ base: BaseFeature; hasPolygons: boolean }> {
  const citations = await canonicalCitations(feature.evidence, context.area.siteId);
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

async function addBaseFeatures(result: NormalizedArea, context: AreaContext, frame: AreaFrame): Promise<void> {
  for (const feature of contextFeatures(context).filter(item => item.kind !== 'building')) {
    const { base, hasPolygons } = await projectBaseFeature(feature, context, frame);
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
      ], context.area.siteId);
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
      ], context.area.siteId);
      const preview = rows.find(row => row.source_id === chip.sourceId)?.body.result?.raster.url;
      result.overlays.push({ id: chip.sourceId, kind: 'image', corners: corners as [
        [number, number], [number, number], [number, number], [number, number],
      ], originalUrl: preview ?? `/api/v1/cases/${pkg.sourceWorkspace?.caseId}/sources/${chip.sourceId}/file`, citations });
    }
  }
  if (result.imagery?.length) {
    result.gaps.push('RAMP imagery is test_only display context; native GeoTIFF display needs a decoder or ML RGB preview.');
  }
}

export async function canonicalArea(areaId: string): Promise<NormalizedArea> {
  localOperatorSubject();
  const context = await areaContext(areaId);
  const frame = canonicalFrame(context.area);
  await assertCanonicalAreaScope(context.area);
  const buildings = await projectBuildings(context);
  const result: NormalizedArea = {
    schemaVersion: 'normalized-building/1',
    revisionId: 'pending',
    frame,
    buildings: buildings.map(summarizeBuilding),
    baseFeatures: [],
    overlays: [],
    tilesets: [],
    gaps: [NO_TILESET_GAP],
  };
  if (!context.area.reference) result.gaps.push('Geographic placement unknown; no invented ENU origin.');
  await addBaseFeatures(result, context, frame);
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
  await revalidateCanonicalSources(result, context.area.siteId);
  if ((await assertCanonicalAreaScope(context.area)).revision !== context.area.revision) {
    throw new AppError(409, 'CANONICAL_INPUT_CHANGED', 'The area changed during projection; read again.');
  }
  return NormalizedAreaSchema.parse(result);
}
