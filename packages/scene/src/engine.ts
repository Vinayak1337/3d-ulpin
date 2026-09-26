import {
  AmbientLight, CanvasTexture, Color, DirectionalLight, EdgesGeometry, Group, HemisphereLight, LineBasicMaterial,
  LineSegments, Mesh, MeshLambertMaterial, MeshStandardMaterial, PCFShadowMap, PerspectiveCamera, PlaneGeometry,
  Raycaster, RepeatWrapping, type BufferGeometry, Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer, type Material, type Object3D,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { TilesRenderer } from '3d-tiles-renderer';
import { boundsOf, footprintGeometry, hasKnownHeight } from './geometry';
import type { Bounds2D, CameraPreset, FootprintInput, ScenePalette, SceneStats } from './types';

export interface SceneEngineOptions {
  palette: ScenePalette;
  /** Called with the canonical record ID under the pointer on click (null for empty ground). */
  onPick?: (id: string | null) => void;
  onHover?: (id: string | null) => void;
  /** Called after every rendered frame whose camera changed, so HTML overlays can follow. */
  onView?: () => void;
  reducedMotion?: boolean;
}

interface FootprintEntry {
  input: FootprintInput;
  mesh: Mesh;
  edges: LineSegments;
  known: boolean;
}

const CAMERA_MS = 600;
const SELECT_OUTLINE_PX = 3;
const HOVER_OUTLINE_PX = 1.5;

/**
 * The Studio scene engine: an imperative Three.js scene the React adapter drives.
 * React never touches the render loop; the engine renders on demand (input, camera moves, tiles).
 */
export class SceneEngine {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;

  private readonly container: HTMLElement;
  private readonly options: SceneEngineOptions;
  private readonly footprints = new Map<string, FootprintEntry>();
  private readonly footprintGroup = new Group();
  private readonly tilesets = new Set<TilesRenderer>();
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly sun: DirectionalLight;
  private readonly ground: Mesh;
  private readonly materials: { known: MeshStandardMaterial; unknown: MeshLambertMaterial; selected: MeshStandardMaterial; edge: LineBasicMaterial };
  private readonly selectOutline: LineSegments2;
  private readonly hoverOutline: LineSegments2;
  private readonly resizeObserver: ResizeObserver;
  private selectedId: string | null = null;
  private hoveredId: string | null = null;
  private frameRequested = false;
  private disposed = false;
  private flight: { from: [Vector3, Vector3]; to: [Vector3, Vector3]; start: number } | null = null;
  private frameTimes: number[] = [];
  private frames = 0;
  private downAt: { x: number; y: number } | null = null;

  constructor(container: HTMLElement, options: SceneEngineOptions) {
    this.container = container;
    this.options = options;
    const { palette } = options;

    this.renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.setClearColor(new Color(palette.ground));
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.camera = new PerspectiveCamera(35, 1, 0.5, 200_000);
    this.camera.position.set(-150, 180, 150);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.screenSpacePanning = false;
    this.controls.addEventListener('start', () => { this.flight = null; });
    this.controls.addEventListener('change', () => this.requestRender());

    // Light from the south-west at 45°, soft shadows, no sky gradient (map-and-3d.md, Base scene).
    this.scene.add(new HemisphereLight(0xffffff, new Color(palette.buildingEdge), 1.1));
    this.scene.add(new AmbientLight(0xffffff, 0.15));
    this.sun = new DirectionalLight(0xffffff, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.radius = 4;
    this.scene.add(this.sun, this.sun.target);

    this.ground = new Mesh(new PlaneGeometry(1, 1), new MeshLambertMaterial({ color: palette.ground }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.ground.userData.ground = true;
    this.scene.add(this.ground);

    this.materials = {
      known: new MeshStandardMaterial({ color: palette.building, roughness: 0.9, metalness: 0 }),
      unknown: new MeshLambertMaterial({ map: hatchTexture(palette.building, palette.unknownHatch), transparent: true, opacity: 0.9 }),
      selected: new MeshStandardMaterial({ color: palette.selected, roughness: 0.8, metalness: 0 }),
      edge: new LineBasicMaterial({ color: palette.buildingEdge }),
    };
    this.selectOutline = outline(palette.selected, SELECT_OUTLINE_PX);
    this.hoverOutline = outline(palette.hover, HOVER_OUTLINE_PX);
    this.scene.add(this.footprintGroup, this.selectOutline, this.hoverOutline);

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('dblclick', this.onDoubleClick);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  // ---------------------------------------------------------------- content

  /** Replaces the footprint layer. Never moves the camera (streamed content never auto-fits). */
  setFootprints(inputs: FootprintInput[]): void {
    for (const entry of this.footprints.values()) {
      entry.mesh.geometry.dispose();
      entry.edges.geometry.dispose();
    }
    this.footprints.clear();
    this.footprintGroup.clear();

    for (const input of inputs) {
      const geometry = footprintGeometry(input);
      const known = hasKnownHeight(input);
      const mesh = new Mesh(geometry, known ? this.materials.known : this.materials.unknown);
      mesh.castShadow = known;
      mesh.receiveShadow = true;
      mesh.userData.recordId = input.id;
      if (!known) applyPlanarUV(geometry);
      const edges = new LineSegments(new EdgesGeometry(geometry, 30), this.materials.edge);
      edges.userData.recordId = input.id;
      edges.raycast = () => {};
      this.footprintGroup.add(mesh, edges);
      this.footprints.set(input.id, { input, mesh, edges, known });
    }
    this.fitGroundAndShadow();
    this.applySelection();
    this.requestRender();
  }

  /** Loads a 3D Tiles tileset (today's bounded scene assets; tomorrow's streamed global tiles). */
  loadTileset(url: string, fetchOptions?: RequestInit): TilesRenderer {
    const tiles = new TilesRenderer(url);
    if (fetchOptions) tiles.fetchOptions = fetchOptions;
    tiles.setCamera(this.camera);
    tiles.setResolutionFromRenderer(this.camera, this.renderer);
    tiles.addEventListener('load-model', () => this.requestRender());
    tiles.addEventListener('tile-visibility-change', () => this.requestRender());
    this.scene.add(tiles.group);
    this.tilesets.add(tiles);
    this.requestRender();
    return tiles;
  }

  removeTileset(tiles: TilesRenderer): void {
    this.scene.remove(tiles.group);
    tiles.dispose();
    this.tilesets.delete(tiles);
    this.requestRender();
  }

  // -------------------------------------------------------------- selection

  select(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.applySelection();
    this.requestRender();
  }

  /** Canonical record ID under a client position, or null. */
  pick(clientX: number, clientY: number): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.footprintGroup.children, false)[0];
    return (hit?.object.userData.recordId as string | undefined) ?? null;
  }

  /** Screen position (CSS px, relative to the container) of the top centre of a record, for labels. */
  project(id: string): { x: number; y: number; visible: boolean } | null {
    const entry = this.footprints.get(id);
    if (!entry) return null;
    const box = entry.mesh.geometry.boundingBox!;
    const point = new Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2).project(this.camera);
    const { clientWidth: w, clientHeight: h } = this.container;
    return { x: ((point.x + 1) / 2) * w, y: ((1 - point.y) / 2) * h, visible: point.z > -1 && point.z < 1 };
  }

  // ----------------------------------------------------------------- camera

  /** Frames records (or everything) with an eased, interruptible move; cuts under reduced motion. */
  frame(ids?: string[], preset: CameraPreset = 'oblique'): void {
    const inputs = ids?.length
      ? ids.map((id) => this.footprints.get(id)?.input).filter((input): input is FootprintInput => Boolean(input))
      : [...this.footprints.values()].map((entry) => entry.input);
    const bounds = boundsOf(inputs);
    if (!bounds) return;
    const maxHeight = Math.max(0, ...inputs.map((input) => (hasKnownHeight(input) ? input.heightM! : 0)));
    this.flyTo(bounds, maxHeight, preset);
  }

  setPreset(preset: CameraPreset): void {
    const target = this.controls.target.clone();
    const distance = this.camera.position.distanceTo(target);
    this.flyToTarget(target, distance, preset);
  }

  /** Metres per CSS pixel at the orbit target, for the scale bar. */
  metresPerPixel(): number {
    const distance = this.camera.position.distanceTo(this.controls.target);
    const visibleHeight = 2 * distance * Math.tan((this.camera.fov * Math.PI) / 360);
    return visibleHeight / Math.max(1, this.container.clientHeight);
  }

  /** Camera heading in degrees clockwise from north, for the north arrow. */
  headingDeg(): number {
    const dir = new Vector3().subVectors(this.controls.target, this.camera.position);
    // Scene north is −z; heading = angle of the view direction from north, clockwise.
    return ((Math.atan2(dir.x, -dir.z) * 180) / Math.PI + 360) % 360;
  }

  // ------------------------------------------------------------ measurement

  stats(): SceneStats {
    const info = this.renderer.info;
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    const mean = this.frameTimes.length ? this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length : 0;
    return {
      frameMs: Math.round(mean * 100) / 100,
      frames: this.frames,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      heapMB: memory ? Math.round(memory.usedJSHeapSize / 1048576) : null,
    };
  }

  // ------------------------------------------------------------- lifecycle

  requestRender(): void {
    if (this.frameRequested || this.disposed) return;
    this.frameRequested = true;
    requestAnimationFrame(this.renderFrame);
  }

  dispose(): void {
    this.disposed = true;
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.removeEventListener('dblclick', this.onDoubleClick);
    for (const tiles of this.tilesets) tiles.dispose();
    this.scene.traverse((object: Object3D) => {
      const mesh = object as Mesh;
      mesh.geometry?.dispose?.();
    });
    for (const material of Object.values(this.materials) as Material[]) material.dispose();
    this.materials.unknown.map?.dispose();
    (this.selectOutline.material as Material).dispose();
    (this.hoverOutline.material as Material).dispose();
    this.controls.dispose();
    this.renderer.dispose();
    canvas.remove();
  }

  // --------------------------------------------------------------- internals

  private readonly renderFrame = (now: number) => {
    this.frameRequested = false;
    if (this.disposed) return;
    const started = performance.now();
    let moving = false;
    if (this.flight) moving = this.stepFlight(now);
    for (const tiles of this.tilesets) tiles.update();
    this.renderer.render(this.scene, this.camera);
    this.recordFrameTime(performance.now() - started);
    this.options.onView?.();
    if (moving || [...this.tilesets].some((tiles) => tiles.loadProgress < 1)) this.requestRender();
  };

  private recordFrameTime(ms: number) {
    this.frames += 1;
    this.frameTimes.push(ms);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const line of [this.selectOutline, this.hoverOutline]) (line.material as LineMaterial).resolution.set(w, h);
    for (const tiles of this.tilesets) tiles.setResolutionFromRenderer(this.camera, this.renderer);
    this.requestRender();
  }

  private applySelection() {
    for (const [id, entry] of this.footprints) {
      entry.mesh.material = id === this.selectedId ? this.materials.selected : entry.known ? this.materials.known : this.materials.unknown;
    }
    setOutline(this.selectOutline, this.footprints.get(this.selectedId ?? '')?.edges);
    setOutline(this.hoverOutline, this.hoveredId !== this.selectedId ? this.footprints.get(this.hoveredId ?? '')?.edges : undefined);
  }

  private fitGroundAndShadow() {
    const bounds = boundsOf([...this.footprints.values()].map((entry) => entry.input));
    if (!bounds) return;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cz = -(bounds.minY + bounds.maxY) / 2;
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 50);
    this.ground.position.set(cx, -0.01, cz);
    this.ground.scale.set(span * 8, span * 8, 1);
    // South-west sun at 45° elevation: light comes from −x (west) and +z (south).
    const d = span * 1.2;
    this.sun.position.set(cx - d * 0.7071, d, cz + d * 0.7071);
    this.sun.target.position.set(cx, 0, cz);
    const cam = this.sun.shadow.camera;
    cam.left = -span; cam.right = span; cam.top = span; cam.bottom = -span;
    cam.near = 1; cam.far = d * 4;
    cam.updateProjectionMatrix();
  }

  private flyTo(bounds: Bounds2D, height: number, preset: CameraPreset) {
    const target = new Vector3((bounds.minX + bounds.maxX) / 2, height / 3, -(bounds.minY + bounds.maxY) / 2);
    // Keep at least ~25 m of context around a single building so the neighbours stay in view.
    const radius = Math.max(Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2, height * 0.75, 25);
    const distance = (radius / Math.sin((this.camera.fov * Math.PI) / 360)) * 0.85;
    this.flyToTarget(target, distance, preset);
  }

  private flyToTarget(target: Vector3, distance: number, preset: CameraPreset) {
    const offset = preset === 'plan'
      ? new Vector3(0, distance, 0.001)
      : new Vector3(-0.5, 0.7071, 0.5).normalize().multiplyScalar(distance); // oblique 45° from the south-west
    const to: [Vector3, Vector3] = [target.clone().add(offset), target.clone()];
    if (this.options.reducedMotion) {
      this.camera.position.copy(to[0]);
      this.controls.target.copy(to[1]);
      this.controls.update();
      this.requestRender();
      return;
    }
    this.flight = { from: [this.camera.position.clone(), this.controls.target.clone()], to, start: performance.now() };
    this.requestRender();
  }

  private stepFlight(now: number): boolean {
    const flight = this.flight!;
    const t = Math.min(1, (now - flight.start) / CAMERA_MS);
    const k = 1 - Math.pow(1 - t, 3); // ease-out
    this.camera.position.lerpVectors(flight.from[0], flight.to[0], k);
    this.controls.target.lerpVectors(flight.from[1], flight.to[1], k);
    this.camera.lookAt(this.controls.target);
    if (t >= 1) {
      this.flight = null;
      this.controls.update();
      return false;
    }
    return true;
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    this.flight = null;
    this.downAt = { x: event.clientX, y: event.clientY };
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    const down = this.downAt;
    this.downAt = null;
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return; // a drag, not a click
    this.options.onPick?.(this.pick(event.clientX, event.clientY));
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    if (event.buttons) return;
    const id = this.pick(event.clientX, event.clientY);
    if (id === this.hoveredId) return;
    this.hoveredId = id;
    this.renderer.domElement.style.cursor = id ? 'pointer' : '';
    this.applySelection();
    this.options.onHover?.(id);
    this.requestRender();
  };

  private readonly onPointerLeave = () => {
    if (!this.hoveredId) return;
    this.hoveredId = null;
    this.applySelection();
    this.options.onHover?.(null);
    this.requestRender();
  };

  private readonly onDoubleClick = (event: MouseEvent) => {
    const id = this.pick(event.clientX, event.clientY);
    if (id) this.frame([id]);
  };
}

