import {
  AmbientLight, BackSide, Box3, BufferGeometry, CanvasTexture, Color, DirectionalLight, EdgesGeometry, Float32BufferAttribute,
  Group, HemisphereLight, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial,
  PCFShadowMap, PerspectiveCamera, PlaneGeometry, Raycaster, RepeatWrapping, SRGBColorSpace, Scene, Vector2, Vector3, WebGLRenderer,
  type Material, type Object3D,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TilesRenderer } from '3d-tiles-renderer';
import { presetFor } from './camera';
import { FLAT_THICKNESS_M, footprintGeometry, hasKnownHeight, prismGeometry } from './geometry';
import type {
  Bounds2D, BuildingDetailInput, FootprintInput, Pick, SceneMode, ScenePalette, SceneState, SceneStats, SpaceFill,
} from './types';

export interface SceneEngineOptions {
  palette: ScenePalette;
  onPick?: (pick: Pick) => void;
  onHover?: (pick: Pick) => void;
  /** Called after every rendered frame, so HTML overlays (labels, readout) can follow the camera. */
  onView?: () => void;
  reducedMotion?: boolean;
}

interface Entry {
  kind: 'building' | 'space';
  id: string;
  levelId?: string;
  mesh: Mesh;
  edges: LineSegments;
  known: boolean;
  bounds: Box3;
  grow?: number;
}

const CAMERA_MS = 600;
const GROW_MS = 200;
const INITIAL_STATE: SceneState = { mode: 'area', buildingId: null, levelId: null, spaceId: null, render: 'model', view: '3d' };

/**
 * The Studio scene engine: an imperative Three.js scene the React adapter drives. It renders on demand
 * (input, camera moves, tiles, grow-in) and never moves the camera on its own when content streams in.
 *
 * Look (docs/design-system/map-and-3d.md): neutral massing with edge lines; one primary selection with a
 * halo; everything else at context opacity once something is selected; unknown heights drawn flat and
 * hatched; levels above the explored one ghosted; Volumes render drops shadows for flat, even light.
 */
export class SceneEngine {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;

  private readonly container: HTMLElement;
  private readonly options: SceneEngineOptions;
  private readonly entries = new Map<string, Entry>();
  private readonly buildings = new Group();
  private readonly detail = new Group();
  private readonly underground = new Group();
  private readonly tilesets = new Set<TilesRenderer>();
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly hemi: HemisphereLight;
  private readonly sun: DirectionalLight;
  private readonly ground: Mesh;
  private readonly halo: Mesh;
  private readonly m: ReturnType<typeof makeMaterials>;
  private readonly spaceMaterials = new Map<string, Material>();
  private readonly resizeObserver: ResizeObserver;
  private detailInput: BuildingDetailInput | null = null;
  private state: SceneState = INITIAL_STATE;
  private cameraKey = '';
  private hovered: string | null = null;
  private frameRequested = false;
  private disposed = false;
  private flight: { from: [Vector3, Vector3]; to: [Vector3, Vector3]; start: number } | null = null;
  private frameTimes: number[] = [];
  private frames = 0;
  private downAt: { x: number; y: number } | null = null;
  private anchors = new Map<string, Vector3>();

