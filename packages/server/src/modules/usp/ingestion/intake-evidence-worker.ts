import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ZodError } from 'zod';
import { DocumentInputSchema, TABULAR_LIMITS, type DocumentInput, type DocumentResult,
  type IntakeEvidenceCandidate, type IntakeEvidenceCoverage, type IntakeKeyProfileInput,
  type TabularSelection } from '@ulpin/contracts/usp';
import { query, transaction } from '../../../infrastructure/db';
import { AppError, conflict } from '../../../infrastructure/errors';
import { readObject, sha256 } from '../../../infrastructure/storage';
import { fingerprint } from '../../cases/domain';
import { claimUspJobAttempt, assertUspJobAttemptTx, acceptUspJobAttempt, type UspJobAttempt } from '../jobs';
import { assertDocumentAcceptedResultTx, readDocumentResult } from './documents';
import { IntakeEvidenceInputSchema, NOT_READ, assertIntakeEvidenceInputTx, closeEvidence, documentAssertions,
  evidenceAnchorsTx, stopIntakeEvidenceTx, tableAssertions, windowAssertions, writeIntakeEvidenceTx,
  type EvidenceAssertion, type IntakeEvidenceInput } from './intake-evidence';
import type { IntakeSourceRow } from './intake-context';
import { latestTableJobTx, readTableWindowTx } from './table-windows';
import { admitTabularSource, readTabularSource, type TabularTable } from './tabular-source';

type TableSpec = IntakeKeyProfileInput['tables'][number];
type Retained = Pick<IntakeSourceRow, 'object_key' | 'sha256' | 'bytes'>;
type Reading = { assertions: EvidenceAssertion[]; coverage: IntakeEvidenceCoverage; document?: DocumentInput;
  documentResult?: string };
type Extraction = { id: string; status: string; payload: unknown; result_ref: { sha256: string } | null;
  accepted_fence: string | null; created_at: Date };
// A document is read from its accepted extraction; a reading waits this long for one before it stops partial.
const EXTRACTION_WAIT_MS = 30 * 60_000;
const EXTRACTION_POLL = "interval '20 seconds'";
// D4: a streamed table proposes at most this many key cells per reading; windows past the bound stay unread.
const WINDOW_ASSERTIONS = 50_000;
const FINISHED = ['completed', 'completed_with_rejections'];
type RawTable = { id: string; state: string; records: number; input_sha256: string };
type StoredWindowRow = { window_index: number; records: number; fence: number };
type StoredTable = { raw: RawTable; windows: StoredWindowRow[] };
type WindowedSpec = { spec: TableSpec; kind: IntakeKeyProfileInput['kind']; headers: string[] };

const pinned = (input: IntakeEvidenceInput) => (client: PoolClient) =>
  assertIntakeEvidenceInputTx(client, input).then(() => {});

async function retained(source: Retained) {
  const bytes = await readObject(source.object_key);
  if (bytes.length !== Number(source.bytes) || sha256(bytes) !== source.sha256) {
    throw new AppError(422, 'INTAKE_SOURCE_INTEGRITY', 'The retained original differs from its pins.');
  }
  return bytes;
}

/** D4: a table the profile does not name is read like the named table whose header row it repeats exactly.
 * `lateHeaders` gives the late table's header row under a named selection, or null when it cannot be read so. */
async function lateTableSpec(caseId: string, profile: IntakeKeyProfileInput,
  lateHeaders: (selection: TabularSelection) => string[] | null) {
  for (const named of profile.tables) {
    const source = (await query<Retained>(`SELECT s.object_key,s.sha256,s.bytes FROM usp_intake_items i
      JOIN sources s ON s.id=i.source_id WHERE i.case_id=$1 AND i.item_id=$2`, [caseId, named.itemId])).rows[0];
    if (!source || Number(source.bytes) > TABULAR_LIMITS.bytes) continue;
    const headers = readTabularSource(await retained(source), named.selection).headers;
    const late = lateHeaders(named.selection);
    if (late && fingerprint(late) === fingerprint(headers)) return named;
  }
  return null;
}

function wholeHeaders(bytes: Uint8Array) {
  return (selection: TabularSelection) => {
    try {
      return readTabularSource(bytes, selection).headers;
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      return null;
    }
  };
}

