import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { areaDisplayWindowSchema } from './area-validation';
import { areaDisplaySummary, areaDisplayWindow } from './area-display-window';

type Row = { id: string; identifier: string; kind: string; height: unknown; geometry: unknown; box: number[] };

/** A square building of side 10 m with its south-west corner at (x, y) in the area's local metres. */
function square(identifier: string, x: number, y: number, height: number | null): Row {
  const ring = [[x, y], [x + 10, y], [x + 10, y + 10], [x, y + 10], [x, y]];
  return {
    id: randomUUID(), identifier, kind: 'building', box: [x, y, x + 10, y + 10],
    height: { state: height === null ? 'unknown' : 'source_supported', value: height, unit: 'm' },
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}

/** The area's display reads against an in-memory store that applies the window and cursor the SQL is given. */
class WindowControl {
  statements: string[] = [];
  area = { id: randomUUID(), site_id: randomUUID(), name: 'Window control', revision: 4, extent: [0, 0, 1, 1],
    reference: { anchor: [-79.05, 43.09], sourceCrs: 'EPSG:4326', verticalReference: 'unknown',
      analysisCrs: 'EPSG:32617', origin: [0, 0] } as object | null, geographic_extent: [0, 0, 1, 1] };
  features: Row[] = [];

  private rows(sql: string, values: any[]): any[] {
    if (sql.includes('FROM map_areas a')) return [{ ...this.area, feature_count: this.features.length }];
    if (sql.includes('ST_Extent')) {
      if (!this.features.length) return [{ feature_count: 0, min_x: null, min_y: null, max_x: null, max_y: null }];
      const boxes = this.features.map(feature => feature.box);
      return [{ feature_count: this.features.length, min_x: Math.min(...boxes.map(box => box[0])),
        min_y: Math.min(...boxes.map(box => box[1])), max_x: Math.max(...boxes.map(box => box[2])),
        max_y: Math.max(...boxes.map(box => box[3])) }];
    }
    if (sql.includes('ST_MakeEnvelope')) {
      const [, , , , minX, minY, maxX, maxY, after, limit] = values;
      return this.features
        .filter(({ box }) => box[0] <= maxX && box[2] >= minX && box[1] <= maxY && box[3] >= minY)
        .filter(feature => after === null || feature.identifier > after)
        .sort((a, b) => (a.identifier < b.identifier ? -1 : 1)).slice(0, limit)
        .map(({ box, ...row }) => row);
    }
    return [];
  }

  query = async (sql: string, values: any[] = []) => {
    this.statements.push(sql);
    const rows = this.rows(sql, values);
    return { rows: structuredClone(rows), rowCount: rows.length };
  };
}

async function memory(work: (control: WindowControl) => Promise<void>) {
  const control = new WindowControl();
  const globals = globalThis as any;
  const previousPool = globals.ulpinPool;
  globals.ulpinPool = { query: control.query, connect: async () => ({ query: control.query, release() {} }) };
  try { await work(control); }
  finally { globals.ulpinPool = previousPool; }
}

const window = (input: Record<string, unknown>) => areaDisplayWindowSchema.parse(input);

test('the summary counts the area and states its extent in local metres', async () => memory(async control => {
  control.features = [square('b-1', 0, 0, 12), square('b-2', 40, -20, null)];
  assert.deepEqual(await areaDisplaySummary(control.area.id), {
    areaId: control.area.id, areaRevision: 4, featureCount: 2, extent: [0, -20, 50, 10], displayLimit: 10000,
  });
  control.features = [];
  assert.equal((await areaDisplaySummary(control.area.id)).extent, null);
  assert.ok(control.statements.includes("SET LOCAL statement_timeout='15s'"));
}));

test('a window returns only the features meeting it, keyset page by page without repeat or gap', async () =>
  memory(async control => {
    control.features = Array.from({ length: 7 }, (_, index) => square(`b-${index}`, index * 100, 0, 9));
    const seen: string[] = [];
    let after: string | undefined;
    do {
      const page = await areaDisplayWindow(control.area.id, window({ minX: 95, minY: 0, maxX: 505, maxY: 5, limit: 2,
        ...(after ? { after } : {}) }));
      assert.ok(page.features.length <= 2);
      seen.push(...page.features.map(feature => feature.identifier));
      after = page.next ?? undefined;
    } while (after);
    assert.deepEqual(seen, ['b-1', 'b-2', 'b-3', 'b-4', 'b-5']);
    const sql = control.statements.find(statement => statement.includes('ST_MakeEnvelope'))!;
    assert.match(sql, /ST_Intersects\(f\.geographic_geometry,win\.g\)/);
    assert.doesNotMatch(sql, /ST_Intersects\(ST_Transform\(f\.geographic_geometry/);
  }));

test('a window keeps an unstated height null and sends the outline in local metres', async () =>
  memory(async control => {
    control.features = [square('b-1', 0, 0, 12.5), square('b-2', 20, 0, null)];
    const { features, next, areaRevision } = await areaDisplayWindow(control.area.id,
      window({ minX: -1, minY: -1, maxX: 40, maxY: 20 }));
    assert.equal(next, null);
    assert.equal(areaRevision, 4);
    assert.deepEqual(features.map(feature => [feature.heightM, feature.heightState]),
      [[12.5, 'source_supported'], [null, 'unknown']]);
    assert.deepEqual(features[0].polygons, [[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]]);
  }));

test('a window limit outside 1 to 4,000 and an empty window are refused', () => {
  const edges = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  assert.equal(window(edges).limit, 2000);
  for (const limit of ['0', '4001', '2.5']) assert.throws(() => window({ ...edges, limit }));
  assert.throws(() => window({ ...edges, maxX: 0 }));
});

test('an area without a reference system answers 409 for both reads', async () => memory(async control => {
  control.area.reference = null;
  for (const read of [areaDisplaySummary(control.area.id),
    areaDisplayWindow(control.area.id, window({ minX: 0, minY: 0, maxX: 1, maxY: 1 }))]) {
    await assert.rejects(read, (error: any) => error.status === 409 && error.code === 'AREA_REFERENCE');
  }
}));
