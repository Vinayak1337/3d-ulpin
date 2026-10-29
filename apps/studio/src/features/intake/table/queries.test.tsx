import { container } from '../fake-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContractValidator } from '../../../local/contract';
import { streamedTable, tableKey, useTableJobs } from './queries';
import { TablePage } from './TablePage';
import { useTableData } from './useTableData';
import type { TableProfile, TableRowsPage } from './types';

const root = resolve(import.meta.dirname, '../../../../../..');
const validate = createContractValidator(JSON.parse(readFileSync(resolve(root, 'docs/api/openapi.json'), 'utf8')));
const schemas = {
  profile: 'POST_ingestion_cases_caseId_sources_Response_201_application_json',
  rows: 'GET_ingestion_cases_caseId_sources_sourceId_rows_Response_200_application_json',
};
// The table profile the server answered for the real mi-d10-02.csv (docs/evidence/gf1/ui/f3a), a development asset.
const responses = JSON.parse(readFileSync(resolve(root, 'docs/evidence/gf1/ui/f3a/table-responses.json'), 'utf8'));
const recorded: TableProfile = responses.files[0].profile;
const { caseId } = recorded, { sourceId } = recorded.source;
const MiB16 = 16 * 1024 * 1024;

// Protocol control: the same profile with a case original's pin (the windowed reader's only admission), as
// isWindowedTable reads it; nothing about the source is stated beyond the format and size under test.
function original(format: 'csv' | 'xlsx', sourceBytes: number): TableProfile {
  const selection = format === 'csv' ? recorded.tabular.selection
    : { format, sheet: 'Register', table: null, headerRows: [1] };
  return { ...recorded, tabular: { selection, sourceBytes, admission: { kind: 'case_original', issuer: null,
    origin: 'officer_supplied', licence: 'unconfirmed', containsPersonalData: 'unknown' } } } as TableProfile;
}

const rows: TableRowsPage = { caseId, sourceId, sourceRevision: 1, sourceSha256: recorded.source.sourceSha256,
  headers: recorded.headers, records: 1, rawJobId: null, mappingJobId: null,
  windows: { written: 1, mapped: 0, failed: [] }, after: -1, next: null,
  rows: [{ record: 0, sourceRow: 2, byteStart: 0, byteEnd: 10, sha256: '1'.repeat(64), sheet: 'Register',
    sheetSha256: '2'.repeat(64), marks: [{ column: 2, mark: 'formula_uncached' }],
    cells: recorded.headers.map(() => null), window: 0, mapped: null }] };

