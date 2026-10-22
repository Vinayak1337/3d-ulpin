import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { ApiError } from '@ulpin/api-client';
import { expect, it, vi } from 'vitest';
import { TableImportDialog } from './TableImportDialog';

const state = vi.hoisted(() => ({ error: null as Error | null }));
vi.mock('../../../api/queries', () => ({ useWorkQueue: () => ({ data: { items: [] } }) }));
vi.mock('./useRetainTable', () => ({
  useRetainTable: () => ({ retain: { error: state.error, isPending: false, mutate: vi.fn() },
    created: false, clearCreated: vi.fn(), upload: null, retryUpload: vi.fn(), job: null }),
}));

const caseId = '20000000-0000-4000-8000-000000000001';
const sourceId = '20000000-0000-4000-8000-000000000002';
const jobId = '20000000-0000-4000-8000-000000000003';
const words = 'This original is already a table; open its table page.';
const file = new File([], 'register.csv', { type: 'text/csv' });

function render(status: number, details?: unknown, message = words) {
  state.error = new ApiError(status, `/api/v1/ingestion/cases/${caseId}/sources/${sourceId}/table`, {
    error: { code: 'STALE_REVISION', message, ...(details === undefined ? {} : { details }) },
  });
  return renderToStaticMarkup(<MemoryRouter>
    <TableImportDialog file={file} onClose={vi.fn()} onBack={vi.fn()} />
  </MemoryRouter>);
}

it('TL1: the duplicate-table refusal in the dialog points to the existing table page', () => {
  const html = render(409, { existingTable: { caseId, sourceId, tableId: sourceId } });
  expect(html).toContain('This file is already read as a table in this batch.');
  expect(html).toContain(`href="/studio/work/cases/${caseId}/tables/${sourceId}"`);
  expect(html).toContain('>Open that table</a>');
  expect(html).not.toContain(words);
});

it('TL1: a queued read is not yet a table page and keeps its existing refusal words', () => {
  const message = 'This original is already being read as a table; follow that read.';
  const html = render(409, { existingTable: { caseId, sourceId, jobId } }, message);
  expect(html).toContain(`${message} (STALE_REVISION)`);
  expect(html).not.toContain('Open that table');
});

it('TL1: a 409 without details keeps today\'s words and has no table link', () => {
  const html = render(409);
  expect(html).toContain(`${words} (STALE_REVISION)`);
  expect(html).not.toContain('Open that table');
});

it('TL1: unrelated or malformed error details never replace the original refusal', () => {
  for (const html of [render(422, { existingTable: { caseId, sourceId, tableId: sourceId } }),
    render(409, { existingTable: { caseId, sourceId: '../wrong', tableId: sourceId } }),
    render(409, { existingTable: { caseId, sourceId } })]) {
    expect(html).toContain(`${words} (STALE_REVISION)`);
    expect(html).not.toContain('Open that table');
  }
});
