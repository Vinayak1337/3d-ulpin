import { STREAMING_VECTOR_LIMITS as limits } from '@ulpin/contracts/usp';

export const INTAKE_LARGE_LAYOUT_QUESTION = 'No approved layout matches this file. '
  + 'An officer states what each feature is and which field identifies it.';
const nothing = '; nothing was prepared from it.';
const terminalSentences: Readonly<Record<string, string>> = {
  GEOJSON_JSON: 'This file contains text that is not complete valid JSON',
  GEOJSON_CONTAINER: 'This file does not contain one complete GeoJSON feature collection in the required order',
  GEOJSON_SEQUENCE: 'This file has an incomplete sequence of GeoJSON records',
  GEOJSON_METADATA: 'This file has ambiguous collection metadata',
  GEOJSON_METADATA_BUDGET: 'This file has more collection metadata than can be read for now',
  GEOJSON_NESTING_BUDGET: 'This file nests its values more deeply than can be read for now',
  GEOJSON_UNIT_BUDGET: 'A value in this file is larger than can be read in one piece',
  STREAMING_CHUNK_BUDGET: 'A part of this file is larger than can be read for now',
  STREAMING_EMPTY_SOURCE: 'This file contains no complete features',
  STREAMING_REPLAY_MISMATCH: 'A resumed reading did not match the retained file',
  STREAMING_FEATURE_INDEX: 'The records read from this file are not in a complete unbroken order',
  STREAMING_SOURCE_INTEGRITY: "The retained bytes do not match this file's receipt",
  SOURCE_INTEGRITY: "The stored bytes do not match this file's receipt",
  STREAMING_CHUNK_INTEGRITY: 'A retained part does not match its receipt',
  STORAGE_TIMEOUT: 'Reading the retained file did not finish in time',
  STREAMING_CONTEXT_STALE: "This file's retained source or private access changed while it was read",
  STREAMING_ATTEMPTS_EXHAUSTED: 'Reading this file could not finish after the allowed retries',
  STREAMING_WORKER_ERROR: 'Reading this file could not finish',
  STREAMED_PROFILE_BODY_BUDGET: 'The field inventory of this file is larger than can be kept for now',
  STREAMED_PROFILE_PATH_BUDGET: 'This file has more field paths than can be inventoried for now',
  STREAMED_PROFILE_GEOMETRY_BUDGET: 'This file has more kinds of geometry than can be inventoried for now',
  STREAMED_PROFILE_QUARANTINE_BUDGET: 'The rejected-record inventory of this file is larger than can be kept for now',
  STREAMED_PROFILE_COUNTS: 'The field inventory does not account for every record read',
  STREAMED_PROFILE_INTEGRITY: 'The retained field inventory does not match this file',
  STREAMED_PROFILE_CONTEXT_STALE: "This file's source or private access changed while its fields were inventoried",
  STREAMED_PROFILE_ATTEMPTS: 'The fields of this file could not be inventoried after the allowed retries',
  STREAMED_PROFILE_SOURCE_WAIT: 'The field inventory could not finish waiting for this file to be read',
  STREAMED_PROFILE_WORKER_ERROR: 'The fields of this file could not be inventoried',
  RAW_STREAM_FAILED: 'Reading this file did not finish',
  MAPPING_CHUNK_BUDGET: 'An interpreted part of this file is larger than can be kept for now',
  MAPPING_CONTEXT_STALE: "This file's source, approved layout or private access changed while it was interpreted",
  MAPPING_ATTEMPTS_EXHAUSTED: 'This file could not be interpreted after the allowed retries',
  MAPPING_SOURCE_WAIT: 'Interpreting this file could not finish waiting for its records',
  MAPPING_WORKER_ERROR: 'This file could not be interpreted with its approved layout',
  STREAMED_MAPPING_GEOMETRY: "This file's geometry does not meet its approved polygon layout",
  STREAMED_MAPPING_PATH: 'A field named by the layout is not in this file',
  STREAMED_MAPPING_FIELD: 'A field name in this file is longer than the layout can use',
  STREAMED_MAPPING_OPERATION: 'The layout asks for a field operation this reader cannot apply',
  STREAMED_MAPPING_COVERAGE: 'A field required by the layout is not complete text in every accepted record',
  STREAMED_MAPPING_PROVENANCE: 'This file has no retained issuing portal for its layout evidence',
  STREAMED_MAPPING_SEMANTICS: "The layout's field evidence does not match this file's issuing portal",
};

