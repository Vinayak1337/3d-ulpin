import { button, container, elements, propsOf, type FakeElement } from './fake-dom';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import captured from '../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import targets from '../../../../../docs/evidence/gf1/e3b/targets.json';
import type { Package } from './run/model';
import type { IntakeItem, IntakeManifest } from './batch-model';
import { uploadsKey } from './UnfinishedUploads';
import styles from './Batch.module.css';
import { batchUploadKey, type BatchUpload } from './useRetainBatch';
import type { UploadEntry, WaitingFile } from './upload-model';

// The page's own sections render as they are; the panels that read the server for themselves are named stand-ins.
const facts = vi.hoisted(() => ({ items: [] as unknown[], uploads: [] as unknown[], packages: [] as Package[],
  storage: new Map<string, string>() }));
vi.mock('./batch-queries', async (original) => ({
  ...await original<typeof import('./batch-queries')>(),
  useIntakeManifest: (caseId: string) => useQuery({ queryKey: ['intake', caseId], retry: false,
    queryFn: async () => ({ items: facts.items }) as IntakeManifest }),
  useBatchPackages: () => ({ data: { ...targets, packages: facts.packages }, error: null }),
  readIntakeReading: vi.fn(async () => ({ version: 'intake-reading/1',
    what: { words: 'A kept map file.', basis: 'reader' }, holds: [], fields: [],
    drawing: { as: 'none', words: 'Not drawn yet.', basis: 'reader' }, links: [], question: null })),
}));
vi.mock('./table/queries', async (original) => ({
  ...await original<typeof import('./table/queries')>(), useSourceCase: () => ({ data: undefined, error: null }),
  useTableProfile: () => ({ data: undefined, isPending: false }),
}));
vi.mock('./useBatchStream', () => ({ useBatchStream: () => ({ disconnected: false, error: '', reconnect() {} }) }));
vi.mock('./LayoutQuestion', () => ({ LayoutQuestion: ({ item }: { item: IntakeItem }) =>
  <section id={`intake-layout-${item.itemId}`} aria-label="Layout">Layout</section> }));
vi.mock('./ifc/IfcStructure', () => ({ IfcStructure: () => <section aria-label="Structure">Structure</section> }));
vi.mock('./PageImageQuestion', () => ({ PageImageQuestion: () => <section aria-label="Page image">Page</section> }));
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
const first = { ...captured.manifest.items[0], archiveItemId: null,
  layoutQuestion: true } as unknown as IntakeItem;
const second = { ...first, itemId: '04000000-0000-4000-8000-000000000003', name: 'second-copy.geojson' };
const receipt = (id: string, filename: string, bytes: number): UploadEntry => ({ id, filename, bytes,
  sha256: 'a'.repeat(64), profile: 'large-original/1', state: 'receiving', receivedParts: 2, partCount: 4,
  expiresAt: '2026-10-22T00:00:00.000Z', revision: 9, currentCaseRevision: 3 });
let errors: MockInstance<typeof console.error>;

