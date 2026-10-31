import type { GetResponse, Schemas } from '@ulpin/api-client';
import { CITYGML_LIMITS, CITYJSON_LIMITS, DOCUMENT_LIMITS, DXF_LIMITS, GLTF_LIMITS, IFC_LIMITS,
  INTAKE_PAGE_IMAGE_LIMITS, INTAKE_TABLE_READER_FORMATS, LARGE_ORIGINAL_V2_LIMITS, NATIVE_GIS_LIMITS,
  OBJ_LIMITS, POINT_BATCH_LIMITS,
  RASTER_WINDOW_LIMITS, STREAMING_VECTOR_LIMITS, TABULAR_STREAM_LIMITS,
} from '@ulpin/contracts/upload-reader-limits';

export type UploadLimits = GetResponse<'/api/v1/ingestion/upload-limits'>;
export type UploadReceipt = Schemas['POST_ingestion_cases_caseId_uploads_Response_201_application_json'];
export type UploadGuard = Schemas['POST_ingestion_cases_caseId_uploads_uploadId_abort_Request_application_json'];
export type UploadEntry = GetResponse<'/api/v1/ingestion/cases/{caseId}/uploads'>['uploads'][number];
export type UploadCreate = Omit<Schemas['POST_ingestion_cases_caseId_uploads_Request_application_json'], 'provenance'>
  & { provenance: { origin: 'not_stated'; acquiredAt: string } };
export interface UploadProgress {
  phase: 'checking' | 'waiting' | 'uploading' | 'verifying' | 'stopped' | 'cancelled';
  doneBytes: number;
  totalBytes: number;
  part: number;
  parts: number;
  words?: string;
}

// The bounded map routes (/sources, /intake/archives) take at most 16 MiB; a larger map file switches to POST uploads,
// which since CD1 takes any original of 1 byte or more.
export const LARGE_UPLOAD_MINIMUM = 16 * 1024 * 1024 + 1;

export function uploadPlan(size: number, limits: UploadLimits) {
  if (size > limits.largeProfile.limits.maxOriginalBytes)
    throw new Error(`This file exceeds the upload maximum of ${limits.largeProfile.limits.maxOriginalBytes
      .toLocaleString('en-IN')} bytes.`);
  const profile = size <= limits.limits.maxOriginalBytes ? limits.limits : limits.largeProfile.limits;
  const parts = Math.ceil(size / profile.partBytes);
  return { profile: profile.version, partBytes: profile.partBytes, parts,
    lastPartBytes: size - (parts - 1) * profile.partBytes };
}

export function uploadGuard(receipt: Pick<UploadReceipt, 'revision' | 'currentCaseRevision'>,
  requestKey: string): UploadGuard {
  return { requestKey, expectedRevision: receipt.revision, expectedCaseRevision: receipt.currentCaseRevision };
}

export function uploadWords(progress: UploadProgress): string {
  const percent = Math.floor(progress.doneBytes / progress.totalBytes * 100);
  if (progress.phase === 'checking') return `Checking the file: ${percent}%`;
  if (progress.phase === 'waiting') return progress.words || 'Waiting for a free upload slot. It starts by itself.';
  if (progress.phase === 'uploading') return `Uploading: ${percent}% (${MiB(progress.doneBytes)} of `
    + `${MiB(progress.totalBytes)} MiB)`;
  if (progress.phase === 'verifying') return progress.words || 'Verifying the upload';
  if (progress.phase === 'cancelled') return 'Upload cancelled';
  const part = progress.parts > 0 ? ` at part ${progress.part} of ${progress.parts}` : '';
  return `The upload stopped${part}: ${progress.words || 'the server did not answer'}.`;
}

function MiB(bytes: number): string {
  return (bytes / 1024 ** 2).toFixed(1).replace(/\.0$/, '');
}

