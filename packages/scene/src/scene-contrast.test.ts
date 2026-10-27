import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Color, Vector3, type Fog, type MeshStandardMaterial } from 'three';
import { SceneEngine } from './engine';
import { readPalette } from './palette';

// Replace only the browser/GPU boundary: lights, materials, geometry and engine methods remain real.
vi.mock('three', async (original) => ({
  ...await original<typeof import('three')>(),
  WebGLRenderer: class {
    domElement = { style: {}, addEventListener() {}, removeEventListener() {} };
    shadowMap = {};
    clear = new Color();
    setClearColor(c: Color) { this.clear.copy(c); }
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

const luminance = (c: Color) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
const contrast = (a: Color, b: Color) =>
  (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

function fixture() {
  const container = { clientWidth: 1440, clientHeight: 900, appendChild() {} } as unknown as HTMLElement;
  return new SceneEngine(container, { palette: readPalette({} as Element), reducedMotion: true });
}

describe('box diffuse contrast from the engine lighting and materials', () => {
  for (const look of ['plain', 'enhanced'] as const) {
    it(`${look}: separates sunlit wall, shaded wall, roof, ground and opaque edges`, () => {
      const engine = fixture();
      engine.setLook(look);
      // Test-only box with the real NYC source ID/height: uses the engine's actual enhanced facade tint.
      const entry = engine['addFootprintBuilding']({
        id: '353927', heightM: 10.207752, heightState: 'source_supported',
        polygons: [[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]],
      });
      engine['areaBox'].copy(entry.bounds);
      engine['fitGroundAndShadow']();
      const sun = engine['sun'], hemi = engine['hemi'], m = engine['m'];
      const direction = sun.position.clone().sub(sun.target.position).normalize();
      expect(direction.toArray()).toEqual([-0.5, Math.SQRT1_2, 0.5]);
      expect(sun.intensity / hemi.intensity).toBe(2);
      // Three's hemispherical irradiance plus direct Lambert diffuse (4% dielectric reflection).
      // This isolates the box faces; the Chromium proof separately covers facade shaders and antialiasing.
      const shade = (material: MeshStandardMaterial, normal: Vector3, tint = new Color(1, 1, 1)) => {
        const irradiance = hemi.groundColor.clone().lerp(hemi.color, normal.y * 0.5 + 0.5)
          .multiplyScalar(hemi.intensity)
          .add(sun.color.clone().multiplyScalar(sun.intensity * Math.max(0, normal.dot(direction))));
        return material.color.clone().multiply(tint).multiply(irradiance).multiplyScalar(0.96 / Math.PI);
      };
      const tint = look === 'enhanced'
        ? new Color().fromBufferAttribute(entry.meshes[0]!.geometry.getAttribute('color'), 0) : new Color(1, 1, 1);
      const lit = shade(m.bldg, new Vector3(-1, 0, 0), tint);
      const shaded = shade(m.bldg, new Vector3(1, 0, 0), tint);
      const roof = shade(m.bldg, new Vector3(0, 1, 0), tint);
      const ground = shade(m.ground, new Vector3(0, 1, 0));
      expect(luminance(roof)).toBeGreaterThan(luminance(lit));
      expect(luminance(lit)).toBeGreaterThan(luminance(shaded));
      expect(contrast(lit, ground)).toBeGreaterThanOrEqual(1.5);
      expect(contrast(m.edge.color, lit)).toBeGreaterThanOrEqual(3);
      const context = shade(m.bldgContext, new Vector3(-1, 0, 0), tint);
      expect(contrast(m.edgeContext.color, context)).toBeGreaterThanOrEqual(3);
      expect(m.edgeContext.opacity).toBe(1);
      const horizon = m.ground.color.clone().lerp(new Color(engine['options'].palette.halo), 0.25);
      expect(engine.scene.background).toEqual(horizon);
      expect((engine.scene.fog as Fog).color).toEqual(horizon);
      expect((engine.renderer as unknown as { clear: Color }).clear).toEqual(horizon);
      const before = direction.clone();
      engine['followSun']();
      expect(sun.position.clone().sub(sun.target.position).normalize().distanceTo(before)).toBeLessThan(1e-12);
      engine.setState({ mode: 'findings', buildingId: null, levelId: null, spaceId: null, tool: 'select' });
      expect([hemi.intensity, sun.intensity, sun.castShadow]).toEqual([2, 0.7, false]);
      expect(hemi.groundColor.getHexString()).toBe(look === 'enhanced' ? 'd6cfbf' : 'cfd6d4');
    });
  }

  it('hides the loading rectangle in the very frame that first draws a building', () => {
    const engine = fixture();
    engine.setAreaExtent([0, 0, 20, 10]);
    expect(engine['areaOutline'].visible).toBe(true);
    engine.setBuildings([{
      id: 'synthetic:box', heightM: null, heightState: 'unknown',
      polygons: [[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]],
    }]);
    expect(engine['areaOutline'].visible).toBe(true); // Queued is not drawn.
    engine['renderFrame'](performance.now());
    expect(engine['areaOutline'].visible).toBe(false);
    expect(engine.drawnBuildings().count).toBe(1);
  });

  it('keeps fog beyond both small and borough-sized frames, with a 10% reach margin', () => {
    const engine = fixture();
    for (const span of [20, 20_000]) {
      const bounds = { minX: 0, minY: 0, maxX: span, maxY: span };
      engine['clipForPose']([new Vector3(span, span, span), new Vector3()], bounds, 10, false);
      const fog = engine.scene.fog as Fog;
      expect(engine['framedReach']).toBeGreaterThan(0);
      expect(fog.near).toBeGreaterThanOrEqual(engine['framedReach'] * 1.1);
      expect(fog.far).toBeGreaterThan(fog.near);
      expect(fog.far).toBeLessThanOrEqual(engine.camera.far);
    }
  });
});
