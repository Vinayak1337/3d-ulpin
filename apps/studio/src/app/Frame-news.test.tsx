import { container, elements } from '../features/intake/fake-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { expect, it } from 'vitest';
import captured from '../../../../docs/evidence/gf1/lq1a/controls-second.json';
import { queryKeys } from '../api/queries';
import { Frame } from './Frame';

it('shows the global waiting dot and one linked toast only after a reading advances', async () => {
  Object.assign(window, { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(queryKeys.areas, []);
  const key = queryKeys.workQueue('all', '', 1);
  const row = { id: captured.manifest.caseId, name: captured.authored.destination.name, kind: 'case' };
  const answer = (step: string, waitingBatches: number) => ({ total: 1, page: 1, pageSize: 20,
    waitingBatches, items: [{ ...row, intakeSummary: { step, waiting: waitingBatches } }] });
  client.setQueryData(key, answer('Reading', 2));
  const root = container();
  const view = createRoot(root as never);
  const statuses = () => elements(root).filter(node => node.getAttribute('role') === 'status');
  const batches = () => elements(root).find(node => node.tagName === 'A' && node.textContent === 'Batches')!;
  const update = async (step: string, waiting: number) => act(async () => {
    client.setQueryData(key, answer(step, waiting));
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  try {
    await act(async () => view.render(<QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/studio/registry']}><Frame /></MemoryRouter>
    </QueryClientProvider>));
    expect(batches().getAttribute('aria-label')).toBe('Batches, 2 need you');
    expect(batches().childNodes).toHaveLength(2);
    expect(statuses()).toHaveLength(0);
    await update('Your answers', 2);
    expect(statuses()).toHaveLength(1);
    expect(statuses()[0]!.textContent).toBe(`${row.name} · Reading done Open`);
    expect(elements(statuses()[0]!).find(node => node.tagName === 'A')?.getAttribute('href'))
      .toBe(`/studio/work/cases/${row.id}/intake`);
    await update('Your answers', 0);
    expect(statuses()).toHaveLength(1);
    expect(batches().getAttribute('aria-label')).toBe('Batches');
    expect(batches().childNodes).toHaveLength(1);
    await update('Files', 0);
    expect(statuses()).toHaveLength(1);
  } finally {
    await act(async () => view.unmount());
    client.clear();
  }
});