/** No internal code, hash or exception text becomes the officer's explanation. */
export function intakeLargeFailureReason(code: string, bytes: number, declaredCrs: string | null = null): string {
  if (code === 'STREAMING_SOURCE_BUDGET') {
    const size = Number((bytes / 1024 ** 2).toFixed(3));
    const ceiling = limits.sourceBytes / 1024 ** 2;
    return `This file is ${size} MiB. A map file is read in parts up to ${ceiling} MiB for now`
      + nothing;
  }
  if (code === 'STREAMING_INDEX') {
    return `This file has more than ${limits.chunks * limits.chunkFeatures} features, `
      + 'the most a map file may have for now' + nothing;
  }
  if (code === 'STREAMING_SOURCE_CRS' && declaredCrs !== null) {
    return `This file declares the coordinate system ${declaredCrs}. `
      + 'Large files are read in longitude and latitude only for now' + nothing;
  }
  const sentence = Object.hasOwn(terminalSentences, code) ? terminalSentences[code]
    : 'This file could not be read and interpreted completely';
  return sentence + nothing;
}

export type IntakeLargePhase = 'start' | 'read' | 'question' | 'layout' | 'map' | 'draft' | 'end' | 'failure';
type ReaderRow = {
  state: string; issue_code: string | null; next_publish_index: number;
  records: number; sealed_chunks: number | null; unknown_remainder: boolean;
};
type ProfileRow = { state: string; issue_code: string | null; sealed_generation: number | null };
type MappingRow = ReaderRow;
export type IntakeLargeRows = {
  reader: ReaderRow | null;
  profile: ProfileRow | null;
  mapping: MappingRow | null;
  receiptVerified: boolean;
  recipeState: string | null;
  publishedPackages: number;
  foldComplete: boolean;
};
const finished = (state: string) => ['completed', 'completed_with_rejections'].includes(state);
const failed = (state: string) => ['failed', 'stale'].includes(state);

/** Classification uses stored closure, never an elapsed time or an in-memory cursor. */
export function intakeLargePhase(rows: IntakeLargeRows): IntakeLargePhase {
  if ([rows.reader, rows.profile, rows.mapping].some(row => row && failed(row.state))) return 'failure';
  if (!rows.reader) return 'start';
  if (!finished(rows.reader.state) || rows.reader.unknown_remainder || !rows.receiptVerified
    || rows.reader.sealed_chunks === null || rows.reader.next_publish_index !== rows.reader.sealed_chunks
    || rows.profile?.state !== 'sealed' || rows.profile.sealed_generation !== rows.reader.sealed_chunks) return 'read';
  if (!rows.recipeState) return 'question';
  if (rows.recipeState !== 'approved') return 'layout';
  if (!rows.mapping || !finished(rows.mapping.state) || rows.mapping.unknown_remainder
    || rows.mapping.sealed_chunks !== rows.reader.sealed_chunks
    || rows.mapping.next_publish_index !== rows.mapping.sealed_chunks
    || rows.mapping.records !== rows.reader.records) return 'map';
  return rows.foldComplete ? 'end' : 'draft';
}

/** The meanings change with the pipeline phase, but never with how many attempts ran. */
export function intakeLargeNumbers(phase: IntakeLargePhase, rows: IntakeLargeRows) {
  const recordsSeen = rows.reader?.records ?? 0;
  if (phase === 'map' || phase === 'failure' && rows.mapping !== null) return {
    partsPlanned: rows.reader?.sealed_chunks ?? null,
    partsDone: rows.mapping?.next_publish_index ?? 0, recordsSeen,
  };
  if (phase === 'draft' || phase === 'end') return {
    partsPlanned: phase === 'end' && rows.publishedPackages > 0 ? rows.publishedPackages : null,
    partsDone: rows.publishedPackages, recordsSeen,
  };
  return { partsPlanned: null, partsDone: rows.reader?.next_publish_index ?? 0, recordsSeen };
}

export type IntakeLargeCounts = {
  recordsRead: number; accepted: number; packages: number;
  readerRejected: number; duplicates: number; oversized: number;
};

/** All counts come from sealed reader/mapping rows and published part counts, not displayed sample records. */
export function intakeLargeHoldsReason(counts: IntakeLargeCounts): string | null {
  if (!counts.readerRejected && !counts.duplicates && !counts.oversized) return null;
  const sentences = [`${counts.recordsRead} records read; ${counts.accepted} in ${counts.packages} packages.`];
  if (counts.readerRejected) sentences.push(`${counts.readerRejected} not accepted by the reader.`);
  if (counts.duplicates) sentences.push(`${counts.duplicates} share an identifier with another record and are held.`);
  if (counts.oversized) sentences.push(`${counts.oversized} are larger than a package can hold and are held.`);
  return sentences.join(' ');
}
