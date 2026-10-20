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
  if (/\.(geojson|json|gpkg)$/i.test(name)) return 'Map file · joins the batch';
  if (/\.(pdf|docx?)$/i.test(name)) return 'Document · joins the batch';
  if (/\.(png|jpe?g|tiff?|webp)$/i.test(name)) return 'Image · joins the batch';
  return 'Original · kept in the batch';
}
