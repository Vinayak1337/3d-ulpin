import { container, elements } from './fake-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { createContractValidator } from '../../local/contract';
import type { IntakeItem } from './batch-model';
import { BatchTableSection, createItemTableRead, itemTableSource, ReadAsTableForm, ReadTable,
  type ItemTableSource } from './BatchTableSection';
import { tableKey } from './table/queries';
import type { TableFromOriginalBody } from './table/retain';
import type { TableJob } from './table/types';
import { followTable, jobWords, tablePath } from './table/useFollowTable';

const root = resolve(import.meta.dirname, '../../../../..');
const openapi = JSON.parse(readFileSync(resolve(root, 'docs/api/openapi.json'), 'utf8'));
const validate = createContractValidator(openapi);
const schemas = {
  manifest: 'GET_ingestion_cases_caseId_intake_Response_200_application_json',
  request: 'POST_ingestion_cases_caseId_sources_sourceId_table_Request_application_json',
  table: 'POST_ingestion_cases_caseId_sources_Response_201_application_json',
  job: 'POST_ingestion_cases_caseId_sources_sourceId_table_Response_202_application_json',
};

// The table profile the server answered for the real mi-d10-02.csv (docs/evidence/gf1/ui/f3a); ids are its controls.
const responses = JSON.parse(readFileSync(resolve(root, 'docs/evidence/gf1/ui/f3a/table-responses.json'), 'utf8'));
const profile = responses.files[0].profile;
const caseId: string = profile.caseId;
const sourceId: string = profile.source.sourceId;
const fixture = (name: string) => readFileSync(resolve(root, 'fixtures/usp/D8-messy-india/dev/d1b', name));
const csvBytes = fixture('mi-d10-02.csv');
// mi-d19-01.xlsx states one sheet, T_18 (its xl/workbook.xml).
const xlsxBytes = fixture('mi-d19-01.xlsx');
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const id = (n: number) => `10000000-0000-4000-8000-00000000000${n}`;

// Protocol control: the card states only the format, family, sheets and delimiter; what the probe would add is
// left not known.
function card(format: string, family: string, sheets: string[] = []) {
  return { version: 'intake-card/1', family, format, formatVersion: null, detectedBy: 'bytes_and_name',
    nameDisagrees: false, depth: 'structure', encoding: null,
    crs: { state: 'not_applicable', code: null, sidecarSha256: null }, extent: { native: null, epsg4326: null },
    counts: { features: null, rows: null, pages: null, members: null, points: null, bands: null },
    geometryTypes: [], layers: [], sheets: sheets.map((name) => ({ name, count: null })), columns: [], limits: [],
    probeBytesRead: 0, probeMs: 0, drawableHint: false, delimiter: format === 'csv' ? ',' : null, encrypted: null,
    raster: null, point: null, citations: [], members: [] };
}
function item(fields: Partial<IntakeItem> & Pick<IntakeItem, 'itemId' | 'name'>, bytes: Buffer | null): IntakeItem {
  return { sourceId: null, caseId, parentItemId: null, memberPath: null, family: 'table', format: 'csv',
    sizeBytes: bytes?.length ?? null, sizeClass: 'S', wave: 3, state: 'probed', placement: 'undecided', card: null,
    cardSha256: bytes ? sha(bytes) : null, plan: null, streamedProfileJobId: null, probeVersion: 'intake-card/1',
    partsPlanned: null, partsDone: 0, recordsSeen: 0, limitReason: null, pinnedByOfficer: false,
    createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:01.000Z', ...fields } as IntakeItem;
}
const csv = item({ itemId: id(1), sourceId, name: 'mi-d10-02.csv', card: card('csv', 'table') } as never, csvBytes);
const workbook = item({ itemId: id(2), sourceId: id(9), name: 'mi-d19-01.xlsx', format: 'xlsx',
  card: card('xlsx', 'table', ['T_18']) } as never, xlsxBytes);
const sheet = item({ itemId: id(3), parentItemId: id(2), memberPath: 'T_18', name: 'T_18', format: 'xlsx',
  sizeBytes: null, sizeClass: null, card: card('xlsx', 'table', ['T_18']) } as never, null);
const zip = item({ itemId: id(4), sourceId: id(8), name: 'tables.zip', family: 'archive', format: 'zip',
  card: card('zip', 'archive') } as never, null);
const zipped = item({ itemId: id(5), parentItemId: id(4), memberPath: 'mi-d10-02.csv', name: 'mi-d10-02.csv',
  card: card('csv', 'table') } as never, null);
const geojson = item({ itemId: id(6), sourceId: id(7), name: 'wards.geojson', family: 'vector', format: 'geojson',
  card: card('geojson', 'vector') } as never, null);
const items = [csv, workbook, sheet, zip, zipped, geojson];

type Answer = { status: number; body: unknown } | Error;
function stubServer(answers: Answer[]) {
  const bodies: TableFromOriginalBody[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    if (request.method === 'GET') return Response.json({ case: { id: caseId, revision: 7, siteId: null } });
    expect(new URL(request.url).pathname).toBe(`/api/v1/ingestion/cases/${caseId}/sources/${sourceId}/table`);
    bodies.push(await request.json());
    const answer = answers.shift()!;
    if (answer instanceof Error) throw answer;
    return Response.json(answer.body, { status: answer.status });
  });
  return bodies;
}
function reader(source: ItemTableSource = itemTableSource(csv, items)!) {
  const seen: TableJob[] = [];
  const follow = (c: string, s: string, body: TableFromOriginalBody, stopped: () => void) =>
    followTable(c, s, body, (job) => seen.push(job), stopped, new AbortController().signal);
  return { send: createItemTableRead(caseId, source, follow), seen };
}
const job = (status: TableJob['status'], issueCode: string | null = null, message: string | null = null) => ({
  version: 'table-profile/1', jobId: id(0), caseId, sourceId, sourceRevision: 1, status, issueCode, message });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('offers a kept CSV or workbook by its card, a workbook sheet through its workbook, and nothing else', () => {
  expect(validate(schemas.manifest, { caseId, items })).toEqual([]);
  expect(itemTableSource(csv, items)).toEqual({ sourceId, format: 'csv', sheets: [] });
  expect(itemTableSource(workbook, items)).toEqual({ sourceId: id(9), format: 'xlsx', sheets: ['T_18'] });
  expect(itemTableSource(sheet, items)).toEqual({ sourceId: id(9), format: 'xlsx', sheets: ['T_18'] });
  expect(itemTableSource({ ...csv, name: 'renamed.txt' }, items)?.format).toBe('csv');
  const named = { ...csv, name: 'wards.csv', card: geojson.card };
  for (const other of [zip, zipped, geojson, { ...csv, card: null }, named]) {
    expect(itemTableSource(other, items)).toBeNull();
    expect(renderToStaticMarkup(<MemoryRouter><BatchTableSection caseId={caseId} item={other} items={items} />
    </MemoryRouter>)).toBe('');
  }
});

