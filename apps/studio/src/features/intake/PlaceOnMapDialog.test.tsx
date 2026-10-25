import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiError } from '@ulpin/api-client';
import { afterEach, expect, it, vi } from 'vitest';
import captured from '../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import { createContractValidator } from '../../local/contract';
import type { IntakeItem } from './batch-model';
import { placeTableOnMap } from './batch-queries';
import { PlaceOnMap, PlaceOnMapForm } from './PlaceOnMapDialog';
import { createTablePlacementCommand, emptyTablePlacement, tablePlacementPress, UNSTATED_CRS,
  type TablePlacementBody, type TablePlacementForm, type TablePlacementState } from './table-placement-command';

const root = resolve(import.meta.dirname, '../../../../..');
const openapi = JSON.parse(readFileSync(resolve(root, 'docs/api/openapi.json'), 'utf8'));
const validate = createContractValidator(openapi);
const route = openapi.paths['/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/table-placement'].post;
const ref = (schema: { $ref: string }) => schema.$ref.split('/').at(-1)!;
const requestSchema = ref(route.requestBody.content['application/json'].schema);
const itemSchema = ref(route.responses['200'].content['application/json'].schema);
// The headers the server read from the real mi-d10-02.csv (docs/evidence/gf1/ui/f3a); the item is LQ1a's captured row.
const responses = JSON.parse(readFileSync(resolve(root, 'docs/evidence/gf1/ui/f3a/table-responses.json'), 'utf8'));
const headers: string[] = responses.files[0].profile.headers;
const item = { ...captured.manifest.items[0], streamedProfileJobId: null } as unknown as IntakeItem;
const idle: TablePlacementState = { busy: false, uncertain: false, error: '', started: false };
const form = (fields: Partial<TablePlacementForm>) => ({ ...emptyTablePlacement, ...fields });

afterEach(() => vi.unstubAllGlobals());

function command(send: (body: TablePlacementBody) => Promise<unknown>) {
  let n = 0;
  const states: TablePlacementState[] = [];
  const refresh = vi.fn();
  const place = createTablePlacementCommand(send, state => states.push(state), refresh, () =>
    `30000000-0000-4000-8000-00000000000${++n}`);
  return { place, states, refresh };
}

it('sends the stated columns and code as the contract body to the item route, then refreshes the batch', async () => {
  const bodies: unknown[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname)
      .toBe(`/api/v1/ingestion/cases/${item.caseId}/intake/items/${item.itemId}/table-placement`);
    bodies.push(await request.json());
    return Response.json(item);
  });
  expect(validate(itemSchema, item)).toEqual([]);
  const { place, states, refresh } = command(body => placeTableOnMap(item.caseId, item.itemId, body));
  await place(form({ x: '3', y: '2', crs: ' epsg:4326 ' }));
  await place(form({ kind: 'wkt', column: '1', crs: 'EPSG:32643' }));
  expect(bodies).toEqual([
    { requestKey: '30000000-0000-4000-8000-000000000001', coordinates: { kind: 'columns', x: 3, y: 2 },
      crs: 'EPSG:4326', decimalMark: 'point' },
    { requestKey: '30000000-0000-4000-8000-000000000002', coordinates: { kind: 'wkt', column: 1 },
      crs: 'EPSG:32643', decimalMark: 'point' }]);
  for (const body of bodies) expect(validate(requestSchema, body)).toEqual([]);
  expect(states.at(-1)).toEqual({ ...idle, started: true });
  expect(refresh).toHaveBeenCalledTimes(2);
});

it('S5.7b: sends the stated decimal mark for x and y columns; WKT text always goes with a point', async () => {
  const send = vi.fn(async (_body: TablePlacementBody) => item);
  const { place } = command(send);
  await place(form({ x: '3', y: '2', crs: 'EPSG:4326', decimalMark: 'comma' }));
  await place(form({ kind: 'wkt', column: '1', crs: 'EPSG:32643', decimalMark: 'comma' }));
  const bodies = send.mock.calls.map(call => call[0]);
  expect(bodies.map(body => body.decimalMark)).toEqual(['comma', 'point']);
  for (const body of bodies) expect(validate(requestSchema, body)).toEqual([]);
});

it('S5.7b: after a lost answer, only another decimal mark is a new key; the same choice keeps its key', async () => {
  const send = vi.fn().mockRejectedValueOnce(new TypeError('Connection lost'))
    .mockRejectedValueOnce(new TypeError('Connection lost')).mockResolvedValue(item);
  const { place } = command(send);
  const point = form({ x: '3', y: '2', crs: 'EPSG:4326' });
  await place(point);
  await place({ ...point, decimalMark: 'comma' });
  await place({ ...point, decimalMark: 'comma' });
  expect(send.mock.calls.map(call => [call[0].requestKey, call[0].decimalMark])).toEqual([
    ['30000000-0000-4000-8000-000000000001', 'point'], ['30000000-0000-4000-8000-000000000002', 'comma'],
    ['30000000-0000-4000-8000-000000000002', 'comma']]);
});

