import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { bindRetainedCaseTx } from '../../areas/areas';
import { lockSourceBuildingCasesTx } from './source-building-review';
import { lockStreamingRowsTx } from './streaming-vector';
import { assertUspJobAttemptTx } from '../jobs';
import { intakeCaseTx } from './intake-context';
import { AppError, conflict, notFound } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { partStageTimer } from './proved-area-part';

const id = '54200000-0000-4000-8000-000000000001', hash = 'a'.repeat(64);
process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'test_only';
const directory = 'packages/server/src/modules/';
const draft = readFileSync(`${directory}usp/ingestion/intake-part-draft.ts`, 'utf8');
const areas = readFileSync(`${directory}areas/areas.ts`, 'utf8').replaceAll('\r\n', '\n');
function load(source: string, dependencies: Record<string, unknown>, name: string) {
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022 } }).outputText.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
  return new Function(...Object.keys(dependencies), `${js}; return ${name};`)(...Object.values(dependencies));
}

/** PostgreSQL SHARE/UPDATE compatibility and a wait graph, not a live database or a timing claim. */
async function schedule(rival: 'mapping' | 'commit', bound = false) {
  const holders = new Map<string, Map<string, string>>(), waits = new Map<string, string[]>();
  const listeners = new Set<() => void>(), events: string[] = [];
  let blocked!: () => void;
  const rivalBlocked = new Promise<void>(resolve => { blocked = resolve; });
  async function lock(owner: string, resource: string, mode: string): Promise<void> {
    const held = holders.get(resource) ?? new Map<string, string>();
    holders.set(resource, held);
    const blockers = [...held].filter(([other, otherMode]) => other !== owner
      && !(mode === 'SHARE' && otherMode === 'SHARE')).map(([other]) => other);
    events.push(`${owner} ${blockers.length ? 'waits' : 'holds'} ${resource} ${mode}`);
    if (!blockers.length) {
      // PostgreSQL retains the strongest lock until transaction end; a later SHARE never downgrades UPDATE.
      if (held.get(owner) !== 'UPDATE') held.set(owner, mode);
      waits.delete(owner);
      return;
    }
    waits.set(owner, blockers);
    if (owner === rival) blocked();
    if (blockers.some(other => waits.get(other)?.includes(owner)))
      throw Object.assign(new Error('case lock upgrade cycle'), { code: '40P01' });
    await new Promise<void>(resolve => listeners.add(resolve));
    return lock(owner, resource, mode);
  }
  function release(owner: string) {
    for (const held of holders.values()) held.delete(owner);
    waits.delete(owner);
    for (const resume of listeners) resume();
    listeners.clear();
  }
  const pkg = { id, caseId: id, areaId: id, state: 'REVIEWED', revision: 2,
    review: { packageRevision: 2, inputFingerprint: hash, scope: { validator: 'current' } },
    reviewDependencyPins: {}, features: [], extent: null, geographicExtent: null };
  const mapping = { source_id: id, source_revision: 1, state: 'running', sealed_chunks: null,
    unknown_remainder: true, next_publish_index: 1, records: 1, raw_parts: 2, raw_records: 2,
    raw_unknown: false, raw_state: 'completed', payload: { sourceSha256: hash, planHash: hash,
      route: 'approved_recipe', rawJobId: id } };
  function client(owner: string) {
    return { query: async (sql: string) => {
      if (sql.includes('FROM cases')) {
        if (sql.includes('FOR UPDATE')) await lock(owner, 'case', 'UPDATE');
        else if (sql.includes('FOR SHARE')) await lock(owner, 'case', 'SHARE');
        return { rows: [{ id, revision: 1, site_id: bound ? id : null,
          frame: { id: 'UNASSIGNED' }, archived: false }] };
      }
      if (sql.includes('FROM sources')) return { rows: [{ id }] };
      if (sql.startsWith('SELECT m.*')) {
        if (sql.includes('FOR SHARE OF m,j')) await lock(owner, 'mapping-job', 'SHARE');
        return { rows: [mapping] };
      }
      if (sql.startsWith('SELECT status FROM jobs')) {
        await lock(owner, 'mapping-job', 'UPDATE'); return { rows: [{ status: 'running' }] };
      }
      if (sql.includes('FROM usp_job_metadata'))
        return { rows: [{ logical_state: 'running', input_sha256: hash }] };
      if (sql.includes('FROM usp_job_attempts')) return { rows: [{ state: 'active', fence: 1,
        owner: 'test_only', input_sha256: hash, lease_until: new Date(Date.now() + 180000) }] };
      if (sql.includes('FROM import_packages')) {
        if (sql.includes('FOR UPDATE')) await lock(owner, 'package', 'UPDATE');
        return { rows: [{ body: pkg }] };
      }
      if (sql.includes('FROM map_areas')) {
        await lock(owner, 'area', 'UPDATE'); return { rows: [{ id, revision: 1 }] };
      }
      if (sql.includes('FROM registry_sites')) {
        await lock(owner, 'site', 'UPDATE'); return { rows: [{ id }] };
      }
      if (sql.startsWith('SELECT case_id FROM usp_intake_items')) return { rows: [{ case_id: id }] };
      if (sql.startsWith('SELECT * FROM usp_intake_items')) return { rows: [{ source_id: id, case_id: id }] };
      if (sql.startsWith('SELECT r.body')) return { rows: [{ plan_hash: hash, sealed_hash: hash }] };
      if (sql.startsWith('SELECT result_sha256')) return { rows: [{ result_sha256: hash }] };
      if (sql.includes('pg_advisory_xact_lock') || sql.startsWith('UPDATE')
        || sql.startsWith('SELECT locator') || sql.startsWith('SELECT first_feature_index')) return { rows: [] };
      throw new Error(sql);
    } };
  }
  const commitSource = areas.slice(areas.indexOf('export async function commitPackage('),
    areas.indexOf('\nexport async function runAreaCheck('));
  const commit = load(commitSource, { transaction: async (work: Function) => work(client('commit')),
    lockSourceBuildingCasesTx, isGeometryFreePackage: () => false,
    assertPackageDocumentAuthority: async () => {}, notFound, conflict, AppError,
    PACKAGE_REVIEW_VALIDATOR: 'current', areaFrom: (row: unknown) => row,
    effectiveFeatures: async () => ({}), packageReviewFingerprint: () => hash,
    reviewPinDifference: async () => '', reviewDependencies: () => ({}),
    recordCommittedExteriorsTx: async () => {}, mergeExtent: () => null, savePackage: async () => {},
  }, 'commitPackage');
  let publication: Promise<void> | undefined;
  const cut = load(draft, { intakeCaseTx, AppError, conflict, notFound, fingerprint, partStageTimer,
    intakeSourceTx: async () => ({ source: {} }), isRetainedMapOriginal: () => true,
    assertPartPrefixSealCheck: () => {}, unfinishedIntakePackagesTx: async () => 0,
    publishIntakePartTx: async () => {}, createIntakeTargetsTx: async () => {},
    // Open gate facts are independently exercised by intake-part-draft-open.test.ts.
    ingestProvedAreaPart: async (_input: unknown, cutClient: any) => {
      await lockStreamingRowsTx(cutClient, id, id);
      await cutClient.query('SELECT * FROM map_areas WHERE id=$1 FOR UPDATE');
      await cutClient.query('SELECT * FROM registry_sites WHERE id=$1 FOR UPDATE');
      publication = (async () => {
        try {
          if (rival === 'commit') await commit(id, 2, 'test_only acknowledgement');
          else {
            const mapper = client('mapping');
            await lockStreamingRowsTx(mapper as any, id, id);
            await assertUspJobAttemptTx(mapper as any,
              { jobId: id, number: 1, fence: 1, owner: 'test_only', inputSha256: hash } as any);
          }
        } finally { release(rival); }
      })();
      await rivalBlocked;
      const updates = events.filter(event => event === 'cut holds case UPDATE').length;
      await bindRetainedCaseTx(cutClient, id, { id });
      if (bound) assert.equal(events.filter(event => event === 'cut holds case UPDATE').length, updates,
        'an already-bound binder never asks for case UPDATE');
      return { features: [] };
    },
  }, 'draftIntakePartTx');
  const input = { sourceId: id, sourceRevision: 1, sourceSha256: hash, layoutHash: hash, cutIndex: 0,
    features: [{ rawChunkIndex: 0, featureIndex: 0, rawBytes: Buffer.from('test_only') }] };
  const featureHash = fingerprint({ sourceId: id, sourceRevision: 1, sourceSha256: hash, layoutHash: hash,
    features: [{ rawChunkIndex: 0, featureIndex: 0 }] });
  try {
    await cut(client('cut'), id, id, input,
      { mappingJobId: id, rawJobId: id, featureHash, slots: [{ chunkIndex: 0, resultSha256: hash }] });
  } finally { release('cut'); }
  await publication;
  return events;
}

for (const rival of ['mapping', 'commit'] as const) {
  for (const bound of [false, true]) {
    test(`${bound ? 'bound replay' : 'first binding'} takes case UPDATE before the ${rival} cycle`,
      { timeout: 10000 }, async t => {
        const started = performance.now();
        const events = await schedule(rival, bound);
        t.diagnostic(JSON.stringify({ rival, bound, lockModelMs: performance.now() - started }));
        assert.equal(events[0], 'cut holds case UPDATE');
        assert(events.includes(`${rival} waits case SHARE`));
        assert(!events.includes('cut holds mapping-job SHARE'));
      });
  }
}
