import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { PlanReadingSection, PlanReadingSummary, planReadingWords } from './PlanReadingSection';
import { container, elements, propsOf } from './fake-dom';
import type { IntakeItem } from './batch-model';

const caseId = '10000000-0000-4000-8000-000000000001';
const itemId = '10000000-0000-4000-8000-000000000002';
// test_only: documented panel_result shape; not real plan facts.
const readings = [{ jobId: caseId, page: 1, status: 'completed', error: null,
  result: { rooms: [{ state: 'candidate' }], scale: { state: 'no_scale', metresPerPoint: null },
    sourceCitation: { locator: { unit: 'pt' } }, gaps: [] } }
] as unknown as NonNullable<IntakeItem['planReadings']>;
const item = { itemId, sourceId: itemId, parentItemId: null, format: 'png', family: 'image',
  updatedAt: 'test_only', name: 'test_only plan', planReadings: [] } as unknown as IntakeItem;
const absent = "The plan reader's model is not installed in this build.";
const flush = () => act(() => new Promise(resolve => setTimeout(resolve, 10)));

afterEach(() => vi.unstubAllGlobals());

it('names candidate rooms and no scale without claiming a record or map placement', async () => {
  expect(planReadingWords(readings[0]!)).toBe('Page 1: 1 candidate room · no scale. Review before use.');
  const root = container();
  const view = createRoot(root as never);
  await act(async () => view.render(<PlanReadingSummary readings={readings} />));
  expect(root.textContent).toContain('1 candidate room · no scale');
  expect(elements(root).some(node => node.tagName === 'A')).toBe(false);
  await act(async () => view.unmount());
});

it('links an overlay only when the stored result includes one', async () => {
  const create = vi.fn(() => 'blob:test-only-overlay');
  const revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  const withOverlay = [{ ...readings[0]!, result: { ...readings[0]!.result!,
    overlay: { base64: 'aA==', mediaType: 'image/png' as const, sha256: 'a'.repeat(64), bytes: 1,
      width: 1, height: 1 } } }];
  const root = container();
  const view = createRoot(root as never);
  await act(async () => view.render(<PlanReadingSummary readings={withOverlay} />));
  const link = elements(root).find(node => node.tagName === 'A')!;
  expect(link.textContent).toBe('View candidate room overlay');
  expect(propsOf(link).href).toBe('blob:test-only-overlay');
  await act(async () => view.unmount());
  expect(revoke).toHaveBeenCalledWith('blob:test-only-overlay');
});

it('keeps unknown scale distinct from zero and names queued and stopped work', () => {
  expect(planReadingWords({ ...readings[0]!, status: 'queued', result: null })).toContain('queued');
  expect(planReadingWords({ ...readings[0]!, status: 'failed', result: null, error: 'PLAN_READ_FAILED' }))
    .toContain('stopped');
  const scaled = { ...readings[0]!, result: { ...readings[0]!.result!,
    scale: { state: 'candidate', metresPerPoint: 0.03048 } } } as typeof readings[number];
  expect(planReadingWords(scaled)).toContain('scale from page dimensions: 0.0304800 m per page point');
});

it('hides the plan action when the model is absent and says why', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['intake', caseId, 'plan-reader', itemId, item.updatedAt],
    { available: false, reason: absent, modelSha256: null, pages: [1] });
  const root = container();
  const view = createRoot(root as never);
  await act(async () => view.render(<QueryClientProvider client={client}>
    <PlanReadingSection caseId={caseId} item={item} refresh={() => {}} />
  </QueryClientProvider>));
  expect(root.textContent).toContain(absent);
  expect(elements(root).some(node => node.tagName === 'BUTTON')).toBe(false);
  await act(async () => { view.unmount(); client.clear(); });
});

