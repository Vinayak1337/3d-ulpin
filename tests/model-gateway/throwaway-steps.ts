// GK3: the steps run inside the throwaway database that run-throwaway.mjs creates and removes. Each step prints
// one JSON document of names, counts and catalogue facts; never a key, a hash of one or a password.
// Usage (by the runner only): throwaway-steps.ts base | migrate | server-migrate | snapshot | mark | reserve | rows
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { closePool, migrate as serverMigrate, pool, query, transaction }
  from '../../packages/server/src/infrastructure/db';
import { sql } from '../../packages/server/src/infrastructure/sql-loader';
import { migrateRegistry } from '../../packages/server/src/modules/registry/registry-db';
import { migrateAreas } from '../../packages/server/src/modules/areas/area-db';
import { migrateOfficer } from '../../packages/server/src/modules/officer/officer-db';
import { migrateSpatialMl } from '../../packages/server/src/modules/spatial/spatial-ml-db';
import { migrateUsp } from '../../packages/server/src/modules/usp/migrations';
import { ensureSpatialDatasets } from '../../packages/server/src/modules/spatial/spatial-dataset-db';
import { ensureDatasetMl } from '../../packages/server/src/modules/datasets/dataset-ml-db';
import { ProviderFailure } from '../../packages/server/src/modules/model-gateway/adapter';
import { configuredGateway, hash, readProviderSecret } from '../../packages/server/src/modules/model-gateway/config';
import { PgModelCallLedger } from '../../packages/server/src/modules/model-gateway/ledger';
import { reservation } from '../../packages/server/src/modules/model-gateway/pricing';
import { ownerKeyLedger } from '../../packages/server/src/modules/model-gateway/runtime';

const BEFORE_GK1 = '63c986d5';
const GATEWAY_FILE = 'database/sql/90-model-gateway/model-gateway.sql';
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const fromGit = (path: string) => execFileSync('git', ['show', `${BEFORE_GK1}:${path}`]);
type Step = { id: string; sha256: string; statements: { sha256: string }[] };
const gatewayStep = (manifest: Buffer | string): Step =>
  JSON.parse(manifest.toString('utf8')).steps.find((step: Step) => step.id === 'model-gateway.schema');

/** These steps run only on the runner's own database: loopback, its nonce in the name, no password in the URL. */
function assertThrowawayDatabase() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  const owned = url.hostname === '127.0.0.1' && url.username === 'model_control' && url.password === ''
    && /^\/model_control_[a-f0-9]{16}$/.test(url.pathname);
  if (!owned) throw new Error('These steps run only on the throwaway database of run-throwaway.mjs.');
}

