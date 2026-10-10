import { createHash } from 'node:crypto';
import {
  BuildingConflictDecisionSchema,
  ClaimTranscriptionSchema,
  type BuildingConflictDecision,
  NormalizedBuildingSchema,
  type AreaContext,
  type AreaFrame,
  type BuildingCitation,
  type BuildingDossier,
  type BuildingMultiPolygon,
  type BuildingValueState,
  type DetailedSceneRecord,
  type FactCandidate,
  type MapArea,
  type NormalizedBuilding,
  type ParcelIdentifier,
  type PhysicalFeature,
  type RegistryRecord,
  type SourceLocator,
  type Value,
} from '@ulpin/contracts';
import { buildingDossier } from '../officer/officer';
import { registryDocumentSourceAccessTx } from './registry-metadata';
import { areaFeatureContext, listAreas } from '../areas/areas';
import { query, transaction } from '../../infrastructure/db';
import { sourceBuildingOriginalAccessTx } from '../usp/ingestion/source-building-review';
import { SOURCE_BUILDING_GAP } from '../usp/ingestion/source-building-values';
import { rasterSourceTx } from '../usp/ingestion/raster-window';
import { AppError, notFound } from '../../infrastructure/errors';
import { localOperatorSubject } from '../usp/principal';
import { applyLevelSchedules, UNREVIEWED_LEVEL_SCHEDULE_GAP } from './canonical-level-schedule';

export const ENU_METHOD = 'deterministic:wgs84-surface-to-enu@1';
const WGS84_A = 6378137;
const WGS84_E2 = 0.0066943799901413165;
const DEGREES_TO_RADIANS = Math.PI / 180;
const PROPOSAL_MISSING = [
  'Unrecorded source proposal; candidate geometry is not registry truth or analytically eligible.',
  'No detailed level schedule or spaces assessed for this proposal.',
];
const REVISION_NOT_CURRENT_MESSAGE =
  'That complete projection revision is not current. '
  + 'Historical constituent revisions do not reconstruct a complete building snapshot.';
/** Retained claim properties whose disagreement must stay visible as a conflict. */
const CLAIM_PROPERTIES = [
  'building.floorCount',
  'building.storeyCount',
  'building.storeyLabel',
  'building.exteriorHeight',
];

type CanonicalBuildingSource = Pick<
  BuildingDossier,
  'building' | 'area' | 'records' | 'packages' | 'missing' | 'parcels' | 'parcelIdentifiers' | 'detailedScene'
>;
type CanonicalLevel = NormalizedBuilding['levels'][number];
type CanonicalSpace = CanonicalLevel['spaces'][number];
type CanonicalStorey = NonNullable<NormalizedBuilding['storeys']['value']>[number];
type FootprintKind = 'roofprint' | 'ground_footprint' | null;
type Xyz = [number, number, number];

export function canonicalFrame(area: MapArea): AreaFrame {
  const reference = area.reference;
  return {
    areaId: area.id,
    origin: {
      lon: reference?.anchor[0] ?? null,
      lat: reference?.anchor[1] ?? null,
      hEllipsoidal: null,
    },
    axes: 'ENU',
    unit: 'm',
    placement: reference ? 'source_supported' : 'unknown',
    sourceCrs: reference ? [reference.sourceCrs] : [],
    verticalRefs: reference ? [reference.verticalReference] : [],
    horizontalOperation: reference ? ENU_METHOD : null,
  };
}

function toEcef(lon: number, lat: number): Xyz {
  const longitude = lon * DEGREES_TO_RADIANS;
  const latitude = lat * DEGREES_TO_RADIANS;
  const sin = Math.sin(latitude);
  const radius = WGS84_A / Math.sqrt(1 - WGS84_E2 * sin * sin);
  return [
    radius * Math.cos(latitude) * Math.cos(longitude),
    radius * Math.cos(latitude) * Math.sin(longitude),
    radius * (1 - WGS84_E2) * sin,
  ];
}

