import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { PassThrough, type Readable } from 'node:stream';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { IntakeTablePlacementSchema, STREAMING_VECTOR_LIMITS, TABLE_DERIVATIVE_LOCATOR, TABLE_GEOJSON_CONVERSION,
  TABLE_PLACEMENT_SKIP_REASONS, TABULAR_LIMITS, TableDerivativeLineageSchema, TabularPinSchema,
  TabularSourceProfileSchema, streamingReadMs, type TableDerivativeLineage } from '@ulpin/contracts/usp';
import { AppError, conflict } from '../../../infrastructure/errors';
import { openObjectStream } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { decodeDelimitedText } from './delimited-text';
import { intakeCaseTx, intakeSourcePin, type IntakeSourceRow } from './intake-context';
import { readIntakeDraftTx, writeIntakeDraftTx } from './intake-ledger';
import { stableUuid } from './intake-run';
import { byteParts, fenced, receiveLargeLayer, type ZipLayerDependencies } from './intake-zip-layers';
import { streamedFeatureIssue } from './streaming-vector-reader';
import { readTableWindows, unavailableColumns, type StreamedTableWindow } from './tabular-stream';
import { coordinateText, geometryJson, parseWkt, type TableGeometry } from './wkt';

/**
 * TC1. A kept table whose rows hold coordinates is placed on the map: the officer names the coordinate columns
 * (x and y, or one WKT column) and the EPSG code they are in, and one job writes the rows as a GeoJSON derivative,
 * reading the table in windows. The derivative declares the officer's system, each feature cites its table row, and
 * it is kept as its own large original and enrolled like a dropped file, so the large GeoJSON path reads it unchanged.
 */
const uuid = z.string().uuid();
const hex64 = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative();
const Coordinates = IntakeTablePlacementSchema.shape.coordinates;
const StatedCrs = IntakeTablePlacementSchema.shape.crs.unwrap();
type TableCoordinates = z.infer<typeof Coordinates>;

export const IntakeTableGeojsonInputSchema = z.strictObject({
  version: z.literal('intake-table-geojson/1'), jobId: uuid, caseId: uuid, caseRevision: count, itemId: uuid,
  sourceId: uuid, sourceRevision: z.number().int().positive(), sourceSha256: hex64, sourcePin: hex64,
  subject: z.string().min(1).max(256), accessSha256: hex64, sourceBytes: z.number().int().positive(),
  // The table read the officer chose columns from; `tabular` also tells the dispatcher a workbook's scratch.
  tabular: TabularPinSchema, headers: TabularSourceProfileSchema.shape.headers,
  coordinates: Coordinates, crs: StatedCrs,
});
export type IntakeTableGeojsonInput = z.infer<typeof IntakeTableGeojsonInputSchema>;

type SkipReason = typeof TABLE_PLACEMENT_SKIP_REASONS[number];
const SKIP_WORDS: Readonly<Record<SkipReason, string>> = {
  no_coordinates: 'had no coordinates',
  not_a_number: 'had text that is not a number',
  not_wkt: 'had text that is not WKT of a point, line or polygon',
  formula: 'had a coordinate cell holding a formula result, an error or no stored value',
  // What the large GeoJSON reader would quarantine is never written, so the placed count is what it accepts.
  open_ring: 'had a polygon ring that does not end where it starts',
  too_large: 'had a shape larger than the map reader takes',
  inexact_number: 'had a number with more digits than the map reader keeps exactly',
  refused: 'had a shape the map reader refuses',
};
const READER_ISSUES: Readonly<Record<string, SkipReason>> = { OPEN_RING: 'open_ring',
  RING_BUDGET_OR_SHAPE: 'too_large', POLYGON_BUDGET_OR_SHAPE: 'too_large', GEOMETRY_BUDGET: 'too_large',
  GEOJSON_UNIT_BUDGET: 'too_large', UNREPRESENTABLE_NUMBER: 'inexact_number' };

