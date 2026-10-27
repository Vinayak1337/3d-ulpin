import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { ImportPackage, PhysicalFeature } from '@ulpin/contracts';
import { commitPackage, rebasePackage, reviewPackage } from './areas';
import { nativeReviewFixture, recordedNeighbourFixture } from './native-review.test-fixture';
import { sameCanonicalGeometryPayload } from '../usp/geometry';

class ReviewControl {
  packages = new Map<string, ImportPackage>();
  recorded = new Map<string, PhysicalFeature>();
  qualifications = new Map<string, { body: PhysicalFeature; revision: number }>();
  associations: Record<string, any>[] = [];
  contextCountOverride: number | undefined;
  reverseRows = false;
  queries: string[] = [];
  area = { id: nativeReviewFixture().areaId, revision: 0, reference: null,
    extent: [0, 0, 1, 1], geographic_extent: [0, 0, 1, 1] };

  addPackage(index = 0) {
    const pkg = nativeReviewFixture();
    const original = JSON.parse(readFileSync('docs/evidence/gf-backend/k1/nyc-import.json', 'utf8'));
    pkg.id = randomUUID();
    pkg.features = [original.features[index]];
    pkg.sourceRevisionIds = [...new Set(pkg.features.map(feature => feature.sourceRevisionId))];
    (pkg as any).extent = this.area.extent;
    (pkg as any).geographicExtent = this.area.geographic_extent;
    this.packages.set(pkg.id, pkg);
    this.recorded.set(pkg.features[0].id, structuredClone(pkg.features[0]));
    return pkg;
  }

  addContext(qualified: boolean) {
    const feature = recordedNeighbourFixture();
    feature.areaId = this.area.id;
    this.recorded.set(feature.id, feature);
    if (qualified) this.qualifications.set(feature.id, { body: structuredClone(feature), revision: 1 });
    return feature;
  }

  private contextRows(values: any[]) {
    const ownIds: string[] = values[12];
    const unqualifiedCount = [...this.recorded.values()].filter(feature => feature.revision > 0
      && !ownIds.includes(feature.id) && !this.qualifications.has(feature.id)).length;
    const rows = [...this.recorded.values()].filter(feature => feature.revision > 0 && !ownIds.includes(feature.id))
      .filter(feature => {
        const qualification = this.qualifications.get(feature.id);
        return qualification && qualification.body.revision === feature.revision
          && sameCanonicalGeometryPayload(qualification.body as any, feature as any);
      }).map(body => ({ body, area_id: this.area.id, local_geometry: null,
        qualification_revision: this.qualifications.get(body.id)!.revision,
        metadata: { receiptId: 'technical-qualification-control' },
        context_count: this.contextCountOverride ?? this.qualifications.size,
        unqualified_count: unqualifiedCount }));
    if (!rows.length) return [{ body: null, unqualified_count: unqualifiedCount }];
    return this.reverseRows ? rows.reverse() : rows;
  }

  private read(sql: string, values: any[]): any[] | null {
    if (sql.startsWith('WITH bounds')) return this.contextRows(values);
    if (sql.includes('FROM import_packages')) return [{ body: this.packages.get(values[0]) }];
    if (sql.includes('FROM sources')) return [...this.packages.values()].flatMap(pkg => pkg.sourceRevisionIds)
      .map(id => ({ id, revision: 1, profile: 'area-geojson-v2', status: 'inspected' }));
    if (sql.includes('FROM map_areas')) return [this.area];
    if (sql.includes('FROM usp_analytic_geometry')) return [...this.qualifications.values()]
      .map(value => ({ id: value.body.id, revision: value.body.revision, body: value.body }));
    if (sql.includes('FROM property_associations')) return this.associations.map(body => ({ body }));
    if (sql.includes('FROM physical_features p JOIN registry_records')) return [];
    if (sql.startsWith('SELECT revision FROM physical_features')) {
      const feature = this.recorded.get(values[0]);
      return feature ? [{ revision: feature.revision }] : [];
    }
    if (sql.includes("current_setting('role')")) return [{ role: 'none' }];
    return null;
  }

