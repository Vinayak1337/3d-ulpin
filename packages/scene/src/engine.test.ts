import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Group, LineDashedMaterial, LineSegments, Mesh, MeshBasicMaterial, PerspectiveCamera, Points, Raycaster, Vector3,
} from 'three';
import { SceneEngine } from './engine';
import { FLAT_THICKNESS_M, prismGeometry } from './geometry';
import type { ImageOverlayInput, MultiPolygon, PreviewOutlineInput, SurfacePartInput } from './types';

function imageMesh(role?: 'ground'): Mesh {
  // Exercise the engine's actual overlay builder without a browser/WebGL renderer.
  const overlays = new Group();
  const engine = Object.assign(Object.create(SceneEngine.prototype), {
    programWarmUp: { settled: true },
    overlays,
    renderer: { capabilities: { getMaxAnisotropy: () => 1 } },
    requestRender: vi.fn(),
  }) as SceneEngine;
  const image = {
    id: 'picture', kind: 'image', role,
    corners: [[-2, -2], [2, -2], [2, 2], [-2, 2]], image: {} as HTMLCanvasElement,
  } as ImageOverlayInput;
  engine.setOverlays([image]);
  return overlays.children[0] as Mesh;
}

const footprint: MultiPolygon = [[[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]]];

function distanceToSurface(mesh: Mesh): number {
  // A test-only clone restores mesh raycasting; the overlay itself must remain non-pickable.
  const surface = new Mesh(mesh.geometry, new MeshBasicMaterial());
  const ray = new Raycaster(new Vector3(0, 10, 0), new Vector3(0, -1, 0));
  return ray.intersectObject(surface)[0]!.distance;
}

describe('ground pictures below records', () => {
  it('keeps the flat footprint nearer to the camera than a picture at the same place', () => {
    const picture = imageMesh('ground');
    const building = new Mesh(prismGeometry(footprint, 0, FLAT_THICKNESS_M), new MeshBasicMaterial());
    expect(distanceToSurface(building)).toBeLessThan(distanceToSurface(picture));
    const material = picture.material as MeshBasicMaterial;
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(false);
    expect(material.transparent).toBe(false);
    expect(picture.renderOrder).toBeLessThan(-2); // Before selection plate, halo and all record meshes.
    expect(material.polygonOffset).toBe(false);
    expect(new Raycaster(new Vector3(0, 10, 0), new Vector3(0, -1, 0)).intersectObject(picture)).toEqual([]);
  });

  it('leaves an image with no role at its existing height and depth settings', () => {
    const picture = imageMesh();
    picture.geometry.computeBoundingBox();
    expect(picture.geometry.boundingBox!.min.y).toBeCloseTo(0.2);
    const material = picture.material as MeshBasicMaterial;
    expect(material.transparent).toBe(true);
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(true);
    expect(material.polygonOffsetFactor).toBe(-4);
    expect(material.polygonOffsetUnits).toBe(-4);
    expect(picture.renderOrder).toBe(0);
  });
});