  constructor(container: HTMLElement, options: SceneEngineOptions) {
    this.container = container;
    this.options = options;
    const { palette } = options;

    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.setClearColor(new Color(palette.ground));
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.camera = new PerspectiveCamera(32, 1, 0.3, 200_000);
    this.camera.position.set(-150, 180, 150);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.maxPolarAngle = Math.PI * 0.62; // allows the low underground view
    this.controls.screenSpacePanning = false;
    this.controls.addEventListener('start', () => { this.flight = null; });
    this.controls.addEventListener('change', () => this.requestRender());

    // Light from the south-west at 45°, soft shadows, no sky gradient.
    this.hemi = new HemisphereLight(0xffffff, new Color(palette.ground).multiplyScalar(0.9), 1.5);
    this.sun = new DirectionalLight(0xffffff, 1.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.4;
    this.scene.add(this.hemi, new AmbientLight(0xffffff, 0), this.sun, this.sun.target);

    this.m = makeMaterials(palette);
    this.ground = new Mesh(new PlaneGeometry(1, 1), this.m.ground);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.halo = new Mesh(new BufferGeometry(), this.m.halo);
    this.halo.renderOrder = -1;
    this.halo.visible = false;
    this.scene.add(this.ground, this.buildings, this.detail, this.underground, this.halo);

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  // ---------------------------------------------------------------- content

  /**
   * Replaces the area's building massing. Buildings not seen before grow in over 200 ms when `growNew`
   * (a live import); the camera never moves because content arrived.
   */
  setBuildings(inputs: FootprintInput[], { growNew = false } = {}): void {
    const previous = new Set([...this.entries.values()].filter((e) => e.kind === 'building').map((e) => e.id));
    this.clearGroup(this.buildings, 'building');
    for (const input of inputs) {
      const geometry = footprintGeometry(input);
      const known = hasKnownHeight(input);
      if (!known) applyPlanarUV(geometry);
      const mesh = new Mesh(geometry, known ? this.m.bldg : this.m.unknown);
      mesh.castShadow = known;
      mesh.receiveShadow = true;
      const edges = new LineSegments(edgeGeometry(geometry, input), this.m.edge);
      edges.raycast = () => {};
      const entry: Entry = { kind: 'building', id: input.id, mesh, edges, known, bounds: geometry.boundingBox!.clone() };
      if (growNew && !previous.has(input.id)) entry.grow = performance.now();
      mesh.userData.entry = entry;
      this.buildings.add(mesh, edges);
      this.entries.set(input.id, entry);
    }
    this.fitGroundAndShadow();
    this.apply();
    if (!this.cameraKey && inputs.length) this.applyCamera(true);
  }

  /** Levels and spaces of the building being explored; null clears them. */
  setBuildingDetail(detail: BuildingDetailInput | null): void {
    this.clearGroup(this.detail, 'space');
    this.detailInput = detail;
    if (detail) {
      for (const level of detail.levels) {
        for (const space of level.spaces) {
          const lower = space.lowerM ?? level.lowerM ?? 0;
          const upper = space.upperM ?? level.upperM;
          const known = upper !== null && upper > lower;
          const geometry = prismGeometry(space.polygons, lower, known ? upper - lower - 0.08 : FLAT_THICKNESS_M * 2);
          applyPlanarUV(geometry);
          const mesh = new Mesh(geometry, this.spaceMaterial(space.fill, !known));
          mesh.castShadow = known;
          mesh.receiveShadow = true;
          const edges = new LineSegments(new EdgesGeometry(geometry, 30), this.m.spaceEdge);
          edges.raycast = () => {};
          const entry: Entry = { kind: 'space', id: space.id, levelId: level.id, mesh, edges, known, bounds: geometry.boundingBox!.clone() };
          mesh.userData.entry = entry;
          mesh.userData.fill = space.fill;
          this.detail.add(mesh, edges);
          this.entries.set(space.id, entry);
        }
      }
    }
    this.cameraKey = this.state.mode === 'level' ? '' : this.cameraKey; // the level's bounds are known only now
    this.apply();
    this.applyCamera(false);
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

  // ------------------------------------------------------------------ state

  /** Mode, selection, render style and view. Mode, building, level or view changes ease the camera. */
  setState(next: SceneState): void {
    this.state = next;
    this.apply();
    this.applyCamera(false);
  }

  /** Re-runs the camera preset for the current mode (the Reset camera tool). */
  resetCamera(): void {
    this.cameraKey = '';
    this.applyCamera(false);
  }

  pick(clientX: number, clientY: number): Pick {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets: Object3D[] = [];
    for (const entry of this.entries.values()) if (entry.mesh.visible && entry.mesh.material !== this.m.ghost && entry.mesh.material !== this.m.faint) targets.push(entry.mesh);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    const entry = hit?.object.userData.entry as Entry | undefined;
    if (!entry) return { kind: 'ground' };
    return entry.kind === 'space' ? { kind: 'space', id: entry.id, levelId: entry.levelId! } : { kind: 'building', id: entry.id };
  }

  /** Screen position (CSS px within the container) of a record's top centre or a named anchor, for labels. */
  project(id: string): { x: number; y: number; visible: boolean } | null {
    const entry = this.entries.get(id);
    let point: Vector3 | undefined;
    if (entry && entry.mesh.visible) {
      const b = entry.bounds;
      point = new Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2);
    } else point = this.anchors.get(id)?.clone();
    if (!point) return null;
    point.project(this.camera);
    const { clientWidth: w, clientHeight: h } = this.container;
    const visible = point.z > -1 && point.z < 1 && Math.abs(point.x) < 1.1 && Math.abs(point.y) < 1.1;
    return { x: ((point.x + 1) / 2) * w, y: ((1 - point.y) / 2) * h, visible };
  }

  /** Metres per CSS pixel at the orbit target, for the scale bar. */
  metresPerPixel(): number {
    const distance = this.camera.position.distanceTo(this.controls.target);
    return (2 * distance * Math.tan((this.camera.fov * Math.PI) / 360)) / Math.max(1, this.container.clientHeight);
  }

  /** Camera heading in degrees clockwise from north, for the north arrow. */
  headingDeg(): number {
    const dir = new Vector3().subVectors(this.controls.target, this.camera.position);
    return ((Math.atan2(dir.x, -dir.z) * 180) / Math.PI + 360) % 360;
  }

  /** A still of the current view (evidence viewer), as a data URL. */
  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/jpeg', 0.9);
  }

  stats(): SceneStats {
    const info = this.renderer.info;
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    const mean = this.frameTimes.length ? this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length : 0;
    return {
      frameMs: Math.round(mean * 100) / 100, frames: this.frames, drawCalls: info.render.calls, triangles: info.render.triangles,
      geometries: info.memory.geometries, textures: info.memory.textures, heapMB: memory ? Math.round(memory.usedJSHeapSize / 1048576) : null,
    };
  }

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
    for (const tiles of this.tilesets) tiles.dispose();
    this.scene.traverse((object) => (object as Mesh).geometry?.dispose?.());
    for (const material of [...Object.values(this.m), ...this.spaceMaterials.values()] as Material[]) {
      (material as MeshBasicMaterial).map?.dispose();
      material.dispose();
    }
    this.controls.dispose();
    this.renderer.dispose();
    canvas.remove();
  }

