import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BackSide, BufferGeometry, DirectionalLight, Fog, HemisphereLight, Material, Mesh, MeshStandardMaterial,
  PerspectiveCamera, Scene, type WebGLRenderer,
} from 'three';
import { startProgramWarmUp, warmProgramObjects, type WarmMaterials } from './warm-programs';

function materials(): WarmMaterials {
  const surface = new MeshStandardMaterial();
  return {
    ground: surface, sidewalk: surface, edge: new Material(), water: surface,
    kerb: new Material(), publicLand: surface, crown: surface, trunk: surface, bldg: surface,
  };
}

function rendererFixture(parallel: boolean) {
  const current = new WeakMap();
  let output: unknown = null;
  const uniforms = vi.fn();
  const attributes = vi.fn();
  const compile = vi.fn((objects: Scene) => {
    objects.traverse((object) => {
      if (object instanceof Mesh || 'material' in object) {
        current.set((object as Mesh).material, { currentProgram: {
          getUniforms: uniforms, getAttributes: attributes,
        } });
      }
    });
    return new Set();
  });
  const renderer = {
    extensions: { has: vi.fn(() => parallel) },
    compile,
    compileAsync: vi.fn(async (objects: Scene) => { compile(objects); }),
    getRenderTarget: vi.fn(() => output),
    setRenderTarget: vi.fn((target) => { output = target; }),
    properties: { get: (material: Material) => current.get(material) },
  };
  return { renderer: renderer as unknown as WebGLRenderer, compile, uniforms, attributes };
}

function clock() {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('program attribute carriers', () => {
  it('uses engine material identities and all color/depth variants without adding content to the scene', () => {
    const source = materials();
    const objects = warmProgramObjects(source);
    expect(objects.color).toHaveLength(9);
    expect(objects.depth).toHaveLength(3);
    expect((objects.color[0] as Mesh).material).toBe(source.ground);
    expect(objects.color.every((object) => object.parent === null)).toBe(true);
    expect(objects.depth.every((object) => object.parent === null)).toBe(true);
    const facade = (objects.color[8] as Mesh).geometry;
    expect(Object.keys(facade.attributes)).toEqual(['position', 'normal', 'uv', 'color', 'aSeed']);
    for (const object of objects.depth) expect((object as Mesh).material).toMatchObject({ side: BackSide });
    expect(objects.color[6]).toMatchObject({ isInstancedMesh: true, receiveShadow: true });
    expect(objects.color[7]).toMatchObject({ instanceColor: null });
    for (const geometry of objects.geometries) geometry.dispose();
  });
});

describe('one bounded warm-up', () => {
  it('uses real color lights and fog, a fogless shadow context, and restores the output target', async () => {
    clock();
    const fixture = rendererFixture(true);
    const scene = new Scene();
    scene.fog = new Fog('white', 260, 620);
    const sun = new DirectionalLight();
    sun.castShadow = true;
    scene.add(sun, new HemisphereLight());
    const children = [...scene.children];
    const state = startProgramWarmUp(fixture.renderer, new PerspectiveCamera(), scene, materials());
    expect(state.settled).toBe(false);
    expect(fixture.compile).not.toHaveBeenCalled();
    // The first frame still holds the engine's construction.
    await vi.advanceTimersByTimeAsync(16);
    expect(fixture.compile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(16);
    expect(state.outcome).toBe('ready');
    expect(fixture.compile).toHaveBeenCalledTimes(2);
    const colorCall = vi.mocked(fixture.renderer.compileAsync).mock.calls[0]!;
    const depthCall = vi.mocked(fixture.renderer.compileAsync).mock.calls[1]!;
    expect(colorCall[2]).toBe(scene);
    expect(depthCall[2]).toMatchObject({ fog: null });
    expect((depthCall[2] as Scene).children).toHaveLength(2);
    expect(scene.children).toEqual(children);
    expect(sun.parent).toBe(scene);
    expect(fixture.renderer.getRenderTarget()).toBeNull();
  });

  it('releases retained depth carriers when the engine building material is disposed', async () => {
    clock();
    const fixture = rendererFixture(true);
    const source = materials();
    const state = startProgramWarmUp(fixture.renderer, new PerspectiveCamera(), new Scene(), source);
    await vi.advanceTimersByTimeAsync(32);
    const depthGroup = vi.mocked(fixture.renderer.compileAsync).mock.calls[1]![0] as Scene;
    const dispose = depthGroup.children.map((object) =>
      vi.spyOn((object as Mesh).material as Material, 'dispose'));
    source.bldg.dispose();
    expect(dispose.every((spy) => spy.mock.calls.length === 1)).toBe(true);
    expect(state.outcome).toBe('ready');
  });

  it('cancels the pending carriers when the engine is disposed before the first compilation frame', async () => {
    clock();
    const fixture = rendererFixture(true);
    const source = materials();
    const state = startProgramWarmUp(fixture.renderer, new PerspectiveCamera(), new Scene(), source);
    source.bldg.dispose();
    await vi.advanceTimersByTimeAsync(16);
    expect(state).toMatchObject({ settled: true, outcome: 'failed' });
    expect(fixture.compile).not.toHaveBeenCalled();
  });

  it('without KHR compiles one object per frame and forces its uniform and attribute readiness', async () => {
    clock();
    const fixture = rendererFixture(false);
    const state = startProgramWarmUp(fixture.renderer, new PerspectiveCamera(), new Scene(), materials());
    await vi.advanceTimersByTimeAsync(16);
    expect(fixture.compile).toHaveBeenCalledOnce();
    expect(state.settled).toBe(false);
    expect(fixture.uniforms).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(16 * 11);
    expect(state.outcome).toBe('ready');
    expect(fixture.compile).toHaveBeenCalledTimes(12);
    expect(fixture.uniforms).toHaveBeenCalledTimes(12);
    expect(fixture.attributes).toHaveBeenCalledTimes(12);
    expect(fixture.renderer.compileAsync).not.toHaveBeenCalled();
  });

  it('fails open on rejection without leaving a compilation render target active', async () => {
    clock();
    const fixture = rendererFixture(true);
    vi.mocked(fixture.renderer.compileAsync).mockRejectedValue(new Error('compile failed'));
    const state = startProgramWarmUp(fixture.renderer, new PerspectiveCamera(), new Scene(), materials());
    await vi.advanceTimersByTimeAsync(32);
    expect(state).toMatchObject({ settled: true, outcome: 'failed' });
    expect(fixture.renderer.getRenderTarget()).toBeNull();
  });

  it('fails open at two seconds and does not overwrite timeout when late compilation resolves', async () => {
    clock();
    const fixture = rendererFixture(true);
    let finish!: () => void;
    const compilation = new Promise<void>((resolve) => { finish = resolve; });
    vi.mocked(fixture.renderer.compileAsync).mockImplementation(() => compilation as unknown as Promise<Scene>);
    const dispose = vi.spyOn(BufferGeometry.prototype, 'dispose');
    const state = startProgramWarmUp(fixture.renderer, new PerspectiveCamera(), new Scene(), materials());
    await vi.advanceTimersByTimeAsync(1999);
    expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(state).toMatchObject({ settled: true, outcome: 'timeout' });
    expect(dispose).toHaveBeenCalledTimes(3);
    finish();
    await vi.advanceTimersByTimeAsync(1);
    expect(state.outcome).toBe('timeout');
  });
});

