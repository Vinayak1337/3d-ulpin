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

describe('BatchesPage', () => {
  it.each([item.intakeSummary, { step: 'Cards' as const, waiting: 0 }, null])(
    'reads only the work queue and draws its summary %j', (intakeSummary) => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const queue: WorkQueue = { total: 1, page: 1, pageSize: 25, items: [{ ...item, intakeSummary }] };
      client.setQueryData(queryKeys.workQueue('all', '', 1), queue);
      const markup = renderToStaticMarkup(
        <QueryClientProvider client={client}>
          <MemoryRouter><BatchesPage /></MemoryRouter>
        </QueryClientProvider>,
      );

      expect(client.getQueryCache().getAll().map((query) => query.queryKey[0])).toEqual(['work-queue']);
      const headers = [...markup.matchAll(/role="columnheader"[^>]*>([^<]+)</g)].map((match) => match[1]);
      expect(headers).toEqual(['Batch', 'Step', 'Needs you', 'Next action', 'Updated']);
      const cells = [...markup.matchAll(/role="cell"[^>]*>(.*?)<\/span>/g)].map((match) => match[1]);
      expect(cells[1]).toBe(intakeSummary?.step ?? '');
      expect(cells[2]).toBe(intakeSummary?.waiting ? String(intakeSummary.waiting) : '');
    });
});