  // --------------------------------------------------------------- internals

  /** Materials and visibility for the current mode (map-and-3d.md, "What the scene shows per mode"). */
  private apply() {
    const { mode, buildingId, levelId, spaceId, participants = [] } = this.state;
    const m = this.m;
    const selectedSomething = Boolean(buildingId) || mode !== 'area';
    const exploring = mode === 'level' && this.detailInput?.buildingId === buildingId;
    const levelOrder = new Map(this.detailInput?.levels.map((l) => [l.id, l.order]) ?? []);
    const activeOrder = levelId ? levelOrder.get(levelId) : undefined;

    for (const entry of this.entries.values()) {
      if (entry.kind === 'building') {
        const selected = entry.id === buildingId;
        const participant = participants.includes(entry.id);
        let material: Material = entry.known ? m.bldg : m.unknown;
        let edge: Material = m.edge;
        let visible = true;
        if (mode === 'findings') { material = m.ghost; edge = participant ? m.inkEdge : m.ghostEdge; }
        else if (mode === 'underground') { material = selected ? m.ghost : m.faint; edge = selected ? m.inkEdge : m.ghostEdge; }
        else if (selected && exploring) visible = false; // its interior replaces the shell
        else if (selected) { material = m.selected; edge = m.haloEdge; }
        else if (selectedSomething) { material = entry.known ? m.bldgContext : m.unknownContext; edge = m.edgeContext; }
        entry.mesh.material = material;
        entry.edges.material = edge;
        entry.mesh.visible = entry.edges.visible = visible;
        entry.mesh.castShadow = entry.known && material !== m.ghost && material !== m.faint;
      } else {
        const order = levelOrder.get(entry.levelId!) ?? 0;
        const onLevel = entry.levelId === levelId;
        const above = activeOrder !== undefined && order < activeOrder; // the rail lists the top level first
        const fill = entry.mesh.userData.fill as SpaceFill;
        entry.mesh.visible = entry.edges.visible = exploring;
        entry.mesh.material = above ? m.ghost : entry.id === spaceId ? m.selected : onLevel ? this.spaceMaterial(fill, !entry.known) : m.bldgContext;
        entry.edges.material = above ? m.ghostEdge : m.spaceEdge;
      }
    }

    // Halo: a slightly larger back-face shell around the selected building or space.
    const haloTarget = mode === 'level' ? this.entries.get(spaceId ?? '')
      : mode === 'area' || mode === 'building' ? this.entries.get(buildingId ?? '') : undefined;
    this.halo.visible = Boolean(haloTarget?.mesh.visible);
    if (haloTarget) {
      this.halo.geometry = haloTarget.mesh.geometry;
      const b = haloTarget.bounds;
      const size = new Vector3().subVectors(b.max, b.min);
      const pad = Math.max(0.35, Math.max(size.x, size.z) * 0.025);
      const sx = (size.x + pad * 2) / Math.max(size.x, 0.01);
      const sy = (size.y + pad) / Math.max(size.y, 0.01);
      const sz = (size.z + pad * 2) / Math.max(size.z, 0.01);
      const cx = (b.min.x + b.max.x) / 2;
      const cz = (b.min.z + b.max.z) / 2;
      this.halo.scale.set(sx, sy, sz);
      this.halo.position.set(cx * (1 - sx), b.min.y * (1 - sy) - 0.02, cz * (1 - sz));
    }

    // Underground: ground cut to context opacity and an honest "No survey" plate under the building.
    const below = mode === 'underground';
    m.ground.transparent = below;
    m.ground.opacity = below ? 0.35 : 1;
    m.ground.depthWrite = !below;
    this.buildUnderground(below ? this.entries.get(buildingId ?? '') : undefined);

    // Volumes: flat, even light without shadows (checks, measurements and findings open in Volumes).
    const volumes = this.state.render === 'volumes' || mode === 'findings';
    this.sun.castShadow = !volumes;
    this.hemi.intensity = volumes ? 1.9 : 1.5;
    this.sun.intensity = volumes ? 0.7 : 1.6;
    this.requestRender();
  }

