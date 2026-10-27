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
  frame: undefined as SceneViewProps['onView'],
}));
vi.mock('../../api/queries', async (original) => ({
  ...await original<typeof import('../../api/queries')>(),
  useAreaContext: () => useQuery({ queryKey: ['area-context'], queryFn: facts.context, retry: false }),
  useAreas: () => ({ data: [{ id: 'a', name: 'Test area', siteId: 's', reference: null }] }),
  useAreaCanonical: () => ({ data: undefined, isLoading: false, error: null }),
  useAreaDisplaySummary: () => ({ data: { areaId: 'a', areaRevision: 1, featureCount: 5, extent: [0, 0, 10, 10],
    displayLimit: 4 } }),
  readAreaWindow: async (): Promise<AreaDisplayWindow> => ({ areaId: 'a', areaRevision: 1,
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
vi.mock('./surface/useSurfaceLayer', () => ({ useSurfaceLayer: () => ({ items: [], lines: [], show() {} }) }));
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
