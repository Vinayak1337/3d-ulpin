import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AnyStreamingInputSchema, ChunkMappingInputSchema, STREAMING_VECTOR_LIMITS,
  type ChunkMappingPayload } from '@ulpin/contracts/usp';
import { profileWorkerFixture } from './streamed-profile-worker.fixture';

/** Scheduling protocol only: reuse the attempt-authority fixture; mapping payload work is a stub, not truth. */
export function mappingWorkerFixture(offset = 0, windowed = false) {
  const base = profileWorkerFixture(offset), { profilerSha256: _profiler, ...pins } = base.input;
  const hash = pins.sourceSha256;
  const tabular = { selection: { format: 'csv', sheet: 'csv', table: null, headerRows: [1] },
    sourceBytes: 100, developmentAssetId: 'test_only', developmentFamily: 'mi-d1' };
  const input = ChunkMappingInputSchema.parse({ ...pins, version: 'chunk-mapping/1', tabular,
    converterSha256: hash, route: 'approved_recipe', recipeId: pins.caseId, recipeRevision: 1,
    planHash: hash, schemaFingerprint: hash, workspaceFingerprint: hash });
  const job = base.job as unknown as Omit<typeof base.job, 'payload'> & { payload: typeof input };
  Object.assign(job, { operation: 'chunk-mapping', payload: input });
  const rawInput = AnyStreamingInputSchema.parse({ version: STREAMING_VECTOR_LIMITS.version,
    jobId: input.rawJobId, caseId: input.caseId,
    caseRevision: 1, sourceId: input.sourceId, sourceRevision: 1, sourceFamilyId: input.sourceFamilyId,
    sourceSha256: hash, sourceBytes: 100, objectKey: 'test_only', framing: 'tabular', tabular,
    subject: input.subject, accessBinding: hash, readerSha256: hash, inputFingerprint: hash });
  let sealed: number | null = null;
  const intake = { item_id: input.sourceId, state: 'read', placement: 'undecided', plan_ref: null,
    records_seen: 0, limit_reason: 'The table is read. Its field meanings are being proposed for your review; '
      + 'nothing is recorded until you confirm it.' };
  const query = async (sql: string, values: any[] = []) => {
    base.statements.push(sql);
    if (sql.startsWith('SELECT i.item_id')) return { rows: [intake], rowCount: 1 };
    if (sql.startsWith('SELECT state,placement,plan_ref')) return { rows: [intake], rowCount: 1 };
    if (sql.startsWith('UPDATE usp_intake_items SET state=')) {
      Object.assign(intake, { state: values[2], placement: values[3], plan_ref: values[4],
        records_seen: values[5], limit_reason: values[6] });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT item_id AS')) return { rows: [{ itemId: input.sourceId, state: intake.state,
      family: 'table', format: 'csv', sizeClass: 'S', wave: 1, pinnedByOfficer: false }], rowCount: 1 };
    if (sql.startsWith('SELECT revision FROM cases')) return { rows: [{ revision: 1 }], rowCount: 1 };
    if (sql.startsWith('SELECT payload FROM jobs')) return { rows: [{ payload: rawInput }], rowCount: 1 };
    if (sql.startsWith('UPDATE usp_job_attempts SET lease_until')) {
      base.attempts.at(-1).lease_until = new Date(Date.now() + 180000);
      return { rows: [{ lease_until: base.attempts.at(-1).lease_until }], rowCount: 1 };
    }
    if (sql.startsWith('SELECT number,fence FROM usp_job_attempts'))
      return { rows: base.attempts.slice(-1), rowCount: Math.min(1, base.attempts.length) };
    if (sql.startsWith('SELECT 1 FROM usp_table_windows')) {
      const ready = values[1] < base.raw.sealed_chunks;
      return { rows: ready ? [{}] : [], rowCount: Number(ready) };
    }
    if (sql.startsWith('SELECT') && sql.includes('FROM usp_chunk_mapping_imports'))
      return { rows: [{ ...base.state, next_publish_index: base.state.next_raw_index,
        expired: Date.now() - base.state.updated_at.getTime() >= Number(values[1]),
        records: base.state.next_raw_index, normalized: 0, unresolved: base.state.next_raw_index,
        quarantined: 0, duplicate_keys: 0, schema_drift_chunks: 0, refused: false,
        sealed_chunks: sealed, unknown_remainder: sealed === null }], rowCount: 1 };
    if (sql.startsWith('UPDATE usp_chunk_mapping_imports')) {
      if (sql.includes('sealed_chunks=$2')) sealed = values[1];
      sql = sql.replaceAll('usp_chunk_mapping_imports', 'usp_streamed_profile_imports')
        .replaceAll('next_publish_index', 'next_raw_index');
    }
    if (sql.startsWith('INSERT INTO usp_chunk_mapping_slots')) return { rows: [], rowCount: 0 };
    return base.query(sql, values);
  };
  const consume = async () => {
    await query('UPDATE usp_chunk_mapping_imports SET next_publish_index=next_publish_index+1,updated_at=now()',
      [input.jobId]);
  };
  const controls = { ...base.controls, windowed, consume, stale: false, assertChunkMappingInputTx: async () => {} };
  const pool = { query, connect: async () => ({ query, release() {} }) };
  const publish = () => base.publish([{} as never]);
  return { ...base, input, job, controls, query, pool, publish, intake };
}

