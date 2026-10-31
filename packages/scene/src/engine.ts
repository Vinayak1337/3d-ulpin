import {
  BackSide, MOUSE, Spherical, TOUCH, BufferAttribute, Points, PointsMaterial, Box3, BoxGeometry, BufferGeometry, CanvasTexture, Color, DirectionalLight, EdgesGeometry, Float32BufferAttribute, Fog,
  Group, HemisphereLight, LineBasicMaterial, LineDashedMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  MeshStandardMaterial, PCFShadowMap, PerspectiveCamera, Plane, PlaneGeometry, Raycaster, RepeatWrapping, SRGBColorSpace, Scene,
  SphereGeometry, Vector2, Vector3, WebGLRenderer, LineLoop, type Material, type Object3D,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TilesRenderer } from '3d-tiles-renderer';
import { BATCH_SIZE, BuildingBatch } from './building-batch';
import { presetFor } from './camera';
import { readablePlanBox } from './import-frame';
import { startProgramWarmUp, type ProgramWarmUp } from './warm-programs';
import { FLAT_THICKNESS_M, boundsOf, buildingLook, hasKnownHeight, prismGeometry, shapesFor } from './geometry';
import type { BuildingLook } from './geometry';
import { enhanceFacade, enhanceSurface, facadeStyle, labelPoint, laneDashes, lookUniforms, padGeometry, paintGeometry, treeMeshes, type SceneLook } from './look';
import type {
  BaseFeatureInput, Bounds2D, BuildingDetailInput, FindingInput, FootprintInput, Measurement, MultiPolygon, Pick, SceneMode,
  OverlayInput, ScenePalette, SceneLayers, SceneState, SceneStats, SpaceFill, StoreyInput, Trench, DeviationInput,
  SurfacePartInput, PreviewOutlineInput,
} from './types';

export interface SceneEngineOptions {
  palette: ScenePalette;
  onPick?: (pick: Pick) => void;
  onHover?: (pick: Pick) => void;
  /** Called after every rendered frame, so HTML overlays (labels, readout) can follow the camera. */
  onView?: () => void;
  /** Called after rendering the last queued addition, not merely after building its meshes. */
  onBuildingsDrawn?: () => void;
  onMeasure?: (measurement: Measurement) => void;
  onTrench?: (trench: Trench) => void;
  reducedMotion?: boolean;
  /** Enhanced (illustrative dressing, the default) or plain massing. */
  look?: SceneLook;
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
  /** Drawn with a thematic colour (Colour by). */
  themed?: boolean;
  /** Buildings only: ghost for a candidate, hatch for an unknown or estimated height. */
  look?: BuildingLook;
  /** Footprint buildings at rest: the batch that draws them while they look like it. */
  batch?: BuildingBatch;
}

interface BaseBatch {
  inputs: Map<string, BaseFeatureInput>;
  parcel: LineSegments | null;
  roadKerbs: LineSegments | null;
  sidewalkKerbs: LineSegments | null;
  lanes: LineSegments | null;
  lines: LineSegments | null;
  pins: Points | null;
}

interface BaseEntry {
  input: BaseFeatureInput;
  mesh: Mesh | null;
  bounds: Box3;
  batch: BaseBatch;
}

const CAMERA_MS = 600;
const GROW_MS = 220;
// The camera's own depth range, the floor for every framing. Near/far stays 1 : 66,667 as the far plane grows, so
// depth precision holds the same at every scale.
const CAMERA_NEAR = 0.3;
const CAMERA_FAR = 20_000;
// A framed pose leaves far at 1.25 times the distance to the farthest point of what is framed.
const FAR_MARGIN = 1.25;
// Framed-area haze is complete by 2.4 reaches (or the far plane, if nearer).
const FOG_DEPTH = 2.4;
// The sun's shadow map covers at most this far either side of the view's target: past it, buildings cast no shadow.
const SHADOW_HALF_MAX = 1500;
// The area window is read at most this many camera distances from the target; past it, only what is loaded draws.
const VIEW_REACH = 1.5;
// Leave most of a 16.7 ms frame for WebGL uploads, drawing and the browser. One building is atomic.
const BUILDING_BUDGET_MS = 4;
const BASE_BUDGET_MS = 4;
// Tree avoidance needs all footprints; bound global recomputation while a long queue drains.
const DRESSING_INTERVAL_MS = 250;
// Local x is east (scene +x), local y is north (scene -z); scene +y is up.
// South-west at 45° elevation: horizontal length equals vertical height.
const SUN_DIR = new Vector3(-1, Math.SQRT2, 1).normalize();
// Plain and enhanced fill under the 1.6 sun: key : fill 1.6 : 1.
const FILL_INTENSITY = 1;

/** Illustrative kerb height of raised sidewalks, metres (enhanced view only). */
const SIDEWALK_M = 0.15;
const CONTEXT_FILL_ORDER = -4;
const GROUND_PICTURE_ORDER = -3;
const GROUND_OVERVIEW_ORDER = GROUND_PICTURE_ORDER - 1;

const INITIAL_STATE: SceneState = { mode: 'area', buildingId: null, levelId: null, spaceId: null, tool: 'select' };
/** What a camera pose frames: a plan box, the height looked at and the height of what is framed. */
type CameraTarget = { bounds: Bounds2D; focusY: number; extentY: number };
/**
 * The camera's depth range, the farthest the view may be zoomed out, the framed reach the fog must clear, and the
 * plan square (x, z) around the view's target that the ground must cover.
 */
