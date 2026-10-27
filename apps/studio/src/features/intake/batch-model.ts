import type { GetResponse } from '@ulpin/api-client';
import type { Package } from './run/model';
import { sizeWords } from './upload-model';

export type IntakeManifest = GetResponse<'/api/v1/ingestion/cases/{caseId}/intake'>;
export type IntakeItem = IntakeManifest['items'][number];

export type TrayRow = { item: IntakeItem; archiveId: string | null; members: IntakeItem[] };

/** Keep file order, moving only members whose archive is present directly under that archive. */
export function intakeTrayRows(items: readonly IntakeItem[]): TrayRow[] {
  const rows = new Map(items.map(item => [item.itemId, { item, archiveId: null, members: [] } as TrayRow]));
  for (const row of rows.values()) {
    const archiveId = row.item.parentItemId ?? row.item.archiveItemId;
    const archive = archiveId ? rows.get(archiveId) : undefined;
    if (archive && archive !== row) {
      row.archiveId = archive.item.itemId;
      archive.members.push(row.item);
    }
  }
  const ordered: TrayRow[] = [];
  const seen = new Set<string>();
  const append = (row: TrayRow) => {
    if (seen.has(row.item.itemId)) return;
    seen.add(row.item.itemId);
    ordered.push(row);
    for (const member of row.members) append(rows.get(member.itemId)!);
  };
  for (const row of rows.values()) if (!row.archiveId) append(row);
  // Keep even a malformed circular lineage listed once.
  for (const row of rows.values()) append(row);
  return ordered;
}

const states: Record<IntakeItem['state'], string> = {
  received: 'Original received', probed: 'File checked', planned: 'Layout prepared', reading: 'Reading file',
  preparing: 'Preparing packages', read: 'Read', read_to_limit: 'Read to the limit',
  failed_part: 'Part could not be read', probe_failed: 'File could not be checked',
};

const placements: Record<IntakeItem['placement'], string> = {
  undecided: 'Not placed yet', on_map: 'On the map', attached: 'Attached to a record',
  waiting_for_anchor: 'Waiting for a matching map record', needs_answer: 'Needs an answer',
  not_understood: 'Not understood',
};

export function packagePath(item: Pick<IntakeItem, 'plan'>, packages: readonly Package[]): string | null {
  const packageId = item.plan?.packageId;
  const pkg = packages.find(row => row.packageId === packageId);
  return pkg ? `/studio/areas/${pkg.areaId}?package=${pkg.packageId}` : null;
}

export function batchMapPath(items: readonly Pick<IntakeItem, 'existingAreaId'>[],
  packages: readonly Package[]): string | null {
  const pkg = packages.find(row => row.areaId);
  if (pkg) return `/studio/areas/${pkg.areaId}?package=${pkg.packageId}`;
  const item = items.find(row => row.existingAreaId);
  return item ? `/studio/areas/${item.existingAreaId}` : null;
}

export function partProgressWords(item: Pick<IntakeItem, 'state' | 'partsPlanned' | 'partsDone' | 'recordsSeen'>
  & Partial<Pick<IntakeItem, 'family'>>) {
  if (item.state === 'preparing') {
    const packages = item.partsDone === 1 ? 'package' : 'packages';
    const records = item.recordsSeen === 1 ? 'record' : 'records';
    return `${countWords(item.partsDone)} ${packages} prepared · ${countWords(item.recordsSeen)} ${records} read`;
  }
  if (item.partsPlanned !== null) return `${countWords(item.partsDone)} of ${countWords(item.partsPlanned)} parts`;
  // A document is read page by page; its words are the item's reason, not a record count.
  if (item.state === 'reading' && item.family !== 'document') {
    return `Reading: ${countWords(item.recordsSeen)} records so far`;
  }
  return null;
}

/** CN1. A wide file's features outside its first map area are kept in separate batches; never on this map. */
export type CellBatch = NonNullable<IntakeItem['cellBatches']>[number];

/** Only a batch the server named for this officer opens; any other shows its cell and that it is separate. */
export function cellBatchPath(batch: CellBatch): string | null {
  return batch.caseId ? `/studio/work/cases/${batch.caseId}/intake` : null;
}

export function stateWords(state: IntakeItem['state']) {
  return states[state];
}

export function placementWords(placement: IntakeItem['placement']) {
  return placements[placement];
}

