export type FileRoute = 'intake' | 'table';

/**
 * A successful opt-in development profile is handled before this production routing decision. CD1: a file of any
 * other kind is never refused for its kind. N01, XL1: CSV, XLSX and ODS keep their table import; every other file, a
 * GeoPackage and any ZIP included, joins the batch, where the server decides what a ZIP holds and converts a
 * GeoPackage or a shapefile set into layers.
 */
export function fileRoute(name: string): FileRoute {
  return /\.(csv|xlsx|ods)$/i.test(name) ? 'table' : 'intake';
}

/**
 * A dropped file's first state: only the opt-in profile reads map files and LAZ/TIFF here; the rest are routed.
 * TJ1: dropped into a batch (`inBatch`, the batch page), a CSV, XLSX or ODS joins it as its own item, read there.
 */
export function dropState(name: string, profile: boolean, inBatch = false): 'inspecting' | 'intake' | 'not-gis' {
  if (profile && /\.(geojson|json|gpkg|zip|laz|tif|tiff)$/i.test(name)) return 'inspecting';
  return fileRoute(name) === 'table' && !inBatch ? 'not-gis' : 'intake';
}

type DropState = ReturnType<typeof dropState> | 'ready';

/** TJ1: once one drop makes a batch, its tables join that batch too; a file of an earlier drop keeps its state. */
export function tablesJoin<T extends { file: File; state: DropState }>(files: readonly T[], drop: readonly File[]) {
  return files.map((file): T => file.state === 'not-gis' && drop.includes(file.file)
    ? { ...file, state: 'intake' } : file);
}

/**
 * TJ1: the files of one drop in the order the batch keeps them. A table first: it is kept before a map file of the
 * same drop starts drafting, so the register and its buildings are items of one batch case.
 */
export function batchOrder(files: readonly File[]): File[] {
  return [...files.filter(file => fileRoute(file.name) === 'table'),
    ...files.filter(file => fileRoute(file.name) !== 'table')];
}

/** TJ1: the words of a file that joins a batch; a table is read there. */
export function batchRouteWords(name: string): string {
  return fileRoute(name) === 'table' ? 'Table · joins the batch' : routeWords(name);
}

/** What will happen to one dropped file, in words from its route. */
export function routeWords(name: string): string {
  if (fileRoute(name) === 'table') return 'Table · opens the table import';
  if (/\.zip$/i.test(name)) return 'ZIP · joins the batch';
  if (/\.(geojson|json|gpkg|kml|kmz)$/i.test(name)) return 'Map file · joins the batch';
  if (/\.(shp|shx|dbf|prj|cpg)$/i.test(name)) return 'Shapefile part · joins the batch';
  if (/\.(pdf|docx?)$/i.test(name)) return 'Document · joins the batch';
  // XL1: an Excel 97-2003 workbook is kept; this version reads no cells of it.
  if (/\.xls$/i.test(name)) return 'Excel 97-2003 workbook · kept as evidence; its cells are not read';
  // An orthophoto, terrain or a page image: the batch decides which.
  if (/\.tiff?$/i.test(name)) return 'Image or raster · joins the batch';
  if (/\.(png|jpe?g|webp)$/i.test(name)) return 'Image · joins the batch';
  if (/\.(laz|las)$/i.test(name)) return 'Point cloud · joins the batch';
  if (/\.ifc$/i.test(name)) return 'Building model · joins the batch';
  return 'Original · kept in the batch';
}
