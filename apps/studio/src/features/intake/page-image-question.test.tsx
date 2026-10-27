import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@ulpin/api-client';
import { expect, it, vi } from 'vitest';
import { createContractValidator } from '../../local/contract';
import type { IntakeItem } from './batch-model';
import { IntakeTray } from './IntakeTray';
import { PageImageAnswer } from './PageImageQuestion';
import { createAnswerCommand, shownItem, type AnswerState, type PageImageItem } from './page-image-model';

const root = resolve(import.meta.dirname, '../../../../..');
const openapi = JSON.parse(readFileSync(resolve(root, 'docs/api/openapi.json'), 'utf8'));
const validate = createContractValidator(openapi);
const base = '/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}';
const ref = (schema: { $ref: string }) => schema.$ref.split('/').at(-1)!;
const label = openapi.paths[`${base}/page-image-label`].post;
const requestSchema = ref(label.requestBody.content['application/json'].schema);
const itemSchema = ref(label.responses['200'].content['application/json'].schema);

// Protocol control: the facts, preview and words G23's reader gives for the real CubiCasa plan PNG
// (docs/evidence/gf1/g23); only the ids are control values.
const original = 'e9d26c19e17b81235cb2050a367681e0133323c67ea359688b2ad274e38306c4';
const preview = 'e40ba0a032e7b41aa1ee7b15ee2b53f3b3c61b9f42582cc50775d350206ca237';
const words = 'A 2,776 x 1,346 PNG image, no location stated. Kept for review as a page image. What does it show: '
  + 'a plan, an elevation, a photo or something else?';
const read = { version: 'page-image-read/1', format: 'png', width: 2776, height: 1346, bands: 3, bitDepth: 8,
  orientation: null, captureTime: null, locationStated: false, dpi: null,
  preview: { key: `page-image-previews/23000000-0000-4000-8000-000000000002/${preview}.png`, sha256: preview,
    bytes: 447_567, width: 1024, height: 497, mediaType: 'image/png', orientationApplied: null,
    original: { sourceId: '23000000-0000-4000-8000-000000000002', sourceRevision: 1, sha256: original } },
  previewLimit: null, label: null } as const;
