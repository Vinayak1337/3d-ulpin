/** Browser-safe access to the intake readers' byte ceilings, not upload capacity. */
export { STREAMING_VECTOR_LIMITS } from './usp/streaming-vector';
export { RASTER_WINDOW_LIMITS } from './usp/raster-window';
export { POINT_BATCH_LIMITS } from './usp/point-batch';
export { IFC_LIMITS } from './usp/ifc-ingestion';
export { DOCUMENT_LIMITS } from './usp/document-ingestion';
export { INTAKE_PAGE_IMAGE_LIMITS } from './usp/intake';
export { TABULAR_STREAM_LIMITS } from './usp/ingestion';

/** Native GIS conversion's source/set ceiling (services/geo/geo/native_gis.py: MAX_SOURCE_BYTES). */
export const NATIVE_GIS_LIMITS = Object.freeze({ sourceBytes: 128 * 1024 ** 2 });
