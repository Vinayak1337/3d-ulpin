import { button, container, elements, propsOf, type FakeElement } from './fake-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import captured from '../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import targets from '../../../../../docs/evidence/gf1/e3b/targets.json';
import type { IntakeItem, IntakeManifest } from './batch-model';
import type { EvidencePage } from './evidence/model';
import { evidenceKey } from './evidence/api';
import { primaryPress } from './needs-model';
import type { Package, TargetPage } from './run/model';
import { focusSection } from './StepStrip';

// The batch page renders its own sections; the run panel stands in with the real confirmation it would show.
const facts = vi.hoisted(() => ({ items: [] as unknown[], packages: [] as unknown[] }));
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
  ...await original<typeof import('./table/queries')>(),
  useSourceCase: () => ({ data: { case: { name: 'test_only batch' } }, error: null }),
  useTableProfile: (_caseId: string, sourceId: string) => ({ isPending: false,
    data: sourceId === captured.manifest.items[0]!.sourceId ? captured.profile : undefined }),
}));
vi.mock('./useBatchStream', () => ({ useBatchStream: () => ({ disconnected: false, error: '', reconnect() {} }) }));
vi.mock('./run', async () => {
  const { Confirm } = await import('./run/Confirm');
  return { IntakeRunPanel: ({ primary }: { primary?: boolean }) => <Confirm
    page={{ ...targets, packages: facts.packages } as TargetPage} choice={[]} cards={null} closeCards={vi.fn()}
    acknowledgement="" setAcknowledgement={vi.fn()} press={vi.fn()} busy={false} uncertain={false} stale={false}
    error="" primary={primary} /> };
});

const { BatchPage } = await import('./BatchPage');
const caseId = '04000000-0000-4000-8000-000000000001';
// test_only: the captured map file asking its layout, the same file once answered, and a kept CSV.
const layout = { ...captured.manifest.items[0], layoutQuestion: true } as unknown as IntakeItem;
const answered = { ...layout, layoutQuestion: false } as IntakeItem;
const table = { ...layout, itemId: '04000000-0000-4000-8000-000000000003', sourceId: '04000000-0000-4000-8000-0000000'
  + '00004', name: 'register.csv', family: 'table', format: 'csv', placement: 'undecided', limitReason: null,
  card: { ...layout.card, family: 'table', format: 'csv', sheets: [], columns: [], geometryTypes: [], layers: [],
    crs: { state: 'not_applicable', code: null, sidecarSha256: null } } } as unknown as IntakeItem;
// test_only: G23's real CubiCasa plan PNG as read, without its preview, answered as a plan.
const image = { ...answered, itemId: '04000000-0000-4000-8000-000000000007', sourceId: '04000000-0000-4000-8000-0000'
  + '00000008', name: 'F1_scaled.png', family: 'image', format: 'png', state: 'read', placement: 'undecided',
  card: null, plan: null, limitReason: null, pageImage: { version: 'page-image-read/1', format: 'png', width: 2776,
    height: 1346, bands: 3, bitDepth: 8, orientation: null, captureTime: null, locationStated: false, dpi: null,
    preview: null, previewLimit: 'none was made',
    label: { value: 'plan', state: 'candidate', answeredAt: '2026-10-21T00:00:02.000Z' } } } as unknown as IntakeItem;
const ready = { ...targets.packages[0], anchorItemId: layout.itemId } as Package;
const evidence = { caseId, confirmations: [], sources: [], candidates: [], nextCursor: null,
  counts: { matched: 0, no_match: 0, several: 0, conflicting: 0 },
  profiles: [{ profileId: '04000000-0000-4000-8000-000000000005', input: { namespace: 'House number', kind: 'text',
    map: { anchorItemId: '04000000-0000-4000-8000-000000000006', sourcePath: '/features/*/properties/house' },
    tables: [], documents: [] } }] } as unknown as EvidencePage;

afterEach(() => vi.unstubAllGlobals());

