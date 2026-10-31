import { z } from 'zod';
import { IntakePlanReadingSchema } from './intake-plan';
import { MappingTargetSchema } from '../canonical/targets';
import { LayoutKindSchema, MappingOperationSchema, SourcePathSchema, TABULAR_LIMITS, TABULAR_STREAM_LIMITS,
  TabularSelectionSchema } from './ingestion';
import { RasterPixelWindowSchema } from './raster-window';
import { PointBatchSelectionSchema } from './point-batch';
import { STREAMING_VECTOR_LIMITS } from './streaming-vector';

export const INTAKE_CARD_VERSION = 'intake-card/1' as const;
export const INTAKE_PROBE_LIMITS = Object.freeze({
  headBytes: 64 * 1024, tailBytes: 64 * 1024, directoryBytes: 1024 * 1024,
  members: 2000, memberHeadBytes: 64 * 1024, expandedBytes: 7 * 1024 ** 3,
  compressionRatio: 100, nestingDepth: 2, budgetMs: 2000, columns: 256, sampleRecords: 16,
});
export const IntakeFamilySchema = z.enum([
  'vector', 'table', 'raster', 'point_cloud', 'model3d', 'document', 'image', 'archive', 'unknown',
]);
export { INTAKE_TABLE_READER_FORMATS } from './intake-needs';
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
export const IntakeSizeClassSchema = z.enum(['S', 'M', 'L', 'XL']);
export const IntakeStateSchema = z.enum([
  'received', 'probed', 'planned', 'reading', 'preparing', 'read', 'read_to_limit', 'failed_part', 'probe_failed',
]);
export const IntakePlacementSchema = z.enum([
  'undecided', 'on_map', 'attached', 'waiting_for_anchor', 'needs_answer', 'not_understood',
]);
export const IntakeCrsStateSchema = z.enum(['stated', 'sidecar', 'absent', 'conflicting', 'not_applicable']);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const text = z.string().min(1).max(1024);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const bbox = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const column = z.strictObject({
  name: text,
  inferredType: z.enum(['unknown', 'number', 'boolean', 'date', 'text', 'object', 'array', 'mixed', 'geometry']),
  sampledNonEmpty: z.number().int().nonnegative(),
});
const namedCount = z.strictObject({ name: text, count });
const fields = {
  version: z.literal(INTAKE_CARD_VERSION), family: IntakeFamilySchema, format: z.string().min(1).max(64),
  formatVersion: z.string().max(64).nullable(), detectedBy: z.enum(['bytes', 'bytes_and_name']),
  nameDisagrees: z.boolean(), depth: z.enum(['signature', 'structure']), encoding: z.string().max(64).nullable(),
  crs: z.strictObject({ state: IntakeCrsStateSchema,
    code: z.string().max(128).nullable(), sidecarSha256: hash.nullable() }),
  extent: z.strictObject({ native: bbox.nullable(), epsg4326: bbox.nullable() }),
  counts: z.strictObject({ features: count, rows: count, pages: count, members: count, points: count, bands: count }),
  geometryTypes: z.array(z.string().min(1).max(64)).max(32),
  layers: z.array(namedCount).max(INTAKE_PROBE_LIMITS.members),
  sheets: z.array(namedCount).max(INTAKE_PROBE_LIMITS.members),
  columns: z.array(column).max(INTAKE_PROBE_LIMITS.columns),
  limits: z.array(z.string().min(1).max(2000)).max(2048),
  probeBytesRead: z.number().int().nonnegative(), probeMs: z.number().finite().nonnegative(),
  drawableHint: z.boolean(), delimiter: z.enum([',', '\t', ';', '|']).nullable(),
  encrypted: z.boolean().nullable(),
  raster: z.strictObject({ width: count, height: count, tiled: z.boolean().nullable() }).nullable(),
  point: z.strictObject({ format: count, scale: z.tuple([z.number(), z.number(), z.number()]).nullable() }).nullable(),
  citations: z.array(z.strictObject({ locator: text, sha256: hash })).max(32),
};
// Child cards are shallow. Nested archives remain kept at signature depth, never recursively inflated.
export const IntakeMemberCardSchema = z.strictObject(fields);
export const IntakeMemberSchema = z.strictObject({
  name: text, sizeBytes: z.number().int().nonnegative(), compressedBytes: z.number().int().nonnegative(),
  format: z.string().max(64), family: IntakeFamilySchema, refusalCode: z.string().max(128).nullable(),
  companions: z.array(text).max(8), card: IntakeMemberCardSchema.nullable(),
});
export const IntakeCardSchema = z.strictObject({ ...fields, members: z.array(IntakeMemberSchema).max(2000) });
export const IntakeRegisterSchema = z.strictObject({ sourceId: z.string().uuid(), requestKey: z.string().uuid() });
export const IntakePinSchema = z.strictObject({ wave: z.number().int().min(1).max(4), requestKey: z.string().uuid() });
export const IntakeLargeRetrySchema = z.strictObject({ requestKey: z.string().uuid() });
/** CR1: the EPSG code an officer states for a GeoPackage or shapefile layer whose file states no system. */
export const IntakeLayerCrsSchema = z.strictObject({
  requestKey: z.string().uuid(), layer: z.string().min(1).max(256),
  crs: z.string().regex(/^EPSG:[1-9][0-9]{0,8}$/, 'Write the code as EPSG:<number>, for example EPSG:32643.'),
});
export const IntakeLayerCrsAnswerSchema = z.strictObject({
  crs: IntakeLayerCrsSchema.shape.crs, state: z.literal('officer_stated'), statedAt: z.string().datetime(),
});
const tableColumn = z.number().int().nonnegative().max(TABULAR_LIMITS.columns - 1)
  .describe('A header position of the table as read, from 0.');
/**
 * TC1: the columns of a kept table that hold its coordinates (an x or longitude and a y or latitude column, or one
 * WKT column) and the EPSG code they are in. A null code is refused with a question; no system is ever assumed.
 */
export const IntakeTablePlacementSchema = z.strictObject({
  requestKey: z.string().uuid(),
  coordinates: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('columns'), x: tableColumn, y: tableColumn })
      .refine(value => value.x !== value.y, 'The x and y columns are two different columns.'),
    z.strictObject({ kind: z.literal('wkt'), column: tableColumn }),
  ]),
  crs: IntakeLayerCrsSchema.shape.crs.nullable(),
  decimalMark: z.enum(['point', 'comma']).default('point')
    .describe('The coordinate cells\' decimal mark, stated by the officer, never detected. WKT uses point only.'),
});
export const IntakeLargeRetryResultSchema = z.strictObject({
  itemId: z.string().uuid(), jobId: z.string().uuid(),
  retry: z.number().int().positive().describe('How many officer retries this item has, this one included.'),
});
/** ZF1: a ZIP of map layers in a batch. Each GeoJSON member within these bounds is kept as its own child original. */
export const ZIP_LAYER_LIMITS = Object.freeze({ archiveBytes: 16 * 1024 * 1024, memberBytes: 16 * 1024 * 1024,
  layers: 64 });
