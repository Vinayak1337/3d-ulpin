/** Deliberate serving upgrade; audit is read-only, mutation is a separate reviewed invocation. */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { PoolClient } from 'pg';
import {
  codePin, connection, datasetPins, fingerprints, hash, integrity, loadEnvironment,
  originalIntegrity, preserved, requireGuard, target, writeReceipt, type Fingerprint,
} from './serving-common';

type Snapshot = Awaited<ReturnType<typeof audit>>;
const args = process.argv.slice(2), mode = args.shift();
const options = new Map<string,string>();
while (args.length) {
  const key = args.shift()!, value = args.shift();
  requireGuard(key.startsWith('--') && value && !value.startsWith('--') && !options.has(key), 'INVALID_ARGUMENTS');
  options.set(key.slice(2), value);
}
function option(key: string) { const value = options.get(key); requireGuard(value, `REQUIRED_${key.toUpperCase().replaceAll('-','_')}`); return value; }
async function read<T>(client: PoolClient, action: () => Promise<T>) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try { return await action(); } finally { await client.query('ROLLBACK'); }
}
async function audit(client: PoolClient, endpoint: string) {
  const { inspectDatabaseReadiness } = await import('@ulpin/server/infrastructure/database-readiness');
  return read(client, async () => ({
    target: await target(client, endpoint), readiness: await inspectDatabaseReadiness(client),
    records: await fingerprints(client), integrity: await integrity(client),
    originals: await originalIntegrity(client), datasets: await datasetPins(client),
  }));
}
function clean() {
  requireGuard(!execFileSync('git',['status','--porcelain'],{encoding:'utf8',timeout:5000}).trim(), 'CLEAN_PINNED_CHECKOUT_REQUIRED');
}
function safe(snapshot: Snapshot) {
  requireGuard(!snapshot.integrity.orphans.length, 'FOREIGN_KEY_ORPHANS');
  requireGuard(!snapshot.integrity.geometryViolations.length, 'HISTORICAL_GEOMETRY_REVIEW_REQUIRED');
  requireGuard(!snapshot.readiness.schema.invalidIndexes, 'INVALID_INDEX_REVIEW_REQUIRED');
  requireGuard(!snapshot.integrity.pendingBackfills.identities && !snapshot.integrity.pendingBackfills.areas,
    'POPULATED_BACKFILL_REVIEW_REQUIRED');
}
async function archive(client: PoolClient, before: Snapshot, file: string) {
  const bytes = readFileSync(file);
  requireGuard(hash(bytes) === option('expect-review'), 'REVIEW_FILE_CHANGED');
  const review = JSON.parse(bytes.toString('utf8'));
  requireGuard(review.version === 'serving-archive-review/1' && review.target === before.target.token &&
    review.manifestSha256 === before.readiness.schema.manifestSha256 && Array.isArray(review.datasets) &&
    review.datasets.length > 0 && review.datasets.length <= 20, 'EXACT_ARCHIVAL_REVIEW_REQUIRED');
  requireGuard(new Set(review.datasets.map((d: {id: string}) => d.id)).size === review.datasets.length, 'DUPLICATE_REVIEW_ID');
  const pins = new Map(before.datasets.map(d => [d.id,d]));
  for (const entry of review.datasets) {
    const pin = pins.get(entry.id);
    requireGuard(pin && pin.originalSha256 === entry.originalSha256 && pin.fingerprint === entry.fingerprint &&
      entry.decision === 'archive_active_only' && entry.basis === 'reviewed_original_lineage_synthetic_only' &&
      typeof entry.evidenceFile === 'string' && /^[a-f0-9]{64}$/.test(entry.evidenceSha256), 'ARCHIVAL_PIN_OR_LINEAGE_REVIEW_MISSING');
    // Evidence can be private; never serialize its content or interpret the legacy classification as proof.
    requireGuard(hash(readFileSync(entry.evidenceFile)) === entry.evidenceSha256, 'ARCHIVAL_EVIDENCE_CHANGED');
  }
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL statement_timeout='10000ms'");
    await client.query('LOCK TABLE spatial_datasets IN SHARE ROW EXCLUSIVE MODE');
    const current = await datasetPins(client);
    requireGuard(JSON.stringify(current) === JSON.stringify(before.datasets), 'DATASETS_CHANGED_SINCE_PREFLIGHT');
    const baseline = await fingerprints(client, before.records, true);
    for (const entry of review.datasets)
      await client.query('UPDATE spatial_datasets SET archived_at=coalesce(archived_at,now()) WHERE id=$1', [entry.id]);
    preserved(baseline, await fingerprints(client, before.records, true));
    const after = await datasetPins(client);
    requireGuard(after.every(d => !pins.get(d.id)?.archived || d.archived), 'ARCHIVAL_RESTORED_HISTORY');
    requireGuard(review.datasets.every((d: {id: string}) => after.find(p => p.id === d.id)?.archived), 'ARCHIVAL_NOT_APPLIED');
    await client.query('COMMIT');
    return { reviewedCount: review.datasets.length, archivedCount: after.filter(d => d.archived).length,
      sourceAndHistoryPreserved: true, repeatedArchiveIsNoop: before.datasets.every(d => !review.datasets.some((e: {id: string}) => e.id === d.id) || d.archived) };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

async function main() {
  requireGuard(['preflight','upgrade','archive'].includes(mode || ''), 'MODE_PREFLIGHT_UPGRADE_OR_ARCHIVE_REQUIRED');
  const out = option('out'); requireGuard(!existsSync(out), 'RECEIPT_ALREADY_EXISTS');
  const environment = loadEnvironment(option('env-file'));
  const receipt: Record<string,unknown> = { version: 'serving-database/1', mode, status: 'running',
    codeCommit: codePin(), startedAt: new Date().toISOString(), mutationAttempted: false };
  const p = connection(environment.env.DATABASE_URL, mode === 'preflight');
  p.on('error', () => {});
  const client = await p.connect();
  let locked = false;
  try {
    if (mode === 'preflight') {
      receipt.snapshot = await audit(client, environment.endpoint);
      receipt.envHash = environment.envHash;
    } else {
      clean();
      const baseline = JSON.parse(readFileSync(option('preflight'),'utf8')) as { snapshot: Snapshot; envHash: string; status: string; codeCommit: string };
      requireGuard(baseline.status === 'passed' && baseline.envHash === environment.envHash, 'PREFLIGHT_OR_ENV_CHANGED');
      requireGuard(codePin() === option('expect-code') && baseline.codeCommit === codePin(), 'CODE_PIN_CHANGED');
      requireGuard(baseline.snapshot.target.token === option('expect-target'), 'TARGET_PIN_CHANGED');
      requireGuard(baseline.snapshot.readiness.schema.manifestSha256 === option('expect-manifest'), 'MANIFEST_PIN_CHANGED');
      requireGuard(options.get('maintenance-ack') === 'writers-quiesced', 'LEAD_MAINTENANCE_ACK_REQUIRED');
      requireGuard((await target(client, environment.endpoint)).token === option('expect-target'), 'LIVE_TARGET_CHANGED');
      const { schemaRequirements } = await import('@ulpin/server/infrastructure/database-readiness');
      requireGuard(schemaRequirements().manifestSha256 === option('expect-manifest'), 'LIVE_MANIFEST_CHANGED');
      locked = (await client.query("SELECT pg_try_advisory_lock(hashtextextended('ulpin-serving-upgrade',0)) AS acquired")).rows[0].acquired;
      requireGuard(locked, 'SERVING_TOOL_ALREADY_RUNNING');
      const before = await audit(client, environment.endpoint);
      safe(before); preserved(baseline.snapshot.records, await fingerprints(client, baseline.snapshot.records));
      // This is an additional observation, not a substitute for the lead quiescing writers.
      const active = Number((await client.query(`SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database()
        AND pid<>pg_backend_pid() AND backend_type='client backend' AND state<>'idle'`)).rows[0].n);
      requireGuard(!active, 'ACTIVE_DATABASE_CLIENTS');
      if (mode === 'upgrade') {
        // Inject the verified, timeout-bounded pool into the existing migration authority.
        (globalThis as unknown as {ulpinPool: typeof p}).ulpinPool = p;
        const { migrate } = await import('@ulpin/server/infrastructure/db');
        const { ensureDatasetMl } = await import('@ulpin/server/modules/datasets/dataset-ml-db');
        receipt.mutationAttempted = true;
        await migrate(); await ensureDatasetMl();
        const after = await audit(client, environment.endpoint);
        preserved(before.records, await fingerprints(client, before.records));
        safe(after); requireGuard(after.readiness.schema.ready, 'UPGRADE_SCHEMA_INCOMPLETE');
        receipt.after = after;
        receipt.preservation = 'all pre-existing rows and original bytes unchanged';
      } else {
        requireGuard(before.readiness.schema.ready, 'UPGRADE_REQUIRED_BEFORE_ARCHIVE');
        receipt.mutationAttempted = true;
        receipt.archive = await archive(client, before, option('review'));
        receipt.originalsAfter = await originalIntegrity(client);
      }
    }
    receipt.status = 'passed';
  } catch (error) {
    receipt.status = 'failed';
    // PostgreSQL/object-store messages may include stored values or credentials; never print them.
    const code = (error as {code?: string}).code;
    receipt.errorCode = code && /^[A-Z0-9_]+$/.test(code) ? code : 'GUARD_OR_PRESERVATION_FAILURE';
    receipt.recovery = receipt.mutationAttempted
      ? 'Preserve originals and volumes; inspect this receipt. Upgrade batches can commit before a later failure. Re-run a fresh read-only preflight before reviewed retry; no down migration or reset.'
      : 'No serving mutation attempted. Correct the named guard and create a new preflight receipt.';
    process.exitCode = 1;
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtextextended('ulpin-serving-upgrade',0))").catch(() => {});
    client.release(); await p.end();
    receipt.completedAt = new Date().toISOString(); writeReceipt(out, receipt);
    console.log(JSON.stringify({mode,status:receipt.status,errorCode:receipt.errorCode,receipt:out,
      mutationAttempted:receipt.mutationAttempted}));
  }
}
try { await main(); }
catch { console.error('SERVING_PREFLIGHT_CONFIGURATION_FAILED'); process.exitCode = 1; }
