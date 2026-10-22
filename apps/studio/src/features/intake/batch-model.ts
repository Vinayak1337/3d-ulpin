import type { GetResponse } from '@ulpin/api-client';
import type { Package } from './run/model';

export type IntakeManifest = GetResponse<'/api/v1/ingestion/cases/{caseId}/intake'>;
export type IntakeItem = IntakeManifest['items'][number];

const states: Record<IntakeItem['state'], string> = {
  received: 'Original received', probed: 'File checked', planned: 'Layout prepared', reading: 'Reading file',
  read: 'Read', read_to_limit: 'Read to the limit', failed_part: 'Part could not be read',
  probe_failed: 'File could not be checked',
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

export function partProgressWords(item: Pick<IntakeItem, 'state' | 'partsPlanned' | 'partsDone' | 'recordsSeen'>
  & Partial<Pick<IntakeItem, 'family'>>) {
  if (item.partsPlanned !== null) return `${countWords(item.partsDone)} of ${countWords(item.partsPlanned)} parts`;
  // A document is read page by page; its words are the item's reason, not a record count.
  if (item.state === 'reading' && item.family !== 'document') {
    return `Reading: ${countWords(item.recordsSeen)} records so far`;
  }
  return null;
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
  if (['read', 'read_to_limit', 'failed_part', 'probe_failed'].includes(item.state)) return true;
  return ['needs_answer', 'not_understood', 'waiting_for_anchor'].includes(item.placement);
}

export function countWords(value: number | null | undefined) {
  return value == null ? 'Not known' : value.toLocaleString('en-IN');
}

export function fieldWords(path: string) {
  if (path === '/features/*/id') return 'id';
  return path.replace(/^\/features\/\*\/properties\//, '').replace(/~1/g, '/').replace(/~0/g, '~');
}

export function familyWords(family: IntakeItem['family']) {
  const words: Record<IntakeItem['family'], string> = {
    vector: 'Map features', table: 'Table', raster: 'Raster', point_cloud: 'Point cloud',
    model3d: '3D model', document: 'Document', image: 'Image', archive: 'Archive', unknown: 'Not known',
  };
  return words[family];
}

export function sizeClassWords(sizeClass: IntakeItem['sizeClass']) {
  if (!sizeClass) return 'Not known';
  return { S: 'Small file', M: 'Medium file', L: 'Large file', XL: 'Very large file' }[sizeClass];
}

export function formatWords(format: IntakeItem['format']) {
  if (!format) return 'Not known';
  const words: Record<string, string> = { geojson: 'GeoJSON', gpkg: 'GeoPackage', shapefile_zip: 'Shapefile ZIP',
    csv: 'CSV', xlsx: 'Excel workbook', ods: 'OpenDocument spreadsheet', xls: 'Excel 97-2003 workbook' };
  return words[format] ?? format;
}

export function crsWords(card: IntakeItem['card']) {
  if (!card) return 'Not known';
  const words = { stated: 'Stated', sidecar: 'Stated in a companion file', absent: 'Not stated',
    conflicting: 'Conflicting statements', not_applicable: 'Not applicable' };
  const state = words[card.crs.state];
  return card.crs.code ? `${state} · ${card.crs.code}` : state;
}