  private buildUnderground(building: Entry | undefined) {
    for (const child of [...this.underground.children]) (child as Mesh).geometry?.dispose();
    this.underground.clear();
    this.anchors.delete('no-survey');
    if (!building) return;
    const b = building.bounds;
    const pad = Math.max(6, (b.max.x - b.min.x) * 0.3);
    const x0 = b.min.x - pad, x1 = b.max.x + pad, z0 = b.min.z - pad, z1 = b.max.z + pad;
    const plate = new Mesh(new PlaneGeometry(x1 - x0, z1 - z0), this.m.noSurvey);
    plate.rotation.x = -Math.PI / 2;
    plate.position.set((x0 + x1) / 2, -0.05, (z0 + z1) / 2);
    const outline = new LineSegments(rectLines(x0, x1, z0, z1, -0.04), this.m.soilEdge);
    this.underground.add(plate, outline);
    this.anchors.set('no-survey', new Vector3((x0 + x1) / 2, 0, z1));
  }

  private applyCamera(instant: boolean) {
    const { mode, buildingId, levelId, view, participants = [] } = this.state;
    const key = `${mode}|${mode === 'area' ? '' : buildingId ?? ''}|${mode === 'level' ? levelId ?? '' : ''}|${view}`;
    if (key === this.cameraKey) return;
    const target = this.cameraTarget(mode, buildingId, levelId, participants);
    if (!target) return;
    this.cameraKey = key;
    const pose = presetFor(mode, target.bounds, target.focusY, target.extentY, view, this.camera.fov);
    const to: [Vector3, Vector3] = [new Vector3(...pose.position), new Vector3(...pose.target)];
    if (instant || this.options.reducedMotion) {
      this.camera.position.copy(to[0]);
      this.controls.target.copy(to[1]);
      this.controls.update();
      this.requestRender();
      return;
    }
    this.flight = { from: [this.camera.position.clone(), this.controls.target.clone()], to, start: performance.now() };
    this.requestRender();
  }

