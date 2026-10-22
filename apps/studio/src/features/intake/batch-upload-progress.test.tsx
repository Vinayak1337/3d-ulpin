import { button, container, elements, propsOf } from './fake-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '@ulpin/api-client';
import published from '../../../../../docs/api/openapi.json';
import type { PartRequest, UploadTransport } from './upload-api';
import type { UploadLimits, UploadReceipt } from './upload-model';
import { batchUploadKey, useRetainBatch, type BatchUpload } from './useRetainBatch';

const facts = vi.hoisted(() => ({ transport: null as UploadTransport | null }));
vi.mock('./upload-api', () => ({
  uploadTransport: () => facts.transport!, listUploads: async () => ({ uploads: [] }),
}));
vi.mock('./hash-file', () => ({ hashFile: async () => 'a'.repeat(64) }));
vi.mock('./batch-queries', () => ({
  useIntakeManifest: () => ({ data: { items: [] }, isPending: false, error: null }),
  useBatchPackages: () => ({ data: { packages: [] }, error: null }),
  recipeKey: (id: string) => ['intake', id, 'recipe'],
}));
vi.mock('./table/queries', async original => ({
  ...await original<typeof import('./table/queries')>(), useSourceCase: () => ({ data: undefined, error: null }),
}));
vi.mock('./useBatchStream', () => ({ useBatchStream: () => ({ disconnected: false }) }));
vi.mock('./run', () => ({ IntakeRunPanel: () => <p>Recording still needs confirmation.</p> }));

const { BatchPage } = await import('./BatchPage');
const caseId = '04000000-0000-4000-8000-000000000001';
const schema = published.components.schemas.GET_ingestion_upload_limits_Response_200_application_json;
const enumValues = (properties: object) => Object.fromEntries(Object.entries(properties)
  .map(([key, value]) => [key, (value as { enum: unknown[] }).enum[0]]));
const limits = { limits: enumValues(schema.properties.limits.properties), largeProfile: {
  limits: enumValues(schema.properties.largeProfile.properties.limits.properties),
} } as unknown as UploadLimits;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function transportState() {
  return { firstStarted: deferred(), releaseFirst: deferred(), secondStarted: deferred(), releaseSecond: deferred(),
    calls: [] as string[], fileNumber: 0, refused: false, receipts: new Map<string, UploadReceipt>() };
}
type TransportState = ReturnType<typeof transportState>;

async function sendPart(state: TransportState, id: string, part: PartRequest) {
  state.calls.push(`part ${id}:${part.number}`);
  if (id === '1') {
    state.firstStarted.resolve();
    await state.releaseFirst.promise;
  }
  if (id === '2' && part.number === 2 && !state.refused) {
    state.secondStarted.resolve();
    await state.releaseSecond.promise;
    state.refused = true;
    throw new ApiError(422, '', { error: { message: 'Part refused for the transport check.' } });
  }
  const stored = state.receipts.get(id)!;
  const next = { ...stored, revision: stored.revision + 1, receivedBytes: stored.receivedBytes + part.bytes.size };
  state.receipts.set(id, next);
  return next;
}

function transport() {
  const state = transportState();
  const value: UploadTransport = {
    limits: async () => limits, revision: async () => 3,
    create: async body => {
      state.fileNumber++;
      state.calls.push(`create ${body.filename}`);
      const receipt = { id: String(state.fileNumber), revision: 1, currentCaseRevision: 3,
        state: 'receiving', receivedBytes: 0, parts: [] } as unknown as UploadReceipt;
      state.receipts.set(receipt.id, receipt);
      return receipt;
    },
    status: async entry => state.receipts.get(entry.id)!,
    part: async (receipt, part) => sendPart(state, receipt.id, part),
    finalize: async receipt => {
      state.calls.push(`finalize ${receipt.id}`);
      return { ...receipt, state: 'retained', source: { sourceId: `source-${receipt.id}` } } as UploadReceipt;
    },
    abort: async receipt => ({ ...state.receipts.get(receipt.id)!, state: 'aborted' }),
    cleanup: async receipt => state.receipts.get(receipt.id)!,
  };
  return { ...state, value };
}

