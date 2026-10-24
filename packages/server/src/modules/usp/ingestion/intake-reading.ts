import type { IntakeCard, IntakeReading } from '@ulpin/contracts/usp';
import { keptWords, zipParentWords } from './intake-draft';
import { surfaceKind, surfaceReader } from './intake-surface';

type Line = IntakeReading['what'];
export type ReadingRow = {
  family?: string; format?: string | null; size_bytes?: string | number | null;
  state?: string; placement?: string; limit_reason?: string | null; streamed_profile_job_id?: string | null;
  plan_ref?: { layoutQuestion?: boolean; recipeState?: string;
    nativeLayers?: { unstated?: string[]; answers?: { layer: string }[] } } | null;
};
const line = (words: string, basis: Line['basis'] = 'reader'): Line =>
  ({ words: words.replace(/\s+/g, ' ').trim().slice(0, 2000), basis });
const families: Record<string, string> = { vector: 'map layer', table: 'table', raster: 'raster',
  point_cloud: 'point cloud', model3d: '3D model', document: 'document', image: 'image', archive: 'archive' };
const formats: Record<string, string> = { geojson: 'GeoJSON', geopackage: 'GeoPackage', geotiff: 'GeoTIFF',
  bigtiff: 'BigTIFF', citygml: 'CityGML', cityjson: 'CityJSON', gltf: 'glTF' };
const countWords = (card: IntakeCard) => Object.entries(card.counts)
  .flatMap(([noun, value]) => value === null ? [] : [`${value} ${noun}`]);

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
  const kind = [format && format !== 'unknown' ? formats[format] ?? format.toUpperCase() : '',
    family ? families[family] : ''].filter(Boolean).join(' ');
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

/** Stored facts only. A reading never opens bytes, runs a reader, asks a model or changes a record. */
export function readingOf(row: ReadingRow, card: IntakeCard | null): IntakeReading {
  return { version: 'intake-reading/1', what: whatOf(row, card), holds: holdsOf(card), fields: [],
    drawing: drawingOf(row, card), links: [], question: questionOf(row, card) };
}
