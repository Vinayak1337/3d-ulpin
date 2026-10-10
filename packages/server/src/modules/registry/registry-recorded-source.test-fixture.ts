import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { DocumentInput } from '@ulpin/contracts/usp';
import { fingerprint } from '../cases/domain';
import { documentInput } from '../usp/ingestion/document-context';
import { ingestionBinding } from '../usp/ingestion/events';

export const subject = 'k6-recorded-source-control';
export const digest = 'c'.repeat(64);
export const movedOnReader = '0'.repeat(64);

export type Row = Record<string, any>;
type Rows = (q: string, args: any[]) => Row[] | null;

/** The SQL the source authorities issue, answered from memory. No object, reader or provider runs.
 * `extra` answers the statements of the reader under test before the source rows are consulted. */
export function recordedSourceControl() {
  const siteId = randomUUID();
  const caseRow: Row = { id: randomUUID(), revision: 1, archived: false, frame: null, context: null, site_id: siteId };
  const sources = new Map<string, Row>();
  const jobs = new Map<string, Row>();
  const pinned = new Set<string>();
  const state = { extra: (() => null) as Rows };
  const sourceRows = (q: string, args: any[]) => {
    const source = sources.get(q.includes('case_id=$1 AND id=$2') ? args[1] : args[0]);
    if (!source) return [];
    return [q.includes('JOIN cases') ? { ...source, source_site_id: caseRow.site_id,
      source_archived: caseRow.archived } : source];
  };
  const own: Rows = (q, args) => {
    if (/^(BEGIN|COMMIT|ROLLBACK|SET )/.test(q)) return [];
    if (q.includes('FROM import_packages')) return pinned.has(args[0]) ? [{}] : [];
    if (q.includes('max(revision)')) return [{ revision: Math.max(...[...sources.values()]
      .filter(source => source.family_id === args[1]).map(source => source.revision)) }];
    if (q.includes('FROM sources')) return sourceRows(q, args);
    if (q.includes('FROM cases')) return [caseRow];
    if (q.includes('FROM jobs')) return jobs.has(args[0]) ? [jobs.get(args[0])!] : [];
    throw new Error(`Unexpected query: ${q}`);
  };
  const query = async (sql: string, args: any[] = []) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    const rows = state.extra(q, args) ?? own(q, args)!;
    return { rows: structuredClone(rows), rowCount: rows.length };
  };
  const pool = { connect: async () => ({ query, release() {} }), query };
  return { siteId, caseRow, sources, jobs, pinned, state, pool, client: { query } as unknown as PoolClient };
}
export type RecordedSourceControl = ReturnType<typeof recordedSourceControl>;

export function retainOriginal(f: RecordedSourceControl, status: 'needs_input' | 'received' = 'received'): Row {
  const id = randomUUID();
  const source = { id, case_id: f.caseRow.id, family_id: id, revision: 1, sha256: digest, bytes: 1,
    object_key: `sources/${id}/${digest}`, profile: 'pdf-reference-v2', status, created_at: '2026-10-09T22:50:29Z',
    name: 'retained-original.pdf', inspection: { status: 'needs_input', documentOriginal: {
      version: 'source-document/1', subject, format: 'pdf', sha256: digest, bytes: 1,
      receivedAt: '2026-10-09T22:50:29Z' } } as Row };
  f.sources.set(id, source);
  return source;
}

export function storeJob(f: RecordedSourceControl, input: DocumentInput) {
  f.jobs.set(input.jobId, { payload: input, input_fingerprint: fingerprint(input), input_sha256: fingerprint(input),
    status: 'succeeded', logical_state: 'succeeded', result_ref: { sha256: digest } });
}

/** An accepted native reading of the original under the pins that are current when it is made. */
export function acceptResult(f: RecordedSourceControl, source: Row): DocumentInput {
  const jobId = randomUUID();
  const context = { current: f.caseRow, source, binding: ingestionBinding(f.caseRow.id),
    context: fingerprint({ frame: null, context: null, siteId: f.siteId }), latest: true };
  const input = documentInput(context as never, jobId, 'native_only');
  storeJob(f, input);
  source.status = 'needs_input';
  source.inspection.documentAccepted = { jobId, sha256: digest };
  return input;
}

/** A geometry-free package pins the original that its recorded building cites. */
export function recordedOriginal(f: RecordedSourceControl) {
  const source = retainOriginal(f);
  const input = acceptResult(f, source);
  f.pinned.add(source.id);
  return { source, input };
}

export async function attributed(work: () => Promise<void>) {
  const prior = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = subject;
  try { await work(); } finally {
    if (prior === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = prior;
  }
}
export const citation = (source: Row) => ({ id: source.id, revision: source.revision, sha256: source.sha256 });
export const refusal = (status: number, code: string) => (error: any) => error.status === status && error.code === code;
