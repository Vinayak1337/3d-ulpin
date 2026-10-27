import { button, container, elements, propsOf } from './fake-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { formatDateTime } from '@ulpin/ui';
import captured from '../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import { IntakeDropDialog } from './IntakeDropDialog';
import { AddFilesRoute } from './AddFilesRoute';

const retain = vi.hoisted(() => vi.fn());
vi.mock('../../api/queries', async original => ({
  ...await original<typeof import('../../api/queries')>(),
  useWorkQueue: () => ({ data: { items: [{ kind: 'case', id: captured.manifest.caseId,
    name: captured.authored.destination.name }] } }),
}));
vi.mock('./useRetainBatch', () => ({ useRetainBatch: () => ({ rows: [], pending: false,
  error: null, retain, created: false, clearCreated() {} }) }));
vi.mock('../batches/BatchesPage', () => ({ BatchesPage: () => null }));

afterEach(() => { vi.useRealTimers(); retain.mockClear(); });

it.each(['dialog', 'Add files page'])('%s suggests a dated name and warns without blocking a duplicate', async mode => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-24T08:40:00Z'));
  const file = new File([''], 'buildings.geojson');
  const root = container();
  const view = createRoot(root as never);
  const client = new QueryClient();
  try {
    await act(async () => view.render(<QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/studio/add-files']}>
        {mode === 'dialog' ? <IntakeDropDialog files={[file]} remainingFiles={[]} routed
          onClose={() => undefined} onBack={() => undefined} /> : <AddFilesRoute />}
      </MemoryRouter>
    </QueryClientProvider>));
    if (mode !== 'dialog') {
      const picker = elements(root).find(node => node.tagName === 'INPUT'
        && (propsOf(node) as Record<string, unknown>).type === 'file')!;
      await act(async () => { await propsOf(picker).onChange?.({ target: { files: [file] } }); });
    }
    const name = () => elements(root).find(node => node.tagName === 'INPUT' && node.getAttribute('maxLength') === '200')!;
    expect(propsOf(name()).value).toBe(`buildings ${formatDateTime(new Date().toISOString())}`);
    await act(async () => { await propsOf(name()).onChange?.({ target: {
      value: captured.authored.destination.name.toUpperCase(),
    } }); });
    expect(elements(root).filter(node => node.textContent === 'Another batch has this name')).toHaveLength(1);
    const proceed = button(root, 'Retain files and open batch');
    expect(propsOf(proceed).disabled).toBe(false);
    await act(async () => { await propsOf(proceed).onClick?.({}); });
    expect(retain).toHaveBeenCalledOnce();
    await act(async () => { await propsOf(name()).onChange?.({ target: { value: 'buildings' } }); });
    expect(root.textContent).not.toContain('Another batch has this name');
  } finally {
    await act(async () => view.unmount());
    client.clear();
  }
});
