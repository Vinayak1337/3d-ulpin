import assert from 'node:assert/strict';
import test from 'node:test';
import type { ImportPackage, PhysicalFeature } from '@ulpin/contracts';
import type { Pool } from 'pg';
import { reviewPackage } from './areas';
import { sameCanonicalGeometryPayload } from '../usp/geometry';
import { nativeReviewFixture, recordedNeighbourFixture, retainedRoofprintFixture } from './native-review.test-fixture';

const refusal = 'Spatial analysis is not assessed: changed or unqualified geometry '
  + 'requires its own canonical qualification.';

function reviewControl(pkg: ImportPackage, neighbours: PhysicalFeature[] = [], qualified: PhysicalFeature[] = []) {
  let stored = structuredClone(pkg);
  const queries: string[] = [];
  const history: unknown[][] = [];
  const checkInputs: { features: PhysicalFeature[]; associations: unknown[] }[] = [];
  const associationScopes: string[][] = [];
  const area = { id: pkg.areaId, site_id: pkg.areaId, name: pkg.name, revision: 0, reference: null };
  const query = async (sql: string, values: any[] = []) => {
    queries.push(sql);
    if (sql.includes('FROM import_packages')) return { rows: [{ body: structuredClone(stored) }] };
    if (sql.includes('FROM sources')) return { rows: pkg.sourceRevisionIds.map(id => ({
      id, revision: 1, profile: 'area-geojson-v2', status: 'inspected',
    })) };
    if (sql.includes('FROM map_areas')) return { rows: [area] };
    const eligible = neighbours.filter(feature => qualified.some(record => record.id === feature.id
      && record.revision === feature.revision && sameCanonicalGeometryPayload(record as any, feature as any)));
    if (sql.startsWith('WITH bounds')) return { rows: eligible.length ? eligible.map(body => ({ body,
      area_id: pkg.areaId, local_geometry: null, qualification_revision: 1,
      metadata: { receiptId: 'technical-qualified-control' }, context_count: eligible.length,
      unqualified_count: neighbours.length - eligible.length }))
      : [{ body: null, unqualified_count: neighbours.length }] };
    if (sql.includes('FROM usp_analytic_geometry')) return { rows: qualified.map(body => ({
      id: body.id, revision: body.revision, body,
    })) };
    if (sql.includes('FROM physical_features')) return { rows: neighbours.map(body => ({ body })) };
    if (sql.includes('FROM property_associations')) {
      associationScopes.push(values[0]);
      return { rows: [] };
    }
    if (sql.includes("current_setting('role')")) return { rows: [{ role: 'none' }] };
    if (sql.startsWith('UPDATE import_packages')) stored = structuredClone(values[3]);
    else if (sql.startsWith('INSERT INTO import_package_revisions')) history.push(structuredClone(values));
    else assert(/^(BEGIN|COMMIT|ROLLBACK|SET TRANSACTION|SELECT set_config)/.test(sql), sql);
    return { rows: [] };
  };
  return { query, queries, history, checkInputs, associationScopes, stored: () => stored };
}

