import type { IntakeItem } from '../batch-model';

/**
 * NO1. Which native reading an item offers. Kept apart from the reading model, whose model preview draws with the
 * scene, so the batch page decides without loading the scene.
 */
export type NativeReader = 'dxf' | 'citygml' | 'cityjson' | 'gltf' | 'obj';

const readerOf: Record<string, NativeReader> = { dxf: 'dxf', citygml: 'citygml', cityjson: 'cityjson', glb: 'gltf',
  gltf: 'gltf', obj: 'obj' };

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