function render(profile: TableProfile) {
  expect(validate(schemas.profile, profile)).toEqual([]);
  expect(validate(schemas.rows, rows)).toEqual([]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData([...tableKey(caseId, sourceId), 'profile'], profile);
  client.setQueryData([...tableKey(caseId, sourceId), 'rows', -1], rows);
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/table/${caseId}/${sourceId}`]}>
        <Routes><Route path="/table/:caseId/:sourceId" element={<TablePage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  client.clear();
  return markup;
}

const rowsPage = 'aria-label="Table records"';

const jobs = JSON.parse(readFileSync(resolve(root, 'docs/evidence/gf-agent/ui/f2b/responses.json'), 'utf8')).files[0];
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

async function followJobs() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = createRoot(container() as never);
  function Jobs({ fallback }: { fallback: boolean }) {
    useTableJobs(caseId, sourceId, jobs.raw.jobId, jobs.mapping.jobId, fallback);
    return null;
  }
  const render = (fallback: boolean) => act(async () => view.render(
    <QueryClientProvider client={client}><Jobs fallback={fallback} /></QueryClientProvider>,
  ));
  await render(true);
  await tick(1);
  return { render, close: async () => {
    await act(async () => view.unmount());
    client.clear();
  } };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each(['completed', 'completed_with_rejections', 'failed', 'stale'])(
  'stops each fallback poll after a %s response', async status => {
    vi.useFakeTimers();
    const calls = { raw: 0, mapping: 0 };
    vi.stubGlobal('fetch', async (request: Request) => {
      const kind = request.url.includes('/streaming-vector/') ? 'raw' : 'mapping';
      calls[kind]++;
      // Recorded responses with protocol-only status transitions; no new source facts.
      return Response.json({ ...jobs[kind], status: calls[kind] === 1 ? 'running' : status });
    });
    const run = await followJobs();
    try {
      expect(calls).toEqual({ raw: 1, mapping: 1 });
      await tick(1998);
      expect(calls).toEqual({ raw: 1, mapping: 1 });
      await tick(3);
      expect(calls).toEqual({ raw: 2, mapping: 2 });
      await tick(10_000);
      expect(calls).toEqual({ raw: 2, mapping: 2 });
    } finally { await run.close(); }
  },
);

it.each(['disabled', 'unavailable', 'needs_input'])(
  'polls only open jobs with a %s mapping, then stops when the stream returns', async status => {
    vi.useFakeTimers();
    const calls = { raw: 0, mapping: 0 };
    vi.stubGlobal('fetch', async (request: Request) => {
      const kind = request.url.includes('/streaming-vector/') ? 'raw' : 'mapping';
      calls[kind]++;
      return Response.json({ ...jobs[kind], status: kind === 'raw' ? 'queued' : status });
    });
    const run = await followJobs();
    try {
      await tick(4000);
      const expected = { raw: 3, mapping: status === 'needs_input' ? 3 : 1 };
      expect(calls).toEqual(expected);
      await run.render(false);
      await tick(6000);
      expect(calls).toEqual(expected);
    } finally { await run.close(); }
  },
);

it('the table page waits for the existing source record to hold a manual profile', async () => {
  vi.stubGlobal('EventSource', class {
    addEventListener() {}
    close() {}
  });
  const asked: string[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    asked.push(new URL(request.url).pathname);
    return Response.json(recorded);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const view = createRoot(container() as never);
  function Table() { useTableData(caseId, sourceId); return null; }
  const update = async (manual: boolean) => act(async () => {
    client.setQueryData(['source-case', caseId], { sources: [{ id: sourceId, profile: 'large-original-v1',
      inspection: manual ? { manualProfile: { version: 'manual-tabular/1' } } : {} }] });
    view.render(<QueryClientProvider client={client}><MemoryRouter><Table /></MemoryRouter></QueryClientProvider>);
    await new Promise(resolve => setTimeout(resolve, 10));
  });
  try {
    await update(false);
    expect(asked).toEqual([]);
    await update(true);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(asked).toEqual([`/api/v1/ingestion/cases/${caseId}/sources/${sourceId}/profile`]);
  } finally {
    await act(async () => view.unmount());
    client.clear();
  }
});

describe('a table the server reads in windows opens the streamed rows page', () => {
  it('matches isWindowedTable: a case original CSV or workbook above 16 MiB; nothing at or below it', () => {
    expect(streamedTable(original('xlsx', MiB16 + 1))).toBe(true);
    expect(streamedTable(original('csv', MiB16 + 1))).toBe(true);
    expect(streamedTable(original('xlsx', MiB16))).toBe(false);
    expect(streamedTable(original('csv', MiB16))).toBe(false);
    expect(streamedTable(recorded)).toBe(false);
    expect(streamedTable(undefined)).toBe(false);
  });

  it('renders the rows page with its marks for a workbook above 16 MiB', () => {
    const markup = render(original('xlsx', MiB16 + 1));
    expect(markup).toContain(rowsPage);
    expect(markup).toContain('>Formula, no stored result</span>');
  });

  it('keeps the whole-read page for a workbook at or below 16 MiB', () => {
    expect(render(original('xlsx', MiB16))).not.toContain(rowsPage);
  });

  it('leaves CSV unchanged: the rows page above 16 MiB, the whole read for a development asset', () => {
    expect(render(original('csv', MiB16 + 1))).toContain(rowsPage);
    expect(render(recorded)).not.toContain(rowsPage);
  });
});