/** One physical row per assertion; the row hash pins every cell as read, unknown cells by their state alone. */
function readTable(input: IntakeEvidenceInput, attempt: UspJobAttempt, spec: TableSpec, table: TabularTable,
  kind: IntakeKeyProfileInput['kind']): Reading {
  const rawResultSha256 = fingerprint(table);
  return tableAssertions(table, spec.columnIndex, kind, (index, cells, literal) => ({
    kind: 'table_row', itemId: input.itemId, caseId: input.caseId, sourceId: input.sourceId,
    sourceRevision: input.sourceRevision, sourceSha256: input.sourceSha256, rawJobId: input.jobId,
    rawInputSha256: attempt.inputSha256, rawResultSha256, acceptedFence: attempt.fence, selection: spec.selection,
    sourceRow: table.sourceRows[index], rowSha256: fingerprint(cells), columnIndex: spec.columnIndex,
    columnHeader: table.headers[spec.columnIndex], cell: { state: 'literal', value: literal } }));
}

/** A stored window that no longer reads back as written counts as failed; any other error stops the reading. */
function unreadable(error: unknown): null {
  if (error instanceof ZodError || error instanceof AppError && error.code === 'TABLE_WINDOW_INTEGRITY') return null;
  throw error;
}

/** D2: closed only when every window of a finished raw job was read. Otherwise what was not read stays unknown
 * while the raw job is unfinished, and a window that did not read back counts as failed, never as absent. */
function windowCoverage(raw: RawTable, read: number, eligible: number, failed: number): IntakeEvidenceCoverage {
  const finished = FINISHED.includes(raw.state);
  if (finished && !failed && read === raw.records) {
    return { state: 'closed', read, eligible, keyless: read - eligible, unread: 0, failed: 0 };
  }
  return { state: 'partial', read, eligible, keyless: read - eligible,
    unread: finished ? raw.records - read - failed : null, failed: finished || failed ? failed : null };
}

/** D1: each stored window of the raw job, one at a time; a row's locator cites its window, byte range and hash.
 * A streamed row's raw result is its stored window, pinned by the window's SHA-256 and fence. */
async function readWindows(input: IntakeEvidenceInput, { spec, kind, headers }: WindowedSpec,
  { raw, windows }: StoredTable, literals: ReadonlySet<string>): Promise<Reading> {
  const assertions: EvidenceAssertion[] = [];
  let read = 0, failed = 0;
  for (const stored of windows) {
    if (assertions.length + stored.records > WINDOW_ASSERTIONS) break;
    const window = await transaction(client => readTableWindowTx(client, raw.id, stored.window_index))
      .catch(unreadable);
    if (!window) {
      failed += stored.records;
      continue;
    }
    assertions.push(...windowAssertions(window.rows, spec.columnIndex, kind, (row, cells, literal) => ({
      kind: 'table_row', itemId: input.itemId, caseId: input.caseId, sourceId: input.sourceId,
      sourceRevision: input.sourceRevision, sourceSha256: input.sourceSha256, rawJobId: raw.id,
      rawInputSha256: raw.input_sha256, rawResultSha256: window.sha256, acceptedFence: stored.fence,
      selection: spec.selection, sourceRow: row.sourceRow, rowSha256: fingerprint(cells), columnIndex: spec.columnIndex,
      columnHeader: headers[spec.columnIndex], cell: { state: 'literal', value: literal },
      window: { index: window.index, record: row.record, byteStart: row.byteStart, byteEnd: row.byteEnd,
        sha256: row.sha256 } })));
    read += window.rows.length;
  }
  const coverage = windowCoverage(raw, read, assertions.length, failed);
  // Unread coverage is never absence: a partial reading proposes only the keys a building holds.
  return { coverage, assertions: coverage.state === 'closed' ? assertions
    : assertions.filter(assertion => literals.has(assertion.literal)) };
}

/** A table whose newest raw streaming job stored windows is read from them, never whole; null when it has none.
 * The raw job's state is read before its windows, so a finished state always sees every window. */
export async function windowedTableReading(input: IntakeEvidenceInput, profile: IntakeKeyProfileInput,
  source: IntakeSourceRow, literals: ReadonlySet<string>): Promise<Reading | null> {
  const stored = await transaction(async (client): Promise<StoredTable | null> => {
    const job = await latestTableJobTx(client, input.caseId, input.sourceId, input.sourceRevision);
    if (!job) return null;
    const raw = (await client.query(`SELECT job_id AS id,state,records,input_sha256
      FROM usp_streaming_vector_imports WHERE job_id=$1`, [job.id])).rows[0];
    const windows = (await client.query(`SELECT window_index,records,fence FROM usp_table_windows
      WHERE job_id=$1 ORDER BY window_index`, [job.id])).rows;
    return { raw, windows };
  });
  if (!stored) return null;
  admitTabularSource(source.sha256, Number(source.bytes), source.inspection?.tabularProvenance);
  const manual = source.inspection?.manualProfile, streamed = fingerprint(manual?.tabular?.selection ?? null);
  const headers: string[] = manual?.headers ?? [];
  const spec = profile.tables.find(table => table.itemId === input.itemId)
    ?? await lateTableSpec(input.caseId, profile, selection => fingerprint(selection) === streamed ? headers : null);
  // The windows hold the table as its stream read it; a profile naming another selection reads nothing here.
  if (!spec || fingerprint(spec.selection) !== streamed) return { assertions: [], coverage: NOT_READ };
  return readWindows(input, { spec, kind: profile.kind, headers }, stored, literals);
}