export async function loadMappingWorker(folder: string, fixture: ReturnType<typeof mappingWorkerFixture>,
  baseline = false) {
  const globals = globalThis as typeof globalThis & { s13hMapping?: unknown };
  globals.s13hMapping = fixture.controls;
  const path = fileURLToPath(new URL('./chunk-mapping-worker.ts', import.meta.url));
  const revisionPath = '1710369c:packages/server/src/modules/usp/ingestion/chunk-mapping-worker.ts';
  let source = baseline ? execFileSync('git', ['show', revisionPath], { encoding: 'utf8' })
    : await readFile(path, 'utf8');
  source = source.replace("import {StreamingVectorService,lockStreamingRowsTx} from './streaming-vector';",
    'const {StreamingVectorService,lockStreamingRowsTx} = globalThis.s13hMapping;');
  source = source.replace("import {assertChunkMappingInputTx} from './chunk-mapping';",
    'const mappingControls = globalThis.s13hMapping;\n'
      + `const assertChunkMappingInputTx = (...args) => {
        if (mappingControls.stale) throw new AppError(409, 'STALE_REVISION', 'test_only');
        return mappingControls.assertChunkMappingInputTx(...args);
      };`);
  source = source.replace("import {isWindowedTable} from './table-windows';",
    `const isWindowedTable = () => ${fixture.controls.windowed};`);
  const tableImport = "import {acceptTableWindow,acceptTabularDataSlot,proposeFromTableWindow} "
    + "from './chunk-mapping-tabular';";
  source = source.replace(tableImport,
    'const acceptTableWindow = globalThis.s13hMapping.consume;\n'
      + 'const acceptTabularDataSlot = globalThis.s13hMapping.consume;\n'
      + 'const proposeFromTableWindow = async () => { await globalThis.s13hMapping.consume(); return true; };');
  for (const [name, module] of [['appendCaseIngestionTx', 'events'], ['queueIntakeLargeTx', 'intake-large']])
    source = source.replace(`import {${name}} from './${module}';`, `const ${name} = async () => {};`);
  source = source.replaceAll("'@ulpin/contracts/usp'",
    JSON.stringify(fileURLToPath(import.meta.resolve('@ulpin/contracts/usp'))));
  source = source.replace(/(['"])(\.\.?\/[^'"]+)\1/g,
    (_match, _quote: string, specifier: string) => JSON.stringify(resolve(dirname(path), specifier)));
  const target = join(folder, `mapping-${baseline ? 'before' : 'after'}-${fixture.input.jobId}.ts`);
  await writeFile(target, source);
  return import(pathToFileURL(target).href) as Promise<{ runChunkMappingJob: (id: string) => Promise<void> }>;
}

/** Exercise durable table publication with the same source-authority double as the worker protocol. */
export async function loadTabularPublisher(folder: string, baseline = false) {
  const path = fileURLToPath(new URL('./chunk-mapping-tabular.ts', import.meta.url));
  let source = baseline ? execFileSync('git', ['show', '34e5ff97:packages/server/src/modules/usp/ingestion/'
    + 'chunk-mapping-tabular.ts'], { encoding: 'utf8' }) : await readFile(path, 'utf8');
  source = source.replace("import { assertChunkMappingInputTx } from './chunk-mapping';",
    'const assertChunkMappingInputTx = async () => {};');
  source = source.replaceAll("'@ulpin/contracts/usp'",
    JSON.stringify(fileURLToPath(import.meta.resolve('@ulpin/contracts/usp'))));
  source = source.replace(/(['"])(\.\.?\/[^'"]+)\1/g,
    (_match, _quote: string, specifier: string) => JSON.stringify(resolve(dirname(path), specifier)));
  const target = join(folder, `table-publisher-${baseline ? 'before' : 'after'}.ts`);
  await writeFile(target, source);
  return import(pathToFileURL(target).href) as Promise<{
    publishTabularMappingTx: (client: unknown, input: unknown, attempt: unknown,
      stored: { payload: ChunkMappingPayload; bytes: number; hash: string; key: string },
      firstIndex: number, rawHash: string) => Promise<void>;
  }>;
}
