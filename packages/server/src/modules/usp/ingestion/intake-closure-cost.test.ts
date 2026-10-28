import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { unfinishedIntakePackagesTx } from './intake-ledger';
import { sql } from '../../../infrastructure/sql-loader';
import { AppError } from '../../../infrastructure/errors';
import { partStageTimer } from './proved-area-part';

/** Run production bodies with controlled I/O; keep the cut loop, stale guards and completion unchanged. */
function isolated(file: string, controls: Record<string, any>, tail: string) {
  const source = readFileSync(`packages/server/src/modules/usp/${file}.ts`, 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  } }).outputText.replace(/^import \{([^}]+)\} from ["'][^"']+["'];/gm,
    (_, names) => `const {${names.replace(/\s+as\s+/g, ':')}} = controls;`).replaceAll('export ', '');
  return new Function('controls', js + tail)(new Proxy({ partStageTimer,
    readObservedIntakeCut: async () => ({}), ...controls }, {
    get: (target, key) => key in target ? Reflect.get(target, key) : function () {},
  }));
}

test('several cuts queue only at completion; stale dispatch does no fold', async () => {
  let parts = 0, queued = 0, folded = 0, phases = 0;
  const state = () => ({ key: String(parts), item: {}, store: { parts, unreviewed: parts + 5 } });
  const fold = { cutKey: '0', held: {}, pending: [], frame: {}, firstChunk: 0, chunks: 1,
    complete: true, started: Date.now() };
  const controls = {
    transaction: (work: any) => work({ query: async () => ({ rows: [{ status: 'queued' }], rowCount: 0 }) }),
    largeStateKey: async () => state(), intakeLargeCutKey: (store: any) => String(store.parts),
    intakeLargeAtRest: () => false, intakeLargeRows: () => ({}),
    intakeLargeStepCurrent: (state: any, input: any) => state.key === input.stateKey,
    intakeLargePhase: () => { phases++; return 'draft'; },
    retiredFileAreaWords: async () => null,
    USP_JOB_LIMITS: { heartbeatSeconds: 60 },
    draftIntakePartTx: async () => { folded++; parts++; },
    queueIntakeLargeTx: async () => { queued++; },
    acceptUspJobAttempt: async (_a: any, _r: any, _v: any, _g: any, apply: any) => apply({}),
    IntakePackageCutter: class {
      consume() { return { cut: {} }; }
      close() { return undefined; }
    },
    INTAKE_UNFINISHED_PACKAGE_LIMIT: 8,
    fold,
  };
  const worker = isolated('ingestion/intake-large-worker', controls, `
    foldContext = async () => controls.fold;
    pairedChunk = async () => [1, 2, 3];
    rawFeatures = async () => [];
    heldThrough = () => ({});
    writeEndTx = async () => { throw new Error('pressure should pause before EOF'); };
    publishTx = async () => {};
    return { draft, complete, prepareReaders, step };`);
  const input = { stateKey: '0' };
  await worker.draft(input, {});
  assert.deepEqual([parts, folded, queued], [3, 3, 0]);
  await worker.complete(input, {}, true);
  assert.equal(queued, 1);
  // Admission may inspect current authority; the stale input still never folds.
  assert.equal(await worker.prepareReaders(input), true);
  await worker.step(input, {});
  assert.deepEqual([folded, queued, phases], [3, 2, 1]);
});

