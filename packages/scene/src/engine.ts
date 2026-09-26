import {
  BackSide, Box3, BoxGeometry, BufferGeometry, CanvasTexture, Color, DirectionalLight, EdgesGeometry, Float32BufferAttribute, Fog,
  Group, HemisphereLight, LineBasicMaterial, LineDashedMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  MeshStandardMaterial, PCFShadowMap, PerspectiveCamera, Plane, PlaneGeometry, Raycaster, RepeatWrapping, SRGBColorSpace, Scene,
  SphereGeometry, Vector2, Vector3, WebGLRenderer, type Material, type Object3D,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TilesRenderer } from '3d-tiles-renderer';
import { presetFor } from './camera';
import { FLAT_THICKNESS_M, hasKnownHeight, prismGeometry, shapesFor } from './geometry';
import type {
  BaseFeatureInput, Bounds2D, BuildingDetailInput, FindingInput, FootprintInput, Measurement, MultiPolygon, Pick, SceneMode,
  ScenePalette, SceneState, SceneStats, SpaceFill, StoreyInput, Trench, DeviationInput,
} from './types';

export interface SceneEngineOptions {
  palette: ScenePalette;
  onPick?: (pick: Pick) => void;
  onHover?: (pick: Pick) => void;
  /** Called after every rendered frame, so HTML overlays (labels, readout) can follow the camera. */
  onView?: () => void;
  onMeasure?: (measurement: Measurement) => void;
  onTrench?: (trench: Trench) => void;
  reducedMotion?: boolean;
}

interface Entry {
  kind: 'building' | 'storey' | 'space';
  id: string;
  buildingId: string;
  levelId?: string;
  storey?: StoreyInput;
  meshes: Mesh[];
  edges: LineSegments[];
  /** Whether a height is recorded (buildings) or the limits are known (spaces). */
  known: boolean;
  bounds: Box3;
  grow?: number;
}

const CAMERA_MS = 600;
const GROW_MS = 220;
const INITIAL_STATE: SceneState = { mode: 'area', buildingId: null, levelId: null, spaceId: null, tool: 'select' };

/**
 * The Studio scene engine: an imperative Three.js scene the React adapter drives. It renders on demand
 * (input, camera moves, tiles, grow-in) and never moves the camera on its own when content streams in.
 *
 * Look (docs/design-system/map-and-3d.md and the Officer Studio reference): a flat base map with roads,
 * public land, water and parcel lines; neutral massing with a line at every recorded floor; one primary
 * selection with a white halo; context faded once something is selected; the explored building drawn
 * storey by storey (open stilt storeys as columns, basements only below ground); levels above the
 * explored one ghosted; unknown and estimated limits hatched.
 */
export class SceneEngine {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;

  private readonly container: HTMLElement;
  private readonly options: SceneEngineOptions;
  private readonly entries = new Map<string, Entry>();
  private readonly buildingBounds = new Map<string, Box3>();
  private readonly storeyBuildings = new Map<string, FootprintInput>();
  private readonly base = new Group();
  private readonly buildings = new Group();
  private readonly detail = new Group();
  private readonly findingGroup = new Group();
  private readonly underground = new Group();
  private readonly utilities = new Group();
  private readonly measureGroup = new Group();
  private readonly sectionGroup = new Group();
  private readonly deviationGroup = new Group();
  private deviationKey = '';
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
  private readonly clip = new Plane(new Vector3(0, -1, 0), 0);
  private utilityInputs: BaseFeatureInput[] = [];
  private detailInput: BuildingDetailInput | null = null;
  private state: SceneState = INITIAL_STATE;
  private findingKey = '';
  private cameraKey = '';
  private hovered: string | null = null;
  private frameRequested = false;
  private disposed = false;
  private flight: { from: [Vector3, Vector3]; to: [Vector3, Vector3]; start: number } | null = null;
  private frameTimes: number[] = [];
  private frames = 0;
  private downAt: { x: number; y: number } | null = null;
  private anchors = new Map<string, Vector3>();
  private measurePoints: Vector3[] = [];
  private trenchPoints: Vector3[] = [];
  private readonly trenchGroup = new Group();
  private areaBox = new Box3();
  private haloOwned = false;

