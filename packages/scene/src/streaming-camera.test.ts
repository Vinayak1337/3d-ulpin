import { afterEach, describe, expect, it, vi } from 'vitest';
import { Box3, DirectionalLight, Fog, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { SceneEngine } from './engine';
import type { BaseFeatureInput, FootprintInput } from './types';

function fixture(reducedMotion = false) {
  const material = new MeshBasicMaterial();
  const engine = Object.assign(Object.create(SceneEngine.prototype), {
    programWarmUp: { settled: true },
    state: { mode: 'area' }, options: { reducedMotion }, cameraKey: '', flight: null,
    baseBox: new Box3(), arrivedBox: new Box3(), arrivalBounds: new Map(), importIds: new Set(), framedBox: null,
    buildingInputs: new Map(), buildingQueue: new Map(), buildingBounds: new Map(),
    baseInputs: [], baseNeedsDraw: false, base: new Group(), kerbs: new Group(), raised: [],
    baseEntries: new Map(), baseBatches: new Set(), baseQueue: new Map(), lands: [],
    anchors: new Map(), anchorSizes: new Map(), m: { road: material, kerb: material },
    container: { clientWidth: 1440, clientHeight: 900 }, camera: new PerspectiveCamera(45, 1, 0.3, 20_000),
    controls: { target: new Vector3(), update: vi.fn(), maxDistance: Infinity },
    scene: { fog: new Fog(0, 260, 620) }, areaBox: new Box3(), framedReach: 0, frame: new Box3(),
    ground: new Mesh(), sun: new DirectionalLight(),
    requestRender: vi.fn(), apply: vi.fn(), applyLayers: vi.fn(), applyRaise: vi.fn(),
    buildDressing: vi.fn(), buildUtilities: vi.fn(), setLook: vi.fn(),
  });
  return engine as Pick<SceneEngine, keyof SceneEngine> & Record<string, any>;
}

function surface(maxX: number): BaseFeatureInput {
  return { id: 'surface', kind: 'road', polygons: [[[[0, 0], [maxX, 0], [maxX, 100], [0, 100], [0, 0]]]] };
}

function building(id: string, x: number): FootprintInput {
  return {
    id, heightM: 20, heightState: 'source_supported',
    polygons: [[[[x, 20], [x + 10, 20], [x + 10, 30], [x, 30], [x, 20]]]],
  };
}

function arrive(engine: ReturnType<typeof fixture>, inputs: FootprintInput[]) {
  engine.updateArrivalBounds(new Map(inputs.map((input) => [input.id, input])));
  engine.followArrivedContent();
}

afterEach(() => vi.restoreAllMocks());

describe('streaming area camera', () => {
  it('fits surfaces first and does not refit for buildings inside their plan bounds', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const engine = fixture();
    const fits = vi.spyOn(engine, 'applyCamera');
    engine.setImportStreaming(true);
    engine.setBase([surface(100)]);
    const firstPosition = engine.camera.position.clone();
    arrive(engine, [building('inside', 40)]);
    expect(fits).toHaveBeenCalledOnce();
    expect(engine.flight).toBeNull();
    expect(engine.camera.position.equals(firstPosition)).toBe(true);
    expect(engine.framedBox.max.x).toBe(100);
    engine.camera.aspect = 1440 / 900;
    engine.camera.updateProjectionMatrix();
    engine.camera.lookAt(engine.controls.target);
    engine.camera.updateMatrixWorld();
    for (const x of [0, 100]) for (const z of [-100, 0]) {
      const projected = new Vector3(x, 0, z).project(engine.camera);
      expect(Math.abs(projected.x)).toBeLessThanOrEqual(0.91);
      expect(Math.abs(projected.y)).toBeLessThanOrEqual(0.91);
    }
  });

  it('eases one refit per growth and waits for the active flight before framing further growth', () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const engine = fixture();
    engine.setImportStreaming(true);
    engine.setBase([surface(100)]);
    arrive(engine, [building('outside', 120)]);
    const flight = engine.flight;
    expect(flight.start).toBe(0);
    expect(engine.framedBox.max.x).toBe(130);
    arrive(engine, [building('outside', 120), building('further', 150)]);
    expect(engine.flight).toBe(flight);
    clock = 300;
    expect(engine.stepFlight(clock)).toBe(true);
    expect(engine.camera.position.equals(flight.to[0])).toBe(false);
    clock = 600;
    expect(engine.stepFlight(clock)).toBe(false);
    engine.followArrivedContent();
    expect(engine.flight.start).toBe(600);
    expect(engine.framedBox.max.x).toBe(160);
  });

  it('one navigation interaction, selection, or non-area mode ends following for this import', () => {
    for (const stop of ['interaction', 'selection', 'mode']) {
      const engine = fixture();
      engine.setImportStreaming(true);
      engine.setBase([surface(100)]);
      if (stop === 'interaction') engine.stopFollowingImport();
      else engine.setState({ mode: stop === 'mode' ? 'building' : 'area', buildingId: 'selected' } as never);
      engine.setState({ mode: 'area', buildingId: null } as never);
      arrive(engine, [building('outside', 120)]);
      expect(engine.followImport).toBe(false);
      expect(engine.flight).toBeNull();
      engine.setImportStreaming(true);
      expect(engine.followImport).toBe(false);
    }
  });

  it('jumps with reduced motion and fits once outside an import', () => {
    const engine = fixture(true);
    engine.setImportStreaming(true);
    engine.setBase([surface(100)]);
    const initial = engine.camera.position.clone();
    arrive(engine, [building('outside', 120)]);
    expect(engine.flight).toBeNull();
    expect(engine.camera.position.equals(initial)).toBe(false);
    engine.setImportStreaming(false);
    const fits = vi.spyOn(engine, 'applyCamera');
    arrive(engine, [building('later', 1000)]);
    expect(fits).not.toHaveBeenCalled();
  });
});

