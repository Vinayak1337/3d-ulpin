import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { AreaFinding, AreaGeometry, ImportPackage } from '@ulpin/contracts';
import type { Pool } from 'pg';
import { enrichFindings, geographicGeometry } from './officer';

const retained: ImportPackage = JSON.parse(readFileSync('docs/evidence/gf-backend/k1/nyc-import.json', 'utf8'));
const features = retained.features;
const reference = features[0].sourceReference;
assert(reference);

function finding(index: number, geometry?: AreaGeometry): AreaFinding {
  return { id: `technical-finding-${index}`, category: 'geometric', code: 'TECHNICAL_CONTROL',
    message: 'Fake-client enrichment control, not an analytical finding.',
    featureIds: [features[index % features.length].id], ...(geometry ? { geometry } : {}) };
}

function oldShape(value: AreaFinding, geographicGeometry?: AreaGeometry) {
  const participants = features.filter(feature => value.featureIds.includes(feature.id));
  return { ...value, geographicGeometry, participants,
    evidence: value.evidence ?? participants.flatMap(feature => feature.evidence),
    inputRevisions: participants.map(feature => ({ featureId: feature.id, revision: feature.revision,
      sourceRevisionId: feature.sourceRevisionId })) };
}

async function withClient(work: (control: ReturnType<typeof fakeClient>) => Promise<void>,
  options: { missingReference?: boolean; shortBatch?: boolean } = {}) {
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  const previous = globals.ulpinPool;
  const control = fakeClient(options);
  globals.ulpinPool = { query: control.query } as unknown as Pool;
  try {
    await work(control);
  } finally {
    globals.ulpinPool = previous;
  }
}

function fakeClient(options: { missingReference?: boolean; shortBatch?: boolean }) {
  const batches: string[][] = [];
  const statements: string[] = [];
  let areaReads = 0;
  let pending = 0;
  const query = async (sql: string, values: any[] = []) => {
    statements.push(sql);
    if (sql.startsWith('SELECT a.*')) {
      areaReads++;
      return { rows: [{ id: retained.areaId, site_id: retained.areaId, revision: 0,
        reference: options.missingReference ? null : reference }] };
    }
    assert(sql.startsWith('SELECT t.ord') || sql.startsWith('SELECT ST_AsGeoJSON'), sql);
    assert.deepEqual(values.slice(1), [...reference!.origin, Number(reference!.analysisCrs.split(':')[1])]);
    if (sql.startsWith('SELECT ST_AsGeoJSON')) return { rows: [{ value: values[0] }] };
    assert(sql.endsWith('FROM unnest($1::text[]) WITH ORDINALITY AS t(g,ord) ORDER BY t.ord'));
    assert.equal(pending++, 0, 'A new transform batch cannot run before the previous one completes.');
    batches.push(values[0]);
    await new Promise<void>(resolve => setImmediate(resolve));
    pending--;
    const rows = (values[0] as string[]).map((value, index) => ({ ord: String(index + 1), value }));
    if (options.shortBatch) rows.pop();
    return { rows: rows.reverse() }; // Deliberately reorder fake rows to prove ord, not row position, is used.
  };
  return { query, batches, statements, areaReads: () => areaReads };
}

test('findings without geometry preserve the old shape and issue no area or transform statement', async () => {
  await withClient(async control => {
    const values = [finding(0), finding(1)];
    const enriched = await enrichFindings(values, features, retained.areaId);
    assert.deepEqual(enriched, values.map(value => oldShape(value)));
    assert.deepEqual(await enrichFindings([], features, retained.areaId), []);
    assert.equal(control.areaReads(), 0);
    assert.deepEqual(control.statements, []);
  });
});

test('1201 geometries use one area read and sequential 500, 500, 201 batches placed by ord', async () => {
  await withClient(async control => {
    const values = Array.from({ length: 1201 }, (_, index) =>
      finding(index, features[index % features.length].geometry));
    assert.equal(values.length, 1201);
    const enriched = await enrichFindings(values, features, retained.areaId);
    assert.equal(control.areaReads(), 1);
    assert.deepEqual(control.batches.map(batch => batch.length), [500, 500, 201]);
    assert.equal(control.statements.length, 4);
    assert.deepEqual(control.batches.flat(), values.map(value => JSON.stringify(value.geometry)));
    for (let index = 0; index < values.length; index++) {
      assert.deepEqual(enriched[index], oldShape(values[index], values[index].geometry));
    }
  });
});

test('participants, fallback evidence and pins keep feature order; explicit evidence is kept', async () => {
  await withClient(async () => {
    const value = { ...finding(0), featureIds: [features[2].id, features[0].id, features[2].id, features[1].id] };
    const explicit = { ...value, evidence: features[2].evidence };
    const output = await enrichFindings([value, explicit], features, retained.areaId);
    assert.deepEqual(output, [oldShape(value), oldShape(explicit)]);
    assert.deepEqual(output[0].participants, features.slice(0, 3));
    assert.strictEqual(output[1].evidence, explicit.evidence);
  });
});

test('missing reference refuses both batched and single transforms through the same placement rule', async () => {
  await withClient(async control => {
    const refused = (error: any) => {
      assert.equal(error.status, 422);
      assert.equal(error.code, 'PLACEMENT_REQUIRED');
      assert.equal(error.message, 'This area has no geographic placement.');
      return true;
    };
    await assert.rejects(() => enrichFindings([finding(0, features[0].geometry)], features, retained.areaId), refused);
    await assert.rejects(() => geographicGeometry(features[0].geometry, retained.areaId), refused);
    assert.equal(control.batches.length, 0);
  }, { missingReference: true });
});

test('a short transform batch is an error instead of silently dropping a finding geometry', async () => {
  await withClient(async control => {
    await assert.rejects(() => enrichFindings([finding(0, features[0].geometry)], features, retained.areaId),
      /Finding geometry transform returned an unexpected number of rows/);
    assert.equal(control.batches.length, 1);
  }, { shortBatch: true });
});
