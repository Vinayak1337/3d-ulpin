import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { unfinishedIntakePackagesTx } from './intake-ledger';
import { sql } from '../../../infrastructure/sql-loader';
import { AppError } from '../../../infrastructure/errors';

/** Run production bodies with controlled I/O; keep the cut loop, stale guards and completion unchanged. */
function isolated(file: string, controls: Record<string, any>, tail: string) {
  const source = readFileSync(`packages/server/src/modules/usp/${file}.ts`, 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  } }).outputText.replace(/^import \{([^}]+)\} from ["'][^"']+["'];/gm,
    (_, names) => `const {${names.replace(/\s+as\s+/g, ':')}} = controls;`).replaceAll('export ', '');
  return new Function('controls', js + tail)(new Proxy(controls, {
    get: (target, key) => key in target ? Reflect.get(target, key) : function () {},
  }));
}

test('several cuts queue only at completion; stale dispatch admits no reader and does no fold', async () => {
  let parts = 0, queued = 0, folded = 0, phases = 0;
  const state = () => ({ key: String(parts), item: {}, store: { parts, unreviewed: parts + 5 } });
  const fold = { cutKey: '0', held: {}, pending: [], frame: {}, firstChunk: 0, chunks: 1, started: Date.now() };
  const controls = {
    transaction: (work: any) => work({ query: async () => ({ rows: [{ status: 'queued' }], rowCount: 0 }) }),
    largeStateKey: async () => state(), intakeLargeCutKey: (store: any) => String(store.parts),
    intakeLargeAtRest: () => false, intakeLargeRows: () => ({}),
    intakeLargePhase: () => { phases++; return 'draft'; },
    retiredFileAreaWords: () => assert.fail('stale dispatch reached phase work'),
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
  // The same input is now stale, before admission and again before folding.
  assert.equal(await worker.prepareReaders(input), true);
  await worker.step(input, {});
  assert.deepEqual([folded, queued, phases], [3, 2, 0]);
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