it('an ODS card offers its stated sheets through the parent original, as an XLSX card does', () => {
  const ods = { ...workbook, format: 'ods', card: card('ods', 'table', ['Wards', 'Notes']) } as IntakeItem;
  const child = { ...sheet, format: 'ods', memberPath: 'Wards', card: card('ods', 'table', ['Wards']) } as IntakeItem;
  const source = itemTableSource(child, [ods, child])!;
  expect(source).toEqual({ sourceId: workbook.sourceId, format: 'ods', sheets: ['Wards'] });
  expect(itemTableSource(ods, [ods, child])?.sheets).toEqual(['Wards', 'Notes']);
  const html = renderToStaticMarkup(<ReadAsTableForm source={source} sheet="Wards" rows="1" setSheet={vi.fn()}
    setRows={vi.fn()} pending={false} submit={vi.fn()} reading={null} error={null} />);
  expect(html).toContain('<option value="Wards">');
  expect(html).toContain('The file&#x27;s card states this sheet: Wards.');
});

it('a CSV item reads as a table in one request with a fresh key and the workspace revision, then opens', async () => {
  expect(validate(schemas.table, profile)).toEqual([]);
  const bodies = stubServer([{ status: 201, body: profile }]);
  const opened = await reader().send('', '');
  expect(bodies).toHaveLength(1);
  expect(validate(schemas.request, bodies[0])).toEqual([]);
  expect(bodies[0]).toMatchObject({ expectedWorkspaceRevision: 7,
    selection: { format: 'csv', sheet: 'csv', table: null, headerRows: [1] } });
  expect(tablePath(opened)).toBe(`/studio/work/cases/${caseId}/tables/${sourceId}`);
});

