import { container } from './fake-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import captured from '../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import { intakeKey } from './batch-queries';
import { LayoutAnswer, type Command } from './LayoutAnswer';
import type { Recipe } from './layout-model';

it.each(['question', 'receipt'])('asks for the map profile only once its %s exists', async kind => {
  const item = captured.manifest.items[0]!;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const asked: string[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/profile')) asked.push(path);
    return Response.json(path.endsWith('/profile') ? captured.profile : {
      fields: [], drawing: { as: 'outlines' }, holds: [], links: [], question: null,
    });
  });
  const node = container(), view = createRoot(node as never);
  const command = { state: { busy: false, uncertain: false, error: '', concern: '' } } as Command;
  const update = async (layoutQuestion: boolean) => act(async () => {
    client.setQueryData(intakeKey(item.caseId), { caseId: item.caseId,
      items: [{ ...item, layoutQuestion: kind === 'question' && layoutQuestion }] });
    view.render(<QueryClientProvider client={client}>
      <LayoutAnswer caseId={item.caseId} sourceId={item.sourceId!} command={command}
        receipt={kind === 'receipt' && layoutQuestion ? captured.authored as Recipe : undefined} />
    </QueryClientProvider>);
    await new Promise(resolve => setTimeout(resolve, 10));
  });
  try {
    await update(false);
    expect(asked).toEqual([]);
    await update(true);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(asked).toEqual([`/api/v1/ingestion/cases/${item.caseId}/sources/${item.sourceId}/profile`]);
    expect(node.textContent).toContain('Use this layout');
  } finally {
    await act(async () => view.unmount());
    client.clear();
    vi.unstubAllGlobals();
  }
});