/** Synthetic test-only squares of `size` metres, `columns` to a row at `pitch` metres from (x, y). */
function grid(prefix: string, count: number, [x, y]: [number, number], pitch: number, columns: number, size: number) {
  return Array.from({ length: count }, (_, i): FootprintInput => {
    const [left, bottom] = [x + (i % columns) * pitch, y + Math.floor(i / columns) * pitch];
    return {
      id: `${prefix}-${i}`, heightM: 20, heightState: 'source_supported',
      polygons: [[[[left, bottom], [left + size, bottom], [left + size, bottom + size], [left, bottom + size],
        [left, bottom]]]],
    };
  });
}

/** Screen box (normalised, -1 to 1) of a plan box (east, north) under the fixture's 1440 x 900 canvas. */
function onScreen(engine: ReturnType<typeof fixture>, [minX, minY, maxX, maxY]: number[]) {
  engine.camera.aspect = 1440 / 900;
  engine.camera.updateProjectionMatrix();
  engine.camera.lookAt(engine.controls.target);
  engine.camera.updateMatrixWorld();
  const box = new Box3();
  for (const x of [minX!, maxX!]) {
    for (const y of [minY!, maxY!]) box.expandByPoint(new Vector3(x, 0, -y).project(engine.camera));
  }
  return box;
}

/** How much of the view a plan box spans on its longer screen axis (1 = edge to edge); 0 when it leaves the view. */
function viewShare(engine: ReturnType<typeof fixture>, plan: number[]) {
  const box = onScreen(engine, plan);
  if (box.min.x < -1 || box.min.y < -1 || box.max.x > 1 || box.max.y > 1) return 0;
  return Math.max(box.max.x - box.min.x, box.max.y - box.min.y) / 2;
}

const idsOf = (inputs: FootprintInput[]) => new Set(inputs.map((input) => input.id));

