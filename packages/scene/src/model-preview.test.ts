import { describe, expect, it, vi } from 'vitest';
import { MODEL_PREVIEW_MAX_POSITIONS, ModelPreview, previewGeometry, type ModelPreviewInput } from './model-preview';

// test_only: a unit cube as six faces of four corners each, the shape of Box.glb's one primitive (24 positions,
// 36 indices); the values are a protocol control, not a dataset record.
const corners: [number, number, number][] = [];
for (const [axis, side] of [[2, 1], [2, -1], [0, 1], [0, -1], [1, 1], [1, -1]] as const) {
  for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const at = [0, 0, 0] as [number, number, number];
    at[axis] = side * 0.5;
    at[(axis + 1) % 3] = u * 0.5;
    at[(axis + 2) % 3] = v * 0.5;
    corners.push(at);
  }
}
const indices = Array.from({ length: 6 }, (_, face) => [0, 1, 2, 3, 2, 1].map(k => face * 4 + k)).flat();
const box: ModelPreviewInput = { positions: corners,
  polygons: Array.from({ length: 12 }, (_, at) => indices.slice(at * 3, at * 3 + 3)) };

describe('model preview geometry', () => {
  it('draws a Box-shaped triangle list as 12 flat-shaded triangles about its own centre', () => {
    const geometry = previewGeometry(box);
    expect(geometry.polygons).toBe(12);
    expect(geometry.triangles).toBe(12);
    expect(geometry.fill.getAttribute('position').count).toBe(36);
    expect(geometry.fill.getAttribute('normal').count).toBe(36);
    expect(geometry.edges.getAttribute('position').count).toBe(12 * 3 * 2);
    expect(geometry.centre).toEqual([0, 0, 0]);
    expect(geometry.radius).toBeCloseTo(Math.sqrt(3) / 2);
  });

  it('fills two OBJ quads as two polygons, outlined by their stored corners only', () => {
    // test_only: two faces of four corners far from the origin; drawn about their centre, values unchanged.
    const positions: [number, number, number][] = [[500_000, 10, 0], [500_004, 10, 0], [500_004, 10, 4],
      [500_000, 10, 4], [500_000, 13, 0], [500_004, 13, 0]];
    const input = { positions, polygons: [[0, 1, 2, 3], [0, 1, 5, 4]] };
    const geometry = previewGeometry(input);
    expect(geometry.polygons).toBe(2);
    expect(geometry.triangles).toBe(4);
    expect(geometry.edges.getAttribute('position').count).toBe(8 * 2);
    expect(geometry.centre).toEqual([500_002, 11.5, 2]);
    expect(Array.from(geometry.fill.getAttribute('position').array.slice(0, 3))).toEqual([-2, -1.5, -2]);
    expect(positions[0]).toEqual([500_000, 10, 0]);
  });

  it('refuses an index that is not stored, a value that is not finite, no polygon and a model past the cap', () => {
    expect(() => previewGeometry({ positions: corners, polygons: [[0, 1, 24]] })).toThrow('not stored');
    expect(() => previewGeometry({ positions: [[0, 0, 0], [1, Number.NaN, 0], [0, 1, 0]], polygons: [[0, 1, 2]] }))
      .toThrow('finite');
    expect(() => previewGeometry({ positions: corners, polygons: [[0, 1]] })).toThrow('three corners');
    expect(() => previewGeometry({ positions: corners, polygons: [] })).toThrow('no polygon');
    const many = Array.from({ length: MODEL_PREVIEW_MAX_POSITIONS + 1 }, (_, at) => [at, 0, 0] as [number, number,
      number]);
    expect(() => previewGeometry({ positions: many, polygons: [[0, 1, 2]] })).toThrow('cap');
    expect(MODEL_PREVIEW_MAX_POSITIONS).toBe(50_000);
  });
});

describe('model preview lifetime', () => {
  it('releases its geometry, materials, controls, renderer, observer and canvas on dispose', () => {
    // The real constructor needs WebGL; this exercises dispose on the fields it would hold.
    const geometry = previewGeometry(box);
    const fill = vi.spyOn(geometry.fill, 'dispose');
    const edges = vi.spyOn(geometry.edges, 'dispose');
    const material = { dispose: vi.fn() };
    const canvas = { remove: vi.fn() };
    const resize = { disconnect: vi.fn() };
    const controls = { removeEventListener: vi.fn(), dispose: vi.fn() };
    const renderer = { dispose: vi.fn(), domElement: canvas };
    const preview = Object.assign(Object.create(ModelPreview.prototype),
      { geometry, materials: [material, material], frame: 0, resize, controls, renderer }) as ModelPreview;
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    preview.dispose();
    vi.unstubAllGlobals();
    expect(fill).toHaveBeenCalledOnce();
    expect(edges).toHaveBeenCalledOnce();
    expect(material.dispose).toHaveBeenCalledTimes(2);
    expect(controls.dispose).toHaveBeenCalledOnce();
    expect(controls.removeEventListener.mock.calls[0]![0]).toBe('change');
    expect(resize.disconnect).toHaveBeenCalledOnce();
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(canvas.remove).toHaveBeenCalledOnce();
  });
});