/** G10. A PDF the batch's page reader has read opens in the page viewer; an encrypted one has no pages to show. */
export function opensPages(item: IntakeItem) {
  return item.format === 'pdf' && item.state === 'read' && item.placement !== 'needs_answer' && Boolean(item.sourceId);
}

export function isSettled(item: IntakeItem) {
  if (item.planReadings?.some(reading => reading.status === 'queued')) return false;
  if (['read', 'read_to_limit', 'failed_part', 'probe_failed'].includes(item.state)) return true;
  return ['needs_answer', 'not_understood', 'waiting_for_anchor'].includes(item.placement);
}

export function countWords(value: number | null | undefined) {
  return value == null ? 'Unknown' : value.toLocaleString('en-IN');
}

export function fieldWords(path: string) {
  if (path === '/features/*/id') return 'id';
  return path.replace(/^\/features\/\*\/properties\//, '').replace(/~1/g, '/').replace(/~0/g, '~');
}

export function familyWords(family: IntakeItem['family']) {
  const words: Record<IntakeItem['family'], string> = {
    vector: 'Map features', table: 'Table', raster: 'Raster', point_cloud: 'Point cloud',
    model3d: '3D model', document: 'Document', image: 'Image', archive: 'Archive', unknown: 'Unknown',
  };
  return words[family];
}

/** A plain name for every format the server's intake signatures can name; a format not listed shows as stated. */
const formats: Record<string, string> = {
  geojson: 'GeoJSON', 'geojson-seq': 'GeoJSON sequence', ndjson: 'Newline-delimited JSON',
  shapefile: 'Shapefile', dbf: 'Shapefile attribute table', 'shapefile-index': 'Shapefile index',
  shapefile_zip: 'Shapefile ZIP', geopackage: 'GeoPackage', gpkg: 'GeoPackage', sqlite: 'SQLite database',
  parquet: 'Parquet table', geoparquet: 'GeoParquet', flatgeobuf: 'FlatGeobuf', kml: 'Google Earth KML',
  kmz: 'Google Earth KMZ', gml: 'GML', citygml: 'CityGML', tiff: 'TIFF image', bigtiff: 'BigTIFF image',
  geotiff: 'GeoTIFF image', png: 'PNG image', jpeg: 'JPEG image', las: 'LAS point cloud', laz: 'LAZ point cloud',
  e57: 'E57 point cloud', ply: 'PLY mesh', csv: 'Comma-separated table', tsv: 'Tab-separated table',
  xlsx: 'Excel workbook', xls: 'Excel 97-2003 workbook', ods: 'OpenDocument spreadsheet',
  docx: 'Word document', pdf: 'PDF document', ifc: 'IFC building model', glb: 'glTF binary model',
  gltf: 'glTF model', obj: 'OBJ model', dwg: 'AutoCAD drawing', dxf: 'DXF drawing', zip: 'ZIP archive',
  '7z': '7-Zip archive', rar: 'RAR archive',
};

export function formatWords(format: IntakeItem['format']) {
  if (!format) return 'Unknown';
  return formats[format] ?? format;
}

/** The tray's Contents column: format (or family when no format is known), size, and what the card counts. */
export function contentsWords(item: Pick<IntakeItem, 'family' | 'format' | 'sizeBytes' | 'card'>) {
  const kind = item.format ? formatWords(item.format) : familyWords(item.family);
  const size = item.sizeBytes == null ? 'size unknown' : sizeWords(item.sizeBytes);
  return [kind, size, holdsWords(item.card)].filter(Boolean).join(' · ');
}

const holds = [['features', 'feature', 'features'], ['rows', 'row', 'rows'], ['pages', 'page', 'pages'],
  ['points', 'point', 'points']] as const;

/** What the file holds, from the card's counts: each count the probe stated, with its unit; null when none. */
export function holdsWords(card: IntakeItem['card']): string | null {
  const stated = holds.flatMap(([key, one, many]) => {
    const count = card?.counts[key];
    return count == null ? [] : [`${countWords(count)} ${count === 1 ? one : many}`];
  });
  return stated.length ? stated.join(' · ') : null;
}

export function crsWords(card: IntakeItem['card']) {
  if (!card) return 'Unknown';
  const words = { stated: 'Stated', sidecar: 'Stated in a companion file', absent: 'Not stated',
    conflicting: 'Conflicting statements', not_applicable: 'Not applicable' };
  const state = words[card.crs.state];
  return card.crs.code ? `${state} · ${card.crs.code}` : state;
}
