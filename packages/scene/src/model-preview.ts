import {
  AmbientLight, BufferGeometry, Color, DirectionalLight, DoubleSide, Float32BufferAttribute, LineBasicMaterial,
  LineSegments, Mesh, MeshLambertMaterial, PerspectiveCamera, Scene, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ScenePalette } from './types';

/**
 * S5.21. A mesh a native reader stored (glTF or OBJ), drawn in its own frame beside the reading: never placed on the
 * map, converted or measured. The values are drawn as stored; only the view is centred on them.
 */

/** The preview draws a model of at most this many stored positions; a larger one is described in words instead. */
export const MODEL_PREVIEW_MAX_POSITIONS = 50_000;

export interface ModelPreviewInput {
  /** Stored positions, in the file's own frame and unit. */
  positions: readonly (readonly [number, number, number])[];
  /** Each polygon as indices into `positions`, in stored order: a glTF triangle, or an OBJ face of 3 or more. */
  polygons: readonly (readonly number[])[];
}

export interface ModelPreviewGeometry {
  fill: BufferGeometry;
  edges: BufferGeometry;
  /** The display centre the geometry is drawn about; the stored values themselves are not changed. */
  centre: [number, number, number];
  radius: number;
  polygons: number;
  triangles: number;
}

/**
 * Display geometry for the polygons as stored. A face of more than three corners is filled as a fan from its first
 * corner for display only; its outline follows its stored corners. Throws on an index outside `positions`, a position
 * that is not three finite numbers, or a model past the cap.
 */
export function previewGeometry(input: ModelPreviewInput): ModelPreviewGeometry {
  const { positions, polygons } = input;
  if (positions.length > MODEL_PREVIEW_MAX_POSITIONS) throw new Error('The model is past the preview cap.');
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const polygon of polygons) {
    if (polygon.length < 3) throw new Error('A polygon has fewer than three corners.');
    for (const index of polygon) {
      const at = positions[index];
      if (!Number.isInteger(index) || !at) throw new Error('A polygon names a position that is not stored.');
      if (at.length !== 3 || !at.every(Number.isFinite)) throw new Error('A position is not three finite numbers.');
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis]!, at[axis]!);
        max[axis] = Math.max(max[axis]!, at[axis]!);
      }
    }
  }
  if (!polygons.length) throw new Error('There is no polygon to draw.');
  const centre = [0, 1, 2].map((axis) => (min[axis]! + max[axis]!) / 2) as [number, number, number];
  const radius = Math.hypot(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!) / 2;
  const corner = (index: number) => positions[index]!.map((value, axis) => value - centre[axis]!);
  const fill: number[] = [];
  const edges: number[] = [];
  let triangles = 0;
  for (const polygon of polygons) {
    for (let at = 1; at + 1 < polygon.length; at += 1) {
      fill.push(...corner(polygon[0]!), ...corner(polygon[at]!), ...corner(polygon[at + 1]!));
      triangles += 1;
    }
    polygon.forEach((index, at) => edges.push(...corner(index), ...corner(polygon[(at + 1) % polygon.length]!)));
  }
  const fillGeometry = new BufferGeometry();
  fillGeometry.setAttribute('position', new Float32BufferAttribute(fill, 3));
  // Non-indexed corners, so each triangle gets its own normal: flat shading.
  fillGeometry.computeVertexNormals();
  const edgeGeometry = new BufferGeometry();
  edgeGeometry.setAttribute('position', new Float32BufferAttribute(edges, 3));
  return { fill: fillGeometry, edges: edgeGeometry, centre, radius, polygons: polygons.length, triangles };
}

/** One orbitable, flat-lit view of one model; `dispose` releases every GPU resource, listener and the canvas. */
export class ModelPreview {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly geometry: ModelPreviewGeometry;
  private readonly materials: (MeshLambertMaterial | LineBasicMaterial)[];
  private readonly resize: ResizeObserver;
  private frame = 0;

  constructor(private readonly container: HTMLElement, input: ModelPreviewInput,
    palette: Pick<ScenePalette, 'ground' | 'building' | 'buildingEdge'>) {
    this.geometry = previewGeometry(input);
    const radius = this.geometry.radius || 1;
    const fill = new MeshLambertMaterial({ color: palette.building, side: DoubleSide, polygonOffset: true,
      polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const edge = new LineBasicMaterial({ color: palette.buildingEdge });
    this.materials = [fill, edge];
    this.scene.background = new Color(palette.ground);
    this.scene.add(new Mesh(this.geometry.fill, fill), new LineSegments(this.geometry.edges, edge));
    // Light from the south-west at 45 degrees, as the map's scene (docs/design-system/map-and-3d.md).
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(-1, Math.SQRT2, 1);
    this.scene.add(new AmbientLight(0xffffff, 1.2), sun);
    this.camera = new PerspectiveCamera(40, 1, radius / 100, radius * 100);
    this.camera.position.copy(new Vector3(1, 0.8, 1.2).normalize().multiplyScalar(radius * 3));
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.append(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.minDistance = radius / 10;
    this.controls.maxDistance = radius * 20;
    this.controls.addEventListener('change', this.request);
    this.resize = new ResizeObserver(this.fit);
    this.resize.observe(container);
    this.fit();
  }

  private readonly fit = () => {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.request();
  };

  private readonly request = () => {
    if (!this.frame) this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderer.render(this.scene, this.camera);
    });
  };

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.controls.removeEventListener('change', this.request);
    this.controls.dispose();
    this.geometry.fill.dispose();
    this.geometry.edges.dispose();
    for (const material of this.materials) material.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
