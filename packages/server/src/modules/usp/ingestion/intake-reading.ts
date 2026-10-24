import { CANONICAL_TARGETS, canonicalTarget, type MappingTarget, type ColumnProfileDocument } from '@ulpin/contracts';
import { INTAKE_FORMAT_NAMES, type AnyMappingReceipt, type ChunkMappingPayload, type IntakeCard, type IntakeReading,
  type MappingPlan, type SourceProfile } from '@ulpin/contracts/usp';
import { profileColumns } from './column-profile';
import { layoutFingerprint } from './mapping-plan-v2';
import { lookupMappingMemory } from './mapping-memory';
import { proposeMappingRules } from './mapping-rules';
import { keptWords, zipParentWords } from './intake-draft';
import { surfaceKind, surfaceReader } from './intake-surface';

type Line = IntakeReading['what'];
export type ReadingRow = {
  name?: string; family?: string; format?: string | null; size_bytes?: string | number | null;
  state?: string; placement?: string; limit_reason?: string | null; streamed_profile_job_id?: string | null;
  plan_ref?: { layoutQuestion?: boolean; recipeState?: string;
    nativeLayers?: { unstated?: string[]; answers?: { layer: string }[] } } | null;
};
export type ReadingFacts = {
  profile?: Pick<SourceProfile, 'paths'> | null;
  mapping?: Pick<NonNullable<ChunkMappingPayload['mapping']>, 'profile' | 'plan' | 'fieldSources'> | null;
  recipe?: AnyMappingReceipt | null;
  proposal?: { plan: MappingPlan; origin: 'memory' | 'teacher' | 'officer' } | null;
};
const line = (words: string, basis: Line['basis'] = 'reader'): Line =>
  ({ words: words.replace(/\s+/g, ' ').trim().slice(0, 2000), basis });
const families: Record<string, string> = { vector: 'map layer', table: 'table', raster: 'raster',
  point_cloud: 'point cloud', model3d: '3D model', document: 'document', image: 'image', archive: 'archive' };
const countWords = (card: IntakeCard) => Object.entries(card.counts).flatMap(([noun, value]) => {
  if (value === null) return [];
  return [`${value} ${value === 1 ? noun.slice(0, -1) : noun}`];
});

function byteCount(row: ReadingRow): number | null {
  if (row.size_bytes === null || row.size_bytes === undefined) return null;
  const bytes = Number(row.size_bytes);
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
}

function whatOf(row: ReadingRow, card: IntakeCard | null): Line {
  if (card?.format === 'unknown') {
    const bytes = byteCount(row);
    return line(bytes === null ? 'Kept file; its kind was not recognised from the bytes read.'
      : keptWords(card, bytes));
  }
  const format = card?.format ?? row.format;
  const family = card?.family ?? row.family;
  const formatName = format && Object.hasOwn(INTAKE_FORMAT_NAMES, format) ? INTAKE_FORMAT_NAMES[format] : '';
  const kind = [formatName, family ? families[family] : ''].filter(Boolean).join(' ');
  const counts = card ? countWords(card) : [];
  if (card?.sheets.length) counts.push(`${card.sheets.length} sheets named`);
  if (card?.columns.length) counts.push(`${card.columns.length} profiled columns`);
  return line(kind ? `${kind}${counts.length ? `; ${counts.join(', ')}` : ''}.`
    : 'Kept file; its kind has not been read yet.');
}

