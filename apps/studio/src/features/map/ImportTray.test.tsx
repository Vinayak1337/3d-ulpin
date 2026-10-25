import { container } from '../intake/fake-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, environmentManager } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { formatCount } from '@ulpin/ui';
import nyc from '../../local/data/nyc-bronx-context.json';
import { queryKeys, type AreaContext } from '../../api/queries';

// The workspace stands in with only its import lines: the package in the URL, the canonical read while it
// streams, and the tray. The scene, sidebar and inspectors are not part of what the map reads while it streams.
vi.mock('./MapWorkspace', async () => {
  const { useSearchParams } = await import('react-router');
  const { packageStreaming } = await import('../../api/queries');
  const { useCanonicalFootprints } = await import('./canonicalScene');
  const { ImportTray } = await import('./ImportTray');
  return {
    MapWorkspace: function ImportLines({ context, contextFresh }: { context: AreaContext; contextFresh: boolean }) {
      const packageId = useSearchParams()[0].get('package');
      const importStreaming = packageId !== null && packageStreaming(context, packageId, contextFresh);
      useCanonicalFootprints(context.area.id, null, context.displayFeatures, importStreaming);
      return packageId
        ? <ImportTray packageId={packageId} context={context} contextFresh={contextFresh} onClose={() => undefined} />
        : null;
    },
  };
});
vi.mock('./WindowedArea', () => ({ WindowedArea: () => null }));
// Demo imports are switched on by the build; here an id is a demo id by its prefix alone, as in a demo build.
vi.mock('../../api/demo-import', async (original) => ({
  ...await original<typeof import('../../api/demo-import')>(),
  isDemoId: (id: string | null | undefined) => Boolean(id?.startsWith('d30d')),
}));

const { MapPage } = await import('./MapPage');
const { ImportTray } = await import('./ImportTray');

const SECOND = 1000;
// A test-only package id. The features it proposes are the real NYC footprints (foreign test_only source
// derivatives kept in the repository), shown as that package's unrecorded proposals; no record is invented.
const PACKAGE = '05000000-0000-4000-8000-000000000001';
const areaId = nyc.area.id;
const shown = nyc.features.map(({ sourceGeometry: _s, geographicGeometry: _g, sourceReference: _r, ...feature }) => feature);
const buildings = nyc.features.filter((feature) => feature.kind === 'building').length;

/** The API as the map sees it, counting each read; the package state is the test's to move. `listed: false` is an
 * older package, beyond the newest ones the area context lists; `gate` holds every context answer until it resolves. */
function countingApi({ listed = true, gate = Promise.resolve() } = {}) {
  const reads = { context: 0, canonical: 0, package: 0, other: [] as string[] };
  let state = 'RECEIVED';
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(input instanceof Request ? input.url : String(input), 'http://localhost').pathname;
    const proposals = state === 'COMMITTED'
      ? shown
      : shown.map((feature) => ({ ...feature, displayState: 'unrecorded_proposal', proposalPackageId: PACKAGE }));
    if (path === `/api/v1/areas/${areaId}/context`) {
      reads.context++;
      await gate;
      return json({ ...nyc, features: undefined, displayFeatures: proposals,
        packages: listed ? [{ id: PACKAGE, state, quarantine: null }] : [] });
    }
    if (path === `/api/v1/areas/${areaId}/canonical`) {
      reads.canonical++;
      return json({ schemaVersion: 'normalized-building/1', revisionId: 'test', frame: { areaId },
        buildings: [], baseFeatures: [], overlays: [], tilesets: [], gaps: [] });
    }
    if (path === `/api/v1/import-packages/${PACKAGE}`) {
      reads.package++;
      return json({ id: PACKAGE, areaId, name: nyc.area.name, state, revision: 1, features: shown, warnings: [] });
    }
    reads.other.push(path);
    return new Response(null, { status: 404 });
  });
  return { reads, fetch, settle: (next: string) => { state = next; } };
}

let client: QueryClient;
let stop: () => void;
beforeEach(() => {
  // Tests run in Node, where React Query schedules no timers; the Studio runs in a browser.
  environmentManager.setIsServer(() => false);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  act(() => stop());
  client.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  environmentManager.setIsServer(() => true);
});

async function wait(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

/** The map page opened on the package, as the Batches list and the upload dialog open it. */
async function openMap() {
  const root = container();
  const router = createMemoryRouter([{ path: '/studio/areas/:areaId', element: <MapPage /> }],
    { initialEntries: [`/studio/areas/${areaId}?package=${PACKAGE}`] });
  const react = createRoot(root as unknown as HTMLElement);
  stop = () => react.unmount();
  await act(async () => react.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>));
  return root;
}

