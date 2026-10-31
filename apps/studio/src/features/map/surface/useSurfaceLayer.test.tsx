import { container } from '../../intake/fake-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import type { IntakeItem, IntakeManifest } from '../../intake/batch-model';
import type { Consumer } from '../../intake/case-subscription';

// In-memory protocol controls standing in for the cases, manifest and one-item routes; no record is invented.
const facts = vi.hoisted(() => {
  const server = new Map<string, unknown>();
  const consumers = new Set<unknown>();
  return {
    server, consumers, publish: undefined as ((parts: { id: string }[], lines: unknown[]) => void) | undefined,
    areaId: undefined as string | null | undefined,
    manifestFn: vi.fn(async () => ({ caseId: 'case', items: [...server.values()] })),
    read: vi.fn(async (_caseId: string, itemId: string) => {
      const found = server.get(itemId);
      if (!found) throw new Error('Intake item not found in this case.');
      return found;
    }),
  };
});
// The case transport hands each change to every consumer of the case in turn, as case-subscription.ts does.
vi.mock('../../intake/case-subscription', () => ({
  caseSubscriptions: {
    subscribe: (_caseId: string, consumer: unknown) => {
      facts.consumers.add(consumer);
      return () => { facts.consumers.delete(consumer); };
    },
    reconnect() {},
  },
}));
vi.mock('../../intake/batch-queries', async (original) => ({
  ...await original<typeof import('../../intake/batch-queries')>(), readIntakeItem: facts.read,
}));
vi.mock('./api', () => ({
  readCases: async () => [{ id: 'case', siteId: 'site', archived: false },
    { id: 'far', siteId: 'own-site', archived: false }],
  intakeQuery: (caseId: string) => ({ queryKey: ['intake', caseId], retry: false, queryFn: facts.manifestFn }),
  browserSurfaceIo: () => ({}),
  SurfaceDecoder: class { dispose() {} },
}));
vi.mock('./parts', async (original) => ({
  ...await original<typeof import('./parts')>(), SurfaceParts: class {
    constructor(_io: unknown, publish: typeof facts.publish, areaId: string | null) {
      facts.publish = publish;
      facts.areaId = areaId;
    }
    sync() {}
    dispose() {}
  },
}));

const { caseSubscriptions } = await import('../../intake/case-subscription');
const { itemRefreshFor } = await import('../../intake/item-refresh');
const { useSurfaceLayer } = await import('./useSurfaceLayer');

const item = (itemId: string, state: IntakeItem['state']) => ({ itemId, name: `${itemId}.csv`, wave: 1,
  sourceId: itemId, parentItemId: null, family: 'table', state }) as unknown as IntakeItem;
const emit = (itemId?: string) => { for (const consumer of facts.consumers) (consumer as Consumer).refresh(itemId); };
const turn = () => new Promise((resolve) => setTimeout(resolve, 0));
const AREA = { id: 'area', siteId: 'site' };

function MapLayer() {
  useSurfaceLayer(AREA, null);
  return null;
}

/** The map's layer and a tray consumer (BatchPage's route for a change) open on one batch. */
async function bothOpen(listed: IntakeItem[]) {
  facts.server.clear();
  facts.consumers.clear();
  for (const entry of listed) facts.server.set(entry.itemId, entry);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = createRoot(container() as never);
  await act(async () => view.render(<QueryClientProvider client={client}><MapLayer /></QueryClientProvider>));
  const stopTray = caseSubscriptions.subscribe('case', { refresh: (itemId) => itemRefreshFor(client, 'case')
    .changed(itemId), unsettled: () => true, status: () => {} });
  const items = () => client.getQueryData<IntakeManifest>(['intake', 'case'])?.items;
  await vi.waitFor(() => expect(items()).toHaveLength(listed.length));
  expect(facts.consumers.size).toBe(2);
  facts.manifestFn.mockClear();
  facts.read.mockClear();
  const settled = async () => {
    await vi.waitFor(() => expect(client.isFetching()).toBe(0));
    await turn();
  };
  return { client, items, settled, close: async () => { stopTray(); await act(async () => view.unmount()); } };
}

it('SL1: with the tray and the map open, a change naming a held item reads it once and no manifest', async () => {
  const run = await bothOpen([item('a', 'reading'), item('b', 'reading')]);
  facts.server.set('b', item('b', 'read'));
  await act(async () => emit('b'));
  await vi.waitFor(() => expect(run.items()?.map((entry) => entry.state)).toEqual(['reading', 'read']));
  await run.settled();
  expect(facts.read).toHaveBeenCalledExactlyOnceWith('case', 'b');
  expect(facts.manifestFn).not.toHaveBeenCalled();
  await run.close();
});

it('SL1: with the tray and the map open, a change without an item or with a new item reads the manifest once',
  async () => {
    const run = await bothOpen([item('a', 'reading')]);
    await act(async () => emit());
    await run.settled();
    expect(facts.manifestFn).toHaveBeenCalledOnce();
    facts.server.set('n', item('n', 'probed'));
    await act(async () => emit('n'));
    await vi.waitFor(() => expect(run.items()).toHaveLength(2));
    await run.settled();
    expect(facts.manifestFn).toHaveBeenCalledTimes(2);
    expect(facts.read).not.toHaveBeenCalled();
    await run.close();
  });

it('S9.4c: the files with a part handed to the scene are listed once each; a file switched off is not', async () => {
  facts.server.clear();
  const handed: unknown[] = [];
  const engine = { setSurfaceParts: (parts: unknown) => handed.push(parts) } as never;
  let layer!: ReturnType<typeof useSurfaceLayer>;
  function Layer({ scene }: { scene: never | null }) {
    layer = useSurfaceLayer(AREA, scene);
    return null;
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = createRoot(container() as never);
  const render = (scene: never | null) => view.render(<QueryClientProvider client={client}>
    <Layer scene={scene} /></QueryClientProvider>);
  await act(async () => render(engine));
  expect(layer.drawn).toBe('');
  await act(async () => facts.publish!([{ id: 'a:0' }, { id: 'b:0' }, { id: 'a:1' }], []));
  expect(layer.drawn).toBe('a b');
  await act(async () => layer.show('a', false));
  expect(layer.drawn).toBe('b');
  expect(handed.at(-1)).toEqual([{ id: 'b:0' }]);
  await act(async () => render(null));
  expect(layer.drawn).toBe('');
  await act(async () => view.unmount());
});

it('S9.4d: an own area reads the batch it was opened from and draws only the parts placed in it', async () => {
  facts.server.clear();
  facts.manifestFn.mockClear();
  function Layer() {
    useSurfaceLayer({ id: 'own-area', siteId: 'own-site' }, null, 'case');
    return null;
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = createRoot(container() as never);
  await act(async () => view.render(<QueryClientProvider client={client}><Layer /></QueryClientProvider>));
  await vi.waitFor(() => expect(facts.manifestFn).toHaveBeenCalledTimes(2));
  expect(client.getQueryCache().findAll({ queryKey: ['intake'] }).map((query) => query.queryKey[1]).sort())
    .toEqual(['case', 'far']);
  expect(facts.areaId).toBe('own-area');
  await act(async () => view.unmount());
});