export const IntakeArchiveRetainSchema = z.strictObject({
  requestKey: z.string().uuid(), expectedWorkspaceRevision: z.number().int().nonnegative(),
});
export const IntakeArchiveReceiptSchema = z.strictObject({
  sourceId: z.string().uuid(), sourceRevision: z.number().int().positive(), sha256: hash,
  bytes: z.number().int().positive().max(ZIP_LAYER_LIMITS.archiveBytes),
});
/** Where a child original's bytes came from: the exact archive revision, member path and directory pins. */
export const ArchiveMemberLineageSchema = z.strictObject({
  version: z.literal('zip-layer/1'), parentSourceId: z.string().uuid(),
  parentSourceRevision: z.number().int().positive(), parentSha256: hash, parentItemId: z.string().uuid(),
  memberPath: text, ordinal: z.number().int().nonnegative().max(INTAKE_PROBE_LIMITS.members),
  memberBytes: z.number().int().positive().max(ZIP_LAYER_LIMITS.memberBytes),
  compressedBytes: z.number().int().nonnegative(), crc32: z.number().int().nonnegative().max(0xffffffff),
  memberSha256: hash,
});
export type ArchiveMemberLineage = z.infer<typeof ArchiveMemberLineageSchema>;
export const TABLE_GEOJSON_CONVERSION = 'table_rows_to_geojson@1';
export const TABLE_PLACEMENT_SKIP_REASONS = ['no_coordinates', 'not_a_number', 'not_wkt', 'formula', 'open_ring',
  'too_large', 'inexact_number', 'refused'] as const;
export const TABLE_DERIVATIVE_LOCATOR =
  'Each feature names its table row in its tableRow member: sourceId, sourceRevision, sha256, row.';
/**
 * TC1: where a table placement's GeoJSON came from: the table original, the officer's columns and system, and how
 * many rows were written and skipped. It is written with the derivative's source, as an archive member's lineage is.
 */
export const TableDerivativeLineageSchema = z.strictObject({
  version: z.literal('table-derivative/1'), conversion: z.literal(TABLE_GEOJSON_CONVERSION),
  originalSourceId: z.string().uuid(), originalSourceRevision: z.number().int().positive(), originalSha256: hash,
  originalItemId: z.string().uuid(), format: z.enum(['csv', 'xlsx', 'ods']), layer: z.string().min(1).max(150),
  coordinates: IntakeTablePlacementSchema.shape.coordinates, crs: IntakeLayerCrsSchema.shape.crs,
  decimalMark: IntakeTablePlacementSchema.shape.decimalMark.unwrap().optional(),
  crsSource: z.literal('officer_stated'), features: z.number().int().nonnegative(),
  notWritten: z.number().int().nonnegative(),
  skipped: z.partialRecord(z.enum(TABLE_PLACEMENT_SKIP_REASONS), z.number().int().positive()),
  locator: z.literal(TABLE_DERIVATIVE_LOCATOR),
});
export type TableDerivativeLineage = z.infer<typeof TableDerivativeLineageSchema>;
/** Cell files partition only features outside the parent's first area; no feature is split or reprojected. */
export const CELL_DERIVATIVE_RULE = Object.freeze({
  version: 'area-cell/1' as const, metres: 40000, degrees: 0.5,
  degreeOrigin: [-180.25, -90.25] as [number, number], sharedMetres: 9000, sharedDegrees: 0.25,
  placement: 'extent_south_west' as const, edge: 'east_north' as const,
  zone: 'extent_middle_wgs84_utm' as const, exceptional: 'single_feature' as const, cells: 64,
});
export const CellFeatureRangeSchema = z.strictObject({
  featureIndex: z.number().int().nonnegative(), byteStart: z.number().int().nonnegative(),
  byteEnd: z.number().int().positive(), rawSha256: hash,
}).refine(value => value.byteEnd > value.byteStart, 'The feature range must be nonempty.');
export const CellDerivativeLineageSchema = z.strictObject({
  version: z.literal('cell-derivative/1'), parentSourceId: z.string().uuid(),
  parentSourceRevision: z.number().int().positive(), parentSha256: hash, parentItemId: z.string().uuid(),
  parentName: z.string().min(1).max(150),
  cellKey: z.string().regex(/^utm-[0-9]+-e-?[0-9]+-n-?[0-9]+-l[0-9]+-b[0-9]+(?:-feature-[0-9]+)?$/),
  rule: z.strictObject({ version: z.literal(CELL_DERIVATIVE_RULE.version), metres: z.literal(40000),
    degrees: z.literal(0.5), degreeOrigin: z.tuple([z.literal(-180.25), z.literal(-90.25)]),
    sharedMetres: z.literal(9000), sharedDegrees: z.literal(0.25), placement: z.literal('extent_south_west'),
    edge: z.literal('east_north'), zone: z.literal('extent_middle_wgs84_utm'),
    exceptional: z.literal('single_feature'), cells: z.literal(64) }),
  features: z.number().int().positive().max(STREAMING_VECTOR_LIMITS.features),
  members: z.strictObject({ key: z.string().regex(/^large-originals\/[a-f0-9-]{36}\/[a-f0-9]{64}$/), sha256: hash,
    bytes: z.number().int().positive().max(128 * 1024 * 1024), format: z.literal('cell-feature-ranges-jsonl/1') }),
});
export type CellFeatureRange = z.infer<typeof CellFeatureRangeSchema>;
export type CellDerivativeLineage = z.infer<typeof CellDerivativeLineageSchema>;
/** G23. A page image (JPEG, PNG, TIFF without georeference) in a batch: its first, native read and no more. */
export const INTAKE_PAGE_IMAGE_LIMITS = Object.freeze({ originalBytes: 128 * 1024 ** 2, headBytes: 1024 ** 2,
  inputPixels: 250_000_000, previewSide: 1024, previewBytes: 8 * 1024 ** 2 });
