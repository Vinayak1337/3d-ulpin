export type FileRoute = 'intake' | 'table';

/**
 * A successful opt-in development profile is handled before this production routing decision. CD1: a file of any
 * other kind is never refused for its kind. N01: CSV and XLSX keep their table import; every other file, a GeoPackage
 * and any ZIP included, joins the batch, where the server decides what a ZIP holds and converts a GeoPackage or a
 * shapefile set into layers.
 */
export function fileRoute(name: string): FileRoute {
  return /\.(csv|xlsx)$/i.test(name) ? 'table' : 'intake';
}

/** A dropped file's first state: only the opt-in profile reads map files and LAZ/TIFF here; the rest are routed. */
export function dropState(name: string, profile: boolean): 'inspecting' | 'intake' | 'not-gis' {
  if (profile && /\.(geojson|json|gpkg|zip|laz|tif|tiff)$/i.test(name)) return 'inspecting';
  return fileRoute(name) === 'table' ? 'not-gis' : 'intake';
}

/** What will happen to one dropped file, in words from its route. */
export function routeWords(name: string): string {
  if (fileRoute(name) === 'table') return 'Table · opens the table import';
  if (/\.zip$/i.test(name)) return 'ZIP · the batch reads what it holds';
  if (/\.(geojson|json|gpkg|kml|kmz)$/i.test(name)) return 'Map file · joins the batch';
  if (/\.(shp|dbf|shx|prj)$/i.test(name)) return 'Shapefile part · kept in the batch';
  if (/\.(pdf|docx?)$/i.test(name)) return 'Document · joins the batch';
  // An orthophoto, terrain or a page image: the batch decides which.
  if (/\.tiff?$/i.test(name)) return 'Image or raster · joins the batch';
  if (/\.(png|jpe?g|webp)$/i.test(name)) return 'Image · joins the batch';
  if (/\.(laz|las)$/i.test(name)) return 'Point cloud · joins the batch';
  if (/\.ifc$/i.test(name)) return 'Building model · joins the batch';
  return 'Original · kept in the batch';
}