// Transport-only controls: their bytes do not stand for documents or geometry.
const files = [new File(['upload control'], 'first.pdf'),
  new File([new Uint8Array(16 * 1024 ** 2 + 1)], 'second.tif')];

function Drop() {
  const upload = useRetainBatch(files, [], 'existing', caseId, '', () => undefined, true);
  return <button onClick={() => upload.retain()}>Retain files and open batch</button>;
}

async function openDrop(run: ReturnType<typeof transport>) {
  facts.transport = run.value;
  const storage = new Map<string, string>();
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key) });
  vi.stubGlobal('fetch', async (request: Request) => {
    if (request.method === 'GET') return Response.json({ case: { id: caseId, revision: 3, archived: false } });
    const body = await request.json() as { sourceId: string };
    run.calls.push(`enrol ${body.sourceId}`);
    return Response.json({});
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/drop', element: <Drop /> },
    { path: '/studio/work/cases/:caseId/intake', element: <BatchPage /> }], { initialEntries: ['/drop'] });
  const root = container();
  const view = createRoot(root as never);
  await act(async () => view.render(<QueryClientProvider client={client}>
    <RouterProvider router={router} />
  </QueryClientProvider>));
  return { root, client, router, storage, close: async () => {
    await act(async () => view.unmount());
    client.clear();
    router.dispose();
  } };
}

const flush = () => act(() => new Promise(resolve => setTimeout(resolve, 0)));
afterEach(() => vi.unstubAllGlobals());

it('opens the batch before retention and shows bytes and parts while a second file is still uploading', async () => {
  const run = transport();
  const page = await openDrop(run);
  await act(async () => {
    await propsOf(button(page.root, 'Retain files and open batch')).onClick?.();
    await run.firstStarted.promise;
  });
  expect(page.router.state.location.pathname).toBe(`/studio/work/cases/${caseId}/intake`);
  expect(elements(page.root).some(node => node.tagName === 'H1' && node.textContent === 'Batch')).toBe(true);
  expect(run.calls).toEqual(['create first.pdf', 'part 1:1']);
  expect([...page.storage.values()].join()).toContain('second.tif');
  await act(async () => {
    run.releaseFirst.resolve();
    await run.secondStarted.promise;
  });
  await flush();
  expect(page.root.textContent).toContain('File 2 of 2: second.tif');
  expect(page.root.textContent).toContain('83,88,608 of 1,67,77,217 bytes; part 2 of 3');
  expect(page.client.getQueryData<BatchUpload>(batchUploadKey(caseId))?.rows[0]?.state).toBe('enrolled');
  expect(run.calls).not.toContain('finalize 2');
  await retryOnBatch(page, run);
  await page.close();
});

async function retryOnBatch(page: Awaited<ReturnType<typeof openDrop>>, run: ReturnType<typeof transport>) {
  await act(async () => { run.releaseSecond.resolve(); });
  await flush();
  expect(page.root.textContent).toContain('Part refused for the transport check.');
  expect([...page.storage.values()].join()).not.toContain('first.pdf');
  expect(button(page.root, 'Cancel upload').textContent).toBe('Cancel upload');
  await act(async () => { await propsOf(button(page.root, 'Try again')).onClick?.(); });
  await act(async () => {
    await vi.waitFor(() => expect(page.client.getQueryData<BatchUpload>(batchUploadKey(caseId))?.pending).toBe(false));
  });
  expect(run.calls).toEqual(['create first.pdf', 'part 1:1', 'finalize 1', 'enrol source-1',
    'create second.tif', 'part 2:1', 'part 2:2', 'part 2:2', 'part 2:3', 'finalize 2', 'enrol source-2']);
  expect(page.storage.size).toBe(0);
}
