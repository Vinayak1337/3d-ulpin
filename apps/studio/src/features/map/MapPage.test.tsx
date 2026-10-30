import { container, elements } from '../intake/fake-dom';
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { ApiError } from '@ulpin/api-client';
import type { SceneViewProps } from '@ulpin/scene/react';
import { queryKeys, type AreaContext, type AreaDisplayWindow } from '../../api/queries';
import nyc from '../../local/data/nyc-bronx-context.json';
import swiss from '../../local/data/swiss-floor-context.json';
import { MapPage } from './MapPage';
import { MapWorkspace } from './MapWorkspace';

// Test-only stand-ins: an area beyond the display limit, its summary and one window page of two squares.
const facts = vi.hoisted(() => ({
  context: vi.fn<() => Promise<unknown>>(),
  mounts: 0,
  buildings: [] as unknown[],
  drawn: new Set<string>(),
  surfaceDrawn: '',
  frame: undefined as SceneViewProps['onView'],
  pkg: undefined as { areaId: string; features: { identifier: string }[] } | undefined,
  windowRead: undefined as ((after: string | undefined, limit: number) =>
    AreaDisplayWindow | Promise<AreaDisplayWindow>) | undefined,
}));
vi.mock('../../api/queries', async (original) => ({
  ...await original<typeof import('../../api/queries')>(),
  useAreaContext: () => useQuery({ queryKey: ['area-context'], queryFn: facts.context, retry: false }),
  useAreas: () => ({ data: [{ id: 'a', name: 'Test area', siteId: 's', reference: null }] }),
  useAreaCanonical: () => ({ data: undefined, isLoading: false, error: null }),
  useImportPackage: () => ({ data: facts.pkg, isPending: false }),
  useAreaDisplaySummary: () => ({ data: { areaId: 'a', areaRevision: 1, featureCount: 5, extent: [0, 0, 10, 10],
    displayLimit: 4 } }),
  readAreaWindow: async (_areaId: string, _bounds: unknown, after: string | undefined, limit: number)
    : Promise<AreaDisplayWindow> => facts.windowRead?.(after, limit) ?? ({ areaId: 'a', areaRevision: 1,
    features: ['p', 'q'].map((id) => ({ id, identifier: id, kind: 'building', heightM: 3, heightState: 'reviewed',
      displayState: 'recorded', polygons: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] })) } as AreaDisplayWindow),
}));
// The scene keeps its meshes for as long as it is mounted; it counts its mounts and the buildings it is handed.
vi.mock('@ulpin/scene/react', () => ({
  SceneView: ({ buildings, onReady, onView }: SceneViewProps) => {
    facts.frame = onView;
    useEffect(() => {
      facts.mounts++;
      onReady?.({ fitPlanBox() {}, viewFootprint: () => [[0, 0], [10, 0], [10, 10], [0, 10]],
        setAreaExtent() {}, setImportStreaming() {}, setImportFocus() {}, setAnchor() {},
        project() {}, anchorPixelSize: () => 0,
        drawnBuildings: () => ({ count: facts.drawn.size, has: (id: string) => facts.drawn.has(id) }),
      } as never);
    }, []);
    facts.buildings.push(buildings);
    return null;
  },
}));
vi.mock('./surface/useSurfaceLayer', () => ({
  useSurfaceLayer: () => ({ items: [], lines: [], show() {}, drawn: facts.surfaceDrawn }),
}));
vi.mock('./preview/useReadPreview', () => ({ useReadPreview: () => [] }));
vi.mock('./ScaleAndNorth', () => ({ ScaleAndNorth: () => null }));
vi.mock('./BuildingSearch', () => ({ BuildingSearch: () => null }));