export const IntakePageImageLabelSchema = z.enum(['plan', 'elevation', 'photo', 'other']);
const orientation = z.number().int().min(1).max(8);
export const IntakePageImageReadSchema = z.strictObject({
  version: z.literal('page-image-read/1'), format: z.enum(['jpeg', 'png', 'tiff']),
  width: count, height: count, bands: count, bitDepth: count,
  orientation: orientation.nullable().describe('The EXIF orientation as stated; null when none is stated.'),
  captureTime: z.string().min(1).max(64).nullable().describe('EXIF DateTimeOriginal exactly as stated, or null.'),
  locationStated: z.boolean().describe('Whether its EXIF states a GPS position; the position is not read here.'),
  dpi: z.strictObject({ x: z.number().finite().positive(), y: z.number().finite().positive(),
    statedIn: z.enum(['jfif', 'exif', 'png_phys', 'tiff']) }).nullable(),
  preview: z.strictObject({ key: text, sha256: hash, bytes: z.number().int().positive(),
    width: z.number().int().positive().max(INTAKE_PAGE_IMAGE_LIMITS.previewSide),
    height: z.number().int().positive().max(INTAKE_PAGE_IMAGE_LIMITS.previewSide), mediaType: z.literal('image/png'),
    orientationApplied: orientation.nullable(),
    original: z.strictObject({ sourceId: z.string().uuid(), sourceRevision: z.number().int().positive(),
      sha256: hash }) }).nullable(),
  previewLimit: z.string().min(1).max(500).nullable().describe('Why no preview was made; null when one was.'),
  label: z.strictObject({ value: IntakePageImageLabelSchema, state: z.literal('candidate'),
    answeredAt: z.string().datetime() }).nullable().describe('The officer\'s answer to what it shows, unreviewed.'),
});
export const IntakePageImageAnswerSchema = z.strictObject({ requestKey: z.string().uuid(),
  label: IntakePageImageLabelSchema });
export type IntakePageImageRead = z.infer<typeof IntakePageImageReadSchema>;
export type IntakePageImageLabel = z.infer<typeof IntakePageImageLabelSchema>;
export const IntakeItemPlanSchema = z.strictObject({
  recipeId: z.string().uuid(), recipeRevision: z.number().int().positive(),
  recipeState: z.enum(['proposed', 'approved', 'executed']),
  origin: z.enum(['memory', 'teacher', 'officer', 'parent_file']).nullable(),
  parentSourceId: z.string().uuid().optional(), packageId: z.string().uuid().nullable(),
}).refine(plan => plan.origin !== 'parent_file' || Boolean(plan.parentSourceId),
  { path: ['parentSourceId'], message: 'A carried cell layout names its parent file.' });
/** CN1. One cell file of a wide file, kept as its own item in its own batch case. The case and item are named only
 * when the officer may already open that batch; otherwise the entry names the cell and that it is a separate batch. */
