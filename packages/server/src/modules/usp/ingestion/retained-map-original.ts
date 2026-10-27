import { StreamedMapOriginalReceiptSchema } from '@ulpin/contracts/usp';

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Receipt identity only. Callers still prove site, committed observation and exact original bytes. */
export function isRetainedMapOriginal(source: {
  id?: unknown; revision?: unknown; bytes?: unknown; profile?: unknown; sha256?: unknown; inspection?: unknown;
}): boolean {
  const inspection = object(source.inspection);
  const manual = object(inspection?.manualProfile);
  const gis = object(inspection?.gis);
  const bounded = ['geojson-manual-v1', 'large-original-v1'].includes(String(source.profile))
    && manual?.version === 'manual-geojson/1' && manual.format === 'geojson'
    && typeof source.sha256 === 'string' && gis?.sourceSha256 === source.sha256;
  if (bounded) {
    if (source.profile !== 'large-original-v1') return true;
    const upload = object(inspection?.largeOriginal);
    return Number(source.bytes) <= 16 * 1024 * 1024 && upload?.verifiedSha256 === source.sha256
      && upload?.verifiedBytes === Number(source.bytes);
  }
  if (source.profile === 'large-original-v1') {
    const parsed = StreamedMapOriginalReceiptSchema.safeParse(inspection?.streamedMapReceipt);
    const upload = object(inspection?.largeOriginal);
    if (!parsed.success) return false;
    const receipt = parsed.data;
    return receipt.reference.coordinateUnit !== 'unknown'
      && receipt.sourceId === source.id && receipt.sourceRevision === source.revision
      && receipt.sourceBytes === Number(source.bytes) && receipt.sourceSha256 === source.sha256
      && upload?.verifiedSha256 === receipt.sourceSha256 && upload?.verifiedBytes === receipt.sourceBytes;
  }
  return false;
}
