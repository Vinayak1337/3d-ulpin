import { button, container, elements, propsOf } from './fake-dom';
import { act, useState } from 'react';
import { readFileSync } from 'node:fs';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { IntakeTray } from './IntakeTray';
import { IntakeItemRefresh } from './item-refresh';
import captured from '../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import { ReadingCard } from './ReadingCard';
import { basisWords, readingKey, type Reading } from './reading-model';
import { intakeKey } from './batch-queries';
import type { IntakeItem } from './batch-model';
import { EvidenceByKey } from './evidence/EvidenceByKey';
import { declareFromLink, profileInput, type KeyProfileBody, type LinkDeclaration } from './evidence/model';
import type { MapProfile } from './question-model';

const nyc = JSON.parse(readFileSync(new URL('../../../../../fixtures/real-nyc/original.geojson', import.meta.url),
  'utf8'));
const item = { ...captured.manifest.items[0], layoutQuestion: true } as unknown as IntakeItem;
// test_only reading response for the public NYC footprint; the UI does not infer any of these meanings.
const reading: Reading = {
  version: 'intake-reading/1', what: { words: 'GeoJSON map features.', basis: 'reader' },
  holds: [{ words: `${nyc.features.length} feature.`, basis: 'reader' }],
  fields: [
    { field: 'bin', target: 'building.sourceKey', words: 'Building identifier.', basis: 'rule' },
    { field: 'name', target: 'building.name', words: 'Building name.', basis: 'memory' },
    { field: 'doitt_id', target: null, words: 'Source identifier.', basis: 'officer' },
  ],
  drawing: { as: 'outlines', words: 'Outlines once the layout is answered.', basis: 'rule' },
  links: [], question: 'Which field identifies each building?',
};

afterEach(() => vi.unstubAllGlobals());
const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 20)));

// test_only NYC-shaped bin-to-bin link records, not an ingestion result.
const linkedTable = { ...item, itemId: '04000000-0000-4000-8000-000000000003',
  sourceId: '04000000-0000-4000-8000-000000000004', name: 'register.csv', family: 'table', format: 'csv',
  card: { ...item.card!, columns: [{ name: 'bin', inferredType: 'number', sampledNonEmpty: 1 }] } } as IntakeItem;
const mapProfile = { ...captured.profile, paths: captured.profile.paths.map(path =>
  ({ ...path, integerIdEligible: path.path === '/features/*/properties/bin' })) } as unknown as MapProfile;
const keyLink = { itemId: linkedTable.itemId, by: 'key' as const, basis: 'rule' as const,
  fields: { here: '/features/*/properties/bin', there: 'bin' },
  words: 'A link may be declared to register.csv: bin (confirmed by you) here and bin (rule) there '
    + 'both mean Building source key.' };