  private cameraTarget(mode: SceneMode, buildingId: string | null, levelId: string | null, participants: string[]) {
    const pick = (ids: string[]) => ids.map((id) => this.entries.get(id)).filter((e): e is Entry => Boolean(e));
    let entries: Entry[];
    if (mode === 'area') entries = [...this.entries.values()].filter((e) => e.kind === 'building'); // area stays framed on the area
    else if (mode === 'level') entries = [...this.entries.values()].filter((e) => e.kind === 'space' && e.levelId === levelId);
    else if (mode === 'findings' && participants.length) entries = pick(participants);
    else entries = pick(buildingId ? [buildingId] : []);
    if (!entries.length) return null;
    const box = new Box3();
    for (const e of entries) box.union(e.bounds);
    const bounds: Bounds2D = { minX: box.min.x, maxX: box.max.x, minY: -box.max.z, maxY: -box.min.z };
    const extentY = box.max.y - box.min.y;
    const focusY = mode === 'level' ? box.min.y : mode === 'underground' ? -1 : mode === 'area' ? 0 : box.min.y + extentY / 3;
    return { bounds, focusY, extentY };
  }

  private spaceMaterial(fill: SpaceFill, unknownHeight: boolean): Material {
    const hatch = Boolean(fill.hatch || unknownHeight);
    const key = `${fill.color ?? 'neutral'}|${hatch}`;
    let material = this.spaceMaterials.get(key);
    if (!material) {
      const base = fill.color ?? this.options.palette.building;
      material = hatch
        ? new MeshLambertMaterial({ map: hatchTexture(base, this.options.palette.buildingEdge) })
        : new MeshStandardMaterial({ color: base, roughness: 0.9, metalness: 0 });
      this.spaceMaterials.set(key, material);
    }
    return material;
  }

  private clearGroup(group: Group, kind: Entry['kind']) {
    for (const entry of [...this.entries.values()]) {
      if (entry.kind !== kind) continue;
      entry.mesh.geometry.dispose();
      entry.edges.geometry.dispose();
      this.entries.delete(entry.id);
    }
    group.clear();
  }

  private readonly renderFrame = (now: number) => {
    this.frameRequested = false;
    if (this.disposed) return;
    const started = performance.now();
    let animating = false;
    if (this.flight) animating = this.stepFlight(performance.now());
    animating = this.stepGrow(now) || animating;
    for (const tiles of this.tilesets) tiles.update();
    this.renderer.render(this.scene, this.camera);
    this.recordFrameTime(performance.now() - started);
    this.options.onView?.();
    if (animating || [...this.tilesets].some((tiles) => tiles.loadProgress < 1)) this.requestRender();
  };

  private stepGrow(now: number): boolean {
    let active = false;
    for (const entry of this.entries.values()) {
      if (entry.grow === undefined) continue;
      const t = Math.min(1, (now - entry.grow) / GROW_MS);
      const k = this.options.reducedMotion ? 1 : 1 - Math.pow(1 - t, 3);
      entry.mesh.scale.y = entry.edges.scale.y = Math.max(0.001, k);
      if (t >= 1) delete entry.grow; else active = true;
    }
    return active;
  }

  private stepFlight(now: number): boolean {
    const flight = this.flight!;
    const t = Math.min(1, (now - flight.start) / CAMERA_MS);
    const k = 1 - Math.pow(1 - t, 3); // ease-out cubic
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
    for (const tiles of this.tilesets) tiles.setResolutionFromRenderer(this.camera, this.renderer);
    this.requestRender();
  }

  private fitGroundAndShadow() {
    const buildings = [...this.entries.values()].filter((e) => e.kind === 'building');
    if (!buildings.length) return;
    const box = new Box3();
    for (const e of buildings) box.union(e.bounds);
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 50);
    this.ground.position.set(cx, -0.01, cz);
    this.ground.scale.set(span * 8, span * 8, 1);
    const d = span * 1.2;
    this.sun.position.set(cx - d * 0.7071, d, cz + d * 0.7071); // south-west, 45° elevation
    this.sun.target.position.set(cx, 0, cz);
    const cam = this.sun.shadow.camera;
    cam.left = -span; cam.right = span; cam.top = span; cam.bottom = -span;
    cam.near = 1; cam.far = d * 4;
    cam.updateProjectionMatrix();
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
    const pick = this.pick(event.clientX, event.clientY);
    const id = pick.kind === 'ground' ? null : pick.id;
    if (id === this.hovered) return;
    this.hovered = id;
    this.renderer.domElement.style.cursor = id ? 'pointer' : '';
    this.options.onHover?.(pick);
  };

  private readonly onPointerLeave = () => {
    if (!this.hovered) return;
    this.hovered = null;
    this.options.onHover?.({ kind: 'ground' });
  };
}