async function renderBatch(items: IntakeItem[], selected: IntakeItem) {
  facts.items = items;
  facts.packages = [ready];
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(['intake', caseId], { items });
  client.setQueryData([...evidenceKey(caseId), '', null], evidence);
  const root = container();
  const view = createRoot(root as never);
  const router = createMemoryRouter([{ path: '/studio/work/cases/:caseId/intake', element: <BatchPage /> }],
    { initialEntries: [`/studio/work/cases/${caseId}/intake?item=${selected.itemId}`] });
  await act(async () => view.render(<QueryClientProvider client={client}><RouterProvider router={router} />
  </QueryClientProvider>));
  await act(() => new Promise(resolve => setTimeout(resolve, 20)));
  return { root, unmount: () => act(async () => view.unmount()) };
}

// Every primary press on the page is counted, the step strip and the page-image choices included.
const classes = (node: FakeElement) => (node.getAttribute('class') ?? '').split(' ');
const primaries = (root: FakeElement) => elements(root)
  .filter(node => classes(node).includes('ul-btn--primary')).map(node => node.textContent);

it.each([
  { state: 'a layout to answer', items: [layout, table], selected: layout, press: 'Use this layout' },
  { state: 'a table to read', items: [layout, table], selected: table, press: 'Read as a table' },
  { state: 'packages to record', items: [answered], selected: answered, press: 'Record' },
  { state: 'a page image answered', items: [answered, image], selected: image, press: 'Record', pressed: ['Plan'] },
])('S7.23a: the batch page with $state shows one primary press', async ({ items, selected, press, pressed = [] }) => {
  const page = await renderBatch(items, selected);
  try {
    const found = primaries(page.root);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(new RegExp(`^${press}`));
    // S7.23b: the current step and a chosen answer are marks, not presses.
    const step = elements(page.root).filter(node => node.getAttribute('aria-current') === 'step');
    expect(step).toHaveLength(1);
    expect(step[0]!.tagName).toBe('BUTTON');
    expect(classes(step[0]!)).toEqual(['ul-btn']);
    const chosen = elements(page.root).filter(node => node.getAttribute('aria-pressed') === 'true');
    expect(chosen.map(node => node.textContent)).toEqual(pressed);
    for (const node of chosen) expect(classes(node)).toContain('ul-btn--soft');
    // The record press shows in every state; only the current step's press is primary.
    expect(elements(page.root).filter(node => node.tagName === 'BUTTON' && /^Record /.test(node.textContent)))
      .toHaveLength(1);
    expect(elements(page.root).find(node => node.tagName === 'H1')!.textContent).toBe('test_only batch');
  } finally { await page.unmount(); }
});

it('S7.23a: the rule names the layout, then a kept table, then the record press', () => {
  expect(primaryPress(layout, [layout, table])).toBe('layout');
  expect(primaryPress({ ...answered, plan: { recipeId: caseId, recipeRevision: 1, recipeState: 'proposed',
    origin: null, packageId: null } }, [answered])).toBe('layout');
  expect(primaryPress(table, [layout, table])).toBe('table');
  expect(primaryPress(answered, [answered])).toBe('record');
  expect(primaryPress(null, [layout, table])).toBe('record');
});

it('S7.23a: Evidence by key starts closed with its count and opens when focus is sent to it', async () => {
  const page = await renderBatch([answered], answered);
  try {
    vi.stubGlobal('document', Object.assign(Object.create(document), {
      getElementById: (id: string) => elements(page.root).find(node => node.getAttribute('id') === id) ?? null,
    }));
    const toggle = button(page.root, 'Evidence by key (1)');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(page.root.textContent).not.toContain('Link a register by a key');
    focusSection('evidence-by-key');
    const section = elements(page.root).find(node => node.getAttribute('aria-labelledby') === 'evidence-by-key')!;
    // The browser's focus event, which the fake document does not send.
    await act(async () => { propsOf(section).onFocus?.({ target: document.activeElement }); });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.getAttribute('id')).toBe('evidence-by-key');
    expect(button(page.root, 'Link a register by a key')).toBeTruthy();
    await act(async () => { propsOf(toggle).onClick?.(); });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  } finally { await page.unmount(); }
});