describe('framing an imported package', () => {
  // A wide base map already drawn, a first package of 2,000 small footprints in one block, a second of 66 elsewhere.
  const areaRoads: BaseFeatureInput = {
    id: 'area-roads', kind: 'road', polygons: [[[[0, 0], [6000, 0], [6000, 4000], [0, 4000], [0, 0]]]],
  };
  const first = grid('first', 2000, [4000, 2500], 8, 50, 6);
  const second = grid('second', 66, [1000, 500], 12, 11, 10);

  function importFirst() {
    const engine = fixture(true);
    engine.setImportStreaming(true);
    engine.setBase([areaRoads]);
    engine.setImportFocus('package-1', idsOf(first));
    arrive(engine, first);
    return engine;
  }

  it('frames the first package by its own footprints, not the area around them', () => {
    const engine = importFirst();
    expect(viewShare(engine, [4000, 2500, 4398, 2818])).toBeGreaterThan(0.6);
  });

  it('moves the view to a second package elsewhere', () => {
    const engine = importFirst();
    engine.setImportFocus('package-2', idsOf(second));
    arrive(engine, [...first, ...second]);
    expect(viewShare(engine, [1000, 500, 1130, 594])).toBeGreaterThan(0.6);
    expect(viewShare(engine, [4000, 2500, 4398, 2818])).toBe(0);
  });

  it('keeps the officer camera for packages arriving after they moved it, until the next import starts', () => {
    const engine = importFirst();
    const kept = engine.camera.position.clone();
    engine.officerMovesCamera(); // what a pointer down or a wheel on the map calls
    arrive(engine, [...first, ...grid('late', 4, [5000, 3500], 12, 2, 10)]);
    engine.setImportFocus('package-2', idsOf(second));
    arrive(engine, [...first, ...second]);
    expect(engine.camera.position.equals(kept)).toBe(true);
    engine.setImportStreaming(false);
    engine.setImportStreaming(true);
    engine.setImportFocus('package-3', idsOf(second));
    expect(viewShare(engine, [1000, 500, 1130, 594])).toBeGreaterThan(0.6);
  });

  it('frames the dense part of a package spread across a city so its footprints stay readable', () => {
    // The rehearsal's first package spread 2,000 footprints of about 20 m over 5.3 km by 11 km: fitting all of them
    // left each footprint under two pixels. Synthetic squares of that shape: a scattered grid and one dense block.
    const scattered = grid('scattered', 1700, [0, 0], 230, 23, 20);
    const dense = grid('dense', 300, [2000, 6000], 25, 20, 20);
    const engine = fixture(true);
    engine.setImportStreaming(true);
    engine.setImportFocus('package-1', idsOf([...scattered, ...dense]));
    arrive(engine, [...scattered, ...dense]);
    expect(viewShare(engine, [2000, 6000, 2495, 6370])).toBeGreaterThan(0);
    const footprint = onScreen(engine, [2240, 6175, 2260, 6195]);
    const pixels = (footprint.max.x - footprint.min.x) / 2 * 1440;
    expect(pixels).toBeGreaterThan(8);
  });
});

describe('fitting a plan box', () => {
  it('frames the whole box in the area view, and content arriving later keeps that frame', () => {
    const engine = fixture(true);
    engine.fitPlanBox(-2000, 500, 3000, 2500);
    expect(engine.framedBox.min.toArray()).toEqual([-2000, 0, -2500]);
    expect(engine.framedBox.max.toArray()).toEqual([3000, 0, -500]);
    engine.camera.aspect = 1440 / 900;
    engine.camera.updateProjectionMatrix();
    engine.camera.lookAt(engine.controls.target);
    engine.camera.updateMatrixWorld();
    for (const x of [-2000, 3000]) for (const z of [-2500, -500]) {
      const projected = new Vector3(x, 0, z).project(engine.camera);
      expect(Math.abs(projected.x)).toBeLessThanOrEqual(0.91);
      expect(Math.abs(projected.y)).toBeLessThanOrEqual(0.91);
    }
    const fitted = engine.camera.position.clone();
    const fits = vi.spyOn(engine, 'applyCamera');
    arrive(engine, [building('inside', 0)]);
    expect(fits).not.toHaveBeenCalled();
    expect(engine.camera.position.equals(fitted)).toBe(true);
  });

  it('eases to the box unless motion is reduced, and leaves a building view alone', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const engine = fixture();
    engine.fitPlanBox(0, 0, 100, 100);
    expect(engine.flight.to[1].toArray()).toEqual([50, 0, -50]);
    const level = fixture();
    level.state = { mode: 'level' };
    level.fitPlanBox(0, 0, 100, 100);
    expect(level.flight).toBeNull();
    expect(level.cameraKey).toBe('');
  });
});