function holdsOf(card: IntakeCard | null): Line[] {
  if (!card) return [];
  const words = countWords(card);
  for (const layer of card.layers) words.push(`Layer: ${layer.name}`
    + `${layer.count === null ? '' : ` (${layer.count} records)`}.`);
  for (const sheet of card.sheets) words.push(`Sheet: ${sheet.name}`
    + `${sheet.count === null ? '' : ` (${sheet.count} rows)`}.`);
  if (card.geometryTypes.length) words.push(`Geometry types read: ${card.geometryTypes.join(', ')}.`);
  if (card.raster?.width !== null && card.raster?.width !== undefined) {
    words.push(`Raster width: ${card.raster.width} pixels.`);
  }
  if (card.raster?.height !== null && card.raster?.height !== undefined) {
    words.push(`Raster height: ${card.raster.height} pixels.`);
  }
  if (card.point?.format !== null && card.point?.format !== undefined) {
    words.push(`Point format: ${card.point.format}.`);
  }
  if (card.point?.scale) words.push(`Point scale as stated: ${card.point.scale.join(', ')}.`);
  if (card.formatVersion !== null) words.push(`Format version: ${card.formatVersion}.`);
  const crs = { stated: 'Coordinate system stated', sidecar: 'Coordinate system has a sidecar; not resolved here',
    absent: 'No coordinate system stated in this reading', conflicting: 'Coordinate system statements conflict',
    not_applicable: 'Coordinate system is not applicable' };
  words.push(`${crs[card.crs.state]}${card.crs.code ? `: ${card.crs.code}` : ''}.`);
  if (card.extent.native) words.push(`Extent in source coordinates: ${card.extent.native.join(', ')}.`);
  if (card.extent.epsg4326) words.push(`Extent in EPSG:4326: ${card.extent.epsg4326.join(', ')}.`);
  return words.map(words => line(words));
}

function questionOf(row: ReadingRow, card: IntakeCard | null): string | null {
  if (['probe_failed', 'failed_part'].includes(row.state ?? '')) return null;
  const layers = row.plan_ref?.nativeLayers;
  const unanswered = Array.isArray(layers?.unstated) ? layers.unstated.find(name => typeof name === 'string'
    && (!Array.isArray(layers.answers) || !layers.answers.some(answer => answer?.layer === name))) : undefined;
  if (unanswered) return line(`What coordinate system does layer ${unanswered} use?`, 'rule').words;
  if (card?.family === 'table' && row.placement !== 'on_map' && ['csv', 'tsv', 'xlsx', 'ods'].includes(card.format)) {
    if (card.sheets.length > 1) return 'Which sheet and header row should be read?';
    return 'Which columns hold the coordinates, and what coordinate system are they in?';
  }
  if (row.placement === 'needs_answer' && !row.plan_ref?.recipeState
    && (row.plan_ref?.layoutQuestion === true || row.streamed_profile_job_id)) {
    return 'How should this layer be read?';
  }
  return null;
}

function keptDrawing(row: ReadingRow, card: IntakeCard | null): IntakeReading['drawing'] {
  let words = row.limit_reason;
  const bytes = byteCount(row);
  if (!words && card && bytes !== null) words = keptWords(card, bytes);
  return { as: 'kept', ...line(words || 'Kept as evidence; no map placement is confirmed.', 'rule') };
}

function vectorDrawing(row: ReadingRow, card: IntakeCard): IntakeReading['drawing'] {
  const types = card.geometryTypes;
  let as = 'features';
  if (types.length && types.every(type => /Polygon/.test(type))) as = 'outlines';
  else if (types.length && types.every(type => /LineString/.test(type))) as = 'lines';
  else if (types.length && types.every(type => /Point/.test(type))) as = 'points';
  let words = `${as} after the layer layout and coordinate system are confirmed.`;
  if (row.placement === 'on_map') words = `${as} on the map; display does not establish rights.`;
  else if (['approved', 'executed'].includes(row.plan_ref?.recipeState ?? '')) {
    words = `${as} from the confirmed layer layout; waiting for map placement.`;
  }
  return { as, ...line(words[0].toUpperCase() + words.slice(1), 'rule') };
}