type ClipRange = { near: number; far: number; maxDistance: number; reach: number; frame: Box3 };

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
  private readonly buildingInputs = new Map<string, FootprintInput>();
  private readonly buildingEntries = new Map<string, Entry[]>();
  private buildingQueue = new Map<string, { input: FootprintInput; growNew: boolean }>();
  private readonly renderedBuildings = new Set<string>();
  private readonly renderChanges = new Map<string, boolean>();
  private readonly drawWaiters = new Set<{
    buildings: readonly string[];
    base: readonly string[];
    finish: (drawn: boolean) => void;
  }>();
  private baseInputs: BaseFeatureInput[] = [];
  private readonly baseEntries = new Map<string, BaseEntry>();
  private readonly baseBatches = new Set<BaseBatch>();
  private baseQueue = new Map<string, { input: BaseFeatureInput; batch: BaseBatch; bounds: Box3 }>();
  private readonly utilityMeshes = new Map<string, { input: BaseFeatureInput; mesh: Mesh }>();
  private hasSidewalks = false;
  private renderedBase = new Set<string>();
  private baseNeedsDraw = false;
  private notifyDrain = false;
  private readonly storeyBuildings = new Map<string, FootprintInput>();
  // Batches of resting footprint buildings, by rest material and known height.
  private readonly batches = new Map<string, Set<BuildingBatch>>();
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
  private readonly programWarmUp: ProgramWarmUp;
  private readonly spaceMaterials = new Map<string, Material>();
  private readonly resizeObserver: ResizeObserver;
  private readonly clip = new Plane(new Vector3(0, -1, 0), 0);
  private utilityInputs: BaseFeatureInput[] = [];
  private detailInput: BuildingDetailInput | null = null;
  private state: SceneState = INITIAL_STATE;
  private findingKey = '';
  private cameraKey = '';
  private readonly baseBox = new Box3();
  private readonly arrivedBox = new Box3();
  private readonly arrivalBounds = new Map<string, Box3>();
  private framedBox: Box3 | null = null;
  private importStreaming = false;
  private followImport = false;
  // The package the map shows, its own feature ids and the readable box of those drawn (null: not yet worked out).
  private importKey: string | null = null;
  private importIds: ReadonlySet<string> = new Set();
  private importBox: Box3 | null = null;
  // The framed box is the package's own: growth inside it keeps the view.
  private framedOwn = false;
  // The officer moved the camera since the running import began: later packages keep their view.
  private officerMoved = false;
  private hovered: string | null = null;
  private frameRequested = false;
  private disposed = false;
  private flight: { from: [Vector3, Vector3]; to: [Vector3, Vector3]; start: number; clip?: ClipRange } | null = null;
  private frameTimes: number[] = [];
  private frames = 0;
  private downAt: { x: number; y: number } | null = null;
  private anchors = new Map<string, Vector3>();
  private measurePoints: Vector3[] = [];
  private trenchPoints: Vector3[] = [];
  private readonly trenchGroup = new Group();
  private areaBox = new Box3();
  private framedReach = 0;
  private frame = new Box3();
  private haloOwned = false;
  private readonly dressing = new Group();
  private readonly kerbs = new Group();
  private readonly plate: Mesh;
  private readonly look = lookUniforms();
  private lookName: SceneLook;
  private flat = false;
  private readonly areaOutline = new Group();
  private areaExtentFramed = false;
  private areaCameraMoved = false;
  private readonly footprintPolygons = new Map<string, MultiPolygon>();
  private lands: { id: string; polygons: MultiPolygon }[] = [];
  private dressingDirty = false;
  private dressingAt = -Infinity;
  private readonly pads = new Map<string, Mesh>();
  private readonly padBatches = new Map<Mesh, Map<string, MultiPolygon>>();
  private readonly pendingPads = new Map<string, MultiPolygon>();
  private readonly trees = new Group();
  private hasRoads = false;
  private readonly raised: Mesh[] = [];
  private readonly anchorSizes = new Map<string, number>();
  private readonly overlays = new Group();
  private readonly surface = new Group();
  private readonly surfaceParts = new Map<string, { input: SurfacePartInput; object: Group }>();
  private readonly preview = new Group();
  private surfaceQueue = new Map<string, SurfacePartInput>();
  private surfaceCompiling = false;
  private layers: SceneLayers = { parcels: true, roads: true, publicLand: true, trees: true };

  constructor(container: HTMLElement, options: SceneEngineOptions) {
    this.container = container;
    this.options = options;
    const { palette } = options;

    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    // Three r186 draws PCFSoft as PCF; naming PCF keeps the program keys the warm-up compiles unchanged at first draw.
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor(new Color(palette.ground));
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.camera = new PerspectiveCamera(32, 1, CAMERA_NEAR, CAMERA_FAR);
    this.camera.position.set(112, 88, 134);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.maxPolarAngle = Math.PI * 0.62; // allows the low underground view
    this.controls.minDistance = 6;
    this.controls.screenSpacePanning = false;
    // Map navigation: drag moves the map; right-drag, Ctrl/Shift-drag or two fingers rotate; wheel or pinch zooms.
    this.controls.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
    this.controls.touches = { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE };
    this.renderer.domElement.addEventListener('wheel', this.onWheel, { capture: true, passive: false });
    this.controls.addEventListener('start', () => { this.flight = null; this.areaCameraMoved = true; });
    this.controls.addEventListener('change', () => this.requestRender());

    const ground = new Color(palette.ground);
    this.scene.background = ground;
    this.scene.fog = new Fog(ground, 260, 620);
    this.hemi = new HemisphereLight(0xffffff, 0xcfd6d4, FILL_INTENSITY);
    this.sun = new DirectionalLight(0xffffff, 1.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.4;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.m = makeMaterials(palette, this.clip);
    enhanceFacade(this.m.bldg, this.look, { windows: true, tint: true });
    enhanceFacade(this.m.bldgContext, this.look, { windows: true, tint: true });
    enhanceFacade(this.m.occluder, this.look, { windows: true, tint: true });
    // Thematic colours show in both looks: their tint is always on.
    enhanceFacade(this.m.themed, this.look, { windows: true, tint: true, alwaysTint: true, glass: '#9aa7ae' });
    enhanceFacade(this.m.selected, this.look, { windows: true, tint: false, glass: '#8fb3a8' });
    enhanceFacade(this.m.hover, this.look, { windows: true, tint: true, lift: '#e3f1ea' });
    enhanceSurface(this.m.road, this.look, 'paving');
    enhanceSurface(this.m.sidewalk, this.look, 'paving');
    enhanceSurface(this.m.court, this.look, 'paving');
    enhanceSurface(this.m.publicLand, this.look, 'grass');
    enhanceSurface(this.m.water, this.look, 'water');
    this.plate = new Mesh(new BufferGeometry(), this.m.plate);
    this.plate.visible = false;
    this.plate.renderOrder = -2;
    this.plate.raycast = () => {};
    this.lookName = options.look ?? 'enhanced';
    this.ground = new Mesh(new PlaneGeometry(1, 1), this.m.ground);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.renderOrder = CONTEXT_FILL_ORDER;
    this.ground.receiveShadow = true;
    this.ground.scale.set(1400, 1400, 1);
    this.halo = new Mesh(new BufferGeometry(), this.m.halo);
    this.halo.renderOrder = -1;
    this.halo.visible = false;
    this.underground.add(this.utilities, this.trenchGroup);
    this.base.add(this.kerbs);
    this.dressing.add(this.trees);
    this.scene.add(this.ground, this.overlays, this.dressing, this.plate, this.base, this.buildings, this.detail, this.findingGroup, this.underground, this.measureGroup, this.sectionGroup, this.deviationGroup, this.halo);
    this.scene.add(this.surface, this.preview, this.areaOutline);

    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.setLook(this.lookName);
    this.programWarmUp = startProgramWarmUp(this.renderer, this.camera, this.scene, this.m);
  }

  // ------------------------------------------------------------------- look

  /** Enhanced view (illustrative tints, windows, pads, trees) or plain massing. Records are unchanged either way. */
  setLook(look: SceneLook): void {
    this.lookName = look;
    const on = look === 'enhanced';
    const p = this.options.palette;
    const m = this.m;
    this.look.uLook.value = on ? 1 : 0;
    m.bldg.color.set(on ? '#ffffff' : p.building);
    m.bldgContext.color.set(on ? '#dfe2df' : new Color(p.ground).lerp(new Color(p.building), 0.35).getStyle());
    m.occluder.color.copy(m.bldgContext.color);
    // Without recorded roads this is open map ground, not a dark invented street surface.
    m.ground.color.set(on && this.hasRoads ? '#dfe2dc' : p.ground);
    m.road.color.set(on ? '#9aa0a3' : p.road);
    m.publicLand.color.set(on ? '#b5d19f' : p.publicLand);
    m.water.color.set(on ? '#7fb0d0' : p.water);
    m.sidewalk.color.set(on ? '#dedcd5' : p.road);
    m.court.color.set(on ? '#b7c9b5' : p.road);
    // Reserve contrast for a wall receiving only 25% of its material's linear light, not the raw token.
    const edge = on ? '#b3ab9e' : p.buildingEdge;
    m.edge.color.copy(contrastingEdge(edge, p.ink, new Color(p.building).multiplyScalar(0.25)));
    m.edgeContext.color.copy(m.edge.color);
    // One haze step: 25% from this look's ground towards the halo, in linear light.
    const horizon = m.ground.color.clone().lerp(new Color(p.halo), 0.25);
    this.scene.background = horizon;
    (this.scene.fog as Fog).color.copy(horizon);
    this.renderer.setClearColor(horizon);
    this.hemi.color.set(on ? '#f3f7fb' : '#ffffff');
    // A dark lower hemisphere keeps the fill from flattening walls into the upward-facing ground.
    this.hemi.groundColor.set(p.ink);
    this.sun.color.set(on ? '#fff3e0' : '#ffffff');
    this.dressing.visible = on;
    this.applyRaise();
    this.applyLayers();
    this.apply();
  }

  private applyRaise() {
    const k = this.lookName === 'enhanced' ? 1 : 0.02;
    for (const mesh of this.raised) mesh.scale.y = k;
    for (const line of this.kerbs.children) line.scale.y = this.hasSidewalkKerbs() ? k : 1;
  }

  private hasSidewalkKerbs(): boolean {
    return this.raised.length > 0;
  }

  /**
   * On-screen size (CSS px) of the feature a name anchor belongs to, so its label can be hidden while the
   * feature is too small to read; null for anchors without a size.
   */
  anchorPixelSize(id: string): number | null {
    const size = this.anchorSizes.get(id), point = this.anchors.get(id);
    if (size === undefined || !point) return null;
    const distance = this.camera.position.distanceTo(point);
    const metresPerPx = (2 * distance * Math.tan((this.camera.fov * Math.PI) / 360)) / Math.max(1, this.container.clientHeight);
    return size / metresPerPx;
  }

  /** Brings an overlay's coverage into view when it is not already fully on screen. */
  focusOverlay(id: string): void {
    const object = this.overlays.children.find((c) => c.userData.overlay === id);
    if (!object) return;
    const box = new Box3().setFromObject(object);
    if (box.isEmpty() || this.readableInView(box)) return;
    box.max.y = Math.max(box.max.y, 1);
    box.min.y = 0;
    this.cameraKey = 'overlay';
    this.flyToNeighbourhood(box, false, 20);
  }

  /** Georeferenced imagery and measured point sets, drawn over the base map. Replaces the previous set. */
  setOverlays(overlays: OverlayInput[]): void {
    for (const child of [...this.overlays.children]) {
      disposeObject(child);
      const material = (child as Mesh).material as Material & { map?: { dispose(): void } | null };
      material.map?.dispose();
      material.dispose();
    }
    this.overlays.clear();
    for (const o of overlays) {
      if (o.kind === 'image') {
        const [sw, se, ne, nw] = o.corners;
        const g = new BufferGeometry();
        const ground = o.role === 'ground';
        const y = ground ? 0 : 0.2;
        g.setAttribute('position', new Float32BufferAttribute([sw[0], y, -sw[1], se[0], y, -se[1], ne[0], y, -ne[1], nw[0], y, -nw[1]], 3));
        g.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
        g.setIndex([0, 1, 2, 0, 2, 3]);
        g.computeVertexNormals();
        const texture = new CanvasTexture(o.image);
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        // Ground pictures use the opaque queue between fills and records, not depth bias: even far away they
        // cannot flicker against fills or hide records. Alpha cutout keeps no-data pixels clear, without a
        // late transparent pass over records. They neither test nor write depth and change no record height.
        const material = ground
          ? new MeshBasicMaterial({ map: texture, alphaTest: 0.01, depthTest: false, depthWrite: false })
          : new MeshBasicMaterial({
            map: texture, transparent: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
          });
        const mesh = new Mesh(g, material);
        mesh.renderOrder = ground ? GROUND_PICTURE_ORDER : 0;
        mesh.raycast = () => {};
        mesh.userData.overlay = o.id;
        this.overlays.add(mesh);
      } else if (o.kind === 'comparison') {
        const conflict = o.role === 'conflict';
        const color = conflict ? this.options.palette.critical : (this.options.palette.comparisonPlan ?? this.options.palette.selected);
        const g = prismGeometry(o.polygons, 0.12, conflict ? o.heightM : 0.01);
        if (conflict) {
          const mesh = new Mesh(g, new MeshBasicMaterial({ color, transparent: true, opacity: 0.72, depthWrite: false, depthTest: false }));
          mesh.renderOrder = 20;
          mesh.raycast = () => {};
          this.overlays.add(mesh);
        }
        const edge = new LineSegments(new EdgesGeometry(g), new LineBasicMaterial({ color, transparent: true, opacity: conflict ? 1 : 0.65, depthTest: false, depthWrite: false }));
        edge.renderOrder = 21;
        edge.raycast = () => {};
        this.overlays.add(edge);
        if (!conflict) g.dispose();
      } else {
        const g = new BufferGeometry();
        const positions = new Float32Array(o.positions.length);
        for (let i = 0; i < o.positions.length; i += 3) { positions[i] = o.positions[i]!; positions[i + 1] = o.positions[i + 2]!; positions[i + 2] = -o.positions[i + 1]!; }
        g.setAttribute('position', new BufferAttribute(positions, 3));
        g.setAttribute('color', new BufferAttribute(o.colors, 3));
        const points = new Points(g, new PointsMaterial({ size: o.sizeM, vertexColors: true, sizeAttenuation: true }));
        points.raycast = () => {};
        points.userData.overlay = o.id;
        this.overlays.add(points);
      }
    }
    this.requestRender();
  }

  /**
   * Read parts of kept surfaces, display only. Parts are kept by id: a new part is added and a gone or changed one
   * removed, so a part that arrives never rebuilds the parts already drawn. Queue additions so opening a map
   * with many available parts does not construct and upload all their textures and buffers in one frame.
   */
  setSurfaceParts(parts: SurfacePartInput[]): void {
    const next = new Map(parts.map((part) => [part.id, part]));
    let removed = false;
    for (const [id, drawn] of this.surfaceParts) {
      if (next.get(id) === drawn.input) continue;
      this.surface.remove(drawn.object);
      disposeSurfacePart(drawn.object);
      this.surfaceParts.delete(id);
      removed = true;
    }
    this.surfaceQueue = new Map([...next].filter(([id]) => !this.surfaceParts.has(id)));
    if (removed || this.surfaceQueue.size) this.requestRender();
  }

  private drainSurfaceQueue() {
    if (!this.programWarmUp.settled || !this.surfaceQueue.size || this.surfaceCompiling) return;
    // One part is atomic. Limit uploads as well as CPU construction, even when construction is very cheap.
    const [id, part] = this.surfaceQueue.entries().next().value!;
    this.surfaceQueue.delete(id);
    const object = surfacePartObject(part, this.options.palette.comparisonPlan ?? this.options.palette.selected);
    this.surfaceParts.set(id, { input: part, object });
    // Its programs link and its picture uploads before the part joins the scene, so its first draw does neither.
    this.surfaceCompiling = true;
    void this.renderer.compileAsync(object, this.camera, this.scene).catch(() => undefined).then(() => {
      this.surfaceCompiling = false;
      if (this.disposed || this.surfaceParts.get(id)?.object !== object) return;
      object.traverse((child) => {
        const map = ((child as Mesh).material as MeshBasicMaterial | undefined)?.map;
        if (map) this.renderer.initTexture(map);
      });
      this.surface.add(object);
      this.requestRender();
    });
  }

  /**
   * Outlines read so far from a file still being read, display only: one dashed line set with no fill or height,
   * replaced whole on every call and never picked, so no inspector or measurement reaches it.
   */
  setPreviewOutlines(outlines: PreviewOutlineInput[]): void {
    for (const child of [...this.preview.children] as LineSegments[]) {
      child.geometry.dispose();
      (child.material as Material).dispose();
    }
    this.preview.clear();
    if (outlines.length) {
      const { palette } = this.options;
      this.preview.add(previewLines(outlines, palette.preview ?? palette.comparisonPlan ?? palette.selected));
    }
    this.requestRender();
  }

  /** Loading context only: local-metre extent, no fill, height, pick or record. */
  setAreaExtent(extent: readonly number[] | null): void {
    disposeGroup(this.areaOutline);
    if (!extent || extent.length !== 4 || !extent.every(Number.isFinite)) { this.requestRender(); return; }
    const [minX, minY, maxX, maxY] = extent as readonly [number, number, number, number];
    const polygons: MultiPolygon = [[[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]]]];
    this.areaOutline.add(previewLines([{ id: 'area-extent', polygons }], this.options.palette.parcelLine));
    this.areaOutline.visible = this.buildingInputs.size === 0;
    const empty = !this.buildingInputs.size && !this.baseEntries.size && !this.overlays.children.length
      && !this.surfaceParts.size;
    if (empty && !this.areaExtentFramed && !this.areaCameraMoved && !this.cameraKey) {
      this.areaExtentFramed = true;
      this.frameTarget('area', { bounds: { minX, minY, maxX, maxY }, focusY: 0, extentY: 0 }, true);
    }
    this.requestRender();
  }

  /** Shows or hides base-map layers. */
  setLayers(layers: Partial<SceneLayers>): void {
    this.layers = { ...this.layers, ...layers };
    this.applyLayers();
    this.requestRender();
  }

  private applyLayers() {
    const on = (layer: unknown) => {
      if (layer === 'parcel') return this.layers.parcels;
      if (layer === 'road') return this.layers.roads;
      if (layer === 'public_land' || layer === 'water') return this.layers.publicLand;
      if (layer === 'trees') return this.layers.trees && this.layers.publicLand;
      return true;
    };
    for (const child of this.base.children) {
      if (child !== this.kerbs) child.visible = on(child.userData.layer);
    }
    this.kerbs.visible = this.lookName === 'enhanced' && this.layers.roads;
    for (const batch of this.baseBatches) {
      if (batch.roadKerbs) batch.roadKerbs.visible = !this.hasSidewalks;
    }
    this.trees.visible = this.layers.trees && this.layers.publicLand;
  }

  /** Top-down (2D) or oblique (3D) camera. */
  setFlat(flat: boolean): void {
    if (flat === this.flat) return;
    this.flat = flat;
    this.controls.maxPolarAngle = flat ? 0 : Math.PI * 0.62;
    this.controls.minPolarAngle = 0;
    this.cameraKey = '';
    this.applyCamera(false);
  }

  /**
   * The ground in view (local east, north) that the area window is read from: where the screen's corners meet the
   * ground, each kept within VIEW_REACH camera distances of the orbit target. Looking down, every corner of a canvas
   * up to five times as wide as it is high lies within that reach, so the window holds the whole screen.
   */
  viewFootprint(): [number, number][] {
    const out: [number, number][] = [];
    const target = this.controls.target;
    const distance = this.camera.position.distanceTo(target);
    const reach = distance * VIEW_REACH;
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      this.raycaster.setFromCamera(new Vector2(x, y), this.camera);
      const { origin, direction } = this.raycaster.ray;
      // A ray that misses the ground is followed past the reach, then kept within it like any other.
      const t = direction.y < -1e-4 ? -origin.y / direction.y : distance + reach;
      const dx = origin.x + direction.x * t - target.x, dz = origin.z + direction.z * t - target.z;
      const keep = Math.min(1, reach / Math.max(Math.hypot(dx, dz), 1e-9));
      out.push([target.x + dx * keep, -(target.z + dz * keep)]);
    }
    return out;
  }

  /** Orbit target in local east, north. */
  targetXY(): [number, number] {
    return [this.controls.target.x, -this.controls.target.z];
  }

  /** Moves the view so it centres on a point (local east, north), keeping the angle and distance. */
  panTo(x: number, y: number): void {
    const delta = new Vector3(x - this.controls.target.x, 0, -y - this.controls.target.z);
    const to: [Vector3, Vector3] = [this.camera.position.clone().add(delta), this.controls.target.clone().add(delta)];
    if (this.options.reducedMotion) {
      this.camera.position.copy(to[0]); this.controls.target.copy(to[1]); this.controls.update(); this.requestRender();
      return;
    }
    this.flight = { from: [this.camera.position.clone(), this.controls.target.clone()], to, start: performance.now() };
    this.requestRender();
  }

  /**
   * Area view: frames a plan box (local east, north) whole, as the view frames its content. Content that arrives
   * later keeps this frame; a selection or another mode moves the camera as before.
   */
  fitPlanBox(minX: number, minY: number, maxX: number, maxY: number): void {
    if (this.state.mode !== 'area') return;
    this.cameraKey = cameraKeyOf(this.state);
    this.framedBox = new Box3(new Vector3(minX, 0, -maxY), new Vector3(maxX, 0, -minY));
    this.framedOwn = false;
    this.frameTarget('area', { bounds: { minX, minY, maxX, maxY }, focusY: 0, extentY: 0 }, false);
  }

  // ---------------------------------------------------------------- content

  /** Base map: roads, public land, water and parcel lines; utilities are kept for underground mode. */
  setBase(features: BaseFeatureInput[]): void {
    if (this.disposed || sameInputs(this.baseInputs, features)) return;
    this.baseInputs = [...features];
    this.baseNeedsDraw = true;
    const wanted = new Map(features.map((input) => [input.id, input]));
    const dirty = new Set<BaseBatch>();
    const arriving: BaseFeatureInput[] = [];
    for (const [id, entry] of this.baseEntries) {
      const input = wanted.get(id);
      if (input && sameInput(entry.input, input)) continue;
      this.removeBaseEntry(id, entry);
      dirty.add(entry.batch);
      if (input) this.addBaseEntry(input, entry.batch);
    }
    for (const input of wanted.values()) if (!this.baseEntries.has(input.id)) arriving.push(input);
    for (const batch of this.replaceBaseQueue(arriving)) dirty.add(batch);
    for (const batch of dirty) this.rebuildBaseLines(batch);
    if (dirty.size || !this.baseQueue.size) this.refreshBase();
    else {
      this.updateBaseBox();
      this.followArrivedContent();
    }
    if (this.baseQueue.size) this.notifyDrain = true;
    this.requestRender();
  }

  private replaceBaseQueue(arriving: BaseFeatureInput[]) {
    const previousBatches = new Set([...this.baseQueue.values()].map((entry) => entry.batch));
    const queue = new Map<string, { input: BaseFeatureInput; batch: BaseBatch; bounds: Box3 }>();
    let batch: BaseBatch | undefined;
    for (const input of arriving) {
      const previous = this.baseQueue.get(input.id);
      if (previous) queue.set(input.id, { input, batch: previous.batch, bounds: baseBounds(input) });
      else {
        batch ??= {
          inputs: new Map(), parcel: null, roadKerbs: null, sidewalkKerbs: null, lanes: null,
          lines: null, pins: null,
        };
        this.baseBatches.add(batch);
        queue.set(input.id, { input, batch, bounds: baseBounds(input) });
      }
    }
    this.baseQueue = queue;
    const pending = new Set([...queue.values()].map((entry) => entry.batch));
    return [...previousBatches].filter((existing) => !pending.has(existing));
  }

  private refreshBase() {
    this.updateBaseDerived(this.baseInputs.filter((input) => this.baseEntries.has(input.id)));
    this.apply();
    this.followArrivedContent();
  }

  private drainBaseQueue() {
    if (!this.programWarmUp.settled) return;
    const started = performance.now();
    const batches = new Set<BaseBatch>();
    while (this.baseQueue.size) {
      const [id, pending] = this.baseQueue.entries().next().value!;
      this.baseQueue.delete(id);
      this.addBaseEntry(pending.input, pending.batch, pending.bounds);
      batches.add(pending.batch);
      if (performance.now() - started >= BASE_BUDGET_MS) break;
    }
    if (!batches.size) return;
    const pending = new Set([...this.baseQueue.values()].map((entry) => entry.batch));
    for (const batch of batches) if (!pending.has(batch)) this.rebuildBaseLines(batch);
    this.baseNeedsDraw = true;
    this.refreshBase();
  }

  private addBaseEntry(input: BaseFeatureInput, batch: BaseBatch, box = baseBounds(input)) {
    const mesh = this.baseSurface(input);
    batch.inputs.set(input.id, input);
    this.baseEntries.set(input.id, { input, mesh, bounds: box, batch });
    if (!mesh) return;
    this.base.add(mesh);
    if (input.surface === 'sidewalk') this.raised.push(mesh);
    if (input.name) {
      const point = labelPoint(input.polygons);
      if (point) {
        this.anchors.set(`name:${input.id}`, new Vector3(point.x, 0.3, -point.y));
        this.anchorSizes.set(`name:${input.id}`, point.sizeM);
      }
    }
  }

  private baseSurface(input: BaseFeatureInput): Mesh | null {
    if (input.kind === 'utility' || input.kind === 'parcel' || !shapesFor(input.polygons).length) return null;
    const sidewalk = input.surface === 'sidewalk';
    const m = this.m;
    let material = m.publicLand;
    if (input.kind === 'road') material = m.road;
    if (input.kind === 'water') material = m.water;
    if (input.surface === 'court') material = m.court;
    if (sidewalk) material = m.sidewalk;
    const lift: Record<string, number> = { public_land: 0.019, road: 0.021, water: 0.03 };
    const geometry = sidewalk ? prismGeometry(input.polygons, 0, SIDEWALK_M)
      : prismGeometry(input.polygons, lift[input.kind] ?? 0.02, 0.001);
    const mesh = new Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.renderOrder = CONTEXT_FILL_ORDER;
    mesh.userData.layer = input.kind;
    return mesh;
  }

  private removeBaseEntry(id: string, entry: BaseEntry) {
    if (entry.mesh) {
      this.base.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      const raised = this.raised.indexOf(entry.mesh);
      if (raised >= 0) this.raised.splice(raised, 1);
    }
    entry.batch.inputs.delete(id);
    this.baseEntries.delete(id);
    this.anchors.delete(`name:${id}`);
    this.anchorSizes.delete(`name:${id}`);
  }

  private rebuildBaseLines(batch: BaseBatch) {
    for (const object of [batch.parcel, batch.roadKerbs, batch.sidewalkKerbs, batch.lanes, batch.lines, batch.pins]) {
      if (!object) continue;
      object.removeFromParent();
      object.geometry.dispose();
    }
    const parcel: number[] = [], roads: number[] = [], sidewalks: number[] = [], lanes: number[] = [];
    const paths: number[] = [], pins: number[] = [];
    for (const input of batch.inputs.values()) {
      for (const path of input.lines ?? []) paths.push(...ringLines(path, 0.06));
      for (const [x, y] of input.pins ?? []) pins.push(x, 0.06, -y);
      if (input.kind === 'parcel') {
        for (const polygon of input.polygons) parcel.push(...ringLines(polygon[0] ?? [], 0.06));
      } else if (input.kind === 'road') {
        const sidewalk = input.surface === 'sidewalk';
        if (!sidewalk && input.surface === 'court') continue;
        const target = sidewalk ? sidewalks : roads;
        for (const polygon of input.polygons) for (const ring of polygon) {
          target.push(...ringLines(ring, sidewalk ? SIDEWALK_M + 0.005 : 0.05));
        }
        if (!sidewalk) lanes.push(...laneDashes(input.polygons, 0.05));
      }
    }
    batch.parcel = this.baseLines(parcel, this.m.parcel, this.base, 'parcel');
    batch.roadKerbs = this.baseLines(roads, this.m.kerb, this.kerbs);
    batch.sidewalkKerbs = this.baseLines(sidewalks, this.m.kerbEdge, this.kerbs);
    batch.lanes = this.baseLines(lanes, this.m.kerb, this.kerbs);
    batch.lines = this.baseLines(paths, this.m.parcel, this.base);
    batch.pins = null;
    if (pins.length) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(pins, 3));
      batch.pins = new Points(geometry, this.m.basePin);
      batch.pins.raycast = () => {};
      this.base.add(batch.pins);
    }
    if (!batch.inputs.size && ![...this.baseQueue.values()].some((entry) => entry.batch === batch)) {
      this.baseBatches.delete(batch);
    }
  }

  private baseLines(points: number[], material: LineBasicMaterial, parent: Group, layer?: string) {
    if (!points.length) return null;
    const object = lines(points, material);
    object.userData.layer = layer;
    parent.add(object);
    return object;
  }

  /** Queued surfaces frame the camera when they arrive, as queued buildings do. */
  private updateBaseBox() {
    this.baseBox.makeEmpty();
    for (const entry of this.baseEntries.values()) this.baseBox.union(entry.bounds);
    for (const pending of this.baseQueue.values()) this.baseBox.union(pending.bounds);
  }

  private updateBaseDerived(features: BaseFeatureInput[]) {
    this.updateBaseBox();
    this.hasSidewalks = features.some((input) => input.surface === 'sidewalk');
    this.applyRaise();
    const hadRoads = this.hasRoads;
    this.hasRoads = features.some((input) => input.kind === 'road');
    if (hadRoads !== this.hasRoads) this.setLook(this.lookName);
    const lands = features.filter((input) => input.kind === 'public_land');
    const previous = this.lands;
    this.lands = lands.map((input) => ({ id: input.id, polygons: input.polygons }));
    if (previous.length !== lands.length || previous.some((land, index) =>
      land.id !== lands[index]?.id || land.polygons !== lands[index]?.polygons)) {
      this.dressingDirty = true;
    }
    this.buildDressing();
    this.applyLayers();
    this.utilityInputs = features.filter((input) => input.kind === 'utility');
    this.buildUtilities();
  }

  /** Whole-list truth: retain unchanged meshes, remove missing ids, rebuild changed ids, queue new ids. */
  setBuildings(inputs: FootprintInput[], { growNew = false } = {}): void {
    if (this.disposed) return;
    const wanted = new Map(inputs.map((input) => [input.id, input]));
    const stale = [...this.buildingInputs.keys()].filter((id) => !wanted.has(id));
    this.updateArrivalBounds(wanted);
    const queue = new Map<string, { input: FootprintInput; growNew: boolean }>();
    const changed: FootprintInput[] = [];
    for (const input of wanted.values()) {
      const previous = this.buildingInputs.get(input.id);
      if (!previous) {
        queue.set(input.id, { input, growNew: this.buildingQueue.get(input.id)?.growNew ?? growNew });
      } else if (!sameInput(previous, input)) {
        changed.push(input);
      }
    }
    const removed = stale.length + changed.length > 0;
    this.removeBuildings([...stale, ...changed.map((input) => input.id)]);
    for (const input of changed) this.addBuilding(input);
    this.buildingQueue = queue;
    if (removed) {
      this.flushBuildingPads();
      this.areaBox.makeEmpty();
      for (const box of this.buildingBounds.values()) this.areaBox.union(box);
      this.fitGroundAndShadow();
      this.apply();
    }
    if (queue.size) this.notifyDrain = true;
    if (queue.size || removed || this.notifyDrain) this.requestRender();
  }

  /** Studio owns the import lifecycle; an interaction or selection stops following until the next import. */
  setImportStreaming(active: boolean): void {
    if (active === this.importStreaming) return;
    this.importStreaming = active;
    if (active) this.officerMoved = false;
    this.followImport = active && this.state.mode === 'area' && !this.state.buildingId;
    this.followArrivedContent();
  }

  /**
   * The package the map was opened on and the ids of its own features. The area view frames those features once
   * drawn, not the whole area; a new package moves the view to itself, unless the officer moved the camera since
   * the running import began.
   */
  setImportFocus(key: string | null, ids: ReadonlySet<string>): void {
    this.importIds = ids;
    this.importBox = null;
    if (key !== this.importKey) {
      this.importKey = key;
      this.followImport = Boolean(key) && !this.officerMoved && this.state.mode === 'area' && !this.state.buildingId;
      if (this.followImport) this.framedBox = null;
    }
    this.followArrivedContent();
  }

  private updateArrivalBounds(wanted: Map<string, FootprintInput>) {
    let contracted = false;
    for (const id of this.arrivalBounds.keys()) {
      if (wanted.has(id)) continue;
      this.arrivalBounds.delete(id);
      contracted = true;
    }
    for (const input of wanted.values()) {
      const previous = this.buildingInputs.get(input.id) ?? this.buildingQueue.get(input.id)?.input;
      if (previous && sameInput(previous, input)) continue;
      const bounds = boundsOf([input]);
      if (!bounds) continue;
      const box = new Box3(
        new Vector3(bounds.minX, input.baseM ?? 0, -bounds.maxY),
        new Vector3(bounds.maxX, (input.baseM ?? 0) + (input.heightM ?? 0), -bounds.minY),
      );
      contracted ||= this.arrivalBounds.has(input.id);
      this.arrivalBounds.set(input.id, box);
      this.arrivedBox.union(box);
    }
    if (contracted) {
      this.arrivedBox.makeEmpty();
      for (const box of this.arrivalBounds.values()) this.arrivedBox.union(box);
    }
    this.importBox = null;
  }

  private stopFollowingImport() {
    this.followImport = false;
  }

  /** A pointer or wheel on the map: the officer's own camera is kept for the rest of this import. */
  private officerMovesCamera() {
    this.officerMoved = true;
    this.areaCameraMoved = true;
    this.stopFollowingImport();
  }

  /** The readable part of the shown package's drawn features; null before any of them is drawn. */
  private importFrame(): Box3 | null {
    if (this.importIds.size && !this.importBox) {
      const boxes = [...this.importIds].flatMap((id) => this.arrivalBounds.get(id) ?? []);
      this.importBox = readablePlanBox(boxes);
    }
    return this.importBox && !this.importBox.isEmpty() ? this.importBox.clone() : null;
  }

  /** What the area view frames: the shown package once drawn, else everything drawn. */
  private areaFrameBox(): Box3 {
    return this.importFrame() ?? this.baseBox.clone().union(this.arrivedBox);
  }

  private followArrivedContent() {
    if (this.state.mode !== 'area' || this.state.buildingId || this.flight) return;
    const own = this.importFrame();
    const box = own ?? this.baseBox.clone().union(this.arrivedBox);
    if (box.isEmpty()) return;
    if (!this.cameraKey) {
      this.applyCamera(true);
      return;
    }
    if (!this.followImport) return;
    if (this.framedBox && containsPlanBox(this.framedBox, box) && (this.framedOwn || !own)) return;
    this.cameraKey = '';
    this.applyCamera(false);
  }

  /** Only ids that have reached a rendered frame; queued inputs have no pick or label. */
  drawnBuildings(): { count: number; pending: number; has: (id: string) => boolean } {
    return {
      count: this.renderedBuildings.size, pending: this.buildingQueue.size + this.baseQueue.size,
      has: (id) => this.renderedBuildings.has(id),
    };
  }

  /** Wait for a part's building AND base ids to reach a frame. Disposal/cancellation returns false. */
  waitForDrawn(buildings: readonly string[], base: readonly string[] = [], signal?: AbortSignal): Promise<boolean> {
    if (this.disposed || signal?.aborted) return Promise.resolve(false);
    if (this.partIsDrawn(buildings, base)) return Promise.resolve(true);
    return new Promise((resolve) => {
      const cancel = () => waiter.finish(false);
      const waiter = {
        buildings, base,
        finish: (drawn: boolean) => {
          this.drawWaiters.delete(waiter);
          signal?.removeEventListener('abort', cancel);
          resolve(drawn);
        },
      };
      this.drawWaiters.add(waiter);
      signal?.addEventListener('abort', cancel, { once: true });
    });
  }

  private partIsDrawn(buildings: readonly string[], base: readonly string[]): boolean {
    return buildings.every((id) => this.renderedBuildings.has(id) && !this.renderChanges.has(id))
      && !this.baseQueue.size && !this.baseNeedsDraw && base.every((id) => this.renderedBase.has(id));
  }

  private finishDraw() {
    for (const [id, added] of this.renderChanges) {
      if (added) this.renderedBuildings.add(id);
      else this.renderedBuildings.delete(id);
    }
    this.renderChanges.clear();
    if (this.baseNeedsDraw) {
      this.renderedBase = new Set(this.baseEntries.keys());
      this.baseNeedsDraw = false;
    }
    for (const waiter of this.drawWaiters) {
      if (this.partIsDrawn(waiter.buildings, waiter.base)) waiter.finish(true);
    }
    if (!this.buildingQueue.size && !this.baseQueue.size && this.notifyDrain) {
      this.notifyDrain = false;
      this.options.onBuildingsDrawn?.();
    }
  }

  /** Levels and spaces of the building being explored; null clears them. */
  setBuildingDetail(detail: BuildingDetailInput | null): void {
    const pending = detail && this.buildingQueue.get(detail.buildingId);
    if (pending) {
      this.buildingQueue.delete(pending.input.id);
      this.addBuilding(pending.input, pending.growNew);
      this.flushBuildingPads();
      this.fitGroundAndShadow();
    }
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
    if (next.mode !== 'area' || next.buildingId) this.stopFollowingImport();
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

  private buildingHasDrawn(id: string): boolean {
    return !this.buildingQueue.has(id) && (!this.buildingInputs.has(id)
      || this.renderedBuildings.has(id) && !this.renderChanges.has(id));
  }

  /** Screen position (CSS px within the container) of a record's top centre or a named anchor, for labels. */
  project(id: string): { x: number; y: number; visible: boolean } | null {
    let point: Vector3 | undefined;
    const entry = this.entries.get(id);
    if (!this.buildingHasDrawn(entry?.buildingId ?? id)) return null;
    // A space anchors on its own box; it is shown only while its level is drawn.
    const hidden = entry?.kind === 'space' && !entry.meshes[0]!.visible;
    const box = entry?.kind === 'space' ? entry.bounds : this.buildingBounds.get(id);
    if (box) point = new Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
    else point = this.anchors.get(id)?.clone();
    if (!point) return null;
    const { clientWidth: fullW, clientHeight: h } = this.container;
    const split = this.state.mode === 'deviation';
    const w = split ? Math.floor(fullW / 2) : fullW;
    if (split) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    point.project(this.camera);
    if (split) { this.camera.aspect = fullW / h; this.camera.updateProjectionMatrix(); }
    const visible = !hidden && point.z > -1 && point.z < 1 && Math.abs(point.x) < 1.1 && Math.abs(point.y) < 1.1;
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
    this.buildingQueue.clear();
    this.baseQueue.clear();
    for (const waiter of this.drawWaiters) waiter.finish(false);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.removeEventListener('wheel', this.onWheel, { capture: true });
    for (const tiles of this.tilesets) tiles.dispose();
    this.setOverlays([]);
    this.setSurfaceParts([]);
    this.setPreviewOutlines([]);
    if (this.areaOutline) this.setAreaExtent(null);
    this.scene.traverse((object) => (object as Mesh).geometry?.dispose?.());
    for (const entry of this.entries.values()) {
      for (const object of [...entry.meshes, ...entry.edges]) object.geometry.dispose();
    }
    for (const material of [...Object.values(this.m), ...this.spaceMaterials.values()] as Material[]) {
      (material as MeshBasicMaterial).map?.dispose();
      material.dispose();
    }
    this.controls.dispose();
    this.renderer.dispose();
    canvas.remove();
  }

  // ---------------------------------------------------------------- builders

  private addBuilding(input: FootprintInput, growNew = false): Entry[] {
    this.footprintPolygons.set(input.id, input.polygons);
    const grow = growNew ? performance.now() : undefined;
    const entries = input.storeys?.length
      ? this.addStoreyBuilding(input, grow)
      : [this.addFootprintBuilding(input, grow)];
    this.buildingEntries.set(input.id, entries);
    this.buildingInputs.set(input.id, input);
    this.renderChanges.set(input.id, true);
    const bounds = this.buildingBounds.get(input.id);
    if (bounds) this.areaBox.union(bounds);
    this.pendingPads.set(input.id, input.polygons);
    this.dressingDirty = true;
    return entries;
  }

  /**
   * Removes buildings in one pass: their objects leave the group together and each pad batch they
   * touched is rebuilt once from the inputs it still holds, or dropped when empty.
   */
  private removeBuildings(ids: readonly string[]) {
    const objects = new Set<Object3D>();
    const touched = new Set<Mesh>();
    const batched = new Map<BuildingBatch, string[]>();
    for (const id of ids) {
      for (const entry of this.buildingEntries.get(id) ?? []) {
        for (const object of [...entry.meshes, ...entry.edges]) {
          objects.add(object);
          object.geometry.dispose();
        }
        if (entry.batch) {
          const members = batched.get(entry.batch) ?? [];
          members.push(entry.id);
          batched.set(entry.batch, members);
        }
        this.entries.delete(entry.id);
      }
      this.pendingPads.delete(id);
      const pad = this.pads.get(id);
      if (pad) {
        this.padBatches.get(pad)!.delete(id);
        this.pads.delete(id);
        touched.add(pad);
      }
      this.buildingEntries.delete(id);
      this.buildingInputs.delete(id);
      this.buildingBounds.delete(id);
      this.storeyBuildings.delete(id);
      this.footprintPolygons.delete(id);
      this.renderChanges.set(id, false);
      if (this.plateFor === id) this.plateFor = null;
      this.dressingDirty = true;
    }
    for (const [batch, members] of batched) {
      batch.remove(members);
      if (batch.size) continue;
      objects.add(batch.mesh).add(batch.lines);
      batch.dispose();
      for (const batches of this.batches.values()) batches.delete(batch);
    }
    removeChildren(this.buildings, objects);
    for (const pad of touched) this.rebuildPad(pad);
  }

  /**
   * Resting footprint buildings draw from batches of their rest look. One whose own mesh would draw unlike its batch
   * (selected, hovered, see-through near an explored building) draws as that mesh over its collapsed place.
   */
  private placeBuildings(entries: readonly Entry[]) {
    const touched = new Set<BuildingBatch>();
    for (const entry of entries) {
      if (entry.kind !== 'building' || entry.grow !== undefined) continue;
      entry.batch ??= this.joinBatch(entry);
      touched.add(entry.batch);
    }
    const leaving = new Set<Object3D>();
    for (const batch of touched) {
      const { batched, own } = batch.match();
      for (const object of batched) if (object.parent) leaving.add(object);
      for (const object of own) if (!object.parent) this.buildings.add(object);
    }
    removeChildren(this.buildings, leaving);
    // Picks keep testing the own meshes: their world matrix is the group's, without a grow-in scale.
    for (const object of leaving) object.updateMatrixWorld();
  }

  private joinBatch(entry: Entry): BuildingBatch {
    const material = this.restMaterial(entry);
    const key = `${material.uuid}:${entry.known}`;
    const batches = this.batches.get(key) ?? new Set<BuildingBatch>();
    this.batches.set(key, batches);
    let batch = [...batches].find((open) => open.size < BATCH_SIZE);
    if (!batch) {
      batch = new BuildingBatch(material, this.m.edge);
      batches.add(batch);
      this.buildings.add(batch.mesh, batch.lines);
    }
    batch.add(entry.id, entry.meshes[0]!, entry.edges[0]!);
    return batch;
  }

  private flushBuildingPads() {
    if (!this.pendingPads.size) return;
    const inputs = new Map(this.pendingPads);
    this.pendingPads.clear();
    const geometry = padGeometry([...inputs.values()], 2.2, 0.004);
    if (!geometry) return;
    const pad = new Mesh(geometry, this.m.pad);
    pad.renderOrder = CONTEXT_FILL_ORDER;
    pad.receiveShadow = true;
    pad.raycast = () => {};
    this.padBatches.set(pad, inputs);
    for (const id of inputs.keys()) this.pads.set(id, pad);
    this.dressing.add(pad);
  }

  private rebuildPad(pad: Mesh) {
    const inputs = this.padBatches.get(pad)!;
    pad.geometry.dispose();
    const replacement = inputs.size ? padGeometry([...inputs.values()], 2.2, 0.004) : null;
    if (replacement) pad.geometry = replacement;
    else {
      // Inputs whose footprints draw no pad may remain; they no longer point at the dropped mesh.
      for (const id of inputs.keys()) this.pads.delete(id);
      this.dressing.remove(pad);
      this.padBatches.delete(pad);
    }
  }

  private drainBuildingQueue() {
    if (!this.programWarmUp.settled) return;
    const started = performance.now();
    const added: Entry[] = [];
    while (this.buildingQueue.size) {
      const [id, pending] = this.buildingQueue.entries().next().value!;
      this.buildingQueue.delete(id);
      added.push(...this.addBuilding(pending.input, pending.growNew));
      if (performance.now() - started >= BUILDING_BUDGET_MS) break;
    }
    if (added.length) {
      this.flushBuildingPads();
      this.fitGroundAndShadow();
      const selectedArrived = added.some((entry) => entry.buildingId === this.state.buildingId);
      if (selectedArrived) this.apply();
      else this.apply(added);
      if (selectedArrived) this.applyCamera(false);
    }
    if (!this.buildingQueue.size || performance.now() - this.dressingAt >= DRESSING_INTERVAL_MS) {
      this.buildDressing();
    }
  }

  private addFootprintBuilding(input: FootprintInput, grow?: number): Entry {
    const known = hasKnownHeight(input);
    const look = buildingLook(input);
    const geometry = prismGeometry(input.polygons, input.baseM ?? 0, known ? input.heightM! : FLAT_THICKNESS_M);
    if (look === 'hatch') applyPlanarUV(geometry);
    const themed = Boolean(input.color) && known;
    const style = facadeStyle(input.id, known ? input.heightM : null);
    paintGeometry(geometry, themed ? new Color(input.color) : style.color, style.seed);
    const entry: Entry = { kind: 'building', id: input.id, buildingId: input.id, meshes: [], edges: [], known, bounds: geometry.boundingBox!.clone(), grow, themed, look };
    const mesh = new Mesh(geometry, this.restMaterial(entry));
    mesh.castShadow = known && look !== 'candidate';
    mesh.receiveShadow = true;
    const edge = new LineSegments(edgeGeometry(geometry, input), this.m.edge);
    edge.raycast = () => {};
    entry.meshes.push(mesh);
    entry.edges.push(edge);
    mesh.userData.entry = entry;
    this.buildings.add(mesh, edge);
    this.entries.set(input.id, entry);
    this.buildingBounds.set(input.id, entry.bounds.clone());
    return entry;
  }

  private addStoreyBuilding(input: FootprintInput, grow?: number): Entry[] {
    const added: Entry[] = [];
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
      const style = facadeStyle(input.id, input.heightM);
      for (const geometry of parts) {
        if (storey.estimated) applyPlanarUV(geometry);
        paintGeometry(geometry, style.color, style.seed);
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
      entry.grow = grow;
      added.push(entry);
      this.entries.set(id, entry);
      if (!storey.belowGround) above.union(bounds);
    }
    if (!above.isEmpty()) this.buildingBounds.set(input.id, above);
    return added;
  }

  /** Sidewalk pads around every footprint and trees in public land (enhanced view only). */
  private buildDressing() {
    if (!this.dressingDirty) return;
    this.dressingDirty = false;
    this.dressingAt = performance.now();
    const footprints = [...this.footprintPolygons.values()];
    disposeGroup(this.trees);
    for (const tree of treeMeshes(this.lands, footprints, this.m.crown, this.m.trunk)) {
      tree.userData.layer = 'trees';
      this.trees.add(tree);
    }
    this.trees.visible = this.layers.trees && this.layers.publicLand;
  }

  /** Whether the area has any trees to show (public land large enough). */
  hasTrees(): boolean {
    return this.trees.children.length > 0;
  }

  private buildUtilities() {
    const wanted = new Map(this.utilityInputs.map((input) => [input.id, input]));
    for (const [id, entry] of this.utilityMeshes) {
      const input = wanted.get(id);
      if (input && sameInput(entry.input, input)) continue;
      entry.mesh.removeFromParent();
      entry.mesh.geometry.dispose();
      (entry.mesh.material as Material).dispose();
      this.utilityMeshes.delete(id);
      this.anchors.delete(`utility:${id}`);
    }
    for (const input of wanted.values()) {
      if (!this.utilityMeshes.has(input.id)) this.addUtility(input);
    }
  }

  private addUtility(input: BaseFeatureInput) {
    if (input.lowerM === undefined || input.upperM === undefined) return;
    const color = this.options.palette.utilities[input.network ?? ''] ?? this.options.palette.utilities.water!;
    const corridor = input.upperM - input.lowerM > 1;
    const material = corridor
      ? new MeshStandardMaterial({ color, transparent: true, opacity: 0.42, depthWrite: false, roughness: 0.6 })
      : new MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.1 });
    const mesh = new Mesh(prismGeometry(input.polygons, input.lowerM, input.upperM - input.lowerM), material);
    mesh.castShadow = !corridor;
    this.utilities.add(mesh);
    this.utilityMeshes.set(input.id, { input, mesh });
    const box = mesh.geometry.boundingBox!;
    this.anchors.set(`utility:${input.id}`, new Vector3(box.max.x * 0.4, input.upperM, (box.min.z + box.max.z) / 2));
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
  private apply(entries: Iterable<Entry> = this.entries.values()) {
    const { mode, buildingId, levelId, spaceId, finding } = this.state;
    const m = this.m;
    const selectedSomething = Boolean(buildingId) || mode !== 'area';
    const exploring = mode === 'level' && this.detailInput?.buildingId === buildingId;
    const levelOrder = new Map(this.detailInput?.levels.map((l) => [l.id, l.order]) ?? []);
    const activeOrder = levelId ? levelOrder.get(levelId) : undefined;
    const activeStorey = buildingId && levelId ? this.entries.get(`${buildingId}::${levelId}`)?.storey : undefined;
    const activeBelow = Boolean(activeStorey?.belowGround);
    const participants = new Set(finding?.participants ?? []);
    // Exploring one building in a dense block: neighbours close enough to hide it turn see-through.
    const focus = (mode === 'building' || mode === 'level') && buildingId ? this.buildingBounds.get(buildingId)?.clone().expandByVector(new Vector3(45, 0, 45)) : undefined;
    const hides = (id: string | undefined) => {
      if (!focus || !id || id === buildingId) return false;
      const b = this.buildingBounds.get(id);
      return Boolean(b && b.min.x < focus.max.x && b.max.x > focus.min.x && b.min.z < focus.max.z && b.max.z > focus.min.z);
    };

    const buildings: Entry[] = [];
    for (const entry of entries) {
      if (entry.kind === 'building') {
        buildings.push(entry);
        const selected = entry.id === buildingId;
        if (hides(entry.id)) { this.setEntry(entry, m.occluder, m.occluderEdge, true, false); continue; }
        let material: Material = this.restMaterial(entry);
        let edge: Material = m.edge;
        if (mode === 'findings') { material = selected ? m.ghost : m.bldgContext; edge = selected ? m.inkEdge : m.edgeContext; }
        else if (mode === 'underground') { material = selected ? m.ghost : m.faint; edge = selected ? m.inkEdge : m.ghostEdge; if (!selected) { this.setEntry(entry, material, edge, false, false); continue; } }
        else if (selected && exploring) { material = m.ghost; edge = m.ghostEdge; }
        else if (selected) { material = entry.look === 'candidate' ? m.ghostDark : m.selected; edge = m.haloEdge; }
        else if (selectedSomething) { material = this.contextMaterial(entry); edge = m.edgeContext; }
        // Hover (area and building views): a lighter facade and a dark outline, never on the selection.
        if (!selected && entry.id === this.hovered && (mode === 'area' || mode === 'building')) {
          if (entry.look === 'candidate') edge = m.inkEdge;
          else if (entry.known && !entry.themed && entry.look !== 'hatch') { material = m.hover; edge = m.inkEdge; }
        }
        this.setEntry(entry, material, edge, true, entry.known && entry.look !== 'candidate' && material !== m.ghost && material !== m.faint);
      } else if (entry.kind === 'storey') {
        const selected = entry.buildingId === buildingId;
        if (hides(entry.buildingId)) { this.setEntry(entry, m.occluder, m.occluderEdge, !entry.storey!.belowGround, false); continue; }
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
    this.placeBuildings(buildings);

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
    // Pads and trees stand on the ground surface; below ground they would float.
    this.dressing.visible = this.look.uLook.value === 1 && mode !== 'underground';
    if (mode !== 'underground' && this.trenchPoints.length) this.clearTrench();
    this.underground.visible = mode === 'underground';
    this.buildSection(mode === 'underground' ? buildingId : null);
    this.buildFinding(mode === 'findings' ? finding : null);
    this.findingGroup.visible = mode === 'findings';
    this.buildDeviation(mode === 'deviation' ? this.state.deviation : null);

    // Findings use Volumes light: flat, even, no shadows.
    const volumes = mode === 'findings';
    this.sun.castShadow = !volumes;
    this.hemi.intensity = volumes ? 2 : FILL_INTENSITY;
    this.sun.intensity = volumes ? 0.7 : 1.6;
    if (volumes) this.hemi.groundColor.set(this.lookName === 'enhanced' ? '#d6cfbf' : '#cfd6d4');
    else this.hemi.groundColor.set(this.options.palette.ink);

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

  /** A building's material at rest: thematic colour, candidate ghost, hatch (unknown or estimated height), else solid. */
  private restMaterial(entry: Entry): Material {
    if (entry.themed) return this.m.themed;
    if (entry.look === 'candidate') return this.m.ghostDark;
    if (entry.look !== 'hatch') return this.m.bldg;
    return entry.known ? this.m.estimated : this.m.unknown;
  }

  /** The same, once something else is selected: neighbours fade back. */
  private contextMaterial(entry: Entry): Material {
    if (entry.themed) return this.m.themed;
    if (entry.look === 'candidate') return this.m.ghost;
    return entry.known ? this.m.bldgContext : this.m.unknownContext;
  }

  private setEntry(entry: Entry, material: Material, edge: Material, visible: boolean, shadow: boolean) {
    for (const mesh of entry.meshes) { mesh.material = material; mesh.visible = visible; mesh.castShadow = shadow; }
    for (const line of entry.edges) { line.material = edge; line.visible = visible; }
  }

  private updateHalo(mode: SceneMode, buildingId: string | null, spaceId: string | null) {
    this.halo.visible = false;
    this.updatePlate((mode === 'area' || mode === 'building') ? buildingId : null);
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

  /** Enhanced view: a tinted ground plate under the selected building. */
  private plateFor: string | null = null;
  private updatePlate(buildingId: string | null) {
    const polygons = buildingId ? this.footprintPolygons.get(buildingId) : undefined;
    this.plate.visible = Boolean(polygons) && this.lookName === 'enhanced';
    if (!polygons || this.plateFor === buildingId) return;
    this.plateFor = buildingId;
    const geometry = padGeometry([polygons], 1.6, 0.03);
    this.plate.geometry.dispose();
    this.plate.geometry = geometry ?? new BufferGeometry();
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
    for (const material of [this.m.bldg, this.m.hover, this.m.themed, this.m.selected, this.m.estimated, this.m.ghost, ...this.spaceMaterials.values()]) {
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
    const key = cameraKeyOf(this.state);
    // Area mode: a selected building the viewer cannot make out (too small or out of view) is brought into
    // view with its surroundings; a readable one leaves the camera alone, and so does clearing the selection.
    if (mode === 'area' && this.cameraKey) {
      const selectedKey = `area|selected:${buildingId ?? ''}`;
      const box = buildingId ? this.buildingBounds.get(buildingId) : undefined;
      if (buildingId && box) {
        if (selectedKey === this.cameraKey) return;
        this.cameraKey = selectedKey;
        if (!this.readableInView(box)) this.flyToNeighbourhood(box, instant);
        return;
      }
      if (this.cameraKey.startsWith('area|selected:')) { this.cameraKey = key; return; }
    }
    if (key === this.cameraKey) return;
    const target = this.cameraTarget(mode, buildingId, levelId, finding);
    if (!target) return;
    this.cameraKey = key;
    if (mode === 'area') {
      this.framedOwn = Boolean(this.importFrame());
      this.framedBox = this.areaFrameBox();
    }
    this.frameTarget(mode, target, instant);
  }

  /** Flies to (or jumps to) the mode's pose for a target; the area view keeps its whole framed box in view. */
  private frameTarget(mode: SceneMode, target: CameraTarget, instant: boolean) {
    // Fit to the narrower of the vertical and horizontal fields of view, so a narrow canvas still shows the whole target.
    const aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight);
    const hFov = (2 * Math.atan(Math.tan((this.camera.fov * Math.PI) / 360) * aspect) * 180) / Math.PI;
    const pose = presetFor(mode, target.bounds, target.focusY, target.extentY, Math.min(this.camera.fov, hFov));
    const to: [Vector3, Vector3] = [new Vector3(...pose.position), new Vector3(...pose.target)];
    if (this.flat) {
      // Top-down, north up, at the same distance.
      const distance = to[0].distanceTo(to[1]);
      to[0].set(to[1].x, to[1].y + distance, to[1].z + distance * 1e-4);
    }
    if (mode === 'area' && this.framedBox) this.fitAreaPose(to, this.framedBox);
    const animated = !(instant || this.options.reducedMotion);
    const clip = this.clipForPose(to, target.bounds, target.extentY, animated);
    if (!animated) {
      this.camera.position.copy(to[0]);
      this.controls.target.copy(to[1]);
      this.controls.update();
      this.requestRender();
      return;
    }
    const from: [Vector3, Vector3] = [this.camera.position.clone(), this.controls.target.clone()];
    this.flight = { from, to, start: performance.now(), clip };
    this.requestRender();
  }

  /**
   * Sets the depth range and the farthest zoom-out for a framed pose: far holds the farthest point of the framed box
   * with margin and near follows at the camera's own ratio; small frames keep the defaults. A flight keeps the wider
   * of the old and new range until it lands, and returns the range to settle on.
   */
  private clipForPose(to: [Vector3, Vector3], bounds: Bounds2D, extentY: number, animated: boolean) {
    const reach = to[0].distanceTo(to[1]) + Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, extentY);
    const far = Math.max(CAMERA_FAR, reach * FAR_MARGIN);
    const large = far > CAMERA_FAR;
    const frame = new Box3().setFromCenterAndSize(
      new Vector3(to[1].x, 0, to[1].z), new Vector3(reach * 2, 0, reach * 2),
    );
    const range: ClipRange = {
      near: far * (CAMERA_NEAR / CAMERA_FAR), far, maxDistance: large ? reach : Infinity,
      reach, frame,
    };
    if (!animated) { this.applyClip(range); return undefined; }
    this.applyClip({
      near: Math.min(range.near, this.camera.near), far: Math.max(range.far, this.camera.far),
      maxDistance: Math.max(range.maxDistance, this.controls.maxDistance),
      reach: Math.max(range.reach, this.framedReach), frame: this.frame.clone().union(frame),
    });
    return range;
  }

  private applyClip(range: ClipRange) {
    this.camera.near = range.near;
    this.camera.far = range.far;
    this.controls.maxDistance = range.maxDistance;
    this.camera.updateProjectionMatrix();
    this.framedReach = range.reach;
    this.frame.copy(range.frame);
    this.fitFog();
    this.fitGround();
  }

  private fitAreaPose(to: [Vector3, Vector3], box: Box3) {
    const direction = to[0].clone().sub(to[1]).normalize();
    const right = new Vector3().crossVectors(this.camera.up, direction).normalize();
    const up = new Vector3().crossVectors(direction, right);
    const vertical = Math.tan(this.camera.fov * Math.PI / 360) * 0.9;
    const horizontal = vertical * this.container.clientWidth / Math.max(1, this.container.clientHeight);
    let distance = to[0].distanceTo(to[1]);
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const offset = new Vector3(x, y, z).sub(to[1]);
        const depth = offset.dot(direction);
        distance = Math.max(distance, depth + Math.abs(offset.dot(right)) / horizontal,
          depth + Math.abs(offset.dot(up)) / vertical);
      }
    }
    to[0].copy(to[1]).addScaledVector(direction, distance);
  }

  /** Whether a box is fully on screen and at least 60 px tall, so it can be made out. */
  private readableInView(box: Box3): boolean {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const p = new Vector3(x, y, z).project(this.camera);
      if (p.z > 1) return false;
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const heightPx = ((maxY - minY) / 2) * this.container.clientHeight;
    return minX > -0.95 && maxX < 0.95 && minY > -0.95 && maxY < 0.9 && heightPx >= 60;
  }

  /** The building and about 110 m around it, from the area view’s direction. */
  private flyToNeighbourhood(box: Box3, instant: boolean, minPad = 110) {
    const pad = Math.max(minPad, (box.max.y - box.min.y) * 1.2);
    const bounds: Bounds2D = { minX: box.min.x - pad, maxX: box.max.x + pad, minY: -box.max.z - pad, maxY: -box.min.z + pad };
    const aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight);
    const hFov = (2 * Math.atan(Math.tan((this.camera.fov * Math.PI) / 360) * aspect) * 180) / Math.PI;
    const pose = presetFor('area', bounds, (box.max.y - box.min.y) / 3, box.max.y - box.min.y, Math.min(this.camera.fov, hFov));
    const to: [Vector3, Vector3] = [new Vector3(...pose.position), new Vector3(...pose.target)];
    if (this.flat) { const d = to[0].distanceTo(to[1]); to[0].set(to[1].x, to[1].y + d, to[1].z + d * 1e-4); }
    const animated = !(instant || this.options.reducedMotion);
    const clip = this.clipForPose(to, bounds, box.max.y - box.min.y, animated);
    if (!animated) {
      this.camera.position.copy(to[0]); this.controls.target.copy(to[1]); this.controls.update(); this.requestRender();
      return;
    }
    const from: [Vector3, Vector3] = [this.camera.position.clone(), this.controls.target.clone()];
    this.flight = { from, to, start: performance.now(), clip };
    this.requestRender();
  }

  private cameraTarget(mode: SceneMode, buildingId: string | null, levelId: string | null, finding: FindingInput | null | undefined) {
    const box = new Box3();
    let focusY: number;
    if (mode === 'area') {
      box.copy(this.areaFrameBox());
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
      if (!this.buildingHasDrawn(entry.buildingId)) continue;
      // Ghosted levels are see-through to picks; a candidate building is a ghost that must stay selectable.
      const seeThrough = (mesh: Mesh) => entry.look !== 'candidate' && (mesh.material === m.ghost || mesh.material === m.faint || mesh.material === m.ghostDark);
      for (const mesh of entry.meshes) if (mesh.visible && !seeThrough(mesh)) targets.push(mesh);
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
    // A draw before the warm-up settles would compile and link its programs synchronously in this frame; until then
    // the canvas shows its ground clear colour.
    if (!this.programWarmUp.settled) {
      this.requestRender();
      return;
    }
    const started = performance.now();
    this.drainBuildingQueue();
    this.drainBaseQueue();
    this.drainSurfaceQueue();
    let animating = false;
    if (this.flight) animating = this.stepFlight(performance.now());
    this.followArrivedContent();
    const growing = this.stepGrow(now);
    animating = Boolean(this.flight) || growing || animating;
    for (const tiles of this.tilesets) tiles.update();
    this.followSun();
    this.areaOutline.visible = this.buildingInputs.size === 0;
    if (this.state.mode === 'deviation') this.renderSplit();
    else this.renderer.render(this.scene, this.camera);
    this.recordFrameTime(performance.now() - started);
    this.finishDraw();
    this.options.onView?.();
    if (animating || this.buildingQueue.size || this.baseQueue.size || this.surfaceQueue.size
      || [...this.tilesets].some((tiles) => tiles.loadProgress < 1)) {
      this.requestRender();
    }
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
    const grown: Entry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.grow === undefined) continue;
      const t = Math.min(1, (now - entry.grow) / GROW_MS);
      const k = this.options.reducedMotion ? 1 : 1 - Math.pow(1 - t, 3);
      for (const o of [...entry.meshes, ...entry.edges]) o.scale.y = Math.max(0.001, k);
      if (t >= 1) {
        delete entry.grow;
        grown.push(entry);
      } else active = true;
    }
    if (grown.length) this.placeBuildings(grown);
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
      if (flight.clip) this.applyClip(flight.clip);
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

  /** Keeps the shadow frustum around what is in view, so shadows stay sharp close up and cover the area far out. */
  private followSun() {
    const box = this.areaBox;
    if (box.isEmpty()) return;
    const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 60);
    const distance = this.camera.position.distanceTo(this.controls.target);
    const half = Math.min(Math.max(distance * 0.85, 40), span * 0.75, SHADOW_HALF_MAX);
    const texel = (half * 2) / this.sun.shadow.mapSize.x;
    const t = this.controls.target;
    const cx = Math.round(t.x / texel) * texel, cz = Math.round(t.z / texel) * texel;
    const reach = half * 3 + (box.max.y || 0);
    this.sun.position.set(cx + SUN_DIR.x * reach, SUN_DIR.y * reach, cz + SUN_DIR.z * reach);
    this.sun.target.position.set(cx, 0, cz);
    this.sun.target.updateMatrixWorld();
    const cam = this.sun.shadow.camera;
    if (cam.right !== half) {
      cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
      cam.near = 1; cam.far = reach * 2.2;
      cam.updateProjectionMatrix();
    }
  }

  /**
   * Fog clears every framed area (including small frames) by 10% of its reach.
   * The ground extends through the haze, and horizon, clear and fog colours agree.
   */
  private fitFog() {
    const box = this.areaBox;
    const span = box.isEmpty() ? 0 : Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 60);
    const fog = this.scene.fog as Fog;
    fog.near = Math.max(span ? span * 1.4 : 260, this.framedReach * 1.1);
    fog.far = Math.max(fog.near * 1.1,
      Math.min(Math.max(span ? span * 3.4 : 620, this.framedReach * FOG_DEPTH), this.camera.far));
  }

  /** The ground covers ten times the buildings' span, and the framed area out to the fog's far distance. */
  private fitGround() {
    const area = new Box3();
    const box = this.areaBox;
    if (!box.isEmpty()) {
      const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 60);
      area.setFromCenterAndSize(box.getCenter(new Vector3()).setY(0), new Vector3(span * 10, 0, span * 10));
    }
    if (!this.frame.isEmpty()) area.union(this.frame.clone().expandByScalar((this.scene.fog as Fog).far));
    if (area.isEmpty()) return;
    const centre = area.getCenter(new Vector3());
    this.ground.position.set(centre.x, -0.01, centre.z);
    this.ground.scale.set(area.max.x - area.min.x, area.max.z - area.min.z, 1);
  }

  private fitGroundAndShadow() {
    const box = this.areaBox;
    if (box.isEmpty()) return;
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 60);
    this.fitFog();
    this.fitGround();
    const half = Math.min(span * 0.75, SHADOW_HALF_MAX);
    const d = half * 1.6;
    this.sun.position.set(cx + SUN_DIR.x * d, SUN_DIR.y * d, cz + SUN_DIR.z * d);
    this.sun.target.position.set(cx, 0, cz);
    const cam = this.sun.shadow.camera;
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
    cam.near = 1; cam.far = d * 4;
    cam.updateProjectionMatrix();
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    this.officerMovesCamera();
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
    this.apply();
    this.options.onHover?.(pick);
  };

  /**
   * Trackpad two-finger swipe rotates (left/right turns, up/down tilts). A mouse wheel and a pinch
   * (reported with Ctrl) fall through to the controls and zoom.
   */
  private readonly onWheel = (event: WheelEvent) => {
    this.officerMovesCamera();
    this.flight = null;
    if (event.ctrlKey || !this.controls.enabled) return;
    const mouseWheel = event.deltaMode !== 0 || (event.deltaX === 0 && Math.abs(event.deltaY) >= 40 && Number.isInteger(event.deltaY));
    if (mouseWheel) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.flight = null;
    this.rotateBy(-event.deltaX * 0.006, -event.deltaY * 0.004);
  };

  /** Orbits the camera around the target by angles (radians), within the controls' tilt limits. */
  private rotateBy(dTheta: number, dPhi: number) {
    const target = this.controls.target;
    const offset = new Vector3().subVectors(this.camera.position, target);
    const spherical = new Spherical().setFromVector3(offset);
    spherical.theta += dTheta;
    spherical.phi = Math.min(Math.max(spherical.phi + dPhi, Math.max(1e-4, this.controls.minPolarAngle)), Math.max(1e-4, this.controls.maxPolarAngle));
    offset.setFromSpherical(spherical);
    this.camera.position.copy(target).add(offset);
    this.camera.lookAt(target);
    this.controls.update();
    this.requestRender();
  }

  private readonly onPointerLeave = () => {
    if (!this.hovered) return;
    this.hovered = null;
    this.apply();
    this.options.onHover?.({ kind: 'ground' });
  };
}

