import { button, container, elements, propsOf } from './fake-dom';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import captured from '../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import { ReadingCard } from './ReadingCard';
import { basisWords, readingKey, type Reading } from './reading-model';
import { intakeKey } from './batch-queries';
import type { IntakeItem } from './batch-model';

const nyc = JSON.parse(readFileSync(new URL('../../../../../fixtures/real-nyc/original.geojson', import.meta.url),
  'utf8'));
const item = { ...captured.manifest.items[0], layoutQuestion: true } as unknown as IntakeItem;
// test_only reading response for the public NYC footprint; the UI does not infer any of these meanings.
const reading: Reading = {
  version: 'intake-reading/1', what: { words: 'GeoJSON map features.', basis: 'reader' },
  holds: [{ words: `${nyc.features.length} feature.`, basis: 'reader' }],
  fields: [
    { field: 'bin', words: 'Building identifier.', basis: 'rule' },
    { field: 'name', words: 'Building name.', basis: 'memory' },
    { field: 'doitt_id', words: 'Source identifier.', basis: 'officer' },
  ],
  drawing: { as: 'outlines', words: 'Outlines once the layout is answered.', basis: 'rule' },
  links: [], question: 'Which field identifies each building?',
};

afterEach(() => vi.unstubAllGlobals());
const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 20)));

async function mount(data: Reading | null, row = item, status = 200, wait?: Promise<void>) {
  const fetch = vi.fn(async () => {
    await wait;
    return new Response(JSON.stringify(data ?? { message: 'The reading is unavailable.' }),
      { status, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(intakeKey(row.caseId), { caseId: row.caseId, items: [row] });
  const root = container();
  const view = createRoot(root as never);
  vi.stubGlobal('document', new Proxy(document, { get(target, key, receiver) {
    if (key === 'getElementById') return (id: string) => elements(root).find(node => node.getAttribute('id') === id);
    return Reflect.get(target, key, receiver);
  } }));
  await act(async () => view.render(<QueryClientProvider client={client}>
    <ReadingCard caseId={row.caseId} item={row} />
    <section id={`intake-layout-${row.itemId}`}>Layout</section>
    <section id={`intake-table-${row.itemId}`}>Table</section>
    <section id={`intake-page-image-${row.itemId}`}>Page image</section>
    <section id={`intake-layer-crs-${row.itemId}`}>Layer CRS</section>
  </QueryClientProvider>));
  await settle();
  return { root, client, fetch, close: () => act(async () => { view.unmount(); client.clear(); }) };
}

it('shows the NYC reading, three fields and their bases, and Answer focuses the layout', async () => {
  expect(reading.fields.every(field => field.field in nyc.features[0].properties)).toBe(true);
  const page = await mount(reading);
  for (const words of ['What', 'Holds', 'Fields', 'Drawing', 'Links', reading.what.words,
    reading.holds[0]!.words, reading.drawing.words, reading.question!, 'No links found']) {
    expect(page.root.textContent).toContain(words);
  }
  for (const field of reading.fields) {
    const line = elements(page.root).find(node => node.tagName === 'LI' && node.textContent.includes(field.field));
    expect(line?.textContent).toContain(`${field.words} · ${basisWords(field.basis)}`);
  }
  await act(async () => propsOf(button(page.root, 'Answer')).onClick?.());
  expect(document.activeElement?.getAttribute('id')).toBe(`intake-layout-${item.itemId}`);
  expect(page.fetch).toHaveBeenCalledTimes(1);
  await page.close();
});

it('keeps an unknown file described with no question or Answer button', async () => {
  const unknown = { ...reading, what: { words: 'The file kind could not be identified.', basis: 'reader' as const },
    fields: [], question: null };
  const page = await mount(unknown, { ...item, family: 'unknown', format: null, placement: 'not_understood' });
  expect(page.root.textContent).toContain(unknown.what.words);
  expect(elements(page.root).filter(node => node.tagName === 'BUTTON')).toHaveLength(0);
  await page.close();
});

it('marks every Sarvam line Needs review, including links', async () => {
  const page = await mount({ ...reading, fields: [{ ...reading.fields[0]!, basis: 'sarvam' }],
    links: [{ itemId: item.itemId, by: 'key', words: 'A candidate key link.', basis: 'sarvam' }] });
  expect(page.root.textContent.match(/from Sarvam, not confirmed · Needs review/g)).toHaveLength(2);
  expect(page.root.textContent).toContain('A candidate key link.');
  expect(page.root.textContent).not.toContain('No links found');
  await page.close();
});

it('refreshes the same item query when updatedAt changes; an item without a source does not fetch', async () => {
  const page = await mount(reading);
  await act(async () => { page.client.setQueryData(intakeKey(item.caseId), {
    caseId: item.caseId, items: [{ ...item, updatedAt: '2026-10-26T00:00:00.000Z' }],
  }); });
  await settle();
  expect(page.fetch).toHaveBeenCalledTimes(2);
  expect(page.client.getQueryCache().findAll({ queryKey: readingKey(item.caseId, item.itemId) })).toHaveLength(1);
  await page.close();
  const absent = await mount(reading, { ...item, sourceId: null });
  expect(absent.fetch).not.toHaveBeenCalled();
  await absent.close();
});

it('uses the existing Skeleton until the reading arrives', async () => {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const page = await mount(reading, item, 200, wait);
  expect(elements(page.root).some(node => node.getAttribute('class') === 'ul-skeleton')).toBe(true);
  expect(page.root.textContent).not.toContain(reading.what.words);
  await act(async () => { release(); });
  await settle();
  expect(page.root.textContent).toContain(reading.what.words);
  await page.close();
});

it.each(['table', 'page-image', 'layer-crs'])('Answer focuses the existing %s section', async section => {
  const row = { ...item };
  if (section === 'table') row.family = 'table';
  // Only presence is read by the focus router; this is not a page-image reading fixture.
  if (section === 'page-image') row.pageImage = {} as NonNullable<IntakeItem['pageImage']>;
  if (section === 'layer-crs') row.layerCrs = [{ layer: 'unstated', answer: null }];
  const page = await mount(reading, row);
  await act(async () => propsOf(button(page.root, 'Answer')).onClick?.());
  expect(document.activeElement?.getAttribute('id')).toBe(`intake-${section}-${item.itemId}`);
  await page.close();
});

it('shows the API error words without replacing them', async () => {
  const page = await mount(null, item, 409);
  expect(page.root.textContent).toContain('The reading is unavailable.');
  await page.close();
});