describe('camera depth range', () => {
  const fog = (engine: ReturnType<typeof fixture>) => engine.scene.fog as Fog;

  function project(engine: ReturnType<typeof fixture>) {
    engine.camera.aspect = 1440 / 900;
    engine.camera.updateProjectionMatrix();
    engine.camera.lookAt(engine.controls.target);
    engine.camera.updateMatrixWorld();
  }

  it('keeps a 60 km by 40 km box whole inside the frustum and the far plane', () => {
    const engine = fixture(true);
    engine.fitPlanBox(0, 0, 60_000, 40_000);
    project(engine);
    const distance = engine.camera.position.distanceTo(engine.controls.target);
    expect(distance).toBeGreaterThan(20_000);
    expect(engine.camera.far).toBeGreaterThanOrEqual(distance + Math.hypot(60_000, 40_000));
    expect(engine.camera.near / engine.camera.far).toBeCloseTo(0.3 / 20_000, 9);
    expect(engine.controls.maxDistance).toBeGreaterThanOrEqual(distance);
    expect(fog(engine).near).toBeGreaterThanOrEqual(distance + Math.hypot(60_000, 40_000));
    for (const x of [0, 60_000]) for (const z of [-40_000, 0]) {
      const projected = new Vector3(x, 0, z).project(engine.camera);
      expect(Math.abs(projected.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(projected.y)).toBeLessThanOrEqual(1);
      expect(projected.z).toBeLessThan(1);
    }
  });

  it('leaves a 50 m box on the defaults, and a small box after a large one returns to them', () => {
    const engine = fixture(true);
    engine.fitPlanBox(0, 0, 50, 50);
    expect([engine.camera.near, engine.camera.far, engine.controls.maxDistance]).toEqual([0.3, 20_000, Infinity]);
    expect([fog(engine).near, fog(engine).far]).toEqual([260, 620]);
    engine.fitPlanBox(0, 0, 60_000, 40_000);
    expect(engine.camera.far).toBeGreaterThan(20_000);
    engine.fitPlanBox(0, 0, 50, 50);
    expect([engine.camera.near, engine.camera.far, engine.controls.maxDistance]).toEqual([0.3, 20_000, Infinity]);
    expect([fog(engine).near, fog(engine).far]).toEqual([260, 620]);
  });

  it('keeps the wider range during a flight to a smaller frame and settles when it lands', () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const engine = fixture();
    engine.fitPlanBox(0, 0, 60_000, 40_000);
    const wide = engine.camera.far;
    clock = 600;
    engine.stepFlight(clock);
    engine.fitPlanBox(0, 0, 50, 50);
    expect(engine.camera.far).toBe(wide);
    clock = 1200;
    expect(engine.stepFlight(clock)).toBe(false);
    expect([engine.camera.near, engine.camera.far, engine.controls.maxDistance]).toEqual([0.3, 20_000, Infinity]);
  });
});

describe('ground and shadow follow the framed area', () => {
  const extent = (engine: ReturnType<typeof fixture>) => new Box3().setFromCenterAndSize(
    engine.ground.position.clone().setY(0), new Vector3(engine.ground.scale.x, 0, engine.ground.scale.y),
  );
  const cluster = (engine: ReturnType<typeof fixture>, x: number) => {
    engine.areaBox.set(new Vector3(x, 0, -30), new Vector3(x + 410, 20, -20));
    engine.fitGroundAndShadow();
  };

  it('covers a 13 km by 22 km frame and the fog beyond it when only a 500 m cluster is loaded', () => {
    const engine = fixture(true);
    engine.fitPlanBox(0, 0, 13_000, 22_000);
    cluster(engine, 6_000);
    const fog = engine.scene.fog as Fog;
    const ground = extent(engine);
    const wanted = new Box3(new Vector3(-fog.far, 0, -22_000 - fog.far), new Vector3(13_000 + fog.far, 0, fog.far));
    expect(ground.containsBox(wanted)).toBe(true);
    const shadow = engine.sun.shadow.camera;
    expect(shadow.right).toBe(410 * 0.75);
  });

  it('keeps the shadow camera within 1.5 km of the view target however much is loaded', () => {
    const engine = fixture(true);
    engine.fitPlanBox(0, 0, 13_000, 22_000);
    engine.areaBox.set(new Vector3(0, 0, -22_000), new Vector3(13_000, 30, 0));
    engine.fitGroundAndShadow();
    expect(engine.sun.shadow.camera.right).toBe(1_500);
    engine.camera.position.set(0, 20_000, 0);
    engine.followSun();
    expect(engine.sun.shadow.camera.right).toBe(1_500);
  });

  it('leaves a small scene on its old ground and shadow, and loading more never shrinks the ground', () => {
    const engine = fixture(true);
    engine.areaBox.set(new Vector3(0, 0, 0), new Vector3(100, 20, 80));
    engine.fitGroundAndShadow();
    expect(engine.ground.position.toArray()).toEqual([50, -0.01, 40]);
    expect(engine.ground.scale.toArray()).toEqual([1000, 1000, 1]);
    const shadow = engine.sun.shadow.camera;
    expect([shadow.left, shadow.right, shadow.far]).toEqual([-75, 75, 0.75 * 100 * 1.6 * 4]);
    engine.fitPlanBox(0, 0, 100, 100);
    const small = extent(engine);
    engine.fitPlanBox(0, 0, 13_000, 22_000);
    const wide = extent(engine);
    expect(wide.containsBox(small)).toBe(true);
    cluster(engine, 6_000);
    const loaded = extent(engine);
    cluster(engine, 6_400);
    expect(extent(engine).containsBox(loaded)).toBe(true);
    expect(extent(engine).containsBox(wide)).toBe(true);
  });
});
