import nycAreas from './data/nyc-bronx-areas.json';
import nycContext from './data/nyc-bronx-context.json';
import nycSource from './data/nyc-bronx-source.json';
import swissArea from './data/swiss-floor-area.json';
import swissContext from './data/swiss-floor-context.json';
import swissRegister from './data/swiss-floor-register.json';
import nycOriginal from '../../../../fixtures/real-area/original.geojson?raw';
import swissOriginal from '../../../../fixtures/usp/D5/gf0-multiunit-v1/swiss-floor-127-164-717.csv?raw';

/**
 * Local records derived from retained official sources by the scripts in apps/studio/scripts.
 * Each set has a lineage file (source file, SHA-256, provider, terms, limits) next to it.
 */
export const LOCAL_SOURCE_LABELS = {
  nyc: 'NYC OTI building footprints (derived)',
  swiss: 'Swiss Dwellings floor sample (derived)',
} as const;

type Json = Record<string, unknown>;
type Feature = (typeof nycContext.features)[number];

export const derivedAreas = [...nycAreas, swissArea];
export const derivedContexts: Record<string, Json> = {
  [nycContext.area.id]: nycContext as unknown as Json,
  [swissContext.area.id]: swissContext as unknown as Json,
};

/** Original bytes behind each derived source, served exactly as retained. */
export const derivedSourceFiles: Record<string, { body: string; type: string; name: string }> = {
  [nycSource.id]: { body: nycOriginal, type: 'application/geo+json', name: nycSource.name },
  [swissRegister.sources[0]!.id]: { body: swissOriginal, type: 'text/csv', name: swissRegister.sources[0]!.name },
};

/**
 * Building registers. The Swiss floor has its own derived register; an NYC footprint has no floors or
 * spaces in its source, so its register is the building alone with that gap stated.
 */
export function derivedRegister(buildingId: string): { body: Json; source: keyof typeof LOCAL_SOURCE_LABELS } | undefined {
  if (buildingId === swissRegister.property.id) return { body: swissRegister as unknown as Json, source: 'swiss' };
  const feature = nycContext.features.find((f) => f.id === buildingId);
  return feature ? { body: nycRegister(feature), source: 'nyc' } : undefined;
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
