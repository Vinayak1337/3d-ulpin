import { randomUUID } from 'node:crypto';
import type {
  SourceBuildingClaim, SourceBuildingFeature, SourceBuildingImport, SourceBuildingPackage, SourceLocator,
} from '@ulpin/contracts';
import { AppError } from '../../../infrastructure/errors';
import { sha256 } from '../../../infrastructure/storage';

export const SOURCE_BUILDING_GAP =
  'Geometry-free building: footprint, placement, elevation and spatial analysis are not assessed.';
export type SourceDocumentPin = SourceBuildingPackage['documentPins'][number];
export type DocumentPins = Map<string, SourceDocumentPin>;
type BuildingInput = SourceBuildingImport['buildings'][number];
type CitationInput = BuildingInput['citations'][number];

export function sourceRequestKey(packageId: string, documentKey: string): string {
  const hash = sha256(Buffer.from(`${packageId}:${documentKey}`));
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function sourceLocators(citations: CitationInput[], pins: DocumentPins): SourceLocator[] {
  return citations.map(entry => {
    const pin = pins.get(entry.documentKey);
    if (!pin) throw new AppError(422, 'SOURCE_BUILDING_CITATION', 'The cited original is unavailable.');
    return {
      sourceRevisionId: pin.sourceId,
      page: entry.page,
      jsonPointer: entry.locator,
    };
  });
}

export function sourceBuildingFeature(
  input: SourceBuildingImport, building: BuildingInput, pins: DocumentPins,
  areaId: string, id: string, identifier: string,
): SourceBuildingFeature {
  const evidence = sourceLocators(building.citations, pins);
  return {
    id, identifier, areaId, revision: 0,
    sourceRevisionId: evidence[0].sourceRevisionId,
    datasetNamespace: input.namespace, sourceKey: building.sourceKey, name: building.name,
    kind: 'building', geometry: null, geographicGeometry: null, sourceGeometry: null,
    placement: 'unknown', worldStatus: building.worldStatus,
    representation: 'physical_exterior', geometryRole: 'unknown',
    height: { state: 'unknown', value: null, unit: 'm', meaning: 'unknown', reference: 'unknown' },
    properties: { classification: 'test_only', permission: 'unconfirmed', sourceLiteralClaims: building.claims },
    areaM2: null, evidence,
  };
}

export function sourceBuildingClaims(
  building: BuildingInput, featureId: string, pins: DocumentPins,
): SourceBuildingClaim[] {
  return building.claims.map(claim => ({
    id: randomUUID(), entityId: featureId, property: claim.property, value: claim.value,
    evidence: sourceLocators(claim.citations, pins),
    transcription: claim.transcription,
    method: claim.transcription.by === 'agent' ? 'ai_extraction' : 'human_entry',
    evidenceState: claim.transcription.by === 'agent' ? 'unresolved' : 'source_supported',
    worldStatus: building.worldStatus,
  }));
}

/** A marker alone can never downgrade geometry to source-only review. */
export function assertGeometryFreeFeatures(features: readonly unknown[]): void {
  if (!features.length) throw new AppError(422, 'SOURCE_BUILDING_EMPTY', 'Attach originals before source review.');
  for (const feature of features) {
    if (!feature || typeof feature !== 'object' || !('kind' in feature) || feature.kind !== 'building'
      || !('geometry' in feature) || feature.geometry !== null
      || !('geographicGeometry' in feature) || feature.geographicGeometry !== null
      || !('sourceGeometry' in feature) || feature.sourceGeometry !== null
      || !('placement' in feature) || feature.placement !== 'unknown'
      || ('verticalExtent' in feature) || ('utilityProfile' in feature)) {
      throw new AppError(422, 'SOURCE_BUILDING_GEOMETRY', 'Source-only review cannot admit analytical geometry.');
    }
  }
}