const item = { itemId: '23000000-0000-4000-8000-000000000002', sourceId: '23000000-0000-4000-8000-000000000002',
  caseId: '23000000-0000-4000-8000-000000000001', parentItemId: null, memberPath: null, name: 'F1_scaled.png',
  family: 'image', format: 'png', sizeBytes: 541_585, sizeClass: 'S', wave: 1, state: 'read',
  placement: 'needs_answer', card: null, cardSha256: null, probeVersion: null, plan: null, streamedProfileJobId: null,
  partsPlanned: null, partsDone: 0, recordsSeen: 0, limitReason: words, pinnedByOfficer: false, pageImage: read,
  createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:01.000Z' } as unknown as PageImageItem;
const idle: AnswerState = { busy: false, uncertain: false, item: null, error: '' };
const render = (shown: PageImageItem, href: string | null = 'blob:preview') => renderToStaticMarkup(
  <PageImageAnswer item={shown} preview={{ href, error: '' }} state={idle} choose={vi.fn()} />);

it('shows the preview with alt text from its format and size, the item\'s words and four choices', () => {
  expect(validate(itemSchema, item)).toEqual([]);
  const html = render(item);
  expect(html).toContain('alt="Preview of a PNG page image, 2,776 x 1,346 pixels"');
  expect(html).toContain('width="1024" height="497"');
  expect(html).toContain(words);
  expect(html).toContain('Not answered yet.');
  expect(html).toContain('role="group" aria-label="What does this page image show?"');
  expect(html.match(/<button[^>]*aria-pressed="false"/g)).toHaveLength(4);
  for (const choice of ['Plan', 'Elevation', 'Photo', 'Something else']) expect(html).toContain(`>${choice}</button>`);
});

it('without a preview it says why in the image\'s place and reads no image', () => {
  const limit = 'it could not be decoded for a preview';
  const none = { ...item, pageImage: { ...read, preview: null, previewLimit: limit } } as unknown as PageImageItem;
  expect(validate(itemSchema, none)).toEqual([]);
  const html = render(none, null);
  expect(html).not.toContain('<img');
  expect(html).toContain(`No preview: ${limit}.`);
  expect(html.match(/<button/g)).toHaveLength(4);
});

it('posts the contract body with a fresh key and shows the returned item as a candidate, not reviewed', async () => {
  const answered = { ...item, placement: 'undecided', updatedAt: '2026-10-21T00:00:02.000Z',
    pageImage: { ...read, label: { value: 'plan', state: 'candidate', answeredAt: '2026-10-21T00:00:02.000Z' } } };
  expect(validate(itemSchema, answered)).toEqual([]);
  const send = vi.fn(async (_body: unknown) => answered as unknown as IntakeItem);
  const states: AnswerState[] = [];
  const refresh = vi.fn();
  let n = 0;
  const choose = createAnswerCommand(send, state => states.push(state), refresh,
    () => `23000000-0000-4000-8000-00000000001${n++}`);
  await choose('plan');
  expect(validate(requestSchema, send.mock.calls[0]?.[0])).toEqual([]);
  expect(send.mock.calls[0]?.[0]).toEqual({ requestKey: '23000000-0000-4000-8000-000000000010', label: 'plan' });
  expect(refresh).toHaveBeenCalledTimes(1);
  const shown = shownItem(item, states.at(-1)!.item);
  const html = render(shown);
  expect(html).toContain('Answer: a plan (candidate label, not reviewed).');
  expect(html).toMatch(/aria-pressed="true"[^>]*>Plan</);
  // S7.23b: the chosen label is marked by its pressed state, never by the primary variant.
  expect(html).not.toContain('ul-btn--primary');
  expect(html.match(/class="ul-btn ul-btn--soft"/g)).toHaveLength(4);
  expect(shownItem({ ...item, updatedAt: answered.updatedAt }, states.at(-1)!.item).placement).toBe('needs_answer');
  await choose('photo');
  expect(send.mock.calls[1]?.[0]).toEqual({ requestKey: '23000000-0000-4000-8000-000000000011', label: 'photo' });
});

it('a lost answer resends the same request for the same choice; a refusal or another choice is a new key',
  async () => {
    let n = 0;
    const send = vi.fn().mockRejectedValueOnce(new TypeError('Connection lost'))
      .mockRejectedValueOnce(new ApiError(409, '', { error: { code: 'STALE_REVISION',
        message: 'This item is not a read page image waiting for an answer.' } }))
      .mockResolvedValue(item);
    const states: AnswerState[] = [];
    const choose = createAnswerCommand(send, state => states.push(state), vi.fn(), () => `key-${++n}`);
    await choose('elevation');
    expect(states.at(-1)).toMatchObject({ uncertain: true, error: 'Connection lost' });
    await choose('elevation');
    expect(states.at(-1)).toMatchObject({ uncertain: false,
      error: 'This item is not a read page image waiting for an answer.' });
    await choose('elevation');
    await choose('other');
    expect(send.mock.calls.map(call => call[0].requestKey)).toEqual(['key-1', 'key-1', 'key-2', 'key-3']);
  });

it('the tray offers View page image on the page image row only', () => {
  const other = { ...item, itemId: '23000000-0000-4000-8000-000000000009', name: 'other.csv', pageImage: undefined,
    family: 'table', format: 'csv' } as unknown as IntakeItem;
  const html = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
    <IntakeTray caseId={item.caseId} items={[item, other]} packages={[]} choose={vi.fn()} refresh={vi.fn()} />
  </MemoryRouter></QueryClientProvider>);
  expect(html.match(/>View page image</g)).toHaveLength(1);
  expect(html).toContain('aria-label="View page image: F1_scaled.png"');
});
