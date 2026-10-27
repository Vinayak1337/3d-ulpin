import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { SceneEngine, type BaseFeatureInput, type LocalXY } from '@ulpin/scene';
import context from '../../local/data/nyc-bronx-context.json';
import type { AreaFeature } from '../../api/queries';
import { drawingCountNote, drawnCountNote, packageFeatureIds, polygonsOf, toBase, toFootprints,
  undrawnNote } from './footprints';

describe('toFootprints on the derived NYC OTI area', () => {
  const footprints = toFootprints(context.features as unknown as AreaFeature[]);
  it('draws every source building once, keyed by its record ID', () => {
    expect(footprints).toHaveLength(62);
    expect(new Set(footprints.map((f) => f.id)).size).toBe(62);
  });
  it('carries source heights unchanged, never filling unknowns', () => {
    for (const f of footprints) {
      if (f.heightState === 'unknown') expect(f.heightM).toBeNull();
      else expect(f.heightM).toBeGreaterThan(0);
    }
  });
});

describe('undrawnNote', () => {
  const line = { kind: 'road', geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] } };
  const polygon = { kind: 'building', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } };
  it('counts only features with no geometry, by kind', () => {
    const note = undrawnNote([line, { kind: 'road', geometry: null }, polygon] as never);
    expect(note).toContain('1 road feature');
  });
  it('is silent when every feature is drawn', () => {
    expect(undrawnNote([line, polygon] as never)).toBeNull();
  });
  it('counts a building drawn as a line and a geometry the map does not draw', () => {
    const lineBuilding = { ...line, kind: 'building' };
    const collection = { kind: 'parcel', geometry: { type: 'GeometryCollection', geometries: [] } };
    expect(undrawnNote([lineBuilding, collection, polygon] as never)).toBe('Not drawn: 1 building feature, 1 parcel feature');
  });
});

describe('drawingCountNote', () => {
  it('counts the real NYC features before drawing, then is silent after the first footprint', () => {
    const features = context.features as unknown as AreaFeature[];
    const name = 'nyc-bronx-context.json';
    expect(drawingCountNote(name, features, false))
      .toBe(`Drawing ${name}: ${features.length.toLocaleString('en-IN')} features so far`);
    expect(drawingCountNote(name, features, true)).toBeNull();
    expect(drawingCountNote(null, [], false)).toBe('Drawing: 0 features so far');
  });
});

describe('drawnCountNote', () => {
  const at = (id: string, revision: number) => ({ id, revision }) as never;
  it('counts the recorded features the map draws and those it does not', () => {
    expect(drawnCountNote([at('a', 1), at('b', 1), at('c', 2)], new Set(['a', 'c'])))
      .toBe('2 of 3 features drawn');
  });
  it('says when all are drawn, grouping thousands, and leaves out proposals not yet recorded', () => {
    const ids = Array.from({ length: 2148 }, (_, index) => `f${index}`);
    expect(drawnCountNote([...ids.map((id) => at(id, 1)), at('p', 0)], new Set(ids)))
      .toBe('2,148 features drawn');
  });
  it('is silent when nothing is recorded', () => {
    expect(drawnCountNote([at('p', 0)], new Set())).toBeNull();
  });
});

// The shape of the live context response for a building installed without geometry; the values are test values.
const recorded: AreaFeature = {
  id: 'building-1',
  kind: 'building',
  name: 'Test building',
  areaId: 'area-1',
  areaM2: null,
  height: { unit: 'm', state: 'unknown', value: null, meaning: 'unknown', reference: 'unknown' },
  evidence: [],
  geometry: null,
  revision: 1,
  placement: 'unknown',
  sourceKey: 'test-key',
  identifier: 'test-identifier',
  properties: {},
  worldStatus: 'planned',
  geometryRole: 'unknown',
  representation: 'physical_exterior',
  datasetNamespace: 'test-namespace',
  sourceRevisionId: 'revision-1',
};
const square = { type: 'Polygon' as const, coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };
const roadSource = JSON.parse(readFileSync(new URL(
  '../../../../../fixtures/google-uttam/02-osm-road-centrelines.geojson', import.meta.url,
), 'utf8')) as { features: { properties: { source_id: string; name?: string };
  geometry: { type: 'LineString'; coordinates: LocalXY[] } }[] };

// Source coordinates stay unchanged: this tests display transport, not placement or reprojection.
const roads: AreaFeature[] = roadSource.features.map((source) => ({
  ...recorded, id: source.properties.source_id, kind: 'road', geometry: source.geometry,
  properties: source.properties, name: source.properties.name ?? '',
}));

