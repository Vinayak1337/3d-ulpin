import type { GisInspection } from '@ulpin/contracts';
import { INGESTION_VERSION, type MappingPlan, type SourceProfile } from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';
import { sha256 } from '../../../infrastructure/storage';
import type { Mapping } from '../../areas/areas';

/** The existing normalizer owns all coordinate transforms. A recipe cannot select a CRS, factor or geometry role. */
export const CONVERSIONS = [
  {id: 'literal_identifier@1', target: 'building.sourceKey', inputUnit: 'not_applicable', outputUnit: 'not_applicable', semantics: 'Copy a complete, unique source string verbatim. No trimming, coercion or generated identity.'},
  {id: 'literal_text@1', target: 'building.name', inputUnit: 'not_applicable', outputUnit: 'not_applicable', semantics: 'Read a complete source text attribute through the existing area normalizer; original attributes remain retained.'},
  {id: 'geojson_polygon@1', target: 'building.geometry', inputUnit: 'degree', outputUnit: 'm', semantics: 'Use unchanged RFC 7946/recognized OGC CRS84 polygons in the existing canonical-area-officer-v1 normalizer. CRS evidence comes from inspection; the retained destination frame governs projection. Geometry role stays unknown.'},
] as const;
export const limitations = [
  'Only bounded GeoJSON building polygons are supported by this manual profile; other formats and target concepts are unsupported.',
  'Height, geometry role, floor levels, ownership and official issuance are unknown. No height or regional-unit conversion is qualified without retained unit and meaning evidence.',
  'This synchronous manual path does not qualify queued streaming, model proposals, held-out accuracy, PII egress or GF-AGENT.',
];
const escape = (key: string) => key.replaceAll('~', '~0').replaceAll('/', '~1');
const unescape = (key: string) => key.replaceAll('~1', '/').replaceAll('~0', '~');
type Feature = {id?: unknown; properties?: Record<string, unknown> | null; geometry?: unknown};
export function geojsonInventory(bytes: Uint8Array): Feature[] {
  let source;
  try { source = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { throw new AppError(422, 'INVALID_JSON', 'Choose valid GeoJSON source bytes.'); }
  if (source?.type !== 'FeatureCollection' || !Array.isArray(source.features))
    throw new AppError(422, 'UNSUPPORTED_PROFILE', 'Manual mapping currently supports GeoJSON FeatureCollection originals only.');
  if (source.features.length > 2000)
    throw new AppError(413, 'RECORD_LIMIT', 'Split this source into complete feature collections of at most 2000 records with source metadata and original lineage retained. No records were truncated.');
  if (!source.features.length) throw new AppError(422, 'EMPTY_SOURCE', 'Choose a nonempty complete feature collection.');
  return source.features;
}
export function inspectedProfile(bytes: Uint8Array, inspection: GisInspection) {
  const rows = geojsonInventory(bytes);
  if (inspection.format !== 'geojson' || inspection.sourceSha256 !== sha256(bytes) || inspection.featureCount !== rows.length
    || inspection.sourceCrs !== 'EPSG:4326' || !inspection.crsEvidence)
    throw new AppError(422, 'SOURCE_PROFILE', 'The inspected source does not match the supported GeoJSON profile.');
  if (inspection.geometryTypes.some(type => !['Polygon', 'MultiPolygon'].includes(type)))
    throw new AppError(422, 'UNSUPPORTED_GEOMETRY', 'This recipe supports building polygons only; no geometry role is inferred.');
  const entries: {path: string; get: (row: Feature) => {present: boolean; value: unknown}}[] = [
    {path: '/features/*/geometry', get: row => ({present: Object.hasOwn(row, 'geometry'), value: row.geometry})},
    ...(rows.some(row => Object.hasOwn(row, 'id')) ? [{path: '/features/*/id', get: (row: Feature) => ({present: Object.hasOwn(row, 'id'), value: row.id})}] : []),
    ...inspection.fields.map(field => ({path: `/features/*/properties/${escape(field.name)}`, get: (row: Feature) => ({present: Object.hasOwn(row.properties || {}, field.name), value: row.properties?.[field.name]})})),
  ];
  const paths = entries.map(entry => {
    const items = rows.map(entry.get), values = items.filter(item => item.present && item.value !== null);
    const types = [...new Set(values.map(({value}) => Array.isArray(value) ? 'array' : typeof value))].sort() as SourceProfile['paths'][number]['types'];
    const ids = values.map(item => item.value);
    return {path: entry.path, types, values: values.length, explicitNull: items.filter(item => item.present && item.value === null).length,
      absent: items.filter(item => !item.present).length,
      literalIdEligible: ids.length === rows.length && ids.every(v => typeof v === 'string' && v.length > 0 && v.length <= 256 && v.trim() === v) && new Set(ids).size === ids.length,
      literalTextEligible: ids.length === rows.length && ids.every(v => typeof v === 'string' && v.length > 0 && v.length <= 2048 && v.trim() === v)};
  });
  const crs = {value: inspection.sourceCrs, evidence: inspection.crsEvidence, unit: 'degree' as const};
  return {version: INGESTION_VERSION, format: 'geojson' as const, featureCount: rows.length, crs, geometryTypes: inspection.geometryTypes,
    paths, limitations, schemaFingerprint: sha256(JSON.stringify({version: INGESTION_VERSION, crs, geometryTypes: inspection.geometryTypes, paths: paths.map(p => ({path: p.path, types: p.types}))}))};
}
export function compileMapping(plan: MappingPlan, profile: SourceProfile): Mapping {
  const mapping: Mapping = {kind: 'building', geometryRole: 'unknown'};
  for (const operation of plan.operations) {
    const definition = CONVERSIONS.find(item => item.id === operation.conversionId && item.target === operation.target);
    const path = profile.paths.find(item => item.path === operation.sourcePath);
    if (!definition || !path) throw new AppError(422, 'MAPPING_PATH', 'Choose an inspected source path and compatible registry conversion.');
    if (operation.target === 'building.geometry') {
      if (operation.sourcePath !== '/features/*/geometry') throw new AppError(422, 'MAPPING_GEOMETRY', 'Geometry must reference the retained GeoJSON feature geometry.');
    } else {
      const prefix = '/features/*/properties/';
      const field = operation.sourcePath.startsWith(prefix) ? unescape(operation.sourcePath.slice(prefix.length)) : undefined;
      if (field && (field.length > 80 || field.trim() !== field)) throw new AppError(422, 'MAPPING_FIELD', 'The existing area adapter cannot map this field name verbatim.');
      if (operation.target === 'building.sourceKey') {
        if (!path.literalIdEligible) throw new AppError(422, 'MAPPING_IDENTITY', 'Source identity must be complete, unique, nonempty literal text.');
        if (operation.sourcePath !== '/features/*/id' && !field) throw new AppError(422, 'MAPPING_IDENTITY', 'Choose a source attribute or retained Feature.id.');
        if (field) mapping.idField = field;
      } else {
        if (!field || !path.literalTextEligible)
          throw new AppError(422, 'MAPPING_NAME', 'A name mapping requires a complete text attribute; null and absent values stay distinct in the profile.');
        mapping.nameField = field;
      }
    }
  }
  return mapping;
}
