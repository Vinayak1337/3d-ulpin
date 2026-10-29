import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { batchStep, itemPendingKinds, itemTableSource, stoppedReason } from '@ulpin/contracts/usp';
import { caseTableSourceIdsSql, readWorkQueue } from './work-queue';
import { IntakeService } from '../usp/ingestion/intake-service';
import { listIntakeTargets } from '../usp/ingestion/intake-targets';
import { readIntakeEvidence } from '../usp/ingestion/intake-evidence';
import { INTAKE_LARGE_STOPPED } from '../usp/ingestion/intake-large';
import type { Pool, PoolClient } from 'pg';
import type { WorkQueueResult } from '../../shared/work-queue';

test('case table SQL binds retained sources to the case and table profile, newest first with no chosen winner', () => {
  const sql = caseTableSourceIdsSql.replace(/\s+/g, ' ').trim();
  assert.equal(sql, 'coalesce((SELECT jsonb_agg(s.id ORDER BY s.created_at DESC,s.id DESC) '
    + "FROM sources s WHERE s.case_id=c.id AND s.profile='tabular-manual-v1'),'[]'::jsonb)");
  assert(!sql.includes('LIMIT'));
  assert(!sql.includes('status'));
  const producer = readFileSync('packages/server/src/modules/officer/work-queue.ts', 'utf8');
  assert(producer.includes("'tableSourceIds',${caseTableSourceIdsSql}"));
  assert(producer.includes('FROM (SELECT * FROM filtered ORDER BY "updatedAt" DESC,id LIMIT $3 OFFSET $4) c)'));
  const branches = producer.slice(producer.indexOf('export async function readWorkQueue')).split('UNION ALL');
  assert.equal(branches.length, 3);
  assert(branches[1].includes("NULL::jsonb,'[]'::jsonb"));
  assert(branches[2].includes("NULL::jsonb,'[]'::jsonb"));
});