export const IntakeCellBatchSchema = z.strictObject({
  cellKey: CellDerivativeLineageSchema.shape.cellKey,
  caseId: z.string().uuid().nullable(), itemId: z.string().uuid().nullable(),
  state: IntakeStateSchema.nullable(), placement: IntakePlacementSchema.nullable(),
});
export type IntakeCellBatch = z.infer<typeof IntakeCellBatchSchema>;
export const IntakeItemSchema = z.strictObject({
  itemId: z.string().uuid(), sourceId: z.string().uuid().nullable(), caseId: z.string().uuid(),
  parentItemId: z.string().uuid().nullable(), memberPath: text.nullable(), name: text,
  archiveItemId: z.string().uuid().nullable().optional().describe(
    'The batch item of the ZIP or KMZ this file was taken out of; null for any other file.'),
  family: IntakeFamilySchema, format: z.string().max(64).nullable(), what: text.optional(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  sizeClass: IntakeSizeClassSchema.nullable(), wave: z.number().int().min(1).max(4), state: IntakeStateSchema,
  placement: IntakePlacementSchema, card: IntakeCardSchema.nullable(), cardSha256: hash.nullable(),
  plan: IntakeItemPlanSchema.nullable(),
  layoutQuestion: z.boolean().optional().describe(
    'True only while the map reader asks the officer to state a layout; independent of display reasons.'),
  streamedProfileJobId: z.string().uuid().nullable().describe(
    'Large GeoJSON: the streamed profile job whose inventory the layout question is answered from; '
    + 'null otherwise.'),
  layoutProfile: z.strictObject({ generation: z.number().int().nonnegative(), generationHash: hash,
    coverage: z.enum(['provisional', 'sealed']), recordsSeen: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative() }).optional().describe(
    'The immutable streamed-profile generation covered by this layout question; provisional means prefix only.'),
  probeVersion: z.string().nullable(),
  partsPlanned: z.number().int().positive().nullable().describe(
    'Large GeoJSON: null while reading; raw parts while mapping; null while drafting until the final cut, '
    + 'then package cuts. Other readers retain their own planned-part count.'),
  partsDone: z.number().int().nonnegative().describe(
    'Large GeoJSON: raw parts published while reading, mapped parts while mapping, packages drafted while drafting '
    + 'and after completion. Other readers retain their own completed-part count.'),
  recordsSeen: z.number().int().nonnegative().describe(
    'Records of the file read so far; the sealed reader count stays unchanged during mapping and package drafting.'),
  limitReason: z.string().nullable(), pinnedByOfficer: z.boolean(),
  existingAreaId: z.string().uuid().nullable().optional().describe(
    'The area whose source already holds this file\'s exact bytes; present only when the item rests for that reason.'),
  planReadings: z.array(IntakePlanReadingSchema).max(8).optional().describe(
    'Candidate rooms in page pixels, one reading per selected page; never world placement or registry records.'),
  pageImage: IntakePageImageReadSchema.optional().describe(
    'G23. A page image\'s first read and the officer\'s candidate label; present only once a page image is read.'),
  layerCrs: z.array(z.strictObject({ layer: IntakeLayerCrsSchema.shape.layer,
    answer: IntakeLayerCrsAnswerSchema.nullable() })).max(100).optional().describe(
    'GeoPackage or shapefile ZIP: each layer whose file states no coordinate system, with the officer\'s answer '
    + 'or null while none is given; present only when there is such a layer.'),
  ifcJobId: z.string().uuid().optional().describe(
    'An IFC kept in a batch: the native IFC reading job its enrolment queued; absent for every other item.'),
  nativeReaderJobId: z.string().uuid().optional().describe(
    'A DXF, CityGML, CityJSON, glTF/GLB or OBJ kept in a batch: its native reading job; absent for every other '
    + 'item.'),
  cellBatches: z.array(IntakeCellBatchSchema).max(CELL_DERIVATIVE_RULE.cells).optional().describe(
    'CN1. A wide file: its cell files outside its first map area, each its own item in its own batch case, with '
    + 'that item\'s current state. caseId, itemId, state and placement are null when this officer may not open '
    + 'that batch or it is unavailable. Absent for every other item.'),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
/** Remembered choices only: the current source still needs its own authored recipe and officer approval. */
export const IntakeLayoutMemorySchema = z.strictObject({
  memory: z.strictObject({ kind: LayoutKindSchema,
    operations: z.array(MappingOperationSchema.pick({ target: true, sourcePath: true })).min(2).max(3),
    recipeId: z.string().uuid(), name: text, approvedAt: z.iso.datetime(),
  }).nullable(),
  words: z.string().min(1).max(2000),
});
const readingLine = z.strictObject({ words: z.string().min(1).max(2000),
  basis: z.enum(['reader', 'memory', 'rule', 'sarvam', 'officer']) });
export const IntakeReadingSchema = z.strictObject({
  version: z.literal('intake-reading/1'),
  what: readingLine,
  holds: z.array(readingLine),
  fields: z.array(readingLine.extend({ field: text, target: MappingTargetSchema.nullable().describe(
    'The canonical target the reading proposes for this field, null when none.') })),
  drawing: readingLine.extend({ as: z.string().min(1).max(64) }),
  links: z.array(readingLine.extend({ itemId: z.string().uuid(), by: z.enum(['key', 'address', 'place']),
    fields: z.strictObject({ here: text, there: text }).nullable().describe(
      'The field (source path or column header) on this item and on the linked item that the suggestion compares; '
      + 'null for a place link.'),
  })),
  question: z.string().min(1).max(2000).nullable(),
});
export type IntakeReading = z.infer<typeof IntakeReadingSchema>;
export const IntakeManifestSchema = z.strictObject({ caseId: z.string().uuid(), items: z.array(IntakeItemSchema) });

/**
 * NO1. The features a native conversion did not write, per converted layer, read from each layer's stored locator
 * file under the original item's authority. At most `perLayer` are listed with the layer's total; at most
 * `scanBytes` of locator files are read in one request.
 */
export const INTAKE_OMISSION_LIMITS = Object.freeze({ perLayer: 50, layers: 100, scanBytes: 16 * 1024 * 1024 });
export const IntakeOmissionSchema = z.strictObject({
  position: z.union([z.number().int(), z.string().min(1).max(1000)]).describe(
    'Where the feature is in the original, as the converter states it (row id, record or element sequence, or a '
    + 'CityJSON object pointer); its kind is the layer\'s positionKind.'),
  reason: z.string().min(1).max(1000).describe('Why the converter did not write it, as stated.'),
});
export const IntakeOmissionLayerSchema = z.strictObject({
  layer: text, ordinal: z.number().int().nonnegative(),
  derivativeSourceId: z.string().uuid().describe('The GeoJSON derivative kept for this layer.'),
  positionKind: z.string().max(100).nullable(),
  written: z.number().int().nonnegative(), notWritten: z.number().int().nonnegative(),
  listed: z.array(IntakeOmissionSchema).max(INTAKE_OMISSION_LIMITS.perLayer),
  scan: z.enum(['none_left_out', 'whole', 'partial', 'not_read']).describe(
    'none_left_out: no feature was left out, so the locator file is not read; whole: it was read to its end and '
    + 'matched its kept SHA-256 and counts; partial: only its first bytes were read, so the list is not checked '
    + 'against that hash; not_read: the request\'s read budget was spent.'),
  sidecarSha256: hash,
});
export const IntakeNativeOmissionsSchema = z.strictObject({
  version: z.literal('intake-native-omissions/1'), caseId: z.string().uuid(), itemId: z.string().uuid(),
  sourceId: z.string().uuid(), sourceRevision: z.number().int().positive(), sourceSha256: hash,
  layers: z.array(IntakeOmissionLayerSchema).max(INTAKE_OMISSION_LIMITS.layers),
  words: z.string().min(1).max(2000),
});
export type IntakeNativeOmissions = z.infer<typeof IntakeNativeOmissionsSchema>;
export type IntakeCard = z.infer<typeof IntakeCardSchema>;
export type IntakeMemberCard = z.infer<typeof IntakeMemberCardSchema>;
export type IntakeMember = z.infer<typeof IntakeMemberSchema>;

export const INTAKE_TARGET_LIMITS = Object.freeze({ draftTargets: 2000, confirmationTargets: 100, page: 200 });
export const IntakeTargetReadinessSchema = z.enum([
  'preparing', 'ready', 'needs_answer', 'held', 'confirmed', 'recorded', 'carded', 'stopped',
]);
const uuid = z.string().uuid();
const code = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/);
const at = z.string().datetime();
const pinned = z.strictObject({ id: uuid, revision: z.number().int().nonnegative() });
export const IntakeTargetArtefactsSchema = z.strictObject({
  record: pinned.optional(),
  snapshot: z.strictObject({ id: uuid, digest: hash }).optional(),
  identity: z.string().min(1).max(256).optional(),
  plan: z.strictObject({ id: uuid, version: z.number().int().positive(), sha256: hash }).optional(),
  planConfirmation: z.strictObject({ id: uuid }).optional(),
  packet: z.strictObject({ id: uuid }).optional(),
  card: pinned.optional(),
  verification: z.literal('consistent').optional(),
  evidence: z.strictObject({ confirmationIds: z.array(uuid).min(1).max(100), record: pinned }).optional()
    .describe('AU4-B3: the evidence confirmations whose citations were written, and the record revision that cites '
      + 'them; the snapshot pins this revision. Absent when no confirmation names the building.'),
});
export const IntakeTargetSchema = z.strictObject({
  targetId: uuid, caseId: uuid, anchorItemId: uuid, packageId: uuid, featureId: uuid, locator: text,
  kind: z.literal('building'), stage: z.number().int().min(1).max(8), readiness: IntakeTargetReadinessSchema,
  blockedBy: z.array(code).max(16), reason: z.string().min(1).max(2000).nullable(),
  confirmationId: uuid.nullable(),
  priorityAt: at.nullable(), artefacts: IntakeTargetArtefactsSchema, updatedAt: at,
});
const tally = z.number().int().nonnegative();
export const IntakeTargetCountsSchema = z.strictObject({ preparing: tally, ready: tally, needs_answer: tally, held: tally,
  confirmed: tally, recorded: tally, carded: tally, stopped: tally });
const packageCursor = z.string().regex(/^[A-Za-z0-9_-]{1,512}$/);
export const IntakeTargetQuerySchema = z.strictObject({
  readiness: IntakeTargetReadinessSchema.optional(), cursor: uuid.optional(),
  packageCursor: packageCursor.optional(),
});
export const IntakeTargetByFeatureQuerySchema = z.strictObject({
  featureId: uuid, packageId: uuid.optional()
    .describe('The package proposing the feature; without it, the packages that recorded the feature are read.'),
});
export const IntakeRunControlSchema = z.strictObject({});
export const IntakeTargetPackageSchema = z.strictObject({
  packageId: uuid, areaId: uuid, anchorItemId: uuid, revision: z.number().int().positive(),
  state: z.enum(['RECEIVED', 'NEEDS_INPUT', 'READY_FOR_REVIEW', 'REVIEWED', 'COMMITTED']),
  reviewFingerprint: hash.nullable(), findingCounts: z.record(code, tally).nullable(),
  reviewRefusal: z.strictObject({ code, message: z.string().min(1).max(2000) }).nullable().optional()
    .describe('Current review refusal; emitted as null before review or after it passes. Older pages may omit it.'),
  recordingConfirmationId: uuid.nullable().optional()
    .describe('The stored confirmation whose run is recording this package now; it cannot be named again until '
      + 'that run ends. Null when none. Older pages may omit it.'),
  counts: IntakeTargetCountsSchema,
});
export const IntakeTargetPageSchema = z.strictObject({
  caseId: uuid, items: z.array(IntakeTargetSchema).max(INTAKE_TARGET_LIMITS.page),
  counts: IntakeTargetCountsSchema, nextCursor: uuid.nullable(),
  packages: z.array(IntakeTargetPackageSchema).max(100), packagesTruncated: z.boolean(),
  packagesNextCursor: packageCursor.nullable().optional()
    .describe('Opaque cursor of the next package page: unrecorded packages first, then recorded; null on the last.'),
  packagesTotal: tally.optional().describe('Every package of the batch, listed on this page or not.'),
  packagesUnrecorded: tally.optional().describe('Packages of the batch not yet recorded, listed or not.'),
  packagesUnrecordedAfter: tally.optional().describe('Packages not yet recorded that later package pages list.'),
});
export const IntakeConfirmedPackageSchema = z.strictObject({
  packageId: uuid, revision: z.number().int().positive(), reviewFingerprint: hash,
});
export const IntakeConfirmSchema = z.strictObject({
  requestKey: uuid, acknowledgement: z.string().min(1).max(500)
    .refine(value => value.trim().length > 0, 'Use a non-blank acknowledgement in the officer\'s words.'),
  packages: z.array(IntakeConfirmedPackageSchema).max(100)
    .refine(rows => new Set(rows.map(row => row.packageId)).size === rows.length, 'Name each package once.')
    .describe('The packages to record. Empty only for a cards-only confirmation: its targets are recorded '
      + 'buildings with no card, of packages an earlier confirmation of this case recorded; it stores their pins '
      + 'as that confirmation named them, records nothing and cards the targets in the order listed.'),
  targets: z.array(uuid).max(INTAKE_TARGET_LIMITS.confirmationTargets)
    .refine(ids => new Set(ids).size === ids.length, 'Name each target once.'),
}).refine(input => input.packages.length > 0 || input.targets.length > 0,
  'Name at least one package to record, or at least one recorded building to card.');
export const IntakeConfirmationSchema = z.strictObject({
  confirmationId: uuid, caseId: uuid, requestKey: uuid, subject: z.string().min(1).max(256),
  acknowledgement: z.string().min(1).max(500), packages: z.array(IntakeConfirmedPackageSchema).min(1).max(100),
  targets: z.array(uuid).max(INTAKE_TARGET_LIMITS.confirmationTargets), reason: z.string().min(1).max(512),
  expiresAt: at, createdAt: at, progress: z.array(IntakeTargetSchema).max(INTAKE_TARGET_LIMITS.confirmationTargets),
  counts: z.strictObject({ recorded: tally, carded: tally, stopped: tally }),
  findingCounts: z.record(code, tally).nullable()
    .describe('Counts from the pinned package reviews; null if any exact review is no longer available.'),
});
export type IntakeTargetReadiness = z.infer<typeof IntakeTargetReadinessSchema>;
export type IntakeTargetArtefacts = z.infer<typeof IntakeTargetArtefactsSchema>;
export type IntakeTarget = z.infer<typeof IntakeTargetSchema>;
export type IntakeConfirm = z.infer<typeof IntakeConfirmSchema>;
export type IntakeConfirmation = z.infer<typeof IntakeConfirmationSchema>;

/**
 * AU4-B1: a table row or a document part of a batch, proposed as evidence for a building of the same case.
 * Exact literal keys only: no lowercasing, trimming, transliteration, punctuation stripping or number coercion.
 * Every candidate stays a candidate; coverage is null until a reader states it, and unread is never absence.
 * Nothing here records, matches or cites, and no field states a right, ownership or issuance.
 */
export const EXACT_KEY_PROFILE_VERSION = 'exact-key/1' as const;
export const INTAKE_EVIDENCE_VERSION = 'intake-evidence/1' as const;
export const INTAKE_EVIDENCE_LIMITS = Object.freeze({
  literalChars: 1024, quoteChars: 4096, tables: 16, documents: 16, page: 200, targets: 16, decisions: 100,
  sources: 100,
});
const literal = z.string().min(1).max(INTAKE_EVIDENCE_LIMITS.literalChars);
const integerLiteral = /^-?(?:0|[1-9][0-9]*)$/;
const words = (max: number) => z.string().min(1).max(max)
  .refine(value => value.trim().length > 0, 'Use non-blank words.');
const once = <T>(values: T[], key: (value: T) => string) => new Set(values.map(key)).size === values.length;
const columnIndex = z.number().int().min(0).max(INTAKE_PROBE_LIMITS.columns - 1);
const keyPath = SourcePathSchema.refine(path => path !== '/features/*/geometry', 'A key is never the geometry.');
export const IntakeKeyKindSchema = z.enum(['text', 'integer']);
export const IntakeKeyProfileInputSchema = z.strictObject({
  requestKey: uuid, version: z.literal(EXACT_KEY_PROFILE_VERSION),
  namespace: words(150).describe('The identifier namespace in the officer\'s words; never an official ULPIN.'),
  kind: IntakeKeyKindSchema,
  map: z.strictObject({ anchorItemId: uuid, sourcePath: keyPath }),
  tables: z.array(z.strictObject({ itemId: uuid, selection: TabularSelectionSchema, columnIndex }))
    .max(INTAKE_EVIDENCE_LIMITS.tables).refine(rows => once(rows, row => row.itemId), 'Name each table once.'),
  documents: z.array(uuid).max(INTAKE_EVIDENCE_LIMITS.documents)
    .refine(ids => new Set(ids).size === ids.length, 'Name each document once.'),
}).refine(input => input.tables.length + input.documents.length > 0, 'Name at least one table column or document.');
export const IntakeKeyProfileSchema = z.strictObject({
  profileId: uuid, caseId: uuid, profileSha256: hash, input: IntakeKeyProfileInputSchema,
  subject: z.string().min(1).max(256), createdAt: at,
});
export const IntakeEvidenceKeySchema = z.strictObject({
  profileId: uuid, profileSha256: hash, namespace: words(150), kind: IntakeKeyKindSchema, literal,
});
/** The map side: the literal read from the chosen field of one drafted building, with its package pins. */
export const IntakeEvidenceAnchorSchema = z.strictObject({
  targetId: uuid, anchorItemId: uuid, packageId: uuid, packageRevision: z.number().int().positive(),
  featureId: uuid, locator: text, sourceId: uuid, sourceRevision: z.number().int().positive(), sourceSha256: hash,
  sourcePath: keyPath, literal,
});
/** One physical row of a retained table as the raw tabular job read it; the key cell is a literal as read. */
export const IntakeTableRowLocatorSchema = z.strictObject({
  kind: z.literal('table_row'), itemId: uuid, caseId: uuid, sourceId: uuid,
  sourceRevision: z.number().int().positive(), sourceSha256: hash, rawJobId: uuid, rawInputSha256: hash,
  rawResultSha256: hash, acceptedFence: z.number().int().positive(), selection: TabularSelectionSchema,
  sourceRow: z.number().int().positive(), rowSha256: hash, columnIndex, columnHeader: z.string().max(400),
  cell: z.strictObject({ state: z.literal('literal'), value: literal }),
  window: z.strictObject({ index: z.number().int().nonnegative().max(TABULAR_STREAM_LIMITS.windows - 1),
    record: z.number().int().nonnegative().max(TABULAR_STREAM_LIMITS.rows - 1),
    byteStart: z.number().int().nonnegative(), byteEnd: z.number().int().nonnegative(), sha256: hash,
    sheet: z.string().min(1).max(150).optional(), physicalRow: z.number().int().min(2).optional(),
    sheetSha256: hash.optional() })
    .refine(row => row.byteEnd >= row.byteStart, 'A record ends where it starts or later.')
    .refine(row => [row.sheet, row.physicalRow, row.sheetSha256].every(value => value === undefined)
      || [row.sheet, row.physicalRow, row.sheetSha256].every(value => value !== undefined),
    'A workbook row names its sheet, physical row and sheet SHA-256 together.').optional()
    .describe('A row of a streamed table, read from its stored window: the window, the record number (the first '
      + 'is 0), its byte range in the unchanged original and that range\'s SHA-256. For a workbook row the range '
      + 'is its sheet\'s stored bytes in the ZIP, and the sheet name, the physical sheet row and the SHA-256 of the '
      + 'sheet\'s XML as read name the row inside it; a CSV row omits them. A whole-file row omits the window.'),
});
/** One native text part of a retained document; the quote is an exact character span of the part's text. */
export const IntakeDocumentPartLocatorSchema = z.strictObject({
  kind: z.literal('document_part'), itemId: uuid, caseId: uuid, caseRevision: z.number().int().nonnegative(),
  sourceId: uuid, sourceRevision: z.number().int().positive(), sourceSha256: hash, jobId: uuid,
  resultSha256: hash, inputSha256: hash, readerSha256: hash, acceptedFence: z.number().int().positive(),
  partId: uuid, partSha256: hash, page: z.number().int().positive().nullable(),
  quote: z.string().min(1).max(INTAKE_EVIDENCE_LIMITS.quoteChars),
  quoteStart: z.number().int().nonnegative(), quoteEnd: z.number().int().positive(),
}).refine(part => part.quoteEnd - part.quoteStart === part.quote.length,
  'The quote must be the exact character span it names.');
export const IntakeEvidenceLocatorSchema = z.discriminatedUnion('kind', [
  IntakeTableRowLocatorSchema, IntakeDocumentPartLocatorSchema,
]);
export const IntakeEvidenceOutcomeSchema = z.enum(['matched', 'no_match', 'several', 'conflicting']);
/** Each count is null while unknown, never 0. A closed reading states every count and leaves nothing unread. */
export const IntakeEvidenceCoverageSchema = z.strictObject({
  state: z.enum(['reading', 'partial', 'closed']), read: count, eligible: count, keyless: count,
  unread: count, failed: count,
  failure: z.strictObject({ state: z.enum(['failed', 'stale', 'cancelled']), code: words(120), message: words(500) })
    .optional().describe('The reading job stopped; counts remain unknown, never inferred from this failure.'),
}).refine(value => value.state !== 'closed'
  || (!value.failure && [value.read, value.eligible, value.keyless, value.failed].every(n => n !== null)
    && value.unread === 0),
'Closed coverage states every count and leaves nothing unread.');
export const IntakeEvidenceSourceSchema = z.strictObject({
  itemId: uuid, profileId: uuid, family: z.enum(['table', 'document']), jobId: uuid.nullable(),
  resultSha256: hash.nullable(), coverage: IntakeEvidenceCoverageSchema.nullable(),
  sourceId: uuid.nullable().describe('The item\'s current retained source; with its revision, SHA-256 and bytes, '
    + 'the pins an evidence confirmation names for this item. All pins are null when unavailable.'),
  sourceRevision: z.number().int().positive().nullable(), sourceSha256: hash.nullable(),
  bytes: z.number().int().nonnegative().nullable(),
  source: z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('retained') }),
    z.strictObject({ state: z.literal('unavailable'), reason: words(500) }),
  ]).default({ state: 'retained' }),
}).refine(source => source.coverage?.state !== 'closed' || (source.jobId !== null && source.resultSha256 !== null),
  'Closed coverage names the job and result that read it.')
  .refine(source => {
    const pins = [source.sourceId, source.sourceRevision, source.sourceSha256, source.bytes];
    return source.source.state === 'retained' ? pins.every(pin => pin !== null) : pins.every(pin => pin === null);
  }, 'A retained source states every pin; an unavailable source has no current pins.');
