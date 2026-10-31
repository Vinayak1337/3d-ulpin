import { button, container, elements, propsOf } from './fake-dom';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readingKey } from './reading-model';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import captured from '../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import { intakeTrayRows, isSettled, type IntakeItem } from './batch-model';
import styles from './Batch.module.css';
import { needsLayoutAnswer } from './question-model';
import { IntakeTray } from './IntakeTray';

// LQ1a's captured manifest row, set to rest because its bytes already made another area.
const words = 'This file is already the source of the area “buildings original”. '
  + 'Open that area; nothing new is prepared from a second copy.';
const areaId = '10000000-0000-4000-8000-000000000009';
const rested = { ...captured.manifest.items[0], archiveItemId: null,
  state: 'read', placement: 'undecided', plan: null,
  limitReason: words, existingAreaId: areaId } as unknown as IntakeItem;

function tray(item: IntakeItem, client = new QueryClient(), items = [item]) {
  return renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter>
    <IntakeTray caseId={item.caseId} items={items} packages={[]} choose={vi.fn()} refresh={vi.fn()} />
  </MemoryRouter></QueryClientProvider>);
}

it.each<[string, string, Partial<IntakeItem>]>([
  ['Reading', 'info', { state: 'reading', placement: 'undecided' }],
  ['Needs you', 'warning', { layoutQuestion: true, placement: 'needs_answer' }],
  ['Ready', 'success', { state: 'read', placement: 'on_map' }],
])('the tray Status cell shows the %s chip with its %s tone', (word, tone, facts) => {
  const item = { ...rested, partsPlanned: null, ...facts };
  expect(tray(item)).toMatch(new RegExp(`ul-badge--${tone}.*>${word}</span>`));
});

it('a Reading percent keeps the part counts beneath it, and a preparing row keeps its record counts', () => {
  const item = { ...rested, state: 'reading', placement: 'undecided',
    partsDone: 198, partsPlanned: 211 } as IntakeItem;
  const html = tray(item);
  expect(html).toMatch(/ul-badge--info.*>Reading 93%<\/span>/);
  expect(html).toContain('<p class="ul-help">198 of 211 parts</p>');
  const preparing = tray({ ...item, state: 'preparing', recordsSeen: 1662 });
  expect(preparing).toMatch(/ul-badge--info.*>Reading 93%<\/span>/);
  expect(preparing).toContain('<p class="ul-help">198 packages prepared · 1,662 records read</p>');
});

it('Contents uses only a reading already in the cache, without fetching other rows', () => {
  const client = new QueryClient();
  const what = { words: 'A kept GeoJSON map layer.', basis: 'reader' };
  client.setQueryData(readingKey(rested.caseId, rested.itemId), { what });
  expect(tray(rested, client)).toContain(`<td>${what.words}</td>`);
  expect(client.isFetching()).toBe(0);
});

it('Contents follows cache updates and invalidation never fetches an unopened row', async () => {
  const client = new QueryClient();
  const root = container();
  const view = createRoot(root as never);
  await act(async () => view.render(<QueryClientProvider client={client}><MemoryRouter>
    <IntakeTray caseId={rested.caseId} items={[rested]} packages={[]} choose={vi.fn()} refresh={vi.fn()} />
  </MemoryRouter></QueryClientProvider>));
  expect(root.textContent).toContain('GeoJSON');
  const what = { words: 'A kept GeoJSON map layer.', basis: 'reader' };
  await act(async () => { client.setQueryData(readingKey(rested.caseId, rested.itemId), { what }); });
  await act(() => new Promise(resolve => setTimeout(resolve, 20)));
  expect(root.textContent).toContain(what.words);
  await act(async () => { await client.invalidateQueries(); });
  expect(client.isFetching()).toBe(0);
  expect(client.getQueryState(readingKey(rested.caseId, rested.itemId))?.status).toBe('success');
  await act(async () => view.unmount());
  client.clear();
});

