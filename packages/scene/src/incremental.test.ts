import { afterEach, describe, expect, it, vi } from 'vitest';
import { Box3, Group, MeshBasicMaterial, PerspectiveCamera, Vector2 } from 'three';
import { SceneEngine } from './engine';
import type { FootprintInput } from './types';

// Exercise real geometry builders with the renderer boundary replaced, as in engine.test.ts.
function engineFixture() {
  const material = new MeshBasicMaterial();
  const engine = Object.assign(Object.create(SceneEngine.prototype), {
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

function draw(engine: ReturnType<typeof engineFixture>) {
  // The starting engine builds synchronously; identity tests must reach their assertions there too.
  engine.drainBuildingQueue?.();
  engine.followArrivedContent?.();
  engine.finishDraw?.();
}

afterEach(() => vi.restoreAllMocks());

describe('whole-list incremental building reconciliation', () => {
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
      setOverlays: vi.fn(),
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