/** Plan bounds of base geometry; utility envelopes stay underground, but their paths and pins are flat. */
function baseBounds(input: BaseFeatureInput): Box3 {
  const bounds = boundsOf([input]);
  const box = new Box3();
  if (bounds && input.kind !== 'utility') box.set(
    new Vector3(bounds.minX, 0, -bounds.maxY), new Vector3(bounds.maxX, 0, -bounds.minY),
  );
  for (const path of input.lines ?? []) {
    for (const [x, y] of path) box.expandByPoint(new Vector3(x, 0, -y));
  }
  for (const [x, y] of input.pins ?? []) box.expandByPoint(new Vector3(x, 0, -y));
  return box;
}

function cameraKeyOf({ mode, buildingId, levelId, finding }: SceneState): string {
  return `${mode}|${mode === 'area' ? '' : buildingId ?? ''}|${mode === 'level' ? levelId ?? '' : ''}`
    + `|${mode === 'findings' ? finding?.id ?? '' : ''}`;
}

function containsPlanBox(outer: Box3, inner: Box3): boolean {
  return outer.min.x <= inner.min.x && outer.max.x >= inner.max.x
    && outer.min.z <= inner.min.z && outer.max.z >= inner.max.z;
}

function sameInput(left: object, right: object): boolean {
  if (left === right) return true;
  const keys = Reflect.ownKeys(left);
  return keys.length === Reflect.ownKeys(right).length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(right, key)
    && Object.is(Reflect.get(left, key), Reflect.get(right, key)));
}

