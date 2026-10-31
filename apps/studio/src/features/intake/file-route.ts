export type FileRoute = 'intake' | 'table';

/**
 * A successful opt-in development profile is handled before this production routing decision. CD1: a file of any
 * other kind is never refused for its kind. N01, XL1, S7.13a: every file joins the batch, a GeoPackage, any ZIP
 * and the tables it reads (CSV, TSV, XLSX, ODS) included; the server decides what a ZIP holds and converts a
 * GeoPackage or a shapefile set into layers. A table is only ordered first (`batchOrder`).
 */
export function fileRoute(name: string): FileRoute {
  return /\.(csv|tsv|xlsx|ods)$/i.test(name) ? 'table' : 'intake';
}

/** A dropped file's first state: only the opt-in profile reads map files and LAZ/TIFF here; the rest join the batch. */
export function dropState(name: string, profile: boolean): 'inspecting' | 'intake' {
  return profile && /\.(geojson|json|gpkg|zip|laz|tif|tiff)$/i.test(name) ? 'inspecting' : 'intake';
}

/**
 * TJ1: the files of one drop in the order the batch keeps them. A table first: it is kept before a map file of the
 * same drop starts drafting, so the register and its buildings are items of one batch case.
 */
export function batchOrder(files: readonly File[]): File[] {
  return [...files.filter(file => fileRoute(file.name) === 'table'),
    ...files.filter(file => fileRoute(file.name) !== 'table')];
}

/** What will happen to one dropped file, in words from its route. */
export function routeWords(name: string): string {
  if (fileRoute(name) === 'table') return 'Table · joins the batch';
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
