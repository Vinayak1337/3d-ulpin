import { describe, expect, it, vi } from 'vitest';
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
    buildingQueue: new Map(),
    apply: vi.fn(), setLook: vi.fn(), buildDressing: vi.fn(), followArrivedContent: vi.fn(), requestRender: vi.fn(),
  });
  return engine as Pick<SceneEngine, keyof SceneEngine> & Record<string, any>;
}

function feature(id: string, kind: BaseFeatureInput['kind'] = 'road', surface?: string): BaseFeatureInput {
  return { id, kind, surface, name: id, polygons: [[[[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]]] };
}

describe('base whole-list incremental reconciliation', () => {
  it('retains old surfaces and line batches when a new part arrives', () => {
    const engine = fixture();
    const road = feature('road');
    engine.setBase([road]);
    const first = engine.baseEntries.get('road');
    const mesh = first.mesh;
    const kerb = first.batch.roadKerbs;
    engine.setBase([{ ...road }, feature('land', 'public_land')]);
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
    engine.setBase([...inputs, feature('later')]);
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
    const kerbs = engine.baseEntries.get('road').batch.roadKerbs;
    engine.setBase([road, feature('walk', 'road', 'sidewalk')]);
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
    const mesh = engine.utilityMeshes.get('pipe').mesh;
    const waiting = engine.waitForDrawn([], ['pipe']);
    engine.setBase([utility, feature('land', 'public_land')]);
    expect(engine.utilityMeshes.get('pipe').mesh).toBe(mesh);
    engine.finishDraw();
    expect(await waiting).toBe(true);
    engine.setBase([]);
    expect(engine.utilities.children).toHaveLength(0);
    expect(engine.anchors.has('utility:pipe')).toBe(false);
    engine.finishDraw();
    expect(engine.renderedBase.size).toBe(0);
  });
});