export type TablePlacementPlan = Pick<IntakeTableGeojsonInput, 'headers' | 'coordinates' | 'crs'> & {
  selection: IntakeTableGeojsonInput['tabular']['selection'];
  source: Pick<IntakeSourceRow, 'id' | 'revision' | 'sha256' | 'name' | 'bytes'>;
};
export type TablePlacementCounts = { rows: number; features: number; skipped: Partial<Record<SkipReason, number>> };
type TableRow = StreamedTableWindow['rows'][number];

/** Each header names its property; an empty or repeated header is named by its column too, so none is lost. */
function propertyNames(headers: string[]): string[] {
  const seen = new Set<string>();
  return headers.map((header, index) => {
    const name = header && !seen.has(header) ? header : `${header || 'column'} (column ${index + 1})`;
    seen.add(name);
    return name;
  });
}

/** The row's geometry from the officer's columns, or why it is skipped; a skipped row is never placed at 0,0. */
function rowGeometry(row: TableRow, unknown: Set<number>, coordinates: TableCoordinates)
  : TableGeometry | SkipReason {
  const columns = coordinates.kind === 'wkt' ? [coordinates.column] : [coordinates.x, coordinates.y];
  if (columns.some(column => unknown.has(column))) return 'formula';
  const cells = columns.map(column => row.cells[column]?.trim() ?? '');
  if (coordinates.kind === 'wkt') {
    const geometry = parseWkt(cells[0]);
    if (geometry === 'empty') return 'no_coordinates';
    return geometry ?? 'not_wkt';
  }
  if (cells.some(cell => !cell)) return 'no_coordinates';
  const [x, y] = cells.map(coordinateText);
  return x === null || y === null ? 'not_a_number' : { type: 'Point', coordinates: [x, y] };
}

function featureJson(row: TableRow, unknown: Set<number>, geometry: TableGeometry, names: string[],
  plan: TablePlacementPlan) {
  const properties = Object.fromEntries(names.map((name, column) =>
    [name, unknown.has(column) ? null : row.cells[column] ?? null]));
  const tableRow = { sourceId: plan.source.id, sourceRevision: plan.source.revision, sha256: plan.source.sha256,
    row: row.sourceRow };
  return `{"type":"Feature","tableRow":${JSON.stringify(tableRow)},"properties":${JSON.stringify(properties)},`
    + `"geometry":${geometryJson(geometry)}}`;
}

/** The feature as the large GeoJSON reader accepts it, or why that reader would quarantine it; then it is left out. */
function accepted(feature: string): { feature: string } | SkipReason {
  const issue = streamedFeatureIssue(Buffer.from(feature));
  return issue === null ? { feature } : READER_ISSUES[issue] ?? 'refused';
}

function headersChanged(): never {
  throw new AppError(409, 'TABLE_PLACEMENT_HEADERS',
    'The columns of this table differ from those it was read with; read it as a table again.');
}

/**
 * The one writer of the derivative: reads the table with the existing window reader and hands `write` the GeoJSON
 * text one window at a time, so neither the table nor the derivative is ever held whole. The same original and
 * plan always give the same bytes.
 */
