import { afterEach, describe, expect, it, vi } from 'vitest';
import { Box3, Group, LineBasicMaterial, MeshBasicMaterial } from 'three';
import { SceneEngine } from './engine';
import type { BaseFeatureInput } from './types';

function fixture() {
  const fill = new MeshBasicMaterial();
  const line = new LineBasicMaterial();
  const engine = Object.assign(Object.create(SceneEngine.prototype), {
    baseInputs: [], baseEntries: new Map(), baseBatches: new Set(), utilityMeshes: new Map(),
    base: new Group(), kerbs: new Group(), utilities: new Group(), trees: new Group(),
    anchors: new Map(), anchorSizes: new Map(), raised: [], lands: [], utilityInputs: [],
    baseBox: new Box3(), arrivedBox: new Box3(), state: { mode: 'area' }, lookName: 'enhanced',
    m: { publicLand: fill, road: fill, sidewalk: fill, water: fill, court: fill,
      parcel: line, kerb: line, kerbEdge: line },
    layers: { roads: true, parcels: true, publicLand: true, trees: true },
    options: { palette: { utilities: { water: '#000000' } } },
    renderedBase: new Set(), renderedBuildings: new Set(), renderChanges: new Map(), drawWaiters: new Set(),
    buildingQueue: new Map(), baseQueue: new Map(),
    apply: vi.fn(), setLook: vi.fn(), buildDressing: vi.fn(), followArrivedContent: vi.fn(), requestRender: vi.fn(),
  });
  return engine as Pick<SceneEngine, keyof SceneEngine> & Record<string, any>;
}