async function mount(data: Reading | null, row = item, status = 200, wait?: Promise<void>,
  linked?: { items: IntakeItem[]; drafted: boolean }) {
  const bodies: KeyProfileBody[] = [];
  const fetch = vi.fn(async (request: Request) => {
    await wait;
    if (linked) {
      const path = new URL(request.url).pathname;
      if (request.method === 'POST') {
        bodies.push(await request.json());
        return Response.json({ profileId: linkedTable.itemId, input: bodies.at(-1) }, { status: 201 });
      }
      if (path.endsWith('/targets')) return Response.json({ items: [], packages: linked.drafted
        ? [{ anchorItemId: item.itemId, counts: { ready: 1 } }] : [] });
      if (path.includes('/sources/')) return Response.json(mapProfile);
      if (path.endsWith('/evidence')) return Response.json({ profiles: [], sources: [], candidates: [],
        confirmations: [], counts: { matched: 0, no_match: 0, several: 0, conflicting: 0 }, nextCursor: null });
    }
    return new Response(JSON.stringify(data ?? { message: 'The reading is unavailable.' }),
      { status, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(intakeKey(row.caseId), { caseId: row.caseId, items: linked?.items ?? [row] });
  const root = container();
  const view = createRoot(root as never);
  vi.stubGlobal('document', new Proxy(document, { get(target, key, receiver) {
    if (key === 'getElementById') return (id: string) => elements(root).find(node => node.getAttribute('id') === id);
    return Reflect.get(target, key, receiver);
  } }));
  function Contents() {
    const [requested, setRequested] = useState<LinkDeclaration | null>(null);
    return <>
      <ReadingCard caseId={row.caseId} item={row} onDeclare={setRequested} />
      {linked ? <EvidenceByKey caseId={row.caseId} items={linked.items}
        requested={requested} clearRequest={() => setRequested(null)} /> : null}
      <section id={`intake-layout-${row.itemId}`}>Layout</section>
      <section id={`intake-table-${row.itemId}`}>Table</section>
      <section id={`intake-page-image-${row.itemId}`}>Page image</section>
      <section id={`intake-layer-crs-${row.itemId}`}>Layer CRS</section>
    </>;
  }
  await act(async () => view.render(<QueryClientProvider client={client}><Contents /></QueryClientProvider>));
  await settle();
  return { root, client, fetch, bodies, close: () => act(async () => { view.unmount(); client.clear(); }) };
}

function inlineReading() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const row = linkedTable;
  const key = readingKey(row.caseId, row.itemId);
  client.setQueryData(intakeKey(row.caseId), { caseId: row.caseId, items: [row] });
  const root = container();
  const view = createRoot(root as never);
  const detail = <ReadingCard caseId={row.caseId} item={row} />;
  const refresh = new IntakeItemRefresh(client, row.caseId, async () => row);
  const render = async (opened: boolean) => {
    await act(async () => view.render(<QueryClientProvider client={client}><MemoryRouter>
      <IntakeTray caseId={row.caseId} items={[row]} packages={[]} choose={vi.fn()} refresh={vi.fn()} />
      {opened ? detail : null}
    </MemoryRouter></QueryClientProvider>));
    await settle();
  };
  const close = () => act(async () => {
    view.unmount();
    client.clear();
  });
  return { client, key, root, render, close,
    changed: (named: boolean) => refresh.changed(named ? row.itemId : undefined) };
}

it.each([false, true])('inline reading keeps its fetcher across tray renders and notifications; named: %s', async named => {
  let response = reading;
  const fetch = vi.fn(async () => Response.json(response));
  vi.stubGlobal('fetch', fetch);
  const page = inlineReading();
  try {
    await page.render(false);
    expect(fetch).not.toHaveBeenCalled();
    await page.render(true);
    expect(page.client.getQueryState(page.key)?.status).toBe('success');
    await page.render(false);
    page.changed(named);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    response = { ...reading, question: null };
    await page.render(true);
    // A tray-only render must not replace the mounted detail's fetcher with a skip token.
    await page.render(true);
    page.changed(named);
    await settle();
    expect(page.client.getQueryState(page.key)?.error).toBeNull();
    expect(page.client.getQueryState(page.key)?.status).toBe('success');
    expect(page.root.textContent).not.toContain('Missing queryFn');
    expect(fetch).toHaveBeenCalledTimes(3);
  } finally {
    await page.close();
  }
});

it.each([false, true])('ZP2: a notification during the inline read asks for one more read; named: %s', async named => {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const fetch = vi.fn(async () => {
    await wait;
    return Response.json(reading);
  });
  vi.stubGlobal('fetch', fetch);
  const page = inlineReading();
  try {
    await page.render(true);
    await page.render(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    page.changed(named);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(page.client.getQueryState(page.key)?.error).toBeNull();
    expect(page.client.getQueryState(page.key)?.status).toBe('success');
  } finally {
    release();
    await page.close();
  }
});

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
    links: [{ itemId: item.itemId, by: 'key', fields: null, words: 'A candidate key link.', basis: 'sarvam' }] });
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

it.each([
  { reverse: false, reworded: false }, { reverse: true, reworded: false },
  { reverse: false, reworded: true }, { reverse: true, reworded: true },
])('Declare fills the NYC-shaped bin link: $reverse, changed words: $reworded', async ({ reverse, reworded }) => {
  const row = reverse ? linkedTable : item;
  const link = { ...keyLink, itemId: reverse ? item.itemId : linkedTable.itemId,
    fields: reverse ? { here: keyLink.fields.there, there: keyLink.fields.here } : keyLink.fields,
    words: reworded ? 'These files have a suggested key link.' : keyLink.words };
  const page = await mount({ ...reading, links: [link], question: null }, row, 200, undefined,
    { items: [item, linkedTable], drafted: true });
  await settle();
  expect(button(page.root, 'Declare').getAttribute('aria-describedby')).toBeNull();
  expect(page.root.textContent).not.toContain('Available once this file is drafted.');
  await act(async () => propsOf(button(page.root, 'Declare')).onClick?.());
  await settle();
  expect(document.activeElement?.getAttribute('aria-labelledby')).toBe('evidence-by-key');
  const fields = elements(page.root).filter(node => node.tagName === 'SELECT');
  expect(fields.slice(0, 4).map(field => propsOf(field).value))
    .toEqual(['integer', item.itemId, '/features/*/properties/bin', '0']);
  expect(page.bodies).toHaveLength(0);
  expect(page.client.getQueryCache().getAll().some(query => query.queryKey.includes('declare-link'))).toBe(false);
  await act(async () => propsOf(button(page.root, 'Cancel')).onClick?.());
  await act(async () => propsOf(button(page.root, 'Declare')).onClick?.());
  await settle();
  expect(propsOf(elements(page.root).find(node => node.tagName === 'SELECT')!).value).toBe('integer');
  await act(async () => propsOf(elements(page.root).find(node => node.tagName === 'FORM')!)
    .onSubmit?.({ preventDefault() {} }));
  await settle();
  expect(page.bodies).toHaveLength(1);
  expect(page.bodies[0]).toEqual({ requestKey: expect.any(String), version: 'exact-key/1',
    namespace: 'bin · register.csv', kind: 'integer',
    map: { anchorItemId: item.itemId, sourcePath: '/features/*/properties/bin' },
    tables: [{ itemId: linkedTable.itemId, columnIndex: 0,
      selection: { format: 'csv', sheet: 'csv', table: null, headerRows: [1] } }], documents: [] });
  await act(async () => propsOf(button(page.root, 'Link a register by a key')).onClick?.());
  expect(propsOf(elements(page.root).find(node => node.tagName === 'INPUT')!).value).toBe('');
  expect(propsOf(elements(page.root).find(node => node.tagName === 'SELECT')!).value).toBe('text');
  await page.close();
});

it('describes undrafted Declare before its only action, and Answer the layout focuses its section', async () => {
  const page = await mount({ ...reading, links: [{ ...keyLink, by: 'address' }], question: null },
    item, 200, undefined, { items: [item, linkedTable], drafted: false });
  await settle();
  const declare = button(page.root, 'Declare');
  expect(declare.getAttribute('disabled')).not.toBeNull();
  const description = elements(page.root).find(node =>
    node.getAttribute('id') === declare.getAttribute('aria-describedby'))!;
  expect(description.textContent).toContain('Available once this file is drafted.');
  expect(description.getAttribute('hidden')).toBeNull();
  expect(elements(page.root).indexOf(description)).toBeLessThan(elements(page.root).indexOf(declare));
  await act(async () => propsOf(button(page.root, 'Answer the layout')).onClick?.());
  expect(document.activeElement?.getAttribute('id')).toBe(`intake-layout-${item.itemId}`);
  expect(page.bodies).toHaveLength(0);
  await page.close();
});

it('refuses unreadable link parts instead of guessing a field, column, kind or selection', async () => {
  const link = { ...keyLink, fromItemId: item.itemId };
  const profiles = new Map([[item.sourceId!, mapProfile]]);
  const initial = declareFromLink(link, [item, linkedTable], profiles)!;
  expect(profileInput(initial, initial.tables)).toMatchObject({ kind: 'integer', tables: [{ columnIndex: 0 }] });
  expect(declareFromLink(link, [item, linkedTable], new Map())).toBeNull();
  expect(declareFromLink({ ...link, by: 'place' }, [item, linkedTable], profiles)).toBeNull();
  expect(declareFromLink({ ...link, fields: null }, [item, linkedTable], profiles)).toBeNull();
  expect(declareFromLink({ ...link, fields: { ...link.fields, here: '/features/*/properties/missing' } },
    [item, linkedTable], profiles)).toBeNull();
  const workbook = { ...linkedTable, format: 'xlsx' };
  expect(declareFromLink(link, [item, workbook], profiles)).toBeNull();
  const duplicate = { ...linkedTable, card: { ...linkedTable.card!,
    columns: [...linkedTable.card!.columns, ...linkedTable.card!.columns] } };
  expect(declareFromLink(link, [item, duplicate], profiles)).toBeNull();
  const page = await mount({ ...reading, links: [keyLink], question: null });
  await settle();
  expect(elements(page.root).filter(node => node.tagName === 'BUTTON')).toHaveLength(0);
  await page.close();
});

it('shows a place link without a Declare button', async () => {
  const page = await mount({ ...reading, links: [{ ...keyLink, by: 'place', fields: null }], question: null },
    item, 200, undefined, { items: [item, linkedTable], drafted: true });
  expect(page.root.textContent).toContain(keyLink.words);
  expect(elements(page.root).some(node => node.tagName === 'BUTTON' && node.textContent === 'Declare')).toBe(false);
  await page.close();
});

it('shows the API error words without replacing them', async () => {
  const page = await mount(null, item, 409);
  expect(page.root.textContent).toContain('The reading is unavailable.');
  await page.close();
});