  constructor(container: HTMLElement, options: SceneEngineOptions) {
    this.container = container;
    this.options = options;
    const { palette } = options;

    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor(new Color(palette.ground));
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.camera = new PerspectiveCamera(32, 1, 0.3, 20_000);
    this.camera.position.set(112, 88, 134);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.maxPolarAngle = Math.PI * 0.62; // allows the low underground view
    this.controls.minDistance = 6;
    this.controls.screenSpacePanning = false;
    this.controls.addEventListener('start', () => { this.flight = null; });
    this.controls.addEventListener('change', () => this.requestRender());

    const ground = new Color(palette.ground);
    this.scene.background = ground;
    this.scene.fog = new Fog(ground, 260, 620);
    this.hemi = new HemisphereLight(0xffffff, 0xcfd6d4, 1.6);
    this.sun = new DirectionalLight(0xffffff, 1.35);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.4;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.m = makeMaterials(palette, this.clip);
    this.ground = new Mesh(new PlaneGeometry(1, 1), this.m.ground);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.ground.scale.set(1400, 1400, 1);
    this.halo = new Mesh(new BufferGeometry(), this.m.halo);
    this.halo.renderOrder = -1;
    this.halo.visible = false;
    this.underground.add(this.utilities, this.trenchGroup);
    this.scene.add(this.ground, this.base, this.buildings, this.detail, this.findingGroup, this.underground, this.measureGroup, this.sectionGroup, this.deviationGroup, this.halo);

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

  /** Base map: roads, public land, water and parcel lines; utilities are kept for underground mode. */
  setBase(features: BaseFeatureInput[]): void {
    disposeGroup(this.base);
    const m = this.m;
    const lift: Record<string, number> = { public_land: 0.019, road: 0.021, water: 0.03 };
    const parcelLines: number[] = [];
    for (const f of features) {
      if (f.kind === 'utility') continue;
      if (f.kind === 'parcel') {
        for (const polygon of f.polygons) parcelLines.push(...ringLines(polygon[0] ?? [], 0.06));
        continue;
      }
      const shapes = shapesFor(f.polygons);
      if (!shapes.length) continue;
      const mesh = new Mesh(prismGeometry(f.polygons, lift[f.kind] ?? 0.02, 0.001), f.kind === 'road' ? m.road : f.kind === 'water' ? m.water : m.publicLand);
      mesh.receiveShadow = true;
      this.base.add(mesh);
    }
    if (parcelLines.length) this.base.add(lines(parcelLines, m.parcel));
    this.utilityInputs = features.filter((f) => f.kind === 'utility');
    this.buildUtilities();
    this.apply();
  }

  /**
   * Replaces the area's buildings. Buildings not seen before grow in when `growNew` (a live import);
   * the camera never moves because content arrived.
   */
  setBuildings(inputs: FootprintInput[], { growNew = false } = {}): void {
    const previous = new Set(this.buildingBounds.keys());
    this.clearEntries(this.buildings, (e) => e.kind === 'building' || e.kind === 'storey');
    this.buildingBounds.clear();
    this.storeyBuildings.clear();
    const now = performance.now();
    for (const input of inputs) {
      if (input.storeys?.length) this.addStoreyBuilding(input);
      else this.addFootprintBuilding(input, growNew && !previous.has(input.id) ? now : undefined);
    }
    this.areaBox = new Box3();
    for (const [, box] of this.buildingBounds) this.areaBox.union(box);
    this.fitGroundAndShadow();
    this.apply();
    if (!this.cameraKey && inputs.length) this.applyCamera(true);
  }

  /** Levels and spaces of the building being explored; null clears them. */
  setBuildingDetail(detail: BuildingDetailInput | null): void {
    this.clearEntries(this.detail, (e) => e.kind === 'space');
    this.detailInput = detail;
    if (detail) {
      for (const level of detail.levels) {
        for (const space of level.spaces) {
          const lower = space.lowerM ?? level.lowerM ?? 0;
          const upper = space.upperM ?? level.upperM;
          const known = upper !== null && upper > lower;
          const geometry = prismGeometry(space.polygons, lower + 0.05, known ? upper! - lower - 0.3 : FLAT_THICKNESS_M * 2);
          applyPlanarUV(geometry);
          const mesh = new Mesh(geometry, this.spaceMaterial(space.fill, !known));
          mesh.castShadow = known;
          mesh.receiveShadow = true;
          const edge = new LineSegments(new EdgesGeometry(geometry, 30), this.m.spaceEdge);
          edge.raycast = () => {};
          const entry: Entry = { kind: 'space', id: space.id, buildingId: detail.buildingId, levelId: level.id, meshes: [mesh], edges: [edge], known, bounds: geometry.boundingBox!.clone() };
          mesh.userData.entry = entry;
          mesh.userData.fill = space.fill;
          this.detail.add(mesh, edge);
          this.entries.set(space.id, entry);
        }
      }
    }
    if (this.state.mode === 'level') this.cameraKey = ''; // the level's bounds are known only now
    this.apply();
    this.applyCamera(false);
  }

  /** Loads a 3D Tiles tileset (bounded scene assets today; streamed global tiles later). */
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

  /** Mode, selection and tool. Mode, building or level changes ease the camera. */
  setState(next: SceneState): void {
    const toolChanged = next.tool !== this.state.tool;
    this.state = next;
    if (toolChanged && next.tool !== 'measure') this.clearMeasure();
    this.apply();
    this.applyCamera(false);
  }

  /** Re-runs the camera preset for the current mode (the Reset view tool). */
  resetCamera(): void {
    this.cameraKey = '';
    this.applyCamera(false);
  }

  clearMeasure(): void {
    this.measurePoints = [];
    this.drawMeasure();
  }

  pick(clientX: number, clientY: number): Pick {
    const hit = this.raycast(clientX, clientY);
    const entry = hit?.object.userData.entry as Entry | undefined;
    if (!entry) {
      const point = hit?.point;
      return point ? { kind: 'ground', point: [point.x, point.y, point.z] } : { kind: 'ground' };
    }
    if (entry.kind === 'space') return { kind: 'space', id: entry.id, levelId: entry.levelId! };
    return entry.levelId ? { kind: 'building', id: entry.buildingId, levelId: entry.levelId } : { kind: 'building', id: entry.buildingId };
  }

  /** Screen position (CSS px within the container) of a record's top centre or a named anchor, for labels. */
  project(id: string): { x: number; y: number; visible: boolean } | null {
    let point: Vector3 | undefined;
    const entry = this.entries.get(id);
    const box = entry?.kind === 'space' && entry.meshes[0]!.visible ? entry.bounds : this.buildingBounds.get(id);
    if (box) point = new Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
    else point = this.anchors.get(id)?.clone();
    if (!point) return null;
    const { clientWidth: fullW, clientHeight: h } = this.container;
    const split = this.state.mode === 'deviation';
    const w = split ? Math.floor(fullW / 2) : fullW;
    if (split) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    point.project(this.camera);
    if (split) { this.camera.aspect = fullW / h; this.camera.updateProjectionMatrix(); }
    const visible = point.z > -1 && point.z < 1 && Math.abs(point.x) < 1.1 && Math.abs(point.y) < 1.1;
    return { x: ((point.x + 1) / 2) * w, y: ((1 - point.y) / 2) * h, visible };
  }

  /** A named point for an HTML label (parcel codes and similar), in local metres east, north, up. */
  setAnchor(id: string, point: [number, number, number] | null): void {
    if (point) this.anchors.set(id, new Vector3(point[0], point[2], -point[1]));
    else this.anchors.delete(id);
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

  /** Top of the building's recorded storeys (or its height), for the section slider range. */
  buildingTopM(id: string): number | null {
    const box = this.buildingBounds.get(id);
    return box ? Math.round(box.max.y * 10) / 10 : null;
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

  // ---------------------------------------------------------------- builders

  private addFootprintBuilding(input: FootprintInput, grow?: number) {
    const known = hasKnownHeight(input);
    const geometry = prismGeometry(input.polygons, input.baseM ?? 0, known ? input.heightM! : FLAT_THICKNESS_M);
    if (!known) applyPlanarUV(geometry);
    const mesh = new Mesh(geometry, known ? this.m.bldg : this.m.unknown);
    mesh.castShadow = known;
    mesh.receiveShadow = true;
    const edge = new LineSegments(edgeGeometry(geometry, input), this.m.edge);
    edge.raycast = () => {};
    const entry: Entry = { kind: 'building', id: input.id, buildingId: input.id, meshes: [mesh], edges: [edge], known, bounds: geometry.boundingBox!.clone(), grow };
    mesh.userData.entry = entry;
    this.buildings.add(mesh, edge);
    this.entries.set(input.id, entry);
    this.buildingBounds.set(input.id, entry.bounds.clone());
  }

  private addStoreyBuilding(input: FootprintInput) {
    this.storeyBuildings.set(input.id, input);
    const above = new Box3();
    for (const storey of input.storeys!) {
      const polygons = storey.polygons ?? input.polygons;
      const parts: BufferGeometry[] = [];
      if (storey.open) {
        parts.push(prismGeometry(polygons, storey.upperM - 0.3, 0.3));
        for (const [x, y] of columnPositions(polygons)) parts.push(prismGeometry([[squareRing(x, y, 0.35)]], storey.lowerM - 0.4, storey.upperM - 0.3 - storey.lowerM + 0.4));
      } else if (storey.roof) {
        for (const wall of parapetRings(polygons, 0.3)) parts.push(prismGeometry([[wall]], storey.lowerM, storey.upperM - storey.lowerM));
      } else {
        parts.push(prismGeometry(polygons, storey.lowerM, storey.upperM - storey.lowerM - 0.02));
      }
      const meshes: Mesh[] = [], edges: LineSegments[] = [];
      const bounds = new Box3();
      const id = `${input.id}::${storey.levelId}`;
      const entry: Entry = { kind: 'storey', id, buildingId: input.id, levelId: storey.levelId, storey, meshes, edges, known: true, bounds };
      for (const geometry of parts) {
        if (storey.estimated) applyPlanarUV(geometry);
        const mesh = new Mesh(geometry, storey.estimated ? this.m.estimated : this.m.bldg);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.userData.entry = entry;
        const edge = new LineSegments(new EdgesGeometry(geometry, 30), this.m.edge);
        edge.raycast = () => {};
        meshes.push(mesh);
        edges.push(edge);
        bounds.union(geometry.boundingBox!);
        this.buildings.add(mesh, edge);
      }
      this.entries.set(id, entry);
      if (!storey.belowGround) above.union(bounds);
    }
    if (!above.isEmpty()) this.buildingBounds.set(input.id, above);
  }

  private buildUtilities() {
    disposeGroup(this.utilities);
    for (const u of this.utilityInputs) {
      if (u.lowerM === undefined || u.upperM === undefined) continue;
      const color = this.options.palette.utilities[u.network ?? ''] ?? this.options.palette.utilities.water!;
      const corridor = u.upperM - u.lowerM > 1;
      const material = corridor
        ? new MeshStandardMaterial({ color, transparent: true, opacity: 0.42, depthWrite: false, roughness: 0.6 })
        : new MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.1 });
      const mesh = new Mesh(prismGeometry(u.polygons, u.lowerM, u.upperM - u.lowerM), material);
      mesh.castShadow = !corridor;
      this.utilities.add(mesh);
      const box = mesh.geometry.boundingBox!;
      this.anchors.set(`utility:${u.id}`, new Vector3(box.max.x * 0.4, u.upperM, (box.min.z + box.max.z) / 2));
    }
  }

  /** Soil block, depth ruler and a "No survey" plate under the selected building (underground mode). */
  private buildSection(buildingId: string | null) {
    for (const child of [...this.underground.children]) if (child !== this.utilities && child !== this.trenchGroup) { disposeObject(child); this.underground.remove(child); }
    for (const key of [...this.anchors.keys()]) if (key.startsWith('depth:') || key === 'no-survey') this.anchors.delete(key);
    const box = buildingId ? this.buildingBounds.get(buildingId) : undefined;
    if (!box) return;
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    const half = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 + 30;
    const depth = Math.max(20, ...this.utilityInputs.map((u) => -(u.lowerM ?? 0) + 2));
    const soil = new Mesh(new BoxGeometry(half * 2, depth, half * 1.6), this.m.soil);
    soil.position.set(cx, -depth / 2, cz);
    const soilEdge = new LineSegments(new EdgesGeometry(soil.geometry), this.m.soilEdge);
    soilEdge.position.copy(soil.position);
    this.underground.add(soil, soilEdge);
    // Where no utility survey covers the footprint, say so on a hatched plate just below ground.
    const surveyed = this.utilityInputs.some((u) => u.polygons.some((p) => (p[0] ?? []).some(([x, y]) => x >= box.min.x - 5 && x <= box.max.x + 5 && -y >= box.min.z - 5 && -y <= box.max.z + 5)));
    if (!surveyed) {
      const plate = new Mesh(new PlaneGeometry(box.max.x - box.min.x + 8, box.max.z - box.min.z + 8), this.m.noSurvey);
      plate.rotation.x = -Math.PI / 2;
      plate.position.set(cx, -0.08, cz);
      this.underground.add(plate);
      this.anchors.set('no-survey', new Vector3(cx, -0.1, box.max.z + 4));
    }
  }

  private buildFinding(finding: FindingInput | null | undefined) {
    const key = finding ? `${finding.id}|${finding.lowerM}|${finding.upperM}` : '';
    if (key === this.findingKey) return;
    this.findingKey = key;
    disposeGroup(this.findingGroup);
    this.anchors.delete('finding');
    if (!finding || !finding.polygons.length) return;
    const height = Math.max(0.2, finding.upperM - finding.lowerM);
    const geometry = prismGeometry(finding.polygons, finding.lowerM, height);
    applyPlanarUV(geometry);
    const mesh = new Mesh(geometry, this.m.critical);
    const edge = new LineSegments(new EdgesGeometry(geometry, 30), this.m.inkEdge);
    this.findingGroup.add(mesh, edge);
    const b = geometry.boundingBox!;
    this.anchors.set('finding', new Vector3(b.max.x, (b.min.y + b.max.y) / 2, b.max.z));
  }

  // --------------------------------------------------------------- apply

  /** Materials and visibility for the current mode (map-and-3d.md, "What the scene shows per mode"). */
  private apply() {
    const { mode, buildingId, levelId, spaceId, finding } = this.state;
    const m = this.m;
    const selectedSomething = Boolean(buildingId) || mode !== 'area';
    const exploring = mode === 'level' && this.detailInput?.buildingId === buildingId;
    const levelOrder = new Map(this.detailInput?.levels.map((l) => [l.id, l.order]) ?? []);
    const activeOrder = levelId ? levelOrder.get(levelId) : undefined;
    const activeStorey = buildingId && levelId ? this.entries.get(`${buildingId}::${levelId}`)?.storey : undefined;
    const activeBelow = Boolean(activeStorey?.belowGround);
    const participants = new Set(finding?.participants ?? []);

    for (const entry of this.entries.values()) {
      if (entry.kind === 'building') {
        const selected = entry.id === buildingId;
        let material: Material = entry.known ? m.bldg : m.unknown;
        let edge: Material = m.edge;
        if (mode === 'findings') { material = selected ? m.ghost : m.bldgContext; edge = selected ? m.inkEdge : m.edgeContext; }
        else if (mode === 'underground') { material = selected ? m.ghost : m.faint; edge = selected ? m.inkEdge : m.ghostEdge; if (!selected) { this.setEntry(entry, material, edge, false, false); continue; } }
        else if (selected && exploring) { material = m.ghost; edge = m.ghostEdge; }
        else if (selected) { material = m.selected; edge = m.haloEdge; }
        else if (selectedSomething) { material = entry.known ? m.bldgContext : m.unknownContext; edge = m.edgeContext; }
        this.setEntry(entry, material, edge, true, entry.known && material !== m.ghost && material !== m.faint);
      } else if (entry.kind === 'storey') {
        const selected = entry.buildingId === buildingId;
        const storey = entry.storey!;
        const base = storey.estimated ? m.estimated : m.bldg;
        let material: Material = base, edge: Material = m.edge, visible = !storey.belowGround;
        if (!selected) {
          if (mode === 'underground') { material = m.faint; edge = m.ghostEdge; visible = false; }
          else if (selectedSomething) { material = m.bldgContext; edge = m.edgeContext; }
        } else if (mode === 'area' || mode === 'building' || mode === 'deviation') {
          material = m.selected; edge = m.haloEdge;
        } else if (mode === 'level' && exploring) {
          const order = levelOrder.get(entry.levelId!) ?? 0;
          if (entry.levelId === levelId) visible = false;
          else if (activeOrder !== undefined && order < activeOrder) { material = m.ghost; edge = m.ghostEdge; visible = !storey.belowGround || activeBelow; }
          else visible = !storey.belowGround || activeBelow;
        } else if (mode === 'findings') {
          material = m.ghost; edge = m.ghostEdge;
        } else if (mode === 'underground') {
          visible = true;
          if (!storey.belowGround) { material = m.ghost; edge = m.ghostEdge; }
        }
        this.setEntry(entry, material, edge, visible, material !== m.ghost && material !== m.faint);
      } else {
        const order = levelOrder.get(entry.levelId!) ?? 0;
        const fill = entry.meshes[0]!.userData.fill as SpaceFill;
        const participant = participants.has(entry.id);
        let visible = false, material: Material = this.spaceMaterial(fill, !entry.known), edge: Material = m.spaceEdge;
        if (exploring && entry.levelId === levelId) { visible = true; if (entry.id === spaceId) material = m.selected; }
        else if (exploring && activeOrder !== undefined && order === activeOrder) visible = true;
        else if (mode === 'findings' && participant) { visible = true; material = m.ghostDark; edge = m.inkEdge; }
        this.setEntry(entry, material, edge, visible, visible && material !== m.ghostDark);
      }
    }

    // Halo: a slightly larger back-face shell around the selected building (area, building) or space.
    this.updateHalo(mode, buildingId, spaceId);

    // Base map and ground go translucent below ground.
    const below = mode === 'underground' || (mode === 'level' && activeBelow);
    for (const material of [m.ground, m.road, m.publicLand, m.water]) {
      material.transparent = below;
      material.opacity = below ? 0.35 : 1;
      material.depthWrite = !below;
    }
    this.base.visible = mode !== 'underground';
    if (mode !== 'underground' && this.trenchPoints.length) this.clearTrench();
    this.underground.visible = mode === 'underground';
    this.buildSection(mode === 'underground' ? buildingId : null);
    this.buildFinding(mode === 'findings' ? finding : null);
    this.findingGroup.visible = mode === 'findings';
    this.buildDeviation(mode === 'deviation' ? this.state.deviation : null);

    // Findings use Volumes light: flat, even, no shadows.
    const volumes = mode === 'findings';
    this.sun.castShadow = !volumes;
    this.hemi.intensity = volumes ? 2 : 1.6;
    this.sun.intensity = volumes ? 0.7 : 1.35;

    this.applySection();
    this.requestRender();
  }

  private buildDeviation(deviation: DeviationInput | null | undefined) {
    const key = deviation ? JSON.stringify(deviation) : '';
    if (key === this.deviationKey) return;
    this.deviationKey = key;
    disposeGroup(this.deviationGroup);
    this.anchors.delete('deviation');
    if (!deviation || !deviation.polygons.length) return;
    const geometry = prismGeometry(deviation.polygons, deviation.lowerM, deviation.upperM - deviation.lowerM);
    applyPlanarUV(geometry);
    this.deviationGroup.add(new Mesh(geometry, this.m.critical), new LineSegments(new EdgesGeometry(geometry, 30), this.m.inkEdge));
    const b = geometry.boundingBox!;
    this.anchors.set('deviation', new Vector3((b.min.x + b.max.x) / 2, b.max.y + 0.5, (b.min.z + b.max.z) / 2));
  }

  /** Screen position of an anchor on the right half of the split view (deviation mode). */
  projectRight(id: string): { x: number; y: number; visible: boolean } | null {
    const point = this.anchors.get(id)?.clone();
    if (!point) return null;
    const { clientWidth: w, clientHeight: h } = this.container;
    const half = Math.floor(w / 2);
    this.camera.aspect = (w - half) / h; this.camera.updateProjectionMatrix();
    point.project(this.camera);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    return { x: half + ((point.x + 1) / 2) * (w - half), y: ((1 - point.y) / 2) * h, visible: point.z < 1 && Math.abs(point.x) < 1.1 };
  }

  private setEntry(entry: Entry, material: Material, edge: Material, visible: boolean, shadow: boolean) {
    for (const mesh of entry.meshes) { mesh.material = material; mesh.visible = visible; mesh.castShadow = shadow; }
    for (const line of entry.edges) { line.material = edge; line.visible = visible; }
  }

  private updateHalo(mode: SceneMode, buildingId: string | null, spaceId: string | null) {
    this.halo.visible = false;
    let polygons: MultiPolygon | null = null, lower = 0, upper = 0;
    if ((mode === 'area' || mode === 'building') && buildingId) {
      const box = this.buildingBounds.get(buildingId);
      const input = this.storeyBuildings.get(buildingId);
      const entry = this.entries.get(buildingId);
      if (box && (input || entry)) { polygons = input?.polygons ?? null; lower = Math.max(0, box.min.y) - 0.1; upper = box.max.y + 0.5; }
      if (!polygons && entry) { this.haloFromGeometry(entry.meshes[0]!.geometry, entry.bounds); return; }
    } else if (mode === 'level' && spaceId) {
      const entry = this.entries.get(spaceId);
      if (entry?.meshes[0]!.visible) { this.haloFromGeometry(entry.meshes[0]!.geometry, entry.bounds); return; }
    }
    if (!polygons) return;
    const geometry = prismGeometry(polygons, lower, upper - lower);
    this.haloFromGeometry(geometry, geometry.boundingBox!, true);
  }

  private haloFromGeometry(geometry: BufferGeometry, b: Box3, owned = false) {
    if (this.halo.geometry !== geometry) {
      if (this.haloOwned) this.halo.geometry.dispose();
      this.halo.geometry = geometry;
      this.haloOwned = owned;
    }
    const size = new Vector3().subVectors(b.max, b.min);
    const pad = 0.4;
    const sx = (size.x + pad * 2) / Math.max(size.x, 0.01);
    const sy = (size.y + pad) / Math.max(size.y, 0.01);
    const sz = (size.z + pad * 2) / Math.max(size.z, 0.01);
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    this.halo.scale.set(sx, sy, sz);
    this.halo.position.set(cx * (1 - sx), b.min.y * (1 - sy) - 0.02, cz * (1 - sz));
    this.halo.visible = true;
  }

  /** Section tool: a horizontal cut through the selected building at `sectionM`. */
  private applySection() {
    disposeGroup(this.sectionGroup);
    const { tool, sectionM, buildingId } = this.state;
    const on = tool === 'section' && typeof sectionM === 'number';
    const planes = on ? [this.clip] : [];
    this.clip.constant = sectionM ?? 0;
    for (const material of [this.m.bldg, this.m.selected, this.m.estimated, this.m.ghost, ...this.spaceMaterials.values()]) {
      if (material.clippingPlanes?.length !== planes.length) { material.clippingPlanes = planes; material.needsUpdate = true; }
    }
    this.m.edge.clippingPlanes = planes; this.m.haloEdge.clippingPlanes = planes; this.m.spaceEdge.clippingPlanes = planes; this.m.ghostEdge.clippingPlanes = planes;
    this.halo.visible = this.halo.visible && !on;
    if (!on) return;
    const box = (buildingId && this.buildingBounds.get(buildingId)) || this.areaBox;
    if (box.isEmpty()) return;
    const pad = 4;
    this.sectionGroup.add(lines(rectRing(box.min.x - pad, box.max.x + pad, box.min.z - pad, box.max.z + pad, sectionM!), this.m.sectionLine));
    const plane = new Mesh(new PlaneGeometry(box.max.x - box.min.x + pad * 2, box.max.z - box.min.z + pad * 2), this.m.sectionFill);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set((box.min.x + box.max.x) / 2, sectionM!, (box.min.z + box.max.z) / 2);
    this.sectionGroup.add(plane);
    this.anchors.set('section', new Vector3(box.max.x + pad, sectionM!, box.max.z + pad));
  }

  // ---------------------------------------------------------------- measure

  private addMeasurePoint(point: Vector3) {
    if (this.measurePoints.length >= 2) this.measurePoints = [];
    this.measurePoints.push(point.clone());
    this.drawMeasure();
  }

  private drawMeasure() {
    disposeGroup(this.measureGroup);
    for (const key of ['measure-a', 'measure-b', 'measure-mid']) this.anchors.delete(key);
    const [a, b] = this.measurePoints;
    for (const [i, p] of this.measurePoints.entries()) {
      const dot = new Mesh(new SphereGeometry(0.35, 16, 12), this.m.measureDot);
      dot.position.copy(p);
      dot.renderOrder = 10;
      this.measureGroup.add(dot);
      this.anchors.set(i ? 'measure-b' : 'measure-a', p.clone());
    }
    let measurement: Measurement = { points: this.measurePoints.map((p) => [p.x, p.y, p.z]), distanceM: null, horizontalM: null, verticalM: null };
    if (a && b) {
      const line = lines([a.x, a.y, a.z, b.x, b.y, b.z], this.m.measureLine);
      line.renderOrder = 10;
      const corner = new Vector3(b.x, a.y, b.z);
      const guides = lines([a.x, a.y, a.z, corner.x, corner.y, corner.z, corner.x, corner.y, corner.z, b.x, b.y, b.z], this.m.measureGuide);
      guides.computeLineDistances();
      this.measureGroup.add(line, guides);
      this.anchors.set('measure-mid', new Vector3().addVectors(a, b).multiplyScalar(0.5));
      measurement = {
        ...measurement,
        distanceM: round2(a.distanceTo(b)),
        horizontalM: round2(Math.hypot(b.x - a.x, b.z - a.z)),
        verticalM: round2(b.y - a.y),
      };
    }
    this.options.onMeasure?.(measurement);
    this.requestRender();
  }

  // ---------------------------------------------------------------- trench

  clearTrench(): void {
    this.trenchPoints = [];
    this.drawTrench();
  }

  private addTrenchPoint(point: Vector3) {
    if (this.trenchPoints.length >= 2) this.trenchPoints = [];
    this.trenchPoints.push(new Vector3(point.x, 0, point.z));
    this.drawTrench();
  }

  /** The drawn trench: dashed outline at ground, a translucent dig column to the screening depth, a depth ruler. */
  private drawTrench() {
    disposeGroup(this.trenchGroup);
    for (const key of [...this.anchors.keys()]) if (key.startsWith('depth:') || key === 'trench') this.anchors.delete(key);
    const [a, b] = this.trenchPoints;
    const flat = this.trenchPoints.map((p) => [round2(p.x), round2(-p.z)] as [number, number]);
    for (const p of this.trenchPoints) {
      const dot = new Mesh(new SphereGeometry(0.35, 16, 12), this.m.measureDot);
      dot.position.copy(p);
      this.trenchGroup.add(dot);
    }
    let trench: Trench = { points: flat, lengthM: null, ring: null };
    if (a && b) {
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const nx = -(b.z - a.z) / (len || 1), nz = (b.x - a.x) / (len || 1);
      const w = 1;
      const corners = [
        new Vector3(a.x + nx * w, 0, a.z + nz * w), new Vector3(b.x + nx * w, 0, b.z + nz * w),
        new Vector3(b.x - nx * w, 0, b.z - nz * w), new Vector3(a.x - nx * w, 0, a.z - nz * w),
      ];
      const ring = [...corners, corners[0]!].map((c) => [c.x, -c.z] as [number, number]);
      const depth = Math.max(20, ...this.utilityInputs.map((u) => Math.ceil(-(u.lowerM ?? 0) / 5) * 5));
      const column = new Mesh(prismGeometry([[ring]], -depth, depth), this.m.digColumn);
      const columnEdge = new LineSegments(new EdgesGeometry(column.geometry), this.m.sectionLine);
      const outline: number[] = [];
      for (let i = 0; i < 4; i++) { const p = corners[i]!, q = corners[(i + 1) % 4]!; outline.push(p.x, 0.08, p.z, q.x, 0.08, q.z); }
      const dashed = lines(outline, this.m.trenchDash);
      dashed.computeLineDistances();
      // Ruler down the far corner of the column.
      const r = corners[1]!;
      const ruler: number[] = [r.x, 0, r.z, r.x, -depth, r.z];
      for (let d = 0; d <= depth; d += 5) {
        ruler.push(r.x, -d, r.z, r.x + nx * 1.2, -d, r.z + nz * 1.2);
        this.anchors.set(`depth:${d}`, new Vector3(r.x + nx * 2.2, -d, r.z + nz * 2.2));
      }
      this.trenchGroup.add(column, columnEdge, dashed, lines(ruler, this.m.sectionLine));
      this.anchors.set('trench', new Vector3((a.x + b.x) / 2, 0.6, (a.z + b.z) / 2));
      trench = { points: flat, lengthM: round2(len), ring: ring.map(([x, y]) => [round2(x), round2(y)] as [number, number]) };
    }
    this.options.onTrench?.(trench);
    this.requestRender();
  }

  // ---------------------------------------------------------------- camera

  private applyCamera(instant: boolean) {
    const { mode, buildingId, levelId, finding } = this.state;
    const key = `${mode}|${mode === 'area' ? '' : buildingId ?? ''}|${mode === 'level' ? levelId ?? '' : ''}|${mode === 'findings' ? finding?.id ?? '' : ''}`;
    if (key === this.cameraKey) return;
    const target = this.cameraTarget(mode, buildingId, levelId, finding);
    if (!target) return;
    this.cameraKey = key;
    // Fit to the narrower of the vertical and horizontal fields of view, so a narrow canvas still shows the whole target.
    const aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight);
    const hFov = (2 * Math.atan(Math.tan((this.camera.fov * Math.PI) / 360) * aspect) * 180) / Math.PI;
    const pose = presetFor(mode, target.bounds, target.focusY, target.extentY, Math.min(this.camera.fov, hFov));
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

  private cameraTarget(mode: SceneMode, buildingId: string | null, levelId: string | null, finding: FindingInput | null | undefined) {
    const box = new Box3();
    let focusY: number;
    if (mode === 'area') {
      box.copy(this.areaBox);
      focusY = 4;
    } else if (mode === 'level') {
      for (const e of this.entries.values()) if (e.kind === 'space' && e.levelId === levelId) box.union(e.bounds);
      if (box.isEmpty() && buildingId && levelId) { const s = this.entries.get(`${buildingId}::${levelId}`); if (s) box.copy(s.bounds); }
      focusY = box.isEmpty() ? 0 : box.min.y - 1;
    } else if (mode === 'findings' && finding) {
      if (finding.polygons.length) {
        const g = prismGeometry(finding.polygons, finding.lowerM, Math.max(0.2, finding.upperM - finding.lowerM));
        box.copy(g.boundingBox!);
        g.dispose();
      }
      if (box.isEmpty()) for (const id of finding.participants) { const e = this.entries.get(id); if (e?.kind === 'space') box.union(e.bounds); }
      if (box.isEmpty() && buildingId) { const b = this.buildingBounds.get(buildingId); if (b) box.copy(b); }
      focusY = box.isEmpty() ? 0 : box.min.y;
    } else {
      const b = buildingId ? this.buildingBounds.get(buildingId) : undefined;
      if (b) box.copy(b);
      focusY = mode === 'underground' ? -6 : box.isEmpty() ? 0 : box.min.y + (box.max.y - box.min.y) / (mode === 'deviation' ? 2 : 3);
    }
    if (box.isEmpty()) return null;
    const bounds: Bounds2D = { minX: box.min.x, maxX: box.max.x, minY: -box.max.z, maxY: -box.min.z };
    return { bounds, focusY, extentY: box.max.y - box.min.y };
  }

  // --------------------------------------------------------------- internals

  private raycast(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets: Object3D[] = [];
    const m = this.m;
    for (const entry of this.entries.values()) {
      for (const mesh of entry.meshes) if (mesh.visible && mesh.material !== m.ghost && mesh.material !== m.faint && mesh.material !== m.ghostDark) targets.push(mesh);
    }
    targets.push(this.ground);
    const hits = this.raycaster.intersectObjects(targets, false);
    const section = this.state.tool === 'section' && typeof this.state.sectionM === 'number' ? this.state.sectionM : null;
    return hits.find((h) => section === null || h.object === this.ground || h.point.y <= section + 0.01);
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

  private clearEntries(group: Group, match: (e: Entry) => boolean) {
    for (const entry of [...this.entries.values()]) {
      if (!match(entry)) continue;
      for (const mesh of entry.meshes) mesh.geometry.dispose();
      for (const edge of entry.edges) edge.geometry.dispose();
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
    if (this.state.mode === 'deviation') this.renderSplit();
    else this.renderer.render(this.scene, this.camera);
    this.recordFrameTime(performance.now() - started);
    this.options.onView?.();
    if (animating || [...this.tilesets].some((tiles) => tiles.loadProgress < 1)) this.requestRender();
  };

  /** Two views of one camera: sanctioned (left, without the observed-only volume) and observed (right). */
  private renderSplit() {
    const r = this.renderer;
    const { clientWidth: w, clientHeight: h } = this.container;
    const half = Math.floor(w / 2);
    this.camera.aspect = half / h;
    this.camera.updateProjectionMatrix();
    r.setScissorTest(true);
    this.deviationGroup.visible = false;
    r.setViewport(0, 0, half, h); r.setScissor(0, 0, half, h); r.render(this.scene, this.camera);
    this.deviationGroup.visible = true;
    r.setViewport(half, 0, w - half, h); r.setScissor(half, 0, w - half, h); r.render(this.scene, this.camera);
    r.setScissorTest(false);
    r.setViewport(0, 0, w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private stepGrow(now: number): boolean {
    let active = false;
    for (const entry of this.entries.values()) {
      if (entry.grow === undefined) continue;
      const t = Math.min(1, (now - entry.grow) / GROW_MS);
      const k = this.options.reducedMotion ? 1 : 1 - Math.pow(1 - t, 3);
      for (const o of [...entry.meshes, ...entry.edges]) o.scale.y = Math.max(0.001, k);
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
    const box = this.areaBox;
    if (box.isEmpty()) return;
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 60);
    this.ground.position.set(cx, -0.01, cz);
    this.ground.scale.set(span * 10, span * 10, 1);
    (this.scene.fog as Fog).near = span * 1.4;
    (this.scene.fog as Fog).far = span * 3.4;
    const d = span * 1.2;
    this.sun.position.set(cx - d * 0.55, d * 0.9, cz + d * 0.6);
    this.sun.target.position.set(cx, 0, cz);
    const cam = this.sun.shadow.camera;
    cam.left = -span * 0.75; cam.right = span * 0.75; cam.top = span * 0.75; cam.bottom = -span * 0.75;
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
    if (this.state.tool === 'measure') {
      const hit = this.raycast(event.clientX, event.clientY);
      if (hit) this.addMeasurePoint(hit.point);
      return;
    }
    if (this.state.mode === 'underground') {
      // Underground, a click on the ground places a trench end (two clicks draw it).
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = this.raycaster.intersectObject(this.ground, false)[0];
      if (hit) this.addTrenchPoint(hit.point);
      return;
    }
    this.options.onPick?.(this.pick(event.clientX, event.clientY));
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    if (event.buttons) return;
    if (this.state.tool === 'measure' || this.state.mode === 'underground') { this.renderer.domElement.style.cursor = 'crosshair'; return; }
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

function makeMaterials(p: ScenePalette, clip: Plane) {
  void clip;
  const contextColor = new Color(p.ground).lerp(new Color(p.building), 0.35);
  const std = (color: string | Color, extra: Partial<MeshStandardMaterial> = {}) => new MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, ...extra });
  return {
    ground: std(p.ground, { roughness: 0.95 }),
    road: std(p.road),
    publicLand: std(p.publicLand),
    water: std(p.water, { roughness: 0.4 }),
    parcel: new LineBasicMaterial({ color: p.parcelLine, transparent: true, opacity: 0.7 }),
    bldg: std(p.building),
    bldgContext: std(contextColor),
    unknown: new MeshLambertMaterial({ map: hatchTexture(p.building, p.buildingEdge) }),
    unknownContext: new MeshLambertMaterial({ map: hatchTexture(p.building, p.buildingEdge), transparent: true, opacity: 0.45 }),
    estimated: new MeshLambertMaterial({ map: hatchTexture(p.building, p.buildingEdge) }),
    selected: std(p.selected, { roughness: 0.85 }),
    ghost: new MeshBasicMaterial({ color: p.buildingEdge, transparent: true, opacity: 0.1, depthWrite: false }),
    ghostDark: new MeshBasicMaterial({ color: p.buildingEdge, transparent: true, opacity: 0.18, depthWrite: false }),
    faint: new MeshBasicMaterial({ color: p.building, transparent: true, opacity: 0.25, depthWrite: false }),
    halo: new MeshBasicMaterial({ color: p.halo, side: BackSide }),
    edge: new LineBasicMaterial({ color: p.buildingEdge }),
    edgeContext: new LineBasicMaterial({ color: p.buildingEdge, transparent: true, opacity: 0.35 }),
    ghostEdge: new LineBasicMaterial({ color: p.buildingEdge, transparent: true, opacity: 0.5 }),
    inkEdge: new LineBasicMaterial({ color: p.ink }),
    haloEdge: new LineBasicMaterial({ color: p.halo, transparent: true, opacity: 0.55 }),
    spaceEdge: new LineBasicMaterial({ color: p.halo, transparent: true, opacity: 0.9 }),
    critical: new MeshBasicMaterial({ map: hatchTexture(p.critical, p.halo, 5) }),
    noSurvey: new MeshBasicMaterial({ map: hatchTexture(p.readinessUnknown, p.halo, 6), transparent: true, opacity: 0.75, depthWrite: false }),
    soil: new MeshBasicMaterial({ color: p.soilTop, transparent: true, opacity: 0.2, depthWrite: false, side: BackSide }),
    soilEdge: new LineBasicMaterial({ color: p.soilDeep, transparent: true, opacity: 0.6 }),
    measureLine: new LineBasicMaterial({ color: p.ink, depthTest: false }),
    measureGuide: new LineDashedMaterial({ color: p.ink, dashSize: 0.6, gapSize: 0.4, depthTest: false, transparent: true, opacity: 0.6 }),
    measureDot: new MeshBasicMaterial({ color: p.selected, depthTest: false }),
    sectionLine: new LineBasicMaterial({ color: p.selected }),
    digColumn: new MeshBasicMaterial({ color: p.selected, transparent: true, opacity: 0.14, depthWrite: false }),
    trenchDash: new LineDashedMaterial({ color: p.selected, dashSize: 0.8, gapSize: 0.5 }),
    sectionFill: new MeshBasicMaterial({ color: p.selected, transparent: true, opacity: 0.08, depthWrite: false, side: BackSide }),
  };
}

/** Edges plus a line at every recorded slab (never invented storey spacing). */
function edgeGeometry(geometry: BufferGeometry, input: FootprintInput): BufferGeometry {
  const edges = new EdgesGeometry(geometry, 30);
  if (!input.slabsM?.length) return edges;
  const positions = [...(edges.getAttribute('position').array as Float32Array)];
  const base = input.baseM ?? 0;
  for (const polygon of input.polygons) for (const slab of input.slabsM) positions.push(...ringLines(polygon[0] ?? [], base + slab));
  edges.dispose();
  const out = new BufferGeometry();
  out.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return out;
}

function ringLines(ring: [number, number][], y: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, ay] = ring[i]!;
    const [bx, by] = ring[i + 1]!;
    out.push(ax, y, -ay, bx, y, -by);
  }
  return out;
}

function lines(positions: number[], material: Material): LineSegments {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const l = new LineSegments(g, material);
  l.raycast = () => {};
  return l;
}

function rectRing(x0: number, x1: number, z0: number, z1: number, y: number): number[] {
  return [x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0];
}

function squareRing(x: number, y: number, h: number): [number, number][] {
  return [[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h], [x - h, y - h]];
}

/** Column positions along the outer ring: at each corner and about every 8 m, inset towards the centre. */
function columnPositions(polygons: MultiPolygon): [number, number][] {
  const out: [number, number][] = [];
  for (const polygon of polygons) {
    const ring = polygon[0] ?? [];
    const n = ring.length - 1;
    if (n < 3) continue;
    const cx = ring.slice(0, n).reduce((a, [x]) => a + x, 0) / n;
    const cy = ring.slice(0, n).reduce((a, [, y]) => a + y, 0) / n;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = ring[i]!;
      const [bx, by] = ring[i + 1]!;
      const steps = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 8));
      for (let s = 0; s < steps; s++) {
        const x = ax + ((bx - ax) * s) / steps, y = ay + ((by - ay) * s) / steps;
        const d = Math.hypot(cx - x, cy - y) || 1;
        out.push([x + ((cx - x) / d) * 0.45, y + ((cy - y) / d) * 0.45]);
      }
    }
  }
  return out;
}

