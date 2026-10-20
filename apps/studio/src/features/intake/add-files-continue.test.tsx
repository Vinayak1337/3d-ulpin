import { button, container, elements, propsOf, type FakeElement } from './fake-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import type { Opened } from './table/useFollowTable';

// The table import's request and the retain step's case choice read the server; both are stand-ins here.
const facts = vi.hoisted(() => ({ imported: [] as (((opened: Opened) => void) | undefined)[] }));
vi.mock('../../api/queries', async (original) => ({
  ...await original<typeof import('../../api/queries')>(), useWorkQueue: () => ({ data: undefined }),
}));
vi.mock('./table/useRetainTable', () => ({
  useRetainTable: (...args: unknown[]) => {
    facts.imported.push(args[6] as ((opened: Opened) => void) | undefined);
    return { retain: { isPending: false, error: null, mutate() {} }, created: false, clearCreated() {},
      upload: null, retryUpload() {}, job: null };
  },
}));
vi.mock('./IntakeDropDialog', () => ({
  IntakeDropDialog: ({ files, remainingFiles, onBack }: { files: File[]; remainingFiles: File[];
    onBack: () => void }) => <div>
    <p>{`Retain: ${files.map((file) => file.name).join(', ')}.`}</p>
    <p>{`Stay separate: ${remainingFiles.map((file) => file.name).join(', ') || 'none'}.`}</p>
    <button type="button" onClick={onBack}>Back to files</button>
  </div>,
}));

const { AddFilesDialog } = await import('./AddFilesDialog');
const opened: Opened = { caseId: '04000000-0000-4000-8000-000000000001',
  sourceId: '04000000-0000-4000-8000-000000000002' };
const press = (node: FakeElement) => act(async () => { await propsOf(node).onClick?.({}); });
const buttons = (root: FakeElement, words: string) => elements(root)
  .filter((node) => node.tagName === 'BUTTON' && node.textContent === words);
const rowOf = (root: FakeElement, name: string) => elements(root)
  .find((node) => node.tagName === 'TR' && node.textContent.startsWith(name))?.textContent;

async function drop(files: File[], onRemaining = vi.fn()) {
  facts.imported = [];
  const root = container();
  const view = createRoot(root as never);
  // Opened outside a batch: a table dropped there keeps its table import.
  await act(async () => view.render(<QueryClientProvider client={new QueryClient()}>
    <MemoryRouter>
      <AddFilesDialog initialFiles={files} onRemaining={onRemaining} onClose={() => undefined} />
    </MemoryRouter>
  </QueryClientProvider>));
  return { root, onRemaining, unmount: () => act(async () => view.unmount()) };
}

it('D3: after the first table import of a multi-file drop, the other files continue from the dialog', async () => {
  const levels = new File(['level,area\n1,120\n'], 'levels.csv');
  const units = new File(['unit,level\nA,1\n'], 'units.csv');
  const dialog = await drop([levels, units]);
  await press(buttons(dialog.root, 'Import as a table')[0]!);
  // Another file of the drop waits, so the read table comes back here instead of opening its page.
  const imported = facts.imported.at(-1);
  expect(imported).toBeTypeOf('function');
  await act(async () => imported!(opened));

  expect(dialog.root.textContent).toContain('levels.csv imported as a table. The other files still wait');
  expect(rowOf(dialog.root, 'levels.csv')).toContain('Imported as a table · open the table');
  expect(rowOf(dialog.root, 'units.csv')).toContain('Table · opens the table import');
  expect(buttons(dialog.root, 'Import as a table')).toHaveLength(1);
  expect(dialog.onRemaining).toHaveBeenLastCalledWith([units]);

  // Continue takes the next file to its route; as the drop's last file, its read table opens its own page.
  await press(button(dialog.root, 'Continue with other files'));
  expect(elements(dialog.root).find((node) => node.textContent === 'units.csv')?.tagName).toBe('P');
  expect(facts.imported.at(-1)).toBeUndefined();
  await dialog.unmount();
});

it('D3: a CSV dropped with two map files joins their batch (TJ1); a table alone still opens its page', async () => {
  const csv = new File(['a,b\n1,2\n'], 'levels.csv');
  const maps = [new File(['{}'], 'footprints.geojson'), new File(['{}'], 'parcels.geojson')];
  const together = await drop([csv, ...maps]);
  expect(together.root.textContent).toContain('Retain: levels.csv, footprints.geojson, parcels.geojson.');
  expect(together.root.textContent).toContain('Stay separate: none.');
  await together.unmount();

  const alone = await drop([csv]);
  await press(button(alone.root, 'Import as a table'));
  expect(facts.imported).toEqual([undefined]);
  expect(buttons(alone.root, 'Continue with other files')).toEqual([]);
  await alone.unmount();
});