it.each([nyc, swiss])('S3.16d: canvas publishes only its drawn package ($area.id)', async (data) => {
  const packageId = 'test-only:map-moment';
  const other = (data === nyc ? swiss : nyc).features[0]!;
  const context = { ...data, displayFeatures: [
    ...data.features.map(f => ({ ...f, proposalPackageId: packageId })), other,
  ] };
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(queryKeys.importPackage(packageId), { name: data.area.name, features: [] });
  facts.drawn.clear();
  const root = container();
  const view = createRoot(root as never);
  try {
    await act(async () => view.render(<QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/studio/areas/${data.area.id}?package=${packageId}`]}>
        <MapWorkspace context={context as unknown as AreaContext} />
      </MemoryRouter>
    </QueryClientProvider>));
    const canvas = () => elements(root).find(node => node.getAttribute('class')?.includes('canvasWrap'))!;
    expect(canvas().hasAttribute('data-drawn-packages')).toBe(false);
    await act(async () => { facts.drawn.add(other.id); facts.frame?.(); });
    expect(canvas().hasAttribute('data-drawn-packages')).toBe(false);
    await act(async () => { facts.drawn.add(data.features[0]!.id); facts.frame?.(); });
    expect(canvas().getAttribute('data-drawn-packages')).toBe(packageId);
    await act(async () => { facts.drawn.clear(); facts.frame?.(); });
    expect(canvas().hasAttribute('data-drawn-packages')).toBe(false);
  } finally {
    await act(async () => view.unmount());
    client.clear();
    facts.drawn.clear();
    facts.mounts = 0;
  }
});

it('S3.16f: last of 21 packages loads first; its signal waits for a drawn frame', async () => {
  // Shape-only 41,804-building/21-package control, using an existing test_only source outline unchanged.
  const packageId = 'test-only:package:20';
  const outline = nyc.features.find(feature => feature.kind === 'building')!.geometry;
  const polygons = outline.type === 'Polygon' ? [outline.coordinates] : outline.coordinates;
  const all = Array.from({ length: 41_804 }, (_, i) => ({
    id: `test-only:building:${i}`, identifier: `test-only:${String(i).padStart(8, '0')}`,
    packageId: `test-only:package:${Math.floor(i / 2000)}`, kind: 'building', polygons,
    heightM: null, heightState: 'unknown', displayState: 'unrecorded_proposal',
  })) as AreaDisplayWindow['features'];
  expect(new Set(all.map(feature => feature.packageId)).size).toBe(21);
  facts.pkg = { areaId: 'a', features: all.slice(40_000) };
  const reads: (string | undefined)[] = [];
  let continueRead!: () => void;
  facts.windowRead = (after, limit) => {
    reads.push(after);
    const remaining = all.filter(feature => after === undefined || feature.identifier > after);
    const features = remaining.slice(0, limit);
    const page = { areaId: 'a', areaRevision: 1, features,
      next: remaining.length > limit ? features.at(-1)!.identifier : null };
    if (reads.length === 2) return new Promise(resolve => { continueRead = () => resolve(page); });
    return page;
  };
  facts.context.mockRejectedValue(refused());
  facts.drawn.clear();
  facts.buildings = [];
  const client = new QueryClient();
  const root = container();
  const view = createRoot(root as never);
  try {
    await act(async () => view.render(<QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/studio/areas/a?package=${packageId}`]}>
        <Routes><Route path="/studio/areas/:areaId" element={<MapPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>));
    await settle();
    expect(reads[0]).toBe(all[40_000]!.identifier.slice(0, -1));
    const first = facts.buildings.find(buildings => (buildings as unknown[]).length) as { id: string }[];
    expect(first[0]!.id).toBe(all[40_000]!.id);
    expect(first).toHaveLength(1804);
    const canvas = () => elements(root).find(node => node.getAttribute('class')?.includes('canvasWrap'))!;
    expect(canvas().hasAttribute('data-drawn-packages')).toBe(false);
    await act(async () => { facts.drawn.add(all[0]!.id); facts.frame?.(); });
    expect(canvas().hasAttribute('data-drawn-packages')).toBe(false);
    await act(async () => { facts.drawn.add(first[0]!.id); facts.frame?.(); });
    expect(canvas().getAttribute('data-drawn-packages')).toBe(packageId);
    await act(async () => continueRead());
    expect(facts.buildings.at(-1)).toHaveLength(15_000);
    expect(canvas().getAttribute('data-drawn-packages')).toBe(packageId);
  } finally {
    await act(async () => view.unmount());
    client.clear();
    facts.pkg = undefined;
    facts.windowRead = undefined;
    facts.drawn.clear();
    facts.mounts = 0;
  }
});

const refused = () => new ApiError(422, '/api/v1/areas/a/context',
  { error: { code: 'AREA_LIMIT', message: 'Choose an area with at most 4 display features.' } });
// React renders what a timer changed when the act around it ends: wait past the view's settle time in short steps.
async function settle() {
  for (let step = 0; step < 6; step++) await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
}

it('S7.28: reading a windowed area again keeps its drawn buildings and scene, during and after the read', async () => {
  facts.context.mockRejectedValue(refused());
  const client = new QueryClient();
  const root = container();
  const view = createRoot(root as never);
  try {
    await act(async () => view.render(<QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/studio/areas/a?package=p']}>
        <Routes><Route path="/studio/areas/:areaId" element={<MapPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>));
    await settle();
    expect(root.textContent).toContain('2 buildings in view of 5');
    const drawn = facts.buildings.at(-1);

    let answer!: (error: unknown) => void;
    facts.context.mockImplementationOnce(() => new Promise((_resolve, reject) => { answer = reject; }));
    await act(async () => { void client.refetchQueries({ queryKey: ['area-context'] }); });
    await settle();
    expect(client.getQueryState(['area-context'])?.fetchStatus).toBe('fetching');
    expect(root.textContent).toContain('2 buildings in view of 5');
    expect(facts.mounts).toBe(1);

    await act(async () => answer(refused()));
    await settle();
    expect(root.textContent).toContain('2 buildings in view of 5');
    expect(facts.mounts).toBe(1);
    expect(facts.buildings.at(-1)).toBe(drawn);
  } finally {
    await act(async () => view.unmount());
    client.clear();
  }
});

it('S9.4c: the canvas lists the files whose surface parts are drawn, with no words', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  const root = container();
  const view = createRoot(root as never);
  const render = () => view.render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[`/studio/areas/${nyc.area.id}`]}>
      <MapWorkspace context={{ ...nyc, displayFeatures: nyc.features } as unknown as AreaContext} />
    </MemoryRouter>
  </QueryClientProvider>);
  try {
    await act(async () => render());
    const canvas = () => elements(root).find(node => node.getAttribute('class')?.includes('canvasWrap'))!;
    expect(canvas().hasAttribute('data-drawn-items')).toBe(false);
    facts.surfaceDrawn = 'test-only:raster test-only:points';
    await act(async () => render());
    expect(canvas().getAttribute('data-drawn-items')).toBe('test-only:raster test-only:points');
  } finally {
    await act(async () => view.unmount());
    client.clear();
    facts.surfaceDrawn = '';
    facts.mounts = 0;
  }
});