export async function writeTableGeojson(body: Readable, plan: TablePlacementPlan,
  write: (text: string) => Promise<void>, read = readTableWindows): Promise<TablePlacementCounts> {
  const names = propertyNames(plan.headers);
  const counts: TablePlacementCounts = { rows: 0, features: 0, skipped: {} };
  await write(`{"type":"FeatureCollection","crs":{"type":"name","properties":{"name":${JSON.stringify(plan.crs)}}},`
    + '"features":[');
  const bytes = Number(plan.source.bytes);
  const result = await read(body, { selection: plan.selection, bytes, name: plan.source.name },
    async (window, headers) => {
      if (window.index === 0 && fingerprint(headers) !== fingerprint(plan.headers)) headersChanged();
      const features: string[] = [];
      for (const row of window.rows) {
        counts.rows++;
        // As in the table read, a workbook cell the reader marked has no value.
        const unknown = 'marks' in row ? unavailableColumns(row) : new Set<number>();
        const geometry = rowGeometry(row, unknown, plan.coordinates);
        const placed = typeof geometry === 'string' ? geometry
          : accepted(featureJson(row, unknown, geometry, names, plan));
        if (typeof placed === 'string') counts.skipped[placed] = (counts.skipped[placed] ?? 0) + 1;
        else features.push((counts.features++ ? ',' : '') + placed.feature);
      }
      if (features.length) await write(features.join(''));
    });
  await write(']}');
  if (result.bytes !== bytes || result.sha256 !== plan.source.sha256)
    throw new AppError(422, 'STREAMING_SOURCE_INTEGRITY', 'The original differs from its byte receipt.');
  return counts;
}

/** The derivative's byte count and SHA-256, from a read that keeps none of its bytes. */
async function measure(body: Readable, plan: TablePlacementPlan, read?: typeof readTableWindows) {
  const hash = createHash('sha256');
  let bytes = 0;
  const counts = await writeTableGeojson(body, plan, async text => {
    const chunk = Buffer.from(text);
    bytes += chunk.length;
    if (bytes > STREAMING_VECTOR_LIMITS.sourceBytes) throw new AppError(413, 'TABLE_PLACEMENT_BUDGET',
      'The rows of this table would make a GeoJSON file larger than the 1 GiB the map reader takes.');
    hash.update(chunk);
  }, read);
  return { ...counts, bytes, sha256: hash.digest('hex') };
}

/**
 * The derivative's bytes as the receipt pulls them. The table is opened and read again only when the first part is
 * asked for, each window waiting to be taken; a receipt that stops early ends the read and waits for its cleanup
 * (a workbook's reader child and scratch copy) before a retry.
 */
async function* pulled(open: () => Promise<Readable>,
  produce: (body: Readable, write: (text: string) => Promise<void>) => Promise<unknown>) {
  const body = await open();
  const stream = new PassThrough();
  const write = async (text: string) => {
    if (stream.destroyed) throw new AppError(409, 'TABLE_PLACEMENT_STOPPED', 'The receipt stopped taking the rows.');
    if (!stream.write(text)) await Promise.race([once(stream, 'drain'), once(stream, 'close')]);
  };
  const read = produce(body, write).then(() => { stream.end(); }, error => { stream.destroy(error); });
  try {
    yield* stream as AsyncIterable<Uint8Array>;
  } finally {
    stream.destroy();
    await read;
    body.destroy();
  }
}

const SITUATED = "SELECT * FROM usp_intake_items WHERE source_id=$1 AND parent_item_id IS NULL FOR UPDATE";

function unstated(): never {
  throw new AppError(422, 'TABLE_PLACEMENT_CRS_UNSTATED', 'Which coordinate system are these coordinates in? '
    + 'State its EPSG code, for example EPSG:4326 for longitude and latitude; none is assumed.');
}

// The parts of a table read's profile a placement pins; the rest of the profile is the table view's.
const TableReadSchema = z.object({ version: z.literal('manual-tabular/1'), tabular: TabularPinSchema,
  headers: TabularSourceProfileSchema.shape.headers });

/** The table read the columns are chosen from; a file not read as a table is refused. */
function tableRead(source: IntakeSourceRow) {
  const read = TableReadSchema.safeParse(source.inspection?.manualProfile);
  if (!read.success) throw new AppError(409, 'TABLE_PLACEMENT_NOT_READ',
    'Read this file as a table first; its rows are placed from the columns of that read.');
  return read.data;
}

