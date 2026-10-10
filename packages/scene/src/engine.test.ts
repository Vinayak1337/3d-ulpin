import { describe, expect, it, vi } from 'vitest';
import { Group, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { SceneEngine } from './engine';
import { FLAT_THICKNESS_M, prismGeometry } from './geometry';
import type { ImageOverlayInput, MultiPolygon } from './types';

function imageMesh(role?: 'ground'): Mesh {
  // Exercise the engine's actual overlay builder without a browser/WebGL renderer.
  const overlays = new Group();
  const engine = Object.assign(Object.create(SceneEngine.prototype), {
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
