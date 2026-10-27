import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryKeys, type WorkItem, type WorkQueue } from '../../api/queries';
import { BatchesPage } from './BatchesPage';

// Shape-only row: every value below is a structural placeholder for the page under test, not a record.
const item: WorkItem = {
  id: 'id', kind: 'case', name: 'name', areaId: null, areaName: null, dataKind: null, buildingId: null, sourceCount: 0,
  updatedAt: '2026-09-26T00:00:00Z', state: null, jobStatus: null, recordedHistory: false, currentRecorded: false,
  provenance: { classification: 'unknown', basis: 'legacy_default' },
  intakeSummary: { step: 'Your answers', waiting: 3 },
};

function render(intakeSummary: WorkItem['intakeSummary']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const queue: WorkQueue = { total: 1, page: 1, pageSize: 25, waitingBatches: 0, items: [{ ...item, intakeSummary }] };
  client.setQueryData(queryKeys.workQueue('all', '', 1), queue);
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter><BatchesPage /></MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, markup };
}

describe('BatchesPage', () => {
  it.each([{ step: 'Confirm' as const, waiting: 0 }, null])(
    'reads only the work queue and keeps a step that is no chip state as text %j', (intakeSummary) => {
      const { client, markup } = render(intakeSummary);
      expect(client.getQueryCache().getAll().map((query) => query.queryKey[0])).toEqual(['work-queue']);
      const headers = [...markup.matchAll(/role="columnheader"[^>]*>([^<]+)</g)].map((match) => match[1]);
      expect(headers).toEqual(['Batch', 'Step', 'Needs you', 'Next action', 'Updated']);
      expect(markup).toContain(`<span role="cell">${intakeSummary?.step ?? ''}</span><span role="cell"></span>`);
      expect(markup).not.toContain('ul-badge');
    });

  it.each([
    [{ step: 'Your answers' as const, waiting: 2 }, 'ul-badge--warning', 'Needs you', '2'],
    [{ step: 'Cards' as const, waiting: 0 }, 'ul-badge--success', 'Ready', ''],
  ])('draws the step of %j as one chip and keeps the waiting number', (intakeSummary, tone, word, waiting) => {
    const { markup } = render(intakeSummary);
    const step = new RegExp(`<span role="cell"><span class="ul-badge ${tone}">.*?${word}</span></span>`
      + `<span role="cell">${waiting}</span>`);
    expect(markup).toMatch(step);
  });
});