type EvidenceKey = z.infer<typeof IntakeEvidenceKeySchema>;
type EvidenceLocator = z.infer<typeof IntakeEvidenceLocatorSchema>;
function keyIssue(key: EvidenceKey, evidence: EvidenceLocator, anchors: { literal: string }[]) {
  if (key.kind === 'integer' && !integerLiteral.test(key.literal)) return 'An integer key is its digits as written.';
  const held = evidence.kind === 'table_row' ? evidence.cell.value === key.literal
    : evidence.quote.includes(key.literal);
  if (!held || anchors.some(anchor => anchor.literal !== key.literal))
    return 'Each side must hold the exact key literal as read; no normalised or invented key.';
  return null;
}
const outcomeFits = { matched: (n: number) => n === 1, no_match: (n: number) => n === 0,
  several: (n: number) => n > 1, conflicting: (n: number) => n > 0 };
export const IntakeEvidenceCandidateSchema = z.strictObject({
  version: z.literal(INTAKE_EVIDENCE_VERSION), candidateId: uuid, caseId: uuid, candidateSha256: hash,
  key: IntakeEvidenceKeySchema, evidence: IntakeEvidenceLocatorSchema, outcome: IntakeEvidenceOutcomeSchema,
  anchors: z.array(IntakeEvidenceAnchorSchema).max(INTAKE_EVIDENCE_LIMITS.targets)
    .refine(rows => once(rows, row => row.targetId), 'Name each building once.'),
  conflictGroup: uuid.nullable(), sourceCoverage: IntakeEvidenceCoverageSchema.nullable(),
  state: z.literal('candidate'), qualification: z.literal('not_assessed'), createdAt: at,
}).superRefine((candidate, ctx) => {
  const message = keyIssue(candidate.key, candidate.evidence, candidate.anchors);
  if (message) ctx.addIssue({ code: 'custom', path: ['key'], message });
  if (!outcomeFits[candidate.outcome](candidate.anchors.length))
    ctx.addIssue({ code: 'custom', path: ['anchors'], message: 'The buildings named do not fit the outcome.' });
  if ((candidate.outcome === 'conflicting') !== (candidate.conflictGroup !== null))
    ctx.addIssue({ code: 'custom', path: ['conflictGroup'], message: 'Only a conflict names its group.' });
  if (candidate.outcome === 'no_match' && candidate.sourceCoverage?.state !== 'closed')
    ctx.addIssue({ code: 'custom', path: ['sourceCoverage'], message: 'Unread coverage is never absence.' });
});
export const IntakeEvidenceQuerySchema = z.strictObject({
  outcome: IntakeEvidenceOutcomeSchema.optional(), cursor: uuid.optional(),
  profileId: uuid.optional().describe('Only the candidates read under this key profile.'),
  itemId: uuid.optional().describe('Only the candidates of this table or document.'),
  featureId: uuid.optional().describe('Only the candidates whose anchors name this map feature.'),
});
/** AU4-B2: a stored evidence confirmation as the read lists it. It is never changed by a later source. */
export const IntakeEvidenceConfirmationStateSchema = z.strictObject({
  confirmationId: uuid, profileId: uuid, additions: z.enum(['citations', 'no_additions']), createdAt: at,
  expiresAt: at, newerSources: z.array(uuid).max(INTAKE_EVIDENCE_LIMITS.sources)
    .describe('Sources read under the profile after it that the confirmation neither includes nor excludes.'),
  accepted: z.array(uuid).max(INTAKE_EVIDENCE_LIMITS.decisions).optional()
    .describe('The candidates the confirmation accepted, in the order of its stored decisions.'),
  superseded: z.boolean().optional()
    .describe('An included source has another reading. Its candidates must be confirmed again at the current pins.'),
});
export const IntakeEvidencePageSchema = z.strictObject({
  caseId: uuid, profiles: z.array(IntakeKeyProfileSchema).max(INTAKE_EVIDENCE_LIMITS.sources),
  confirmations: z.array(IntakeEvidenceConfirmationStateSchema).max(INTAKE_EVIDENCE_LIMITS.sources),
  sources: z.array(IntakeEvidenceSourceSchema).max(INTAKE_EVIDENCE_LIMITS.sources),
  candidates: z.array(IntakeEvidenceCandidateSchema).max(INTAKE_EVIDENCE_LIMITS.page),
  counts: z.strictObject({ matched: tally, no_match: tally, several: tally, conflicting: tally })
    .describe('Stored candidates of the whole case by outcome, each counted once; the outcome, profile and item '
      + 'filters narrow the page, never these counts. Not a reading total (see sources).'),
  nextCursor: uuid.nullable(),
});
const sourcePin = z.strictObject({
  itemId: uuid, sourceId: uuid, sourceRevision: z.number().int().positive(), sourceSha256: hash,
  bytes: z.number().int().nonnegative(),
});
const candidatePin = { candidateId: uuid, candidateSha256: hash };
const decision = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('accept'), ...candidatePin, targetId: uuid,
    evidence: IntakeEvidenceLocatorSchema }),
  z.strictObject({ decision: z.literal('reject'), ...candidatePin, reason: words(500) }),
]);
/** Every pin one officer confirmation of batch evidence names; nothing here authorises a right or an issuance. */
export const IntakeEvidenceConfirmSchema = z.strictObject({
  requestKey: uuid, acknowledgement: words(500), profileId: uuid, profileSha256: hash,
  included: z.array(sourcePin.extend({ jobId: uuid, resultSha256: hash, coverage: IntakeEvidenceCoverageSchema }))
    .min(1).max(INTAKE_EVIDENCE_LIMITS.sources),
  excluded: z.array(sourcePin.extend({ reason: words(500) })).max(INTAKE_EVIDENCE_LIMITS.sources),
  targets: z.array(z.strictObject({ targetId: uuid, packageId: uuid, packageRevision: z.number().int().positive(),
    reviewFingerprint: hash })).min(1).max(INTAKE_TARGET_LIMITS.confirmationTargets),
  additions: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('citations'), linkManifestSha256: hash.optional()
      .describe('The SHA-256 of the decisions in candidate order. When omitted the server computes it; when sent it '
        + 'must equal that value. The stored confirmation always holds the computed hash.'),
      decisions: z.array(decision).min(1).max(INTAKE_EVIDENCE_LIMITS.decisions) }),
    z.strictObject({ kind: z.literal('no_additions') }),
  ]),
}).superRefine((input, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (!once([...input.included, ...input.excluded], source => source.itemId))
    issue('excluded', 'Include or exclude each source once.');
  if (input.included.some(source => source.coverage.state !== 'closed'))
    issue('included', 'Confirm only sources whose reading closed.');
  if (!once(input.targets, target => target.targetId)) issue('targets', 'Name each building once.');
  if (input.additions.kind === 'no_additions') return;
  const named = new Set(input.targets.map(target => target.targetId));
  const rows = input.additions.decisions;
  if (!once(rows, row => row.candidateId)) issue('additions', 'Decide each candidate once.');
  if (rows.some(row => row.decision === 'accept' && !named.has(row.targetId)))
    issue('additions', 'Accept a citation only for a building this confirmation names.');
});
export const IntakeEvidenceConfirmationSchema = z.strictObject({
  confirmationId: uuid, caseId: uuid, inputSha256: hash, input: IntakeEvidenceConfirmSchema,
  subject: z.string().min(1).max(256), expiresAt: at, createdAt: at,
  registryWritten: z.boolean().describe('True once the citation step wrote every building it accepts; the write '
    + 'and this state are one transaction.'),
  note: z.string().min(1).max(500),
});
export type IntakeKeyProfileInput = z.infer<typeof IntakeKeyProfileInputSchema>;
export type IntakeTableRowLocator = z.infer<typeof IntakeTableRowLocatorSchema>;
export type IntakeEvidenceCoverage = z.infer<typeof IntakeEvidenceCoverageSchema>;
export type IntakeEvidenceCandidate = z.infer<typeof IntakeEvidenceCandidateSchema>;
export type IntakeEvidenceConfirm = z.infer<typeof IntakeEvidenceConfirmSchema>;
export type IntakeEvidenceAnchor = z.infer<typeof IntakeEvidenceAnchorSchema>;
export type IntakeEvidenceLocator = z.infer<typeof IntakeEvidenceLocatorSchema>;
export type IntakeEvidenceKey = z.infer<typeof IntakeEvidenceKeySchema>;
export type IntakeKeyProfile = z.infer<typeof IntakeKeyProfileSchema>;
export type IntakeEvidenceSource = z.infer<typeof IntakeEvidenceSourceSchema>;
export type IntakeEvidencePage = z.infer<typeof IntakeEvidencePageSchema>;
export type IntakeEvidenceConfirmation = z.infer<typeof IntakeEvidenceConfirmationSchema>;

