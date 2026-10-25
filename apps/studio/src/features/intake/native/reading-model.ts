import type { GetResponse } from '@ulpin/api-client';
import type { IntakeItem } from '../batch-model';

/**
 * NO1. A batch item's native reading and the features its conversion left out, read through routes that already
 * hold the original's authority. Every value shown is read from those records; nothing here places or confirms.
 */
export type NativeReader = 'dxf' | 'citygml' | 'cityjson' | 'gltf' | 'obj';
export type NativeStatus =
  | GetResponse<'/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/dxf/jobs/{jobId}'>
  | GetResponse<'/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/citygml/jobs/{jobId}'>
  | GetResponse<'/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/cityjson/jobs/{jobId}'>
  | GetResponse<'/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/gltf/jobs/{jobId}'>
  | GetResponse<'/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/obj/jobs/{jobId}'>;
export type NativeOmissions = GetResponse<'/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/omissions'>;
type Layer = NativeOmissions['layers'][number];

const readerOf: Record<string, NativeReader> = { dxf: 'dxf', citygml: 'citygml', cityjson: 'cityjson', glb: 'gltf',
  gltf: 'gltf', obj: 'obj' };
export const readerWords: Record<NativeReader, string> = { dxf: 'DXF', citygml: 'CityGML', cityjson: 'CityJSON',
  gltf: 'glTF', obj: 'OBJ' };

const cardFormat = (item: Pick<IntakeItem, 'card' | 'format'>) => item.card?.format ?? item.format ?? '';

/** The native reader whose job this item names, or null when it names none or its format has no reader. */
export function nativeReaderOf(item: Pick<IntakeItem, 'card' | 'format' | 'nativeReaderJobId' | 'sourceId'>):
  NativeReader | null {
  return item.nativeReaderJobId && item.sourceId ? readerOf[cardFormat(item)] ?? null : null;
}

/**
 * A read root item whose layers a native conversion turns into GeoJSON with a locator file: a GeoPackage, KML, KMZ,
 * CityJSON, CityGML, a ZIP holding a shapefile, or the .shp of a loose shapefile set.
 */
export function hasConvertedLayers(item: Pick<IntakeItem, 'card' | 'format' | 'name' | 'sourceId' | 'parentItemId'
  | 'state'>): boolean {
  if (!item.sourceId || item.parentItemId || item.state !== 'read') return false;
  const format = cardFormat(item);
  if (['geopackage', 'kml', 'kmz', 'cityjson', 'citygml'].includes(format)) return true;
  if (format === 'shapefile') return /\.shp$/i.test(item.name);
  return format === 'zip' && Boolean(item.card?.members.some(member => member.format === 'shapefile'));
}

/** Whether the item detail offers the reading at all. */
export const opensReading = (item: IntakeItem) => nativeReaderOf(item) !== null || hasConvertedLayers(item);

export type SummaryLine = { label: string; value: string };
/** The summary in words, and apart from it the fingerprints and the reader's format, which an officer opens. */
export type SummaryLines = { lines: SummaryLine[]; hashes: SummaryLine[] };

const labelWords: Record<string, string> = { citygml: 'CityGML', crs: 'CRS', dxf: 'DXF', gltf: 'glTF', obj: 'OBJ',
  sha256: 'SHA-256' };

/** A field name in words, in sentence case; a nested field's name (`capital` false) follows its parent's. */
const label = (key: string, capital = true) => {
  if (key === 'schemaVersion') return 'Reader format';
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(' ')
    .map(word => labelWords[word] ?? word).join(' ');
  return capital ? words.charAt(0).toUpperCase() + words.slice(1) : words;
};

const technical = (key: string) => key === 'schemaVersion' || /sha256$/i.test(key);

/**
 * A stored state such as `not_assessed` or `UNSUPPORTED_CONTENT` in words ("Not assessed"); the state `null` (a
 * field the file wrote as empty) reads "Stated as empty". Names, versions and other literals stay as stored.
 */
function textWords(key: string, value: string): string {
  if (key === 'name' || !/^[a-z]+(_[a-z0-9]+)*$|^[A-Z]+(_[A-Z0-9]+)+$/.test(value)) return value;
  if (value === 'null') return 'Stated as empty';
  const words = value.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A stored null is "Not stated", apart from the states Unknown, Absent and Stated as empty. */
function valueWords(key: string, value: unknown): string {
  if (value === null) return 'Not stated';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return technical(key) ? value : textWords(key, value);
  if (Array.isArray(value)) return value.length ? value.map(entry => valueWords(key, entry)).join(', ') : 'None listed';
  return String(value);
}

function addLines(into: SummaryLines, name: string, key: string, value: unknown) {
  if (Array.isArray(value) && value.some(entry => entry !== null && typeof entry === 'object')) {
    value.forEach((entry, index) => addLines(into, `${name} ${index + 1}`, key, entry));
  } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [child, inner] of Object.entries(value)) {
      addLines(into, `${name} · ${label(child, false)}`, child, inner);
    }
  } else (technical(key) ? into.hashes : into.lines).push({ label: name, value: valueWords(key, value) });
}

/** The reader's summary fields as stored, one labelled line each; a nested value gives one line per field. */
export function summaryLines(summary: Record<string, unknown>): SummaryLines {
  const into: SummaryLines = { lines: [], hashes: [] };
  for (const [key, value] of Object.entries(summary)) addLines(into, label(key), key, value);
  return into;
}

export type ReadingView =
  | { state: 'words'; words: string }
  | { state: 'read'; lines: SummaryLine[]; hashes: SummaryLine[]; createdAt: string };

export function readingView(reader: NativeReader, status: NativeStatus | null): ReadingView {
  const name = readerWords[reader];
  if (!status) return { state: 'words', words: `No ${name} reading is named for this file.` };
  if (status.status === 'failed') return { state: 'words',
    words: `The ${name} reading stopped${status.code ? ` (${status.code})` : ''}; there is no reading to open.` };
  if (status.status === 'stale') return { state: 'words',
    words: 'This reading is out of date: the file, the case or the reader changed after it ran.' };
  if (status.status !== 'completed') return { state: 'words', words: status.status === 'queued'
    ? `The ${name} reading is waiting to start.` : `The ${name} file is being read.` };
  if (!status.result) return { state: 'words', words: 'The reading finished without an accepted result.' };
  const { lines, hashes } = summaryLines(status.result.summary as Record<string, unknown>);
  return { state: 'read', lines, createdAt: status.result.createdAt,
    hashes: [...hashes, { label: 'Stored reading SHA-256', value: status.result.artifact.sha256 }] };
}

const count = (value: number) => value.toLocaleString('en-US');

/** One line per layer: what was written, what was not and how the list was read. */
export function layerWords(layer: Layer): string {
  const counts = `${count(layer.written)} written, ${count(layer.notWritten)} not written`;
  const scans: Record<Layer['scan'], string> = {
    none_left_out: 'nothing left out',
    whole: layer.notWritten > layer.listed.length
      ? `the first ${count(layer.listed.length)} of ${count(layer.notWritten)} listed` : 'all listed',
    partial: `${count(layer.listed.length)} listed from the start of its locator file, not checked against its SHA-256`,
    not_read: 'not listed in this read; counts only',
  };
  return `${counts} · ${scans[layer.scan]}`;
}

export const positionWords = (layer: Layer, position: number | string) =>
  layer.positionKind ? `${layer.positionKind} ${position}` : String(position);
