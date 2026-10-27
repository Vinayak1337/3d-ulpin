import type { PoolClient } from 'pg';
import { AppError } from '../../../infrastructure/errors';

const formats = {
  raster: ['geotiff-raster-v1', 'raster'],
  point: ['laz-point-v1', 'point'],
  kml: ['kml-native-v1', 'KML'],
  citygml: ['citygml-native-v1', 'CityGML'],
  cityjson: ['cityjson-native-v1', 'CityJSON'],
  dxf: ['dxf-native-v1', 'DXF'],
  geoparquet: ['geoparquet-native-v1', 'GeoParquet'],
  gltf: ['gltf-native-v1', 'glTF'],
  ifc: ['ifc-native-v1', 'IFC'],
  obj: ['obj-native-v1', 'OBJ'],
} as const;
type Limits = { retainedSources: number; retainedBytes: number };

// Callers hold their existing admission and case locks. Every revision still occupies storage.
export async function caseRetentionBudgetTx(
  client: PoolClient, caseId: string, format: keyof typeof formats, limits: Limits, addBytes: number,
) {
  const [profile, label] = formats[format];
  const budget = (await client.query('SELECT count(*)::int sources,coalesce(sum(bytes),0)::text bytes '
    + 'FROM sources WHERE case_id=$1 AND profile=$2', [caseId, profile])).rows[0];
  const sources = Number(budget.sources), bytes = Number(budget.bytes);
  const countFull = sources >= limits.retainedSources;
  if (countFull || bytes + addBytes > limits.retainedBytes) {
    throw new AppError(429, `${format.toUpperCase()}_RETENTION_BUDGET`,
      `This case retains ${sources} ${label} sources and ${bytes} bytes; `
      + `its limits are ${limits.retainedSources} sources and ${limits.retainedBytes / 1024 ** 2} MiB. `
      + 'Existing originals stay, so add more files in another case.',
      { limit: countFull ? 'case_retained_sources' : 'case_retained_bytes', freesAt: null });
  }
}
