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

export function partProgressWords(item: Pick<IntakeItem, 'state' | 'partsPlanned' | 'partsDone' | 'recordsSeen'>) {
  if (item.partsPlanned !== null) return `${countWords(item.partsDone)} of ${countWords(item.partsPlanned)} parts`;
  if (item.state === 'reading') return `Reading: ${countWords(item.recordsSeen)} records so far`;
  return null;
}

/**
 * One tray row per file and per layer. A ZIP's member row that names its own original (ZF1) is that layer's
 * item listed again, so only the layer's own item is shown; other member rows stay as the archive's contents.
 */
export function trayItems(items: readonly IntakeItem[]): IntakeItem[] {
  return items.filter(item => !(item.parentItemId && item.sourceId));
}

export function stateWords(state: IntakeItem['state']) {
  return states[state];
}

export function placementWords(placement: IntakeItem['placement']) {
  return placements[placement];
}

export function isSettled(item: IntakeItem) {
  // ZF2: once a ZIP is fanned out, its own row and each member left inside carry a reason; nothing reads them further.
  if (item.limitReason && (item.parentItemId ? !item.sourceId : item.format === 'zip')) return true;
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
    csv: 'CSV', xlsx: 'Excel workbook' };
  return words[format] ?? format;
}

export function crsWords(card: IntakeItem['card']) {
  if (!card) return 'Not known';
  const words = { stated: 'Stated', sidecar: 'Stated in a companion file', absent: 'Not stated',
    conflicting: 'Conflicting statements', not_applicable: 'Not applicable' };
  const state = words[card.crs.state];
  return card.crs.code ? `${state} · ${card.crs.code}` : state;
}