async function tableReading(input: IntakeEvidenceInput, attempt: UspJobAttempt, profile: IntakeKeyProfileInput,
  source: IntakeSourceRow, literals: ReadonlySet<string>): Promise<Reading> {
  const windowed = await windowedTableReading(input, profile, source, literals);
  if (windowed) return windowed;
  // A table over the in-memory bound whose stream has stored no window yet is not read.
  if (Number(source.bytes) > TABULAR_LIMITS.bytes) return { assertions: [], coverage: NOT_READ };
  const bytes = await retained(source);
  admitTabularSource(source.sha256, bytes.length, source.inspection?.tabularProvenance);
  const spec = profile.tables.find(table => table.itemId === input.itemId)
    ?? await lateTableSpec(input.caseId, profile, wholeHeaders(bytes));
  if (!spec) return { assertions: [], coverage: NOT_READ };
  return readTable(input, attempt, spec, readTabularSource(bytes, spec.selection), profile.kind);
}

async function latestExtraction(input: IntakeEvidenceInput): Promise<Extraction | undefined> {
  return (await query<Extraction>(`SELECT j.id,j.status,j.payload,j.created_at,m.result_ref,m.accepted_fence FROM jobs j
    JOIN usp_job_metadata m ON m.job_id=j.id WHERE j.case_id=$1 AND j.source_id=$2
    AND j.operation='document-extraction' ORDER BY j.created_at DESC LIMIT 1`,
  [input.caseId, input.sourceId])).rows[0];
}

function readDocument(input: IntakeEvidenceInput, extraction: Extraction, document: DocumentInput,
  result: DocumentResult, literals: Set<string>): Reading {
  const pins = { itemId: input.itemId, caseId: input.caseId, caseRevision: document.caseRevision,
    sourceId: input.sourceId, sourceRevision: input.sourceRevision, sourceSha256: input.sourceSha256,
    jobId: extraction.id, resultSha256: extraction.result_ref!.sha256, inputSha256: fingerprint(document),
    readerSha256: result.native.readerSha256, acceptedFence: Number(extraction.accepted_fence) };
  const reading = documentAssertions(result.native.parts, literals, result.native.status === 'extracted',
    (part, quote, start) => ({ kind: 'document_part', ...pins, partId: part.id, partSha256: part.sha256,
      page: part.locator.page ?? null, quote, quoteStart: start, quoteEnd: start + quote.length }));
  return { ...reading, document, documentResult: pins.resultSha256 };
}

/** Its own source revision's accepted extraction only; a failed or other-revision extraction reads nothing. */
async function documentReading(input: IntakeEvidenceInput, extraction: Extraction | undefined,
  literals: Set<string>): Promise<Reading> {
  const document = extraction && DocumentInputSchema.parse(extraction.payload);
  if (!extraction || extraction.status !== 'succeeded' || !extraction.result_ref || !document
    || document.sourceRevision !== input.sourceRevision || document.sourceSha256 !== input.sourceSha256) {
    return { assertions: [], coverage: NOT_READ };
  }
  const result = await readDocumentResult(document, extraction.result_ref.sha256);
  return readDocument(input, extraction, document, result, literals);
}

/** While the document's extraction is still queued or running, the reading waits for it without an attempt. */
async function waitsForExtraction(input: IntakeEvidenceInput, family: string, created: Date) {
  if (family !== 'document' || Date.now() - new Date(created).getTime() > EXTRACTION_WAIT_MS) return false;
  const extraction = await latestExtraction(input);
  if (extraction && !['queued', 'running'].includes(extraction.status)) return false;
  await query(`UPDATE jobs SET next_attempt_at=now()+${EXTRACTION_POLL} WHERE id=$1 AND status='queued'`,
    [input.jobId]);
  return true;
}

