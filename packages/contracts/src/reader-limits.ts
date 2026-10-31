// Reader ceilings and plain intake values that build no schema. A browser module that needs only these imports
// @ulpin/contracts/upload-reader-limits, so loading it never evaluates zod or a schema module. The module named
// above each value imports it back from here for its schemas and re-exports it under the same name.
// Its only runtime import is ./usp/intake-needs, which has none.
export { INTAKE_TABLE_READER_FORMATS } from './usp/intake-needs';

// usp/streaming-vector.ts
const parts=5000,partFeatures=100;
/** The one source of the large GeoJSON ceilings: 1 GiB and 5000 parts of 100 features (500,000 features). */
export const STREAMING_VECTOR_LIMITS=Object.freeze({
  version:'geojson-stream/2',featureBytes:1024*1024,chunkBytes:512*1024,
  chunkFeatures:partFeatures,featurePositions:10000,chunks:parts,features:parts*partFeatures,sourceBytes:1024*1024*1024,
  metadataBytes:64*1024,metadataFields:32,jsonNesting:64,
  numberPolicy:'exact_decimal_roundtrip_or_quarantine',duplicateKeyPolicy:'quarantine',
  readMs:10*60*1000,readSpanBytes:128*1024*1024,lookaheadSlots:8,stagedBytes:64*1024*1024,
  rawIdleMs:2*60*1000,rawOuterMsPerSpan:30*60*1000,
});

/** Native GIS conversion's source/set ceiling (services/geo/geo/native_gis.py: MAX_SOURCE_BYTES). */
export const NATIVE_GIS_LIMITS = Object.freeze({ sourceBytes: STREAMING_VECTOR_LIMITS.sourceBytes });

// usp/raster-window.ts
// SB1: (1 overview + 64 preview tiles) under three pins = 195 jobs per original.
export const RASTER_WINDOW_LIMITS=Object.freeze({originalBytes:2*1024**3,directRetainBytes:16*1024*1024,
  retainedSources:64,retainedBytes:256*1024*1024,
  displayBands:4,windowSide:256,windowPixels:256*256,windowRawBytes:2*1024*1024,
  artifactBytes:4*1024*1024,resultBytes:32*1024,jobsPerSource:195,active:2});

// usp/point-batch.ts
// SB1: (1 overview + 64 preview batches) under three pins = 195 jobs; 611 keeps legacy plans within the cap.
export const POINT_BATCH_LIMITS=Object.freeze({originalBytes:1024**3,directRetainBytes:16*1024*1024,retainedSources:64,
  retainedBytes:256*1024*1024,sourcePoints:500_000_000,batchPoints:32_768,
  artifactBytes:2*1024*1024,resultBytes:32*1024,jobsPerSource:611,active:2});

// usp/ifc-ingestion.ts
export const IFC_LIMITS=Object.freeze({originalBytes:32*1024*1024,artifactBytes:16*1024*1024,
  resultBytes:64*1024,statusBytes:64*1024,retainedSources:64,retainedBytes:256*1024*1024,jobsPerSource:16,
  active:2,workerMs:150_000,requestMs:45_000,readMs:60_000,
  // Pass 1 structure scan; services/geo/geo/native_ifc.py Limits states the same ceilings.
  structureEntities:10_000,structureBytes:32*1024*1024,structureMs:20_000,structureOutputBytes:48*1024});

// document-pages.ts
/** Shared opening/raster bounds for private PDF pages and selected-page OCR; originals are never rewritten. */
export const DOCUMENT_PAGE_LIMITS=Object.freeze({originalBytes:1024**3,pages:400,pageSize:50,
  metadataBytes:128*1024,pngBytes:8*1024**2,pixels:1_600_000,side:1400,seconds:30,memoryBytes:2*1024**3});

// usp/document-ingestion.ts
// Original opening follows the page profile; native text stays bounded to 10 MiB independently.
export const DOCUMENT_LIMITS=Object.freeze({originalBytes:DOCUMENT_PAGE_LIMITS.originalBytes,
  nativeBytes:10*1024*1024,resultBytes:4*1024*1024,
  characters:250000,parts:10000,partCharacters:4096,page:25,candidates:40,modelCharacters:12000,modelParts:12,jobs:32,
  ocrPages:1,ocrBatchPages:8,ocrMaxPage:DOCUMENT_PAGE_LIMITS.pages,ocrItems:64});
