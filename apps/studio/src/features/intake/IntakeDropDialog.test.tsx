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
const given = vi.hoisted(() => ({ files: [] as File[] }));
vi.mock('../../api/queries', async original => ({
  ...await original<typeof import('../../api/queries')>(),
  useWorkQueue: () => ({ data: { items: [{ kind: 'case', id: captured.manifest.caseId,
    name: captured.authored.destination.name }] } }),
}));
vi.mock('./useRetainBatch', () => ({ useRetainBatch: (files: File[]) => {
  given.files = files;
  return { rows: [], pending: false, error: null, retain, created: false, clearCreated() {} };
} }));
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
    const proceed = button(root, 'Add 1 file');
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

it.each([
  ['S7.13a', 'units.csv', 'floors.xlsx'], ['S7.13b', 'register.csv', 'footprints.geojson'],
])('%s: a drop of %s and %s on Add files opens the batch dialog with both and Add 2 files', async (_, ...names) => {
  // File handles only: the route is chosen from the name.
  const files = names.map(name => new File([], name));
  const root = container();
  const view = createRoot(root as never);
  const client = new QueryClient();
  try {
    await act(async () => view.render(<QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/studio/add-files']}><AddFilesRoute /></MemoryRouter>
    </QueryClientProvider>));
    const picker = elements(root).find(node => node.tagName === 'INPUT'
      && (propsOf(node) as Record<string, unknown>).type === 'file')!;
    await act(async () => { await propsOf(picker).onChange?.({ target: { files } }); });
    expect(given.files.map(file => file.name)).toEqual(names);
    expect(propsOf(button(root, 'Add 2 files')).disabled).toBe(false);
    expect(root.textContent).toContain('Reader');
    expect(root.textContent).not.toContain('Reader estimate');
    expect(root.textContent).not.toMatch(/Retain|Import as a table|Continue with other files/);
    expect(root.textContent).not.toContain('Blocked');
  } finally {
    await act(async () => view.unmount());
    client.clear();
  }
});
