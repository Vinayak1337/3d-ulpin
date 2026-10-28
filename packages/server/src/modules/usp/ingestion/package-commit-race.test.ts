import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Pool } from 'pg';
import { commitPackage, reviewPackage } from '../../areas/areas';
import { nativeReviewFixture } from '../../areas/native-review.test-fixture';
import { LargeOriginalService } from './large-original';
import { sha256 } from '../../../infrastructure/storage';
import { memoryPool, memoryStorage, withPool } from './large-original-memory.test-fixture';

process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'test_only_commit_interleave';
const bytes = readFileSync('fixtures/google-uttam/block-boundary.geojson');
const refusal = {
  code: 'STALE_REVISION',
  message: 'This source case is now associated with a package or property; reopen its current context.',
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

/** Two transaction clients with conflicting PostgreSQL case-row modes; no database or runtime is opened. */
function racePool(caseId: string) {
  const { db, pool } = memoryPool(caseId);
  const pkg = nativeReviewFixture();
  const sourceId = pkg.features[0].sourceRevisionId;
  pkg.sourceRevisionIds = [sourceId];
  db.case.batchSources.add(sourceId);
  db.case.packages.push({ id: pkg.id, state: pkg.state, source_ids: [sourceId] });
  const area = { id: pkg.areaId, revision: 0, reference: null,
    extent: [0, 0, 1, 1], geographic_extent: [0, 0, 1, 1] };
  const holders = new Map<symbol, 'share' | 'update'>();
  const waiting: (() => void)[] = [];
  const events: string[] = [];
  const progress = deferred<'waiting' | 'committed'>();
  const recordingBlocked = deferred<void>();
  let recording: symbol | undefined;
  let publication = false;
  let interleave: (() => Promise<void>) | undefined;
  let physicalRevision = pkg.features[0].revision;
  const result = (rows: unknown[]) => ({ rows: structuredClone(rows), rowCount: rows.length });

  async function lock(owner: symbol, mode: 'share' | 'update') {
    while ([...holders].some(([id, held]) => id !== owner && (mode === 'update' || held === 'update'))) {
      events.push('commit waits for case');
      progress.resolve('waiting');
      await new Promise<void>(resolve => { waiting.push(resolve); });
    }
    holders.set(owner, mode);
    events.push(`case ${mode}`);
  }
  const controlled = { ...pool, query: async (sql: string, values: any[] = []) => {
    const client = await controlled.connect();
    try { return await client.query(sql, values); }
    finally { client.release(); }
  }, connect: async () => {
    const client = await pool.connect();
    const owner = Symbol('transaction');
    return { release() {}, query: async (sql: string, values: any[] = []) => {
      if (/^(COMMIT|ROLLBACK)$/.test(sql)) {
        events.push(sql);
        holders.delete(owner);
        if (recording === owner) recording = undefined;
        waiting.splice(0).forEach(wake => wake());
      }
      if (sql.includes("hashtextextended('physical-area-recording',0)")) {
        while (recording && recording !== owner) {
          recordingBlocked.resolve();
          await new Promise<void>(resolve => { waiting.push(resolve); });
        }
        recording = owner;
        events.push('recording lock');
        return result([]);
      }
      if (sql.startsWith('SELECT id FROM cases WHERE id=(SELECT case_id FROM import_packages')) {
        assert.equal(values[0], pkg.id);
        assert(sql.endsWith('FOR SHARE'));
        await lock(owner, 'share');
        return result([{ id: caseId }]);
      }
      if (sql.includes('FROM cases WHERE id=$1') && sql.endsWith('FOR UPDATE')) await lock(owner, 'update');
      if (sql.includes('FROM import_packages')) {
        if (sql.endsWith('FOR UPDATE')) events.push('package update lock');
        if (sql.startsWith('SELECT body')) return result([{ body: pkg }]);
        return result(db.case.packages);
      }
      if (sql.startsWith('UPDATE import_packages')) {
        Object.assign(pkg, structuredClone(values[3]));
        db.case.packages[0].state = pkg.state;
        if (pkg.state === 'COMMITTED') {
          events.push('package committed');
          progress.resolve('committed');
        }
        return result([]);
      }
      if (sql.includes('FROM sources') && (Array.isArray(values[0]) || values[0] === sourceId)) {
        return result([{ id: sourceId, revision: 1, profile: 'area-geojson-v2', status: 'inspected' }]);
      }
      if (sql.startsWith('SELECT set_config')) return result([]);
      if (sql.includes("current_setting('role')")) return result([{ role: 'none' }]);
      if (sql.includes('FROM map_areas')) return result([area]);
      if (sql.startsWith('WITH bounds')) return result([{ body: null, unqualified_count: 0 }]);
      if (['FROM usp_analytic', 'FROM property_associations', 'FROM physical_features p JOIN registry_records']
        .some(fragment => sql.includes(fragment))) return result([]);
      if (sql.startsWith('SELECT revision FROM physical_features')) return result([{ revision: physicalRevision }]);
      if (sql.startsWith('UPDATE physical_features')) physicalRevision = values[1];
      if (sql.startsWith('UPDATE map_areas')) area.revision++;
      if (['INSERT INTO import_package_revisions', 'INSERT INTO physical_feature_revisions',
        'INSERT INTO external_identifiers', 'UPDATE physical_features', 'UPDATE external_identifiers',
        'UPDATE map_areas'].some(prefix => sql.startsWith(prefix))) {
        return result([]);
      }
      if (sql.startsWith('INSERT INTO sources')) {
        events.push('source published');
        assert.equal(db.case.packages[0].state, 'REVIEWED', 'publication must not overtake a package commit');
      }
      const answer = await client.query(sql, values);
      // Preserve the review reproduction's snapshot and its exact last-check/before-insert interleaving.
      if (publication && interleave && sql.startsWith('SELECT id,family_id,revision,sha256 FROM sources')) {
        const run = interleave;
        interleave = undefined;
        await run();
      }
      return answer;
    } };
  } } as unknown as Pool;
  return { db, pkg, pool: controlled, events, progress, recordingBlocked,
    holdRecording: () => {
      recording = Symbol('legacy placement');
      return () => {
        recording = undefined;
        waiting.splice(0).forEach(wake => wake());
      };
    },
    publish: () => { publication = true; },
    interleave: (run: () => Promise<void>) => { interleave = run; } };
}

for (const schedule of ['publication first', 'commit first'] as const) {
  test(`a draft package cannot commit between the publication guard and source insertion: ${schedule}`,
    { timeout: 10000 }, async () => {
      const caseId = randomUUID();
      const control = racePool(caseId);
      const { storage, objects } = memoryStorage();
      const verify = storage.verifyObjectStream;
      let commit: ReturnType<typeof commitPackage> | undefined;
      storage.verifyObjectStream = async (...args) => {
        const answer = await verify(...args);
        control.publish();
        if (schedule === 'commit first') {
          commit = commitPackage(control.pkg.id, control.pkg.revision, 'Physical observations only.');
          await commit;
        }
        return answer;
      };
      const previousFetch = globalThis.fetch;
      const previousUrl = process.env.GEO_URL;
      const previousToken = process.env.GEO_SERVICE_TOKEN;
      globalThis.fetch = async () => new Response(JSON.stringify({ findings: [], coverage: [] }));
      process.env.GEO_URL = 'http://127.0.0.1/technical-review-control';
      process.env.GEO_SERVICE_TOKEN = 'unused-fetch-control';
      try {
        await withPool(control.pool, async () => {
          await reviewPackage(control.pkg.id, control.pkg.revision);
          control.events.length = 0;
          const service = new LargeOriginalService(storage);
          const receipt = await service.create(caseId, { requestKey: randomUUID(), expectedCaseRevision: 0,
            filename: 'block-boundary.geojson', mediaType: 'application/octet-stream', bytes: bytes.length,
            sha256: sha256(bytes), provenance: { origin: 'not_stated', acquiredAt: '2026-10-22T00:00:00.000Z' } });
          const claim = await service.claimPart(caseId, receipt.id, { requestKey: randomUUID(), expectedRevision: 1,
            expectedCaseRevision: 0, partNumber: 1, sha256: sha256(bytes) });
          const received = await service.receivePart(claim, bytes);
          if (schedule === 'publication first') control.interleave(async () => {
            commit = commitPackage(control.pkg.id, control.pkg.revision, 'Physical observations only.');
            assert.equal(await control.progress.promise, 'waiting');
            assert.equal(control.db.case.packages[0].state, 'REVIEWED');
          });
          const finalization = service.finalize(caseId, receipt.id, { requestKey: randomUUID(),
            expectedRevision: received.revision, expectedCaseRevision: 0, sha256: sha256(bytes) });
          if (schedule === 'commit first') {
            await assert.rejects(finalization, refusal);
            assert.equal(control.db.sources.size, 0);
          } else {
            const final = await finalization;
            assert.equal(final?.state, 'retained');
            assert.equal(control.db.sources.size, 1);
            const source = [...control.db.sources.values()][0];
            assert.equal(source.sha256, sha256(bytes));
            assert.deepEqual(objects.get(source.object_key), bytes);
          }
          assert(commit, 'the concurrent commit was attempted');
          assert.equal((await commit).state, 'COMMITTED');
          assert.equal(control.db.case.packages[0].state, 'COMMITTED');
          if (schedule === 'publication first') {
            assert(control.events.indexOf('source published') < control.events.indexOf('package committed'));
          }
          assert(control.events.indexOf('recording lock') < control.events.indexOf('case share'));
          assert(control.events.indexOf('case share') < control.events.indexOf('package update lock'));
        });
      } finally {
        globalThis.fetch = previousFetch;
        if (previousUrl === undefined) delete process.env.GEO_URL;
        else process.env.GEO_URL = previousUrl;
        if (previousToken === undefined) delete process.env.GEO_SERVICE_TOKEN;
        else process.env.GEO_SERVICE_TOKEN = previousToken;
      }
    });
}

test('a commit waiting for legacy placement holds no package-case lock', { timeout: 10000 }, async () => {
  const caseId = randomUUID();
  const control = racePool(caseId);
  await withPool(control.pool, async () => {
    const releaseRecording = control.holdRecording();
    const committing = commitPackage(control.pkg.id, 0, 'Physical observations only.');
    const rejected = assert.rejects(committing, { code: 'STALE_REVISION' });
    await control.recordingBlocked.promise;
    assert(!control.events.includes('case share'), 'recording must precede the new case lock');
    const placement = await control.pool.connect();
    try {
      await placement.query('BEGIN');
      await placement.query('SELECT id FROM cases WHERE id=$1 FOR UPDATE', [caseId]);
      await placement.query('COMMIT');
    } finally {
      placement.release();
      releaseRecording();
    }
    await rejected;
    assert.equal(control.db.sources.size, 0);
    assert(control.events.indexOf('recording lock') < control.events.indexOf('case share'));
  });
});