/** Native PDF warnings identify scanned pages; one existing OCR job reads one selected page. */
export function documentScannedPages(native: { format: string; status: string; warnings: readonly string[] }) {
  if (native.format !== 'pdf' || !['extracted', 'needs_ocr'].includes(native.status)) return [];
  const pages = native.warnings.flatMap(warning => {
    const match = /^PDF page ([1-9]\d*) has no native text/.exec(warning);
    return match ? [Number(match[1])] : [];
  });
  return [...new Set(pages)].filter(Number.isSafeInteger).sort((left, right) => left - right);
}

// usp/dxf-ingestion.ts
export const DXF_LIMITS=Object.freeze({originalBytes:16*1024*1024,artifactBytes:16*1024*1024,
  resultBytes:16*1024,statusBytes:16*1024,retainedSources:64,retainedBytes:256*1024*1024,jobsPerSource:16,
  active:1,workerMs:150_000,requestMs:45_000,readMs:60_000,
  entities:60_000,records:65_000,points:60_000,tags:600_000,pages:20,pageBytes:8*1024*1024});

// usp/citygml-ingestion.ts
export const CITYGML_LIMITS=Object.freeze({originalBytes:33*1024*1024,artifactBytes:16*1024*1024,
  elements:302777,coordinateValues:449342,
  resultBytes:512*1024,statusBytes:512*1024,retainedSources:64,retainedBytes:256*1024*1024,jobsPerSource:16,
  active:1,workerMs:150_000,requestMs:45_000,readMs:60_000});

// usp/cityjson-ingestion.ts
export const CITYJSON_LIMITS=Object.freeze({originalBytes:8*1024*1024,artifactBytes:32*1024*1024,
  resultBytes:16*1024,statusBytes:16*1024,retainedSources:64,retainedBytes:128*1024*1024,jobsPerSource:16,active:2});

// usp/gltf-ingestion.ts
export const GLTF_LIMITS=Object.freeze({originalBytes:16*1024*1024,artifactBytes:16*1024*1024,
  resultBytes:512*1024,statusBytes:512*1024,retainedSources:64,retainedBytes:256*1024*1024,jobsPerSource:16,
  active:1,workerMs:150_000,requestMs:45_000,readMs:60_000});

// usp/obj-ingestion.ts
export const OBJ_LIMITS=Object.freeze({originalBytes:16*1024*1024,artifactBytes:16*1024*1024,
  resultBytes:512*1024,statusBytes:512*1024,retainedSources:64,retainedBytes:256*1024*1024,jobsPerSource:16,
  active:1,workerMs:150_000,requestMs:45_000,readMs:60_000});

// usp/ingestion.ts
export const TABULAR_LIMITS = Object.freeze({ bytes: 16 * 1024 * 1024, rows: 2000, columns: 256, chunkRows: 16 });
/** A CSV or workbook above TABULAR_LIMITS.bytes is read as a stream in row windows; its byte ceiling is
 * large-original/2's. */
export const TABULAR_STREAM_LIMITS = Object.freeze({ bytes: 7 * 1024 ** 3, rows: 1_000_000, windowRows: 10_000,
  recordBytes: 1024 * 1024, windowBytes: 16 * 1024 * 1024, windows: 4096, pageRows: 500 });
/** Byte receipt is independent of semantic parsing/conversion admission. The active limits count open receipts
 * (not finalized, aborted or expired); maxReservedOriginalBytes bounds the bytes open receipts reserve runtime-wide
 * and, per case, the retained and open originals together. */