beforeEach(() => {
  facts.packages = [];
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

async function renderBatch(waiting: WaitingFile[], upload?: BatchUpload, search = '') {
  if (waiting.length) facts.storage.set(waitingKey, JSON.stringify(waiting));
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(['intake', caseId], { items: facts.items });
  client.setQueryData(uploadsKey(caseId), { uploads: facts.uploads });
  if (upload) client.setQueryData(batchUploadKey(caseId), upload);
  const root = container();
  const view = createRoot(root as never);
  const router = createMemoryRouter([{ path: '/studio/work/cases/:caseId/intake', element: <BatchPage /> }],
    { initialEntries: [`/studio/work/cases/${caseId}/intake${search}`] });
  await act(async () => view.render(<QueryClientProvider client={client}>
    <RouterProvider router={router} />
  </QueryClientProvider>));
  await act(() => new Promise(resolve => setTimeout(resolve, 20)));
  return { root, client, router, unmount: () => act(async () => view.unmount()) };
}

const press = (node: FakeElement) => act(async () => { await propsOf(node).onClick?.({}); });
const buttons = (root: FakeElement, words: string) => elements(root)
  .filter((node) => node.tagName === 'BUTTON' && node.textContent === words);
// Only the words: a failing comparison must not print React's internals.
const keyWarnings = () => errors.mock.calls.map((call) => String(call[0]))
  .filter((words) => /\bkey\b/.test(words));
const notice = (root: FakeElement) => elements(root)
  .find((node) => node.getAttribute('aria-label') === 'Files waiting before the reload');

it.each(['package', 'existing area', 'neither'] as const)('S7.9: the header opens the map for %s', async kind => {
  const pkg = targets.packages[0]! as Package;
  facts.items = [{ ...first, existingAreaId: kind === 'neither' ? null : pkg.areaId }];
  facts.uploads = [];
  if (kind === 'package') facts.packages = [{ ...pkg, areaId: '' }, pkg];
  const page = await renderBatch([]);
  const header = elements(page.root).find(node => node.tagName === 'HEADER')!;
  const links = elements(header).filter(node => node.tagName === 'A' && node.textContent === 'Open on the map');
  expect(links).toHaveLength(kind === 'neither' ? 0 : 1);
  if (links.length) expect(links[0]!.getAttribute('href')).toBe(`/studio/areas/${pkg.areaId}${
    kind === 'package' ? `?package=${pkg.packageId}` : ''}`);
  expect(buttons(header, 'Add files to batch')).toHaveLength(1);
  await page.unmount();
});

it('D1: the batch with several items, an item open and waiting words shows no React key warning', async () => {
  facts.items = [first, second];
  facts.uploads = [];
  const twice = { name: 'refused.geojson', sizeBytes: 2_048, words: 'The server refused this file.' };
  const page = await renderBatch([twice, { ...twice }, { name: 'later.csv', sizeBytes: 1_024, words: null }]);
  await press(buttons(page.root, 'View layout')[0]!);
  await act(() => new Promise(resolve => setTimeout(resolve, 20)));
  const sections = elements(page.root).map((node) => node.getAttribute('aria-label'));
  expect(sections).toContain(`Reading for ${first.name}`);
  expect(sections.indexOf(`Reading for ${first.name}`)).toBeLessThan(sections.indexOf('Layout'));
  expect(page.root.textContent).toContain('A kept map file.');
  // Before D1, the layout and table section components both carried the item id as key.
  expect(sections).toEqual(expect.arrayContaining(['Files in this batch', 'Layout', 'Evidence',
    'Files waiting before the reload']));
  expect(elements(page.root).filter((node) => node.tagName === 'LI' && node.textContent.includes('refused.geojson')))
    .toHaveLength(2);
  await press(buttons(page.root, 'View layout')[1]!);
  expect(keyWarnings()).toEqual([]);
  await page.unmount();
});

it('S7.17: the planned item without a plan opens its layout from Needs you and focuses it', async () => {
  const pending = { ...first, state: 'planned', placement: 'needs_answer', plan: null } as IntakeItem;
  facts.items = [pending, second];
  facts.uploads = [];
  const page = await renderBatch([]);
  vi.stubGlobal('document', Object.assign(Object.create(document), {
    getElementById: (id: string) => elements(page.root).find(node => node.getAttribute('id') === id) ?? null,
  }));
  const needs = elements(page.root).find(node => node.getAttribute('aria-label') === 'Needs you')!;
  const label = `Answer the layout of ${pending.name}`;
  expect(buttons(needs, label)).toHaveLength(1);
  await press(button(needs, label));
  expect(document.activeElement?.getAttribute('id')).toBe(`intake-layout-${pending.itemId}`);
  expect(new URLSearchParams(page.router.state.location.search).get('item')).toBe(pending.itemId);
  expect(elements(page.root).filter(node => node.getAttribute('aria-current') === 'step')).toHaveLength(1);
  await page.unmount();
});

it('S7.3: while an upload is pending and the manifest is empty, the files are said to be kept', async () => {
  facts.items = [];
  facts.uploads = [];
  const row = { name: 'first.pdf', sizeBytes: 12, state: 'retaining' } as BatchUpload['rows'][number];
  const upload = { rows: [row], pending: true, remaining: [], error: null };
  const pending = await renderBatch([], upload);
  expect(pending.root.textContent).toContain('The dropped files are being kept');
  expect(pending.root.textContent).not.toContain('No files are enrolled');
  await pending.unmount();
  const idle = await renderBatch([], { ...upload, pending: false });
  expect(idle.root.textContent).toContain('No files are enrolled in this batch.');
  await idle.unmount();
});

// test_only cards around real development files; no probe or ingestion result is asserted here.
function tableItem(format: 'csv' | 'xlsx'): IntakeItem {
  const name = format === 'csv' ? 'mi-d10-02.csv' : 'mi-d19-01.xlsx';
  const bytes = readFileSync(new URL(`../../../../../fixtures/usp/D8-messy-india/dev/d1b/${name}`, import.meta.url));
  return { ...second, sourceId: second.itemId, name, family: 'table', format, sizeBytes: bytes.length,
    cardSha256: null, plan: null, placement: 'undecided', limitReason: null,
    card: { ...first.card!, family: 'table', format, columns: [], geometryTypes: [], layers: [],
      crs: { state: 'not_applicable', code: null, sidecarSha256: null },
      extent: { native: null, epsg4326: null }, encoding: null, delimiter: format === 'csv' ? ',' : null,
      counts: { features: null, rows: null, pages: null, members: null, points: null, bands: null },
      citations: [], limits: [], probeBytesRead: 0, probeMs: 0,
      sheets: format === 'xlsx' ? [{ name: 'T_18', count: null }] : [] } };
}

it.each(['csv', 'xlsx'] as const)('TS2: a map + unread %s batch opens the table without reading it', async (format) => {
  const table = tableItem(format);
  facts.items = [first, table];
  facts.uploads = [];
  const requests = vi.fn();
  vi.stubGlobal('fetch', requests);
  const page = await renderBatch([]);
  try {
    expect(buttons(page.root, 'Read as a table')).toHaveLength(0);
    const row = elements(page.root).find((node) => node.tagName === 'TR' && node.textContent.includes(table.name))!;
    const open = buttons(row, 'Open the table');
    expect(open).toHaveLength(1);
    expect(buttons(page.root, 'Open the table')).toHaveLength(1);
    expect(open[0]!.getAttribute('aria-label')).toBe(`Open the table: ${table.name}`);
    expect(open[0]!.getAttribute('type')).toBe('button');
    expect(open[0]!.getAttribute('disabled')).toBeNull();
    await press(open[0]!);
    expect(elements(page.root).some((node) => node.getAttribute('aria-label') === `Table in ${table.name}`))
      .toBe(true);
    expect(buttons(page.root, 'Read as a table')).toHaveLength(1);
    if (format === 'xlsx') {
      const headers = elements(page.root).find((node) => node.getAttribute('aria-label') === 'Header row numbers')!;
      expect(propsOf(headers).value).toBe('');
      expect(page.root.textContent).toContain('T_18');
    }
    expect(requests).not.toHaveBeenCalled();
  } finally {
    await page.unmount();
  }
});

it('PDF1: a PDF reading opens from its file row without a separate PDF readings nav', async () => {
  const pdf = { ...second, sourceId: second.itemId, name: 'scanned-plan.pdf', format: 'pdf',
    family: 'document', state: 'read', plan: null } as IntakeItem;
  facts.items = [first, pdf];
  facts.uploads = [];
  const page = await renderBatch([]);
  try {
    expect(elements(page.root).some(node => node.getAttribute('aria-label') === `PDF reading in ${pdf.name}`))
      .toBe(false);
    expect(elements(page.root).some(node => node.getAttribute('aria-label') === 'PDF readings')).toBe(false);
    await press(button(page.root, pdf.name));
    expect(elements(page.root).some(node => node.getAttribute('aria-label') === `PDF reading in ${pdf.name}`))
      .toBe(true);
    expect(keyWarnings()).toEqual([]);
  } finally { await page.unmount(); }
});

it('S7.11: choosing a file opens one adjacent reading and replaces only the item search parameter', async () => {
  facts.items = [first, second];
  facts.uploads = [];
  const page = await renderBatch([], undefined, '?keep=files');
  const reading = () => elements(page.root).find(node => node.getAttribute('id') === 'intake-reading')!;
  expect(reading().textContent).toBe('');
  expect(reading().childNodes).toHaveLength(0);
  await press(button(page.root, second.name));
  await act(() => new Promise(resolve => setTimeout(resolve, 20)));
  expect(elements(reading()).some(node => node.getAttribute('aria-label') === `Reading for ${second.name}`))
    .toBe(true);
  expect(new URLSearchParams(page.router.state.location.search).get('item')).toBe(second.itemId);
  expect(new URLSearchParams(page.router.state.location.search).get('keep')).toBe('files');
  expect(page.router.state.historyAction).toBe('REPLACE');
  expect(button(page.root, second.name).getAttribute('aria-current')).toBe('true');
  const row = elements(page.root).find(node => node.tagName === 'TR' && node.textContent.includes(second.name))!;
  expect(row.getAttribute('aria-selected')).toBe('true');
  await press(button(page.root, first.name));
  await act(() => new Promise(resolve => setTimeout(resolve, 20)));
  expect(elements(reading()).filter(node => node.getAttribute('aria-label')?.startsWith('Reading for ')))
    .toHaveLength(1);
  expect(button(page.root, second.name).getAttribute('aria-current')).toBeNull();
  expect(page.router.state.historyAction).toBe('REPLACE');
  const sections = elements(page.root).map(node => node.getAttribute('id'));
  expect(sections.indexOf('intake-files')).toBeLessThan(sections.indexOf('intake-reading'));
  expect(sections.indexOf('intake-reading')).toBeLessThan(sections.indexOf('intake-run-panel'));
  await page.unmount();
});

it.each(['link', 'next step'])('S7.12: a member opens the same reading from its %s', async from => {
  const archive = { ...first, name: 'layers.zip', family: 'archive', format: 'zip' } as IntakeItem;
  const members = Array.from({ length: 12 }, (_, index) => ({ ...second,
    itemId: `04000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`,
    name: `member-${index}.geojson`, archiveItemId: archive.itemId, layoutQuestion: from === 'next step' }));
  const member = members[0]!;
  facts.items = [archive, ...members];
  facts.uploads = [];
  const page = await renderBatch([], undefined, from === 'link' ? `?item=${member.itemId}` : '');
  if (from === 'next step') {
    const row = elements(page.root).find(node => node.tagName === 'TR' && node.textContent.includes(member.name))!;
    await press(button(row, 'View layout'));
  }
  await act(() => new Promise(resolve => setTimeout(resolve, 20)));
  expect(button(page.root, member.name).getAttribute('aria-current')).toBe('true');
  expect(new URLSearchParams(page.router.state.location.search).get('item')).toBe(member.itemId);
  expect(elements(page.root).some(node => node.getAttribute('aria-label') === `Reading for ${member.name}`))
    .toBe(true);
  expect(elements(page.root).find(node => node.getAttribute('aria-expanded'))?.getAttribute('aria-expanded'))
    .toBe('true');
  await page.unmount();
});

it('S7.11: a URL selection survives a fresh render and a removed item falls back to the single file', async () => {
  facts.items = [first, second];
  facts.uploads = [];
  const search = `?item=${second.itemId}`;
  const initial = await renderBatch([], undefined, search);
  expect(button(initial.root, second.name).getAttribute('aria-current')).toBe('true');
  await initial.unmount();
  const page = await renderBatch([], undefined, search);
  const reading = () => elements(page.root).find(node => node.getAttribute('id') === 'intake-reading')!;
  expect(elements(reading()).some(node => node.getAttribute('aria-label') === `Reading for ${second.name}`))
    .toBe(true);
  expect(button(page.root, second.name).getAttribute('aria-current')).toBe('true');
  await act(async () => { page.client.setQueryData(['intake', caseId], { items: [first] }); });
  const shown = () => elements(reading()).some(node => node.getAttribute('aria-label') === `Reading for ${first.name}`);
  for (let tick = 0; tick < 50 && !shown(); tick++) await act(() => new Promise(resolve => setTimeout(resolve, 20)));
  expect(shown()).toBe(true);
  expect(button(page.root, first.name).getAttribute('aria-current')).toBe('true');
  await page.unmount();
});

it.each([true, false])('S7.11: an unknown URL item uses the single-file fallback: %s', async single => {
  facts.items = single ? [first] : [first, second];
  facts.uploads = [];
  const page = await renderBatch([], undefined, '?item=unknown');
  const reading = elements(page.root).find(node => node.getAttribute('id') === 'intake-reading')!;
  expect(elements(reading).some(node => node.getAttribute('aria-label') === `Reading for ${first.name}`))
    .toBe(single);
  expect(button(page.root, first.name).getAttribute('aria-current')).toBe(single ? 'true' : null);
  if (!single) expect(reading.textContent).toBe('');
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

// The page's layout rules, read as written: the test DOM lays nothing out.
const batchCss = readFileSync(new URL('./Batch.module.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
/** The declarations of the file's first top-level rule written exactly as `selector {`. */
const rule = (selector: string) => {
  const start = batchCss.indexOf(`\n${selector} {\n`);
  return start < 0 ? '' : batchCss.slice(start).split('}')[0]!;
};
/** The text of the file's `@media (query) {` block, up to its closing brace at the line start. */
const media = (query: string) => {
  const start = batchCss.indexOf(`\n@media (${query}) {\n`);
  return start < 0 ? '' : batchCss.slice(start + 1).split('\n}')[0]!;
};

it('S7.27: the files sit in the left column\'s own track, so a wide files table scrolls inside its tray', async () => {
  facts.items = [first, second];
  facts.uploads = [];
  const page = await renderBatch([], undefined, `?item=${first.itemId}`);
  const files = elements(page.root).find((node) => node.getAttribute('id') === 'intake-files')!;
  const column = files.parentNode as FakeElement;
  expect(column.getAttribute('class')).toBe(styles.stack);
  expect((column.parentNode as FakeElement).getAttribute('class')).toBe(styles.workspace);
  const tray = elements(files).find((node) => node.getAttribute('aria-label') === 'Files in this batch')!;
  expect(tray.getAttribute('class')).toBe(styles.tray);
  // Before S7.27 the column's implicit track grew to the table's width and ran under the sticky reading panel.
  expect(rule('.workspace > .stack')).toMatch(/grid-template-columns: minmax\(0, 1fr\);/);
  expect(rule('.tray')).toMatch(/overflow-x: auto;/);
  expect(rule('.tray td:first-child')).toMatch(/overflow-wrap: anywhere;/);
  expect(rule('.reading')).toMatch(/position: sticky;/);
  await page.unmount();
});

it('S7.27b: wide screens give the files the larger share, and the reading panel sticks to the scrolling main area',
  () => {
    expect(rule('.workspace')).toMatch(/grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/);
    // Before S7.27b equal columns left the files table 107 px of sideways scroll at 1440 wide.
    const workspace = (block: string) => block.slice(block.indexOf('.workspace {')).split('}')[0]!;
    expect(workspace(media('min-width: 1280px'))).toMatch(/grid-template-columns: minmax\(0, 3fr\) minmax\(0, 2fr\);/);
    expect(workspace(media('max-width: 720px'))).toMatch(/grid-template-columns: minmax\(0, 1fr\);/);
    // Before S7.27b .page had overflow auto: a scroll box that never scrolled, so the sticky panel scrolled away.
    expect(rule('.page')).not.toMatch(/overflow:/);
    expect(rule('.reading')).toMatch(/position: sticky;/);
  });
