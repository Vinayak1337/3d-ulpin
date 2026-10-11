export type FileRoute = 'intake' | 'direct' | 'table' | 'unsupported';

/** A successful opt-in development profile is handled before this production routing decision. */
export function fileRoute(name: string): FileRoute {
  if (/\.(geojson|json)$/i.test(name)) return 'intake';
  if (/\.(gpkg|zip)$/i.test(name)) return 'direct';
  if (/\.(csv|xlsx)$/i.test(name)) return 'table';
  return 'unsupported';
}