// Isolated protocol records, based on captured public-file manifests; no operational data is created.
const id = (n: number) => `31000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const captured = JSON.parse(readFileSync('docs/evidence/gf1/lq1a/controls-second.json', 'utf8'));

test('shared pending kinds and first unfinished step keep the existing answer rules', async t => {
  type Item = Parameters<typeof itemPendingKinds>[0];
  const base: Item = { ...captured.manifest.items[0], state: 'read', placement: 'on_map', plan: null,
    layoutQuestion: false };
  const table = { ...captured.manifest.items[0].card, family: 'table', format: 'csv', sheets: [] };
  const image = { version: 'page-image-read/1', format: 'png', width: null, height: null, bands: null,
    bitDepth: null, orientation: null, captureTime: null, locationStated: false, dpi: null,
    preview: null, previewLimit: null, label: null } as const;
  const rows: { name: string; items: Item[]; pending: ReturnType<typeof itemPendingKinds>;
    step: ReturnType<typeof batchStep>; answers?: number; confirmations?: number }[] = [
    { name: 'layout', items: [{ ...base, state: 'planned', placement: 'needs_answer', layoutQuestion: true }],
      pending: [{ kind: 'layout' }], step: 'Your answers' },
    { name: 'each unanswered layer', items: [{ ...base, layerCrs: [{ layer: 'outline', answer: null },
      { layer: 'road', answer: null }, { layer: 'answered', answer: {
        crs: 'EPSG:4326', state: 'officer_stated', statedAt: captured.manifest.items[0].updatedAt } }] }],
      pending: [{ kind: 'layer_crs', layer: 'outline' }, { kind: 'layer_crs', layer: 'road' }], step: 'Your answers' },
    { name: 'page image', items: [{ ...base, pageImage: image }],
      pending: [{ kind: 'page_image' }], step: 'Your answers' },
    { name: 'table placement', items: [{ ...base, family: 'table', placement: 'needs_answer', card: table }],
      pending: [{ kind: 'table_placement' }], step: 'Your answers' },
    { name: 'retry', items: [{ ...base, placement: 'not_understood', limitReason: stoppedReason }],
      pending: [{ kind: 'retry' }], step: 'Your answers' },
    { name: 'Files wins even with counts', items: [], pending: [], step: 'Files', answers: 1, confirmations: 1 },
    ...(['received', 'probed', 'reading', 'preparing'] as const).map(state => ({
      name: `${state} before answers and confirmation`, items: [{ ...base, state }], pending: [],
      step: 'Reading' as const, answers: 1, confirmations: 1 })),
    { name: 'evidence answers before confirmation', items: [base], pending: [],
      step: 'Your answers', answers: 1, confirmations: 1 },
    { name: 'Confirm', items: [base], pending: [], step: 'Confirm', confirmations: 1 },
    { name: 'Cards', items: [base], pending: [], step: 'Cards' },
    { name: 'no source layout or retry', items: [{ ...base, sourceId: null, placement: 'needs_answer',
      layoutQuestion: true }, { ...base, sourceId: null, placement: 'not_understood', limitReason: stoppedReason }],
      pending: [], step: 'Cards' },
    { name: 'answered image', items: [{ ...base, pageImage: { ...image, label: { value: 'plan',
      state: 'candidate', answeredAt: captured.manifest.items[0].updatedAt } } }], pending: [], step: 'Cards' },
    { name: 'unretained table member', items: [{ ...base, family: 'table', placement: 'needs_answer',
      sourceId: null, card: table }], pending: [], step: 'Cards' },
    { name: 'other stop reason', items: [{ ...base, placement: 'not_understood', limitReason: null }],
      pending: [], step: 'Cards' },
  ];
  for (const row of rows) await t.test(row.name, () => {
    const pending = row.items.flatMap(item => itemPendingKinds(item, row.items));
    assert.deepEqual(pending, row.pending);
    assert.equal(batchStep({ items: row.items, answers: row.answers ?? pending.length,
      confirmations: row.confirmations ?? 0 }), row.step);
  });
  const sheet = { ...base, sourceId: null, parentItemId: base.itemId, family: 'table' as const,
    placement: 'needs_answer' as const, card: table };
  for (const format of ['xlsx', 'ods']) {
    const parent = { ...base, card: { ...table, format } };
    assert.deepEqual(itemPendingKinds(sheet, [parent, sheet]), [{ kind: 'table_placement' }]);
  }
  assert.equal(itemTableSource({ ...sheet, sourceId: base.sourceId, card: { ...table, format: 'tsv' } }, [])?.format,
    'csv');
});

async function browserNeeds() {
  const require = createRequire(resolve('apps/studio/package.json'));
  const { build } = createRequire(require.resolve('vite'))('esbuild');
  const root = 'E:/ulpin-tmp/s7-20b';
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
  ?? 'E:/ulpin-tmp/s7-20a/pg-test/node_modules/@electric-sql/pglite/dist/index.js';
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
  let summaryIds: string[] = [];
  const query = async (sql: string, values: unknown[] = []) => {
    statements++;
    if (sql.includes('streamed_profile_job_id')) summaryIds = values[0] as string[];
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
    for (const n of [71, 72]) await insert('sources', { id: id(n), case_id: id(7), name: 'Retained table',
      profile: 'tabular-manual-v1', created_at: '2026-10-01T00:00:00Z' });
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
    assert.equal(statements, 3, 'queue, light stamps and one batched summary read');
    const assertDot = async (queue: WorkQueueResult) => {
      const oldCount = queue.items.filter(row => row.intakeSummary && row.intakeSummary.waiting > 0).length;
      assert.equal(queue.waitingBatches, oldCount, 'dot equals the former full-summary count');
      globals.ulpinPool = { ...globals.ulpinPool! } as Pool;
      const offPage = await readWorkQueue(new URL('http://local/work-queue?q=no-match'));
      assert.equal(offPage.items.length, 0);
      assert.equal(offPage.waitingBatches, oldCount, 'cold counts agree without any visible summaries');
    };
    assert.equal(queue.waitingBatches, 3);
    await assertDot(queue);
    assert.equal(queue.items.find(row => row.id === id(6))?.intakeSummary, null);
    assert.equal(queue.items.find(row => row.id === id(7))?.intakeSummary, null);
    assert.equal(queue.items.find(row => row.id === id(7))?.sourceCount, 3);
    assert.deepEqual(queue.items.find(row => row.id === id(7))?.tableSourceIds, [id(72), id(71)]);
    const service = new IntakeService({ transaction: async action => action({ query } as unknown as PoolClient) });
    for (const [index, step] of ['Files', 'Reading', 'Your answers', 'Confirm', 'Cards'].entries()) {
      const caseId = id(index + 1);
      const manifest = await service.manifest(caseId);
      const page = await wholeTargets(caseId);
      const evidence = await readIntakeEvidence(caseId, {});
      const needs = browser.batchNeeds(manifest.items, page, evidence);
      const summary = queue.items.find(row => row.id === caseId)?.intakeSummary;
      if (index === 2) assert.deepEqual(manifest.items.flatMap(item => itemPendingKinds(item, manifest.items))
        .map(pending => pending.kind).sort(), ['layer_crs', 'layer_crs', 'layout', 'page_image', 'retry',
          'table_placement']);
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
      await assertDot(refreshed);
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
      await assertDot(refreshed);
      if (index === 0) await db.exec("UPDATE jobs SET status='failed'");
      if (index === 1) await db.exec(`UPDATE import_packages
        SET state='COMMITTED',body=jsonb_set(body,'{state}','"COMMITTED"') WHERE id='${id(1100)}'`);
    }
    await insert('usp_streamed_profile_imports', { case_id: id(3), source_id: id(30), job_id: id(37) });
    await insert('usp_intake_targets', { target_id: id(90), case_id: id(4), anchor_item_id: id(40),
      package_id: id(1100), feature_id: id(91), locator: 'feature 0', kind: 'building', stage: 1, readiness: 'ready' });
    await insert('usp_intake_evidence_candidates', { candidate_id: id(92), case_id: id(3), profile_id: id(36),
      item_id: id(35), operation_key: id(92), evidence_kind: 'document_part', key_literal: 'protocol',
      outcome: 'matched', target_ids: `{${id(91)}}`, candidate: { anchors: [{}] }, candidate_sha256: 'b'.repeat(64) });
    const beforeParts = (await readWorkQueue(new URL('http://local/work-queue'))).waitingBatches;
    for (const [sql, step] of [
      [`UPDATE import_packages SET body=jsonb_set(body,'{state}','"REVIEWED"') WHERE id='${id(1100)}'`,
        'Confirm'],
      [`UPDATE usp_intake_targets SET readiness='held' WHERE target_id='${id(90)}'`, 'Cards'],
      [`UPDATE usp_intake_targets SET readiness='ready' WHERE target_id='${id(90)}'`, 'Confirm'],
      [`DELETE FROM usp_intake_targets WHERE target_id='${id(90)}'`, 'Confirm'],
      [`UPDATE usp_intake_parts SET state='quarantined' WHERE item_id='${id(40)}' AND part_index=100`, 'Cards'],
      [`UPDATE usp_intake_parts SET state='published' WHERE item_id='${id(40)}' AND part_index=100`, 'Confirm'],
    ]) {
      await db.exec(sql);
      summaryIds = [];
      const changed = await readWorkQueue(new URL('http://local/work-queue'));
      assert.equal(changed.items.find(row => row.id === id(4))?.intakeSummary?.step, step, sql);
      assert.deepEqual(summaryIds, [id(4)], 'a part or target write refreshes only its case');
      assert.equal(changed.waitingBatches, beforeParts + Number(step === 'Confirm'));
    }
    await insert('usp_intake_targets', { target_id: id(90), case_id: id(4), anchor_item_id: id(40),
      package_id: id(1100), feature_id: id(91), locator: 'feature 0', kind: 'building', stage: 1, readiness: 'ready' });
    const hidden = new URL('http://local/work-queue?q=no-match');
    const baseline = await readWorkQueue(hidden);
    // In-place writes must invalidate even when counts, keys, revisions and application timestamps stay fixed.
    for (const [table, key, batch] of [
      ['cases', 'id', 3], ['sources', 'id', 3], ['building_preparations', 'id', 6],
      ['usp_streamed_profile_imports', 'job_id', 3], ['usp_intake_items', 'item_id', 3],
      ['usp_intake_parts', 'part_index', 4], ['import_packages', 'id', 4], ['usp_intake_targets', 'target_id', 4],
      ['usp_intake_key_profiles', 'profile_id', 3], ['usp_intake_evidence_coverage', 'item_id', 3],
      ['usp_intake_evidence_candidates', 'candidate_id', 3],
      ['usp_intake_evidence_confirmations', 'confirmation_id', 3],
      ['usp_intake_confirmations', 'confirmation_id', 4], ['jobs', 'id', 3],
    ] as const) {
      const where = table === 'cases' ? `id='${id(batch)}'` : `case_id='${id(batch)}'`;
      let scope = where;
      if (table === 'usp_intake_parts') scope = `item_id='${id(40)}'`;
      if (table === 'import_packages') scope = `id='${id(1100)}'`;
      await db.exec(`UPDATE ${table} SET ${key}=${key} WHERE ${scope}`);
      summaryIds = [];
      assert.equal((await readWorkQueue(hidden)).waitingBatches, baseline.waitingBatches, table);
      assert.deepEqual(summaryIds, [id(batch)], table);
    }
  } finally {
    globals.ulpinPool = previous;
    if (subject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = subject;
    await db.close();
    await browser.clean();
  }
});

test('drop-size stamps preserve summaries and invalidate only the changed case', {
  timeout: 120000,
  skip: !existsSync(modulePath) && 'Set S13X_PGLITE_MODULE to the isolated PGlite module.',
}, async () => {
  const { PGlite } = await import(pathToFileURL(modulePath).href);
  const db = new PGlite();
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  const previous = globals.ulpinPool;
  let reads: { sql: string; values: unknown[] }[] = [];
  globals.ulpinPool = { query: async (sql: string, values: unknown[]) => {
    reads.push({ sql, values });
    return db.query(sql, values);
  }, connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) } as unknown as Pool;
  try {
    await protocolSchema(db);
    const insert = protocolInsert(db);
    for (let n = 1; n <= 20; n++) await insert('cases', { id: id(n), name: `drop-${n}` });
    await insert('sources', { id: id(21), case_id: id(1), name: captured.manifest.items[0].name });
    await insert('usp_intake_items', { item_id: id(21), source_id: id(21), case_id: id(1),
      family: 'vector', format: 'geojson', size_bytes: 12, size_class: 'S', state: 'reading' });
    await db.exec(`CREATE INDEX import_packages_case_idx ON import_packages(case_id);
      INSERT INTO import_packages(id,case_id,state,body)
      SELECT ('31000000-0000-4000-8000-'||lpad((1000+n)::text,12,'0'))::uuid,'${id(1)}','REVIEWED',
        '{"sourceWorkspace":{},"state":"REVIEWED","revision":1,
          "review":{"packageRevision":1,"inputFingerprint":"retained"}}'
      FROM generate_series(0,499) n;
      INSERT INTO usp_intake_parts(item_id,part_index,locator,state,result_ref)
      SELECT '${id(21)}',n,'{}','published',jsonb_build_object('packageId',
        '31000000-0000-4000-8000-'||lpad((1000+n%500)::text,12,'0')) FROM generate_series(0,19999) n;
      INSERT INTO jobs(id,case_id,operation,status,created_at)
      SELECT ('31000000-0000-4000-8000-'||lpad((2000+n)::text,12,'0'))::uuid,
        '${id(1)}','intake-large',CASE WHEN n=4999 THEN 'running' ELSE 'succeeded' END,now()
      FROM generate_series(0,4999) n;
      ANALYZE;`);
    const samples: Record<string, number[]> = { first: [], repeat: [], changed: [], otherCase: [] };
    let stampRead: typeof reads[number] | undefined;
    for (let run = 0; run < 5; run++) {
      globals.ulpinPool = { ...globals.ulpinPool! } as Pool;
      let baseline: WorkQueueResult | undefined;
      for (const phase of ['first', 'repeat', 'changed', 'otherCase']) {
        if (phase === 'changed') await db.exec(`UPDATE usp_intake_items SET state='read'
          WHERE item_id='${id(21)}'`);
        if (phase === 'otherCase') await db.exec(`UPDATE cases SET name=name WHERE id='${id(20)}'`);
        reads = [];
        const started = performance.now();
        const queue = await readWorkQueue(new URL('http://local/work-queue'));
        samples[phase].push(+(performance.now() - started).toFixed(3));
        assert.equal(queue.total, 20);
        assert.equal(queue.waitingBatches, 1);
        assert.deepEqual(queue.items.find(row => row.id === id(1))?.intakeSummary,
          { step: ['changed', 'otherCase'].includes(phase) ? 'Confirm' : 'Reading', waiting: 1 });
        const summary = reads.find(row => row.sql.includes('streamed_profile_job_id'));
        if (phase === 'first') stampRead = reads[1];
        if (phase === 'repeat') {
          assert.deepEqual(queue, baseline);
          assert.equal(summary, undefined);
          assert.equal(reads.length, 1, 'unchanged visibility skips the row stamp entirely');
        }
        if (phase === 'changed') assert.deepEqual(summary?.values[0], [id(1)]);
        if (phase === 'otherCase') assert.deepEqual(summary?.values[0], [id(20)]);
        baseline = queue;
      }
      await db.exec(`UPDATE usp_intake_items SET state='reading' WHERE item_id='${id(21)}'`);
    }
    const plan = await db.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${stampRead!.sql}`,
      stampRead!.values);
    console.log(JSON.stringify({ dropSize: process.env.QUEUE_COST ?? 'test', cases: 20, parts: 20000,
      jobs: 5000, packages: 500, samples, stampExecutionMs: plan.rows[0]['QUERY PLAN'][0]['Execution Time'] }));
    if (process.env.QUEUE_COST) {
      const root = 'E:/ulpin-tmp/s7-20b';
      await mkdir(root, { recursive: true });
      await writeFile(`${root}/${process.env.QUEUE_COST}-cost.json`,
        JSON.stringify({ samples, plan: plan.rows }, null, 2));
    }
  } finally {
    globals.ulpinPool = previous;
    await db.close();
  }
});

