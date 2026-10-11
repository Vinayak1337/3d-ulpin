function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Receipt identity only. Callers still prove site, committed observation and exact original bytes. */
export function isRetainedMapOriginal(source: { profile?: unknown; sha256?: unknown; inspection?: unknown }): boolean {
  const inspection = object(source.inspection);
  const manual = object(inspection?.manualProfile);
  const gis = object(inspection?.gis);
  return source.profile === 'geojson-manual-v1' && manual?.version === 'manual-geojson/1'
    && manual.format === 'geojson' && typeof source.sha256 === 'string' && gis?.sourceSha256 === source.sha256;
}
