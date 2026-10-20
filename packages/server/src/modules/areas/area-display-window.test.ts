import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { AreaWindowFeature } from '@ulpin/contracts';
import { areaDisplayWindowSchema } from './area-validation';
import { areaDisplaySummary, areaDisplayWindow } from './area-display-window';

type Row = {
  id: string; identifier: string; kind: string; height: unknown; geometry: unknown; box: number[]; revision: number;
  /** A draft row written with its outline in geographic_geometry. */
  outlined?: boolean;
};
type Source = { id: string; case_id: string; archived: boolean; site_id: string; sha256: string; revision: number };
type Package = { id: string; state: string; datasetNamespace: string; sourceRevisionIds: string[]; parts: [];
  features: Record<string, any>[]; quarantine?: object };

/** A square building of side 10 m with its south-west corner at (x, y) in the area's local metres. */
function square(identifier: string, x: number, y: number, height: number | null, revision = 1): Row {
  const ring = [[x, y], [x + 10, y], [x + 10, y + 10], [x, y + 10], [x, y]];
  return {
    id: randomUUID(), identifier, kind: 'building', box: [x, y, x + 10, y + 10], revision,
    height: { state: height === null ? 'unknown' : 'source_supported', value: height, unit: 'm' },
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}

/** The area's display reads against an in-memory store that applies the window, cursor and proposals the SQL is
 * given: recorded rows (revision above 0) less the proposed ones, and each proposal as its package holds it. */
class WindowControl {
  statements: string[] = [];
  area = { id: randomUUID(), site_id: randomUUID(), name: 'Window control', revision: 4, extent: [0, 0, 1, 1],
    reference: { anchor: [-79.05, 43.09], sourceCrs: 'EPSG:4326', verticalReference: 'unknown',
      analysisCrs: 'EPSG:32617', origin: [0, 0] } as object | null, geographic_extent: [0, 0, 1, 1] };
  features: Row[] = [];
  /** Newest first, as the package read orders them. */
  packages: Package[] = [];
  sources: Source[] = [];
  /** The case_id column of each package, by package id: the case of the source it cites. */
  cases = new Map<string, string>();

  /** A package of this area proposing the rows as they are given, citing a source of its own. */
  propose(state: string, rows: (Row & { areaId?: string; sourceKey?: string })[]) {
    const source = { id: randomUUID(), case_id: randomUUID(), archived: false, site_id: this.area.site_id,
      sha256: 'a'.repeat(64), revision: 1 };
    this.sources.push(source);
    const features = rows.map(({ box, outlined, ...row }) => ({ ...row, sourceKey: row.sourceKey ?? row.identifier,
      areaId: row.areaId ?? this.area.id, sourceRevisionId: source.id, geographicGeometry: row.geometry }));
    const pkg: Package = { id: randomUUID(), state, datasetNamespace: 'niagara', sourceRevisionIds: [source.id],
      parts: [], features };
    this.packages.push(pkg);
    this.cases.set(pkg.id, source.case_id);
    return pkg;
  }

  private drawn(packageIds: string[], featureIds: string[]) {
    const recorded = this.features.filter(row => row.revision > 0 && !featureIds.includes(row.id))
      .map(({ revision, ...row }) => ({ ...row, display_state: 'recorded', case_id: null }));
    const proposed = featureIds.map((id, index) => {
      const feature = this.packages.find(pkg => pkg.id === packageIds[index])!.features.find(row => row.id === id)!;
      const ring: number[][] = feature.geometry.coordinates[0];
      const xs = ring.map(([x]) => x), ys = ring.map(([, y]) => y);
      return { id, identifier: this.features.find(row => row.id === id)!.identifier, kind: feature.kind,
        height: feature.height, geometry: feature.geometry, display_state: 'unrecorded_proposal',
        case_id: this.cases.get(packageIds[index]),
        box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
    });
    return [...recorded, ...proposed];
  }

  private rows(sql: string, values: any[]): any[] {
    if (sql.includes('FROM map_areas a')) return [{ ...this.area, feature_count: this.features.length }];
    if (sql.includes('FROM import_packages WHERE area_id')) {
      assert.match(sql, /jsonb_agg/);
      const rule = ({ id, sourceKey, areaId, revision, sourceRevisionId }: Record<string, any>) =>
        ({ id, sourceKey, areaId, revision, sourceRevisionId });
      const packages = /LIMIT 30/.test(sql) ? this.packages.slice(0, 30) : this.packages;
      const kept = ({ id }: Record<string, any>) => {
        const row = this.features.find(feature => feature.id === id);
        return values.length === 1 || !row?.outlined || row.revision > 0 || meets(row.box, values.slice(4));
      };
      return packages.map(pkg => ({ body: { ...pkg, features: pkg.features.filter(kept).map(rule) } }));
    }
    if (sql.startsWith('SELECT id,revision FROM physical_features')) {
      return this.features.map(({ id, revision }) => ({ id, revision }));
    }
    if (sql.includes('FROM sources')) {
      const ids = Array.isArray(values[0]) ? values[0] : [values[0]];
      return this.sources.filter(source => ids.includes(source.id));
    }
    if (sql.includes('area_site')) {
      return [{ archived: false, site_id: this.area.site_id, area_site: this.area.site_id }];
    }
    if (sql.includes('ST_Extent')) {
      const drawn = this.drawn(values[4], values[5]);
      if (!drawn.length) return [{ feature_count: 0, min_x: null, min_y: null, max_x: null, max_y: null }];
      const boxes = drawn.map(feature => feature.box);
      return [{ feature_count: drawn.length, min_x: Math.min(...boxes.map(box => box[0])),
        min_y: Math.min(...boxes.map(box => box[1])), max_x: Math.max(...boxes.map(box => box[2])),
        max_y: Math.max(...boxes.map(box => box[3])) }];
    }
    if (sql.includes('ST_MakeEnvelope')) {
      const [, , , , minX, minY, maxX, maxY, after, limit, packageIds, featureIds] = values;
      return this.drawn(packageIds, featureIds)
        .filter(({ box }) => meets(box, [minX, minY, maxX, maxY]))
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

function meets(box: number[], [minX, minY, maxX, maxY]: number[]) {
  return box[0] <= maxX && box[2] >= minX && box[1] <= maxY && box[3] >= minY;
}

async function memory(work: (control: WindowControl) => Promise<void>) {
  const control = new WindowControl();
  const globals = globalThis as any;
  const previousPool = globals.ulpinPool;
  const previousSubject = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  globals.ulpinPool = { query: control.query, connect: async () => ({ query: control.query, release() {} }) };
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'area-display-window-test';
  try { await work(control); }
  finally {
    globals.ulpinPool = previousPool;
    if (previousSubject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previousSubject;
  }
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
    const sql = control.statements.find(statement => statement.startsWith('WITH win'))!;
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

/** Niagara's shape: recorded features beside reviewed packages not yet confirmed, newest package first. */
function proposals(control: WindowControl) {
  const recorded = square('r-1', 0, 0, 9), reproposed = square('r-2', 20, 0, 9), committed = square('c-1', 300, 0, 9);
  const moved = square('m-1', 400, 0, 9, 2), other = square('o-1', 600, 0, 9, 0);
  const [first, second, duplicate, withheld] = [square('p-1', 100, 0, 12, 0), square('p-2', 200, 0, null, 0),
    square('d-1', 300, 0, 9, 0), square('x-1', 500, 0, 9, 0)];
  control.features = [recorded, reproposed, committed, moved, first, second, duplicate, withheld];
  const reviewed = control.propose('REVIEWED', [first, second, { ...square('r-2', 25, 0, 9), id: reproposed.id },
    { ...square('m-1', 450, 0, 9), id: moved.id }, { ...other, areaId: randomUUID() }]);
  reviewed.quarantine = { version: 'gis-quarantine/1', total: 6, accepted: 5, rejected: 1,
    rejections: [{ featureIndex: 5, sourceKey: 'x-1', code: 'INVALID_GEOMETRY', reason: 'Ring not closed.' }],
    sourceSha256: 'a'.repeat(64), sourceId: reviewed.sourceRevisionIds[0], sourceRevision: 1,
    message: '5 of 6 source features accepted.', complete: false };
  control.propose('COMMITTED', [committed]);
  control.propose('REVIEWED', [{ ...duplicate, sourceKey: 'c-1' }, withheld]);
}

test('the summary counts recorded features and the proposals the context read draws, each once', async () =>
  memory(async control => {
    proposals(control);
    assert.deepEqual(await areaDisplaySummary(control.area.id), {
      areaId: control.area.id, areaRevision: 4, featureCount: 6, extent: [0, 0, 410, 10], displayLimit: 10000,
    });
  }));

test('a window pages recorded features and proposals together, each once and with its display state', async () =>
  memory(async control => {
    proposals(control);
    const seen: AreaWindowFeature[] = [];
    let after: string | undefined;
    do {
      const page = await areaDisplayWindow(control.area.id, window({ minX: -1, minY: -1, maxX: 700, maxY: 20, limit: 2,
        ...(after ? { after } : {}) }));
      assert.ok(page.features.length <= 2);
      seen.push(...page.features);
      after = page.next ?? undefined;
    } while (after);
    assert.deepEqual(seen.map(feature => [feature.identifier, feature.displayState]), [['c-1', 'recorded'],
      ['m-1', 'recorded'], ['p-1', 'unrecorded_proposal'], ['p-2', 'unrecorded_proposal'], ['r-1', 'recorded'],
      ['r-2', 'unrecorded_proposal']]);
    const corner = (identifier: string) => seen.find(feature => feature.identifier === identifier)!.polygons[0][0][0];
    assert.deepEqual([corner('m-1'), corner('r-2')], [[400, 0], [25, 0]]);
  }));

test('a quarantined package whose cited source is unavailable refuses both reads with 403', async () =>
  memory(async control => {
    const row = square('p-1', 0, 0, 9, 0);
    control.features = [row];
    const pkg = control.propose('REVIEWED', [row]);
    pkg.features[0].sourceRevisionId = randomUUID();
    pkg.quarantine = { version: 'gis-quarantine/1', total: 2, accepted: 1, rejected: 1,
      rejections: [{ featureIndex: 1, sourceKey: null, code: 'INVALID_GEOMETRY', reason: 'Ring not closed.' }],
      sourceSha256: 'a'.repeat(64), sourceId: pkg.sourceRevisionIds[0], sourceRevision: 1,
      message: '1 of 2 source features accepted.', complete: false };
    for (const read of [areaDisplaySummary(control.area.id),
      areaDisplayWindow(control.area.id, window({ minX: -1, minY: -1, maxX: 20, maxY: 20 }))]) {
      await assert.rejects(read, (error: any) => error.status === 403 && error.code === 'AREA_SOURCE_DENIED');
    }
  }));

/** Every proposal a window draws, page by page. */
async function drawnInWindow(control: WindowControl, edges: Record<string, number>) {
  const seen: AreaWindowFeature[] = [];
  let after: string | undefined;
  do {
    const page = await areaDisplayWindow(control.area.id, window({ ...edges, limit: 2, ...(after ? { after } : {}) }));
    seen.push(...page.features);
    after = page.next ?? undefined;
  } while (after);
  return seen;
}

/** How many proposals each window read passed to its SQL as chosen. */
function chosenCounts(values: unknown[][]) {
  return values.map(args => (args[11] as string[]).length);
}

test('a window draws the same proposals from draft outlines as from package bodies, and from both mixed', async () =>
  memory(async control => {
    const drafts = [0, 100, 200, 300].map(x => square(`p-${x}`, x, 0, 9, 0));
    control.features = drafts;
    control.propose('REVIEWED', drafts);
    const windowValues: unknown[][] = [];
    const query = control.query;
    control.query = async (sql, values = []) => {
      if (sql.startsWith('WITH win')) windowValues.push(values);
      return query(sql, values);
    };
    const edges = { minX: -1, minY: -1, maxX: 150, maxY: 20 };
    const answers = [];
    for (const outlined of [() => false, () => true, (index: number) => index % 2 === 0]) {
      drafts.forEach((row, index) => { row.outlined = outlined(index); });
      answers.push(await drawnInWindow(control, edges));
    }
    assert.deepEqual(answers[0].map(feature => [feature.identifier, feature.displayState]),
      [['p-0', 'unrecorded_proposal'], ['p-100', 'unrecorded_proposal']]);
    assert.deepEqual(answers[1], answers[0]);
    assert.deepEqual(answers[2], answers[0]);
    // The body path chooses all four for the SQL to place; the outlines leave the rule only those meeting the window.
    assert.deepEqual(chosenCounts(windowValues), [4, 2, 3]);
    const rule = control.statements.find(sql => sql.includes('FROM import_packages WHERE area_id'))!;
    assert.match(rule, /ST_Intersects\(geographic_geometry,ST_Transform\(ST_MakeEnvelope/);
  }));

test('a proposal names the case of its package, from an outline and from a body; a record names none', async () =>
  memory(async control => {
    const recorded = square('r-1', 0, 0, 9), outlined = { ...square('p-1', 20, 0, 9, 0), outlined: true };
    const old = square('p-2', 40, 0, 9, 0);
    control.features = [recorded, outlined, old];
    const [drawn, drafted] = [control.propose('REVIEWED', [outlined]), control.propose('REVIEWED', [old])];
    const seen = await drawnInWindow(control, { minX: -1, minY: -1, maxX: 60, maxY: 20 });
    assert.deepEqual(seen.map(feature => [feature.identifier, feature.caseId]), [['p-1', control.cases.get(drawn.id)],
      ['p-2', control.cases.get(drafted.id)], ['r-1', undefined]]);
    assert.ok(!('caseId' in seen[2]));
    const sql = control.statements.find(statement => statement.startsWith('WITH win'))!;
    assert.match(sql, /'recorded' display_state,NULL::uuid case_id/);
    assert.match(sql, /'unrecorded_proposal',\s+p\.case_id/);
  }));

test('a window over 35 packages draws the proposals of the oldest', async () => memory(async control => {
  const drafts = Array.from({ length: 35 }, (_, index) => ({ ...square(`p-${index}`, index * 100, 0, 9, 0),
    outlined: true }));
  control.features = drafts;
  for (const draft of drafts) control.propose('REVIEWED', [draft]);
  const oldest = await drawnInWindow(control, { minX: 3390, minY: -1, maxX: 3420, maxY: 20 });
  assert.deepEqual(oldest.map(feature => feature.identifier), ['p-34']);
  assert.equal((await drawnInWindow(control, { minX: -1, minY: -1, maxX: 3500, maxY: 20 })).length, 35);
  const rule = control.statements.find(sql => sql.includes('FROM import_packages WHERE area_id'))!;
  assert.doesNotMatch(rule, /LIMIT/);
}));

/** The store behind a pool whose connections record how they are released and cancelled, so a read the client
 * abandons can be seen to stop the statement and to give its connection back. `slow` holds the window statement
 * open until a cancel arrives, as a long statement would run in Postgres. */
async function pooled(work: (control: WindowControl, pool: PooledRecord) => Promise<void>) {
  return memory(async control => {
    const globals = globalThis as any;
    const record: PooledRecord = { slow: false, started: undefined as unknown as Promise<void>, released: [],
      cancelled: [], afterAbort: [] };
    let startedNow = () => {};
    record.started = new Promise<void>(resolve => { startedNow = resolve; });
    class Canceller {
      connection = { on() {} };
      cancel(client: any, query: unknown) { record.cancelled.push({ client, query }); client.unblock?.(); }
    }
    const connect = async () => {
      const client: any = {
        activeQuery: null, unblock: undefined, on() {}, once() {}, removeListener() {},
        release: (destroy?: boolean) => { record.released.push(destroy === true); },
        query: async (sql: string, values?: any[]) => {
          record.afterAbort.push(sql);
          if (sql === 'BEGIN' || sql.startsWith('BEGIN ') || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [] };
          if (sql.startsWith('SELECT set_config')) return { rows: [{ deadline_live: true }] };
          if (record.slow && sql.startsWith('WITH win')) {
            client.activeQuery = {};
            startedNow();
            await new Promise<void>(resolve => { client.unblock = resolve; });
            client.activeQuery = null;
            throw Object.assign(new Error('canceling statement'), { code: '57014' });
          }
          return control.query(sql, values);
        },
      };
      return client;
    };
    globals.ulpinPool = { ...globals.ulpinPool, connect, Client: Canceller, options: {} };
    await work(control, record);
  });
}
type PooledRecord = { slow: boolean; started: Promise<void>; released: boolean[];
  cancelled: { client: any; query: unknown }[]; afterAbort: string[] };

test('a window read the client abandons mid-statement is cancelled and its connection destroyed, not kept', async () =>
  pooled(async (control, record) => {
    control.features = [square('b-1', 0, 0, 9)];
    record.slow = true;
    const gone = new AbortController();
    const read = areaDisplayWindow(control.area.id, window({ minX: -1, minY: -1, maxX: 40, maxY: 20 }), gone.signal);
    const settled = assert.rejects(read);
    await record.started;
    const issued = record.afterAbort.length, at = Date.now();
    gone.abort();
    await settled;
    assert.ok(Date.now() - at < 500, 'the abandoned read rejects promptly');
    assert.equal(record.cancelled.length, 1, 'the running statement is cancelled in Postgres');
    assert.deepEqual(record.released, [true], 'the connection is destroyed once, never returned idle');
    assert.equal(record.afterAbort.length, issued, 'no further SQL runs after the abort');
  }));

test('a read that finishes keeps its body, returns its connection and ignores a later abort', async () =>
  pooled(async (control, record) => {
    control.features = [square('b-1', 0, 0, 9), square('b-2', 20, 0, null)];
    const edges = window({ minX: -1, minY: -1, maxX: 40, maxY: 20 });
    const plain = await areaDisplayWindow(control.area.id, edges);
    const gone = new AbortController();
    const bounded = await areaDisplayWindow(control.area.id, edges, gone.signal);
    gone.abort();
    assert.deepEqual(bounded, plain);
    assert.equal((await areaDisplaySummary(control.area.id, gone.signal).catch(error => error)).name, 'AbortError');
    assert.equal(record.cancelled.length, 0, 'an abort after the response cancels nothing');
    assert.deepEqual(record.released, [false, false], 'both finished reads returned their connection');
  }));