describe('the ground the area window is read from', () => {
  const tan = Math.tan((32 * Math.PI) / 360);
  // The area preset's direction (camera.ts), and straight down with north up the screen.
  const AREA = new Vector3(112, 88, 134).normalize(), DOWN = new Vector3(0, 1, 1e-7).normalize();

  /** An engine whose camera looks at a target on the ground from where a 900 px high canvas reads `mpp`. */
  function posed(mpp: number, direction: Vector3, target = new Vector3(300, 0, -200)) {
    const camera = new PerspectiveCamera(32, 1440 / 900, 0.3, 1e9);
    const distance = (mpp * 900) / (2 * tan);
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    const engine = Object.assign(Object.create(SceneEngine.prototype), {
      camera, controls: { target }, raycaster: new Raycaster(),
    }) as SceneEngine;
    return { footprint: engine.viewFootprint(), distance, target: [target.x, -target.z] as const };
  }

  const size = (footprint: [number, number][]) => {
    const xs = footprint.map(([x]) => x), ys = footprint.map(([, y]) => y);
    return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)].map(Math.round);
  };

  it('reaches at most 1.5 camera distances from the target, at any pitch', () => {
    for (const direction of [AREA, DOWN, new Vector3(0, 0.05, 1).normalize()]) {
      const { footprint, distance, target } = posed(200 / 60, direction);
      for (const [x, y] of footprint) {
        expect(Math.hypot(x - target[0], y - target[1])).toBeLessThanOrEqual(distance * 1.5 + 1e-6);
      }
    }
  });

  it('covers the whole screen on the ground when looking down', () => {
    const mpp = 200 / 60;
    const { footprint, target } = posed(mpp, DOWN);
    for (const [x, y] of footprint) {
      expect(Math.abs(Math.abs(x - target[0]) - 720 * mpp)).toBeLessThan(0.01 * mpp);
      expect(Math.abs(Math.abs(y - target[1]) - 450 * mpp)).toBeLessThan(0.01 * mpp);
    }
  });

  // A scale bar reads S while S metres span at least 60 px; the widest view it reads S for is S / 60 m per px.
  // Looking down the window is the screen; at the area preset's pitch the 1.5-distance reach bounds it.
  it('gives these windows, east by north in metres, at the 100 m, 200 m, 500 m and 1 km scale bar', () => {
    const windows = [100, 200, 500, 1000].map((scale) =>
      [scale, size(posed(scale / 60, DOWN).footprint), size(posed(scale / 60, AREA).footprint)]);
    expect(windows).toEqual([
      [100, [2400, 1500], [5069, 5219]],
      [200, [4800, 3000], [10138, 10437]],
      [500, [12000, 7500], [25344, 26093]],
      [1000, [24000, 15000], [50688, 52186]],
    ]);
  });
});