  query = async (sql: string, values: any[] = []) => {
    this.queries.push(sql);
    const rows = this.read(sql, values);
    if (rows) return { rows: structuredClone(rows), rowCount: rows.length };
    if (sql.startsWith('UPDATE import_packages')) this.packages.set(values[0], structuredClone(values[3]));
    else if (sql.startsWith('UPDATE physical_features')) this.recorded.set(values[0], structuredClone(values[2]));
    else if (sql.startsWith('UPDATE map_areas')) this.area.revision++;
    else {
      const allowed = /^(BEGIN|COMMIT|ROLLBACK|SET TRANSACTION|SELECT (set_config|pg_advisory)|INSERT INTO)/;
      assert(allowed.test(sql) || sql.startsWith('UPDATE external'), sql);
    }
    return { rows: [], rowCount: 0 };
  };
}

async function memory(work: (control: ReviewControl) => Promise<void>) {
  const control = new ReviewControl();
  const globals = globalThis as any;
  const previousPool = globals.ulpinPool;
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.GEO_URL;
  const previousToken = process.env.GEO_SERVICE_TOKEN;
  globals.ulpinPool = { query: control.query, connect: async () => ({ query: control.query, release() {} }) };
  process.env.GEO_URL = 'http://127.0.0.1/technical-review-control';
  process.env.GEO_SERVICE_TOKEN = 'unused-fetch-control';
  globalThis.fetch = async () => new Response(JSON.stringify({ findings: [], coverage: ['Technical control'] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
  try { await work(control); }
  finally {
    globals.ulpinPool = previousPool;
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.GEO_URL;
    else process.env.GEO_URL = previousUrl;
    if (previousToken === undefined) delete process.env.GEO_SERVICE_TOKEN;
    else process.env.GEO_SERVICE_TOKEN = previousToken;
  }
}

const acknowledge = 'Technical test: record physical observations only.';

test('review stage timings contain elapsed numbers only and preserve the checked package',
  async () => memory(async control => {
  const pkg = control.addPackage();
  const stages: [string, number][] = [];
  const reviewed = await reviewPackage(pkg.id, pkg.revision, (stage, ms) => stages.push([stage, ms]));
  assert.deepEqual(stages.map(([stage]) => stage), ['getPackage', 'areaRead', 'effectiveFeatures', 'split',
    'qualification', 'geoCheck', 'enrichFindings', 'fingerprint', 'transactionBegin', 'packageLock',
    'areaLock', 'effectiveFeaturesLocked', 'fingerprintLocked', 'save', 'commit']);
  assert(stages.every(([, ms]) => Number.isFinite(ms) && ms >= 0));
  assert.equal(reviewed.state, 'REVIEWED');
  assert.deepEqual(reviewed.features, pkg.features);
  assert(!Object.keys(reviewed).some(key => key.toLowerCase().includes('timing')));
}));

test('two packages reviewed at the same area revision both record in turn', async () => memory(async control => {
  const first = control.addPackage(0);
  const second = control.addPackage(1);
  const reviewedFirst = await reviewPackage(first.id, first.revision);
  const reviewedSecond = await reviewPackage(second.id, second.revision);
  assert.equal(reviewedFirst.review!.areaRevision, reviewedSecond.review!.areaRevision);
  await commitPackage(first.id, reviewedFirst.revision, acknowledge);
  const recorded = await commitPackage(second.id, reviewedSecond.revision, acknowledge);
  assert.equal(recorded.state, 'COMMITTED');
  assert.equal(control.area.revision, 2);
  assert(!control.queries.some(sql => sql.startsWith('SELECT body FROM physical_features WHERE area_id=')));
}));

test('parallel reviews without qualified geometry avoid a second spatial scan under the area lock',
  async () => memory(async control => {
  const first = control.addPackage(0), second = control.addPackage(1);
  const check = globalThis.fetch;
  let arrivals = 0, release!: () => void;
  const bothChecking = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async (...args) => {
    if (++arrivals === 2) release();
    await bothChecking;
    return check(...args);
  };
  const results = await Promise.all([reviewPackage(first.id, first.revision),
    reviewPackage(second.id, second.revision)]);
  assert(results.every(pkg => pkg.state === 'REVIEWED'));
  const locks = control.queries.filter(sql => sql.includes('FROM map_areas') && sql.includes('FOR '));
  assert.equal(locks.length, 2);
  assert(locks.every(sql => sql.endsWith('FOR UPDATE')));
  const contextReads = control.queries.filter(sql => sql.includes('AS context_count'));
  assert.equal(contextReads.length, 2, 'each review reads full context only outside the lock');
  assert.equal(control.queries.filter(sql => sql.includes("namespace='area_feature' LIMIT 1")).length, 2);
  const packageLock = control.queries.findIndex(sql =>
    sql.includes('FROM import_packages') && sql.endsWith('FOR UPDATE'));
  assert(packageLock >= 0 && packageLock < control.queries.indexOf(locks[0]));
  assert(!control.queries.some(sql => sql.startsWith('UPDATE map_areas')));
}));

test('review reads spatial context and its unqualified count in one statement', async () => memory(async control => {
  const pkg = control.addPackage();
  control.addContext(true);
  const unqualified = control.addPackage(1).features[0];
  control.recorded.get(unqualified.id)!.revision = 1;
  const reviewed = await reviewPackage(pkg.id, pkg.revision);
  assert.equal(reviewed.review!.scope!.contextCount, 1);
  assert.equal(reviewed.review!.scope!.unqualifiedInScope, 1);
  const reads = control.queries.filter(sql => sql.includes('AS context_count') || sql.includes('AS unqualified_count'));
  assert.equal(reads.length, 2, 'one shared spatial read outside and one under the area lock');
  assert(reads.every(sql => sql.includes('scoped AS MATERIALIZED') && sql.includes('AS unqualified_count')));
}));

test('an edit finishing during the geo check refuses the in-flight review instead of saving stale findings',
  async () => memory(async control => {
  const pkg = control.addPackage();
  const check = globalThis.fetch;
  let entered!: () => void, release!: () => void;
  const checking = new Promise<void>(resolve => { entered = resolve; });
  const edited = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async (...args) => {
    entered();
    await edited;
    return check(...args);
  };
  const reviewing = reviewPackage(pkg.id, pkg.revision);
  const refused = assert.rejects(reviewing, { status: 409, code: 'STALE_REVISION' });
  await checking;
  try {
    const rebased = await rebasePackage(pkg.id, pkg.revision);
    assert.equal(rebased.revision, pkg.revision + 1);
  } finally { release(); }
  await refused;
  assert(!control.packages.get(pkg.id)!.review);
  assert(control.queries.some(sql => sql === 'SELECT id FROM map_areas WHERE id=$1 FOR UPDATE'));
}));

test('revised qualified context refuses recording and names the changed feature', async () => memory(async control => {
  const pkg = control.addPackage();
  const feature = control.addContext(true);
  const reviewed = await reviewPackage(pkg.id, pkg.revision);
  feature.revision++;
  control.area.revision++;
  control.qualifications.set(feature.id, { body: structuredClone(feature), revision: 2 });
  await assert.rejects(commitPackage(pkg.id, reviewed.revision, acknowledge), (error: any) => {
    assert.equal(error.status, 409);
    assert.equal(error.code, 'STALE_REVISION');
    assert(error.message.includes(feature.id));
    assert(error.message.includes('revision 1 to 2'));
    return true;
  });
}));

test('qualification pin movement, entry and departure each name the changed context', async () => {
  for (const movement of ['qualification', 'entered', 'left']) await memory(async control => {
    const pkg = control.addPackage();
    const feature = control.addContext(movement !== 'entered');
    const reviewed = await reviewPackage(pkg.id, pkg.revision);
    if (movement === 'qualification') control.qualifications.get(feature.id)!.revision++;
    if (movement === 'entered') control.qualifications.set(feature.id, { body: structuredClone(feature), revision: 1 });
    if (movement === 'left') control.qualifications.delete(feature.id);
    await assert.rejects(commitPackage(pkg.id, reviewed.revision, acknowledge), (error: any) => {
      assert.equal(error.code, 'STALE_REVISION');
      assert(error.message.includes(feature.id));
      assert(error.message.includes(movement === 'qualification' ? 'qualification' : movement));
      return true;
    });
  });
});

test('only associations between checked features can stale the review', async () => {
  for (const qualified of [true, false]) await memory(async control => {
    const pkg = control.addPackage();
    const context = control.addContext(qualified);
    const association = { id: randomUUID(), fromId: pkg.features[0].id, toId: context.id,
      status: 'confirmed', revision: 1, evidence: [], fromRevision: 0, toRevision: 1 };
    control.associations.push(association);
    const reviewed = await reviewPackage(pkg.id, pkg.revision);
    association.revision++;
    if (qualified) {
      await assert.rejects(commitPackage(pkg.id, reviewed.revision, acknowledge), (error: any) => {
        assert.equal(error.code, 'STALE_REVISION');
        assert(error.message.includes('association'));
        return true;
      });
    } else assert.equal((await commitPackage(pkg.id, reviewed.revision, acknowledge)).state, 'COMMITTED');
  });
});

test('review re-derives pins under the area lock before persisting checked findings',
  async () => memory(async control => {
  const pkg = control.addPackage();
  const context = control.addContext(true);
  const check = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const result = await check(...args);
    control.qualifications.get(context.id)!.revision++;
    return result;
  };
  await assert.rejects(reviewPackage(pkg.id, pkg.revision), (error: any) => {
    assert.equal(error.code, 'STALE_REVISION');
    assert(error.message.includes(context.id));
    return true;
  });
  assert(!control.packages.get(pkg.id)!.review);
}));

test('qualified context entering during the geo check refuses the empty-context fast path',
  async () => memory(async control => {
  const pkg = control.addPackage();
  const check = globalThis.fetch;
  let entered!: () => void, release!: () => void;
  const checking = new Promise<void>(resolve => { entered = resolve; });
  const changed = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async (...args) => {
    entered();
    await changed;
    return check(...args);
  };
  const reviewing = reviewPackage(pkg.id, pkg.revision);
  const refused = assert.rejects(reviewing, (error: any) => {
    assert.equal(error.code, 'STALE_REVISION');
    assert(error.message.includes('entered'));
    return true;
  });
  await checking;
  control.addContext(true);
  control.area.revision++;
  release();
  await refused;
  assert(!control.packages.get(pkg.id)!.review);
  assert.equal(control.queries.filter(sql => sql.includes('AS context_count')).length, 2);
}));

test('an unqualified recorded feature revision does not stale a review', async () => memory(async control => {
  const pkg = control.addPackage();
  const feature = control.addContext(false);
  const reviewed = await reviewPackage(pkg.id, pkg.revision);
  assert.equal(reviewed.review!.scope!.unqualifiedInScope, 1);
  feature.revision++;
  control.area.revision++;
  assert.equal((await commitPackage(pkg.id, reviewed.revision, acknowledge)).state, 'COMMITTED');
}));

test('over-bound context refuses with both counts instead of checking a truncated set',
  async () => memory(async control => {
  const pkg = control.addPackage();
  control.addContext(true);
  control.contextCountOverride = 2001;
  await assert.rejects(reviewPackage(pkg.id, pkg.revision), (error: any) => {
    assert.equal(error.status, 422);
    assert.equal(error.code, 'AREA_CONTEXT_LIMIT');
    assert.deepEqual(error.details, { ownCount: 1, contextCount: 2001, contextLimit: 2000 });
    return true;
  });
  assert(!control.packages.get(pkg.id)!.review);
}));

test('a stored v1 review is refused with review again', async () => memory(async control => {
  const pkg = control.addPackage();
  pkg.review = { areaRevision: 0, packageRevision: pkg.revision,
    inputFingerprint: 'v1-control', findings: [], coverage: [] };
  await assert.rejects(commitPackage(pkg.id, pkg.revision, acknowledge), (error: any) => {
    assert.equal(error.code, 'STALE_REVISION');
    assert(error.message.includes('review again'));
    return true;
  });
}));

test('own feature and context row ordering does not change the canonical fingerprint',
  async () => memory(async control => {
  const first = control.addPackage(0);
  const other = control.addPackage(1);
  first.features.push(other.features[0]);
  const context = control.addContext(true);
  const secondContext = { ...structuredClone(context), id: randomUUID() };
  control.recorded.set(secondContext.id, secondContext);
  control.qualifications.set(secondContext.id, { body: secondContext, revision: 1 });
  const original = structuredClone(first);
  const pin = (await reviewPackage(first.id, first.revision)).review!.inputFingerprint;
  original.features.reverse();
  control.packages.set(first.id, original);
  control.reverseRows = true;
  assert.equal((await reviewPackage(first.id, original.revision)).review!.inputFingerprint, pin);
}));