function drawingOf(row: ReadingRow, card: IntakeCard | null): IntakeReading['drawing'] {
  if (!card) return keptDrawing(row, card);
  if (card.format === 'zip') return { as: 'kept', ...line(row.limit_reason || zipParentWords(card), 'rule') };
  if (['not_understood', 'attached'].includes(row.placement ?? '')
    || ['probe_failed', 'failed_part'].includes(row.state ?? '')) return keptDrawing(row, card);
  if (card.family === 'table') {
    if (row.placement === 'on_map') return { as: 'features',
      ...line('Placed table rows on the map using the confirmed placement.', 'officer') };
    if (['csv', 'tsv', 'xlsx', 'ods'].includes(card.format)) return { as: 'kept', ...line(
      'Kept as a table; rows are not drawn until their coordinate columns and coordinate system are confirmed.',
      'rule') };
    return keptDrawing(row, card);
  }
  if (card.family === 'vector') {
    if (row.placement === 'needs_answer' && row.limit_reason && !questionOf(row, card)) return keptDrawing(row, card);
    return vectorDrawing(row, card);
  }
  const surface = surfaceKind(card);
  if (surface) {
    const bytes = byteCount(row);
    const reader = bytes === null ? null : surfaceReader(card, bytes);
    if (reader && 'limit' in reader) return { as: 'kept', ...line(reader.limit, 'rule') };
    const as = surface === 'raster' ? 'raster_overlay' : 'points';
    const words = surface === 'raster' ? 'Raster overlay' : 'Points';
    return { as, ...line(`${words}${row.placement === 'on_map' ? ' on the map'
      : ' after the native reader confirms placement'}; display only, not measurement or rights.`, 'rule') };
  }
  if (['model3d', 'document', 'image'].includes(card.family)) return { as: 'kept',
    ...line(row.limit_reason || 'Kept as evidence; no map placement is confirmed.', 'rule') };
  return keptDrawing(row, card);
}

const propertyPrefix = '/features/*/properties/';
const basisOf = (source?: string): Line['basis'] => {
  if (source === 'teacher') return 'sarvam';
  if (source === 'memory' || source === 'rule' || source === 'officer') return source;
  return 'reader';
};

function fieldLine(field: string, target: MappingTarget, basis: Line['basis']): IntakeReading['fields'][number] {
  const definition = CANONICAL_TARGETS[canonicalTarget(target)];
  const words = target === 'unknown' ? `Not known. ${definition.meaning}`
    : `${definition.displayLabel}. ${definition.meaning}`;
  return { field, ...line(words, basis) };
}

/** No cells are available here: types are stored facts, shape rates and samples remain unknown. */
function gisColumns(profile: NonNullable<ReadingFacts['profile']>): ColumnProfileDocument | null {
  const paths = profile.paths.filter(path => path.path.startsWith(propertyPrefix));
  if (!paths.length || paths.length > 256) return null;
  const columns = paths.map(path => {
    const name = path.path.slice(propertyPrefix.length).replace(/~1/g, '/').replace(/~0/g, '~');
    const column = profileColumns([], [{ name }], 'gis_attributes').columns[0];
    const types = path.types;
    let inferredType: ColumnProfileDocument['columns'][number]['inferredType'] = 'unknown';
    if (types.length > 1) inferredType = 'mixed';
    else if (types.length === 1) inferredType = types[0] === 'string' ? 'text' : types[0];
    return { ...column, inferredType };
  });
  return { version: 'column-profile/1', sourceKind: 'gis_attributes', columns,
    sampleShortfall: true, layoutFingerprint: layoutFingerprint(columns) };
}

function tableFields(card: IntakeCard, facts: ReadingFacts): IntakeReading['fields'] {
  const approved = facts.recipe && ['approved', 'executed'].includes(facts.recipe.state) ? facts.recipe : null;
  const mapping = facts.mapping;
  const plan = approved?.plan.version === 'manual-tabular/1' ? approved.plan.mapping : mapping?.plan;
  const columns = mapping?.profile.columns ?? plan?.fields.map(field => ({ name: field.sourceField })) ?? card.columns;
  return columns.map(column => {
    const field = plan?.fields.find(field => field.sourceField === column.name);
    const source = mapping?.fieldSources.find(source => source.sourceField === column.name)?.source;
    const student = !approved && source === 'student';
    const target = student ? 'unknown' : field?.target ?? 'unknown';
    const result = fieldLine(column.name, target, approved ? 'officer' : basisOf(source));
    if (student && field) result.words += ` Stored learner suggestion: `
      + `${CANONICAL_TARGETS[canonicalTarget(field.target)].displayLabel}; not confirmed.`;
    return result;
  });
}