function outline(color: string, widthPx: number): LineSegments2 {
  const material = new LineMaterial({ color: new Color(color).getHex(), linewidth: widthPx, worldUnits: false, depthTest: true, transparent: true });
  const line = new LineSegments2(new LineSegmentsGeometry(), material);
  line.renderOrder = 10;
  line.visible = false;
  line.raycast = () => {};
  return line;
}

function setOutline(line: LineSegments2, edges: LineSegments | undefined) {
  if (!edges) {
    line.visible = false;
    return;
  }
  const positions = edges.geometry.getAttribute('position').array as Float32Array;
  line.geometry.dispose();
  line.geometry = new LineSegmentsGeometry().setPositions(positions);
  line.visible = true;
}

/** 45° hatch for unknown heights (map-and-3d.md, Evidence and record status). */
function hatchTexture(fill: string, stroke: string): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = stroke;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 3;
  for (let i = -size; i <= size * 2; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, size);
    ctx.lineTo(i + size, 0);
    ctx.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** World-space planar UVs (1 texture repeat per 2 m) so the hatch keeps a constant scale. */
function applyPlanarUV(geometry: BufferGeometry) {
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  if (!uv) return;
  for (let i = 0; i < position.count; i++) uv.setXY(i, position.getX(i) / 2, position.getZ(i) / 2);
  uv.needsUpdate = true;
}

