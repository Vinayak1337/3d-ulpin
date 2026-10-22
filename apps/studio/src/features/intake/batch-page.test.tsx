import { button, container, elements, propsOf, type FakeElement } from './fake-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import captured from '../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import type { IntakeItem, IntakeManifest } from './batch-model';
import { uploadsKey } from './UnfinishedUploads';
import type { UploadEntry, WaitingFile } from './upload-model';

// The page's own sections render as they are; the panels that read the server for themselves are named stand-ins.
const facts = vi.hoisted(() => ({ items: [] as unknown[], uploads: [] as unknown[],
  storage: new Map<string, string>() }));
vi.mock('./batch-queries', async (original) => ({
  ...await original<typeof import('./batch-queries')>(),
  useIntakeManifest: (caseId: string) => useQuery({ queryKey: ['intake', caseId], retry: false,
    queryFn: async () => ({ items: facts.items }) as IntakeManifest }),
  useBatchPackages: () => ({ data: { packages: [] }, error: null }),
}));
vi.mock('./table/queries', async (original) => ({
  ...await original<typeof import('./table/queries')>(), useSourceCase: () => ({ data: undefined, error: null }),
}));
vi.mock('./useBatchStream', () => ({ useBatchStream: () => ({ disconnected: false, error: '', reconnect() {} }) }));
vi.mock('./LayoutQuestion', () => ({ LayoutQuestion: () => <section aria-label="Layout">Layout</section> }));
vi.mock('./ifc/IfcStructure', () => ({ IfcStructure: () => <section aria-label="Structure">Structure</section> }));
vi.mock('./PageImageQuestion', () => ({ PageImageQuestion: () => <section aria-label="Page image">Page</section> }));
vi.mock('./BatchTableSection', () => ({ BatchTableSection: () => <section aria-label="Table">Table</section> }));
vi.mock('./evidence/EvidenceByKey', () => ({ EvidenceByKey: () => <section aria-label="Evidence">Evidence</section> }));
vi.mock('./run', () => ({ IntakeRunPanel: () => <p>Recording</p> }));
vi.mock('./upload-api', () => ({
  listUploads: async () => ({ uploads: facts.uploads }), enrolSource: vi.fn(async () => undefined),
  uploadTransport: () => ({}),
}));
vi.mock('./upload-command', () => ({
  createUploadCommand: () => ({ run: async () => '04000000-0000-4000-8000-0000000000a1', cancel() {}, retry() {} }),
  abortReceipt: vi.fn(async () => undefined), cleanupReceipt: vi.fn(async () => undefined),
}));

const { BatchPage } = await import('./BatchPage');
const caseId = '04000000-0000-4000-8000-000000000001';
const waitingKey = `ulpin.batch-waiting.${caseId}`;
const first = captured.manifest.items[0] as unknown as IntakeItem;
const second = { ...first, itemId: '04000000-0000-4000-8000-000000000003', name: 'second-copy.geojson' };
const receipt = (id: string, filename: string, bytes: number): UploadEntry => ({ id, filename, bytes,
  sha256: 'a'.repeat(64), profile: 'large-original/1', state: 'receiving', receivedParts: 2, partCount: 4,
  expiresAt: '2026-10-22T00:00:00.000Z', revision: 9, currentCaseRevision: 3 });
let errors: MockInstance<typeof console.error>;

beforeEach(() => {
  facts.storage.clear();
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => facts.storage.get(key) ?? null,
    setItem: (key: string, value: string) => facts.storage.set(key, value),
    removeItem: (key: string) => facts.storage.delete(key) });
  errors = vi.spyOn(console, 'error');
});
afterEach(() => {
  vi.unstubAllGlobals();
  errors.mockRestore();
});

async function renderBatch(waiting: WaitingFile[]) {
  if (waiting.length) facts.storage.set(waitingKey, JSON.stringify(waiting));
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(['intake', caseId], { items: facts.items });
  client.setQueryData(uploadsKey(caseId), { uploads: facts.uploads });
  const root = container();
  const view = createRoot(root as never);
  const router = createMemoryRouter([{ path: '/studio/work/cases/:caseId/intake', element: <BatchPage /> }],
    { initialEntries: [`/studio/work/cases/${caseId}/intake`] });
  await act(async () => view.render(<QueryClientProvider client={client}>
    <RouterProvider router={router} />
  </QueryClientProvider>));
  return { root, client, unmount: () => act(async () => view.unmount()) };
}