function fieldsOf(card: IntakeCard | null, facts: ReadingFacts): IntakeReading['fields'] {
  if (card?.family === 'table') return tableFields(card, facts);
  if (card?.family !== 'vector' || !facts.profile) return [];
  const approved = facts.recipe && ['approved', 'executed'].includes(facts.recipe.state) ? facts.recipe : null;
  const profile = gisColumns(facts.profile);
  if (!profile) return [];
  const context = { sourceKind: profile.sourceKind, fields: profile.columns };
  const memory = lookupMappingMemory(profile.layoutFingerprint, context).plan;
  const rules = proposeMappingRules(profile);
  const plan = approved?.plan.version === 'manual-geojson/1' ? approved.plan : facts.proposal?.plan;
  const basis = approved ? 'officer' : basisOf(facts.proposal?.origin);
  return facts.profile.paths.filter(path => path.path.startsWith(propertyPrefix)).map((path, index) => {
    const name = profile.columns[index].name;
    const operation = plan?.operations.find(operation => operation.sourcePath === path.path);
    if (plan?.heightField === name && plan.heightUnit && plan.heightMeaning) {
      const result = fieldLine(path.path, 'building.heightM', basis);
      result.words = line(result.words.replace('Source height in metres;', `Source height in ${plan.heightUnit};`)
        + ` Stated meaning: ${plan.heightMeaning}.`, basis).words;
      return result;
    }
    if (operation && (operation.target.endsWith('.sourceKey') || operation.target.endsWith('.name'))) {
      const target = operation.target.endsWith('.sourceKey') ? 'building.sourceKey' : 'building.name';
      const result = fieldLine(path.path, target, basis);
      const nouns = { building: 'Building', parcel: 'Parcel', road: 'Road',
        public_land: 'Public land', utility: 'Utility' };
      if (plan?.kind) result.words = result.words.replaceAll('Building', nouns[plan.kind]);
      return result;
    }
    const remembered = memory?.fields.find(field => field.sourceField === name);
    const rule = rules.find(rule => rule.field.sourceField === name);
    if (remembered) return fieldLine(path.path, remembered.target, 'memory');
    if (rule) return fieldLine(path.path, rule.field.target, 'rule');
    return fieldLine(path.path, 'unknown', 'reader');
  });
}

function kindDrawing(row: ReadingRow, card: IntakeCard | null, facts: ReadingFacts): IntakeReading['drawing'] {
  const drawing = drawingOf(row, card);
  if (card?.family !== 'vector' || drawing.as === 'kept') return drawing;
  const approved = facts.recipe && ['approved', 'executed'].includes(facts.recipe.state) ? facts.recipe : null;
  const plan = approved?.plan.version === 'manual-geojson/1' ? approved.plan : facts.proposal?.plan;
  let kind = plan ? plan.kind ?? 'building' : undefined;
  let basis = approved ? 'officer' : basisOf(facts.proposal?.origin);
  if (!kind) {
    const words = [row.name ?? '', ...card.layers.map(layer => layer.name)].join(' ').toLowerCase();
    const matches = [
      ['building', /\b(?:buildings?|footprints?)\b/], ['parcel', /\b(?:parcels?|plots?)\b/],
      ['road', /\broads?\b/], ['public_land', /\bparks?\b/],
    ] as const;
    const kinds = matches.filter(([, pattern]) => pattern.test(words.replace(/[_-]/g, ' ')));
    if (kinds.length !== 1) return drawing;
    kind = kinds[0][0];
    basis = 'rule';
  }
  const types = card.geometryTypes;
  const accepted = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'];
  const outlines = ['Polygon', 'MultiPolygon'];
  if (!types.length || !types.every(type => accepted.includes(type))) return drawing;
  if (['building', 'parcel', 'public_land'].includes(kind) && !types.some(type => outlines.includes(type))) {
    return drawing;
  }
  return { as: kind, ...line(`${approved ? 'Confirmed' : 'Suggested'} kind: ${kind}. ${drawing.words}`, basis) };
}

/** Stored facts only. A reading never opens originals, runs a reader, asks a model or changes a record. */
export function readingOf(row: ReadingRow, card: IntakeCard | null, facts: ReadingFacts = {}): IntakeReading {
  return { version: 'intake-reading/1', what: whatOf(row, card), holds: holdsOf(card), fields: fieldsOf(card, facts),
    drawing: kindDrawing(row, card, facts), links: [], question: questionOf(row, card) };
}
