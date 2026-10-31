import type { GisInspection, GisSetAside } from '@ulpin/contracts';
import { INGESTION_VERSION, type MappingPlan, type SourceProfile } from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';
import { sha256 } from '../../../infrastructure/storage';
import type { Mapping } from '../../areas/areas';

/** The existing normalizer owns all coordinate transforms. A recipe cannot select a CRS, factor or geometry role. */
export const CONVERSIONS = [
  {id: 'feature_position@1', target: 'feature.sourceKey', inputUnit: 'not_applicable',
    outputUnit: 'not_applicable', semantics: 'Locate the unchanged original feature by its 1-based file position. '
      + 'Line-delimited originals use their line or record number. Not an official identifier.'},
  {id: 'literal_identifier@1', target: 'building.sourceKey', inputUnit: 'not_applicable', outputUnit: 'not_applicable', semantics: 'Copy a complete, unique source string verbatim. No trimming, coercion or generated identity.'},
  {id: 'literal_text@1', target: 'building.name', inputUnit: 'not_applicable', outputUnit: 'not_applicable', semantics: 'Read a complete source text attribute through the existing area normalizer; original attributes remain retained.'},
  {id: 'geojson_polygon@1', target: 'building.geometry', inputUnit: 'degree', outputUnit: 'm', semantics: 'Use unchanged RFC 7946/recognized OGC CRS84 polygons in the existing canonical-area-officer-v1 normalizer. CRS evidence comes from inspection; the retained destination frame governs projection. Geometry role stays unknown.'},
  {id: 'literal_integer_identifier@1', target: 'feature.sourceKey', inputUnit: 'not_applicable', outputUnit: 'not_applicable', semantics: 'Copy a unique whole-number identifier as the digits the file writes. No rounding, padding or generated identity.'},
  {id: 'literal_identifier@1', target: 'feature.sourceKey', inputUnit: 'not_applicable', outputUnit: 'not_applicable', semantics: 'Copy the unique source identifier for the kind explicitly stated in the layout.'},
  {id: 'literal_text@1', target: 'feature.name', inputUnit: 'not_applicable', outputUnit: 'not_applicable', semantics: 'Read source text through the existing area normalizer for the stated kind.'},
  {id: 'geojson_geometry@1', target: 'feature.geometry', inputUnit: 'as_declared', outputUnit: 'm', semantics: 'Read unchanged GeoJSON geometry in the coordinate system the file declares through the existing area normalizer; the stated kind governs compatible geometry. Geometry role stays unknown.'},
] as const;
const geometryTypes = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'];
const polygonTypes = ['Polygon', 'MultiPolygon'];
const polygonKinds = ['building', 'parcel', 'public_land'];
export const limitations = [
  'Only bounded GeoJSON is supported by this manual profile; the layout states one kind for the whole file.',
  'Height is unknown unless the layout states a field, its source unit and its meaning. Geometry role, floor levels, ownership and official issuance remain unknown.',
  'This synchronous manual path does not qualify queued streaming, model proposals, held-out accuracy, PII egress or GF-AGENT.',
];
const escape = (key: string) => key.replaceAll('~', '~0').replaceAll('/', '~1');
const unescape = (key: string) => key.replaceAll('~1', '/').replaceAll('~0', '~');
type Feature = {id?: unknown; properties?: Record<string, unknown> | null; geometry?: unknown};
export const GEOJSON_FEATURE_LIMIT = 2000;

