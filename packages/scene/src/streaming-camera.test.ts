import { afterEach, describe, expect, it, vi } from 'vitest';
import { Box3, Group, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { SceneEngine } from './engine';
import type { BaseFeatureInput, FootprintInput } from './types';

function fixture(reducedMotion = false) {
  const material = new MeshBasicMaterial();
  const engine = Object.assign(Object.create(SceneEngine.prototype), {
    programWarmUp: { settled: true },
    state: { mode: 'area' }, options: { reducedMotion }, cameraKey: '', flight: null,
    baseBox: new Box3(), arrivedBox: new Box3(), arrivalBounds: new Map(), framedBox: null,
    buildingInputs: new Map(), buildingQueue: new Map(), buildingBounds: new Map(),
    baseInputs: [], baseNeedsDraw: false, base: new Group(), kerbs: new Group(), raised: [],
    baseEntries: new Map(), baseBatches: new Set(), baseQueue: new Map(), lands: [],
    anchors: new Map(), anchorSizes: new Map(), m: { road: material, kerb: material },
    container: { clientWidth: 1440, clientHeight: 900 }, camera: new PerspectiveCamera(45),
    controls: { target: new Vector3(), update: vi.fn() },
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