it('reads the streaming package from the area context alone, and stops reading once it settles', async () => {
  const api = countingApi();
  vi.stubGlobal('fetch', api.fetch);
  const root = await openMap();

  await wait(30 * SECOND);
  expect(api.reads.package).toBe(0);
  expect(api.reads.context).toBeGreaterThan(1);
  expect(api.reads.context).toBeLessThanOrEqual(7);
  expect(api.reads.canonical).toBeLessThanOrEqual(7);
  expect(root.textContent).toContain(`Importing into ${nyc.area.name}`);
  expect(root.textContent).toContain(`${formatCount(buildings)} buildings accepted for review`);
  expect(root.textContent).toContain(`${formatCount(buildings)} features`);

  // The next area read reports the package recorded. That read is the context's last; the canonical area is read
  // once more for the records saved after its last read, and the tray reads the package once for its name.
  const streaming = { ...api.reads };
  api.settle('COMMITTED');
  await wait(6 * SECOND);
  expect(root.textContent).toContain(`Imported ${nyc.area.name}`);
  expect(root.textContent).toContain(`${formatCount(buildings)} buildings recorded`);
  expect(api.reads.context).toBe(streaming.context + 1);
  expect(api.reads.canonical).toBe(streaming.canonical + 2);
  expect(api.reads.package).toBe(1);
  const settled = { ...api.reads };
  await wait(30 * SECOND);
  expect(api.reads.context).toBe(settled.context);
  expect(api.reads.canonical).toBe(settled.canonical);
  expect(api.reads.package).toBe(1);
  expect(api.reads.other).toEqual([]);
});

it('opens a package over an area read cached from before it existed as streaming, and reads the area afresh', async () => {
  let release!: () => void;
  const api = countingApi({ gate: new Promise<void>((done) => { release = done; }) });
  vi.stubGlobal('fetch', api.fetch);
  // The area as read two minutes before the package was opened: it does not list the package yet.
  client.setQueryData(queryKeys.areaContext(areaId), { ...nyc, features: undefined, displayFeatures: shown, packages: [] },
    { updatedAt: Date.now() - 120 * SECOND });
  const root = await openMap();
  expect(api.reads).toEqual({ context: 1, canonical: 1, package: 0, other: [] });
  expect(root.textContent).toContain(`Importing into ${nyc.area.name}`);
  expect(root.textContent).not.toContain('Done');

  // The fresh read lists the package as RECEIVED: the streaming counts hold from here.
  release();
  await wait(30 * SECOND);
  expect(api.reads.package).toBe(0);
  expect(api.reads.context).toBeLessThanOrEqual(7);
  expect(root.textContent).toContain(`${formatCount(buildings)} buildings accepted for review`);
  expect(root.textContent).not.toContain('Done');
});

it('opens an older package, which the area no longer lists, as settled: read once, never polled', async () => {
  const api = countingApi({ listed: false });
  api.settle('COMMITTED');
  vi.stubGlobal('fetch', api.fetch);
  const root = await openMap();
  await wait(30 * SECOND);
  expect(api.reads).toEqual({ context: 1, canonical: 1, package: 1, other: [] });
  expect(root.textContent).toContain(`Imported ${nyc.area.name}`);
  expect(root.textContent).toContain(`${formatCount(buildings)} buildings recorded`);
});

it('keeps the demo import reading its own stream, with no API read', async () => {
  const api = countingApi();
  vi.stubGlobal('fetch', api.fetch);
  // A test-only demo package id; the stream sends the package summary and its features, as the demo adapter does.
  const demoPackage = 'd30d0000-0000-4000-8000-000000000002';
  const summary = (state: string) => ({ id: demoPackage, areaId, name: nyc.area.name, revision: 0, state,
    features: shown.map(({ id, kind }) => ({ id, kind })), warnings: [], quarantine: null });
  const context = (state: string) => ({ ...nyc, features: undefined, displayFeatures: shown,
    packages: [summary(state)] }) as unknown as AreaContext;
  const root = container();
  const react = createRoot(root as unknown as HTMLElement);
  stop = () => react.unmount();
  const show = async (state: string) => {
    client.setQueryData(queryKeys.importPackage(demoPackage), summary(state));
    await act(async () => react.render(<QueryClientProvider client={client}>
      <ImportTray packageId={demoPackage} context={context(state)} drawnBuildings={buildings} onClose={() => undefined} />
    </QueryClientProvider>));
  };

  await show('RECEIVED');
  await wait(30 * SECOND);
  expect(root.textContent).toContain(`Importing ${nyc.area.name}`);
  expect(root.textContent).toContain(`${formatCount(shown.length)} features received · ${formatCount(buildings)} buildings drawn`);
  await show('READY_FOR_REVIEW');
  await wait(30 * SECOND);
  expect(root.textContent).toContain(`Imported ${nyc.area.name}`);
  expect(root.textContent).toContain(`${formatCount(buildings)} buildings accepted for review`);
  expect(api.fetch).not.toHaveBeenCalled();
});