function feature(id: string, kind: BaseFeatureInput['kind'] = 'road', surface?: string): BaseFeatureInput {
  return { id, kind, surface, name: id, polygons: [[[[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]]] };
}

function draw(engine: ReturnType<typeof fixture>) {
  while (engine.baseQueue.size) engine.drainBaseQueue();
  engine.finishDraw();
}

afterEach(() => vi.restoreAllMocks());

describe('base whole-list incremental reconciliation', () => {
  it('defers surfaces, preserves batch order and lines, and acknowledges only the completed queue', async () => {
    const engine = fixture();
    const inputs = [feature('a'), feature('b'), feature('c')];
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const original = engine.addBaseEntry.bind(engine);
    vi.spyOn(engine, 'addBaseEntry').mockImplementation((...args: unknown[]) => {
      const result = original(...args);
      clock += 2;
      return result;
    });
    const lines = vi.spyOn(engine, 'rebuildBaseLines');
    engine.setBase(inputs);
    expect(engine.baseEntries.size).toBe(0);
    expect(engine.base.children).toHaveLength(0);
    let completed = false;
    const waiting = engine.waitForDrawn([], inputs.map((input) => input.id))
      .then((drawn) => { completed = drawn; });
    engine.drainBaseQueue();
    engine.finishDraw();
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(engine.drawnBuildings().pending).toBe(1);
    expect([...engine.baseEntries.keys()]).toEqual(['a', 'b']);
    expect(lines).not.toHaveBeenCalled();
    engine.drainBaseQueue();
    engine.finishDraw();
    await waiting;
    expect(completed).toBe(true);
    expect(lines).toHaveBeenCalledOnce();
    expect([...engine.baseEntries.keys()]).toEqual(['a', 'b', 'c']);
    expect(engine.base.children).toHaveLength(3);
    expect([...engine.anchors.keys()]).toEqual(['name:a', 'name:b', 'name:c']);
    expect(engine.anchors.get('name:a').toArray()).toEqual([10, 0.3, -10]);
    expect(engine.baseEntries.get('a').batch).toBe(engine.baseEntries.get('c').batch);
  });

  it('replaces pending truth, removes built ids immediately, and makes repeated calls free', () => {
    const engine = fixture();
    const inputs = [feature('built'), feature('drop'), feature('keep')];
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const original = engine.addBaseEntry.bind(engine);
    const build = vi.spyOn(engine, 'addBaseEntry').mockImplementation((...args: unknown[]) => {
      const result = original(...args);
      clock += 4;
      return result;
    });
    engine.setBase(inputs);
    engine.drainBaseQueue();
    expect(engine.baseEntries.has('built')).toBe(true);
    engine.setBase([inputs[2]!]);
    expect(engine.baseEntries.has('built')).toBe(false);
    expect([...engine.baseQueue.keys()]).toEqual(['keep']);
    const queue = engine.baseQueue;
    vi.mocked(engine.requestRender).mockClear();
    engine.setBase([{ ...inputs[2]! }]);
    expect(engine.baseQueue).toBe(queue);
    expect(engine.requestRender).not.toHaveBeenCalled();
    draw(engine);
    expect(build).toHaveBeenCalledTimes(2);
    expect([...engine.baseEntries.keys()]).toEqual(['keep']);
    expect(engine.baseBatches.size).toBe(1);
  });

  it('has the same meshes, bounds and anchors as building the full batch synchronously', () => {
    const engine = fixture();
    const synchronous = fixture();
    const inputs = [feature('road'), feature('walk', 'road', 'sidewalk'), feature('parcel', 'parcel')];
    engine.setBase(inputs);
    draw(engine);
    const batch = { inputs: new Map(), parcel: null, roadKerbs: null, sidewalkKerbs: null, lanes: null };
    synchronous.baseInputs = inputs;
    for (const input of inputs) synchronous.addBaseEntry(input, batch);
    synchronous.rebuildBaseLines(batch);
    synchronous.refreshBase();
    expect([...engine.baseEntries.keys()]).toEqual([...synchronous.baseEntries.keys()]);
    expect(engine.base.children.length).toBe(synchronous.base.children.length);
    expect(engine.kerbs.children.length).toBe(synchronous.kerbs.children.length);
    expect(engine.baseBox.equals(synchronous.baseBox)).toBe(true);
    expect([...engine.anchors]).toEqual([...synchronous.anchors]);
    for (const [id, entry] of engine.baseEntries) {
      const reference = synchronous.baseEntries.get(id);
      if (!entry.mesh) continue;
      expect(entry.mesh.geometry.getAttribute('position').array)
        .toEqual(reference.mesh.geometry.getAttribute('position').array);
    }
  });

  it('keeps derived land order equal to the wanted list without rebuilding unchanged surfaces', () => {
    const engine = fixture();
    const first = feature('first', 'public_land');
    const second = feature('second', 'public_land');
    engine.setBase([first, second]);
    draw(engine);
    const build = vi.spyOn(engine, 'addBaseEntry');
    engine.setBase([second, first]);
    expect(engine.lands.map((land: { id: string }) => land.id)).toEqual(['second', 'first']);
    expect(build).not.toHaveBeenCalled();
    expect(engine.baseQueue.size).toBe(0);
  });

  it('retains old surfaces and line batches when a new part arrives', () => {
    const engine = fixture();
    const road = feature('road');
    engine.setBase([road]);
    draw(engine);
    const first = engine.baseEntries.get('road');
    const mesh = first.mesh;
    const kerb = first.batch.roadKerbs;
    engine.setBase([{ ...road }, feature('land', 'public_land')]);
    draw(engine);
    expect(engine.baseEntries.get('road').mesh).toBe(mesh);
    expect(engine.baseEntries.get('road').batch.roadKerbs).toBe(kerb);
    expect(engine.baseBatches.size).toBe(2);
    expect(engine.lands).toHaveLength(1);
    expect(engine.hasRoads).toBe(true);
  });

  it('rebuilds only the changed feature and the line batch that held it', () => {
    const engine = fixture();
    const inputs = [feature('road'), feature('parcel', 'parcel')];
    engine.setBase(inputs);
    draw(engine);
    engine.setBase([...inputs, feature('later')]);
    draw(engine);
    const first = engine.baseEntries.get('road');
    const later = engine.baseEntries.get('later');
    const oldParcel = first.batch.parcel;
    engine.setBase([{ ...inputs[0]!, name: 'renamed' }, later.input]);
    expect(engine.baseEntries.get('road').mesh).not.toBe(first.mesh);
    expect(engine.baseEntries.get('later').mesh).toBe(later.mesh);
    expect(engine.baseEntries.get('later').batch.roadKerbs).toBe(later.batch.roadKerbs);
    expect(oldParcel.parent).toBeNull();
    expect(engine.anchors.has('name:parcel')).toBe(false);
    engine.setBase([]);
    expect(engine.baseBatches.size).toBe(0);
    expect(engine.baseBox.isEmpty()).toBe(true);
    expect(engine.hasRoads).toBe(false);
  });

  it('toggles fallback kerbs without rebuilding prior roads when sidewalks arrive or leave', () => {
    const engine = fixture();
    const road = feature('road');
    engine.setBase([road]);
    draw(engine);
    const kerbs = engine.baseEntries.get('road').batch.roadKerbs;
    engine.setBase([road, feature('walk', 'road', 'sidewalk')]);
    draw(engine);
    expect(engine.baseEntries.get('road').batch.roadKerbs).toBe(kerbs);
    expect(kerbs.visible).toBe(false);
    expect(engine.raised).toHaveLength(1);
    engine.setBase([road]);
    expect(kerbs.visible).toBe(true);
    expect(engine.raised).toHaveLength(0);
    engine.setLayers({ roads: false });
    expect(engine.kerbs.visible).toBe(false);
    expect(engine.baseEntries.get('road').mesh.visible).toBe(false);
  });

  it('retains utility meshes, removes their anchors and acknowledges base ids only after rendering', async () => {
    const engine = fixture();
    const utility = { ...feature('pipe', 'utility'), lowerM: -4, upperM: -3 };
    engine.setBase([utility]);
    draw(engine);
    const mesh = engine.utilityMeshes.get('pipe').mesh;
    const waiting = engine.waitForDrawn([], ['pipe']);
    engine.setBase([utility, feature('land', 'public_land')]);
    expect(engine.utilityMeshes.get('pipe').mesh).toBe(mesh);
    draw(engine);
    expect(await waiting).toBe(true);
    engine.setBase([]);
    expect(engine.utilities.children).toHaveLength(0);
    expect(engine.anchors.has('utility:pipe')).toBe(false);
    engine.finishDraw();
    expect(engine.renderedBase.size).toBe(0);
  });
});