async function stopped(input: IntakeEvidenceInput, code: string, attempt?: UspJobAttempt) {
  await transaction(async client => {
    await client.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE', [input.caseId]);
    const job = (await client.query('SELECT status FROM jobs WHERE id=$1 FOR UPDATE', [input.jobId])).rows[0];
    if (attempt) {
      await assertUspJobAttemptTx(client, attempt);
      await client.query("UPDATE usp_job_attempts SET state='fenced' WHERE job_id=$1 AND number=$2",
        [input.jobId, attempt.number]);
    } else {
      const active = (await client.query(`SELECT 1 FROM usp_job_attempts WHERE job_id=$1 AND state='active'
        AND lease_until>now() LIMIT 1`, [input.jobId])).rowCount;
      if (active || !job || !['queued', 'running'].includes(job.status)) return;
    }
    await client.query("UPDATE usp_job_metadata SET logical_state='failed',version=version+1 WHERE job_id=$1",
      [input.jobId]);
    await client.query('UPDATE jobs SET status=$2,error=$3,completed_at=now() WHERE id=$1',
      [input.jobId, code === 'STALE_REVISION' ? 'stale' : 'failed', code]);
    // A replaced reading leaves the newer one's coverage alone.
    await stopIntakeEvidenceTx(client, input).catch(error => {
      if (!(error instanceof AppError && error.status === 409)) throw error;
    });
  });
}

async function complete(input: IntakeEvidenceInput, attempt: UspJobAttempt, reading: Reading,
  candidates: IntakeEvidenceCandidate[]) {
  const resultSha256 = fingerprint({ coverage: reading.coverage,
    candidates: candidates.map(candidate => [candidate.candidateId, candidate.candidateSha256]) });
  await acceptUspJobAttempt(attempt,
    { assetId: `intake-evidence:${input.profileId}:${input.itemId}`, version: 1, sha256: resultSha256 },
    async (client, job) => {
      if (fingerprint(job.payload) !== fingerprint(input)) conflict('The evidence reading job changed.');
      if (reading.document) await assertDocumentAcceptedResultTx(client, reading.document, reading.documentResult!);
      await writeIntakeEvidenceTx(client, input, reading.coverage, resultSha256, candidates);
    }, pinned(input));
}

async function read(input: IntakeEvidenceInput, attempt: UspJobAttempt, family: string) {
  const { profile, source, anchors } = await transaction(async client => {
    const pins = await assertIntakeEvidenceInputTx(client, input);
    return { ...pins, anchors: await evidenceAnchorsTx(client, input.caseId, pins.profile.profile) };
  });
  const literals = new Set(anchors.map(anchor => anchor.literal));
  // With no building holding the key, nothing can be matched and absence is not shown: the source stays unread.
  const reading: Reading = !anchors.length ? { assertions: [], coverage: NOT_READ }
    : family === 'table' ? await tableReading(input, attempt, profile.profile, source, literals)
      : await documentReading(input, await latestExtraction(input), literals);
  const candidates = closeEvidence({ caseId: input.caseId, anchors, assertions: reading.assertions,
    coverage: reading.coverage, createdAt: new Date().toISOString(), key: { profileId: input.profileId,
      profileSha256: input.profileSha256, namespace: profile.profile.namespace, kind: profile.profile.kind } });
  return { reading, candidates };
}

/** AU4-B2: one fenced reading of one table or document under one key profile, in the existing job authority. */
export async function runIntakeEvidenceJob(jobId: string) {
  const job = (await query(`SELECT j.*,i.family FROM jobs j JOIN usp_intake_items i
    ON i.case_id=j.case_id AND i.item_id=(j.payload->>'itemId')::uuid
    WHERE j.id=$1 AND j.operation='intake-evidence'`, [jobId])).rows[0];
  if (!job || !['queued', 'running'].includes(job.status)) return;
  const input = IntakeEvidenceInputSchema.parse(job.payload);
  if (job.status === 'queued' && await waitsForExtraction(input, job.family, job.created_at)) return;
  let attempt: UspJobAttempt;
  try {
    attempt = await claimUspJobAttempt(jobId, `intake-evidence:${randomUUID()}`, pinned(input));
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    await stopped(input, error.code);
    return;
  }
  try {
    const { reading, candidates } = await read(input, attempt, job.family);
    await complete(input, attempt, reading, candidates);
  } catch (error) {
    await stopped(input, error instanceof AppError ? error.code : 'INTAKE_EVIDENCE_FAILED', attempt);
    throw error;
  }
}
