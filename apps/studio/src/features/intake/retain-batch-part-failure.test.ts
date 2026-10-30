import { afterEach, expect, it, vi } from 'vitest';
import published from '../../../../../docs/api/openapi.json';
import { retainBatch, type FileOutcome } from './retain-batch';

vi.mock('./hash-file', () => ({ hashFile: async () => 'a'.repeat(64) }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const cases = [
  { status: 500, code: 'BODY_TIMEOUT', auto: true },
  { status: 500, code: 'PART_INTEGRITY', auto: true },
  { status: 500, code: 'STALE_REVISION', auto: true },
  { status: 503, code: 'STORAGE_TIMEOUT', auto: true },
  { status: 500, code: 'AbortError', auto: true },
  { status: 500, code: 'Error', auto: true },
  { status: 409, code: 'STALE_REVISION', auto: true },
  { status: 422, code: 'PART_INTEGRITY', auto: true },
  { status: 408, code: 'BODY_TIMEOUT', auto: true },
  { status: 400, code: 'INCOMPLETE_BODY', auto: true },
  { status: 413, code: 'FILE_SIZE', auto: true },
  { status: 0, code: 'TypeError', auto: true },
  { status: 0, code: 'silence', auto: false },
];
type Failure = { status: number; code: string; auto: boolean };
type Sent = { headers: Headers; bytes: number[] };

/** Real fetch/unwrap/Blob serialization, with small test-only parts and no network or source records. */
function replay(failure: Failure, persistent = false, mismatch = false) {
  const schema = published.components.schemas.GET_ingestion_upload_limits_Response_200_application_json;
  const enums = (properties: object) => Object.fromEntries(Object.entries(properties)
    .map(([key, value]) => [key, (value as { enum: unknown[] }).enum[0]]));
  const limits = { limits: { ...enums(schema.properties.limits.properties), partBytes: 4, maxOriginalBytes: 48 },
    largeProfile: { limits: { ...enums(schema.properties.largeProfile.properties.limits.properties), partBytes: 4 } } };
  const started: string[] = [], sent: Sent[] = [];
  const receipts = new Map<string, any>();
  let statuses = 0;
  vi.stubGlobal('fetch', async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/upload-limits')) return Response.json(limits);
    if (path.endsWith('/cases/replay')) return Response.json({ case: { revision: 3 } });
    if (path.endsWith('/uploads')) {
      const body = await request.json();
      const id = String(started.push(body.filename));
      const receipt = { id, revision: 1, currentCaseRevision: 3, state: 'receiving', receivedBytes: 0, parts: [] };
      receipts.set(id, receipt);
      return Response.json(receipt);
    }
    if (path.endsWith('/intake/items')) return Response.json({});
    const id = path.match(/uploads\/([^/]+)/)![1]!;
    const receipt = receipts.get(id)!;
    if (request.method === 'GET') { statuses++; return Response.json(receipt); }
    if (path.endsWith('/abort')) return Response.json({ ...receipt, state: 'aborted' });
    if (path.endsWith('/finalize')) return Response.json({ ...receipt, state: 'retained',
      source: { sourceId: `source-${id}` } });
    const number = Number(path.split('/').at(-1));
    if (id === '1' && number === 13) {
      sent.push({ headers: new Headers(request.headers), bytes: [...new Uint8Array(await request.arrayBuffer())] });
      if (sent.length === 1 || persistent) {
        Object.assign(receipt, { revision: receipt.revision + 2, currentCaseRevision: 4,
          parts: [{ partNumber: 13, state: 'failed', attempts: persistent ? sent.length : 1,
            requestKey: mismatch ? 'different-key' : request.headers.get('x-request-key'),
            sha256: request.headers.get('x-part-sha256'), bytes: 4, leaseExpiresAt: null }] });
        if (failure.code === 'silence') return new Promise<Response>(() => {});
        if (failure.code === 'TypeError') throw new TypeError('Connection dropped after claim');
        return Response.json({ error: { code: failure.code, message: `Part 13 refused: ${failure.code}` } },
          { status: failure.status });
      }
    }
    Object.assign(receipt, { revision: receipt.revision + 2, receivedBytes: receipt.receivedBytes + 4 });
    return Response.json(receipt);
  });
  let rows: FileOutcome[] = [];
  // The batch starts the smallest file first, so the two later files are larger than the failing one.
  const work = retainBatch('replay', [new File(['test_only byte transport control'.padEnd(52, '.')], 'first.tif'),
    new File(['next'.padEnd(56, '.')], 'second.tif'), new File(['last'.padEnd(56, '.')], 'third.tif')],
  update => { rows = update; });
  return { work, started, sent, rows: () => rows, statuses: () => statuses };
}

it.each(cases)('part 13: $status $code reconciles or stops and the next two files start', async failure => {
  vi.useFakeTimers();
  const run = replay(failure);
  await vi.waitFor(() => expect(run.sent).toHaveLength(1));
  await vi.advanceTimersByTimeAsync(failure.code === 'silence' ? 120_001 : 30_000);
  await vi.waitFor(() => expect(run.rows().slice(1).map(row => row.state)).toEqual(['enrolled', 'enrolled']));
  await vi.waitFor(() => expect(failure.auto ? run.rows()[0]!.state : run.rows()[0]!.upload?.phase)
    .toBe(failure.auto ? 'enrolled' : 'stopped'));
  expect(run.started).toEqual(['first.tif', 'second.tif', 'third.tif']);
  expect(run.sent).toHaveLength(failure.auto ? 2 : 1);
  expect(run.statuses()).toBe(failure.code === 'silence' ? 0 : 1);
  if (failure.auto) {
    expect(run.rows()[0]!.state).toBe('enrolled');
    expect(run.sent[1]!.bytes).toEqual(run.sent[0]!.bytes);
    for (const key of ['x-request-key', 'x-part-sha256'])
      expect(run.sent[1]!.headers.get(key)).toBe(run.sent[0]!.headers.get(key));
    expect(run.sent.map(part => part.headers.get('x-upload-revision'))).toEqual(['25', '27']);
    expect(run.sent.map(part => part.headers.get('x-case-revision'))).toEqual(['3', '4']);
  } else {
    expect(run.rows()[0]!.upload).toMatchObject({ phase: 'stopped', part: 13 });
    expect(run.rows()[0]!.message).toMatch(/No progress for 2 minutes while sending part 13/);
  }
  await run.work;
});

it('a refusal that stays reaches the attempt limit, stops for the officer and releases the next files', async () => {
  vi.useFakeTimers();
  const run = replay({ status: 422, code: 'PART_INTEGRITY', auto: false }, true);
  for (const [index, delay] of [2000, 5000].entries()) {
    await vi.waitFor(() => expect(run.statuses()).toBe(index + 1));
    await vi.advanceTimersByTimeAsync(delay);
    await vi.waitFor(() => expect(run.sent).toHaveLength(index + 2));
  }
  await vi.waitFor(() => expect(run.rows().slice(1).map(row => row.state)).toEqual(['enrolled', 'enrolled']));
  expect(run.sent).toHaveLength(3);
  expect(run.rows()[0]!.upload).toMatchObject({ phase: 'stopped', part: 13, words: 'Part 13 refused: PART_INTEGRITY' });
  await run.rows()[0]!.command!.cancel();
  await run.work;
});

it('a mismatched immutable binding never resends even when status says failed', async () => {
  vi.useFakeTimers();
  const run = replay({ status: 500, code: 'Error', auto: false }, false, true);
  await vi.waitFor(() => expect(run.sent).toHaveLength(1));
  await vi.advanceTimersByTimeAsync(30_000);
  await vi.waitFor(() => expect(run.rows().slice(1).map(row => row.state)).toEqual(['enrolled', 'enrolled']));
  expect(run.sent).toHaveLength(1);
  expect(run.rows()[0]!.upload?.words).toMatch(/different immutable part binding/);
  await run.rows()[0]!.command!.cancel();
  await run.work;
});