it('asks for the coordinate system and the columns before any request; nothing is assumed', async () => {
  const send = vi.fn(async () => item);
  const { place, states } = command(send);
  await place(form({ x: '3', y: '2' }));
  expect(states.at(-1)?.error).toBe(UNSTATED_CRS);
  await place(form({ x: '3', y: '2', crs: '4326' }));
  expect(states.at(-1)?.error).toBe('Write the code as EPSG and its number, for example EPSG:32643.');
  await place(form({ x: '3', crs: 'EPSG:4326' }));
  expect(states.at(-1)?.error).toBe('Choose the column of x or longitude and the column of y or latitude.');
  await place(form({ x: '3', y: '3', crs: 'EPSG:4326' }));
  expect(states.at(-1)?.error).toBe('Choose two different columns for x and y.');
  await place(form({ kind: 'wkt', x: '3', y: '2', crs: 'EPSG:4326' }));
  expect(states.at(-1)?.error).toBe('Choose the column that holds the WKT text.');
  expect(send).not.toHaveBeenCalled();
});

it('a lost answer resends the same key; a refusal shows its words; another choice is a new request', async () => {
  const refusal = new ApiError(409, '', { error: { code: 'TABLE_PLACEMENT_NOT_READ',
    message: 'Read this file as a table first; its rows are placed from the columns of that read.' } });
  const send = vi.fn().mockRejectedValueOnce(new TypeError('Connection lost')).mockRejectedValueOnce(refusal)
    .mockResolvedValue(item);
  const { place, states } = command(send);
  const choice = form({ x: '3', y: '2', crs: 'EPSG:4326' });
  await place(choice);
  expect(states.at(-1)).toMatchObject({ uncertain: true, error: 'Connection lost' });
  expect(tablePlacementPress(states.at(-1)!)).toBe('Send the same answer again');
  await place(choice);
  expect(states.at(-1)).toMatchObject({ uncertain: false, error: refusal.message });
  expect(tablePlacementPress(states.at(-1)!)).toBe('Place on the map');
  await place(form({ x: '2', y: '3', crs: 'EPSG:4326' }));
  expect(send.mock.calls.map(call => call[0].requestKey)).toEqual([
    '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002']);
});

it('the dialog offers the read headers by position, preselects no column or system, and states its start', () => {
  expect(renderToStaticMarkup(<PlaceOnMap caseId={item.caseId} itemId={item.itemId} name="mi-d10-02.csv"
    headers={headers} />)).toMatch(/<button[^>]*>Place on the map<\/button>/);
  const markup = (fields: Partial<TablePlacementForm>, state = idle) => renderToStaticMarkup(
    <PlaceOnMapForm headers={headers} form={form(fields)} change={vi.fn()} state={state} submit={vi.fn()}
      close={vi.fn()} />);
  const html = markup({});
  expect(html).toContain('aria-label="x or longitude"');
  expect(html).toContain('aria-label="y or latitude"');
  expect(html).not.toContain('aria-label="WKT column"');
  expect(html).toContain(`<option value="1">2. ${headers[1]}</option>`);
  expect(html.match(/<option value="" selected="">Choose a field<\/option>/g)).toHaveLength(2);
  expect(html).toMatch(/<span class="ul-label">EPSG code<\/span><input[^>]*value=""\/>/);
  expect(html).not.toContain('placeholder=');
  expect(html).not.toContain('class="ul-help"');
  // S5.7b: the officer states the decimal mark of x and y cells, point at first; WKT offers no choice.
  expect(html).toContain('<legend class="ul-label">Decimal mark</legend>');
  expect(html).toMatch(/<input type="radio"[^>]*checked="" value="point"\/>Point \(12\.34\)/);
  expect(html).toMatch(/<input type="radio"[^>]*value="comma"\/>Comma \(12,34\)/);
  expect(markup({ decimalMark: 'comma' })).toMatch(/checked="" value="comma"/);
  const wkt = markup({ kind: 'wkt', decimalMark: 'comma' });
  expect(wkt).toContain('aria-label="WKT column"');
  expect(wkt).not.toContain('type="radio"');
  expect(markup({}, { ...idle, error: UNSTATED_CRS })).toContain('role="alert"');
  const started = markup({}, { ...idle, started: true });
  expect(started).toContain('role="status"');
  // The start promises a GeoJSON file, not the map: only that file's own line says whether it is on the map.
  expect(started).toContain('Preparing the rows of this table as a GeoJSON file has started.');
  expect(started).not.toMatch(/rows were placed|on the map has started/);
});
