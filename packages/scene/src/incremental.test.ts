import { afterEach, describe, expect, it, vi } from 'vitest';
import { Box3, Group, MeshBasicMaterial, PerspectiveCamera, Vector2 } from 'three';
import { SceneEngine } from './engine';
import { padGeometry } from './look';
import type { FootprintInput } from './types';

// The real pad builder, counted: bulk removal must rebuild each touched pad batch once.
vi.mock('./look', async (importOriginal) => {
  const look = await importOriginal<typeof import('./look')>();
  return { ...look, padGeometry: vi.fn(look.padGeometry) };
});

// Exercise real geometry builders with the renderer boundary replaced, as in engine.test.ts.
function engineFixture() {
  const material = new MeshBasicMaterial();
  const engine = Object.assign(Object.create(SceneEngine.prototype), {
    programWarmUp: { settled: true },
    entries: new Map(), buildingBounds: new Map(), buildingInputs: new Map(), buildingEntries: new Map(),
    buildingQueue: new Map(), baseQueue: new Map(), renderedBuildings: new Set(), renderChanges: new Map(),
    drawWaiters: new Set(),
    storeyBuildings: new Map(), footprintPolygons: new Map(), pads: new Map(), buildings: new Group(),
    padBatches: new Map(), pendingPads: new Map(),
    dressing: new Group(), trees: new Group(), detail: new Group(), anchors: new Map(),
    baseInputs: [], renderedBase: new Set(), baseBox: new Box3(), arrivedBox: new Box3(),
    arrivalBounds: new Map(),
    areaBox: new Box3(), options: {}, state: { mode: 'area' }, cameraKey: '', dressingAt: -Infinity,
    m: { bldg: material, edge: material, pad: material }, requestRender: vi.fn(), apply: vi.fn(),
    fitGroundAndShadow: vi.fn(), buildDressing: vi.fn(), applyCamera: vi.fn(function () {
      engine.cameraKey = 'area';
    }),
  });
  return engine as Pick<SceneEngine, keyof SceneEngine> & Record<string, any>;
}

function building(id: string): FootprintInput {
  return {
    id, heightM: 12, heightState: 'source_supported',
    polygons: [[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]],
  };
}

function square(id: string, x: number, y: number, size = 10): FootprintInput {
  return {
    id, heightM: 12, heightState: 'source_supported',
    polygons: [[[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]]],
  };
}

function draw(engine: ReturnType<typeof engineFixture>) {
  // The starting engine builds synchronously; identity tests must reach their assertions there too.
  engine.drainBuildingQueue?.();
  engine.followArrivedContent?.();
  engine.finishDraw?.();
}

afterEach(() => vi.restoreAllMocks());