function ecefToEnu(xyz: Xyz, origin: Xyz, lambda: number, phi: number): [number, number] {
  const dx = xyz[0] - origin[0];
  const dy = xyz[1] - origin[1];
  const dz = xyz[2] - origin[2];
  return [
    -Math.sin(lambda) * dx + Math.cos(lambda) * dy,
    -Math.sin(phi) * Math.cos(lambda) * dx - Math.sin(phi) * Math.sin(lambda) * dy + Math.cos(phi) * dz,
  ];
}

/** Make outer rings counter-clockwise and holes clockwise, as the contract requires. */
function orientRing(points: [number, number][], isOuter: boolean): [number, number][] {
  const signedArea = points
    .slice(0, -1)
    .reduce((sum, point, index) => sum + point[0] * points[index + 1][1] - points[index + 1][0] * point[1], 0);
  const needsReverse = isOuter ? signedArea < 0 : signedArea > 0;
  return needsReverse ? points.reverse() : points;
}

/** A surface point for image-corner placement, not an elevation or physical control. */
export function geographicPointToEnu(point: [number, number], frame: AreaFrame): [number, number] | null {
  const { lon, lat } = frame.origin;
  if (lon === null || lat === null) return null;
  return ecefToEnu(toEcef(...point), toEcef(lon, lat), lon * DEGREES_TO_RADIANS, lat * DEGREES_TO_RADIANS);
}

/**
 * WGS84 ellipsoid surface projection. h=0 is only the mathematical surface, not an asserted measured height.
 * Up is never used as a source elevation.
 */