it('TJ1: a CSV item reads in its batch case once the batch is bound to a site; an archived case refuses', async () => {
  const bodies: TableFromOriginalBody[] = [];
  let detail: Record<string, unknown> = { id: caseId, revision: 9, siteId: id(8), archived: false };
  vi.stubGlobal('fetch', async (request: Request) => {
    if (request.method === 'GET') return Response.json({ case: detail });
    expect(new URL(request.url).pathname).toBe(`/api/v1/ingestion/cases/${caseId}/sources/${sourceId}/table`);
    bodies.push(await request.json());
    return Response.json(profile, { status: 201 });
  });
  const opened = await reader().send('', '');
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ expectedWorkspaceRevision: 9 });
  expect(tablePath(opened)).toBe(`/studio/work/cases/${caseId}/tables/${sourceId}`);
  detail = { ...detail, archived: true };
  await expect(reader().send('', '')).rejects.toThrow('This batch case is archived');
  expect(bodies).toHaveLength(1);
});

it('a large CSV item gets its job, is followed with the same request until it succeeds, then opens', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  // test_only: job answers built to the 202 contract; no large CSV is generated here.
  const answers = [job('queued'), job('running'), job('succeeded')];
  for (const answer of answers) expect(validate(schemas.job, answer)).toEqual([]);
  const bodies = stubServer(answers.map((body) => ({ status: 202, body })));
  const { send, seen } = reader();
  const pending = send('', '');
  await vi.advanceTimersByTimeAsync(4000);
  const opened = await pending;
  expect(seen.map((row) => row.status)).toEqual(['queued', 'running', 'succeeded']);
  expect(new Set(bodies.map((body) => body.requestKey)).size).toBe(1);
  expect(seen.map((job) => jobWords(job, 'CSV'))[0]).toContain('queued on the server');
  expect(tablePath(opened)).toBe(`/studio/work/cases/${caseId}/tables/${sourceId}`);
});

it('a refusal shows the server\'s words and the next press is a new request; a lost answer keeps its key',
  async () => {
    const refusal = { error: { code: 'CONFLICT', message: 'This original is already a table; open its table page.' } };
    const bodies = stubServer([{ status: 409, body: refusal }, new TypeError('Network response was lost.'),
      { status: 202, body: job('failed', 'TABULAR_CSV_MALFORMED', 'The CSV has an unclosed quote.') },
      { status: 201, body: profile }]);
    const { send } = reader();
    const error = await send('', '').then(() => null, (value: Error) => value);
    if (!error) throw new Error('The refusal was not raised.');
    expect(error.message).toBe(refusal.error.message);
    const html = renderToStaticMarkup(<ReadAsTableForm source={itemTableSource(csv, items)!} sheet="" rows=""
      setSheet={vi.fn()} setRows={vi.fn()} pending={false} submit={vi.fn()} reading={null} error={error} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain(`${refusal.error.message} (CONFLICT)`);
    await expect(send('', '')).rejects.toThrow('Network response was lost.');
    await expect(send('', '')).rejects.toThrow('The CSV has an unclosed quote. (TABULAR_CSV_MALFORMED)');
    await send('', '');
    const keys = bodies.map((body) => body.requestKey);
    expect(keys[1]).not.toBe(keys[0]);
    expect(keys[2]).toBe(keys[1]);
    expect(keys[3]).not.toBe(keys[2]);
  });

it('a workbook item names its stated sheet and refuses header rows before any request', async () => {
  const bodies = stubServer([]);
  const source = itemTableSource(sheet, items)!;
  await expect(reader(source).send('T_18', '')).rejects.toThrow('increasing header row numbers');
  expect(bodies).toHaveLength(0);
  const html = renderToStaticMarkup(<ReadAsTableForm source={source} sheet="T_18" rows="4,5" setSheet={vi.fn()}
    setRows={vi.fn()} pending={false} submit={vi.fn()} reading={null} error={null} />);
  expect(html).toContain('<option value="T_18">');
  expect(html).toContain('The file&#x27;s card states this sheet: T_18.');
  expect(html).toMatch(/<button type="submit"[^>]*>Read as a table<\/button>/);
});

it.each(['utf-16le', 'utf-16be'] as const)('a batch BOM %s table offers placement', encoding => {
  // Protocol control: the BOM reader's pinned encoding on the captured table profile.
  const client = new QueryClient();
  client.setQueryData([...tableKey(caseId, sourceId), 'profile'], { ...profile,
    tabular: { ...profile.tabular, selection: { ...profile.tabular.selection, encoding } } });
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter>
    <BatchTableSection caseId={caseId} item={csv} items={items} />
  </MemoryRouter></QueryClientProvider>);
  expect(html).toContain('>Place on the map</button>');
  expect(html).toContain('>Open the table</a>');
  expect(html).not.toContain('Save the table as CSV UTF-8');
  client.clear();
});

