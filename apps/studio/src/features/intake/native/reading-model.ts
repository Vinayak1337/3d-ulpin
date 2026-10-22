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

const label = (key: string) => {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

function valueWords(value: unknown): string {
  if (value === null) return 'Not stated (stored as null)';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** The reader's summary fields as stored, one line each; a nested value is shown as its stored JSON. */
export function summaryLines(summary: Record<string, unknown>): SummaryLine[] {
  return Object.entries(summary).map(([key, value]) => ({ label: label(key), value: valueWords(value) }));
}

export type ReadingView =
  | { state: 'words'; words: string }
  | { state: 'read'; lines: SummaryLine[]; createdAt: string; sha256: string };

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
  return { state: 'read', lines: summaryLines(status.result.summary as Record<string, unknown>),
    createdAt: status.result.createdAt, sha256: status.result.artifact.sha256 };
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
