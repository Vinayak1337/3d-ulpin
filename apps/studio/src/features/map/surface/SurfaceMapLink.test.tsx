import { container, elements } from '../../intake/fake-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import type { IntakeItem } from './parts';

// The parts and display routes answered in memory: part 0 is quarantined, part 1 is placed in the file's own area.
const facts = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock('@ulpin/api-client', () => ({
  ApiError: class extends Error {},
  unwrap: (result: { data: unknown }) => result.data,
  api: {
    GET: async (path: string, { params }: { params: { path: { partIndex?: number } } }) => {
      facts.paths.push(path);
      if (path.endsWith('/parts')) return { data: { parts: [{ partIndex: 0, state: 'quarantined' },
        { partIndex: 1, state: 'published' }], next: null } };
      return { data: { partIndex: params.path.partIndex, placement: { state: 'placed', areaId: 'own-area' } } };
    },
  },
}));
const { SurfaceMapLink } = await import('./SurfaceMapLink');

const item = (placement: string) => ({ itemId: 'far', caseId: 'case', sourceId: 'source', name: 'far.tif',
  family: 'raster', state: 'read', placement, partsDone: 2 }) as unknown as IntakeItem;

const links = (host: ReturnType<typeof container>) => elements(host).filter((node) => node.tagName === 'A');

async function render(entry: IntakeItem) {
  const host = container(), view = createRoot(host as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => view.render(<QueryClientProvider client={client}><MemoryRouter>
    <SurfaceMapLink item={entry} /></MemoryRouter></QueryClientProvider>));
  return { view, client, host };
}

it('S9.4d: a surface file on the map opens the area its first read part is placed in, with its batch', async () => {
  facts.paths.length = 0;
  const { view, host } = await render(item('on_map'));
  await vi.waitFor(() => expect(links(host).map((node) => node.getAttribute('href')))
    .toEqual(['/studio/areas/own-area?case=case']));
  expect(facts.paths.at(-1)).toBe('/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/parts/{partIndex}/display');
  await act(async () => view.unmount());
});

it('S9.4d: a surface file not on the map has no link and reads nothing', async () => {
  facts.paths.length = 0;
  const { view, client, host } = await render(item('not_understood'));
  await vi.waitFor(() => expect(client.isFetching()).toBe(0));
  expect(links(host)).toEqual([]);
  expect(facts.paths).toEqual([]);
  await act(async () => view.unmount());
});
