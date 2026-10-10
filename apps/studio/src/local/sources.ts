import nycAreas from './data/nyc-bronx-areas.json';
import nycContext from './data/nyc-bronx-context.json';
import nycSource from './data/nyc-bronx-source.json';
import swissArea from './data/swiss-floor-area.json';
import swissContext from './data/swiss-floor-context.json';
import swissRegister from './data/swiss-floor-register.json';
import lakeAreas from './data/lake-view/areas.json';
import lakeContext from './data/lake-view/context.json';
import lakeRegister from './data/lake-view/register.json';
import lakeLedger from './data/lake-view/ledger.json';
import lakeWorkQueue from './data/lake-view/work-queue.json';
import lakeWorkBoard from './data/lake-view/work-board.json';
import lakeDocuments from './data/lake-view/documents.json';
import lakeLevelReviews from './data/lake-view/level-reviews.json';
import lakeImportBatches from './data/lake-view/import-batches.json';

/**
 * Local records derived from retained official sources by the scripts in apps/studio/scripts.
 * Each set has a lineage file (source file, SHA-256, provider, terms, limits) next to it.
 */
export const LOCAL_SOURCE_LABELS = {
  lake: 'Lake View area records',
  nyc: 'NYC OTI building footprints (derived)',
  swiss: 'Swiss Dwellings floor sample (derived)',
} as const;

type Json = Record<string, unknown>;
type Feature = (typeof nycContext.features)[number];

export const derivedAreas = [...lakeAreas, ...nycAreas, swissArea];
export const derivedContexts: Record<string, Json> = {
  [lakeContext.area.id]: lakeContext as unknown as Json,
  [nycContext.area.id]: nycContext as unknown as Json,
  [swissContext.area.id]: swissContext as unknown as Json,
};

/**
 * Building registers. The Swiss floor has its own derived register; an NYC footprint has no floors or
 * spaces in its source, so its register is the building alone with that gap stated.
 */
export function derivedRegister(buildingId: string): { body: Json; source: keyof typeof LOCAL_SOURCE_LABELS } | undefined {
  if (buildingId === lakeRegister.property.id) return { body: lakeRegister as unknown as Json, source: 'lake' };
  if (buildingId === swissRegister.property.id) return { body: swissRegister as unknown as Json, source: 'swiss' };
  const lake = lakeContextRegister(buildingId);
  if (lake) return { body: lake, source: 'lake' };
  const feature = nycContext.features.find((f) => f.id === buildingId);
  return feature ? { body: nycRegister(feature), source: 'nyc' } : undefined;
}

/** The Lake View records the public projection is built from. */
export const lake = { context: lakeContext, register: lakeRegister, ledger: lakeLedger };

export const workQueue = lakeWorkQueue as unknown as Json & { items: Array<Record<string, unknown>> };
export const workBoard = lakeWorkBoard as unknown as Json;
export const importBatches = lakeImportBatches as unknown as Record<string, Json>;
export const levelReviews = lakeLevelReviews as unknown as Record<string, Json & { buildingId: string }>;

type DocumentPage = { page: number; label: string; svg: string; calibration?: { scale: number; origin: number[] } };
export const documents = lakeDocuments as unknown as Record<string, { name: string; revision: string; pages: DocumentPage[]; anchors: [string, number, number[]?][] }>;

/** Context features of Lake View that are buildings: their registers are the building alone. */
const lakeBuildings = lakeContext.features.filter((f) => f.kind === 'building' && f.id !== lakeRegister.property.id);
export function lakeContextRegister(buildingId: string): Json | undefined {
  const feature = lakeBuildings.find((f) => f.id === buildingId);
  if (!feature) return undefined;
  return {
    ...(lakeRegister as unknown as Json),
    property: { ...lakeRegister.property, id: feature.id, identifier: feature.identifier, ulpin3d: feature.identifier, name: feature.name, revision: 1, geometry: feature.geometry, geographicGeometry: feature.geographicGeometry, height: feature.height },
    associations: [], parcelIdentifiers: [], register: [], findings: [], missing: ['No floors or spaces are recorded for this building yet.'],
    selection: { id: feature.id, kind: 'building', name: feature.name, ulpin3d: feature.identifier },
    ulpin3d: feature.identifier, buildingUlpin3d: feature.identifier,
    geometryQualification: { state: 'not_assessed', purpose: 'identity_assignment', missing: [] },
    findingQualification: { state: 'not_assessed', missing: [] },
  };
}

function nycRegister(feature: Feature): Json {
  return {
    schemaVersion: 'ulpin-officer-export/1',
    exportedAt: nycSource.createdAt,
    property: {
      id: feature.id, identifier: feature.identifier, ulpin3d: feature.identifier, name: feature.name, revision: feature.revision,
      geometryRole: feature.geometryRole, worldStatus: feature.worldStatus, geometry: feature.geometry,
      geographicGeometry: feature.geographicGeometry, height: feature.height,
    },
    area: nycContext.area,
    associations: [],
    parcelIdentifiers: [],
    register: [],
    sources: [nycSource],
    missing: [
      'No floors or spaces are recorded for this building. The source is a footprint with a roof height.',
      'No parcel association: the source tax lot (BBL) is not a parcel ULPIN.',
    ],
    selection: { id: feature.id, kind: 'building', name: feature.name, ulpin3d: feature.identifier },
    ulpin3d: feature.identifier,
    buildingUlpin3d: feature.identifier,
    findingsScope: 'building',
    geometryQualification: { state: 'not_assessed', purpose: 'retained_source_inspection', missing: [] },
    findings: [],
    findingQualification: { state: 'not_assessed', missing: [] },
    scope: 'Local technical record from a retained source; no official title, certificate or legal order.',
  };
}