/** Thin wall strips along each edge of the outer ring (a roof parapet). */
function parapetRings(polygons: MultiPolygon, thickness: number): [number, number][][] {
  const out: [number, number][][] = [];
  for (const polygon of polygons) {
    const ring = polygon[0] ?? [];
    const n = ring.length - 1;
    const cx = ring.slice(0, n).reduce((a, [x]) => a + x, 0) / Math.max(1, n);
    const cy = ring.slice(0, n).reduce((a, [, y]) => a + y, 0) / Math.max(1, n);
    for (let i = 0; i < n; i++) {
      const [ax, ay] = ring[i]!;
      const [bx, by] = ring[i + 1]!;
      const len = Math.hypot(bx - ax, by - ay) || 1;
      let nx = -(by - ay) / len, ny = (bx - ax) / len;
      if ((cx - ax) * nx + (cy - ay) * ny < 0) { nx = -nx; ny = -ny; }
      const ix = nx * thickness, iy = ny * thickness;
      out.push([[ax, ay], [bx, by], [bx + ix, by + iy], [ax + ix, ay + iy], [ax, ay]]);
    }
  }
  return out;
}

function disposeObject(object: Object3D) {
  object.traverse((o) => (o as Mesh).geometry?.dispose?.());
}

function disposeGroup(group: Group) {
  for (const child of [...group.children]) disposeObject(child);
  group.clear();
}

const round2 = (v: number) => Math.round(v * 100) / 100;

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