function makeMaterials(p: ScenePalette) {
  const contextColor = new Color(p.ground).lerp(new Color(p.building), 0.35);
  const hatchUnknown = hatchTexture(p.building, p.buildingEdge);
  return {
    ground: new MeshStandardMaterial({ color: p.ground, roughness: 0.95, metalness: 0 }),
    bldg: new MeshStandardMaterial({ color: p.building, roughness: 0.92, metalness: 0 }),
    bldgContext: new MeshStandardMaterial({ color: contextColor, roughness: 0.92, metalness: 0 }),
    unknown: new MeshLambertMaterial({ map: hatchUnknown }),
    unknownContext: new MeshLambertMaterial({ map: hatchUnknown, transparent: true, opacity: 0.45 }),
    selected: new MeshStandardMaterial({ color: p.selected, roughness: 0.85, metalness: 0 }),
    ghost: new MeshBasicMaterial({ color: p.buildingEdge, transparent: true, opacity: 0.1, depthWrite: false }),
    faint: new MeshBasicMaterial({ color: p.building, transparent: true, opacity: 0.25, depthWrite: false }),
    halo: new MeshBasicMaterial({ color: p.halo, side: BackSide }),
    edge: new LineBasicMaterial({ color: p.buildingEdge }),
    edgeContext: new LineBasicMaterial({ color: p.buildingEdge, transparent: true, opacity: 0.35 }),
    ghostEdge: new LineBasicMaterial({ color: p.buildingEdge, transparent: true, opacity: 0.5 }),
    inkEdge: new LineBasicMaterial({ color: p.ink }),
    haloEdge: new LineBasicMaterial({ color: p.halo, transparent: true, opacity: 0.85 }),
    spaceEdge: new LineBasicMaterial({ color: p.halo, transparent: true, opacity: 0.9 }),
    noSurvey: new MeshBasicMaterial({ map: hatchTexture(p.readinessUnknown, p.halo, 6), transparent: true, opacity: 0.75, depthWrite: false }),
    soilEdge: new LineBasicMaterial({ color: p.soilDeep }),
  };
}

/** Edges plus a line at every recorded slab (never invented storey spacing). */
function edgeGeometry(geometry: BufferGeometry, input: FootprintInput): BufferGeometry {
  const edges = new EdgesGeometry(geometry, 30);
  if (!input.slabsM?.length) return edges;
  const positions = [...(edges.getAttribute('position').array as Float32Array)];
  const base = input.baseM ?? 0;
  for (const polygon of input.polygons) {
    const ring = polygon[0] ?? [];
    for (const slab of input.slabsM) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [ax, ay] = ring[i]!;
        const [bx, by] = ring[i + 1]!;
        positions.push(ax, base + slab, -ay, bx, base + slab, -by);
      }
    }
  }
  edges.dispose();
  const out = new BufferGeometry();
  out.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return out;
}

function rectLines(x0: number, x1: number, z0: number, z1: number, y: number): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0], 3));
  return g;
}

/** 45° hatch (unknown or estimated), used by materials with planar UVs. */
function hatchTexture(fill: string, stroke: string, width = 3): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
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

/** World-space planar UVs (one repeat per 2 m) so a hatch keeps a constant scale on every face. */
function applyPlanarUV(geometry: BufferGeometry) {
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  if (!uv) return;
  for (let i = 0; i < position.count; i++) uv.setXY(i, (position.getX(i) + position.getY(i)) / 2, (position.getZ(i) + position.getY(i)) / 2);
  uv.needsUpdate = true;
}