/** A size in words: GiB from 1 GiB, MiB from 1 MiB, KiB below. */
export function sizeWords(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1).replace(/\.0$/, '')} GiB`;
  if (bytes >= 1024 ** 2) return `${MiB(bytes)} MiB`;
  if (bytes === 0) return '0 KiB';
  return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

/**
 * One reader's forecast, said as one short phrase with its ceiling. `read` replaces the reader's name where the name
 * cannot settle whether the reader takes the file, so it states the condition the bytes must meet. `beyond` is a
 * second reader that still takes a file above `bytes`, up to its own ceiling, on a condition only the bytes settle.
 */
interface ReaderForecast {
  name: string; bytes: number; read?: string;
  beyond?: { name: string; bytes: number; read: string };
}

const pointReader: ReaderForecast = { name: 'point cloud', bytes: POINT_BATCH_LIMITS.originalBytes,
  read: `LAS 1.2–1.4, formats 0–3 or 6–8, ${POINT_BATCH_LIMITS.sourcePoints / 1e6}M points` };
const gltfReader: ReaderForecast = { name: 'glTF', bytes: GLTF_LIMITS.originalBytes, read: 'glTF' };
const tableReader: ReaderForecast = { name: 'table', bytes: TABULAR_STREAM_LIMITS.bytes };
const geojsonLinesReader: ReaderForecast = { name: 'GeoJSON', bytes: STREAMING_VECTOR_LIMITS.sourceBytes,
  read: 'GeoJSON if its lines are features' };
const geoparquetReader: ReaderForecast = { name: 'native GIS conversion', bytes: NATIVE_GIS_LIMITS.sourceBytes,
  read: 'GeoParquet if the bytes show it' };
const shapefileMemberReader: ReaderForecast = { name: 'native GIS conversion', bytes: NATIVE_GIS_LIMITS.sourceBytes,
  read: 'Native GIS with its shapefile set' };

const readers: Record<string, ReaderForecast> = {
  geojson: { name: 'GeoJSON', bytes: STREAMING_VECTOR_LIMITS.sourceBytes },
  geojsons: geojsonLinesReader,
  geojsonl: geojsonLinesReader,
  jsonseq: geojsonLinesReader,
  ndjson: geojsonLinesReader,
  jsonl: geojsonLinesReader,
  json: { name: 'GeoJSON', bytes: STREAMING_VECTOR_LIMITS.sourceBytes,
    read: 'GeoJSON, CityJSON or glTF, by its bytes' },
  cityjson: { name: 'CityJSON', bytes: CITYJSON_LIMITS.originalBytes,
    read: 'CityJSON if the bytes show it' },
  dxf: { name: 'DXF', bytes: DXF_LIMITS.originalBytes },
  glb: gltfReader,
  gltf: gltfReader,
  obj: { name: 'OBJ', bytes: OBJ_LIMITS.originalBytes },
  gml: { name: 'CityGML', bytes: CITYGML_LIMITS.originalBytes,
    read: 'CityGML if the bytes show it' },
  gpkg: { name: 'native GIS conversion', bytes: NATIVE_GIS_LIMITS.sourceBytes },
  kml: { name: 'native GIS conversion', bytes: NATIVE_GIS_LIMITS.sourceBytes },
  kmz: { name: 'native GIS conversion', bytes: NATIVE_GIS_LIMITS.sourceBytes },
  shp: { name: 'native GIS conversion', bytes: NATIVE_GIS_LIMITS.sourceBytes },
  shx: shapefileMemberReader,
  dbf: shapefileMemberReader,
  parquet: geoparquetReader,
  geoparquet: geoparquetReader,
  docx: { name: 'DOCX', bytes: DOCUMENT_LIMITS.nativeBytes },
  zip: { name: 'ZIP', bytes: LARGE_ORIGINAL_V2_LIMITS.maxOriginalBytes,
    read: 'ZIP, each member on its own' },
  ifc: { name: 'IFC structure', bytes: IFC_LIMITS.originalBytes },
  pdf: { name: 'PDF native text', bytes: DOCUMENT_LIMITS.nativeBytes,
    beyond: { name: 'PDF document', bytes: DOCUMENT_LIMITS.originalBytes,
      read: `PDF OCR if at most ${DOCUMENT_LIMITS.ocrMaxPage} pages` } },
  tif: { name: 'raster', bytes: RASTER_WINDOW_LIMITS.originalBytes },
  tiff: { name: 'raster', bytes: RASTER_WINDOW_LIMITS.originalBytes },
  las: pointReader,
  laz: pointReader,
  png: { name: 'page image preview', bytes: INTAKE_PAGE_IMAGE_LIMITS.originalBytes },
  jpg: { name: 'page image preview', bytes: INTAKE_PAGE_IMAGE_LIMITS.originalBytes },
  jpeg: { name: 'page image preview', bytes: INTAKE_PAGE_IMAGE_LIMITS.originalBytes },
  ...Object.fromEntries(INTAKE_TABLE_READER_FORMATS.map((format) => [format, tableReader])),
};

/** The dialog does not read file headers: this is a name-based size forecast, never a routing decision. */
export function readerEligibility(file: { name: string; size: number }) {
  const extension = /\.([^.]+)$/.exec(file.name)?.[1]?.toLowerCase() ?? '';
  if (extension === 'xls') return { reader: null, ceilingBytes: null, withinCeiling: null,
    words: 'Excel 97-2003: kept, not read; save as XLSX or ODS' };
  const reader = Object.hasOwn(readers, extension) ? readers[extension] : undefined;
  if (!reader) return { reader: null, ceilingBytes: null, withinCeiling: null, words: 'Kind not known yet' };
  const beyond = reader.beyond && file.size > reader.bytes && file.size <= reader.beyond.bytes ? reader.beyond : null;
  if (beyond) return { reader: beyond.name, ceilingBytes: beyond.bytes, withinCeiling: true,
    words: `${beyond.read}, up to ${sizeWords(beyond.bytes)}` };
  const withinCeiling = file.size <= reader.bytes;
  const top = reader.beyond ?? reader;
  const named = reader.read ?? reader.name.charAt(0).toUpperCase() + reader.name.slice(1);
  const words = withinCeiling ? `${named}, up to ${sizeWords(reader.bytes)}`
    : `Kept, not read: over ${sizeWords(top.bytes)}`;
  return { reader: reader.name, ceilingBytes: withinCeiling ? reader.bytes : top.bytes, withinCeiling, words };
}

/** D3. A file not added or still to add, kept as words only: never its bytes. */
export interface WaitingFile {
  name: string;
  sizeBytes: number;
  words: string | null;
}

const waitingKey = (caseId: string) => `ulpin.batch-waiting.${caseId}`;
const isWaitingFile = (value: unknown): value is WaitingFile => {
  const file = value as WaitingFile | null;
  return typeof file?.name === 'string' && typeof file.sizeBytes === 'number'
    && (file.words === null || typeof file.words === 'string');
};

/** Keeps the words under the case id, or clears them when none are left; a storage that throws is ignored. */
export function keepWaiting(storage: () => Storage, caseId: string, files: WaitingFile[]) {
  try {
    if (files.length) storage().setItem(waitingKey(caseId), JSON.stringify(files));
    else storage().removeItem(waitingKey(caseId));
  } catch {
    // Words only: the page works without them.
  }
}

export function readWaiting(storage: () => Storage, caseId: string): WaitingFile[] {
  try {
    const value: unknown = JSON.parse(storage().getItem(waitingKey(caseId)) ?? '[]');
    return Array.isArray(value) ? value.filter(isWaitingFile) : [];
  } catch {
    return [];
  }
}