describe('non-building lines and pins', () => {
  it('draws the 35 converted OSM centrelines as one unpicked scene line object', () => {
    const inputs = toBase(roads);
    const batch = { inputs: new Map(inputs.map((input) => [input.id, input])),
      parcel: null, roadKerbs: null, sidewalkKerbs: null, lanes: null, lines: null, pins: null };
    const base = { add: vi.fn() };
    const engine = Object.assign(Object.create(SceneEngine.prototype), {
      base, kerbs: { add: vi.fn() }, baseBatches: new Set([batch]), baseQueue: new Map(), m: { parcel: {} },
    });
    engine.rebuildBaseLines(batch);
    expect(base.add).toHaveBeenCalledOnce();
    const paths = base.add.mock.calls[0]![0];
    expect(paths.type).toBe('LineSegments');
    const segments = inputs.reduce((sum, input: BaseFeatureInput) =>
      sum + input.lines!.reduce((count, path) => count + path.length - 1, 0), 0);
    expect(paths.geometry.getAttribute('position').count / 2).toBe(segments);
    expect(paths.material).toBe(engine.m.parcel);
    const hits: unknown[] = [];
    paths.raycast({}, hits);
    expect(hits).toEqual([]);
  });

  it.each([1, 0])('passes all 35 OSM roads at revision %i without inventing road polygons', (revision) => {
    const features = roads.map((road) => ({ ...road, revision }));
    const inputs = toBase(features);
    expect(inputs).toHaveLength(35);
    for (const [index, input] of inputs.entries()) {
      expect(input.polygons).toEqual([]);
      expect(input.lines).toEqual([roadSource.features[index]!.geometry.coordinates]);
      expect(input.pins).toBeUndefined();
    }
    expect(undrawnNote(features)).toBeNull();
    expect(toFootprints(features)).toEqual([]);
  });

  it('passes multipart paths and pins unchanged for every base kind, but never for buildings', () => {
    const coordinates = roadSource.features.slice(0, 2).map((road) => road.geometry.coordinates);
    const shapes: NonNullable<AreaFeature['geometry']>[] = [
      { type: 'MultiLineString', coordinates },
      { type: 'Point', coordinates: coordinates[0]![0]! },
      { type: 'MultiPoint', coordinates: coordinates[1]! },
    ];
    for (const kind of ['parcel', 'road', 'public_land', 'utility', 'building'] as const) {
      const features = shapes.map((geometry, i) => ({ ...recorded, id: `${kind}:${i}`, kind, geometry }));
      const inputs = toBase(features);
      if (kind === 'building') expect(inputs).toEqual([]);
      else {
        expect(inputs.map((input) => input.polygons)).toEqual([[], [], []]);
        expect(inputs[0]!.lines).toBe(coordinates);
        expect(inputs[1]!.pins).toEqual([coordinates[0]![0]!]);
        expect(inputs[2]!.pins).toBe(coordinates[1]);
        const engine = Object.assign(Object.create(SceneEngine.prototype), { baseEntries: new Map() });
        const batch = { inputs: new Map() };
        for (const input of inputs) {
          engine.addBaseEntry(input, batch);
          const box = engine.baseEntries.get(input.id).bounds;
          expect(box.isEmpty()).toBe(false);
          for (const [x, y] of [...(input.pins ?? []), ...(input.lines ?? []).flat()]) {
            expect(box.containsPoint({ x, y: 0, z: -y })).toBe(true);
          }
        }
      }
      expect(toFootprints(features)).toEqual([]);
      expect(undrawnNote(features)).toBe(kind === 'building' ? 'Not drawn: 3 building features' : null);
    }
  });
});

describe('packageFeatureIds', () => {
  const of = (id: string, proposalPackageId?: string) => ({ id, proposalPackageId }) as never;
  it('names the features the package in the URL proposed, so the map frames only them', () => {
    const features = [of('a', 'package-1'), of('b', 'package-2'), of('c'), of('d', 'package-2')];
    expect([...packageFeatureIds(features, 'package-2')]).toEqual(['b', 'd']);
    expect(packageFeatureIds(features, null).size).toBe(0);
  });
});

describe('scene inputs retained by feature object', () => {
  const features = context.features as unknown as AreaFeature[];

  it('returns the same footprint and base input for the same feature', () => {
    const first = toFootprints(features);
    const second = toFootprints([...features]);
    expect(second[0]).toBe(first[0]);
    const base = toBase(features);
    expect(toBase([...features])[0]).toBe(base[0]);
  });

  it('keeps the base array identity when a part only appends building features', () => {
    const ground = features.filter((feature) => feature.kind !== 'building');
    const buildings = features.filter((feature) => feature.kind === 'building');
    const base = toBase(ground);
    expect(toBase([...ground, ...buildings], base)).toBe(base);
  });

  it('does not cache by id: a replacement feature gets a replacement input', () => {
    const source = features.find((feature) => feature.kind === 'building')!;
    const first = toFootprints([source])[0];
    const replacement = { ...source, height: { ...source.height, value: null, state: 'unknown' as const } };
    const second = toFootprints([replacement])[0];
    expect(second).not.toBe(first);
    expect(second!.heightM).toBeNull();
  });
});

describe('features without recorded geometry', () => {
  const withGeometry = { ...recorded, id: 'building-2', geometry: square };
  it('gives scene inputs only to the buildings that have geometry', () => {
    expect(toFootprints([recorded, withGeometry]).map((f) => f.id)).toEqual(['building-2']);
  });
  it('yields nothing, and does not throw, when every feature has no geometry', () => {
    const road = { ...recorded, id: 'road-1', kind: 'road' as const };
    expect(toFootprints([recorded])).toEqual([]);
    expect(toBase([road])).toEqual([]);
    expect(polygonsOf(null)).toEqual([]);
  });
  it('leaves a building without geometry to its own list and counts a road without geometry', () => {
    const road = { ...recorded, id: 'road-1', kind: 'road' as const };
    expect(undrawnNote([recorded])).toBeNull();
    expect(undrawnNote([recorded, road])).toContain('1 road feature');
  });
});