it('offers reading again only for the selected failed page, retaining the stopped words', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['intake', caseId, 'plan-reader', itemId, item.updatedAt],
    { available: true, reason: null, modelSha256: 'a'.repeat(64), pages: [1, 2, 3, 4] });
  const failed = { jobId: caseId, page: 1, status: 'failed' as const, error: 'PLAN_READ_FAILED', result: null };
  const pdf: IntakeItem = { ...item, format: 'pdf', family: 'document', planReadings: [failed,
    { ...failed, page: 2, status: 'queued', error: null }, { ...readings[0]!, page: 3 }] };
  const root = container();
  const view = createRoot(root as never);
  await act(async () => view.render(<QueryClientProvider client={client}>
    <PlanReadingSection caseId={caseId} item={pdf} refresh={() => {}} />
    <PlanReadingSummary readings={pdf.planReadings!} />
  </QueryClientProvider>));
  const button = () => elements(root).find(node => node.tagName === 'BUTTON')!;
  expect(button().textContent).toBe('Read candidate rooms again on the selected page');
  expect(propsOf(button()).disabled).toBe(false);
  expect(root.textContent).toContain('candidate room reading stopped (PLAN_READ_FAILED). Nothing was recorded.');
  expect(root.textContent).not.toContain('it will not be queued again');
  const select = elements(root).find(node => node.tagName === 'SELECT')!;
  for (const page of [2, 3, 4]) {
    await act(async () => propsOf(select).onChange?.({ target: { value: String(page) } }));
    expect(button().textContent).toBe('Read candidate rooms on the selected page');
    expect(propsOf(button()).disabled).toBe(page !== 4);
  }
  await act(async () => { view.unmount(); client.clear(); });
});

it('a stopped reading can be pressed again in the same mounted section with a fresh request key', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['intake', caseId, 'plan-reader', itemId, item.updatedAt],
    { available: true, reason: null, modelSha256: 'a'.repeat(64), pages: [1] });
  const sent: { requestKey: string; page: number }[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    sent.push(await request.json());
    return Response.json({ jobId: sent.length === 1 ? caseId : itemId, itemId, page: 1 }, { status: 202 });
  });
  const root = container();
  const view = createRoot(root as never);
  const render = async (current: IntakeItem) => act(async () => view.render(<QueryClientProvider client={client}>
    <PlanReadingSection caseId={caseId} item={current} refresh={() => {}} />
  </QueryClientProvider>));
  const button = () => elements(root).find(node => node.tagName === 'BUTTON')!;
  await render(item);
  await act(async () => propsOf(button()).onClick?.({}));
  await flush();
  const failed: IntakeItem = { ...item, planReadings: [{ jobId: caseId, page: 1, status: 'failed',
    error: 'PLAN_READ_FAILED', result: null }] };
  await render(failed);
  expect(propsOf(button()).disabled).toBe(false);
  await act(async () => propsOf(button()).onClick?.({}));
  await flush();
  expect(sent).toHaveLength(2);
  expect(sent[1]!.requestKey).not.toBe(sent[0]!.requestKey);
  expect(propsOf(button()).disabled).toBe(true);
  await render({ ...failed, planReadings: [{ ...failed.planReadings![0]!, jobId: itemId }] });
  expect(propsOf(button()).disabled).toBe(false);
  await act(async () => { view.unmount(); client.clear(); });
});

it('one press queues the selected OCR page and prevents another press for that page', async () => {
  const pdf: IntakeItem = { ...item, format: 'pdf', family: 'document' };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['intake', caseId, 'plan-reader', itemId, item.updatedAt],
    { available: true, reason: null, modelSha256: 'a'.repeat(64), pages: [2] });
  const sent: unknown[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    sent.push(await request.json());
    return Response.json({ jobId: caseId, itemId, page: 2 }, { status: 202 });
  });
  const refresh = vi.fn();
  const root = container();
  const view = createRoot(root as never);
  await act(async () => view.render(<QueryClientProvider client={client}>
    <PlanReadingSection caseId={caseId} item={pdf} refresh={refresh} />
  </QueryClientProvider>));
  const button = elements(root).find(node => node.tagName === 'BUTTON')!;
  expect(button.textContent).toBe('Read candidate rooms on the selected page');
  await act(async () => propsOf(button).onClick?.({}));
  await flush();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ page: 2 });
  expect(refresh).toHaveBeenCalled();
  expect(propsOf(elements(root).find(node => node.tagName === 'BUTTON')!).disabled).toBe(true);
  await act(async () => { view.unmount(); client.clear(); });
});