describe('the read parts of a kept surface', () => {
  function surfaceEngine() {
    const surface = new Group();
    const engine = Object.assign(Object.create(SceneEngine.prototype), {
      surface, surfaceParts: new Map(), surfaceQueue: new Map(), options: { palette: { selected: '#1f6feb' } },
      programWarmUp: { settled: true }, requestRender: vi.fn(),
      renderer: { compileAsync: vi.fn(async () => undefined), initTexture: vi.fn() },
    }) as Pick<SceneEngine, keyof SceneEngine> & Record<string, any>;
    return { engine, surface };
  }
  const compiled = () => new Promise((resolve) => setTimeout(resolve));
  /** One frame's drain, then the settled program compile that adds its part. */
  async function drain(engine: Record<string, any>) {
    engine.drainSurfaceQueue();
    await compiled();
  }
  const square: SurfacePartInput['corners'] = [[0, 0], [10, 0], [10, 10], [0, 10]];

  afterEach(() => vi.restoreAllMocks());

  it('queues a synthetic 15-part backlog without building it and adds at most one part per frame', async () => {
    const { engine, surface } = surfaceEngine();
    // Synthetic test-only raster and point shapes; matches the rehearsal's 9 pictures and 6 point parts.
    const parts: SurfacePartInput[] = Array.from({ length: 15 }, (_, index) => ({
      id: `synthetic:${index}`, corners: square,
      ...(index < 9 ? { image: { width: 256, height: 256 } as HTMLCanvasElement } : {
        points: { positions: new Float32Array(8192 * 3), colors: new Float32Array(8192 * 3), sizeM: 0.6 },
      }),
    }));
    const started = performance.now();
    engine.setSurfaceParts(parts);
    const synchronousMs = performance.now() - started;
    expect(surface.children).toHaveLength(0);
    let largestConstructionMs = 0;
    for (let frame = 1; frame <= parts.length; frame++) {
      const frameStarted = performance.now();
      engine.drainSurfaceQueue();
      largestConstructionMs = Math.max(largestConstructionMs, performance.now() - frameStarted);
      await compiled();
      expect(surface.children).toHaveLength(frame);
    }
    const timing = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.PF1_TIMING;
    if (timing) console.info(JSON.stringify({ synchronousMs, largestConstructionMs, parts: parts.length }));
    const drawn = [...surface.children];
    engine.setSurfaceParts([...parts, { id: 'synthetic:next', corners: square }]);
    expect(surface.children).toEqual(drawn);
    await drain(engine);
    expect(surface.children.slice(0, 15)).toEqual(drawn);
    expect(surface.children).toHaveLength(16);
  });

  it('draws an under overview before tiles even when the overview arrives last or is replaced', async () => {
    const { engine, surface } = surfaceEngine();
    const tile: SurfacePartInput = { id: 'i:1', corners: square, image: {} as HTMLCanvasElement };
    const overview: SurfacePartInput = { ...tile, id: 'i:0', under: true };
    engine.setSurfaceParts([tile, overview]);
    await drain(engine);
    await drain(engine);
    const picture = (n: number) => surface.children[n]!.children[1] as Mesh;
    expect(picture(1).renderOrder).toBeLessThan(picture(0).renderOrder);
    expect(picture(0).renderOrder).toBe(-3);
    engine.setSurfaceParts([tile, { ...overview }]);
    await drain(engine);
    expect(picture(1).renderOrder).toBeLessThan(picture(0).renderOrder);
  });

  it('cancels queued parts that are hidden or closed before their frame and disposes changed parts once', async () => {
    const { engine, surface } = surfaceEngine();
    const a: SurfacePartInput = { id: 'synthetic:0', corners: square, image: {} as HTMLCanvasElement };
    const b: SurfacePartInput = { id: 'synthetic:1', corners: square };
    engine.setSurfaceParts([a, b]);
    await drain(engine);
    const image = surface.children[0]!.children[1] as Mesh;
    const geometry = vi.spyOn(image.geometry, 'dispose');
    const material = image.material as MeshBasicMaterial;
    const texture = vi.spyOn(material.map!, 'dispose');
    engine.setSurfaceParts([{ ...a }]);
    expect(geometry).toHaveBeenCalledOnce();
    expect(texture).toHaveBeenCalledOnce();
    await drain(engine);
    expect(surface.children.map((group) => group.userData.surface)).toEqual([a.id]);
    engine.setSurfaceParts([a, b]);
    engine.setSurfaceParts([]);
    await drain(engine);
    expect(surface.children).toHaveLength(0);
    expect(engine.surfaceQueue.size).toBe(0);
  });

  it('adds a part once its programs are compiled, and never a part removed while compiling', async () => {
    const { engine, surface } = surfaceEngine();
    const a: SurfacePartInput = { id: 'synthetic:0', corners: square, image: {} as HTMLCanvasElement };
    const b: SurfacePartInput = { id: 'synthetic:1', corners: square };
    engine.setSurfaceParts([a, b]);
    engine.drainSurfaceQueue();
    engine.drainSurfaceQueue();
    expect(engine.renderer.compileAsync).toHaveBeenCalledOnce();
    expect(surface.children).toHaveLength(0);
    await compiled();
    expect(surface.children.map((group) => group.userData.surface)).toEqual([a.id]);
    expect(engine.renderer.initTexture).toHaveBeenCalledWith((surface.children[0]!.children[1] as Mesh & {
      material: MeshBasicMaterial }).material.map);
    engine.drainSurfaceQueue();
    engine.setSurfaceParts([a]);
    await compiled();
    expect(surface.children.map((group) => group.userData.surface)).toEqual([a.id]);
  });

  it('adds and removes parts by id and keeps a part drawn while its input is the same', async () => {
    const { engine, surface } = surfaceEngine();
    const a: SurfacePartInput = { id: 'i:0', corners: square, image: {} as HTMLCanvasElement };
    const b: SurfacePartInput = { id: 'i:1', corners: square,
      points: { positions: Float32Array.of(2, 3, 0), colors: Float32Array.of(1, 0, 0), sizeM: 0.6 } };
    engine.setSurfaceParts([a]);
    await drain(engine);
    const first = surface.children[0]!;
    expect(first.children.map((child) => child.type)).toEqual(['LineLoop', 'Mesh']);
    engine.setSurfaceParts([a, b]);
    await drain(engine);
    expect(surface.children).toHaveLength(2);
    expect(surface.children[0]).toBe(first);
    const points = surface.children[1]!.children[1] as Points;
    expect(Array.from(points.geometry.getAttribute('position').array)).toEqual([2, Math.fround(0.05), -3]); // flat
    engine.setSurfaceParts([b]);
    expect(surface.children.map((group) => group.userData.surface)).toEqual(['i:1']);
    expect(new Raycaster(new Vector3(5, 10, -5), new Vector3(0, -1, 0)).intersectObject(surface, true)).toEqual([]);
  });
});

