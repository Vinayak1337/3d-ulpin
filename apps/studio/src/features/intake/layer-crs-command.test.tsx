import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiError } from '@ulpin/api-client';
import { expect, it, vi } from 'vitest';
import captured from '../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import { createContractValidator } from '../../local/contract';
import type { IntakeItem } from './batch-model';
import { LayerCrsAnswers } from './LayerCrsAnswer';
import { createLayerCrsCommand, layerCrsCode, layerCrsWords, type LayerCrsBody, type LayerCrsState }
  from './layer-crs-command';

// The item is LQ1a's captured manifest row; its layer answers are set and the later streamed-profile field is empty.
const root = resolve(import.meta.dirname, '../../../../..');
const openapi = JSON.parse(readFileSync(resolve(root, 'docs/api/openapi.json'), 'utf8'));
const validate = createContractValidator(openapi);
const route = openapi.paths['/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/layer-crs'].post;
const ref = (schema: { $ref: string }) => schema.$ref.split('/').at(-1)!;
const requestSchema = ref(route.requestBody.content['application/json'].schema);
const itemSchema = ref(route.responses['200'].content['application/json'].schema);
const statedAt = '2026-10-21T10:00:00.000Z';
const item = { ...captured.manifest.items[0], streamedProfileJobId: null, layerCrs: [
  { layer: 'unstated', answer: null },
  { layer: 'roads', answer: { crs: 'EPSG:28356', state: 'officer_stated', statedAt } },
] } as unknown as IntakeItem;

it('the item with its layer answers is the contract item; only a plain EPSG code is taken', () => {
  expect(validate(itemSchema, item)).toEqual([]);
  expect(layerCrsCode(' epsg:32643 ')).toBe('EPSG:32643');
  for (const value of ['32643', 'EPSG:0', 'EPSG:', 'ESRI:102100', 'EPSG:4326+5773']) {
    expect(layerCrsCode(value)).toBeNull();
  }
});

it('sends the contract body once; a bad code is named and never sent', async () => {
  const states: LayerCrsState[] = [];
  const send = vi.fn(async (_body: LayerCrsBody) => item);
  const refresh = vi.fn();
  const answer = createLayerCrsCommand('unstated', send, state => states.push(state), refresh,
    () => '30000000-0000-4000-8000-000000000001');
  await answer('32643');
  expect(send).not.toHaveBeenCalled();
  expect(states.at(-1)?.error).toBe('Write the code as EPSG and its number, for example EPSG:32643.');
  await answer('epsg:32643');
  expect(send.mock.calls[0]?.[0]).toEqual({ requestKey: '30000000-0000-4000-8000-000000000001', layer: 'unstated',
    crs: 'EPSG:32643' });
  expect(validate(requestSchema, send.mock.calls[0]?.[0])).toEqual([]);
  expect(states.at(-1)).toEqual({ busy: false, uncertain: false, error: '' });
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('a lost answer resends the same key; a refusal shows its words; a changed code is a new answer', async () => {
  let n = 0;
  const send = vi.fn().mockRejectedValueOnce(new TypeError('Connection lost'))
    .mockRejectedValueOnce(new ApiError(422, '', { error: { code: 'INTAKE_LAYER_CRS_UNKNOWN',
      message: '`EPSG:999999` is not a two-dimensional coordinate reference system the geo service knows.' } }))
    .mockResolvedValue(item);
  const states: LayerCrsState[] = [];
  const answer = createLayerCrsCommand('unstated', send, state => states.push(state), vi.fn(), () => `key-${++n}`);
  await answer('EPSG:999999');
  expect(states.at(-1)).toMatchObject({ uncertain: true, error: 'Connection lost' });
  expect(layerCrsWords(states.at(-1)!)).toBe('Send the same answer again');
  await answer('EPSG:999999');
  expect(states.at(-1)).toMatchObject({ uncertain: false,
    error: '`EPSG:999999` is not a two-dimensional coordinate reference system the geo service knows.' });
  expect(layerCrsWords(states.at(-1)!)).toBe('Submit');
  await answer('EPSG:28356');
  expect(send.mock.calls.map(call => [call[0].requestKey, call[0].crs])).toEqual([
    ['key-1', 'EPSG:999999'], ['key-1', 'EPSG:999999'], ['key-2', 'EPSG:28356']]);
});

it('shows a form for the unstated layer and the answer as stated by the officer', () => {
  const html = renderToStaticMarkup(<LayerCrsAnswers caseId={item.caseId} item={item} refresh={vi.fn()} />);
  expect(html.match(/<form/g)).toHaveLength(1);
  expect(html).toContain('Coordinate system of unstated');
  expect(html).toContain('The file states none. Give the EPSG code its coordinates are in.');
  expect(html).toContain('aria-label="Submit: unstated"');
  expect(html).toContain('roads: EPSG:28356, stated by the officer');
});