/** SB1: an orthophoto, terrain raster or point cloud of a batch read in parts by its existing reader; display only. */
export const INTAKE_SURFACE_VERSION = 'intake-surface/1' as const;
export const INTAKE_SURFACE_LIMITS = Object.freeze({ windowSide: 256, batchPoints: 32_768,
  previewSide: 2048, previewParts: 64, page: 64 });
export const IntakeSurfaceOperationSchema = z.enum(['raster-window', 'point-batch']);
export const IntakeSurfaceLocatorSchema = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('raster-window'), window: RasterPixelWindowSchema.nullable() }),
  z.strictObject({ operation: z.literal('point-batch'), batch: PointBatchSelectionSchema.nullable() }),
]).describe('The part asked of the original; a null window or batch reads a whole-extent overview.');
export const IntakeSurfacePartSchema = z.strictObject({
  partIndex: z.number().int().nonnegative(), state: z.enum(['planned', 'queued', 'published', 'quarantined']),
  locator: IntakeSurfaceLocatorSchema, partKey: hash, jobId: uuid.nullable(), resultSha256: hash.nullable(),
  issueCode: z.string().max(128).nullable(),
});
export const IntakeSurfacePartPageSchema = z.strictObject({
  caseId: uuid, itemId: uuid, operation: IntakeSurfaceOperationSchema,
  partsPlanned: z.number().int().positive().nullable(), parts: z.array(IntakeSurfacePartSchema),
  next: z.number().int().nonnegative().nullable(),
});
export const IntakeSurfacePartsQuerySchema = z.strictObject({ after: z.coerce.number().int().min(-1).optional() });
const xy = z.tuple([z.number().finite(), z.number().finite()]);
const corners = z.tuple([xy, xy, xy, xy]);
const previewLine = z.array(xy), previewPolygon = z.array(previewLine);
const previewGeometry = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('Point'), coordinates: xy }),
  z.strictObject({ type: z.literal('MultiPoint'), coordinates: previewLine }),
  z.strictObject({ type: z.literal('LineString'), coordinates: previewLine }),
  z.strictObject({ type: z.literal('MultiLineString'), coordinates: previewPolygon }),
  z.strictObject({ type: z.literal('Polygon'), coordinates: previewPolygon }),
  z.strictObject({ type: z.literal('MultiPolygon'), coordinates: z.array(previewPolygon) }),
]);
/** Published reader outlines only: no source properties, semantic identity or placement authority. */
export const IntakeReadPreviewPageSchema = z.strictObject({
  itemId: uuid, sourceId: uuid, sourceRevision: z.number().int().positive(), sourceSha256: hash, rawJobId: uuid,
  chunksRead: z.number().int().nonnegative(), reading: z.boolean(),
  crsBasis: z.enum(['stated', 'rfc7946_no_crs_read_yet', 'sealed', 'unsupported'])
    .describe('Replace the displayed preview when this basis changes.'),
  features: z.array(z.strictObject({ featureIndex: z.number().int().nonnegative(), geometry: previewGeometry })).max(2000),
  next: z.number().int().nonnegative().nullable().describe('Last scanned feature index; poll after it while reading.'),
  words: z.string().min(1).max(1024),
});
export type IntakeReadPreviewPage = z.infer<typeof IntakeReadPreviewPageSchema>;
export const IntakeSurfaceDisplaySchema = z.strictObject({
  version: z.literal(INTAKE_SURFACE_VERSION), caseId: uuid, itemId: uuid, partIndex: z.number().int().nonnegative(),
  jobId: uuid, original: z.strictObject({ sourceId: uuid, sourceRevision: z.number().int().positive(),
    sha256: hash, bytes: z.number().int().positive() }),
  locator: IntakeSurfaceLocatorSchema, read: IntakeSurfaceLocatorSchema.describe('The exact part the reader read.'),
  resultSha256: hash, artifact: z.strictObject({ sha256: hash, bytes: z.number().int().positive(),
    mediaType: z.enum(['image/tiff', 'application/vnd.las.point-records']), path: z.string().min(1).max(512) }),
  sourceCrs: z.strictObject({ state: z.enum(['stated', 'not_stated']), authority: z.string().max(100).nullable() }),
  verticalReference: z.strictObject({ status: z.enum(['known', 'unknown']), name: z.string().max(500).nullable() }),
  valueRange: z.strictObject({ kind: z.enum(['band', 'z']), low: z.number().finite(), high: z.number().finite(),
    basis: z.string().min(1).max(500) }).refine(range => range.low <= range.high,
    'The display range must run from low to high.').optional()
    .describe('The one range every part of this item is shaded on, for display only; absent when none is stated. '
      + 'Band values are as read; Z bounds are in raw LAS record integers.'),
  sourceCorners: corners.describe('In the source\'s own coordinate system and units: a window\'s corners from its '
    + 'affine (upper left, upper right, lower right, lower left), or the XY extent of a batch\'s native records.'),
  placement: z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('placed'), areaId: uuid, areaRevision: z.number().int().nonnegative(),
      analysisCrs: z.string().max(64), origin: xy, operation: z.string().max(200), corners }),
    z.strictObject({ state: z.literal('not_placed'),
      reason: z.enum(['no_batch_area', 'no_area_reference', 'no_area_extent', 'no_stated_crs',
        'transform_unavailable', 'outside_area']),
      words: z.string().max(500) }),
  ]),
  use: z.literal('display_only'),
});
export type IntakeSurfaceLocator = z.infer<typeof IntakeSurfaceLocatorSchema>;
export type IntakeSurfacePart = z.infer<typeof IntakeSurfacePartSchema>;
export type IntakeSurfaceDisplay = z.infer<typeof IntakeSurfaceDisplaySchema>;