describe('the loading area extent', () => {
  function areaEngine(moved = false) {
    return Object.assign(Object.create(SceneEngine.prototype), {
      areaOutline: new Group(), buildingInputs: new Map(), baseEntries: new Map(), overlays: new Group(),
      surfaceParts: new Map(), options: { palette: { parcelLine: '#8c9c9a' } }, cameraKey: '',
      areaCameraMoved: moved, frameTarget: vi.fn(), requestRender: vi.fn(),
    }) as Pick<SceneEngine, keyof SceneEngine> & Record<string, any>;
  }

  it('draws one flat unpicked parcel-token rectangle, frames it once, replaces and clears it', () => {
    const engine = areaEngine();
    engine.setAreaExtent([0, 0, 20, 10]);
    const line = engine.areaOutline.children[0] as LineSegments;
    expect(engine.areaOutline.children).toHaveLength(1);
    expect(line.material).toBeInstanceOf(LineDashedMaterial);
    expect((line.material as LineDashedMaterial).color.getHexString()).toBe('8c9c9a');
    expect(line.geometry.getAttribute('position').count).toBe(8);
    line.geometry.computeBoundingBox();
    expect(line.geometry.boundingBox!.max.y).toBe(line.geometry.boundingBox!.min.y);
    expect(new Raycaster().intersectObject(engine.areaOutline, true)).toEqual([]);
    const dispose = vi.spyOn(line.geometry, 'dispose');
    engine.setAreaExtent([0, 0, 30, 10]);
    expect(dispose).toHaveBeenCalledOnce();
    expect(engine.frameTarget).toHaveBeenCalledOnce();
    engine.setAreaExtent(null);
    expect(engine.areaOutline.children).toEqual([]);
  });

  it('does not frame after navigation, on a null extent or over a drawn building', () => {
    const engine = areaEngine(true);
    engine.setAreaExtent(null);
    engine.setAreaExtent([0, 0, 20, 10]);
    expect(engine.frameTarget).not.toHaveBeenCalled();
    engine.buildingInputs.set('synthetic:drawn', {});
    engine.setAreaExtent([0, 0, 20, 10]);
    expect(engine.areaOutline.visible).toBe(false);
    expect(engine.frameTarget).not.toHaveBeenCalled();
  });
});

describe('the outlines read so far of a file still being read', () => {
  function previewEngine() {
    const preview = new Group();
    const engine = Object.assign(Object.create(SceneEngine.prototype), {
      preview, options: { palette: { selected: '#1f6feb', preview: '#1c5cab' } }, requestRender: vi.fn(),
    }) as Pick<SceneEngine, keyof SceneEngine>;
    return { engine, preview };
  }
  const ring: PreviewOutlineInput = { id: 'i:0', polygons: [[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]] };

  it('draws every ring as one dashed, flat, unpicked line set and replaces it whole', () => {
    const { engine, preview } = previewEngine();
    engine.setPreviewOutlines([ring, { id: 'i:1', polygons: [[[[20, 0], [30, 0], [30, 10]]]] }]);
    expect(preview.children).toHaveLength(1);
    const lines = preview.children[0] as LineSegments;
    expect(lines.material).toBeInstanceOf(LineDashedMaterial);
    expect((lines.material as LineDashedMaterial).color.getHexString()).toBe('1c5cab');
    // Four closed edges, and three for the ring the source left open: two points each, three numbers a point.
    expect(lines.geometry.getAttribute('position').count).toBe((4 + 3) * 2);
    lines.geometry.computeBoundingBox();
    expect(lines.geometry.boundingBox!.max.y - lines.geometry.boundingBox!.min.y).toBe(0);
    expect(new Raycaster(new Vector3(5, 10, -5), new Vector3(0, -1, 0)).intersectObject(preview, true)).toEqual([]);
    engine.setPreviewOutlines([ring]);
    expect(preview.children).toHaveLength(1);
    expect((preview.children[0] as LineSegments).geometry.getAttribute('position').count).toBe(4 * 2);
    engine.setPreviewOutlines([]);
    expect(preview.children).toEqual([]);
  });
});