/** Catalogue facts of the gateway's tables, and how many rows each holds. */
async function snapshot() {
  const tables = `LIKE 'usp_model_%'`;
  const columns = await query(`SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name ${tables} ORDER BY table_name, ordinal_position`);
  const constraints = await query(`SELECT conrelid::regclass::text AS table_name,
    pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE connamespace='public'::regnamespace AND conrelid::regclass::text ${tables} ORDER BY 1, 2`);
  const indexes = await query(`SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname='public' AND tablename ${tables} ORDER BY indexname`);
  const rows: Record<string, number> = {};
  for (const table of new Set(columns.rows.map(column => column.table_name as string))) {
    rows[table] = (await query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count;
  }
  const catalogue = { columns: columns.rows.map(column => Object.values(column).join(' ')),
    constraints: constraints.rows.map(row => `${row.table_name}: ${row.definition}`),
    indexes: indexes.rows.map(row => row.indexdef as string) };
  return { catalogueSha256: sha256(JSON.stringify(catalogue)), rows, ...catalogue };
}

/** One settled call and the pool's pin as the ledger of before GK1 wrote them for a one-key policy. */
async function controlRowsOfBeforeGk1() {
  const config = configuredGateway()!;
  const never = async () => { throw new Error('unused'); };
  const ledger = new PgModelCallLedger(never, config, hash(readProviderSecret(config.secretReference)!), 'sarvam');
  await query(`INSERT INTO usp_model_budget(singleton,project_id,config_hash,config,credential_hash)
    VALUES(true,$1,$2,$3,$4)`, [config.projectId, ledger.configHash, config, hash(readProviderSecret(
    config.secretReference)!)]);
  const receipt = { httpStatus: 200, responseHash: hash('gk3-control-answer'), actualMicroInr: '1' };
  await query(`INSERT INTO usp_model_calls(id,project_id,principal_hash,invocation_key,attempt,consumer,input_hash,
    scope_hash,config_hash,price,source_hashes,state,reserve_micro_inr,actual_micro_inr,deadline_at,dispatched_at,
    settled_at,receipt,output,settlement_hash) VALUES($1,$2,$3,$4,1,'INGEST',$5,$6,$7,$8,'[]','settled',$9,1,
    clock_timestamp(),clock_timestamp(),clock_timestamp(),$10,'{"control":true}',$11)`,
  [randomUUID(), config.projectId, hash('gk3-control-principal'), hash('gk3-control-before-gk1'),
    hash('gk3-control-input'), hash('gk3-control-scope'), ledger.configHash, config.price,
    reservation(config).toString(), receipt, hash({ actual: '1', output: { control: true }, receipt })]);
}

/** The schema through the server's own producers in the manifest's order, then the gateway file of before GK1. */
async function base() {
  const producers: [string, () => Promise<unknown>][] = [
    ['bootstrap.postgis', () => query(sql('bootstrap.postgis'))], ['core.schema', () => query(sql('core.schema'))],
    ['registry (migrateRegistry)', migrateRegistry], ['area (migrateAreas)', migrateAreas],
    ['officer (migrateOfficer)', migrateOfficer], ['officer-ai.schema', () => query(sql('officer-ai.schema'))],
    ['spatial-ml (migrateSpatialMl)', migrateSpatialMl], ['usp (migrateUsp)', migrateUsp],
    ['datasets (ensureSpatialDatasets)', ensureSpatialDatasets], ['dataset-ml (ensureDatasetMl)', ensureDatasetMl],
  ];
  const applied: string[] = [];
  for (const [name, produce] of producers) {
    await produce();
    applied.push(name);
  }
  const file = fromGit(GATEWAY_FILE);
  if (sha256(file) !== gatewayStep(fromGit('database/manifest.json')).sha256) {
    throw new Error('The gateway file of before GK1 is not the one its manifest pins.');
  }
  const results = await query(file.toString('utf8')) as unknown as { command: string }[];
  await controlRowsOfBeforeGk1();
  const tables = await query(`SELECT count(*)::int AS count FROM information_schema.tables
    WHERE table_schema='public'`);
  return { applied, gatewayFileBeforeGk1: { commit: BEFORE_GK1, sha256: sha256(file), statements: results.length },
    publicTables: tables.rows[0].count, gateway: await snapshot() };
}

/** The gateway file as it is now in one query call, as migrateModelGateway() sends it; every statement's result. */
async function migrate() {
  const before = gatewayStep(fromGit('database/manifest.json')).statements.map(statement => statement.sha256);
  const pinned = gatewayStep(readFileSync('database/manifest.json')).statements;
  const text = sql('model-gateway.schema');
  const notices: string[] = [];
  const client = await pool().connect();
  client.on('notice', notice => notices.push(notice.message ?? ''));
  try {
    const results = await client.query(text) as unknown as { command: string; rowCount: number | null }[];
    const statements = results.map((result, index) => ({ ordinal: index + 1, command: result.command,
      rowCount: result.rowCount, ofGk1: !before.includes(pinned[index].sha256) }));
    return { fileSha256: sha256(text), statements, notices, gateway: await snapshot() };
  } finally {
    client.removeAllListeners('notice');
    client.release();
  }
}

/** The whole schema through migrate(), the function pnpm db:migrate calls: the gateway file a third time. */
async function migrateByTheServer() {
  await serverMigrate();
  return { gateway: await snapshot() };
}

const admission = () => ({ principalHash: hash('gk3-control-principal'), invocationKey: hash(`gk3-${randomUUID()}`),
  attempt: 1, consumer: 'INGEST' as const, inputHash: hash('gk3-control-input'), scopeHash: hash('gk3-control-scope'),
  sourceHashes: [], deadlineAt: new Date(Date.now() + 45000) });

/** One mark through the ledger's own functions: a call is held, dispatched and closed by a cited 429 refusal. */
async function mark() {
  const ledger = await ownerKeyLedger();
  const { call } = await ledger.reserve(admission());
  await ledger.dispatch(call.id);
  const refusal = new ProviderFailure('quota_exhausted', 429, 0, undefined, hash('gk3-control-refusal'));
  await ledger.retainExposure(call.id, refusal);
  const closed = (await query('SELECT state, error_kind, actual_micro_inr FROM usp_model_calls WHERE id=$1',
    [call.id])).rows[0];
  return { call: { state: closed.state, errorKind: closed.error_kind, actualMicroInr: closed.actual_micro_inr } };
}

/** A hold attempt: its refusal code, or admitted and released again before anything could be sent. */
async function reserve() {
  const ledger = await ownerKeyLedger();
  try {
    const { call } = await ledger.reserve(admission());
    await ledger.releaseBeforeDispatch(call.id);
    return { admitted: true, releasedBeforeDispatch: true };
  } catch (error) {
    return { admitted: false, refusedWith: (error as { code?: string }).code ?? 'not a gateway refusal' };
  }
}

/** What the gateway's tables hold at the end: states, names and whether a column is filled; no hash, no value. */
async function rows() {
  return transaction(async client => ({
    calls: (await client.query(`SELECT state, error_kind, actual_micro_inr,
      credential_hash IS NOT NULL AS names_its_key FROM usp_model_calls ORDER BY created_at`)).rows,
    marks: (await client.query(`SELECT secret_reference, reason, http_status, restored_at IS NOT NULL AS restored,
      restored_reason FROM usp_model_key_marks ORDER BY marked_at`)).rows,
    budget: (await client.query(`SELECT reconciled_at IS NOT NULL AS reconciled, reconciled_reason, blocked_reason,
      jsonb_array_length(config->'secretReferences') AS key_names FROM usp_model_budget`)).rows,
  }));
}

const steps: Record<string, () => Promise<unknown>> = { base, migrate, 'server-migrate': migrateByTheServer,
  snapshot: async () => ({ gateway: await snapshot() }), mark, reserve, rows };
try {
  assertThrowawayDatabase();
  const step = steps[process.argv[2] ?? ''];
  if (!step) throw new Error(`Unknown step. Known: ${Object.keys(steps).join(' | ')}`);
  console.log(JSON.stringify(await step()));
} catch (error) {
  // A database error names a statement or an object, never a configured value; the runner records it and stops.
  const failure = error as { code?: string; message?: string; position?: string };
  console.log(JSON.stringify({ failed: true, code: failure.code ?? null, message: failure.message ?? 'unknown',
    position: failure.position ?? null }));
  process.exitCode = 2;
} finally {
  await closePool();
}