it('an item whose source is already a table links to its table page', () => {
  const html = renderToStaticMarkup(<MemoryRouter><ReadTable opened={{ caseId, sourceId }} /></MemoryRouter>);
  expect(html).toContain(`href="/studio/work/cases/${caseId}/tables/${sourceId}"`);
  expect(html).toContain('>Open the table</a>');
});

// The server's own words for a table it reads by itself (intake-draft.ts queueBatchTableTx), as its record holds.
const serverReading = 'The table is being read. Its field meanings will be proposed for your review; nothing is '
  + 'recorded until you confirm it.';
/** Mounts the section and answers each profile read in turn; the item can be rendered again as the stream would. */
async function mountSection(first: IntakeItem, answers: { status: number; body: unknown }[]) {
  const asked: string[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    asked.push(new URL(request.url).pathname);
    const answer = answers.shift()!;
    return Response.json(answer.body, { status: answer.status });
  });
  const client = new QueryClient();
  const node = container();
  const view = createRoot(node as never);
  const render = async (row: IntakeItem) => {
    await act(async () => view.render(<QueryClientProvider client={client}>
      <MemoryRouter><BatchTableSection caseId={caseId} item={row} items={[row]} /></MemoryRouter>
    </QueryClientProvider>));
    await act(async () => { await new Promise((settled) => setTimeout(settled, 0)); });
  };
  await render(first);
  const close = () => act(async () => {
    view.unmount();
    client.clear();
  });
  const presses = () => elements(node).filter((element) => element.tagName === 'BUTTON')
    .map((element) => element.textContent.trim());
  const record = async () => act(async () => {
    client.setQueryData(['source-case', caseId], { sources: [{ id: first.sourceId,
      inspection: { manualProfile: { version: 'manual-tabular/1' } } }] });
    await new Promise(settled => setTimeout(settled, 10));
  });
  return { render, record, asked, node, presses, close };
}

it('a CSV the server is reading shows its record words and no press, then its table once read', async () => {
  const reading = { ...csv, state: 'reading', limitReason: serverReading } as IntakeItem;
  const view = await mountSection(reading, [{ status: 200, body: profile }]);
  expect(view.asked).toEqual([]);
  const status = elements(view.node).filter((element) => element.getAttribute('role') === 'status');
  expect(status.map((element) => element.textContent)).toEqual([serverReading]);
  expect(view.presses()).not.toContain('Read as a table');
  await view.render({ ...reading, state: 'read', limitReason: null, updatedAt: '2026-10-21T00:00:02.000Z' });
  expect(view.asked).toEqual([`/api/v1/ingestion/cases/${caseId}/sources/${sourceId}/profile`]);
  expect(view.node.textContent).toContain('Open the table');
  expect(view.presses()).toContain('Place on the map');
  await view.close();
});

it('a two-sheet workbook being read shows the server words; a probed CSV keeps the press', async () => {
  const twoSheets = { ...workbook, state: 'reading', limitReason: serverReading,
    card: card('xlsx', 'table', ['T_18', 'Notes']) } as IntakeItem;
  const reading = await mountSection(twoSheets, []);
  expect(reading.asked).toEqual([]);
  expect(reading.presses()).not.toContain('Read as a table');
  expect(reading.node.textContent).toContain(serverReading);
  await reading.close();
  const waiting = await mountSection(csv, []);
  expect(waiting.presses()).toContain('Read as a table');
  expect(waiting.asked).toEqual([]);
  await waiting.render({ ...csv, state: 'reading' });
  expect(waiting.asked).toEqual([]);
  await waiting.close();
  const inventoried = await mountSection({ ...twoSheets, state: 'read', limitReason: null }, []);
  expect(inventoried.asked).toEqual([]);
  expect(inventoried.presses()).toContain('Read as a table');
  await inventoried.close();
});

it('a workbook candidate can be changed with the current sheet and header rows filled in', async () => {
  const read = { ...profile, tabular: { ...profile.tabular,
    selection: { format: 'xlsx', sheet: 'T_18', table: null, headerRows: [4, 5] } } };
  const view = await mountSection({ ...workbook, state: 'read' } as IntakeItem, [{ status: 200, body: read }]);
  expect(view.asked).toEqual([]);
  expect(view.presses()).toContain('Read as a table');
  await view.record();
  await act(async () => { await new Promise(settled => setTimeout(settled, 10)); });
  expect(view.asked).toHaveLength(1);
  expect(view.node.textContent).toContain('Change sheet or header rows');
  expect(view.presses()).toContain('Read as a table');
  const inputs = elements(view.node).filter(element => element.tagName === 'INPUT');
  expect(inputs.some(element => (element as unknown as HTMLInputElement).value === '4, 5')).toBe(true);
  await view.close();
});
