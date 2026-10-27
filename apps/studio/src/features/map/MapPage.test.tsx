import { container } from '../intake/fake-dom';
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { ApiError } from '@ulpin/api-client';
import type { SceneViewProps } from '@ulpin/scene/react';
import type { AreaDisplayWindow } from '../../api/queries';
import { MapPage } from './MapPage';

// Test-only stand-ins: an area beyond the display limit, its summary and one window page of two squares.
const facts = vi.hoisted(() => ({
  context: vi.fn<() => Promise<unknown>>(),
  mounts: 0,
  buildings: [] as unknown[],
}));
vi.mock('../../api/queries', async (original) => ({
  ...await original<typeof import('../../api/queries')>(),
  useAreaContext: () => useQuery({ queryKey: ['area-context'], queryFn: facts.context, retry: false }),
  useAreas: () => ({ data: [{ id: 'a', name: 'Test area', siteId: 's', reference: null }] }),
  useAreaDisplaySummary: () => ({ data: { areaId: 'a', areaRevision: 1, featureCount: 5, extent: [0, 0, 10, 10],
    displayLimit: 4 } }),
  readAreaWindow: async (): Promise<AreaDisplayWindow> => ({ areaId: 'a', areaRevision: 1,
    features: ['p', 'q'].map((id) => ({ id, identifier: id, kind: 'building', heightM: 3, heightState: 'reviewed',
      displayState: 'recorded', polygons: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] })) } as AreaDisplayWindow),
}));
// The scene keeps its meshes for as long as it is mounted; it counts its mounts and the buildings it is handed.
vi.mock('@ulpin/scene/react', () => ({
  SceneView: ({ buildings, onReady }: SceneViewProps) => {
    useEffect(() => {
      facts.mounts++;
      onReady?.({ fitPlanBox() {}, viewFootprint: () => [[0, 0], [10, 0], [10, 10], [0, 10]] } as never);
    }, []);
    facts.buildings.push(buildings);
    return null;
  },
}));
vi.mock('./surface/useSurfaceLayer', () => ({ useSurfaceLayer: () => ({ items: [], lines: [], show() {} }) }));
vi.mock('./preview/useReadPreview', () => ({ useReadPreview: () => [] }));
vi.mock('./ScaleAndNorth', () => ({ ScaleAndNorth: () => null }));

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
