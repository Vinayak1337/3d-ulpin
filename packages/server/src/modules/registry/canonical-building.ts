import { createHash } from 'node:crypto';
import { NormalizedBuildingSchema, type AreaContext, type AreaFrame, type BuildingCitation, type BuildingDossier, type BuildingMultiPolygon,
  type BuildingValueState, type MapArea, type NormalizedBuilding, type PhysicalFeature, type SourceLocator, type Value } from '@ulpin/contracts';
import { buildingDossier } from '../officer/officer';
import { registryDocumentSourceAccessTx } from './registry-metadata';
import { areaFeatureContext, listAreas } from '../areas/areas';
import { transaction } from '../../infrastructure/db';
import { AppError, notFound } from '../../infrastructure/errors';
import { localOperatorSubject } from '../usp/principal';

export const ENU_METHOD = 'deterministic:wgs84-surface-to-enu@1';
export function canonicalFrame(area: MapArea): AreaFrame {
  return { areaId: area.id, origin: { lon: area.reference?.anchor[0] ?? null, lat: area.reference?.anchor[1] ?? null,
    hEllipsoidal: null }, axes: 'ENU', unit: 'm', placement: area.reference ? 'source_supported' : 'unknown',
    sourceCrs: area.reference ? [area.reference.sourceCrs] : [], verticalRefs: area.reference ? [area.reference.verticalReference] : [],
    horizontalOperation: area.reference ? ENU_METHOD : null };
}
/** WGS84 ellipsoid surface projection. h=0 is only the mathematical surface, not an asserted measured height. Up is never used as a source elevation. */
export function geographicToEnu(geometry: PhysicalFeature['geographicGeometry'] | undefined, frame: AreaFrame): BuildingMultiPolygon | null {
  const { lon, lat } = frame.origin;
  if (!geometry || lon === null || lat === null || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return null;
  const rad = Math.PI / 180, lambda = lon * rad, phi = lat * rad;
  const ecef = (longitude: number, latitude: number) => {
    const l = longitude * rad, p = latitude * rad, sin = Math.sin(p), n = 6378137 / Math.sqrt(1 - 0.0066943799901413165 * sin * sin);
    return [n * Math.cos(p) * Math.cos(l), n * Math.cos(p) * Math.sin(l), n * (1 - 0.0066943799901413165) * sin];
  };
  const origin = ecef(lon, lat);
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return (polygons as number[][][][]).map(polygon => polygon.map((ring, index) => {
    const points = ring.map(([x, y]): [number, number] => {
      const xyz = ecef(x, y).map((v, i) => v - origin[i]);
      return [-Math.sin(lambda) * xyz[0] + Math.cos(lambda) * xyz[1],
        -Math.sin(phi) * Math.cos(lambda) * xyz[0] - Math.sin(phi) * Math.sin(lambda) * xyz[1] + Math.cos(phi) * xyz[2]];
    });
    const area = points.slice(0, -1).reduce((a, p, i) => a + p[0] * points[i + 1][1] - points[i + 1][0] * p[1], 0);
    return (index === 0 ? area < 0 : area > 0) ? points.reverse() : points;
  }));
}
export function canonicalValue<T>(value: T | null, state: BuildingValueState = value === null ? 'unknown' : 'source_supported',
  citations: BuildingCitation[] = [], method = 'source_literal', unit?: string): Value<T> {
  return { value, state, citations, method, revisionId: 'pending', ...(unit ? { unit } : {}) };
}
export function projectionDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
/** Content-address the complete projection; every value is pinned to those exact dependencies. No store or capture write. */
export function finishBuilding(building: NormalizedBuilding): NormalizedBuilding {
  const revisionId = projectionDigest(building);
  const visit = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    if ('revisionId' in v) (v as { revisionId: string }).revisionId = revisionId;
    Object.values(v).forEach(visit);
  };
  visit(building);
  return NormalizedBuildingSchema.parse(building);
}
export async function assertCanonicalAreaScope(area: MapArea): Promise<MapArea> {
  const current = (await listAreas(false, undefined, true)).find(a => a.id === area.id);
  if (!current) throw new AppError(403, 'CANONICAL_AREA_DENIED', 'This area is not in the active local scope.');
  return current;
}
export async function canonicalCitations(evidence: readonly SourceLocator[], siteId: string): Promise<BuildingCitation[]> {
  const sources = new Map<string, Awaited<ReturnType<typeof registryDocumentSourceAccessTx>>>();
  for (const e of evidence) if (!sources.has(e.sourceRevisionId)) {
    sources.set(e.sourceRevisionId, await transaction(client => registryDocumentSourceAccessTx(client, siteId, e.sourceRevisionId)));
  }
  return evidence.map(e => ({ sourceId: e.sourceRevisionId, sourceSha256: sources.get(e.sourceRevisionId)!.sha256,
    locator: e.region && e.page ? { kind: 'region' as const, page: e.page, ...e.region }
      : e.featureId ? { kind: 'feature' as const, featureId: e.featureId }
      : e.page ? { kind: 'page' as const, page: e.page }
      : e.row !== undefined ? { kind: 'row' as const, row: e.row }
      : { kind: 'entity' as const, entityId: e.partId ?? e.jsonPointer ?? e.sourceRevisionId } }));
}
/** Recheck complete cited source access after assembly; one lookup per immutable original, no byte reads or writes. */
export async function revalidateCanonicalSources(projection: unknown, siteId: string): Promise<void> {
  const pins = new Map<string, string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if ('sourceId' in value && 'sourceSha256' in value) {
      const citation = value as BuildingCitation;
      const previous = pins.get(citation.sourceId);
      if (previous && previous !== citation.sourceSha256) throw new AppError(409, 'CANONICAL_SOURCE_CHANGED', 'A source changed during projection.');
      pins.set(citation.sourceId, citation.sourceSha256);
    }
    Object.values(value).forEach(visit);
  };
  visit(projection);
  const current = await canonicalCitations([...pins.keys()].map(sourceRevisionId => ({ sourceRevisionId })), siteId);
  if (current.some(c => pins.get(c.sourceId) !== c.sourceSha256))
    throw new AppError(409, 'CANONICAL_SOURCE_CHANGED', 'A source changed during projection.');
}
type CanonicalBuildingSource = Pick<BuildingDossier, 'building' | 'area' | 'records' | 'packages' | 'missing' | 'parcels' | 'parcelIdentifiers' | 'detailedScene'>;
export async function projectBuilding(dossier: CanonicalBuildingSource, proposal = dossier.building.revision === 0): Promise<NormalizedBuilding> {
  const f = dossier.building, frame = canonicalFrame(dossier.area);
  const citations = await canonicalCitations(f.evidence, dossier.area.siteId), heightCitations = await canonicalCitations(f.height.evidence ?? [], dossier.area.siteId);
  const polygons = geographicToEnu(f.geographicGeometry, frame);
  const state = proposal || f.semantics?.evidenceState === 'unresolved' ? 'candidate' : f.semantics?.evidenceState ?? 'source_supported';
  const role = f.geometryRole ?? f.semantics?.geometryRole;
  const kind = role === 'observed_roof_projection' ? 'roofprint' : role === 'observed_ground_occupation' ? 'ground_footprint' : null;
  const heightState = f.height.state === 'unresolved' ? 'candidate' : f.height.state;
  const height = f.height.value === null ? canonicalValue<number>(null, 'unknown', heightCitations, 'source_literal', 'm')
    : canonicalValue(f.height.value, heightState, heightCitations,
      f.height.method === 'human_entry' ? 'deterministic:legacy-human-entry-projection@1'
        : f.height.originalUnit === 'ft' ? 'deterministic:international-foot-to-metre@1'
        : f.height.method === 'derived' ? 'deterministic:retained-derived-height-projection@1' : 'source_literal', 'm');
  const building: NormalizedBuilding = { schemaVersion: 'normalized-building/1', buildingId: f.id, areaId: f.areaId,
    revisionId: 'pending', recordState: proposal ? 'candidate' : 'reviewed', frame, name: canonicalValue(f.name, 'source_supported', citations),
    inputRevisions: [{ namespace: 'area', id: dossier.area.id, revision: dossier.area.revision },
      { namespace: 'area_feature', id: f.id, revision: f.revision },
      ...dossier.records.map(r => ({ namespace: 'registry_record' as const, id: r.id, revision: r.revision })),
      ...dossier.packages.map(p => ({ namespace: 'import_package' as const, id: p.id, revision: p.revision }))], parcelRefs: [],
    footprint: canonicalValue(polygons, polygons ? state : 'unknown', citations, ENU_METHOD, 'm'),
    footprintKind: canonicalValue(kind, kind ? 'source_supported' : 'unknown', citations),
    baseM: canonicalValue<number>(null, 'unknown', [], 'source_literal', 'm'), heightM: height, heightState: height.state,
    storeyCount: canonicalValue<number>(f.semantics?.floorCount ?? null, f.semantics?.floorCount === undefined ? 'unknown' : 'source_supported', citations, 'source_literal', 'count'),
    storeyLabel: canonicalValue<string>(null), storeys: canonicalValue(null), levels: [], conflicts: [], gaps: [...dossier.missing], candidates: [] };
  if (!polygons) building.gaps.push('Footprint or geographic placement unavailable; no replacement geometry.');
  if (!kind) building.gaps.push('Source outline role is unknown; it is not asserted as a ground footprint or roofprint.');
  building.gaps.push('Measured base elevation unknown; scene uses building-relative bases, not surveyed terrain.');
  for (const parcel of dossier.parcels.filter(p => p.status === 'confirmed')) {
    const anchors = (dossier.parcelIdentifiers ?? []).filter(p => p.parcelId === parcel.feature.id && p.scheme === 'official_ulpin');
    const evidence = await canonicalCitations(anchors.flatMap(a => a.evidence.sourceRevisionId ? [{ sourceRevisionId: a.evidence.sourceRevisionId }] : []), dossier.area.siteId);
    building.parcelRefs.push({ parcelId: parcel.feature.id, officialUlpin: canonicalValue(anchors.length === 1 ? anchors[0].value : null,
      anchors.length > 1 ? 'conflicting' : anchors.length === 1 ? 'reviewed' : 'unknown', evidence) });
  }
  // Retain unresolved source statements, never pick the newest package or turn G+42 into 43 levels.
  for (const property of ['building.floorCount', 'building.storeyCount', 'building.storeyLabel', 'building.exteriorHeight']) {
    const claims = dossier.packages.flatMap(p => p.factCandidates).filter(c => c.entityId === f.id && c.property === property);
    const unique = [...new Map(claims.map(c => [JSON.stringify(c.value), c])).values()];
    if (unique.length > 1) {
      const alternatives = [];
      for (const c of unique) if (typeof c.value === 'string' || typeof c.value === 'number' || typeof c.value === 'boolean')
        alternatives.push(canonicalValue(c.value, c.method === 'ai_extraction' ? 'candidate' : c.evidenceState === 'unresolved' ? 'candidate' : c.evidenceState,
          await canonicalCitations(c.evidence, dossier.area.siteId), c.method === 'native_parse' ? 'source_literal' : 'deterministic:retained-claim-projection@1', c.unit));
      if (alternatives.length > 1) {
        building.conflicts.push({ property, alternatives, reason: 'Retained source claims disagree; no automatic selection.' });
        if (property.endsWith('floorCount') || property.endsWith('storeyCount')) building.storeyCount = canonicalValue(null, 'conflicting');
        if (property.endsWith('storeyLabel')) building.storeyLabel = canonicalValue(null, 'conflicting');
        if (property.endsWith('exteriorHeight')) { building.heightM = canonicalValue(null, 'conflicting', [], 'source_literal', 'm'); building.heightState = 'conflicting'; }
      }
    } else if (unique.length === 1 && property === 'building.storeyLabel' && typeof unique[0].value === 'string')
      building.storeyLabel = canonicalValue(unique[0].value, 'candidate', await canonicalCitations(unique[0].evidence, dossier.area.siteId));
  }
  const storeys: NonNullable<NormalizedBuilding['storeys']['value']> = [];
  for (const [order, detail] of dossier.detailedScene.filter(d => d.record.kind === 'floor').entries()) {
    const r = detail.record, buildingRelative = /building[-_]relative/i.test(detail.verticalReference ?? ''),
      boundsKnown = buildingRelative && detail.lower !== undefined && detail.upper !== undefined && detail.lower < detail.upper;
    if (!buildingRelative) building.gaps.push(`${r.id}: vertical reference is not explicitly building-relative; scene level bounds unavailable.`);
    const refs = await canonicalCitations(r.evidence.map(e => ({ sourceRevisionId: e.sourceId, partId: e.locator })), dossier.area.siteId);
    const lowerM = canonicalValue(boundsKnown ? detail.lower! : null, boundsKnown ? 'reviewed' : 'unknown', refs, 'source_literal', 'm');
    const upperM = canonicalValue(boundsKnown ? detail.upper! : null, boundsKnown ? 'reviewed' : 'unknown', refs, 'source_literal', 'm');
    const level = { levelId: r.id, order, label: canonicalValue(r.name, 'reviewed', refs, 'deterministic:recorded-level-label-projection@1'), lowerM, upperM,
      spaces: [] as NormalizedBuilding['levels'][number]['spaces'] };
    for (const space of dossier.detailedScene.filter(s => s.record.kind === 'space' && s.record.links.some(l => l.type === 'floor' && l.targetId === r.id))) {
      const p = geographicToEnu(space.geographicGeometry, frame);
      const ev = await canonicalCitations(space.record.evidence.map(e => ({ sourceRevisionId: e.sourceId, partId: e.locator })), dossier.area.siteId);
      const known = /building[-_]relative/i.test(space.verticalReference ?? '') && space.lower !== undefined && space.upper !== undefined && space.lower < space.upper;
      level.spaces.push({ spaceId: space.record.id,
        kind: space.record.use === 'common' ? canonicalValue('common', 'reviewed', ev, 'deterministic:recorded-space-use-projection@1') : canonicalValue(null),
        polygons: canonicalValue(p, p ? 'reviewed' : 'unknown', ev, ENU_METHOD, 'm'),
        lowerM: canonicalValue(known ? space.lower! : null, known ? 'reviewed' : 'unknown', ev, 'source_literal', 'm'),
        upperM: canonicalValue(known ? space.upper! : null, known ? 'reviewed' : 'unknown', ev, 'source_literal', 'm'), proposedCode: canonicalValue(null) });
    }
    building.levels.push(level);
    const storeyPolygons = geographicToEnu(detail.geographicGeometry, frame);
    storeys.push({ levelId: r.id, label: level.label, lowerM, upperM, belowGround: canonicalValue(null), open: canonicalValue(null), roof: canonicalValue(null),
      polygons: canonicalValue(storeyPolygons, storeyPolygons ? 'reviewed' : 'unknown', refs, ENU_METHOD, 'm') });
  }
  if (storeys.length) building.storeys = canonicalValue(storeys, 'reviewed', [], 'deterministic:recorded-level-schedule-projection@1');
  return finishBuilding(building);
}
export async function canonicalBuilding(buildingId: string, revision = 'current', retainedContext?: AreaContext): Promise<NormalizedBuilding> {
  localOperatorSubject();
  const context = retainedContext ?? await areaFeatureContext(buildingId);
  await assertCanonicalAreaScope(context.area);
  const feature = (context.displayFeatures ?? context.features).find(f => f.id === buildingId);
  if (!feature || feature.kind !== 'building') notFound('Building not found.');
  const proposal = feature.revision === 0 || ('displayState' in feature && feature.displayState === 'unrecorded_proposal');
  const dossier: CanonicalBuildingSource = !proposal ? await buildingDossier(buildingId) : {
    building: feature, area: context.area, parcels: [], records: [], detailedScene: [],
    packages: context.packages.filter(p => p.features.some(f => f.id === buildingId)),
    missing: ['Unrecorded source proposal; candidate geometry is not registry truth or analytically eligible.', 'No detailed level schedule or spaces assessed for this proposal.'],
  };
  if (dossier.area.revision !== context.area.revision || dossier.building.revision !== feature.revision)
    throw new AppError(409, 'CANONICAL_INPUT_CHANGED', 'Area or building changed during projection; read again.');
  const result = await projectBuilding(dossier, proposal);
  await revalidateCanonicalSources(result, context.area.siteId);
  if ((await assertCanonicalAreaScope(context.area)).revision !== context.area.revision)
    throw new AppError(409, 'CANONICAL_INPUT_CHANGED', 'The area changed during projection; read again.');
  if (revision !== 'current' && revision !== result.revisionId)
    throw new AppError(404, 'CANONICAL_REVISION_NOT_FOUND', 'That complete projection revision is not current. Historical constituent revisions do not reconstruct a complete building snapshot.');
  return result;
}