function sameInputs(left: object[], right: object[]): boolean {
  return left.length === right.length && left.every((input, index) => sameInput(input, right[index]!));
}

/** Darken the existing edge towards ink until it clears a conservative lit wall by at least 3:1. */
function contrastingEdge(token: string, ink: string, wall: Color): Color {
  const luminance = (c: Color) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  const edge = new Color(token), dark = new Color(ink);
  const contrast = () => (luminance(wall) + 0.05) / (luminance(edge) + 0.05);
  for (let step = 0; step < 30 && contrast() < 3.2; step++) edge.lerp(dark, 0.2);
  return edge;
}

function makeMaterials(p: ScenePalette, clip: Plane) {
  void clip;
  const contextColor = new Color(p.ground).lerp(new Color(p.building), 0.35);
  const std = (color: string | Color, extra: Partial<MeshStandardMaterial> = {}) => new MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, ...extra });
  // Flat layers are separated by polygon offset, not height alone, so they never shimmer from far away.
  const layer = (color: string, units: number, extra: Partial<MeshStandardMaterial> = {}) => std(color, { polygonOffset: true, polygonOffsetFactor: units, polygonOffsetUnits: units, ...extra });
  return {
    ground: layer(p.ground, 4, { roughness: 0.95 }),
    pad: layer('#e4e3dd', 2, { roughness: 0.95 }),
    road: layer(p.road, 0),
    publicLand: layer(p.publicLand, -1),
    water: layer(p.water, -2, { roughness: 0.4 }),
    kerb: new LineBasicMaterial({ color: '#f7f7f4', transparent: true, opacity: 0.9 }),
    kerbEdge: new LineBasicMaterial({ color: '#b9b8b2' }),
    sidewalk: std(p.road, { roughness: 0.95 }),
    court: layer(p.road, -1),
    plate: new MeshBasicMaterial({ color: p.selected, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    crown: new MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }),
    trunk: new MeshStandardMaterial({ color: '#8a7560', roughness: 1 }),
    parcel: new LineBasicMaterial({ color: p.parcelLine, transparent: true, opacity: 0.7 }),
    basePin: new PointsMaterial({ color: p.parcelLine, size: 5, sizeAttenuation: false }),
    bldg: std(p.building),
    bldgContext: std(contextColor),
    /** Neighbours between the camera and an explored building: see-through, never hiding it. */
    occluder: std(contextColor, { transparent: true, opacity: 0.14, depthWrite: false }),
    occluderEdge: new LineBasicMaterial({ color: p.buildingEdge, transparent: true, opacity: 0.16, depthWrite: false }),
    themed: std('#ffffff'),
    hover: std('#ffffff'),
    unknown: new MeshLambertMaterial({ map: hatchTexture(p.building, p.buildingEdge) }),
    unknownContext: new MeshLambertMaterial({ map: hatchTexture(p.building, p.buildingEdge), transparent: true, opacity: 0.45 }),
    estimated: new MeshLambertMaterial({ map: hatchTexture(p.building, p.buildingEdge) }),
    selected: std(p.selected, { roughness: 0.85 }),
    ghost: new MeshBasicMaterial({ color: p.buildingEdge, transparent: true, opacity: 0.1, depthWrite: false }),
    ghostDark: new MeshBasicMaterial({ color: p.buildingEdge, transparent: true, opacity: 0.18, depthWrite: false }),
    faint: new MeshBasicMaterial({ color: p.building, transparent: true, opacity: 0.25, depthWrite: false }),
    halo: new MeshBasicMaterial({ color: p.halo, side: BackSide }),
    edge: new LineBasicMaterial({ color: p.buildingEdge }),
    edgeContext: new LineBasicMaterial({ color: p.buildingEdge }),
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

/** Surface outlines and points sit just above the ground pictures, under every record. */
const SURFACE_LIFT_M = 0.05;

/** Dash and gap of a preview outline, in metres: a draft edge, never the solid edge of a record. */
const PREVIEW_DASH_M = { dashSize: 2, gapSize: 1.5 };

/** Every ring of the preview outlines as one set of segments, closed where the ring is not, just above the ground. */
function previewLines(outlines: PreviewOutlineInput[], colour: string): LineSegments {
  const positions: number[] = [];
  for (const { polygons } of outlines) {
    for (const ring of polygons.flat()) {
      for (let i = 0; i < ring.length; i++) {
        const [x0, y0] = ring[i]!, [x1, y1] = ring[(i + 1) % ring.length]!;
        if (x0 === x1 && y0 === y1) continue;
        positions.push(x0, SURFACE_LIFT_M, -y0, x1, SURFACE_LIFT_M, -y1);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const lines = new LineSegments(geometry, new LineDashedMaterial({ color: colour, ...PREVIEW_DASH_M }));
  lines.computeLineDistances();
  lines.raycast = () => {};
  lines.userData.preview = true;
  return lines;
}

/** One read surface part: its outline, and its picture as a ground picture or its points laid flat. */
function surfacePartObject(part: SurfacePartInput, outlineColour: string): Group {
  const group = new Group();
  const at = (lift: number) => new Float32BufferAttribute(part.corners.flatMap(([x, y]) => [x, lift, -y]), 3);
  const ring = new BufferGeometry();
  ring.setAttribute('position', at(SURFACE_LIFT_M));
  group.add(new LineLoop(ring, new LineBasicMaterial({ color: outlineColour })));
  if (part.image) {
    const g = new BufferGeometry();
    g.setAttribute('position', at(0));
    g.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const texture = new CanvasTexture(part.image);
    texture.colorSpace = SRGBColorSpace;
    // As a ground picture: no-data pixels cut out, no depth test or write, drawn before every record.
    const material = new MeshBasicMaterial({ map: texture, alphaTest: 0.01, depthTest: false, depthWrite: false });
    const mesh = new Mesh(g, material);
    mesh.renderOrder = part.under ? GROUND_OVERVIEW_ORDER : GROUND_PICTURE_ORDER;
    group.add(mesh);
  }
  if (part.points) {
    const { positions: flat, colors, sizeM } = part.points;
    const positions = new Float32Array(flat.length);
    for (let i = 0; i < flat.length; i += 3) {
      positions[i] = flat[i]!; positions[i + 1] = SURFACE_LIFT_M; positions[i + 2] = -flat[i + 1]!;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    g.setAttribute('color', new BufferAttribute(colors, 3));
    group.add(new Points(g, new PointsMaterial({ size: sizeM, vertexColors: true, sizeAttenuation: true })));
  }
  for (const child of group.children) child.raycast = () => {};
  group.userData.surface = part.id;
  return group;
}

function disposeSurfacePart(group: Group) {
  for (const child of group.children as (Mesh | LineLoop | Points)[]) {
    child.geometry.dispose();
    const material = child.material as Material & { map?: { dispose(): void } | null };
    material.map?.dispose();
    material.dispose();
  }
}

function disposeGroup(group: Group) {
  for (const child of [...group.children]) disposeObject(child);
  group.clear();
}

/** `parent.remove(...objects)` with one pass over the children instead of a search and splice per object. */
function removeChildren(parent: Object3D, objects: ReadonlySet<Object3D>) {
  if (!objects.size) return;
  const kept: Object3D[] = [];
  const gone: Object3D[] = [];
  for (const child of parent.children) (objects.has(child) ? gone : kept).push(child);
  parent.children = kept;
  for (const child of gone) {
    child.parent = null;
    child.dispatchEvent({ type: 'removed' });
    parent.dispatchEvent({ type: 'childremoved', child });
  }
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
