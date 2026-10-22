import Papa from 'papaparse';
import { INTAKE_PROBE_LIMITS, type IntakeCard } from '@ulpin/contracts/usp';
import { profileColumns } from './column-profile';
import { decodeIntakeHead } from './intake-signatures';
import { chooseTableDelimiter } from './delimited-text';

export function intakeColumns(rows: Record<string, unknown>[], names: string[]): IntakeCard['columns'] {
  const bounded = names.slice(0, INTAKE_PROBE_LIMITS.columns);
  try {
    const profile = profileColumns(rows, bounded.map(name => ({ name })), 'tabular');
    return profile.columns.map((column, index) => ({
      name: bounded[index], inferredType: column.inferredType,
      sampledNonEmpty: rows.filter(row => row[bounded[index]] != null && row[bounded[index]] !== '').length,
    }));
  } catch {
    // Ambiguous normalized headers stay literal and untyped; no selection is silently made.
    return bounded.map(name => ({ name, inferredType: 'unknown',
      sampledNonEmpty: rows.filter(row => row[name] != null && row[name] !== '').length }));
  }
}

export function probeDelimited(card: IntakeCard, head: Uint8Array, name = '') {
  const { text, encoding } = decodeIntakeHead(head);
  const completeLines = text.slice(0, text.lastIndexOf('\n') + 1);
  const delimiter = chooseTableDelimiter(completeLines, name);
  const parsed = Papa.parse<string[]>(completeLines, { preview: INTAKE_PROBE_LIMITS.sampleRecords + 1,
    skipEmptyLines: 'greedy', delimiter });
  const [headers, ...values] = parsed.data;
  card.encoding = encoding;
  if (!headers || ![',', '\t', ';', '|'].includes(parsed.meta.delimiter)) {
    card.limits.push('Delimiter or complete header not established inside the head.');
    return;
  }
  card.depth = 'structure';
  card.delimiter = parsed.meta.delimiter as NonNullable<IntakeCard['delimiter']>;
  const rows = values.map(value => Object.fromEntries(headers.map((name, index) => [name, value[index]])));
  card.columns = intakeColumns(rows, headers);
  card.drawableHint = card.columns.some(column => column.inferredType === 'number'
    && /^(?:lat(?:itude)?|lon(?:gitude)?|lng|easting|northing|x|y)$/i.test(column.name));
  card.limits.push('Header sample only; row count unknown. Coordinate-like columns are a hint, not placement.');
  if (headers.length > INTAKE_PROBE_LIMITS.columns) card.limits.push('Column inventory stopped at 256 columns.');
}

/** Return only complete JSON values from the head; a cut object is never repaired into a source value. */
function completeObjects(text: string): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  let depth = 0;
  let start = -1;
  let string = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (string) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') string = false;
      continue;
    }
    if (char === '"') string = true;
    if (char === '{') {
      if (depth === 0) start = index;
      depth++;
    }
    if (char === '}' && depth > 0 && --depth === 0) {
      try { result.push(JSON.parse(text.slice(start, index + 1))); } catch { break; }
      if (result.length >= INTAKE_PROBE_LIMITS.sampleRecords) break;
    }
  }
  return result;
}

function collectionHead(text: string): { metadata: Record<string, unknown>; samples: Record<string, unknown>[] } {
  // Locate the collection's feature array only outside strings and nested values.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    if (inString) {
      if (escaped) escaped = false;
      else if (text[index] === '\\') escaped = true;
      else if (text[index] === '"') inString = false;
      continue;
    }
    if (text[index] === '"' && depth === 1) {
      const match = /^"features"\s*:\s*\[/.exec(text.slice(index));
      if (match) {
        const prefix = text.slice(0, index).replace(/,\s*$/, '');
        let metadata: Record<string, unknown> = {};
        try { metadata = JSON.parse(prefix + '}'); } catch { /* Metadata not complete before features. */ }
        return { metadata, samples: completeObjects(text.slice(index + match[0].length)) };
      }
    }
    if (text[index] === '"') inString = true;
    if (text[index] === '{' || text[index] === '[') depth++;
    if (text[index] === '}' || text[index] === ']') depth--;
  }
  return { metadata: {}, samples: [] };
}

function statedJsonMetadata(card: IntakeCard, metadata: Record<string, any>) {
  const stated = metadata.crs?.properties?.name;
  if (metadata.crs) {
    // Only a CRS code, never arbitrary source text, may leave the metadata parser.
    const code = typeof stated === 'string' ? /^(?:EPSG:\d+|urn:ogc:def:crs:EPSG::\d+)$/.exec(stated)?.[0] : null;
    card.crs = { state: 'stated', code: code ?? null, sidecarSha256: null };
    if (!code) card.limits.push('A CRS member exists but requires the existing CRS reader to resolve its code.');
  }
  const bbox = metadata.bbox;
  if (Array.isArray(bbox) && bbox.length === 4 && bbox.every(Number.isFinite)) {
    card.extent.native = bbox as [number, number, number, number];
    if (card.crs.code === 'EPSG:4326') card.extent.epsg4326 = card.extent.native;
  }
}

function jsonSample(card: IntakeCard, samples: Record<string, any>[]) {
  const features = samples.filter(value => value.type === 'Feature');
  const allowed = ['Point', 'MultiPoint', 'LineString', 'MultiLineString',
    'Polygon', 'MultiPolygon', 'GeometryCollection'];
  const types = features.map(value => value.geometry?.type).filter(type => allowed.includes(type));
  card.geometryTypes = [...new Set(types)];
  const properties = features.map(value => value.properties).filter(value => value && typeof value === 'object');
  const names = [...new Set(properties.flatMap(value => Object.keys(value)))];
  card.columns = intakeColumns(properties, names);
  if (card.family === 'table') card.columns = intakeColumns(samples, [...new Set(samples.flatMap(Object.keys))]);
}

export function probeJson(card: IntakeCard, head: Uint8Array, size: number) {
  const { text, encoding } = decodeIntakeHead(head);
  card.encoding = encoding;
  card.depth = 'structure';
  let whole: Record<string, any> | undefined;
  if (head.length === size && card.format === 'geojson') {
    try { whole = JSON.parse(text); } catch { /* A cut or malformed value remains unknown. */ }
  }
  if (whole?.type === 'FeatureCollection' && Array.isArray(whole.features)) {
    card.counts.features = whole.features.length;
    statedJsonMetadata(card, whole);
    jsonSample(card, whole.features.slice(0, INTAKE_PROBE_LIMITS.sampleRecords));
    return;
  }
  if (whole?.type === 'Feature') {
    card.counts.features = 1;
    statedJsonMetadata(card, whole);
    jsonSample(card, [whole]);
    return;
  }
  const collection = collectionHead(text);
  const samples = card.format === 'geojson' ? collection.samples : completeObjects(text);
  statedJsonMetadata(card, collection.metadata);
  jsonSample(card, samples);
  card.limits.push('Complete head values only; whole-file count unknown; truncated values not repaired.');
}
