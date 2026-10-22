import type { GetResponse, Schemas } from '@ulpin/api-client';
import { CITYGML_LIMITS, CITYJSON_LIMITS, DOCUMENT_LIMITS, DXF_LIMITS, GLTF_LIMITS, IFC_LIMITS,
  INTAKE_PAGE_IMAGE_LIMITS, INTAKE_TABLE_READER_FORMATS, NATIVE_GIS_LIMITS, OBJ_LIMITS, POINT_BATCH_LIMITS,
  RASTER_WINDOW_LIMITS, STREAMING_VECTOR_LIMITS, TABULAR_STREAM_LIMITS } from '@ulpin/contracts/upload-reader-limits';

export type UploadLimits = GetResponse<'/api/v1/ingestion/upload-limits'>;
export type UploadReceipt = Schemas['POST_ingestion_cases_caseId_uploads_Response_201_application_json'];
export type UploadGuard = Schemas['POST_ingestion_cases_caseId_uploads_uploadId_abort_Request_application_json'];
export type UploadEntry = GetResponse<'/api/v1/ingestion/cases/{caseId}/uploads'>['uploads'][number];
export type UploadCreate = Omit<Schemas['POST_ingestion_cases_caseId_uploads_Request_application_json'], 'provenance'>
  & { provenance: { origin: 'not_stated'; acquiredAt: string } };
export interface UploadProgress {
  phase: 'checking' | 'uploading' | 'verifying' | 'stopped' | 'cancelled';
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
  if (progress.phase === 'uploading') return `Uploading: ${percent}% (${MiB(progress.doneBytes)} of `
    + `${MiB(progress.totalBytes)} MiB)`;
  if (progress.phase === 'verifying') return progress.words || 'Verifying the upload';
  if (progress.phase === 'cancelled') return 'Upload cancelled';
  return `The upload stopped at part ${progress.part} of ${progress.parts}: `
    + `${progress.words || 'the server did not answer'}.`;
}

function MiB(bytes: number): string {
  return (bytes / 1024 ** 2).toFixed(1).replace(/\.0$/, '');
}

/** A size in words: GiB from 1 GiB, MiB from 1 MiB, KiB below. */
export function sizeWords(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1).replace(/\.0$/, '')} GiB`;
  if (bytes >= 1024 ** 2) return `${MiB(bytes)} MiB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

/**
 * One reader's forecast. `read` replaces "Will be read by the … reader" where the name cannot settle whether the
 * reader takes the file, so the words state the condition the bytes must meet instead.
 */
interface ReaderForecast { name: string; bytes: number; read?: string; note?: string }

const evidenceOnly = 'Its reading is kept as evidence, not placed on the map.';
const pointReader: ReaderForecast = { name: 'point cloud', bytes: POINT_BATCH_LIMITS.originalBytes,
  read: 'Points are read when the file is compressed LAZ of LAS 1.4 point format 6 with at most '
    + `${POINT_BATCH_LIMITS.sourcePoints / 1e6} million points`, note: 'Other point files are kept, not read.' };
const gltfReader: ReaderForecast = { name: 'glTF', bytes: GLTF_LIMITS.originalBytes, note: evidenceOnly };
const tableReader: ReaderForecast = { name: 'table', bytes: TABULAR_STREAM_LIMITS.bytes,
  note: 'Choose Read as a table after upload.' };

const readers: Record<string, ReaderForecast> = {
  geojson: { name: 'GeoJSON', bytes: STREAMING_VECTOR_LIMITS.sourceBytes },
  json: { name: 'GeoJSON', bytes: STREAMING_VECTOR_LIMITS.sourceBytes,
    read: 'Read as GeoJSON or CityJSON once its bytes are checked',
    note: `A CityJSON is read up to ${sizeWords(CITYJSON_LIMITS.originalBytes)}; other JSON is kept, not read.` },
  dxf: { name: 'DXF', bytes: DXF_LIMITS.originalBytes, note: evidenceOnly },
  glb: gltfReader,
  gltf: gltfReader,
  obj: { name: 'OBJ', bytes: OBJ_LIMITS.originalBytes, note: evidenceOnly },
  gml: { name: 'CityGML', bytes: CITYGML_LIMITS.originalBytes,
    read: 'Read by the CityGML reader when its bytes show a CityGML city model',
    note: 'Other GML is kept, not read. A CityGML reading is kept as evidence, not placed on the map.' },
  gpkg: { name: 'native GIS conversion', bytes: NATIVE_GIS_LIMITS.sourceBytes },
  kml: { name: 'native GIS conversion', bytes: NATIVE_GIS_LIMITS.sourceBytes },
  kmz: { name: 'native GIS conversion', bytes: NATIVE_GIS_LIMITS.sourceBytes },
  shp: { name: 'native GIS conversion', bytes: NATIVE_GIS_LIMITS.sourceBytes,
    note: 'A complete shapefile set is needed.' },
  ifc: { name: 'IFC structure', bytes: IFC_LIMITS.originalBytes },
  pdf: { name: 'PDF native text', bytes: DOCUMENT_LIMITS.nativeBytes },
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
  const reader = Object.hasOwn(readers, extension) ? readers[extension] : undefined;
  if (!reader) return { reader: null, ceilingBytes: null, withinCeiling: null,
    words: 'Kind not known yet: will be kept and recognised after upload' };
  const withinCeiling = file.size <= reader.bytes;
  const words = withinCeiling
    ? `${reader.read ?? `Will be read by the ${reader.name} reader`} (within ${sizeWords(reader.bytes)})`
    : `Will be kept, not read: larger than the ${sizeWords(reader.bytes)} ${reader.name} reader`;
  return { reader: reader.name, ceilingBytes: reader.bytes, withinCeiling,
    words: withinCeiling && reader.note ? `${words}. ${reader.note}` : words };
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
