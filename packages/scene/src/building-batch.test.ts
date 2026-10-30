import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferAttribute, Color, Mesh, Vector3, type LineSegments } from 'three';
import { SceneEngine } from './engine';
import { readPalette } from './palette';
import type { FootprintInput } from './types';

// Replace only the browser/GPU boundary, as in scene-contrast.test.ts: materials, geometry and the engine stay real.
vi.mock('three', async (original) => ({
  ...await original<typeof import('three')>(),
  WebGLRenderer: class {
    domElement = {
      style: {}, addEventListener() {}, removeEventListener() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1440, height: 900 }),
    };
    shadowMap = {};
    setClearColor() {}
    setPixelRatio() {}
    setSize() {}
    render() {}
  },
}));
vi.mock('three/addons/controls/OrbitControls.js', () => ({
  OrbitControls: class {
    target = new Vector3();
    mouseButtons = {};
    touches = {};
    addEventListener() {}
    update() {}
  },
}));
vi.mock('./warm-programs', () => ({ startProgramWarmUp: () => ({ settled: true }) }));

beforeEach(() => {
  const context = { fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
  vi.stubGlobal('requestAnimationFrame', vi.fn());
  vi.stubGlobal('ResizeObserver', class { observe() {} });
});
afterEach(() => vi.unstubAllGlobals());

type Engine = Pick<SceneEngine, keyof SceneEngine> & Record<string, any>;

function fixture(): Engine {
  const container = { clientWidth: 1440, clientHeight: 900, appendChild() {} } as unknown as HTMLElement;
  return new SceneEngine(container, { palette: readPalette({} as Element), reducedMotion: true }) as unknown as Engine;
}

// Synthetic test-only squares, 20 m apart along east.
function square(id: string, index: number, extra: Partial<FootprintInput> = {}): FootprintInput {
  const x = index * 20;
  return {
    id, heightM: 12, heightState: 'source_supported',
    polygons: [[[[x, 0], [x + 10, 0], [x + 10, 10], [x, 10], [x, 0]]]], ...extra,
  };
}

function drawAll(engine: Engine) {
  do engine.renderFrame(performance.now() + 1000);
  while (engine.buildingQueue.size);
}

const ownMesh = (engine: Engine, id: string) => engine.entries.get(id).meshes[0] as Mesh;
const batchOf = (engine: Engine, id: string) => engine.entries.get(id).batch;
const positions = (mesh: Mesh | LineSegments) => mesh.geometry.getAttribute('position') as BufferAttribute;
/** The same objects, by reference. */
const same = (objects: object[], expected: object[]) =>
  objects.length === expected.length && objects.every((object, index) => object === expected[index]);

/** The batch's copy of a member's body, in the order the members joined. */
function copyOf(engine: Engine, id: string, before: string[]): number[] {
  const start = before.reduce((sum, other) => sum + positions(ownMesh(engine, other)).count, 0);
  const count = positions(ownMesh(engine, id)).count;
  return Array.from(positions(batchOf(engine, id).mesh).array.slice(start * 3, (start + count) * 3));
}

function lookDown(engine: Engine, x: number, z: number) {
  engine.camera.position.set(x, 200, z + 0.001);
  engine.camera.lookAt(x, 0, z);
  engine.camera.updateMatrixWorld();
}

describe('batched footprint buildings', () => {
  it('draws resting buildings of one look as one mesh and one set of edges, and picks each by its id', () => {
    const engine = fixture();
    engine.setBuildings(['a', 'b', 'c'].map((id, i) => square(id, i)));
    drawAll(engine);
    const batch = batchOf(engine, 'a');
    expect(batchOf(engine, 'c')).toBe(batch);
    expect(same(engine.buildings.children, [batch.mesh, batch.lines])).toBe(true);
    expect(copyOf(engine, 'b', ['a'])).toEqual(Array.from(positions(ownMesh(engine, 'b')).array));
    expect(batch.mesh.geometry.drawRange.count).toBe(3 * positions(ownMesh(engine, 'a')).count);
    lookDown(engine, 25, -5);
    expect(engine.pick(720, 450)).toEqual({ kind: 'building', id: 'b' });
    lookDown(engine, 45, -5);
    expect(engine.pick(720, 450)).toEqual({ kind: 'building', id: 'c' });
  });

  it('recolours only the selected building, then only the old and the new selection', () => {
    const engine = fixture();
    engine.setBuildings(['a', 'b', 'c'].map((id, i) => square(id, i)));
    drawAll(engine);
    const batch = batchOf(engine, 'a');
    const geometry = batch.mesh.geometry;
    const vertices = positions(ownMesh(engine, 'a')).count;
    const range = (index: number) => ({ start: index * vertices * 3, count: vertices * 3 });
    const select = (buildingId: string) => {
      positions(batch.mesh).clearUpdateRanges();
      engine.setState({ mode: 'area', buildingId, levelId: null, spaceId: null, tool: 'select' });
      return positions(batch.mesh).updateRanges;
    };
    expect(select('b')).toEqual([range(1)]);
    expect(batch.mesh.material).toBe(engine.m.bldgContext);
    expect(ownMesh(engine, 'b').material).toBe(engine.m.selected);
    const selected = engine.entries.get('b');
    const drawn = [batch.mesh, batch.lines, selected.meshes[0], selected.edges[0]];
    expect(same(engine.buildings.children, drawn)).toBe(true);
    expect(new Set(copyOf(engine, 'b', ['a'])).size).toBeLessThanOrEqual(3);
    expect(select('c')).toEqual([range(1), range(2)]);
    expect(copyOf(engine, 'b', ['a'])).toEqual(Array.from(positions(ownMesh(engine, 'b')).array));
    expect(ownMesh(engine, 'b').parent).toBeNull();
    expect(ownMesh(engine, 'c').parent).toBe(engine.buildings);
    expect(batch.mesh.geometry).toBe(geometry);
  });

  it('keeps outcome colours in the batch of thematic buildings and lifts a hovered building', () => {
    const engine = fixture();
    // Two outcome colours, as Colour by link outcome sends them.
    const { critical, preview } = engine.options.palette;
    const outcomes = [square('b', 1, { color: critical }), square('c', 2, { color: preview })];
    engine.setBuildings([square('a', 0), ...outcomes, square('d', 3)]);
    drawAll(engine);
    const themed = batchOf(engine, 'b');
    expect(themed).not.toBe(batchOf(engine, 'a'));
    expect(themed.mesh.material).toBe(engine.m.themed);
    const colour = themed.mesh.geometry.getAttribute('color') as BufferAttribute;
    const vertices = positions(ownMesh(engine, 'b')).count;
    expect(new Color().fromBufferAttribute(colour, vertices).getHexString())
      .toBe(new Color(preview).getHexString());
    engine.hovered = 'a';
    engine.apply();
    expect(ownMesh(engine, 'a').material).toBe(engine.m.hover);
    expect(ownMesh(engine, 'a').parent).toBe(engine.buildings);
    expect(batchOf(engine, 'a').mesh.material).toBe(engine.m.bldg);
  });

  it('leaves untouched batches identical by reference when one building changes or leaves', () => {
    const engine = fixture();
    const unknown = { heightM: null, heightState: 'unknown' } as const;
    const inputs = [square('a', 0), square('b', 1), square('u', 2, unknown), square('v', 3, unknown)];
    engine.setBuildings(inputs);
    drawAll(engine);
    const hatch = batchOf(engine, 'u');
    const { mesh, lines } = hatch;
    const [geometry, edges] = [mesh.geometry, lines.geometry];
    const version = positions(mesh).version;
    engine.setBuildings([inputs[0]!, { ...inputs[1]!, heightM: 30 }, inputs[2]!, inputs[3]!]);
    drawAll(engine);
    engine.setBuildings([inputs[1]!, inputs[2]!, inputs[3]!]);
    drawAll(engine);
    expect(batchOf(engine, 'u')).toBe(hatch);
    expect(same([hatch.mesh, hatch.lines, hatch.mesh.geometry, hatch.lines.geometry], [mesh, lines, geometry, edges]))
      .toBe(true);
    expect(positions(mesh).version).toBe(version);
    expect(batchOf(engine, 'b').size).toBe(1);
    expect(copyOf(engine, 'b', [])).toEqual(Array.from(positions(ownMesh(engine, 'b')).array));
    engine.setBuildings([inputs[2]!, inputs[3]!]);
    expect(same(engine.buildings.children, [hatch.mesh, hatch.lines])).toBe(true);
  });

  it('draws a growing building as its own mesh until it has grown in', () => {
    const engine = fixture();
    engine.setBuildings([square('a', 0)], { growNew: true });
    engine.renderFrame(performance.now());
    expect(batchOf(engine, 'a')).toBeUndefined();
    expect(ownMesh(engine, 'a').parent).toBe(engine.buildings);
    engine.renderFrame(performance.now() + 1000);
    expect(ownMesh(engine, 'a').parent).toBeNull();
    expect(same(engine.buildings.children, [batchOf(engine, 'a').mesh, batchOf(engine, 'a').lines])).toBe(true);
  });
});

describe('the first draw', () => {
  it('draws nothing until the programs are warm, and keeps asking for a frame', () => {
    const engine = fixture();
    const render = vi.spyOn(engine.renderer, 'render');
    engine.programWarmUp = { settled: false, outcome: 'pending' };
    engine.renderFrame(performance.now());
    expect(render).not.toHaveBeenCalled();
    expect(requestAnimationFrame).toHaveBeenCalledWith(engine.renderFrame);
    engine.programWarmUp = { settled: true, outcome: 'ready' };
    engine.renderFrame(performance.now());
    expect(render).toHaveBeenCalledOnce();
  });
});