const press = (node: FakeElement) => act(async () => { await propsOf(node).onClick?.({}); });
const buttons = (root: FakeElement, words: string) => elements(root)
  .filter((node) => node.tagName === 'BUTTON' && node.textContent === words);
// Only the words: a failing comparison must not print React's internals.
const keyWarnings = () => errors.mock.calls.map((call) => String(call[0]))
  .filter((words) => /\bkey\b/.test(words));
const notice = (root: FakeElement) => elements(root)
  .find((node) => node.getAttribute('aria-label') === 'Files waiting before the reload');

it('D1: the batch with several items, an item open and waiting words shows no React key warning', async () => {
  facts.items = [first, second];
  facts.uploads = [];
  const twice = { name: 'refused.geojson', sizeBytes: 2_048, words: 'The server refused this file.' };
  const page = await renderBatch([twice, { ...twice }, { name: 'later.csv', sizeBytes: 1_024, words: null }]);
  await press(buttons(page.root, 'View layout')[0]!);
  const sections = elements(page.root).map((node) => node.getAttribute('aria-label'));
  // The open item has its layout and table sections side by side: before D1 both carried the item id as key.
  expect(sections).toEqual(expect.arrayContaining(['Files in this batch', 'Layout', 'Table', 'Evidence',
    'Files waiting before the reload']));
  expect(elements(page.root).filter((node) => node.tagName === 'LI' && node.textContent.includes('refused.geojson')))
    .toHaveLength(2);
  await press(buttons(page.root, 'View layout')[1]!);
  expect(keyWarnings()).toEqual([]);
  await page.unmount();
});

it('D2: after a reload the notice drops each file once resumed and finished, cancelled, or in the batch', async () => {
  facts.items = [first];
  const resumed = receipt('04000000-0000-4000-8000-0000000000b1', 'resumed.geojson', 26_660_992);
  const cancelled = receipt('04000000-0000-4000-8000-0000000000b2', 'cancelled.tif', 40_000_000);
  facts.uploads = [resumed, cancelled];
  const page = await renderBatch([{ name: resumed.filename, sizeBytes: resumed.bytes, words: null },
    { name: cancelled.filename, sizeBytes: cancelled.bytes, words: 'Upload cancelled.' },
    { name: 'picked-again.geojson', sizeBytes: 5_000, words: null }]);
  expect(notice(page.root)?.textContent).toContain('resumed.geojson, cancelled.tif, picked-again.geojson.');

  const input = elements(page.root).find((node) => node.tagName === 'INPUT')!;
  facts.uploads = [cancelled];
  await act(async () => {
    await propsOf(input).onChange?.({ target: { files: [new File(['x'], resumed.filename)], value: '' } });
  });
  expect(notice(page.root)?.textContent).toContain('waiting when the page reloaded: cancelled.tif, picked-again');
  expect(facts.storage.get(waitingKey)).not.toContain('resumed.geojson');

  const cancel = elements(page.root)
    .find((node) => node.getAttribute('aria-label') === `Cancel upload of ${cancelled.filename}`)!;
  facts.uploads = [];
  await press(cancel);
  expect(notice(page.root)?.textContent).toContain('waiting when the page reloaded: picked-again.geojson.');

  // Picked again through Add files: once its item is in the batch, nothing is left waiting.
  facts.items = [first, { ...second, name: 'picked-again.geojson', sizeBytes: 5_000 }];
  await act(async () => { await page.client.invalidateQueries({ queryKey: ['intake', caseId] }); });
  // The query client tells its observers on the next task.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(notice(page.root)?.textContent).toBeUndefined();
  expect(facts.storage.has(waitingKey)).toBe(false);
  expect(keyWarnings()).toEqual([]);
  await page.unmount();
});

it('D2: Dismiss still clears the words at once', async () => {
  facts.items = [first];
  facts.uploads = [];
  const page = await renderBatch([{ name: 'later.csv', sizeBytes: 1_024, words: null }]);
  expect(notice(page.root)?.textContent).toContain('later.csv');
  await press(button(page.root, 'Dismiss'));
  expect(notice(page.root)?.textContent).toBeUndefined();
  expect(facts.storage.has(waitingKey)).toBe(false);
  await page.unmount();
});
