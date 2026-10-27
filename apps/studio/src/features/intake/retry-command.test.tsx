import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@ulpin/api-client';
import { expect, it, vi } from 'vitest';
import captured from '../../../../../docs/evidence/gf1/lq1a/controls-second.json';
import { createContractValidator } from '../../local/contract';
import type { IntakeItem } from './batch-model';
import { IntakeTray } from './IntakeTray';
import { canRetryStopped, createRetryCommand, retryWords, stoppedReason, type RetryState } from './retry-command';

// The item is LQ1a's captured manifest row; only its placement and reason are set to the stopped state.
const root = resolve(import.meta.dirname, '../../../../..');
const openapi = JSON.parse(readFileSync(resolve(root, 'docs/api/openapi.json'), 'utf8'));
const validate = createContractValidator(openapi);
const route = openapi.paths['/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/retry'].post;
const ref = (schema: { $ref: string }) => schema.$ref.split('/').at(-1)!;
const requestSchema = ref(route.requestBody.content['application/json'].schema);
const resultSchema = ref(route.responses['200'].content['application/json'].schema);
const stopped = { ...captured.manifest.items[0], placement: 'not_understood',
  limitReason: stoppedReason } as unknown as IntakeItem;
const result = { itemId: stopped.itemId, jobId: '20000000-0000-4000-8000-000000000007', retry: 1 };

it('the server writes the shared sentence; only a stopped item with a source is offered a retry', () => {
  const server = readFileSync(resolve(root, 'packages/server/src/modules/usp/ingestion/intake-large.ts'), 'utf8');
  expect(server).toMatch(/\bstoppedReason,[\s\S]*?from '@ulpin\/contracts\/usp';/);
  expect(server).toContain('export const INTAKE_LARGE_STOPPED = stoppedReason;');
  expect(canRetryStopped(stopped)).toBe(true);
  expect(canRetryStopped({ ...stopped, sourceId: null })).toBe(false);
  expect(canRetryStopped({ ...stopped, placement: 'needs_answer' })).toBe(false);
  expect(canRetryStopped({ ...stopped, limitReason: 'The declared coordinate system is not supported.' })).toBe(false);
});

it('sends the contract body; a known answer ends the command and refreshes the batch', async () => {
  const states: RetryState[] = [];
  const send = vi.fn(async (_key: string) => result);
  const refresh = vi.fn();
  const retry = createRetryCommand(send, state => states.push(state), refresh,
    () => '20000000-0000-4000-8000-000000000008');
  await retry();
  expect(validate(requestSchema, { requestKey: send.mock.calls[0]?.[0] })).toEqual([]);
  expect(validate(resultSchema, result)).toEqual([]);
  expect(states.at(-1)).toMatchObject({ busy: false, uncertain: false, result, error: '' });
  expect(refresh).toHaveBeenCalledTimes(1);
  await retry();
  expect(send).toHaveBeenCalledTimes(1);
});

it('a lost or 5xx answer resends the same key; a refusal shows its words and the next try has a new key', async () => {
  let n = 0;
  const send = vi.fn().mockRejectedValueOnce(new TypeError('Connection lost'))
    .mockRejectedValueOnce(new ApiError(503, '', { message: 'Service unavailable.' }))
    .mockRejectedValueOnce(new ApiError(409, '', { error: { code: 'INTAKE_RETRY_FILE',
      message: 'This file stopped because of what it contains.' } }))
    .mockResolvedValue(result);
  const states: RetryState[] = [];
  const retry = createRetryCommand(send, state => states.push(state), vi.fn(), () => `key-${++n}`);
  await retry();
  expect(states.at(-1)).toMatchObject({ uncertain: true, error: 'Connection lost' });
  expect(retryWords(states.at(-1)!)).toBe('Send same retry again');
  await retry();
  await retry();
  expect(states.at(-1)).toMatchObject({ uncertain: false, error: 'This file stopped because of what it contains.' });
  expect(retryWords(states.at(-1)!)).toBe('Try again');
  await retry();
  expect(send.mock.calls.map(call => call[0])).toEqual(['key-1', 'key-1', 'key-1', 'key-2']);
});

it('the tray offers Try again on the stopped row only', () => {
  const other = { ...stopped, itemId: '20000000-0000-4000-8000-000000000009', limitReason: null,
    placement: 'needs_answer' } as IntakeItem;
  const html = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
    <IntakeTray caseId={stopped.caseId} items={[stopped, other]} packages={[]} choose={vi.fn()} refresh={vi.fn()} />
  </MemoryRouter></QueryClientProvider>);
  expect(html.match(/>Try again</g)).toHaveLength(1);
  expect(html).toContain(`aria-label="Try again: ${stopped.name}"`);
});