test('two wake keys share one live item attempt, so the second does no raw work or stale cut', async context => {
  const db = process.env.S13X_PGLITE_MODULE
    ? new (await import(process.env.S13X_PGLITE_MODULE)).PGlite() : null;
  context.after(async () => { await db?.close(); });
  await db?.exec(`CREATE TABLE jobs(id text,source_id text,operation text);
    CREATE TABLE usp_job_attempts(job_id text,state text,lease_until timestamptz);
    INSERT INTO jobs VALUES('wake-a','same-file','intake-large'),('wake-b','same-file','intake-large'),
      ('expired','same-file','intake-large');
    INSERT INTO usp_job_attempts VALUES('expired','active',now()-interval '1 second');`);
  let active = '', parts = 0, reads = 0, stale = 0, queued = 0;
  let entered!: () => void, release!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const client = { query: async (sql: string, values: string[] = []) => {
    if (sql.startsWith('SELECT status FROM jobs')) return { rows: [{ status: 'queued' }], rowCount: 1 };
    if (sql.startsWith('SELECT 1 FROM usp_job_attempts a JOIN jobs')) {
      if (db) {
        const result = await db.query(sql, values);
        return { ...result, rowCount: result.rows.length };
      }
      return { rows: [], rowCount: active && active !== values[1] ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  } };
  const worker = isolated('ingestion/intake-large-worker', {
    AppError, randomUUID: () => 'test_only', IntakeLargeInputSchema: { parse: (value: any) => value },
    query: async (_sql: string, [id]: string[]) => ({ rows: [{ status: 'queued', payload: {
      jobId: id, sourceId: 'same-file', stateKey: '0' } }] }),
    transaction: (work: any) => work(client), assertIntakeDraftTx: async () => {},
    claimUspJobAttempt: async (id: string, _owner: string, guard: any) => {
      await guard(client);
      active = id;
      await db?.query("INSERT INTO usp_job_attempts VALUES($1,'active',now()+interval '180 seconds')", [id]);
      return { jobId: id };
    },
    largeStateKey: async () => ({ key: '0', item: {}, store: { parts, unreviewed: 0 } }),
    intakeLargeCutKey: (store: any) => String(store.parts), intakeLargeAtRest: () => false,
    intakeLargeStepCurrent: (state: any, input: any) => state.key === input.stateKey,
    intakeLargePhase: () => 'draft', retiredFileAreaWords: async () => null,
    INTAKE_UNFINISHED_PACKAGE_LIMIT: 8, USP_JOB_LIMITS: { heartbeatSeconds: 30 },
    draftIntakePartTx: async () => { parts++; },
    queueIntakeLargeTx: async () => { queued++; },
    acceptUspJobAttempt: async (_a: any, _r: any, _v: any, _g: any, apply: any) => {
      await apply(client); active = '';
      await db?.exec("UPDATE usp_job_attempts SET state='accepted'");
    },
    IntakePackageCutter: class { consume() { return {}; } close() { return { index: 0 }; } },
    context: () => ({ frame: {}, firstChunk: 0, chunks: 1, complete: true,
      started: Date.now(), cutKey: String(parts),
      pending: [], held: {}, part: {} }),
    chunk: async () => { if (++reads === 1) { entered(); await hold; } return [1]; },
    log: (line: string) => { if (JSON.parse(line).outcome === 'stale') stale++; },
  }, `
    const console = { info: controls.log };
    foldContext = async () => controls.context();
    pairedChunk = controls.chunk;
    rawFeatures = async () => [];
    heldThrough = () => ({});
    writeEndTx = async () => {};
    publishTx = async () => {};
    return runIntakeLargeJob;`);
  const first = worker('wake-a');
  await reading;
  await worker('wake-b');
  release();
  await first;
  assert.deepEqual({ reads, parts, stale, queued }, { reads: 1, parts: 1, stale: 0, queued: 1 });
});

test('fencing fills an absent cause atomically and preserves recorded diagnostics', async () => {
  const errors = [new AppError(409, 'STALE_REVISION', 'The retained intake source changed.'),
    new Error('Private path and record detail must not be saved.'),
    new AppError(422, 'AREA_PROCESSING', 'Processor detail with private source values must not be saved.')];
  for (const error of errors) for (const number of [1, 3]) {
    for (const prior of [null, { message: 'Existing safe diagnostic.' }]) {
      let saved: unknown, fenced = false;
      const worker = isolated('ingestion/intake-large-worker', {
        AppError, USP_JOB_LIMITS: { maxAttempts: 3 }, intakeLargePartRefusal: () => null,
        transaction: (work: any) => work({ query: async (sql: string, values: unknown[]) => {
          if (sql.includes("SET state='fenced'")) {
            assert.match(sql, /failure_cause=COALESCE\(failure_cause,\$3\)/);
            saved = prior ?? values[2];
            fenced = true;
          }
          return { rows: [] };
        } }),
      }, '\nstopItemTx = async () => {}; return fail;');
      await worker({ jobId: 'test_only' }, { number }, error);
      assert(fenced);
      assert.deepEqual(saved, prior ?? {
        errorCode: error instanceof AppError ? error.code : 'INTAKE_LARGE_STEP_FAILED',
        message: error instanceof AppError && error.code !== 'AREA_PROCESSING'
          ? error.message : 'Error detail withheld.',
      });
    }
  }
});

test('a committed cut emits one numeric stage receipt without source values', async () => {
  const lines: string[] = [];
  const info = console.info;
  const state = { store: { parts: 1, unreviewed: 0 } };
  const worker = isolated('ingestion/intake-large-worker', {
    transaction: (work: any) => work({}), largeStateKey: async () => state,
    intakeLargeCutKey: () => 'same-cut', INTAKE_UNFINISHED_PACKAGE_LIMIT: 8,
    draftIntakePartTx: async () => {},
  }, `
    rawFeatures = async (_fold, _cut, timing) => {
      timing('rawRangeRequests', 1); timing('rawRangeBytes', 17); return [];
    };
    heldThrough = () => ({});
    return draftCut;`);
  console.info = line => { lines.push(line); };
  try {
    assert.equal(await worker({ jobId: 'protocol-job', itemId: 'protocol-item' }, {},
      { cutKey: 'same-cut', part: {}, chunkReadMs: 12, chunkReads: 1 }, { index: 1 }, false), 'more');
  } finally { console.info = info; }
  assert.equal(lines.length, 1);
  const receipt = JSON.parse(lines[0]);
  assert.equal(receipt.event, 'intake_large_cut');
  assert.equal(receipt.pairedChunkMs, 12);
  assert.equal(receipt.pairedChunks, 1);
  assert.equal(receipt.stages.rawRangeRequests, 1);
  assert.equal(receipt.stages.rawRangeBytes, 17);
  for (const stage of ['rawFeatures', 'transactionWaitBegin', 'lockFence', 'pinnedStateRead',
    'transactionWork', 'draftIntakePartTx', 'largeStateKeyAfter', 'commitRelease']) {
    assert.ok(Number.isFinite(receipt.stages[stage]) && receipt.stages[stage] >= 0, stage);
  }
  assert.doesNotMatch(lines[0], /rawBytes|objectKey|geometry|properties|sourceSha256/);
});

test('intake-run review success and refusal both retain their independent package wake-up', async () => {
  for (const refused of [false, true]) {
    const wakes: string[] = [];
    const module = isolated('ingestion/intake-run-worker', {
      queueIntakeLargePackageTx: async (_client: any, id: string) => { wakes.push(id); },
      AppError,
    }, '\npinned = async (_run, work) => work({}); return { prepare };');
    const pkg = { id: 'test_only', revision: 1 };
    const run = { input: { caseId: 'test_only' }, steps: {
      package: async () => pkg,
      review: async () => { if (refused) throw new AppError(422, 'REFUSED', 'Protocol refusal.'); },
    } };
    await module.prepare(run, pkg.id);
    assert.deepEqual(wakes, [pkg.id]);
  }
});

test('generated review flag stays exact across revision-moving review, invalidation and commit', {
  skip: !process.env.S13X_PGLITE_MODULE,
}, async () => {
  const { PGlite } = await import(process.env.S13X_PGLITE_MODULE!);
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE import_packages(id uuid PRIMARY KEY,state text,body jsonb);'
      + 'CREATE TABLE usp_intake_parts(item_id uuid,state text,result_ref jsonb);');
    await db.exec(sql('usp.import-package-review.schema'));
    await db.exec(sql('usp.import-package-review.schema'));
    const id = '11111111-1111-4111-8111-111111111111';
    await db.query("INSERT INTO import_packages(id,state,body) VALUES($1,'DRAFT',$2)", [id, { revision: 1 }]);
    await assert.rejects(db.query('UPDATE import_packages SET review_current=true'), /can only be updated to DEFAULT/);
    await db.query("INSERT INTO usp_intake_parts VALUES($1,'published',$2)", [id, { packageId: id }]);
    const client = { query: (text: string, values: unknown[]) => db.query(text, values) };
    for (const [state, body, pending] of [
      ['DRAFT', { revision: 1 }, 1],
      ['REVIEWED', { revision: 2, review: { packageRevision: 2 } }, 0],
      ['DRAFT', { revision: 3, review: { packageRevision: 2 } }, 1],
      ['DRAFT', { revision: 4 }, 1],
      ['DRAFT', { revision: 1, review: { packageRevision: '1' } }, 1],
      ['DRAFT', {}, 0],
      ['DRAFT', { revision: null }, 1],
      ['COMMITTED', { revision: 5, review: { packageRevision: 4 } }, 0],
    ] as const) {
      await db.query('UPDATE import_packages SET state=$2,body=$3 WHERE id=$1', [id, state, body]);
      assert.equal(await unfinishedIntakePackagesTx(client as any, id), pending);
      const old = await db.query(`SELECT count(*)::int n FROM usp_intake_parts part
        LEFT JOIN import_packages p ON p.id::text=part.result_ref->>'packageId'
        WHERE part.item_id=$1 AND (part.state IN ('queued','running') OR (part.state='published'
          AND p.state<>'COMMITTED'
          AND p.body->'review'->'packageRevision' IS DISTINCT FROM p.body->'revision'))`, [id]);
      assert.equal(old.rows[0].n, pending);
    }
  } finally { await db.close(); }
});
