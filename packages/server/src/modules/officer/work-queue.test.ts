import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { caseTableSourceIdsSql, readWorkQueue } from './work-queue';
import { IntakeService } from '../usp/ingestion/intake-service';
import { listIntakeTargets } from '../usp/ingestion/intake-targets';
import { readIntakeEvidence } from '../usp/ingestion/intake-evidence';
import { INTAKE_LARGE_STOPPED } from '../usp/ingestion/intake-large';
import type { Pool, PoolClient } from 'pg';

test('case table SQL binds retained sources to the case and table profile, newest first with no chosen winner', () => {
  const sql = caseTableSourceIdsSql.replace(/\s+/g, ' ').trim();
  assert.equal(sql, 'coalesce((SELECT jsonb_agg(s.id ORDER BY s.created_at DESC,s.id DESC) '
    + "FROM sources s WHERE s.case_id=c.id AND s.profile='tabular-manual-v1'),'[]'::jsonb)");
  assert(!sql.includes('LIMIT'));
  assert(!sql.includes('status'));
  const producer = readFileSync('packages/server/src/modules/officer/work-queue.ts', 'utf8');
  assert(producer.includes('${caseTableSourceIdsSql} "tableSourceIds"'));
  const branches = producer.split('UNION ALL');
  assert.equal(branches.length, 3);
  assert(branches[1].includes("NULL::jsonb,'[]'::jsonb"));
  assert(branches[2].includes("NULL::jsonb,'[]'::jsonb"));
});