export function geographicToEnu(
  geometry: PhysicalFeature['geographicGeometry'] | undefined,
  frame: AreaFrame,
): BuildingMultiPolygon | null {
  const { lon, lat } = frame.origin;
  if (!geometry || lon === null || lat === null || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return null;
  const lambda = lon * DEGREES_TO_RADIANS;
  const phi = lat * DEGREES_TO_RADIANS;
  const origin = toEcef(lon, lat);
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return (polygons as number[][][][]).map(polygon => polygon.map((ring, index) => {
    const points = ring.map(([x, y]) => ecefToEnu(toEcef(x, y), origin, lambda, phi));
    return orientRing(points, index === 0);
  }));
}

export function canonicalValue<T>(
  value: T | null,
  state: BuildingValueState = value === null ? 'unknown' : 'source_supported',
  citations: BuildingCitation[] = [],
  method = 'source_literal',
  unit?: string,
): Value<T> {
  return { value, state, citations, method, revisionId: 'pending', ...(unit ? { unit } : {}) };
}

export function projectionDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function pinRevision(value: unknown, revisionId: string): void {
  if (!value || typeof value !== 'object') return;
  if ('revisionId' in value) (value as { revisionId: string }).revisionId = revisionId;
  Object.values(value).forEach(child => pinRevision(child, revisionId));
}

/** Content-address the complete projection; every value is pinned to those dependencies. No store or capture write. */
export function finishBuilding(building: NormalizedBuilding): NormalizedBuilding {
  pinRevision(building, projectionDigest(building));
  return NormalizedBuildingSchema.parse(building);
}

export async function assertCanonicalAreaScope(area: MapArea): Promise<MapArea> {
  const current = (await listAreas(false, undefined, true)).find(candidate => candidate.id === area.id);
  if (!current) throw new AppError(403, 'CANONICAL_AREA_DENIED', 'This area is not in the active local scope.');
  return current;
}

function citationLocator(entry: SourceLocator): BuildingCitation['locator'] {
  if (entry.region && entry.page) return { kind: 'region', page: entry.page, ...entry.region };
  if (entry.featureId) return { kind: 'feature', featureId: entry.featureId };
  if (entry.page) {
    return { kind: 'page', page: entry.page, ...(entry.jsonPointer ? { text: entry.jsonPointer } : {}) };
  }
  if (entry.row !== undefined) return { kind: 'row', row: entry.row };
  return { kind: 'entity', entityId: entry.partId ?? entry.jsonPointer ?? entry.sourceRevisionId };
}

async function readSourceSha256(sourceId: string, siteId: string): Promise<string> {
  const access = await transaction(async client => {
    const row = (await client.query('SELECT case_id,profile FROM sources WHERE id=$1', [sourceId])).rows[0];
    if (row?.profile === 'geotiff-raster-v1') {
      const context = await rasterSourceTx(client, row.case_id, sourceId);
      if (context.current.site_id !== siteId || !context.latest) {
        throw new AppError(403, 'CANONICAL_RASTER_DENIED', 'This raster original is outside the current site.');
      }
      return context.source;
    }
    const sourceOnly = (await client.query(
      "SELECT 1 FROM import_packages WHERE body->>'geometryFree'='true' AND body->'sourceRevisionIds' ? $1 LIMIT 1",
      [sourceId],
    )).rows.length > 0;
    if (sourceOnly) return sourceBuildingOriginalAccessTx(client, siteId, sourceId);
    return registryDocumentSourceAccessTx(client, siteId, sourceId);
  });
  return access.sha256;
}

export async function canonicalCitations(
  evidence: readonly SourceLocator[],
  siteId: string,
): Promise<BuildingCitation[]> {
  const shaBySource = new Map<string, string>();
  const citations: BuildingCitation[] = [];
  for (const entry of evidence) {
    const sourceId = entry.sourceRevisionId;
    let sourceSha256 = shaBySource.get(sourceId);
    if (sourceSha256 === undefined) {
      sourceSha256 = await readSourceSha256(sourceId, siteId);
      shaBySource.set(sourceId, sourceSha256);
    }
    citations.push({ sourceId, sourceSha256, locator: citationLocator(entry) });
  }
  return citations;
}

function sourceChanged(): AppError {
  return new AppError(409, 'CANONICAL_SOURCE_CHANGED', 'A source changed during projection.');
}

function visitCitationPins(value: unknown, pins: Map<string, string>): void {
  if (!value || typeof value !== 'object') return;
  if ('sourceId' in value && 'sourceSha256' in value) {
    const citation = value as BuildingCitation;
    const previous = pins.get(citation.sourceId);
    if (previous && previous !== citation.sourceSha256) throw sourceChanged();
    pins.set(citation.sourceId, citation.sourceSha256);
  }
  Object.values(value).forEach(child => visitCitationPins(child, pins));
}

/** Every citation's source pin; throws when one source has two different hashes inside the projection. */
export function collectCanonicalCitationPins(projection: unknown): Map<string, string> {
  const pins = new Map<string, string>();
  visitCitationPins(projection, pins);
  return pins;
}

/** Recheck complete cited source access after assembly; one lookup per immutable original, no byte reads or writes. */
export async function revalidateCanonicalSources(projection: unknown, siteId: string): Promise<void> {
  const pins = collectCanonicalCitationPins(projection);
  const current = await canonicalCitations([...pins.keys()].map(sourceRevisionId => ({ sourceRevisionId })), siteId);
  if (current.some(citation => pins.get(citation.sourceId) !== citation.sourceSha256)) throw sourceChanged();
}

function footprintKind(role: PhysicalFeature['geometryRole']): FootprintKind {
  if (role === 'observed_roof_projection') return 'roofprint';
  if (role === 'observed_ground_occupation') return 'ground_footprint';
  return null;
}

function buildingState(feature: PhysicalFeature, proposal: boolean): BuildingValueState {
  const evidenceState = feature.semantics?.evidenceState;
  if (proposal || evidenceState === 'unresolved') return 'candidate';
  return evidenceState ?? 'source_supported';
}

function heightMethod(height: PhysicalFeature['height']): string {
  if (height.method === 'human_entry') return 'deterministic:legacy-human-entry-projection@1';
  if (height.originalUnit === 'ft') return 'deterministic:international-foot-to-metre@1';
  if (height.method === 'derived') return 'deterministic:retained-derived-height-projection@1';
  return 'source_literal';
}

function projectHeight(feature: PhysicalFeature, citations: BuildingCitation[]): Value<number> {
  const { height } = feature;
  if (height.value === null) return canonicalValue<number>(null, 'unknown', citations, 'source_literal', 'm');
  const state: BuildingValueState = height.state === 'unresolved' ? 'candidate' : height.state;
  return canonicalValue(height.value, state, citations, heightMethod(height), 'm');
}

function storeyCountValue(feature: PhysicalFeature, citations: BuildingCitation[]): Value<number> {
  const floorCount = feature.semantics?.floorCount;
  const state = floorCount === undefined ? 'unknown' : 'source_supported';
  return canonicalValue<number>(floorCount ?? null, state, citations, 'source_literal', 'count');
}

function inputRevisions(dossier: CanonicalBuildingSource): NormalizedBuilding['inputRevisions'] {
  const feature = dossier.building;
  return [
    { namespace: 'area', id: dossier.area.id, revision: dossier.area.revision },
    { namespace: 'area_feature', id: feature.id, revision: feature.revision },
    ...dossier.records.map(record => ({
      namespace: 'registry_record' as const,
      id: record.id,
      revision: record.revision,
    })),
    ...dossier.packages.map(pack => ({
      namespace: 'import_package' as const,
      id: pack.id,
      revision: pack.revision,
    })),
  ];
}

export function canonicalFeatureName(feature: PhysicalFeature, citations: BuildingCitation[]): Value<string> {
  const derived = Boolean(feature.properties.spatialExtraction);
  return canonicalValue(feature.name, derived ? 'candidate' : 'source_supported', citations,
    derived ? 'deterministic:retained-candidate-alias@1' : 'source_literal');
}

function baseBuilding(
  dossier: CanonicalBuildingSource,
  frame: AreaFrame,
  citations: BuildingCitation[],
  heightValue: Value<number>,
  polygons: BuildingMultiPolygon | null,
  kind: FootprintKind,
  state: BuildingValueState,
  proposal: boolean,
): NormalizedBuilding {
  const feature = dossier.building;
  return {
    schemaVersion: 'normalized-building/1',
    buildingId: feature.id,
    areaId: feature.areaId,
    revisionId: 'pending',
    recordState: proposal ? 'candidate' : 'reviewed',
    frame,
    name: canonicalFeatureName(feature, citations),
    inputRevisions: inputRevisions(dossier),
    parcelRefs: [],
    footprint: canonicalValue(polygons, polygons ? state : 'unknown', citations, ENU_METHOD, 'm'),
    footprintKind: canonicalValue(kind, !kind ? 'unknown'
      : feature.properties.spatialExtraction ? 'candidate' : 'source_supported', citations,
    feature.properties.spatialExtraction ? 'deterministic:retained-candidate-outline-role@1' : 'source_literal'),
    baseM: canonicalValue<number>(null, 'unknown', [], 'source_literal', 'm'),
    heightM: heightValue,
    heightState: heightValue.state,
    storeyCount: storeyCountValue(feature, citations),
    storeyLabel: canonicalValue<string>(null),
    storeys: canonicalValue(null),
    levels: [],
    conflicts: [],
    gaps: [...dossier.missing],
    candidates: [],
  };
}

function addGeometryGaps(
  building: NormalizedBuilding,
  polygons: BuildingMultiPolygon | null,
  kind: FootprintKind,
): void {
  if (!polygons) building.gaps.push('Footprint or geographic placement unavailable; no replacement geometry.');
  if (!kind) {
    building.gaps.push('Source outline role is unknown; it is not asserted as a ground footprint or roofprint.');
  }
  building.gaps.push('Measured base elevation unknown; scene uses building-relative bases, not surveyed terrain.');
}

function ulpinState(anchorCount: number): BuildingValueState {
  if (anchorCount > 1) return 'conflicting';
  return anchorCount === 1 ? 'reviewed' : 'unknown';
}

function officialUlpinAnchors(dossier: CanonicalBuildingSource, parcelId: string): ParcelIdentifier[] {
  return (dossier.parcelIdentifiers ?? []).filter(
    item => item.parcelId === parcelId && item.scheme === 'official_ulpin',
  );
}

async function projectParcelRefs(dossier: CanonicalBuildingSource): Promise<NormalizedBuilding['parcelRefs']> {
  const refs: NormalizedBuilding['parcelRefs'] = [];
  for (const parcel of dossier.parcels.filter(item => item.status === 'confirmed')) {
    const anchors = officialUlpinAnchors(dossier, parcel.feature.id);
    const anchorSources = anchors.flatMap(anchor => (
      anchor.evidence.sourceRevisionId ? [{ sourceRevisionId: anchor.evidence.sourceRevisionId }] : []
    ));
    const evidence = await canonicalCitations(anchorSources, dossier.area.siteId);
    const value = anchors.length === 1 ? anchors[0].value : null;
    const officialUlpin = canonicalValue(value, ulpinState(anchors.length), evidence);
    refs.push({ parcelId: parcel.feature.id, officialUlpin });
  }
  return refs;
}

/** Legacy source-only claims have no verified transcriber; fail closed without rewriting their history. */
function sourceClaimProvenance(claim: FactCandidate, sourceOnly: boolean): FactCandidate {
  if (!sourceOnly) return claim;
  const transcription = ClaimTranscriptionSchema.safeParse(
    'transcription' in claim ? claim.transcription : undefined,
  );
  if (transcription.success && transcription.data.by === 'officer') return claim;
  return { ...claim, method: 'ai_extraction', evidenceState: 'unresolved' };
}

function uniqueClaims(dossier: CanonicalBuildingSource, property: string): FactCandidate[] {
  const claims = dossier.packages
    .flatMap(pack => pack.factCandidates.map(claim => (
      sourceClaimProvenance(claim, 'geometryFree' in pack && pack.geometryFree === true)
    )))
    .filter(claim => claim.entityId === dossier.building.id && claim.property === property);
  return [...new Map(claims.map(claim => [JSON.stringify(claim.value), claim])).values()];
}

function claimState(claim: FactCandidate): BuildingValueState {
  if (claim.method === 'ai_extraction' || claim.evidenceState === 'unresolved') return 'candidate';
  return claim.evidenceState;
}

function claimMethod(claim: FactCandidate, sourceLiteral: boolean): string {
  if (claim.method === 'ai_extraction') {
    const transcription = ClaimTranscriptionSchema.safeParse(
      'transcription' in claim ? claim.transcription : undefined,
    );
    const agent = transcription.success && transcription.data.by === 'agent' ? transcription.data.agent : 'unverified';
    return `model:agent-transcription@${encodeURIComponent(agent)}`;
  }
  if (sourceLiteral || claim.method === 'native_parse') return 'source_literal';
  return 'deterministic:retained-claim-projection@1';
}

async function claimAlternatives(
  claims: FactCandidate[],
  siteId: string,
  sourceLiteral: boolean,
): Promise<NormalizedBuilding['conflicts'][number]['alternatives']> {
  const alternatives: NormalizedBuilding['conflicts'][number]['alternatives'] = [];
  for (const claim of claims) {
    const { value } = claim;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
    const citations = await canonicalCitations(claim.evidence, siteId);
    alternatives.push(canonicalValue(
      value, claimState(claim), citations, claimMethod(claim, sourceLiteral), claim.unit,
    ));
  }
  return alternatives;
}

/** A disagreement is shown as a conflict and the headline value is withheld, never picked. */
function markConflicting(
  building: NormalizedBuilding, property: string, citations: BuildingCitation[],
): void {
  if (property.endsWith('floorCount') || property.endsWith('storeyCount')) {
    building.storeyCount = canonicalValue(null, 'conflicting', citations, 'source_literal', 'count');
  }
  if (property.endsWith('storeyLabel')) {
    building.storeyLabel = canonicalValue(null, 'conflicting', citations);
    building.storeyCount = canonicalValue(null, 'conflicting', citations, 'source_literal', 'count');
  }
  if (property.endsWith('exteriorHeight')) {
    building.heightM = canonicalValue(null, 'conflicting', citations, 'source_literal', 'm');
    building.heightState = 'conflicting';
  }
}

async function applyClaimProperty(
  building: NormalizedBuilding,
  dossier: CanonicalBuildingSource,
  property: string,
): Promise<void> {
  const unique = uniqueClaims(dossier, property);
  const siteId = dossier.area.siteId;
  if (unique.length === 1) {
    const [claim] = unique;
    if (property !== 'building.storeyLabel' || typeof claim.value !== 'string') return;
    building.storeyLabel = canonicalValue(
      claim.value, claimState(claim), await canonicalCitations(claim.evidence, siteId),
      claimMethod(claim, dossier.building.geometry === null),
    );
    return;
  }
  if (unique.length < 2) return;
  const alternatives = await claimAlternatives(unique, siteId, dossier.building.geometry === null);
  if (alternatives.length < 2) return;
  const reason = 'Retained source claims disagree; no automatic selection.';
  building.conflicts.push({ property, alternatives, reason });
  markConflicting(building, property, alternatives.flatMap(alternative => alternative.citations));
}

function conflictAlternativesMatch(
  current: NormalizedBuilding['conflicts'][number], decision: BuildingConflictDecision,
): boolean {
  const signatures = (alternatives: typeof current.alternatives) => alternatives.map(alternative => (
    JSON.stringify({ value: alternative.value, citations: alternative.citations })
  )).sort();
  return JSON.stringify(signatures(current.alternatives)) === JSON.stringify(signatures(decision.alternatives));
}

/** Decisions are reviewed only for their exact retained alternatives; never infer a level schedule. */
export function applyConflictDecisions(
  building: NormalizedBuilding, decisions: BuildingConflictDecision[],
): void {
  if (!decisions.length) return;
  building.conflictDecisions = decisions;
  const latest = new Map(decisions.map(decision => [decision.property, decision]));
  for (const decision of latest.values()) {
    const conflict = building.conflicts.find(item => item.property === decision.property);
    if (!conflict || !conflictAlternativesMatch(conflict, decision)) {
      building.gaps.push(`${decision.property}: retained decision is stale against current source alternatives.`);
      continue;
    }
    if (decision.outcome === 'unresolved') continue;
    const method = `reviewer:${encodeURIComponent(decision.actor)}`;
    if (decision.property === 'building.storeyLabel' && typeof decision.chosenValue === 'string') {
      building.storeyLabel = canonicalValue(decision.chosenValue, 'reviewed', [decision.citation], method);
      if (!building.conflicts.some(item => ['building.floorCount', 'building.storeyCount'].includes(item.property))) {
        building.storeyCount = canonicalValue(null, 'unknown', [decision.citation], method, 'count');
      }
    } else if (decision.property !== 'building.storeyLabel' && typeof decision.chosenValue === 'number') {
      building.storeyCount = canonicalValue(decision.chosenValue, 'reviewed', [decision.citation], method, 'count');
    } else continue;
    building.resolvedConflicts ??= [];
    building.resolvedConflicts.push(decision);
    building.conflicts = building.conflicts.filter(item => item !== conflict);
  }
}

function retainedConflictDecisions(dossier: CanonicalBuildingSource): BuildingConflictDecision[] {
  return dossier.records.flatMap(record => {
    if (!('canonicalConflictDecisions' in record)) return [];
    return BuildingConflictDecisionSchema.array().max(20).parse(record.canonicalConflictDecisions);
  });
}

// Retain unresolved source statements, never pick the newest package or turn G+42 into 43 levels.
async function applyRetainedClaims(building: NormalizedBuilding, dossier: CanonicalBuildingSource): Promise<void> {
  for (const property of CLAIM_PROPERTIES) await applyClaimProperty(building, dossier, property);
}

function isBuildingRelative(verticalReference: string | undefined): boolean {
  return /building[-_]relative/i.test(verticalReference ?? '');
}

/** Both bounds, only when explicitly building-relative and strictly ordered. */
function verticalBounds(scene: DetailedSceneRecord): [number, number] | null {
  const { lower, upper } = scene;
  if (!isBuildingRelative(scene.verticalReference)) return null;
  if (lower === undefined || upper === undefined || !(lower < upper)) return null;
  return [lower, upper];
}

function levelBounds(scene: DetailedSceneRecord, citations: BuildingCitation[]) {
  const bounds = verticalBounds(scene);
  const state = bounds ? 'reviewed' : 'unknown';
  return {
    lowerM: canonicalValue(bounds ? bounds[0] : null, state, citations, 'source_literal', 'm'),
    upperM: canonicalValue(bounds ? bounds[1] : null, state, citations, 'source_literal', 'm'),
  };
}

function recordSources(record: RegistryRecord): SourceLocator[] {
  return record.evidence.map(entry => ({ sourceRevisionId: entry.sourceId, partId: entry.locator }));
}

function spaceKind(space: DetailedSceneRecord, evidence: BuildingCitation[]): CanonicalSpace['kind'] {
  if (space.record.use !== 'common') return canonicalValue(null);
  return canonicalValue('common', 'reviewed', evidence, 'deterministic:recorded-space-use-projection@1');
}

async function projectSpace(space: DetailedSceneRecord, frame: AreaFrame, siteId: string): Promise<CanonicalSpace> {
  const polygons = geographicToEnu(space.geographicGeometry, frame);
  const evidence = await canonicalCitations(recordSources(space.record), siteId);
  const { lowerM, upperM } = levelBounds(space, evidence);
  return {
    spaceId: space.record.id,
    kind: spaceKind(space, evidence),
    polygons: canonicalValue(polygons, polygons ? 'reviewed' : 'unknown', evidence, ENU_METHOD, 'm'),
    lowerM,
    upperM,
    proposedCode: canonicalValue(null),
  };
}

function spacesOnFloor(dossier: CanonicalBuildingSource, floorId: string): DetailedSceneRecord[] {
  return dossier.detailedScene.filter(scene => (
    scene.record.kind === 'space'
    && scene.record.links.some(link => link.type === 'floor' && link.targetId === floorId)
  ));
}

async function projectLevel(
  building: NormalizedBuilding,
  dossier: CanonicalBuildingSource,
  frame: AreaFrame,
  detail: DetailedSceneRecord,
  order: number,
): Promise<CanonicalStorey> {
  const floor = detail.record;
  const siteId = dossier.area.siteId;
  if (!isBuildingRelative(detail.verticalReference)) {
    building.gaps.push(
      `${floor.id}: vertical reference is not explicitly building-relative; scene level bounds unavailable.`,
    );
  }
  const refs = await canonicalCitations(recordSources(floor), siteId);
  const { lowerM, upperM } = levelBounds(detail, refs);
  const label = canonicalValue(floor.name, 'reviewed', refs, 'deterministic:recorded-level-label-projection@1');
  const spaces: CanonicalSpace[] = [];
  for (const space of spacesOnFloor(dossier, floor.id)) spaces.push(await projectSpace(space, frame, siteId));
  building.levels.push({ levelId: floor.id, order, label, lowerM, upperM, spaces });
  const storeyPolygons = geographicToEnu(detail.geographicGeometry, frame);
  return {
    levelId: floor.id,
    label,
    lowerM,
    upperM,
    belowGround: canonicalValue(null),
    open: canonicalValue(null),
    roof: canonicalValue(null),
    polygons: canonicalValue(storeyPolygons, storeyPolygons ? 'reviewed' : 'unknown', refs, ENU_METHOD, 'm'),
  };
}

async function projectLevels(
  building: NormalizedBuilding,
  dossier: CanonicalBuildingSource,
  frame: AreaFrame,
): Promise<CanonicalStorey[]> {
  const storeys: CanonicalStorey[] = [];
  const floors = dossier.detailedScene.filter(scene => scene.record.kind === 'floor');
  for (const [order, detail] of floors.entries()) {
    storeys.push(await projectLevel(building, dossier, frame, detail, order));
  }
  return storeys;
}

export async function projectBuilding(
  dossier: CanonicalBuildingSource,
  proposal = dossier.building.revision === 0,
): Promise<NormalizedBuilding> {
  const feature = dossier.building;
  const frame = canonicalFrame(dossier.area);
  const citations = await canonicalCitations(feature.evidence, dossier.area.siteId);
  const heightCitations = await canonicalCitations(feature.height.evidence ?? [], dossier.area.siteId);
  const polygons = geographicToEnu(feature.geographicGeometry, frame);
  const state = buildingState(feature, proposal);
  const kind = footprintKind(feature.geometryRole ?? feature.semantics?.geometryRole);
  const heightValue = projectHeight(feature, heightCitations);
  const building = baseBuilding(dossier, frame, citations, heightValue, polygons, kind, state, proposal);
  addGeometryGaps(building, polygons, kind);
  building.parcelRefs = await projectParcelRefs(dossier);
  building.candidates = dossier.records.flatMap(record => {
    const body = record as typeof record & { canonicalCandidates?: NormalizedBuilding['candidates'] };
    return body.canonicalCandidates ?? [];
  });
  await applyRetainedClaims(building, dossier);
  applyConflictDecisions(building, retainedConflictDecisions(dossier));
  const storeys = await projectLevels(building, dossier, frame);
  if (storeys.length) {
    building.storeys = canonicalValue(storeys, 'reviewed', [], 'deterministic:recorded-level-schedule-projection@1');
  }
  applyLevelSchedules(building, dossier.records);
  return finishBuilding(building);
}

function proposalDossier(feature: PhysicalFeature, context: AreaContext, buildingId: string): CanonicalBuildingSource {
  return {
    building: feature,
    area: context.area,
    parcels: [],
    records: [],
    detailedScene: [],
    packages: context.packages.filter(pack => pack.features.some(item => item.id === buildingId)),
    missing: [...PROPOSAL_MISSING],
  };
}

async function sourceBuildingDossier(
  feature: PhysicalFeature, context: AreaContext, buildingId: string,
): Promise<CanonicalBuildingSource> {
  const dossier = proposalDossier(feature, context, buildingId);
  dossier.missing = [
    SOURCE_BUILDING_GAP, UNREVIEWED_LEVEL_SCHEDULE_GAP,
    'Current sanction/as-built status and source-to-unit association remain unqualified.',
  ];
  if (feature.revision > 0) {
    dossier.records = (await query(
      'SELECT body FROM registry_records WHERE id=$1 AND site_id=$2 AND revision>0',
      [buildingId, context.area.siteId],
    )).rows.map(row => row.body);
  }
  return dossier;
}

export async function canonicalBuilding(
  buildingId: string,
  revision = 'current',
  retainedContext?: AreaContext,
): Promise<NormalizedBuilding> {
  localOperatorSubject();
  const context = retainedContext ?? await areaFeatureContext(buildingId);
  await assertCanonicalAreaScope(context.area);
  const feature = (context.displayFeatures ?? context.features).find(item => item.id === buildingId);
  if (!feature || feature.kind !== 'building') notFound('Building not found.');
  const proposal = feature.revision === 0
    || ('displayState' in feature && feature.displayState === 'unrecorded_proposal');
  let dossier: CanonicalBuildingSource;
  if (feature.geometry === null) dossier = await sourceBuildingDossier(feature, context, buildingId);
  else if (proposal) dossier = proposalDossier(feature, context, buildingId);
  else dossier = await buildingDossier(buildingId);
  if (dossier.area.revision !== context.area.revision || dossier.building.revision !== feature.revision) {
    throw new AppError(409, 'CANONICAL_INPUT_CHANGED', 'Area or building changed during projection; read again.');
  }
  const result = await projectBuilding(dossier, proposal);
  await revalidateCanonicalSources(result, context.area.siteId);
  if ((await assertCanonicalAreaScope(context.area)).revision !== context.area.revision) {
    throw new AppError(409, 'CANONICAL_INPUT_CHANGED', 'The area changed during projection; read again.');
  }
  if (revision !== 'current' && revision !== result.revisionId) {
    throw new AppError(404, 'CANONICAL_REVISION_NOT_FOUND', REVISION_NOT_CURRENT_MESSAGE);
  }
  return result;
}
