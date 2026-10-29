import { CANONICAL_TARGETS, canonicalTarget, MappingPlanV2Schema,
  type MappingTarget, type ColumnProfileDocument } from '@ulpin/contracts';
import type { MappingRoutingResult } from './mapping-teacher';
import { CITYGML_LIMITS, INTAKE_FORMAT_NAMES, type AnyMappingReceipt, type ChunkMappingPayload, type IntakeCard,
  type IntakeReading, type MappingPlan, type SourceProfile, type IntakeLayoutMemorySchema,
  documentScannedPages, type DocumentResult, type IFCResult }
  from '@ulpin/contracts/usp';
import { z } from 'zod';
import { intakeNativeReadWords } from './intake-native-readers';
import { intakeIfcReadWords } from './intake-ifc';
import { profileColumns } from './column-profile';
import { layoutFingerprint } from './mapping-plan-v2';
import { lookupMappingMemory } from './mapping-memory';
import { proposeMappingRules } from './mapping-rules';
import { keptWords, pageWords, zipParentWords } from './intake-draft';
import { surfaceKind, surfaceReader } from './intake-surface';
import { keyLiteral, keyProperty } from './intake-evidence';

type Line = IntakeReading['what'];
type Field = IntakeReading['fields'][number] & { target: MappingTarget | null; header: string };
export type ReadingPeer = { itemId: string; name: string; card: IntakeCard | null; facts: ReadingFacts };
export type ReadingRow = {
  name?: string; family?: string; format?: string | null; size_bytes?: string | number | null;
  state?: string; placement?: string; limit_reason?: string | null; streamed_profile_job_id?: string | null;
  plan_ref?: { layoutQuestion?: boolean; recipeState?: string; header?: unknown;
    layerMeanings?: unknown;
    workbookSheets?: { name: string; headerRow: number | null; skip: string | null }[];
    nativeLayers?: { unstated?: string[]; answers?: { layer: string }[] } } | null;
  source_id?: string;
};
export type LayerMeanings = MappingRoutingResult & {
  sourceId: string; sourceRevision: number; sourceSha256: string; labelKind: 'pseudo_label';
};
const LayerMeaningsSchema = z.object({ labelKind: z.literal('pseudo_label'),
  sourceId: z.string().uuid(), sourceRevision: z.number().int().positive(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/), plan: MappingPlanV2Schema,
  fieldSources: z.array(z.object({ sourceField: z.string(),
    source: z.enum(['memory', 'rule', 'student', 'teacher', 'officer', 'unanswered']) })).max(256),
});
export type ReadingFacts = {
  native?: Parameters<typeof intakeNativeReadWords>[0] | null;
  nativeStopped?: { format: 'citygml'; code: 'CITYGML_OUTPUT_LIMIT' };
  ifc?: IFCResult['summary'] | null;
  document?: DocumentResult['native'] | null;
  omissions?: { layer: string; notWritten: number }[];
  profile?: { paths: Pick<SourceProfile['paths'][number], 'path' | 'types'>[] } | null;
  layoutMemory?: z.infer<typeof IntakeLayoutMemorySchema>['memory'];
  layerMeanings?: z.infer<typeof LayerMeaningsSchema>;
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

function holdsOf(card: IntakeCard | null, storedDetails = false): Line[] {
  if (!card) return [];
  const words = storedDetails ? [] : countWords(card);
  for (const layer of card.layers) words.push(`Layer: ${layer.name}`
    + `${layer.count === null ? '' : ` (${layer.count} records)`}.`);
  for (const sheet of card.sheets) words.push(`Sheet: ${sheet.name}`
    + `${sheet.count === null ? '' : ` (${sheet.count} rows)`}.`);
  if (card.format === 'xlsx' || card.format === 'ods') {
    words.push(...card.limits.filter(words => /^Sheet .*: (?:candidate header row|header rows|skipped)/.test(words)));
  }
  if (card.geometryTypes.length) words.push(`Geometry types read: ${card.geometryTypes.join(', ')}.`);
  if (!storedDetails && card.raster?.width !== null && card.raster?.width !== undefined) {
    words.push(`Raster width: ${card.raster.width} pixels.`);
  }
  if (!storedDetails && card.raster?.height !== null && card.raster?.height !== undefined) {
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
  if (!storedDetails) words.push(`${crs[card.crs.state]}${card.crs.code ? `: ${card.crs.code}` : ''}.`);
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
    if (card.format === 'xlsx' || card.format === 'ods') {
      const sheets = row.plan_ref?.workbookSheets;
      const unanswered = sheets?.find(sheet => !sheet.skip && sheet.headerRow === null);
      if (unanswered) return `Which header row should be read in sheet ${unanswered.name}?`;
      if (sheets || row.state === 'reading' || row.placement === 'attached') return null;
      if (row.placement === 'not_understood' || card.limits.some(words => /^Which header row/.test(words)))
        return `Which header row should be read in sheet ${card.sheets[0]?.name ?? '(name not yet read)'}?`;
    }
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

const surfaceHeader = z.object({ operation: z.enum(['raster-window', 'point-batch']), crsStated: z.boolean(),
  authority: z.string().nullable(), size: z.array(z.number().int().nonnegative()).min(1),
  vertical: z.object({ status: z.enum(['known', 'unknown']), name: z.string().nullable() }) });

function surfaceHolds(row: ReadingRow): Line[] | null {
  const parsed = surfaceHeader.safeParse(row.plan_ref?.header);
  if (!parsed.success) return null;
  const h = parsed.data;
  const words: string[] = [];
  if (h.operation === 'point-batch') words.push(`${h.size[0]} points.`);
  else {
    words.push(`Raster width: ${h.size[0]} pixels.`);
    words.push(h.size[1] === undefined ? 'Raster height: not stated.' : `Raster height: ${h.size[1]} pixels.`);
    words.push(h.size[2] === undefined ? 'Bands: not stated.' : `Bands: ${h.size[2]}.`);
  }
  words.push(h.crsStated ? `Coordinate system stated: ${h.authority ?? 'code not stated in the stored header'}.`
    : 'Coordinate system: not stated.');
  words.push(h.vertical.status === 'known' && h.vertical.name ? `Vertical reference stated: ${h.vertical.name}.`
    : 'Vertical reference: not stated.');
  return words.map(words => line(words));
}

const summaryLabel = (path: string[]) => {
  const words = path.join(' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Label literals only: at most two nested key/index steps and eight scalar leaves per summary field. */
function summaryValueHolds(key: string, value: unknown): Line[] {
  const lines: Line[] = [];
  let leaves = 0;
  const visit = (value: unknown, path: string[], depth: number): boolean => {
    if (depth > 2) return false;
    if (value === null || typeof value !== 'object') {
      if (++leaves > 8) return false;
      lines.push(line(`${summaryLabel(path)}: ${value === null ? 'not stated' : String(value)}.`));
      return true;
    }
    if (Array.isArray(value) && value.length && value.every(entry => typeof entry === 'number')) {
      leaves += value.length;
      if (leaves > 8) return false;
      lines.push(line(`${summaryLabel(path)}: ${value.join(', ')}.`));
      return true;
    }
    const entries = Array.isArray(value) ? value.map((entry, index) => [String(index + 1), entry] as const)
      : Object.entries(value);
    if (!entries.length || entries.length > 8) return false;
    return entries.every(([name, entry]) => visit(entry, [...path, name], depth + 1));
  };
  if (!visit(value, [key], 0)) return [line(`${summaryLabel([key])}: stated; shown in the reader panel.`)];
  return lines;
}

/** Plain summary labels and literals, without interpreting source values or displaying their JSON encoding. */
function summaryHolds(summary: Record<string, unknown>): Line[] {
  return Object.entries(summary).filter(([key]) => /Count$|^(units|axes|crs|globalPlacement)$/.test(key))
    .flatMap(([key, value]) => summaryValueHolds(key, value));
}

function storedHolds(row: ReadingRow, card: IntakeCard | null, facts: ReadingFacts): Line[] {
  const surface = surfaceHolds(row);
  const holds = [...holdsOf(card, surface !== null || Boolean(facts.native || facts.ifc)), ...(surface ?? [])];
  if (!surface && (facts.native || facts.ifc) && card?.crs.state === 'stated' && card.crs.code) {
    holds.push(line(`Coordinate system stated in the probe: ${card.crs.code}.`));
  }
  if (!facts.native && !facts.ifc && !surface
    && ['model3d', 'raster', 'point_cloud'].includes(card?.family ?? row.family ?? '')) {
    holds.push(line('Vertical reference: not stated in the stored reading.'));
  }
  if (facts.native) holds.push(line(intakeNativeReadWords(facts.native)), ...summaryHolds(facts.native),
    line('Object types and vertical reference: not stated in the stored summary.'));
  if (card?.format === 'citygml' && facts.nativeStopped?.format === 'citygml'
    && facts.nativeStopped.code === 'CITYGML_OUTPUT_LIMIT') {
    holds.push(line('The CityGML element inventory is larger than the reader lists '
      + `(${CITYGML_LIMITS.artifactBytes / (1024 * 1024)} MiB), so its elements are not listed here; `
      + 'building outlines are read directly from the unchanged original.'));
  }
  if (facts.ifc) {
    holds.push(line(intakeIfcReadWords(facts.ifc)),
      line('Coordinate system code and vertical reference: not stated in the stored summary.'));
    if (facts.ifc.structure?.state === 'read') {
      const types = [...new Set(facts.ifc.structure.nodes.map(node => node.entityType))];
      holds.push(line(`Structure object types: ${types.length ? types.join(', ') : 'not stated'}.`));
    }
  }
  const pdf = facts.document;
  if (pdf) {
    holds.push(line('Vertical reference: not stated in the stored reading.'));
    const scanned = documentScannedPages(pdf);
    const pages = new Set([...pdf.parts.flatMap(part => part.locator.page ?? []), ...scanned]);
    holds.push(line(pages.size ? `${pages.size} ${pages.size === 1 ? 'page' : 'pages'} in the stored reading `
      + `(${pageWords([...pages].sort((a, b) => a - b))}).` : 'Pages: not stated in the stored reading.'));
    holds.push(line(scanned.length ? `${scanned.length} ${scanned.length === 1 ? 'page needs' : 'pages need'} OCR: `
      + `${pageWords(scanned)}.`
      : 'Pages needing OCR: not stated in the stored reading.'));
  }
  for (const layer of facts.omissions ?? []) {
    if (layer.notWritten) holds.push(line(`Layer ${layer.layer}: ${layer.notWritten} features left out by conversion; `
      + 'kept in the original, not placed or confirmed.'));
  }
  return holds;
}

function storedDrawing(row: ReadingRow, card: IntakeCard | null, facts: ReadingFacts): IntakeReading['drawing'] {
  const header = surfaceHeader.safeParse(row.plan_ref?.header);
  if (header.success && !['probe_failed', 'failed_part'].includes(row.state ?? '')) {
    const raster = header.data.operation === 'raster-window';
    const where = row.placement === 'on_map' ? 'on the map' : 'not placed on the map';
    return { as: raster ? 'raster_overlay' : 'points', ...line(
      `${raster ? 'Raster overlay' : 'Points'} from the stored reading, ${where}. `
      + `${row.limit_reason ?? ''} Display only, not measurement or rights.`, 'rule') };
  }
  if (facts.native || facts.ifc || facts.document) {
    const converted = facts.omissions?.length;
    const words = converted ? 'Converted layer outlines are separate derivatives; the original is kept as evidence.'
      : 'Kept as evidence, not placed on the map; the stored reading does not establish measurement or rights.';
    return { as: 'kept', ...line(`${words} ${row.limit_reason ?? ''}`, 'rule') };
  }
  return kindDrawing(row, card, facts);
}

const propertyPrefix = '/features/*/properties/';
const basisOf = (source?: string): Line['basis'] => {
  if (source === 'teacher') return 'sarvam';
  if (source === 'memory' || source === 'rule' || source === 'officer') return source;
  return 'reader';
};

function fieldLine(field: string, target: MappingTarget, basis: Line['basis']): Field {
  const definition = CANONICAL_TARGETS[canonicalTarget(target)];
  const words = target === 'unknown' ? `Not known. ${definition.meaning}`
    : `${definition.displayLabel}. ${definition.meaning}`;
  return { field, header: field, target, ...line(words, basis) };
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

function tableFields(card: IntakeCard, facts: ReadingFacts): Field[] {
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

function fieldsOf(card: IntakeCard | null, facts: ReadingFacts): Field[] {
  if (card?.family === 'table') return tableFields(card, facts);
  if (card?.family === 'vector' && facts.layoutMemory) {
    const memory = facts.layoutMemory;
    const kind = memory.kind === 'public_land' ? 'public land' : memory.kind;
    return memory.operations.map(({ target, sourcePath }) => {
      const header = keyProperty(sourcePath) ?? (sourcePath === '/features/*/id' ? 'id' : 'geometry');
      if (target.endsWith('.geometry')) return { field: sourcePath, header, target: null,
        ...line(`Geometry for the suggested ${kind} layout; check it and approve.`, 'memory') };
      const key = target.endsWith('.sourceKey');
      let meaning: Field['target'] = null;
      if (memory.kind === 'building') meaning = key ? 'building.sourceKey' : 'building.name';
      const words = key ? `${header} identifies each ${kind} in the source; not an allocated application ID.`
        : `${header} holds the ${kind} name as stated in the source.`;
      return { field: sourcePath, header, target: meaning, ...line(`${words} Check it and approve.`, 'memory') };
    });
  }
  if (card?.family !== 'vector') return [];
  const inventory = facts.profile ?? (facts.layerMeanings ? { paths: facts.layerMeanings.plan.fields.map(field => ({
    path: propertyPrefix + field.sourceField.replace(/~/g, '~0').replace(/\//g, '~1'), types: [],
  })) } : null);
  if (!inventory) return [];
  const approved = facts.recipe && ['approved', 'executed'].includes(facts.recipe.state) ? facts.recipe : null;
  const profile = gisColumns(inventory);
  if (!profile) return [];
  const context = { sourceKind: profile.sourceKind, fields: profile.columns };
  const memory = lookupMappingMemory(profile.layoutFingerprint, context).plan;
  const rules = proposeMappingRules(profile);
  const plan = approved?.plan.version === 'manual-geojson/1' ? approved.plan : facts.proposal?.plan;
  const basis = approved ? 'officer' : basisOf(facts.proposal?.origin);
  return inventory.paths.filter(path => path.path.startsWith(propertyPrefix)).map((path, index) => {
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
      if (target === 'building.sourceKey' && plan?.kind && plan.kind !== 'building') result.target = null;
      const nouns = { building: 'Building', parcel: 'Parcel', road: 'Road',
        public_land: 'Public land', utility: 'Utility' };
      if (plan?.kind) result.words = result.words.replaceAll('Building', nouns[plan.kind]);
      return result;
    }
    const remembered = memory?.fields.find(field => field.sourceField === name);
    const rule = rules.find(rule => rule.field.sourceField === name);
    if (remembered) return fieldLine(path.path, remembered.target, 'memory');
    if (rule) return fieldLine(path.path, rule.field.target, 'rule');
    const candidate = facts.layerMeanings?.plan.fields.find(field => field.sourceField === name);
    const source = facts.layerMeanings?.fieldSources.find(field => field.sourceField === name)?.source;
    if (candidate && source !== 'student') {
      const result = fieldLine(path.path, candidate.target, basisOf(source));
      result.words += ' Candidate meaning; not confirmed. Check it with the source before approving a layout.';
      return result;
    }
    return fieldLine(path.path, 'unknown', 'reader');
  }).map(field => ({ ...field, header: keyProperty(field.field) ?? field.field }));
}

function kindDrawing(row: ReadingRow, card: IntakeCard | null, facts: ReadingFacts): IntakeReading['drawing'] {
  const drawing = drawingOf(row, card);
  if (card?.family !== 'vector' || drawing.as === 'kept') return drawing;
  const approved = facts.recipe && ['approved', 'executed'].includes(facts.recipe.state) ? facts.recipe : null;
  const plan = approved?.plan.version === 'manual-geojson/1' ? approved.plan : facts.proposal?.plan;
  if (!plan && facts.layoutMemory) return { as: facts.layoutMemory.kind,
    ...line(`Suggested kind: ${facts.layoutMemory.kind}. ${drawing.words}`, 'memory') };
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

const basisWords: Record<Line['basis'], string> = { reader: 'no meaning stated', rule: 'rule',
  memory: 'memory', sarvam: 'Sarvam, not confirmed', officer: 'confirmed by you' };
const identifier = (target: MappingTarget) => target === 'building.sourceKey' || target.startsWith('parcel.')
  || target === 'document.registrationNo' || target === 'document.sanctionNo';

function sharedField(fields: Field[], others: Field[], by: 'key' | 'address'): [Field, Field] | null {
  let headerPair: [Field, Field] | null = null;
  for (const field of fields) for (const other of others) {
    if (field.target === null || other.target === null) continue;
    const target = canonicalTarget(field.target);
    if (target === canonicalTarget(other.target) && (by === 'address'
      ? target === 'building.addressLiteral' : identifier(target))) return [field, other];
    if (by !== 'key' || target !== 'unknown' || canonicalTarget(other.target) !== 'unknown') continue;
    if (keyLiteral(field.header, 'text') !== null && field.header === other.header) headerPair ??= [field, other];
  }
  return headerPair;
}

function fieldReason(pair: [Field, Field]): string {
  const [field, other] = pair;
  const describe = (entry: Field) => `${entry.header} (${basisWords[entry.basis]})`;
  if (field.target === 'unknown') {
    return `${describe(field)} here and ${describe(other)} there have the same header as written; `
      + 'neither has a stated meaning.';
  }
  const target = canonicalTarget(field.target!);
  const label = CANONICAL_TARGETS[target].displayLabel;
  return `${describe(field)} here and ${describe(other)} there both mean ${label}.`;
}

function linksOf(card: IntakeCard | null, fields: Field[], peers: ReadingPeer[]) {
  const links: IntakeReading['links'] = [];
  const bounds = card?.extent.epsg4326;
  for (const peer of [...peers].sort((a, b) => a.name.localeCompare(b.name) || a.itemId.localeCompare(b.itemId))) {
    const others = fieldsOf(peer.card, peer.facts);
    for (const by of ['key', 'address'] as const) {
      const pair = sharedField(fields, others, by);
      if (pair) links.push({ itemId: peer.itemId, by,
        fields: { here: pair[0].field, there: pair[1].field }, ...line(
        `A link may be declared to ${peer.name}: ${fieldReason(pair)}`, 'rule') });
    }
    const other = peer.card?.extent.epsg4326;
    if (bounds && other && bounds[0] <= other[2] && other[0] <= bounds[2]
      && bounds[1] <= other[3] && other[1] <= bounds[3]) {
      links.push({ itemId: peer.itemId, by: 'place', fields: null, ...line(
        `A link may be declared to ${peer.name}: the stored longitude/latitude extents intersect.`, 'rule') });
    }
  }
  const order = { key: 0, address: 1, place: 2 };
  links.sort((a, b) => order[a.by] - order[b.by]);
  return { links: links.slice(0, 20), omitted: links.length > 20 };
}

/** Stored facts only. A reading never opens originals, runs a reader, asks a model or changes a record. */
export function readingOf(row: ReadingRow, card: IntakeCard | null, facts: ReadingFacts = {},
  comparison: { items: ReadingPeer[]; more: boolean } = { items: [], more: false }): IntakeReading {
  const stored = LayerMeaningsSchema.safeParse(row.plan_ref?.layerMeanings);
  if (stored.success && (!row.source_id || stored.data.sourceId === row.source_id)) {
    facts = { ...facts, layerMeanings: stored.data };
  }
  const fields = fieldsOf(card, facts);
  const suggestions = linksOf(card, fields, comparison.items);
  const holds = storedHolds(row, card, facts);
  if (comparison.more) holds.push(line('The remaining case items were not compared.', 'rule'));
  if (suggestions.omitted) holds.push(line('Further link suggestions are not shown.', 'rule'));
  return { version: 'intake-reading/1', what: whatOf(row, card), holds,
    fields: fields.map(({ header, ...field }) => field),
    drawing: storedDrawing(row, card, facts), links: suggestions.links, question: questionOf(row, card) };
}