// Isolated protocol records, based on captured public-file manifests; no operational data is created.
const id = (n: number) => `31000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const captured = JSON.parse(readFileSync('docs/evidence/gf1/lq1a/controls-second.json', 'utf8'));

async function browserNeeds() {
  const require = createRequire(resolve('apps/studio/package.json'));
  const { build } = createRequire(require.resolve('vite'))('esbuild');
  const root = 'E:/ulpin-tmp/s7-26';
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(`${root}/needs-`);
  const outfile = `${dir}/needs.mjs`;
  const built = await build({ entryPoints: ['apps/studio/src/features/intake/needs-model.ts'], outfile,
    bundle: true, write: false, platform: 'node', format: 'esm', loader: { '.css': 'empty' },
    define: { 'import.meta.env': '{}' } });
  await writeFile(outfile, built.outputFiles.find((file: { path: string }) => file.path.endsWith('.mjs')).text);
  const { batchNeeds } = await import(pathToFileURL(outfile).href);
  return { batchNeeds, clean: async () => { await rm(outfile); await rmdir(dir); } };
}

/** needs-model receives the whole package set, not just the first hundred of this batch. */
async function wholeTargets(caseId: string) {
  const page = await listIntakeTargets(caseId, undefined, undefined);
  let cursor = page.packagesNextCursor;
  while (cursor) {
    const next = await listIntakeTargets(caseId, undefined, undefined, cursor);
    page.packages.push(...next.packages);
    cursor = next.packagesNextCursor;
  }
  return page;
}

type ProtocolDb = { exec(sql: string): Promise<unknown>; query(sql: string, values?: unknown[]): Promise<unknown> };

async function protocolSchema(db: ProtocolDb) {
  await db.exec(`CREATE TABLE cases(id uuid PRIMARY KEY,name text,revision int DEFAULT 1,
    archived boolean DEFAULT false,site_id uuid,current_snapshot_id uuid,updated_at timestamptz DEFAULT now());
    CREATE TABLE sources(id uuid PRIMARY KEY,case_id uuid,family_id uuid,status text,name text,profile text,
      inspection jsonb,created_at timestamptz DEFAULT now(),revision int DEFAULT 1,bytes bigint DEFAULT 12,
      sha256 text DEFAULT repeat('b',64),object_key text DEFAULT 'protocol');
    CREATE TABLE jobs(id uuid PRIMARY KEY,case_id uuid,source_id uuid,case_revision int,status text,
      operation text,payload jsonb,error text,created_at timestamptz,completed_at timestamptz);
    CREATE TABLE import_packages(id uuid PRIMARY KEY,case_id uuid,area_id uuid,state text,body jsonb,
      revision int,created_at timestamptz);
    CREATE TABLE building_preparations(id uuid,case_id uuid,building_id uuid,package_id uuid,body jsonb);
    CREATE TABLE physical_features(id uuid,area_id uuid,body jsonb,revision int);
    CREATE TABLE map_areas(id uuid,name text,site_id uuid,archived_at timestamptz);
    CREATE TABLE registry_drafts(id uuid,case_id uuid);
    CREATE TABLE registry_reviews(draft_id uuid,committed boolean,body jsonb);
    CREATE TABLE import_package_revisions(package_id uuid,created_at timestamptz);
    CREATE TABLE spatial_datasets(id uuid,case_id uuid,name text,source_count int,
      created_at timestamptz,archived_at timestamptz);
    CREATE TABLE usp_streamed_profile_imports(case_id uuid,source_id uuid,job_id uuid,created_at timestamptz);`);
  await db.exec(readFileSync('database/sql/95-ingestion/intake-ledger.sql', 'utf8').split(
    'CREATE TABLE IF NOT EXISTS usp_holding_keys')[0]);
  await db.exec(readFileSync('database/sql/95-ingestion/intake-targets.sql', 'utf8'));
  await db.exec(readFileSync('database/sql/95-ingestion/intake-evidence.sql', 'utf8'));
}

function protocolInsert(db: ProtocolDb) {
  return async (table: string, record: Record<string, unknown>) => {
    const values = Object.values(record).map(value => value && typeof value === 'object'
      ? JSON.stringify(value) : value);
    await db.query(`INSERT INTO ${table}(${Object.keys(record).join(',')}) VALUES(${values.map(
      (_, index) => `$${index + 1}`).join(',')})`, values);
  };
}

const modulePath = process.env.S13X_PGLITE_MODULE
  ?? 'E:/ulpin-tmp/s7-26/pg-test/node_modules/@electric-sql/pglite/dist/index.js';
test('batch-wide queue steps and waiting equal the browser model over the same retained records', {
  skip: !existsSync(modulePath) && 'Set S13X_PGLITE_MODULE to the isolated PGlite module.',
}, async () => {
  const { PGlite } = await import(pathToFileURL(modulePath).href);
  const db = new PGlite();
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  const previous = globals.ulpinPool;
  const subject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'queue-protocol';
  let statements = 0, connections = 0;
  const query = async (sql: string, values: unknown[] = []) => {
    statements++;
    // PGlite does not support the transaction SET form used by the evidence read.
    if (sql.startsWith('SET TRANSACTION')) return { rows: [] };
    return db.query(sql, values);
  };
  globals.ulpinPool = { query, connect: async () => ({
    query: ++connections === 1 ? async () => ({ rows: [] }) : query, release() {},
  }) } as unknown as Pool;
  const browser = await browserNeeds();
  try {
    await protocolSchema(db);
    const insert = protocolInsert(db);
    for (let n = 1; n <= 7; n++) await insert('cases', { id: id(n), name: `protocol-${n}` });
    await insert('sources', { id: id(70), case_id: id(7), name: 'Legacy case source' });
    await insert('building_preparations', { id: id(60), case_id: id(6), building_id: id(61) });
    const addItem = async (batch: number, n: number, extra: Record<string, unknown> = {}) => {
      await insert('sources', { id: id(n), case_id: id(batch), name: captured.manifest.items[0].name,
        profile: 'geojson-manual-v1', inspection: { actor: 'queue-protocol' } });
      await insert('usp_intake_items', { item_id: id(n), source_id: id(n), case_id: id(batch),
        family: 'vector', format: 'geojson', size_bytes: 12, size_class: 'S', state: 'read', ...extra });
    };
    await addItem(2, 20, { state: 'reading' });
    await addItem(2, 21, { placement: 'needs_answer', plan_ref: { layoutQuestion: true } });
    await addItem(3, 30, { placement: 'needs_answer', plan_ref: { layoutQuestion: true }, state: 'read' });
    await addItem(3, 31, { plan_ref: { nativeLayers: { unstated: ['outline', 'road'], answers: [] } } });
    await addItem(3, 32, { placement: 'not_understood', limit_reason: INTAKE_LARGE_STOPPED });
    await addItem(3, 33, { family: 'table', format: 'csv', placement: 'needs_answer',
      card: { ...captured.manifest.items[0].card, family: 'table', format: 'csv' }, card_sha256: 'b'.repeat(64) });
    await addItem(3, 34, { family: 'image', format: 'png', plan_ref: { pageImage: {
      version: 'page-image-read/1', format: 'png', width: null, height: null, bands: null, bitDepth: null,
      orientation: null, captureTime: null, locationStated: false, dpi: null,
      preview: null, previewLimit: null, label: null } } });
    await addItem(3, 35, { family: 'document', format: 'pdf' });
    await insert('usp_intake_key_profiles', { profile_id: id(36), case_id: id(3), request_key: id(36),
      input_sha256: 'b'.repeat(64), profile_sha256: 'b'.repeat(64), version: 'exact-key/1', namespace: 'protocol key',
      key_kind: 'text', anchor_item_id: id(30), source_path: '/features/*/properties/key', subject: 'queue-protocol',
      profile: { requestKey: id(36), version: 'exact-key/1', namespace: 'protocol key', kind: 'text',
        map: { anchorItemId: id(30), sourcePath: '/features/*/properties/key' }, tables: [], documents: [id(35)] } });
    await addItem(4, 40, { plan_ref: { recipeId: id(41), recipeRevision: 1, recipeState: 'executed',
      origin: 'officer', packageId: id(42) } });
    await addItem(5, 50);
    // Only package 101 has a current review: a first-page-only summary would miss the confirmation.
    for (let n = 0; n < 101; n++) {
      await insert('import_packages', { id: id(1000 + n), state: 'REVIEWED', body: { areaId: id(43),
        revision: 2, state: 'REVIEWED', review: {
          packageRevision: n === 100 ? 2 : 1, inputFingerprint: 'b'.repeat(64), findings: [] } } });
      await insert('usp_intake_parts', { item_id: id(40), part_index: n, locator: {}, state: 'published',
        result_ref: { packageId: id(1000 + n) } });
    }
    const queue = await readWorkQueue(new URL('http://local/work-queue'));
    assert.equal(statements, 2, 'one queue read plus one batched summary read');
    assert.equal(queue.items.find(row => row.id === id(6))?.intakeSummary, null);
    assert.equal(queue.items.find(row => row.id === id(7))?.intakeSummary, null);
    const service = new IntakeService({ transaction: async action => action({ query } as unknown as PoolClient) });
    for (const [index, step] of ['Files', 'Reading', 'Your answers', 'Confirm', 'Cards'].entries()) {
      const caseId = id(index + 1);
      const manifest = await service.manifest(caseId);
      const page = await wholeTargets(caseId);
      const evidence = await readIntakeEvidence(caseId, {});
      const needs = browser.batchNeeds(manifest.items, page, evidence);
      const summary = queue.items.find(row => row.id === caseId)?.intakeSummary;
      assert.deepEqual(summary, { step: needs.steps[needs.current].name, waiting: needs.actions.length });
      assert.equal(summary?.step, step);
    }
    assert.equal(queue.items.find(row => row.id === id(3))?.intakeSummary?.waiting, 7);
    const coverage = { state: 'closed', read: 0, eligible: 0, keyless: 0, unread: 0, failed: 0 };
    await insert('jobs', { id: id(37), case_id: id(3), operation: 'intake-evidence', status: 'succeeded' });
    await insert('usp_intake_evidence_coverage', { profile_id: id(36), item_id: id(35), case_id: id(3),
      family: 'document', job_id: id(37), result_sha256: 'b'.repeat(64), state: 'closed', read_count: 0,
      eligible_count: 0, keyless_count: 0, unread_count: 0, failed_count: 0 });
    await insert('usp_intake_evidence_confirmations', { confirmation_id: id(38), case_id: id(3),
      request_key: id(38), input_sha256: 'b'.repeat(64), profile_id: id(36), profile_sha256: 'b'.repeat(64),
      additions: 'no_additions', pins: { included: [{ itemId: id(35), jobId: id(37),
        resultSha256: 'b'.repeat(64), coverage }], excluded: [], additions: { kind: 'no_additions' } },
      subject: 'queue-protocol', acknowledgement: 'Protocol confirmation',
      created_at: '2026-10-22T00:00:00Z', expires_at: '2026-10-23T00:00:00Z' });
    for (const waiting of [6, 7]) {
      const refreshed = await readWorkQueue(new URL('http://local/work-queue'));
      const manifest = await service.manifest(id(3));
      const needs = browser.batchNeeds(manifest.items, await wholeTargets(id(3)),
        await readIntakeEvidence(id(3), {}));
      assert.equal(needs.actions.length, waiting);
      assert.equal(refreshed.items.find(row => row.id === id(3))?.intakeSummary?.waiting, waiting);
      await db.exec("UPDATE usp_intake_evidence_coverage SET result_sha256=repeat('c',64)");
    }
    await insert('usp_intake_confirmations', { confirmation_id: id(80), case_id: id(4), request_key: id(80),
      input_sha256: 'b'.repeat(64), subject: 'queue-protocol', acknowledgement: 'Protocol confirmation',
      packages: [{ packageId: id(1100) }], targets: '{}', reason: 'Protocol',
      created_at: '2026-10-22T00:00:00Z', expires_at: '2026-10-23T00:00:00Z' });
    await insert('jobs', { id: id(81), case_id: id(4), operation: 'intake-run', status: 'queued',
      payload: { phase: 'commit', confirmationId: id(80) } });
    for (const [index, step] of ['Cards', 'Confirm', 'Cards'].entries()) {
      const refreshed = await readWorkQueue(new URL('http://local/work-queue'));
      const manifest = await service.manifest(id(4));
      const needs = browser.batchNeeds(manifest.items, await wholeTargets(id(4)));
      assert.deepEqual(refreshed.items.find(row => row.id === id(4))?.intakeSummary,
        { step: needs.steps[needs.current].name, waiting: needs.actions.length });
      assert.equal(needs.steps[needs.current].name, step);
      if (index === 0) await db.exec("UPDATE jobs SET status='failed'");
      if (index === 1) await db.exec(`UPDATE import_packages
        SET state='COMMITTED',body=jsonb_set(body,'{state}','"COMMITTED"') WHERE id='${id(1100)}'`);
    }
  } finally {
    globals.ulpinPool = previous;
    if (subject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = subject;
    await db.close();
    await browser.clean();
  }
});
