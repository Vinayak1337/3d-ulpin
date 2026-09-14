import type { AreaGeometry, ImportPackage, PhysicalFeature } from '@ulpin/contracts';
import { areaContext, getArea, ingestArea } from './areas';
import { AppError, conflict } from './errors';

function exteriorBounds(geometry: AreaGeometry): [number, number, number, number] {
  const exterior = geometry.type === 'Polygon'
    ? geometry.coordinates[0]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates[0]?.[0] : undefined;
  if (!exterior?.length || exterior.some(point => point.length !== 2 || point.some(value => !Number.isFinite(value)))) {
    throw new AppError(422, 'SCENARIO_FOOTPRINT_REQUIRED', 'The scenario requires a valid building polygon in the retained local area frame.');
  }
  const xs = exterior.map(point => point[0]), ys = exterior.map(point => point[1]);
  const bounds: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  if (bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) {
    throw new AppError(422, 'SCENARIO_FOOTPRINT_REQUIRED', 'The selected building footprint has no usable area.');
  }
  return bounds;
}

function targetBuilding(features: PhysicalFeature[]): PhysicalFeature {
  const buildings = features.filter(feature => feature.kind === 'building' && feature.worldStatus === 'observed')
    .sort((first, second) => first.sourceKey < second.sourceKey ? -1 : first.sourceKey > second.sourceKey ? 1
      : first.id < second.id ? -1 : first.id > second.id ? 1 : 0);
  const target = buildings.find(feature => feature.sourceKey === '353927') || buildings[0];
  if (!target) {
    throw new AppError(422, 'SCENARIO_BUILDING_REQUIRED', 'Record an observed building footprint in this geographic area before adding a synthetic crossing scenario.');
  }
  return target;
}

/** Prepare an explicitly synthetic observation package; normal review computes findings. */
export async function createAreaScenario(
  areaId: string,
  expectedRevision: number,
  kind: 'road' | 'utility',
): Promise<ImportPackage> {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new AppError(422, 'AREA_REVISION_REQUIRED', 'Supply the current nonnegative area revision.');
  }
  if (kind !== 'road' && kind !== 'utility') {
    throw new AppError(422, 'SCENARIO_KIND', 'Choose a synthetic road or utility scenario.');
  }
  const area = await getArea(areaId);
  if (area.revision !== expectedRevision) conflict('Area changed; refresh before preparing the synthetic scenario.');
  if (!area.reference) {
    throw new AppError(422, 'SCENARIO_GEOGRAPHIC_AREA_REQUIRED', 'A synthetic area overlay requires a geographic area with an established projection and shared origin.');
  }
  const context = await areaContext(areaId);
  if (context.area.revision !== expectedRevision) conflict('Area changed while selecting the scenario building; refresh and retry.');
  const building = targetBuilding(context.features);
  const [minX, minY, maxX, maxY] = exteriorBounds(building.geometry);
  const width = maxX - minX, height = maxY - minY, middleY = (minY + maxY) / 2;
  const halfRoadWidth = height * 0.15;
  const local = kind === 'road'
    ? [[minX, middleY - halfRoadWidth], [maxX, middleY - halfRoadWidth], [maxX, middleY + halfRoadWidth], [minX, middleY + halfRoadWidth], [minX, middleY - halfRoadWidth]]
    : [[minX - width * 0.1, middleY], [maxX + width * 0.1, middleY]];
  const projected = local.map(([x, y]) => [x + area.reference!.origin[0], y + area.reference!.origin[1]]);
  const match = /^EPSG:(\d+)$/.exec(area.reference.analysisCrs);
  if (!match) throw new AppError(422, 'SCENARIO_REFERENCE', 'The retained analysis frame must have an explicit EPSG identifier.');
  const description = kind === 'road'
    ? 'SYNTHETIC physical road footprint crossing'
    : 'SYNTHETIC utility line crossing — depth unknown';
  const name = `${description}: ${building.sourceKey}`;
  const source = {
    geometryType: kind === 'road' ? 'esriGeometryPolygon' : 'esriGeometryPolyline',
    spatialReference: { wkid: Number(match[1]) },
    hasZ: false,
    hasM: false,
    scenario: {
      version: 'synthetic-area-crossing-v1',
      worldStatus: 'synthetic',
      purpose: 'Authored demonstration overlay. No actual road, utility, easement, ownership or encroachment is asserted.',
      targetFeatureId: building.id,
      targetSourceKey: building.sourceKey,
      sourceGeometryBasis: 'Bounding box of the first exterior polygon of the selected observed building, in the retained local metre frame.',
      verticalEvidence: 'Unknown; no Z, depth or shared elevation was authored.',
    },
    features: [{
      attributes: { source_key: `synthetic-${kind}-crossing`, name, target_source_key: building.sourceKey },
      geometry: kind === 'road' ? { rings: [projected] } : { paths: [projected] },
    }],
  };
  return ingestArea({
    bytes: new TextEncoder().encode(JSON.stringify(source, null, 2)),
    filename: `synthetic-${kind}-crossing.arcgis.json`,
    format: 'arcgis',
    namespace: `synthetic-area-scenario:${areaId}:${kind}`,
    name,
    mapping: { idField: 'source_key', nameField: 'name', kind, identifierFields: ['target_source_key'] },
    areaId,
    sourceCrs: area.reference.analysisCrs,
    expectedAreaRevision: expectedRevision,
    worldStatus: 'synthetic',
  });
}