describe('whole-list incremental building reconciliation', () => {
  it('waits for warm-up and resumes after readiness, rejection or timeout without early acknowledgement', async () => {
    for (const outcome of ['ready', 'failed', 'timeout']) {
      const engine = engineFixture();
      engine.programWarmUp = { settled: false, outcome: 'pending' };
      engine.setBuildings([building('a')]);
      let completed = false;
      const waiting = engine.waitForDrawn(['a']).then((drawn) => { completed = drawn; });
      draw(engine);
      await Promise.resolve();
      expect(engine.buildingInputs.size).toBe(0);
      expect(engine.buildingQueue.size).toBe(1);
      expect(completed).toBe(false);
      engine.programWarmUp = { settled: true, outcome };
      draw(engine);
      await waiting;
      expect(engine.buildingInputs.has('a')).toBe(true);
      expect(completed).toBe(true);
    }
  });

  it('retains the exact mesh for the same object and an own-field-identical object', () => {
    const engine = engineFixture();
    const input = building('a');
    engine.setBuildings([input]);
    draw(engine);
    const mesh = engine.entries.get('a').meshes[0];
    engine.setBuildings([{ ...input }]);
    draw(engine);
    expect(engine.entries.get('a').meshes[0]).toBe(mesh);
  });

  it('builds only one new input and removes only the missing id', () => {
    const engine = engineFixture();
    const first = building('a');
    engine.setBuildings([first]);
    draw(engine);
    const mesh = engine.entries.get('a').meshes[0];
    const build = vi.spyOn(engine, 'addFootprintBuilding');
    engine.setBuildings([first, building('b')]);
    expect(build).not.toHaveBeenCalled();
    draw(engine);
    expect(build).toHaveBeenCalledTimes(1);
    const dispose = vi.spyOn(mesh.geometry, 'dispose');
    engine.setBuildings([engine.buildingInputs.get('b')]);
    expect(dispose).toHaveBeenCalledOnce();
    expect(engine.buildings.children).not.toContain(mesh);
    expect(engine.entries.has('a')).toBe(false);
    expect(engine.areaBox.equals(engine.buildingBounds.get('b'))).toBe(true);
  });

  it('merges pads per drained batch and rebuilds only the batch of a removed building', () => {
    const engine = engineFixture();
    const inputs = ['a', 'b', 'c'].map(building);
    engine.setBuildings(inputs);
    draw(engine);
    expect(engine.padBatches.size).toBe(1);
    const batch = engine.pads.get('a');
    expect(engine.pads.get('b')).toBe(batch);
    const originalVertices = batch.geometry.getAttribute('position').count;
    engine.setBuildings([...inputs, building('d')]);
    draw(engine);
    const otherBatch = engine.pads.get('d');
    expect(engine.padBatches.size).toBe(2);
    engine.setBuildings([inputs[1]!, inputs[2]!, engine.buildingInputs.get('d')]);
    expect(engine.pads.has('a')).toBe(false);
    expect(batch.geometry.getAttribute('position').count).toBeLessThan(originalVertices);
    expect(engine.pads.get('d')).toBe(otherBatch);
    engine.setBuildings([]);
    expect(engine.padBatches.size).toBe(0);
  });

  it('rebuilds a changed drawn input immediately, leaving its neighbour untouched', () => {
    const engine = engineFixture();
    const first = building('a');
    const second = building('b');
    engine.setBuildings([first, second]);
    draw(engine);
    const neighbour = engine.entries.get('b').meshes[0];
    const previous = engine.entries.get('a').meshes[0];
    engine.setBuildings([{ ...first, heightM: 15 }, second]);
    expect(engine.entries.get('a').meshes[0]).not.toBe(previous);
    expect(engine.entries.get('b').meshes[0]).toBe(neighbour);
    expect(engine.buildingQueue.size).toBe(0);
  });

  it('spends 4 ms per frame, in list order, and starts grow-in only on insertion', () => {
    const engine = engineFixture();
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const original = engine.addBuilding.bind(engine);
    vi.spyOn(engine, 'addBuilding').mockImplementation((...args: unknown[]) => {
      const result = original(...args);
      clock += 2;
      return result;
    });
    engine.setBuildings(['a', 'b', 'c'].map(building), { growNew: true });
    expect(engine.project('c')).toBeNull();
    expect(engine.drawnBuildings().count).toBe(0);
    draw(engine);
    expect([...engine.buildingInputs.keys()]).toEqual(['a', 'b']);
    expect(clock).toBe(4);
    expect(engine.entries.get('a').grow).toBe(0);
    draw(engine);
    expect(engine.entries.get('c').grow).toBe(4);
    expect(engine.drawnBuildings().count).toBe(3);
    expect(engine.applyCamera).toHaveBeenCalledOnce();
  });

  it('replaces queued truth and never builds an id removed before its frame', () => {
    const engine = engineFixture();
    engine.setBuildings([building('a')]);
    engine.setBuildings([building('b')]);
    draw(engine);
    expect(engine.buildingInputs.has('a')).toBe(false);
    expect(engine.buildingInputs.has('b')).toBe(true);
  });

  it('waits for a rendered frame, then calls the drain callback', async () => {
    const engine = engineFixture();
    engine.options.onBuildingsDrawn = vi.fn();
    engine.setBuildings([building('a')]);
    let completed = false;
    const waiting = engine.waitForDrawn(['a']).then((drawn) => { completed = drawn; });
    engine.drainBuildingQueue();
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(engine.options.onBuildingsDrawn).not.toHaveBeenCalled();
    engine.finishDraw();
    await waiting;
    expect(completed).toBe(true);
    expect(engine.options.onBuildingsDrawn).toHaveBeenCalledOnce();
  });

  it('promotes a queued detail target before creating its spaces', () => {
    const engine = engineFixture();
    engine.setBuildings([building('a'), building('b')]);
    engine.setBuildingDetail({ buildingId: 'b', levels: [] });
    expect(engine.buildingInputs.has('b')).toBe(true);
    expect(engine.buildingInputs.has('a')).toBe(false);
    expect(engine.buildingQueue.has('b')).toBe(false);
  });

  it('does not pick or label promoted geometry until its first rendered frame', () => {
    const engine = engineFixture();
    const intersectObjects = vi.fn((targets: Group[]) => {
      const mesh = targets.find((target) => target.userData.entry?.buildingId === 'b');
      return mesh ? [{ object: mesh, point: { y: 0 } }] : [];
    });
    Object.assign(engine, {
      container: { clientWidth: 1440, clientHeight: 900 }, camera: new PerspectiveCamera(),
      pointer: new Vector2(), ground: new Group(),
      renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1440, height: 900 }) } },
      raycaster: { setFromCamera: vi.fn(), intersectObjects },
    });
    engine.setBuildings([building('a'), building('b')]);
    engine.setBuildingDetail({ buildingId: 'b', levels: [] });
    expect(engine.project('b')).toBeNull();
    expect(engine.pick(100, 100)).toEqual({ kind: 'ground' });
    engine.finishDraw();
    expect(engine.project('b')).not.toBeNull();
    expect(engine.pick(100, 100)).toEqual({ kind: 'building', id: 'b' });
  });

  it('drops queued work and settles waiters on disposal', async () => {
    const engine = engineFixture();
    Object.assign(engine, {
      resizeObserver: { disconnect: vi.fn() }, tilesets: new Set(), scene: new Group(),
      spaceMaterials: new Map(), sky: { dispose: vi.fn() }, controls: { dispose: vi.fn() },
      renderer: { dispose: vi.fn(), domElement: { removeEventListener: vi.fn(), remove: vi.fn() } },
      setOverlays: vi.fn(), setSurfaceParts: vi.fn(),
    });
    engine.setBuildings([building('a')]);
    const waiting = engine.waitForDrawn(['a']);
    engine.dispose();
    expect(await waiting).toBe(false);
    expect(engine.buildingQueue.size).toBe(0);
    engine.setBuildings([building('b')]);
    expect(engine.buildingQueue.size).toBe(0);
  });

  it('guards identical base inputs without disposing or rebuilding the base', () => {
    const engine = engineFixture();
    const base = { id: 'road', kind: 'road', polygons: building('a').polygons };
    engine.baseInputs = [base];
    engine.setBase([{ ...base }] as never);
    expect(engine.buildDressing).not.toHaveBeenCalled();
    expect(engine.requestRender).not.toHaveBeenCalled();
  });
});