function checkColumns(coordinates: TableCoordinates, headers: string[]) {
  const columns = coordinates.kind === 'wkt' ? [coordinates.column] : [coordinates.x, coordinates.y];
  if (columns.some(column => column >= headers.length)) throw new AppError(422, 'TABLE_PLACEMENT_COLUMN',
    `This table has ${headers.length} columns; choose the coordinate columns among them.`);
}

/**
 * Queues the one job that places a kept table's rows, in the caller's transaction (it holds the case and has
 * checked a stated code with the geo service). No code is refused with a question; none waits while one runs.
 */
export async function queueTableGeojsonTx(client: PoolClient, source: IntakeSourceRow,
  request: z.infer<typeof IntakeTablePlacementSchema>): Promise<string> {
  if (!request.crs) unstated();
  const read = tableRead(source);
  checkColumns(request.coordinates, read.headers);
  const item = (await client.query(SITUATED, [source.id])).rows[0];
  if (!item) throw new AppError(409, 'TABLE_PLACEMENT_NOT_READ', 'This file has no item in the batch.');
  if ((await client.query(`SELECT 1 FROM jobs WHERE source_id=$1 AND operation='intake-table-geojson'
    AND status IN ('queued','running') LIMIT 1`, [source.id])).rowCount) conflict(
    'The rows of this table are being placed on the map; follow that placement.');
  const scope = await intakeCaseTx(client, source.case_id);
  const input = IntakeTableGeojsonInputSchema.parse({ version: 'intake-table-geojson/1',
    jobId: stableUuid(`intake-table-geojson/1:${source.id}:${source.revision}:${request.requestKey}`),
    caseId: source.case_id, caseRevision: scope.current.revision, itemId: item.item_id, sourceId: source.id,
    sourceRevision: source.revision, sourceSha256: source.sha256, sourcePin: intakeSourcePin(source, scope.binding),
    subject: scope.binding.subject, accessSha256: scope.binding.access, sourceBytes: Number(source.bytes),
    tabular: read.tabular, headers: read.headers, coordinates: request.coordinates, crs: request.crs });
  const digest = fingerprint(input);
  await client.query(`INSERT INTO jobs(id,case_id,source_id,operation,case_revision,input_fingerprint,payload)
    VALUES($1,$2,$3,'intake-table-geojson',$4,$5,$6)`,
  [input.jobId, input.caseId, input.sourceId, input.caseRevision, digest, input]);
  const { registerUspJobInputTx } = await import('../jobs');
  await registerUspJobInputTx(client, input.jobId,
    { kind: 'intake', workspaceId: input.caseId, version: input.caseRevision + 1 }, input.sourceId, digest);
  await writeIntakeDraftTx(client, item.case_id, item.item_id, { state: 'reading', placement: 'undecided',
    planRef: item.plan_ref, recordsSeen: Number(item.records_seen), limitReason: besideTableWords(item.limit_reason,
      `Placing the rows of this table on the map in ${request.crs}, as stated by the officer.`) });
  return input.jobId;
}

const PLACEMENT_WORDS = /(?:^|\s)Map placement: [\s\S]*$/;

/** The table's own words with this placement's words beside them; an earlier placement's words are replaced. */
export function besideTableWords(current: string | null, words: string): string {
  const placement = `Map placement: ${words}`;
  const own = (current ?? '').replace(PLACEMENT_WORDS, '').trim().slice(0, 2000 - placement.length - 1);
  return own ? `${own} ${placement}` : placement;
}

export type TableGeojsonDependencies = Pick<ZipLayerDependencies, 'transaction' | 'large' | 'register'> & {
  open: (source: IntakeSourceRow) => Promise<Readable>;
  read?: typeof readTableWindows;
};

/** The original as a stream, pinned to the object its receipt verified. */
export async function openTableOriginal(source: IntakeSourceRow): Promise<Readable> {
  const bytes = Number(source.bytes);
  return (await openObjectStream(source.object_key, bytes, streamingReadMs(bytes),
    source.inspection?.largeOriginal?.objectEtag)).body;
}

