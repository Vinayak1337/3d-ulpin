import { ApiError } from '@ulpin/api-client';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { expect, it, vi } from 'vitest';
import published from '../../../../../docs/api/openapi.json';
import { hashSlices } from './file-hash';
import { partProgressWords } from './batch-model';
import { createUploadCommand } from './upload-command';
import { LARGE_UPLOAD_MINIMUM, uploadPlan, uploadWords, type UploadCreate,
  type UploadLimits, type UploadReceipt } from './upload-model';

const schema = published.components.schemas.GET_ingestion_upload_limits_Response_200_application_json;
const limits = { limits: Object.fromEntries(Object.entries(schema.properties.limits.properties)
  .map(([key, value]) => [key, value.enum[0]])), largeProfile: { limits: Object.fromEntries(
    Object.entries(schema.properties.largeProfile.properties.limits.properties)
      .map(([key, value]) => [key, value.enum[0]])), capacity: {} }, profile: 'opaque_original_only',
  conversion: 'unsupported' } as UploadLimits;

it('uses the published switch and part size, chooses profile at the maxima and refuses before writes', () => {
  const create = published.components.schemas.POST_ingestion_cases_caseId_uploads_Request_application_json;
  // CD1: /uploads takes any original of 1 byte or more; the map switch stays just above the bounded routes.
  expect(create.anyOf.map(profile => profile.properties.bytes.minimum)).toEqual([1, 1]);
  expect(LARGE_UPLOAD_MINIMUM).toBe(16 * 1024 * 1024 + 1);
  expect(uploadPlan(43263076, limits)).toEqual({ profile: 'large-original/1', partBytes: 8388608,
    parts: 6, lastPartBytes: 1320036 });
  expect(uploadPlan(limits.limits.maxOriginalBytes + 1, limits)).toMatchObject({ profile: 'large-original/2',
    parts: 17, lastPartBytes: 1 });
  expect(() => uploadPlan(limits.largeProfile.limits.maxOriginalBytes + 1, limits)).toThrow('7,51,61,92,768 bytes');
});

it('incremental slices equal the one-piece hash, including the short last slice', async () => {
  const bytes = new TextEncoder().encode('Known hash control, not a map or a source record.');
  const counts: number[] = [];
  expect(await hashSlices(new Blob([bytes]), 7, count => counts.push(count))).toBe(bytesToHex(sha256(bytes)));
  expect(counts.at(-1)).toBe(bytes.length);
});

function harness() {
  const receipt = { id: crypto.randomUUID(), revision: 1, currentCaseRevision: 3, state: 'receiving',
    receivedBytes: 0, parts: [] } as unknown as UploadReceipt;
  const transport = {
    limits: vi.fn(async () => limits), revision: vi.fn(async () => 3),
    create: vi.fn(async (_body: UploadCreate) => receipt), status: vi.fn(async () => receipt),
    part: vi.fn(async (_receipt, part) => ({ ...receipt, revision: part.number * 2 + 1,
      receivedBytes: part.number * limits.limits.partBytes })),
    finalize: vi.fn(async () => ({ ...receipt, state: 'retained' as const,
      source: { sourceId: 'retained-source', sourceRevision: 1, sha256: 'a'.repeat(64), bytes: 1 } })),
    abort: vi.fn(async () => ({ ...receipt, state: 'aborted' as const })),
  };
  const progress = vi.fn();
  const file = new File([new Uint8Array(LARGE_UPLOAD_MINIMUM)], 'control.geojson');
  const command = createUploadCommand({ file, acquiredAt: '2026-10-11T00:00:00Z', transport,
    hash: async () => 'a'.repeat(64), publish: progress });
  return { command, transport, progress, receipt };
}

it('sends parts sequentially with receipt guards then finalizes; no publisher is invented', async () => {
  const run = harness();
  expect(await run.command.run()).toBe('retained-source');
  expect(run.transport.part.mock.calls.map(call => call[1].number)).toEqual([1, 2, 3]);
  expect(run.transport.part.mock.calls.map(call => call[1].headers['X-Upload-Revision'])).toEqual([1, 3, 5]);
  expect(run.transport.create.mock.calls[0]?.[0]).toMatchObject({ expectedCaseRevision: 3,
    provenance: { origin: 'not_stated', acquiredAt: '2026-10-11T00:00:00Z' } });
  expect(run.transport.finalize).toHaveBeenCalledOnce();
});

it('three unknown failures keep the same part/body/guards; Try again continues there, not from part one', async () => {
  const run = harness();
  const success = run.transport.part.getMockImplementation()!;
  let failures = 0;
  run.transport.part.mockImplementation(async (receipt, part) => {
    if (part.number === 2 && failures++ < 3) throw new TypeError('lost');
    return success(receipt, part);
  });
  const finished = run.command.run();
  await vi.waitFor(() => expect(run.progress).toHaveBeenLastCalledWith(expect.objectContaining({
    phase: 'stopped', part: 2, words: 'the server did not answer',
  })));
  const calls = run.transport.part.mock.calls.filter(call => call[1].number === 2);
  expect(calls).toHaveLength(3);
  expect(calls[0]![1]).toBe(calls[1]![1]);
  run.command.retry();
  expect(await finished).toBe('retained-source');
  expect(run.transport.part.mock.calls.map(call => call[1].number)).toEqual([1, 2, 2, 2, 2, 3]);
});

it('known refusal words stay visible; Cancel aborts once and sends no more parts/finalization', async () => {
  const run = harness();
  run.transport.part.mockRejectedValue(new ApiError(422, '', { error: { message: 'Part refused exactly.' } }));
  const finished = run.command.run();
  await vi.waitFor(() => expect(run.progress).toHaveBeenLastCalledWith(expect.objectContaining({
    phase: 'stopped', words: 'Part refused exactly.',
  })));
  await Promise.all([run.command.cancel(), run.command.cancel()]);
  expect(await finished).toBeNull();
  expect(run.transport.abort).toHaveBeenCalledOnce();
  expect(run.transport.finalize).not.toHaveBeenCalled();
});

it('states only actual upload and intake progress, never converting unknown parts to zero', () => {
  const base = { doneBytes: 16 * 1024 ** 2, totalBytes: 43 * 1024 ** 2, part: 2, parts: 6 };
  expect(uploadWords({ ...base, phase: 'checking' })).toBe('Checking the file: 37%');
  expect(uploadWords({ ...base, phase: 'uploading' })).toBe('Uploading: 37% (16 of 43 MiB)');
  expect(uploadWords({ ...base, phase: 'verifying' })).toBe('Verifying the upload');
  expect(uploadWords({ ...base, phase: 'stopped', words: 'Exact server words' }))
    .toBe('The upload stopped at part 2 of 6: Exact server words.');
  expect(partProgressWords({ state: 'reading', recordsSeen: 12, partsPlanned: null, partsDone: 0 }))
    .toBe('Reading: 12 records so far');
  expect(partProgressWords({ state: 'reading', recordsSeen: 12, partsPlanned: 3, partsDone: 1 })).toBe('1 of 3 parts');
  expect(partProgressWords({ state: 'probed', recordsSeen: 0, partsPlanned: null, partsDone: 0 })).toBeNull();
});