async function memoryReview(pkg: ImportPackage, neighbours: PhysicalFeature[],
  work: (control: ReturnType<typeof reviewControl>) => Promise<void>, qualified: PhysicalFeature[] = []) {
  const control = reviewControl(pkg, neighbours, qualified);
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  const previousPool = globals.ulpinPool;
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.GEO_URL;
  const previousToken = process.env.GEO_SERVICE_TOKEN;
  process.env.GEO_URL = 'http://127.0.0.1/technical-control';
  process.env.GEO_SERVICE_TOKEN = 'unused-fetch-control';
  globals.ulpinPool = { query: control.query, connect: async () => ({ query: control.query, release() {} }) } as any;
  globalThis.fetch = async (_url, init) => {
    const input = JSON.parse(String(init?.body));
    control.checkInputs.push(input);
    return new Response(JSON.stringify({ findings: [], coverage: ['Technical area-check response control.'] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await work(control);
  } finally {
    globals.ulpinPool = previousPool;
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.GEO_URL;
    else process.env.GEO_URL = previousUrl;
    if (previousToken === undefined) delete process.env.GEO_SERVICE_TOKEN;
    else process.env.GEO_SERVICE_TOKEN = previousToken;
  }
}

function unchangedRefusal(error: any) {
  assert.equal(error.status, 422);
  assert.equal(error.code, 'USP_GEOMETRY_PAYLOAD_UNQUALIFIED');
  assert.equal(error.message, refusal);
  return true;
}

function notReviewed(control: ReturnType<typeof reviewControl>, before: ImportPackage) {
  assert.deepEqual(control.stored(), before);
  assert.deepEqual(control.history, []);
  assert(!control.queries.some(sql => /^(UPDATE|INSERT)/.test(sql)));
}

test('a publisher-native package in an empty area receives an admission review with honest coverage', async () => {
  const pkg = nativeReviewFixture();
  await memoryReview(pkg, [], async control => {
    const reviewed = await reviewPackage(pkg.id, pkg.revision);
    assert.equal(reviewed.state, 'REVIEWED');
    assert.equal(reviewed.revision, pkg.revision + 1);
    assert.equal(control.history.length, 1);
    assert.deepEqual(control.stored(), reviewed);
    assert.deepEqual(reviewed.features, pkg.features, 'admission never records or changes a feature');
    assert.equal(reviewed.review?.coverage[1],
      '1 source-native candidate(s) checked for admission, not recorded-geometry analysis. '
        + '1 of these have no stated role; what the outline represents is unknown. '
        + '0 recorded context feature(s) assessed; recorded neighbours require canonical geometry qualification.');
    assert.deepEqual(control.checkInputs[0].features, pkg.features);
    assert.equal(reviewed.review?.scope?.unqualifiedInScope, 0);
    assert.equal(reviewed.review?.scope?.validator, 'area-check-officer-v2');
    assert(!control.queries.some(sql => sql.startsWith('SELECT body FROM physical_features WHERE area_id=')));
  });
});

test('an omitted unqualified neighbour is disclosed but never pinned in the review fingerprint', async () => {
  const pkg = nativeReviewFixture();
  const neighbour = recordedNeighbourFixture();
  await memoryReview(pkg, [neighbour], async control => {
    const reviewed = await reviewPackage(pkg.id, pkg.revision);
    assert.equal(reviewed.state, 'REVIEWED');
    assert.deepEqual(control.checkInputs[0].features, pkg.features);
    assert.deepEqual(control.associationScopes[0], pkg.features.map(feature => feature.id));
    assert.deepEqual(control.associationScopes.at(-1), pkg.features.map(feature => feature.id));
    assert(reviewed.review?.coverage.some(line => line.startsWith('1 recorded feature(s) in that widened extent')));
    assert.equal(reviewed.review?.scope?.unqualifiedInScope, 1);
    assert.equal(reviewed.review?.scope?.contextCount, 0);
    const originalPin = reviewed.review!.inputFingerprint;
    const changedNeighbour = { ...neighbour, revision: 2 };
    await memoryReview(pkg, [changedNeighbour], async changed => {
      const next = await reviewPackage(pkg.id, pkg.revision);
      assert.equal(next.review!.inputFingerprint, originalPin);
      assert.deepEqual(changed.checkInputs[0].features, pkg.features);
    });
  });
});

test('only the exact qualified context payload participates in candidate checks', async () => {
  const pkg = nativeReviewFixture();
  const neighbour = recordedNeighbourFixture();
  await memoryReview(pkg, [neighbour], async control => {
    const reviewed = await reviewPackage(pkg.id, pkg.revision);
    assert.deepEqual(control.checkInputs[0].features, [neighbour, ...pkg.features]);
    assert(reviewed.review?.coverage.some(line => line.includes('1 recorded context feature(s) assessed')));
    assert.equal(reviewed.review?.scope?.contextCount, 1);
    assert.equal(reviewed.review?.scope?.unqualifiedInScope, 0);
  }, [neighbour]);
  await memoryReview(pkg, [{ ...neighbour, name: `${neighbour.name} changed` }], async control => {
    const reviewed = await reviewPackage(pkg.id, pkg.revision);
    assert.deepEqual(control.checkInputs[0].features, pkg.features);
    assert(reviewed.review?.coverage.some(line => line.startsWith('1 recorded feature(s)')));
  }, [neighbour]);
});

test('synthetic package candidates cannot use the admission exception', async () => {
  const pkg = nativeReviewFixture();
  pkg.features[0].worldStatus = 'synthetic';
  await memoryReview(pkg, [], async control => {
    await assert.rejects(() => reviewPackage(pkg.id, pkg.revision), unchangedRefusal);
    notReviewed(control, pkg);
  });
});

test('a correction carrying recorded package features retains the original qualification refusal', async () => {
  const pkg = nativeReviewFixture();
  pkg.features[0].revision = 1;
  await memoryReview(pkg, [], async control => {
    await assert.rejects(() => reviewPackage(pkg.id, pkg.revision), unchangedRefusal);
    notReviewed(control, pkg);
  });
});

test('the retained real model roofprint draft remains refused before any review write', async () => {
  const pkg = retainedRoofprintFixture();
  await memoryReview(pkg, [], async control => {
    await assert.rejects(() => reviewPackage(pkg.id, pkg.revision), unchangedRefusal);
    notReviewed(control, pkg);
  });
});