const plural = (value: number, one: string) => `${value.toLocaleString('en-US')} ${value === 1 ? one : `${one}s`}`;

/** Officer words: how many rows were placed, and how many were skipped and why. */
export function tablePlacementWords(counts: TablePlacementCounts, kept: { name: string; crs: string } | null,
  code: string | null = null): string {
  const reasons = (Object.keys(SKIP_WORDS) as SkipReason[]).flatMap(reason => counts.skipped[reason]
    ? [`${counts.skipped[reason]!.toLocaleString('en-US')} ${SKIP_WORDS[reason]}`] : []);
  const skipped = counts.rows - counts.features;
  const placed = counts.features ? `Placed ${plural(counts.features, 'row')} on the map`
    : 'No row of this table was placed on the map';
  const words = [`${placed}${skipped ? `; ${plural(skipped, 'row')} skipped: ${reasons.join(', ')}` : ''}.`];
  if (kept && !code) words.push(`They are taken in as their own GeoJSON file, ${kept.name}, in ${kept.crs} as `
    + 'stated by the officer.');
  if (kept && code) words.push(`Their GeoJSON file, ${kept.name}, was kept but not taken in (${code}); place the `
    + 'rows again to retry.');
  return words.join(' ');
}

async function keptChildTx(client: PoolClient, caseId: string, sha256: string, lineage: TableDerivativeLineage) {
  return (await client.query(`SELECT id FROM sources WHERE case_id=$1 AND profile='large-original-v1' AND sha256=$2
    AND inspection->'tableDerivative'->>'originalSha256'=$3 ORDER BY revision DESC LIMIT 1`,
  [caseId, sha256, lineage.originalSha256])).rows[0]?.id ?? null;
}

/**
 * Keeps the derivative as a large original whose lineage is written with its source in one transaction, so one an
 * earlier attempt kept is always found again by that lineage and never kept twice.
 */
async function keepTableDerivative(input: IntakeTableGeojsonInput, source: IntakeSourceRow,
  plan: TablePlacementPlan, file: { name: string; bytes: number; sha256: string }, lineage: TableDerivativeLineage,
  dependencies: TableGeojsonDependencies): Promise<string> {
  const prior = await dependencies.transaction(client => keptChildTx(client, input.caseId, file.sha256, lineage));
  if (prior) return prior;
  return fenced(input.caseId, dependencies, revision => {
    const chunks = pulled(() => dependencies.open(source),
      (body, write) => writeTableGeojson(body, plan, write, dependencies.read));
    return receiveLargeLayer(input.caseId, { revision, batchSourceId: source.id }, file, byteParts(chunks),
      dependencies, lineage);
  });
}

function derivativeName(source: IntakeSourceRow, input: IntakeTableGeojsonInput) {
  const stem = source.name.split(/[/\\]/).pop()!.replace(/\.[^.]+$/, '');
  return input.tabular.selection.format === 'xlsx' ? `${stem} ${input.tabular.selection.sheet}.geojson`
    : `${stem}.geojson`;
}

/** The job's source, still the table the officer chose columns from. */
async function pinnedTableTx(client: PoolClient, input: IntakeTableGeojsonInput): Promise<IntakeSourceRow> {
  const source: IntakeSourceRow = (await client.query('SELECT * FROM sources WHERE case_id=$1 AND id=$2',
    [input.caseId, input.sourceId])).rows[0];
  const read = source && tableRead(source);
  if (!read || fingerprint(read.tabular) !== fingerprint(input.tabular)
    || fingerprint(read.headers) !== fingerprint(input.headers)) conflict('The table read changed.');
  return source;
}

type Selection = TablePlacementPlan['selection'];

/**
 * The reading the table was read with. A streamed read pins its detected delimiter and encoding. A CSV pin without
 * an encoding was read whole by the bounded reader (16 MiB at most), which decoded it as UTF-8 or else
 * Windows-1252 and split it at its stated delimiter or commas; the same decoding is taken here from the same bytes.
 */