function geojsonFeatures(bytes: Uint8Array): Feature[] {
  let source;
  try { source = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { throw new AppError(422, 'INVALID_JSON', 'Choose valid GeoJSON source bytes.'); }
  if (source?.type !== 'FeatureCollection' || !Array.isArray(source.features))
    throw new AppError(422, 'UNSUPPORTED_PROFILE', 'Manual mapping currently supports GeoJSON FeatureCollection originals only.');
  if (!source.features.length) throw new AppError(422, 'EMPTY_SOURCE', 'Choose a nonempty complete feature collection.');
  return source.features;
}

/** Count retained, bounded bytes before deciding between the small adapter and the streaming reader. */
export function geojsonFeatureCount(bytes: Uint8Array): number {
  return geojsonFeatures(bytes).length;
}

export function geojsonInventory(bytes: Uint8Array): Feature[] {
  const features = geojsonFeatures(bytes);
  if (features.length > GEOJSON_FEATURE_LIMIT)
    throw new AppError(413, 'RECORD_LIMIT', 'Split this source into complete feature collections of at most 2000 '
      + 'records with source metadata and original lineage retained. No records were truncated.');
  return features;
}

type ProfileEntry = {path: string; integerIdEligible?: boolean; outlineIntegerIdEligible?: boolean;
  get: (row: Feature) => {present: boolean; value: unknown}};

/** Complete, unique literal text or whole-number identity over the rows a layout keys. Integer spelling is the
 * inspection's fact; without it no integer eligibility is stated. */
function identityFacts(entry: ProfileEntry, rows: Feature[], integerTokens: boolean | undefined) {
  const ids = rows.map(entry.get).filter(item => item.present && item.value !== null).map(item => item.value);
  const keyed = ids.length === rows.length && new Set(ids).size === ids.length;
  return {
    literal: keyed && ids.every(v => typeof v === 'string' && v.length > 0 && v.length <= 256 && v.trim() === v),
    integer: integerTokens === undefined ? undefined
      : integerTokens && keyed && ids.every(v => Number.isSafeInteger(v)),
  };
}

function textEligible(entry: ProfileEntry, rows: Feature[]): boolean {
  return rows.every(row => {
    const {present, value} = entry.get(row);
    return present && typeof value === 'string' && value.length > 0 && value.length <= 2048 && value.trim() === value;
  });
}

/** The rows an outline kind draws, when the file also holds pins or lines it sets aside; otherwise null. */
function outlineRows(rows: Feature[]): Feature[] | null {
  const drawn = rows.filter(row => !setAsideGeometryTypes('building',
    [String((row.geometry as {type?: unknown} | null | undefined)?.type)]).length);
  return drawn.length > 0 && drawn.length < rows.length ? drawn : null;
}

export function inspectedProfile(bytes: Uint8Array, inspection: GisInspection) {
  const rows = geojsonInventory(bytes);
  if (inspection.format !== 'geojson' || inspection.sourceSha256 !== sha256(bytes) || inspection.featureCount !== rows.length
    || !inspection.sourceCrs || !/^[A-Za-z][A-Za-z0-9_]*:[A-Za-z0-9_.-]+$/.test(inspection.sourceCrs)
    || !inspection.crsEvidence)
    throw new AppError(422, 'SOURCE_PROFILE', 'The inspected source does not match the supported GeoJSON profile.');
  if (inspection.geometryTypes.some(type => !geometryTypes.includes(type)))
    throw new AppError(422, 'UNSUPPORTED_GEOMETRY', 'Choose point, line or polygon GeoJSON geometry supported by the area normalizer; no geometry role is inferred.');
  const entries: ProfileEntry[] = [
    {path: '/features/*/geometry', get: row => ({present: Object.hasOwn(row, 'geometry'), value: row.geometry})},
    ...(rows.some(row => Object.hasOwn(row, 'id')) ? [{path: '/features/*/id',
      integerIdEligible: inspection.featureIntegerIdEligible,
      outlineIntegerIdEligible: inspection.featureOutlineIntegerIdEligible,
      get: (row: Feature) => ({present: Object.hasOwn(row, 'id'), value: row.id})}] : []),
    ...inspection.fields.map(field => ({path: `/features/*/properties/${escape(field.name)}`,
      integerIdEligible: field.integerIdEligible, outlineIntegerIdEligible: field.outlineIntegerIdEligible,
      get: (row: Feature) => ({present: Object.hasOwn(row.properties || {}, field.name),
        value: row.properties?.[field.name]})})),
  ];
  const outline = outlineRows(rows);
  const paths = entries.map(entry => {
    const items = rows.map(entry.get), values = items.filter(item => item.present && item.value !== null);
    const types = [...new Set(values.map(({value}) => Array.isArray(value) ? 'array' : typeof value))].sort() as SourceProfile['paths'][number]['types'];
    const whole = identityFacts(entry, rows, entry.integerIdEligible);
    const drawn = outline && identityFacts(entry, outline, entry.outlineIntegerIdEligible);
    return {path: entry.path, types, values: values.length, explicitNull: items.filter(item => item.present && item.value === null).length,
      absent: items.filter(item => !item.present).length,
      literalIdEligible: whole.literal,
      literalTextEligible: textEligible(entry, rows),
      ...(outline ? {outlineLiteralTextEligible: textEligible(entry, outline)} : {}),
      ...(whole.integer === undefined ? {} : {integerIdEligible: whole.integer}),
      ...(drawn ? {outlineLiteralIdEligible: drawn.literal} : {}),
      ...(drawn && drawn.integer !== undefined ? {outlineIntegerIdEligible: drawn.integer} : {})};
  });
  const unit = inspection.crsUnit ?? (inspection.sourceCrs === 'EPSG:4326' ? 'degree' : null);
  if (typeof unit !== 'string' || !unit.trim() || unit.length > 80)
    throw new AppError(422, 'SOURCE_PROFILE',
      'The stored inspection does not establish the coordinate unit. Check the file again.');
  const crs = {value: inspection.sourceCrs, evidence: inspection.crsEvidence, unit};
  return {version: INGESTION_VERSION, format: 'geojson' as const, featureCount: rows.length, crs, geometryTypes: inspection.geometryTypes,
    paths, limitations, schemaFingerprint: sha256(JSON.stringify({version: INGESTION_VERSION, crs, geometryTypes: inspection.geometryTypes, paths: paths.map(p => ({path: p.path, types: p.types}))}))};
}
function heightMapping(plan: Pick<MappingPlan, 'heightField' | 'heightUnit' | 'heightMeaning'>,
  profile: Pick<SourceProfile, 'paths'>): Partial<Mapping> {
  const field = plan.heightField;
  if (field === undefined) return {};
  if (!plan.heightUnit || !plan.heightMeaning?.trim())
    throw new AppError(422, 'MAPPING_HEIGHT', 'State the height field, its source unit and its meaning together.');
  const path = profile.paths.find(item => item.path === `/features/*/properties/${escape(field)}`);
  if (!path || path.types.some(type => !['number', 'string'].includes(type)))
    throw new AppError(422, 'MAPPING_HEIGHT', 'Choose an inspected numeric or text height attribute; null and absent values remain unknown.');
  return {heightField: field, heightUnit: plan.heightUnit, heightMeaning: plan.heightMeaning};
}
/** An outline kind draws only polygons. The pins and lines of a file that also holds polygons are set aside:
 * kept in the original, never mapped, converted, buffered or inferred into an outline. */
export function setAsideGeometryTypes(kind: string, types: readonly string[]): string[] {
  if (!polygonKinds.includes(kind)) return [];
  return types.filter(type => geometryTypes.includes(type) && !polygonTypes.includes(type));
}

const setAsideNouns = [['pin', ['Point', 'MultiPoint']], ['line', ['LineString', 'MultiLineString']]] as const;
const drawnAs: Record<GisSetAside['kind'], string> = {
  building: 'buildings', parcel: 'land parcels', public_land: 'public land',
};

/** The officer's words for what a layout sets aside, from counted features only. */
export function setAsideWords(setAside: GisSetAside | undefined): string | null {
  if (!setAside) return null;
  const counted = setAsideNouns.map(([noun, types]) => {
    const count = types.reduce((sum, type) => sum + (setAside.counts[type] ?? 0), 0);
    return { count, words: `${count} ${noun}${count === 1 ? '' : 's'}` };
  }).filter(item => item.count > 0);
  if (!counted.length) return null;
  const verb = counted.reduce((sum, item) => sum + item.count, 0) === 1 ? 'is' : 'are';
  return `${counted.map(item => item.words).join(' and ')} ${verb} kept in the original `
    + `but not drawn as ${drawnAs[setAside.kind]}.`;
}

/** An outline kind over a file with pins or lines keys only the outlines it draws. A profile stored before
 * outline facts were inspected keeps the whole-file facts, which hold for every outline too. */
function keyFacts(path: SourceProfile['paths'][number], outline: boolean) {
  if (!outline) return {literal: path.literalIdEligible, integer: path.integerIdEligible};
  return {literal: path.outlineLiteralIdEligible ?? path.literalIdEligible,
    integer: path.outlineIntegerIdEligible ?? path.integerIdEligible};
}

type LayoutPlan = Pick<MappingPlan, 'kind' | 'operations' | 'heightField' | 'heightUnit' | 'heightMeaning'>;
type LayoutProfile = Pick<SourceProfile, 'paths' | 'geometryTypes' | 'crs'>;
/** The one meaning of a layout; a large file's streamed profile reaches it through `compileStreamedMapping`. */
export function compileMapping(plan: LayoutPlan, profile: LayoutProfile): Mapping {
  const kind = plan.kind ?? 'building';
  const accepted = polygonKinds.includes(kind) ? polygonTypes : geometryTypes;
  const drawn = profile.geometryTypes.some(type => accepted.includes(type));
  const setAside = drawn ? setAsideGeometryTypes(kind, profile.geometryTypes) : [];
  const refused = profile.geometryTypes.filter(type => !accepted.includes(type) && !setAside.includes(type));
  if (refused.length) throw new AppError(422, 'MAPPING_GEOMETRY_KIND',
    `The layout states ${kind}, which does not accept ${refused.join(', ')} geometry. Choose a compatible kind; no kind is inferred.`);
  const mapping: Mapping = {kind, geometryRole: 'unknown', ...heightMapping(plan, profile)};
  for (const operation of plan.operations) {
    const definition = CONVERSIONS.find(item => item.id === operation.conversionId && item.target === operation.target);
    const path = profile.paths.find(item => item.path === operation.sourcePath);
    if (!definition || !path) throw new AppError(422, 'MAPPING_PATH', 'Choose an inspected source path and compatible registry conversion.');
    if (operation.target === 'building.geometry' || operation.target === 'feature.geometry') {
      if (operation.conversionId === 'geojson_polygon@1' && profile.crs.unit !== 'degree')
        throw new AppError(422, 'MAPPING_CRS', 'The older building layout reads longitude and latitude only. '
          + "State the kind of feature so the layout reads the file's declared coordinate system.");
      if (operation.sourcePath !== '/features/*/geometry') throw new AppError(422, 'MAPPING_GEOMETRY', 'Geometry must reference the retained GeoJSON feature geometry.');
    } else {
      const prefix = '/features/*/properties/';
      const field = operation.sourcePath.startsWith(prefix) ? unescape(operation.sourcePath.slice(prefix.length)) : undefined;
      if (field && (field.length > 80 || field.trim() !== field)) throw new AppError(422, 'MAPPING_FIELD', 'The existing area adapter cannot map this field name verbatim.');
      if (operation.target === 'building.sourceKey' || operation.target === 'feature.sourceKey') {
        if (operation.conversionId === 'feature_position@1') {
          if (operation.sourcePath !== '/features/*/geometry')
            throw new AppError(422, 'MAPPING_IDENTITY',
              'File position must reference the retained feature geometry path.');
          mapping.sourceKeyConversion = 'feature_position@1';
          continue;
        }
        const keys = keyFacts(path, setAside.length > 0);
        if (operation.conversionId === 'literal_integer_identifier@1') {
          if (keys.integer !== true) throw new AppError(422, 'MAPPING_IDENTITY',
            'Source identity must be complete, unique whole-number tokens within the exact integer range.');
        } else if (!keys.literal) {
          throw new AppError(422, 'MAPPING_IDENTITY', 'Source identity must be complete, unique, nonempty literal text.');
        }
        if (operation.sourcePath !== '/features/*/id' && !field) throw new AppError(422, 'MAPPING_IDENTITY', 'Choose a source attribute or retained Feature.id.');
        if (field) mapping.idField = field;
      } else {
        const text = setAside.length > 0
          ? path.outlineLiteralTextEligible ?? path.literalTextEligible : path.literalTextEligible;
        if (!field || !text)
          throw new AppError(422, 'MAPPING_NAME',
            'A name mapping requires a complete text attribute for every feature drawn by the layout; '
            + 'null and absent values stay distinct in the profile.');
        mapping.nameField = field;
      }
    }
  }
  return mapping;
}
