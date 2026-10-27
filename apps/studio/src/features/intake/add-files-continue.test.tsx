import { button, container, elements, propsOf, type FakeElement } from './fake-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import batches from '../../local/data/lake-view/import-batches.json';

// The batch step reads the server; it is a stand-in that names the files it was given.
vi.mock('./IntakeDropDialog', () => ({
  IntakeDropDialog: ({ files, remainingFiles, onBack }: { files: File[]; remainingFiles: File[];
    onBack: () => void }) => <div>
    <p>{`Batch: ${files.map((file) => file.name).join(', ')}.`}</p>
    <p>{`Stay separate: ${remainingFiles.map((file) => file.name).join(', ') || 'none'}.`}</p>
    <button type="button" onClick={onBack}>Back to files</button>
  </div>,
}));

// S7.23b: each view reads its facts here; the saved batch is the local Lake View fixture, the profile check a control.
const facts = vi.hoisted(() => ({ demo: false }));
vi.mock('../../api/queries', async (original) => ({
  ...await original<typeof import('../../api/queries')>(),
  useBuildingRegister: () => ({ data: undefined }),
  useImportBatch: (id: string) => ({ isPending: false, data: (batches as Record<string, unknown>)[id] }),
  useWorkQueue: () => ({ data: { items: [] } }),
}));
vi.mock('../workflow/useWorkflow', () => ({ useBuildingActions: () => ({ data: [] }),
  useRecordAction: () => ({ mutate: vi.fn() }), useClearAction: () => ({ mutate: vi.fn() }) }));
vi.mock('../../api/demo-import', async (original) => ({
  ...await original<typeof import('../../api/demo-import')>(),
  get demoImportEnabled() { return facts.demo; },
  inspectDemoFile: async () => ({ sourceCrs: null, featureCount: null, quarantine: null }),
}));
vi.mock('./useRetainBatch', () => ({ useRetainBatch: () => ({ rows: [], pending: false, error: null,
  retain: vi.fn(), created: false, clearCreated() {} }) }));

const { AddFilesDialog } = await import('./AddFilesDialog');
const { IntakeDropDialog } = await vi.importActual<typeof import('./IntakeDropDialog')>('./IntakeDropDialog');
const press = (node: FakeElement) => act(async () => { await propsOf(node).onClick?.({}); });
const rowOf = (root: FakeElement, name: string) => elements(root)
  .find((node) => node.tagName === 'TR' && node.textContent.startsWith(name))?.textContent;

async function show(dialog: React.ReactNode) {
  const root = container();
  const view = createRoot(root as never);
  await act(async () => view.render(<QueryClientProvider client={new QueryClient()}>
    <MemoryRouter>{dialog}</MemoryRouter>
  </QueryClientProvider>));
  return { root, unmount: () => act(async () => view.unmount()) };
}

// Opened outside a batch: S7.13a, a table the batch reads still joins the batch of the drop.
const drop = (files: File[]) => show(<AddFilesDialog initialFiles={files} onClose={() => undefined} />);
const primaries = (root: FakeElement) => elements(root)
  .filter((node) => (node.getAttribute('class') ?? '').split(' ').includes('ul-btn--primary'))
  .map((node) => node.textContent);

afterEach(() => { facts.demo = false; });

// File handles only: the route is chosen from the name; no bytes are read for it.
const named = (...names: string[]) => names.map((name) => new File([], name));

it('S7.13b: a drop of a CSV and a GeoJSON opens the batch with both and renders no table-import control', async () => {
  const dialog = await drop(named('footprints.geojson', 'register.csv'));
  expect(dialog.root.textContent).toContain('Batch: register.csv, footprints.geojson.');
  expect(dialog.root.textContent).toContain('Stay separate: none.');
  await press(button(dialog.root, 'Back to files'));
  expect(rowOf(dialog.root, 'register.csv')).toContain('Table · joins the batch');
  expect(dialog.root.textContent).not.toMatch(/Import as a table|imported as a table|Open the table/);
  expect(elements(dialog.root).filter((node) => node.tagName === 'BUTTON'
    && /Continue with other files/.test(node.textContent))).toEqual([]);
  await dialog.unmount();
});

it('S7.13a: a drop of only tables the batch reads opens the batch with every file', async () => {
  const dialog = await drop(named('units.csv', 'floors.xlsx'));
  expect(dialog.root.textContent).toContain('Batch: units.csv, floors.xlsx.');
  expect(dialog.root.textContent).toContain('Stay separate: none.');
  await dialog.unmount();
});

it('S7.13a: a mixed drop puts every file in, tables first; a legacy .xls keeps its route as evidence', async () => {
  const dialog = await drop(named('footprints.geojson', 'register.csv', 'plan.pdf', 'old-list.xls', 'wards.ods'));
  expect(dialog.root.textContent)
    .toContain('Batch: register.csv, wards.ods, footprints.geojson, plan.pdf, old-list.xls.');
  expect(dialog.root.textContent).toContain('Stay separate: none.');
  await press(button(dialog.root, 'Back to files'));
  expect(rowOf(dialog.root, 'old-list.xls')).toContain('kept as evidence; its cells are not read');
  expect(rowOf(dialog.root, 'register.csv')).toContain('Table · joins the batch');
  await dialog.unmount();
});

it('S7.13a: back at the files, nothing blocks Continue, names are in the body font, and Continue reopens', async () => {
  const dialog = await drop(named('units.csv', 'floors.xlsx'));
  await press(button(dialog.root, 'Back to files'));
  expect(dialog.root.textContent).not.toContain('Blocked');
  expect(elements(dialog.root).filter((node) => node.tagName === 'BUTTON' && /Import as a table|Retain/
    .test(node.textContent))).toEqual([]);
  const mono = elements(dialog.root).filter((node) => /\bul-(id|mono)\b/.test(String(propsOf(node).className ?? ''))
    && /\.(csv|xlsx)$/.test(node.textContent));
  expect(mono).toEqual([]);
  const proceed = button(dialog.root, 'Continue');
  expect(propsOf(proceed).disabled).toBeFalsy();
  await press(proceed);
  expect(dialog.root.textContent).toContain('Batch: units.csv, floors.xlsx.');
  await dialog.unmount();
});

it.each([
  { view: 'building files', dialog: <AddFilesDialog buildingId={Object.values(batches)[0]!.buildingId}
    onClose={() => undefined} />, press: 'Start import' },
  { view: 'a saved batch', dialog: <AddFilesDialog batchId={Object.keys(batches)[0]!} onClose={() => undefined} />,
    press: 'Start import' },
  { view: 'new files before a drop', dialog: <AddFilesDialog onClose={() => undefined} />, press: 'Continue' },
  { view: 'the batch step', dialog: <IntakeDropDialog files={named('units.csv')} remainingFiles={[]} routed={false}
    onBack={() => undefined} onClose={() => undefined} />, press: 'Add 1 file' },
])('S7.23b: Add files with $view shows one primary press', async ({ dialog, press }) => {
  const shown = await show(dialog);
  expect(primaries(shown.root)).toEqual([press]);
  await shown.unmount();
});

it('S7.23b: new files keep one primary press at each step of the profile check', async () => {
  facts.demo = true;
  const dialog = await drop(named('footprints.geojson'));
  expect(primaries(dialog.root)).toEqual(['Continue']);
  await press(button(dialog.root, 'Continue'));
  expect(primaries(dialog.root)).toEqual(['Start import']);
  await dialog.unmount();
});