it('an item already in an area rests settled with its sentence and a link to that area, never a question', () => {
  expect(isSettled(rested)).toBe(true);
  expect(needsLayoutAnswer(rested)).toBe(false);
  const html = tray(rested);
  expect(html).toContain('buildings original');
  expect(html).toContain(`href="/studio/areas/${areaId}"`);
  expect(html).toContain('>Open that area<');
  const { existingAreaId: _area, ...unnamed } = rested;
  expect(tray(unnamed)).toContain(words);
  expect(tray(unnamed)).not.toContain('/studio/areas/');
});

// CN1: a wide file's line, its cell files kept as separate batches; the second is one this officer may not open.
const opened = { cellKey: 'utm-20-e5-n12-l231-b270', caseId: '10000000-0000-4000-8000-000000000101',
  itemId: '10000000-0000-4000-8000-000000000103', state: 'read', placement: 'on_map' } as const;
const closed = { cellKey: 'utm-20-e6-n12-l231-b270', caseId: null, itemId: null, state: null, placement: null };
const wide = { ...captured.manifest.items[0], state: 'read', placement: 'on_map',
  cellBatches: [opened, closed] } as unknown as IntakeItem;

it('a wide file links each cell batch it may open and names the cells it may not', () => {
  const html = tray(wide);
  expect(html).toContain(`aria-label="Separate cell batches of ${wide.name}"`);
  expect(html).toContain(`href="/studio/work/cases/${opened.caseId}/intake"`);
  expect(html).toContain(opened.cellKey);
  expect(html).toContain('In that batch: Read · On the map');
  expect(html).toContain(closed.cellKey);
  expect(html).toContain('a separate batch');
  expect(html.match(/href="\/studio\/work\/cases\//g)).toHaveLength(1);
  expect(html).not.toMatch(/on (this|the current) map/i);
  const { cellBatches: _cells, ...plain } = wide;
  expect(tray(plain as IntakeItem)).not.toContain('separate batches');
});

it('a 2,100-feature ZIP member offers View layout while keeping the archive prefix in its reason', () => {
  const reason = 'No approved layout matches this file. An officer chooses the identifier field.';
  const item = { ...rested, itemId: '10000000-0000-4000-8000-000000000210',
    name: 'nyc-footprints-2100.geojson', recordsSeen: 2100,
    state: 'probed', placement: 'needs_answer', existingAreaId: undefined, layoutQuestion: true,
    limitReason: `Taken out of zp1-geojson-kml-csv.zip. ${reason}` } as IntakeItem;
  const [archive] = archiveRows(0);
  const rows = [archive!, { ...item, archiveItemId: archive!.itemId }];
  const html = tray(archive!, new QueryClient(), rows);
  expect(html.indexOf(archive!.name)).toBeLessThan(html.indexOf(item.name));
  expect(html).toContain(`class="${styles.member}"`);
  expect(html).toContain('>View layout</button>');
  expect(tray(item)).toContain(item.limitReason);
  expect(tray({ ...item, limitReason: reason })).toContain('>View layout</button>');
});

function archiveRows(count: number, format = 'zip'): IntakeItem[] {
  const archive = { ...rested, name: `layers.${format}`, format, family: 'archive' } as IntakeItem;
  return [archive, ...Array.from({ length: count }, (_, index) => ({ ...rested,
    itemId: `10000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`,
    name: `member-${index}.geojson`, archiveItemId: archive.itemId }))];
}

it.each([3, 10])('a ZIP with %s members lists them just below it, indented and open', count => {
  const [archive, ...members] = archiveRows(count);
  members[0] = { ...members[0]!, archiveItemId: null, parentItemId: archive!.itemId };
  const items = [members[0]!, archive!, ...members.slice(1)];
  expect(intakeTrayRows(items).map(row => row.item)).toEqual([archive, ...members]);
  const html = tray(archive!, new QueryClient(), items);
  expect(html.match(new RegExp(`class="${styles.member}"`, 'g'))).toHaveLength(count);
  expect(html).toContain(`<span>${count}</span>`);
  expect(html).not.toContain('aria-expanded');
});

it('a member whose archive is absent keeps its place without an indent', () => {
  const [archive, member] = archiveRows(1);
  const items = [member!, { ...rested, itemId: 'other' }];
  expect(intakeTrayRows(items).map(row => row.item)).toEqual(items);
  expect(tray(archive!, new QueryClient(), items)).not.toContain(`class="${styles.member}"`);
});

it.each(['closed', 'selected', 'pending'])('a 12-file KMZ is open only when toggled or needed: %s', async kind => {
  const items = archiveRows(12, 'kmz');
  if (kind === 'pending') items[1] = { ...items[1]!, layoutQuestion: true, placement: 'needs_answer' };
  const choose = vi.fn(), client = new QueryClient(), root = container(), view = createRoot(root as never);
  const archive = items[0]!;
  await act(async () => view.render(<QueryClientProvider client={client}><MemoryRouter>
    <IntakeTray caseId={archive.caseId} items={items} packages={[]} choose={choose} refresh={vi.fn()}
      selectedId={kind === 'selected' ? items[1]!.itemId : undefined} />
  </MemoryRouter></QueryClientProvider>));
  const toggle = () => elements(root).find(node => node.getAttribute('aria-expanded') !== null)!;
  expect(toggle().getAttribute('aria-expanded')).toBe(kind === 'closed' ? 'false' : 'true');
  if (kind === 'closed') {
    expect(root.textContent).not.toContain(items[1]!.name);
    expect(toggle().getAttribute('aria-label')).toBe(`Show the 12 files of ${archive.name}`);
    await act(async () => propsOf(toggle()).onClick?.({}));
  }
  expect(toggle().getAttribute('aria-label')).toBe(`Hide the 12 files of ${archive.name}`);
  expect(root.textContent).toContain(items[1]!.name);
  await act(async () => propsOf(button(root, items[1]!.name)).onClick?.({}));
  expect(choose).toHaveBeenCalledWith(items[1]);
  if (kind === 'closed') {
    await act(async () => propsOf(toggle()).onClick?.({}));
    expect(root.textContent).not.toContain(items[1]!.name);
  }
  await act(async () => view.unmount());
  client.clear();
});

it('a captured row fits five columns, its format, size and counts in Contents, no raw bytes or Not applicable', () => {
  const html = tray(captured.manifest.items[0] as unknown as IntakeItem);
  const headers = [...html.matchAll(/<th[ >]/g)];
  expect(headers.length).toBeLessThanOrEqual(5);
  for (const header of ['File', 'Contents', 'Status', 'Coordinates', 'Next step']) {
    expect(html).toContain(`>${header}<`);
  }
  expect(html).toMatch(/<td>GeoJSON · \d(\.\d)? (KiB|MiB) · 1,662 features<\/td>/);
  expect(html).not.toContain('class="ul-help">Map features');
  expect(html).not.toContain('bytes');
  expect(html).not.toContain('Not applicable');
});

it('a kept surface not on the map offers View the surface, which chooses it; one on the map offers none', async () => {
  const laz = { ...rested, itemId: '10000000-0000-4000-8000-000000000102', name: 'nyc-10013-lidar-2017.laz',
    family: 'point_cloud', placement: 'waiting_for_anchor', existingAreaId: undefined,
    limitReason: null } as IntakeItem;
  const choose = vi.fn();
  const root = container();
  const view = createRoot(root as never);
  const client = new QueryClient();
  await act(async () => view.render(<QueryClientProvider client={client}><MemoryRouter>
    <IntakeTray caseId={laz.caseId} items={[rested, laz]} packages={[]} choose={choose} refresh={vi.fn()} />
  </MemoryRouter></QueryClientProvider>));
  const surface = button(root, 'View the surface');
  expect(propsOf(surface)['aria-label']).toBe('View the surface: nyc-10013-lidar-2017.laz');
  expect(elements(root).filter((node) => node.tagName === 'BUTTON' && node.textContent === 'View the surface'))
    .toHaveLength(1);
  await act(async () => propsOf(surface).onClick?.({}));
  expect(choose).toHaveBeenCalledWith(laz);
  await act(async () => view.unmount());
  expect(tray({ ...laz, placement: 'on_map' })).not.toContain('View the surface');
});