describe('bulk removal when a view replaces the drawn buildings', () => {
  // Three pad batches of ten squares each; a frozen clock lets each drain take its whole queue as one batch.
  const batches = ['a', 'b', 'c'].map((prefix, row) =>
    Array.from({ length: 10 }, (_, i) => square(`${prefix}${i}`, i * 20, row * 20)));

  function batchedEngine() {
    const engine = engineFixture();
    engine.plateFor = null;
    let shown: FootprintInput[] = [];
    for (const batch of batches) {
      shown = [...shown, ...batch];
      engine.setBuildings(shown);
      draw(engine);
    }
    return { engine, all: shown };
  }

  function snapshot(engine: ReturnType<typeof engineFixture>) {
    const pads = engine.dressing.children as any[];
    return {
      children: engine.buildings.children.map((child: any) => [child.type, child.userData.entry?.id, child.parent === engine.buildings,
        Array.from(child.geometry.getAttribute('position').array)]),
      entries: [...engine.entries.keys()], inputs: [...engine.buildingInputs.entries()],
      buildingEntries: [...engine.buildingEntries.keys()], bounds: [...engine.buildingBounds.entries()],
      storeys: [...engine.storeyBuildings.keys()], footprints: [...engine.footprintPolygons.entries()],
      renderChanges: [...engine.renderChanges.entries()], pendingPads: [...engine.pendingPads.keys()],
      pads: [...engine.pads.entries()].map(([id, pad]) => [id, pads.indexOf(pad)]),
      padBatches: [...engine.padBatches.entries()].map(([pad, inputs]) => [pads.indexOf(pad), [...inputs.keys()]]),
      padGeometry: pads.map((pad) => Array.from(pad.geometry.getAttribute('position').array)),
      plateFor: engine.plateFor, dressingDirty: engine.dressingDirty,
    };
  }

  it('rebuilds each touched pad batch once and leaves the scene as removing one by one does', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const bulk = batchedEngine();
    const single = batchedEngine();
    // Keep a0-a4 and the c row; drop a5-a9 and the whole b row; change c0.
    const target = [...bulk.all.slice(0, 5), { ...bulk.all[20]!, heightM: 15 }, ...bulk.all.slice(21)];
    for (const engine of [bulk.engine, single.engine]) engine.plateFor = 'b3';
    const gone = bulk.all.filter((input) => !target.some((kept) => kept.id === input.id));
    let remaining = single.all;
    for (const input of gone) {
      remaining = remaining.filter((kept) => kept.id !== input.id);
      single.engine.setBuildings(remaining);
    }
    single.engine.setBuildings(target);
    vi.mocked(padGeometry).mockClear();
    bulk.engine.setBuildings(target);
    // Batch a keeps five inputs and batch c keeps nine: one rebuild each. Batch b empties and is
    // dropped without a rebuild. The changed c0 then flushes as one new batch.
    expect(padGeometry).toHaveBeenCalledTimes(3);
    expect(snapshot(bulk.engine)).toEqual(snapshot(single.engine));
    expect(bulk.engine.plateFor).toBeNull();
    expect(bulk.engine.padBatches.size).toBe(3);
  });

  it('re-adds removed ids on a later view', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const { engine, all } = batchedEngine();
    const before = snapshot(engine);
    engine.setBuildings(all.slice(25));
    expect(engine.buildings.children).toHaveLength(10);
    engine.setBuildings(all);
    draw(engine);
    const after = snapshot(engine);
    expect(new Set(after.entries)).toEqual(new Set(before.entries));
    expect(after.children).toHaveLength(before.children.length);
    expect(after.pads.map(([id]) => id).sort()).toEqual(before.pads.map(([id]) => id).sort());
    expect(engine.drawnBuildings().count).toBe(30);
    expect(all.every((input) => engine.drawnBuildings().has(input.id))).toBe(true);
  });

  it('drops a batch whose remaining footprints draw no pad, then removes them cleanly', () => {
    const engine = engineFixture();
    // A two-point ring builds a building but no pad.
    const sliver: FootprintInput = { ...building('z'), polygons: [[[[0, 0], [1, 0], [0, 0]]]] };
    engine.setBuildings([building('a'), sliver]);
    draw(engine);
    expect(engine.pads.get('z')).toBe(engine.pads.get('a'));
    engine.setBuildings([sliver]);
    expect(engine.padBatches.size).toBe(0);
    expect(engine.pads.size).toBe(0);
    expect(() => engine.setBuildings([])).not.toThrow();
    expect(engine.buildings.children).toHaveLength(0);
  });

  // Timing only (SCENE_TIMING=1): replace 15,000 synthetic test-only squares drawn in 40-building pad batches.
  // The package has no Node types; Vitest runs in Node, where `process` exists.
  const timing = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.SCENE_TIMING;
  it.runIf(timing)('times replacing 15,000 drawn buildings', () => {
    const wallClock = performance.now.bind(performance);
    const grid = (prefix: string) => Array.from({ length: 15_000 }, (_, i) =>
      square(`${prefix}${i}`, (i % 123) * 20, Math.floor(i / 123) * 20));
    const drawn = grid('old');
    const result: Record<string, unknown> = { buildings: drawn.length };
    for (const [name, next] of [
      ['replace_all', grid('new')],
      ['keep_every_other', drawn.filter((_, i) => i % 2 === 0)],
    ] as const) {
      const engine = engineFixture();
      engine.plateFor = null;
      let clock = 0;
      const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
      const original = engine.addBuilding.bind(engine);
      vi.spyOn(engine, 'addBuilding').mockImplementation((...args: unknown[]) => {
        clock += 0.1;
        return original(...args);
      });
      engine.setBuildings(drawn);
      while (engine.buildingQueue.size) draw(engine);
      now.mockRestore();
      const batches = engine.padBatches.size;
      vi.mocked(padGeometry).mockClear();
      const started = wallClock();
      engine.setBuildings(next);
      const ms = wallClock() - started;
      result[name] = {
        removed: drawn.length - engine.buildingInputs.size, padBatches: batches,
        padGeometryCalls: vi.mocked(padGeometry).mock.calls.length, ms: Math.round(ms),
      };
    }
    console.log(`SCENE_TIMING ${JSON.stringify(result)}`);
  }, 1_800_000);
});