export const LARGE_ORIGINAL_LIMITS = {
  version: 'large-original/1', partBytes: 8 * 1024 * 1024, maxOriginalBytes: 128 * 1024 * 1024,
  maxParts: 16, maxActivePerCase: 2, maxActivePerOperator: 2, maxActiveGlobal: 4,
  maxZeroPayloadFenceObjectsPerReceipt: 17,
  maxReservedOriginalBytes: 512 * 1024 * 1024, maxStoredBytesIncludingTemporaryCopies: 1024 * 1024 * 1024,
  uploadLifetimeSeconds: 24 * 60 * 60, partRequestSeconds: 30, storageRequestSeconds: 30,
  leaseSeconds: 180, finalizationSeconds: 120, cleanupSeconds: 120, maxFinalizationAttempts: 3, maxPartAttempts: 3,
  maxConcurrentDownloads: 2, downloadSeconds: 120,
  storageProfile: 'unversioned_private_conditional_put', cleanupProtection: 'permanent_zero_payload_fences',
} as const;
/** Opt-in transport capacity. One source can require parts, an open MPU and a sealed original at once. */
export const LARGE_ORIGINAL_V2_LIMITS = {
  version: 'large-original/2', partBytes: LARGE_ORIGINAL_LIMITS.partBytes,
  maxOriginalBytes: 7 * 1024 ** 3, maxParts: 896, maxActiveGlobal: 1,
  maxReservedOriginalBytes: 7 * 1024 ** 3,
  maxStoredBytesIncludingTemporaryCopies: 22 * 1024 ** 3,
  uploadLifetimeSeconds: 7 * 24 * 60 * 60, partRequestSeconds: 30, storageRequestSeconds: 60,
  leaseSeconds: 180, finalizationSeconds: 12 * 60 * 60, cleanupSeconds: 12 * 60 * 60,
  maxFinalizationAttempts: 3, maxPartAttempts: 3, maxConcurrentDownloads: 1,
  downloadSeconds: 12 * 60 * 60, storageProfile: 'unversioned_private_conditional_multipart',
  cleanupProtection: 'permanent_zero_payload_fences',
} as const;

// usp/intake.ts
/** Plain format names shared by reading cards and the Studio; an unlisted format stays unnamed. */
export const INTAKE_FORMAT_NAMES: Readonly<Record<string, string>> = Object.freeze({
  '7z': '7-Zip', bigtiff: 'BigTIFF', citygml: 'CityGML', cityjson: 'CityJSON', csv: 'CSV', dbf: 'dBASE',
  dwg: 'AutoCAD drawing', dxf: 'DXF', e57: 'E57', flatgeobuf: 'FlatGeobuf', geojson: 'GeoJSON',
  'geojson-seq': 'GeoJSON sequence', geopackage: 'GeoPackage', glb: 'Binary glTF', gltf: 'glTF', gml: 'GML',
  ifc: 'IFC', jpeg: 'JPEG', kml: 'KML', ndjson: 'Newline-delimited JSON', obj: 'Wavefront OBJ', parquet: 'Parquet',
  pdf: 'PDF', ply: 'PLY', png: 'PNG', rar: 'RAR', shapefile: 'Shapefile', sqlite: 'SQLite', tiff: 'TIFF',
  tsv: 'TSV', xls: 'Excel 97-2003', zip: 'ZIP', xlsx: 'XLSX', ods: 'OpenDocument spreadsheet',
  kmz: 'Compressed KML', las: 'LAS', laz: 'LAZ', geotiff: 'GeoTIFF', geoparquet: 'GeoParquet',
  shapefile_zip: 'Shapefile ZIP',
});
/** XL1: an Excel 97-2003 workbook (`xls`) is recognised and kept; no reader takes its cells. */
export const INTAKE_LEGACY_WORKBOOK_WORDS = 'It is kept as evidence; this version does not read its cells. Save it '
  + 'as XLSX or ODS and add that file to place its rows on the map.';
/** G23. A page image (JPEG, PNG, TIFF without georeference) in a batch: its first, native read and no more. */
export const INTAKE_PAGE_IMAGE_LIMITS = Object.freeze({ originalBytes: 128 * 1024 ** 2, headBytes: 1024 ** 2,
  inputPixels: 250_000_000, previewSide: 1024, previewBytes: 8 * 1024 ** 2 });
export const INTAKE_TARGET_LIMITS = Object.freeze({ draftTargets: 2000, confirmationTargets: 100, page: 200 });
export const INTAKE_EVIDENCE_LIMITS = Object.freeze({
  literalChars: 1024, quoteChars: 4096, tables: 16, documents: 16, page: 200, targets: 16, decisions: 100,
  sources: 100,
});