async function pinnedReading(source: IntakeSourceRow, selection: Selection,
  open: TableGeojsonDependencies['open']): Promise<Selection> {
  if (selection.format !== 'csv' || selection.encoding) return selection;
  if (Number(source.bytes) > TABULAR_LIMITS.bytes) {
    conflict('The table read pins no encoding; read it as a table again.');
  }
  const body = await open(source);
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const chunk of body) {
      bytes += chunk.length;
      if (bytes > TABULAR_LIMITS.bytes) throw new AppError(422, 'STREAMING_SOURCE_INTEGRITY',
        'The original differs from its byte receipt.');
      chunks.push(chunk);
    }
  } finally {
    body.destroy();
  }
  try {
    return { ...selection, delimiter: selection.delimiter ?? ',',
      encoding: decodeDelimitedText(Buffer.concat(chunks)).encoding };
  } catch {
    throw new AppError(422, 'TABULAR_ENCODING', 'This table has invalid text or binary null bytes.');
  }
}

/**
 * The job: measures the derivative, keeps it (reading the table a second time into the receipt), enrols it, and
 * writes the item's words. A table with no placeable row keeps nothing.
 */
export async function placeTableRows(input: IntakeTableGeojsonInput,
  dependencies: TableGeojsonDependencies): Promise<string[]> {
  const source = await dependencies.transaction(client => pinnedTableTx(client, input));
  const selection = await pinnedReading(source, input.tabular.selection, dependencies.open);
  const plan: TablePlacementPlan = { source, selection, headers: input.headers, coordinates: input.coordinates,
    crs: input.crs };
  const first = await dependencies.open(source);
  const measured = await measure(first, plan, dependencies.read).finally(() => first.destroy());
  const name = derivativeName(source, input);
  let kept: string | null = null, code: string | null = null;
  if (measured.features) {
    const lineage = TableDerivativeLineageSchema.parse({ version: 'table-derivative/1',
      conversion: TABLE_GEOJSON_CONVERSION, originalSourceId: source.id, originalSourceRevision: source.revision,
      originalSha256: source.sha256, originalItemId: input.itemId, format: plan.selection.format,
      layer: plan.selection.sheet, coordinates: input.coordinates, crs: input.crs, crsSource: 'officer_stated',
      features: measured.features, notWritten: measured.rows - measured.features, skipped: measured.skipped,
      locator: TABLE_DERIVATIVE_LOCATOR });
    const file = { name, bytes: measured.bytes, sha256: measured.sha256 };
    kept = await keepTableDerivative(input, source, plan, file, lineage, dependencies);
    code = await enrol(input, kept, dependencies);
  }
  const words = tablePlacementWords(measured, kept ? { name, crs: input.crs } : null, code);
  await dependencies.transaction(client => placedTx(client, input, words));
  return kept ? [kept] : [];
}

/**
 * Enrols the kept derivative like a dropped file. A refusal (an AppError below 500) is kept as its code for the
 * officer's words; any other fault fails the job, so the dispatcher retries and the rerun enrols the kept child.
 */
async function enrol(input: IntakeTableGeojsonInput, sourceId: string, dependencies: TableGeojsonDependencies) {
  try {
    await dependencies.register(input.caseId, { sourceId,
      requestKey: stableUuid(`table-derivative/1:${input.itemId}:${sourceId}`) });
    return null;
  } catch (error) {
    if (error instanceof AppError && error.status < 500) return error.code;
    throw error;
  }
}

/** The table's own count and words stay; the placement's words are written beside them. */
async function placedTx(client: PoolClient, input: IntakeTableGeojsonInput, words: string) {
  const current = await readIntakeDraftTx(client, input.caseId, input.itemId);
  await writeIntakeDraftTx(client, input.caseId, input.itemId, { ...current, state: 'read',
    limitReason: besideTableWords(current.limitReason, words) });
}