for (const caseCount of [21, 200]) test(`waiting batch cache spans ${caseCount} cases, pages and filters`, {
  timeout: 30000,
  skip: !existsSync(modulePath) && 'Set S13X_PGLITE_MODULE to the isolated PGlite module.',
}, async () => {
  const { PGlite } = await import(pathToFileURL(modulePath).href);
  const db = new PGlite();
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  const previous = globals.ulpinPool;
  let statements = 0;
  let returnedRows = 0;
  let reads: { sql: string; values: unknown[] }[] = [];
  let summaryIds: string[] = [];
  let afterSummary: (() => Promise<void>) | undefined;
  let afterQueue: (() => Promise<void>) | undefined;
  globals.ulpinPool = { query: async (sql: string, values: unknown[]) => {
    statements++;
    reads.push({ sql, values });
    if (sql.includes('streamed_profile_job_id')) summaryIds = values[0] as string[];
    const result = await db.query(sql, values);
    returnedRows += result.rows.length;
    if (sql.includes('pg_current_snapshot()') && afterQueue) {
      const pause = afterQueue;
      afterQueue = undefined;
      await pause();
    }
    if (sql.includes('streamed_profile_job_id') && afterSummary) {
      const pause = afterSummary;
      afterSummary = undefined;
      await pause();
    }
    return result;
  }, connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) } as unknown as Pool;
  try {
    await protocolSchema(db);
    const insert = protocolInsert(db);
    const waitingCase = Math.max(1, caseCount - 40);
    for (let n = 1; n <= caseCount; n++) {
      await insert('cases', { id: id(n), name: `protocol-${n}`,
        updated_at: new Date(Date.UTC(2026, 9, 1) + n * 1000).toISOString() });
      if (caseCount === 21 && n !== waitingCase) continue;
      await insert('sources', { id: id(1000 + n), case_id: id(n), name: captured.manifest.items[0].name });
      await insert('usp_intake_items', { item_id: id(1000 + n), source_id: id(1000 + n), case_id: id(n),
        family: 'vector', format: 'geojson', size_bytes: 12, size_class: 'S', state: 'read',
        placement: n === waitingCase ? 'needs_answer' : 'on_map', plan_ref: { layoutQuestion: true } });
    }
    if (process.env.QUEUE_COST) {
      const samples: Record<string, unknown[]> = { first: [], repeat: [], changed: [] };
      let repeatReads: typeof reads = [];
      const warmPool = globals.ulpinPool!;
      for (let run = -1; run < 5; run++) {
        globals.ulpinPool = { ...warmPool } as Pool;
        for (const phase of ['first', 'repeat', 'changed']) {
          if (phase === 'changed') await db.exec(`UPDATE usp_intake_items SET placement='on_map'
            WHERE case_id='${id(waitingCase)}'`);
          statements = 0;
          returnedRows = 0;
          summaryIds = [];
          reads = [];
          const started = performance.now();
          const measured = await readWorkQueue(new URL('http://local/work-queue?page=1'));
          const ms = performance.now() - started;
          assert.equal(measured.waitingBatches, phase === 'changed' ? 0 : 1);
          if (phase === 'repeat') repeatReads = reads;
          if (run >= 0) samples[phase].push({ ms: +ms.toFixed(3), statements, returnedRows,
            metadataCases: summaryIds.length });
        }
        await db.exec(`UPDATE usp_intake_items SET placement='needs_answer' WHERE case_id='${id(waitingCase)}'`);
      }
      // Explain separately: instrumentation must not enter the measured poll.
      let scannedRows = 0;
      const scans: Record<string, number> = {};
      type ScanPlan = { 'Relation Name'?: string; 'Actual Rows': number; 'Actual Loops': number;
        'Rows Removed by Filter'?: number; Plans?: ScanPlan[] };
      const countScans = (plan: ScanPlan) => {
        const name = plan['Relation Name'];
        if (name) {
          const rows = (plan['Actual Rows'] + (plan['Rows Removed by Filter'] ?? 0)) * plan['Actual Loops'];
          scannedRows += rows;
          scans[name] = (scans[name] ?? 0) + rows;
        }
        for (const child of plan.Plans ?? []) countScans(child);
      };
      for (const { sql, values } of repeatReads) {
        const explained = await db.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, values);
        countScans(explained.rows[0]['QUERY PLAN'][0].Plan);
      }
      console.log(JSON.stringify({ cost: process.env.QUEUE_COST, cases: caseCount, samples,
        repeatRelationRowsVisited: scannedRows, scans }));
      globals.ulpinPool = { ...warmPool } as Pool;
    }
    const timings: number[] = [];
    for (const [index, params] of ['page=1', 'page=1', 'page=2', 'page=3', `q=protocol-${caseCount}`,
      'q=no-match', 'status=recorded', 'status=processing'].entries()) {
      statements = 0;
      summaryIds = [];
      const started = performance.now();
      const queue = await readWorkQueue(new URL(`http://local/work-queue?${params}`));
      timings.push(performance.now() - started);
      assert.equal(queue.waitingBatches, 1, params);
      assert.equal(statements, index === 0 ? 3 : 1 + Number(queue.items.length > 0 && index !== 1));
      const expectedIds = index === 0 ? Array.from({ length: caseCount }, (_, n) => id(n + 1))
        : queue.items.filter(() => index !== 1).map(item => item.id);
      assert.deepEqual([...summaryIds].sort(), expectedIds.sort());
      if (params === 'page=1') assert(!queue.items.some(item => item.id === id(waitingCase)));
      if (caseCount === 200 && params === 'page=3') assert.equal(queue.items[0].id, id(waitingCase));
      if (caseCount === 21 && params === 'page=2') assert.equal(queue.items[0].id, id(waitingCase));
    }
    await db.exec(`UPDATE usp_intake_items SET placement='on_map',updated_at=now()
      WHERE case_id='${id(waitingCase)}'`);
    const changed = await readWorkQueue(new URL('http://local/work-queue?page=1'));
    assert.equal(changed.waitingBatches, 0, 'off-page item answer invalidates the global count');
    assert.deepEqual([...summaryIds].sort(), [...changed.items.map(item => item.id), id(waitingCase)].sort());
    await db.exec(`UPDATE usp_intake_items SET placement='needs_answer' WHERE case_id='${id(waitingCase)}'`);
    summaryIds = [];
    assert.equal((await readWorkQueue(new URL('http://local/work-queue?page=1'))).waitingBatches, 1);
    assert.deepEqual(summaryIds, [id(waitingCase)], 'only the changed case is read, not the unchanged page');
    statements = 0;
    summaryIds = [];
    assert.equal((await readWorkQueue(new URL('http://local/work-queue?page=1'))).waitingBatches, 1);
    assert.equal(statements, 1, 'unchanged visibility needs only the queue query');
    assert.deepEqual(summaryIds, []);
    afterQueue = async () => {
      await db.exec(`UPDATE usp_intake_items SET placement='on_map' WHERE case_id='${id(waitingCase)}'`);
    };
    assert.equal((await readWorkQueue(new URL('http://local/work-queue?page=1'))).waitingBatches, 1,
      'a write after the visibility read may wait for the next poll');
    summaryIds = [];
    assert.equal((await readWorkQueue(new URL('http://local/work-queue?page=1'))).waitingBatches, 0);
    assert.deepEqual(summaryIds, [id(waitingCase)], 'the next visibility read detects the concurrent commit');
    await db.exec(`UPDATE usp_intake_items SET placement='needs_answer' WHERE case_id='${id(waitingCase)}'`);
    globals.ulpinPool = { ...globals.ulpinPool! } as Pool;
    afterQueue = async () => {
      await db.exec(`UPDATE usp_intake_items SET placement='on_map' WHERE case_id='${id(waitingCase)}'`);
    };
    assert.equal((await readWorkQueue(new URL('http://local/work-queue?page=1'))).waitingBatches, 0,
      'cold stamps may see a commit newer than their queue visibility');
    statements = 0;
    summaryIds = [];
    assert.equal((await readWorkQueue(new URL('http://local/work-queue?page=1'))).waitingBatches, 0);
    assert.equal(statements, 2, 'the next poll rechecks full stamps instead of caching a later visibility token');
    assert.deepEqual(summaryIds, [], 'already-current metadata need not refold');
    await db.exec(`UPDATE usp_intake_items SET placement='needs_answer' WHERE case_id='${id(waitingCase)}'`);
    assert.equal((await readWorkQueue(new URL('http://local/work-queue?q=no-match'))).waitingBatches, 1);
    console.log(JSON.stringify({ cases: caseCount, items: caseCount === 21 ? 1 : caseCount,
      firstMs: +timings[0].toFixed(1), repeatMs: +timings[1].toFixed(1), repeatSummaryCases: 0 }));
    // A later answer may evict a case while an earlier call is still awaiting its page/changed summaries.
    let release!: () => void;
    let arrived!: () => void;
    const paused = new Promise<void>(resolve => { arrived = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    afterSummary = async () => {
      arrived();
      await resume;
    };
    await db.exec(`UPDATE cases SET name=name WHERE id='${id(caseCount)}'`);
    const overlapping = readWorkQueue(new URL('http://local/work-queue?q=no-match'));
    await paused;
    try {
      await db.exec(`UPDATE cases SET archived=true WHERE id='${id(waitingCase)}'`);
      assert.equal((await readWorkQueue(new URL('http://local/work-queue?q=no-match'))).waitingBatches, 0);
    } finally { release(); }
    assert.equal((await overlapping).waitingBatches, 1, 'each call retains its own cache snapshot');
    await db.exec(`UPDATE cases SET archived=false WHERE id='${id(waitingCase)}'`);
    assert.equal((await readWorkQueue(new URL('http://local/work-queue'))).waitingBatches, 1);
    await insert('spatial_datasets', { id: id(9999), case_id: id(waitingCase), name: 'Saved protocol map',
      source_count: 1, created_at: '2026-11-01T00:00:00Z' });
    const dataset = await readWorkQueue(new URL('http://local/work-queue'));
    assert.equal(dataset.waitingBatches, 0, 'a dataset case never contributes a waiting batch');
    assert(!dataset.items.some(row => row.kind === 'case' && row.id === id(waitingCase)));
    assert.equal(dataset.items.find(row => row.kind === 'dataset')?.intakeSummary, null);
  } finally {
    globals.ulpinPool = previous;
    await db.close();
  }
});
