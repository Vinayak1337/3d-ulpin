import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { ApiError } from '@ulpin/api-client';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import published from '../../../../../docs/api/openapi.json';
import { hashSlices } from './file-hash';
import { partProgressWords } from './batch-model';
import { retainBatch, type FileOutcome } from './retain-batch';
import { abortReceipt, cleanupReceipt, createUploadCommand, FINISHING_AGAIN, NOT_THE_FILE,
  resetUploadSlotsForTests, SLOT_STOPPED, SLOT_WAIT_MS } from './upload-command';
import { LARGE_UPLOAD_MINIMUM, uploadPlan, uploadWords, type UploadCreate, type UploadEntry,
  type UploadLimits, type UploadReceipt } from './upload-model';

vi.mock('./hash-file', () => ({ hashFile: async () => 'a'.repeat(64) }));

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
    create: vi.fn(async (_body: UploadCreate, _signal?: AbortSignal) => receipt),
    status: vi.fn(async () => receipt),
    part: vi.fn(async (_receipt, part) => ({ ...receipt, revision: part.number * 2 + 1,
      receivedBytes: part.number * limits.limits.partBytes })),
    finalize: vi.fn(async () => ({ ...receipt, state: 'retained' as const,
      source: { sourceId: 'retained-source', sourceRevision: 1, sha256: 'a'.repeat(64), bytes: 1 } })),
    abort: vi.fn(async () => ({ ...receipt, state: 'aborted' as const })),
    cleanup: vi.fn(async () => ({ ...receipt, state: 'aborted' as const })),
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

it('three unknown failures reconcile the same part; Try again continues there, not from part one', async () => {
  vi.useFakeTimers();
  const run = harness();
  const success = run.transport.part.getMockImplementation()!;
  let failures = 0;
  run.transport.part.mockImplementation(async (receipt, part) => {
    if (part.number === 2 && failures++ < 3) throw new TypeError('lost');
    return success(receipt, part);
  });
  const finished = run.command.run();
  await vi.advanceTimersByTimeAsync(7500);
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

it.each([409, 412])('a 500 then a stale %i reconcile and resend without an officer press', async status => {
  vi.useFakeTimers();
  const run = harness();
  const success = run.transport.part.getMockImplementation()!;
  const sent: { revision: number; key: string; hash: string; bytes: Blob }[] = [];
  run.transport.part.mockImplementation(async (receipt, part) => {
    if (part.number !== 1) return success(receipt, part);
    sent.push({ revision: part.headers['X-Upload-Revision'], key: part.headers['X-Request-Key'],
      hash: part.headers['X-Part-Sha256'], bytes: part.bytes });
    if (sent.length === 1) throw new ApiError(500, '', { error: { message: 'Stored part interrupted.' } });
    if (sent.length === 2) throw new ApiError(status, '', { error: { code: 'STALE_REVISION',
      message: 'Upload or case revision changed; read current status before continuing.' } });
    return success(receipt, part);
  });
  // First status races the server's failure bookkeeping; the next observes its advanced revision.
  run.transport.status.mockResolvedValueOnce(run.receipt).mockResolvedValueOnce({ ...run.receipt, revision: 3,
    currentCaseRevision: 4 });
  const finished = run.command.run();
  await vi.advanceTimersByTimeAsync(7500);
  expect(await finished).toBe('retained-source');
  expect(sent.map(call => call.revision)).toEqual([1, 1, 3]);
  expect(sent.every(call => call.key === sent[0]!.key && call.hash === sent[0]!.hash
    && call.bytes === sent[0]!.bytes)).toBe(true);
  expect(run.transport.status).toHaveBeenCalledTimes(2);
  expect(run.progress).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'stopped' }));
});

it.each([
  [408, 'BODY_TIMEOUT', 'The bounded request body timed out.'],
  [429, 'UPLOAD_CONCURRENCY', 'The bounded byte-part reader allowance is full.'],
] as const)('a busy-service %i %s is sent again by itself after reading the status', async (status, code, words) => {
  vi.useFakeTimers();
  const run = harness();
  run.transport.part.mockRejectedValueOnce(new ApiError(status, '', { error: { code, message: words } }));
  const finished = run.command.run();
  await vi.advanceTimersByTimeAsync(2000);
  expect(await finished).toBe('retained-source');
  expect(run.transport.part.mock.calls.map(call => call[1].number)).toEqual([1, 1, 2, 3]);
  expect(run.transport.status).toHaveBeenCalledOnce();
  expect(run.progress).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'stopped' }));
});

it('a lost part answer already received in status is not sent again', async () => {
  const run = harness();
  const success = run.transport.part.getMockImplementation()!;
  run.transport.part.mockImplementationOnce(async (_receipt, part) => {
    run.transport.status.mockResolvedValueOnce({ ...run.receipt, revision: 3,
      receivedBytes: part.bytes.size, parts: [{ partNumber: part.number, state: 'received',
        requestKey: part.headers['X-Request-Key'], sha256: part.headers['X-Part-Sha256'], bytes: part.bytes.size,
        attempts: 1, leaseExpiresAt: null }] });
    throw new TypeError('answer lost');
  }).mockImplementation(success);
  expect(await run.command.run()).toBe('retained-source');
  expect(run.transport.part.mock.calls.map(call => call[1].number)).toEqual([1, 2, 3]);
  expect(run.progress).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'stopped' }));
});

it('a resumed part refused for a slot waits with the existing words and then sends itself', async () => {
  vi.useFakeTimers();
  const run = harness();
  run.transport.part.mockRejectedValueOnce(quota('open_receipts', new Date(Date.now() + 2000).toISOString()));
  const finished = run.command.run();
  await vi.advanceTimersByTimeAsync(1);
  expect(run.progress).toHaveBeenLastCalledWith(waiting(
    'Waiting for a free upload slot; 4 uploads are open on this service. It starts by itself.'));
  await vi.advanceTimersByTimeAsync(2000);
  expect(await finished).toBe('retained-source');
  expect(run.progress).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'stopped' }));
});

it('known refusal words stay visible after reconciliation; Cancel aborts once and sends no more parts', async () => {
  const run = harness();
  run.transport.part.mockRejectedValue(new ApiError(422, '', { error: { message: 'Part refused exactly.' } }));
  const finished = run.command.run();
  await vi.waitFor(() => expect(run.progress).toHaveBeenLastCalledWith(expect.objectContaining({
    phase: 'stopped', words: 'Part refused exactly.',
  })));
  expect(run.transport.status).toHaveBeenCalledOnce();
  expect(run.transport.part).toHaveBeenCalledOnce();
  await Promise.all([run.command.cancel(), run.command.cancel()]);
  expect(await finished).toBeNull();
  expect(run.transport.abort).toHaveBeenCalledOnce();
  expect(run.transport.finalize).not.toHaveBeenCalled();
});

it.each([
  [409, 'STALE_REVISION', 'This part has a different immutable request/hash binding.'],
  [429, 'PART_ATTEMPTS', 'This part reached its bounded attempt limit; safely abort the receipt.'],
  [409, 'STALE_REVISION', 'This source case is assigned; choose an unassigned source case.'],
] as const)('a persistent %s %s stops after reconciliation in the server words', async (status, code, words) => {
  const run = harness();
  run.transport.part.mockRejectedValue(new ApiError(status, '', { error: { code, message: words } }));
  const finished = run.command.run();
  await vi.waitFor(() => expect(run.progress).toHaveBeenLastCalledWith(expect.objectContaining({
    phase: 'stopped', words,
  })));
  expect(run.transport.status).toHaveBeenCalledOnce();
  expect(run.transport.part).toHaveBeenCalledOnce();
  await run.command.cancel();
  expect(await finished).toBeNull();
});

it.each(['limits', 'hash', 'part-hash', 'revision', 'part', 'finalize', 'status'] as const)(
  'a silent %s ends with an action, sends no retry and ignores a late result', async (step) => {
    vi.useFakeTimers();
    try {
      const run = harness();
      let complete!: (value: any) => void;
      const pending = new Promise<any>(resolve => { complete = resolve; });
      let hashProgress: ((bytes: number) => void) | undefined;
      let hashes = 0;
      const hash = vi.fn((_file: Blob, _size: number, progress: (bytes: number) => void) => {
        hashes++;
        if (step === 'hash' || (step === 'part-hash' && hashes === 2)) {
          hashProgress = progress;
          return pending;
        }
        return Promise.resolve('a'.repeat(64));
      });
      if (step !== 'hash' && step !== 'part-hash') run.transport[step].mockReturnValueOnce(pending);
      if (step === 'status') run.transport.finalize.mockResolvedValueOnce({ ...run.receipt,
        state: 'finalizing' } as never);
      const command = createUploadCommand({ file: new File(['file'], 'control.gpkg'),
        acquiredAt: '2026-10-11T00:00:00Z', transport: run.transport, hash, publish: run.progress,
        pause: async () => {} });
      const finished = command.run().catch(error => error);
      if (step === 'hash') {
        await vi.advanceTimersByTimeAsync(100_000);
        hashProgress?.(2);
        await vi.advanceTimersByTimeAsync(100_000);
        expect(run.progress).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'checking', doneBytes: 2 }));
        await vi.advanceTimersByTimeAsync(20_001);
      } else await vi.advanceTimersByTimeAsync(120_001);
      expect(run.progress).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'stopped' }));
      const error = await finished;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toMatch(/Refresh the batch/);
      const stopped = run.progress.mock.calls.length;
      complete(step === 'hash' || step === 'part-hash' ? 'a'.repeat(64) : run.receipt);
      hashProgress?.(4);
      command.retry();
      await vi.advanceTimersByTimeAsync(120_001);
      expect(run.progress).toHaveBeenCalledTimes(stopped);
      expect(run.transport.finalize).toHaveBeenCalledTimes(step === 'finalize' || step === 'status' ? 1 : 0);
      expect(run.transport.part).toHaveBeenCalledTimes(['part', 'finalize', 'status'].includes(step) ? 1 : 0);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

it('a zero-byte check is shown as zero, not one KiB', async () => {
  const { sizeWords } = await import('./upload-model');
  expect(sizeWords(0)).toBe('0 KiB');
});

it('states only actual upload and intake progress, never converting unknown parts to zero', () => {
  const base = { doneBytes: 16 * 1024 ** 2, totalBytes: 43 * 1024 ** 2, part: 2, parts: 6 };
  expect(uploadWords({ ...base, phase: 'checking' })).toBe('Checking the file: 37%');
  expect(uploadWords({ ...base, phase: 'uploading' })).toBe('Uploading: 37% (16 of 43 MiB)');
  expect(uploadWords({ ...base, phase: 'verifying' })).toBe('Verifying the upload');
  expect(uploadWords({ ...base, phase: 'stopped', words: 'Exact server words' }))
    .toBe('The upload stopped at part 2 of 6: Exact server words.');
  expect(uploadWords({ ...base, phase: 'stopped', parts: 0, words: 'Refresh the batch' }))
    .toBe('The upload stopped: Refresh the batch.');
  expect(partProgressWords({ state: 'reading', recordsSeen: 12, partsPlanned: null, partsDone: 0 }))
    .toBe('Reading: 12 records so far');
  expect(partProgressWords({ state: 'reading', recordsSeen: 12, partsPlanned: 3, partsDone: 1 })).toBe('1 of 3 parts');
  expect(partProgressWords({ state: 'probed', recordsSeen: 0, partsPlanned: null, partsDone: 0 })).toBeNull();
});

// N04. Real inputs from docs/api/datasets.json: a 4-part GeoJSON whose last part is short, and a 6-part GeoJSON.
const NIAGARA = 'E:/BhuAayam-data/datasets/map-formats/niagara-falls/'
  + 'Niagara_Falls_Building_Footprints_2018_1330698285055863645.geojson';
const NYC = 'E:/BhuAayam-data/datasets/nyc-second-area/nyc-office-of-technology-and-innovation/'
  + '5zhs-2jue-box-w74.025-s40.700-e73.940-n40.800.geojson';
const real = (path: string) => new File([readFileSync(path)], basename(path));
const realHash = (blob: Blob) => hashSlices(blob, limits.limits.partBytes, () => {});

it.skipIf(!existsSync(NIAGARA) || !existsSync(NYC)).each([NIAGARA, NYC])(
  'a silent create replays and sends each real file part once: %s',
  async path => {
    const file = real(path);
    const digest = await realHash(file);
    vi.useFakeTimers();
    const run = harness();
    let sent!: () => void;
    const firstSent = new Promise<void>(resolve => { sent = resolve; });
    run.transport.create.mockImplementationOnce(() => {
      sent();
      return new Promise(() => {});
    });
    const command = createUploadCommand({ file, acquiredAt: '2026-10-11T00:00:00Z', transport: run.transport,
      // This transport test hashes real bytes without hashSlices' timer-based yields, so only silence uses the clock.
      hash: async blob => bytesToHex(sha256(new Uint8Array(await blob.arrayBuffer()))), publish: run.progress });
    const finished = command.run();
    await firstSent;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await finished).toBe('retained-source');
    const [first, second] = run.transport.create.mock.calls;
    expect(second![0]).toBe(first![0]);
    expect(first![0].sha256).toBe(digest);
    expect(first![1]!.aborted).toBe(true);
    const parts = uploadPlan(file.size, limits).parts;
    expect(run.transport.part.mock.calls.map(call => call[1].number))
      .toEqual(Array.from({ length: parts }, (_value, index) => index + 1));
    expect(run.transport.part.mock.lastCall![1].bytes.size).toBe(uploadPlan(file.size, limits).lastPartBytes);
    expect(run.transport.finalize).toHaveBeenCalledOnce();
  }, 30_000);

/** A receipt a reload left open: `received` parts are kept; a `failed` part keeps the request key it was bound to. */
async function openReceipt(file: File, received: number[], failed: number[] = []) {
  const { partBytes } = limits.limits;
  const plan = uploadPlan(file.size, limits);
  const slice = (number: number) => file.slice((number - 1) * partBytes, number * partBytes);
  const bound = async (partNumber: number, state: 'received' | 'failed') => ({ partNumber, state,
    bytes: slice(partNumber).size, sha256: await realHash(slice(partNumber)), requestKey: crypto.randomUUID(),
    attempts: 1, leaseExpiresAt: null });
  const parts = await Promise.all([...received.map(n => bound(n, 'received')), ...failed.map(n => bound(n, 'failed'))]);
  const entry: UploadEntry = { id: crypto.randomUUID(), filename: file.name, bytes: file.size,
    sha256: await realHash(file), profile: plan.profile, state: 'receiving', receivedParts: received.length,
    partCount: plan.parts, expiresAt: '2026-10-22T00:00:00.000Z', revision: 9, currentCaseRevision: 3 };
  const receipt = { id: entry.id, revision: 9, currentCaseRevision: 3, state: 'receiving',
    receivedBytes: parts.filter(p => p.state === 'received').reduce((n, p) => n + p.bytes, 0), parts,
  } as unknown as UploadReceipt;
  const transport = {
    limits: vi.fn(async () => limits), revision: vi.fn(async () => 3), create: vi.fn(async () => receipt),
    status: vi.fn(async () => receipt),
    part: vi.fn(async (_receipt: unknown, part: { number: number; headers: Record<string, unknown> }) => {
      const prior = parts.find(p => p.partNumber === part.number);
      const { 'X-Request-Key': key, 'X-Part-Sha256': sha256 } = part.headers;
      if (prior && (prior.requestKey !== key || prior.sha256 !== sha256))
        throw new ApiError(409, '', { error: { message: 'This part has a different request/hash binding.' } });
      return receipt;
    }),
    finalize: vi.fn(async (_receipt: unknown, _body: unknown) => ({ ...receipt, state: 'retained' as const,
      source: { sourceId: 'resumed-source', sourceRevision: 1, sha256: entry.sha256, bytes: file.size } })),
    abort: vi.fn(async () => ({ ...receipt, state: 'aborted' as const })),
    cleanup: vi.fn(async (_receipt: unknown, _body: unknown) => ({ ...receipt, state: 'aborted' as const })),
  };
  return { entry, parts, transport };
}

const resume = (file: File, entry: UploadEntry, transport: Awaited<ReturnType<typeof openReceipt>>['transport']) =>
  createUploadCommand({ file, resume: entry, transport, hash: hashSlices, publish: vi.fn() }).run();

it.skipIf(!existsSync(NIAGARA))('resume with the same real file sends only the parts not received', async () => {
  const file = real(NIAGARA);
  const { entry, transport } = await openReceipt(file, [1, 2]);
  expect(entry.partCount).toBe(4);
  expect(await resume(file, entry, transport)).toBe('resumed-source');
  expect(transport.create).not.toHaveBeenCalled();
  expect(transport.part.mock.calls.map(call => call[1].number)).toEqual([3, 4]);
  expect(transport.part.mock.calls[1]![1].headers['X-Part-Sha256']).toBe(await realHash(file.slice(3 * 8388608)));
  expect(transport.finalize.mock.calls[0]![1]).toMatchObject({ sha256: entry.sha256, expectedRevision: 9 });
});

it.skipIf(!existsSync(NYC))('a part bound before the reload is sent again under its own request key', async () => {
  const file = real(NYC);
  const { entry, parts, transport } = await openReceipt(file, [1, 2, 4], [3]);
  expect(await resume(file, entry, transport)).toBe('resumed-source');
  expect(transport.part.mock.calls.map(call => call[1].number)).toEqual([3, 5, 6]);
  const bound = parts.find(p => p.partNumber === 3)!;
  expect(transport.part.mock.calls[0]![1].headers['X-Request-Key']).toBe(bound.requestKey);
}, 30_000); // Hashing the real file and its parts is not an upload latency assertion.

it.skipIf(!existsSync(NIAGARA))('resume with another file of the same name and size is refused and sends nothing',
  async () => {
    const file = real(NIAGARA);
    const { entry, transport } = await openReceipt(file, [1, 2]);
    // test_only: the real bytes with their last byte changed, made here and never kept.
    const bytes = new Uint8Array(await file.arrayBuffer());
    bytes[bytes.length - 1] = bytes.at(-1)! ^ 1;
    const other = new File([bytes], file.name);
    await expect(resume(other, entry, transport)).rejects.toThrow(NOT_THE_FILE);
    await expect(resume(new File([bytes.slice(1)], file.name), entry, transport)).rejects.toThrow(NOT_THE_FILE);
    for (const send of [transport.create, transport.status, transport.part, transport.finalize, transport.abort])
      expect(send).not.toHaveBeenCalled();
  }, 30_000); // Both complete file hashes must finish even when the suite runs in parallel.

it('Cancel upload aborts a listed receipt with its own guard', async () => {
  const file = new File([new Uint8Array(LARGE_UPLOAD_MINIMUM)], 'control.geojson');
  const { entry, transport } = await openReceipt(file, [1]);
  await abortReceipt(transport, entry, () => 'abort-key');
  expect(transport.abort).toHaveBeenCalledWith(entry, { requestKey: 'abort-key', expectedRevision: 9,
    expectedCaseRevision: 3 });
}, 30_000); // The receipt fixture hashes a 16 MiB file before checking the cancellation guard.

it('Finish cancelling sends the existing cleanup with the receipt guard; a refusal keeps its words', async () => {
  const file = new File([new Uint8Array(LARGE_UPLOAD_MINIMUM)], 'control.geojson');
  const { entry, transport } = await openReceipt(file, [1]);
  const cancelling: UploadEntry = { ...entry, state: 'aborting', revision: 11 };
  await cleanupReceipt(transport, cancelling, () => 'cleanup-key');
  expect(transport.cleanup).toHaveBeenCalledWith(cancelling, { requestKey: 'cleanup-key', expectedRevision: 11,
    expectedCaseRevision: 3 });
  const words = 'Upload or case revision changed; read current status before continuing.';
  transport.cleanup.mockRejectedValueOnce(new ApiError(409, '', { error: { message: words } }));
  await expect(cleanupReceipt(transport, cancelling)).rejects.toThrow(words);
  expect(transport.abort).not.toHaveBeenCalled();
});

// N04B. test_only: a 16 MiB + 1 byte file of zeros made here; the receipt a crash left 'finalizing' is the fake's.
async function finalizingResume(more: Record<string, unknown>) {
  const file = new File([new Uint8Array(LARGE_UPLOAD_MINIMUM)], 'control.geojson');
  const { entry, parts, transport } = await openReceipt(file, [1, 2, 3]);
  const finalizing = { id: entry.id, revision: 12, currentCaseRevision: 3, state: 'finalizing',
    receivedBytes: file.size, parts, leaseExpiresAt: null, ...more } as unknown as UploadReceipt;
  const retained = { ...finalizing, state: 'retained' as const, leaseExpiresAt: null,
    source: { sourceId: 'resumed-source', sourceRevision: 1, sha256: entry.sha256, bytes: file.size } };
  transport.status.mockResolvedValueOnce(finalizing);
  const progress = vi.fn();
  const command = createUploadCommand({ file, resume: { ...entry, state: 'finalizing' }, transport, hash: hashSlices,
    publish: progress, pause: async () => {}, key: () => 'finish-key' });
  return { entry, transport, progress, command, finalizing, retained };
}
const v1 = (leaseMs: number) => ({ version: 'large-original/1',
  leaseExpiresAt: new Date(Date.now() + leaseMs).toISOString() });

it('a v1 receipt whose finalization lease expired is finalized once more and ends retained', async () => {
  const run = await finalizingResume(v1(-60_000));
  expect(await run.command.run()).toBe('resumed-source');
  expect(run.transport.part).not.toHaveBeenCalled();
  expect(run.transport.finalize).toHaveBeenCalledOnce();
  expect(run.transport.finalize.mock.calls[0]![1]).toEqual({ requestKey: 'finish-key', expectedRevision: 12,
    expectedCaseRevision: 3, sha256: run.entry.sha256 });
  const shown = run.progress.mock.calls.map(call => call[0]).find(progress => progress.words === FINISHING_AGAIN);
  expect(uploadWords(shown)).toBe(FINISHING_AGAIN);
});

it('a v1 receipt whose finalization lease is live is only followed by its status', async () => {
  const run = await finalizingResume(v1(60_000));
  run.transport.status.mockResolvedValueOnce(run.retained);
  expect(await run.command.run()).toBe('resumed-source');
  expect(run.transport.status).toHaveBeenCalledTimes(2);
  expect(run.transport.finalize).not.toHaveBeenCalled();
});

it('a v2 receipt whose storage job failed while finalizing is finalized once more, never twice', async () => {
  const failed = { version: 'large-original/2', finalization: { jobId: crypto.randomUUID(), phase: 'assembling',
    completedParts: 1, jobStatus: 'failed', jobError: 'FINALIZATION_INTERRUPTED' } };
  const run = await finalizingResume(failed);
  run.transport.finalize.mockResolvedValueOnce({ ...run.finalizing, revision: 13 } as never);
  run.transport.status.mockResolvedValueOnce({ ...run.finalizing, revision: 14 })
    .mockResolvedValueOnce(run.retained);
  expect(await run.command.run()).toBe('resumed-source');
  expect(run.transport.finalize).toHaveBeenCalledOnce();
  expect(run.transport.finalize.mock.calls[0]![1]).toMatchObject({ requestKey: 'finish-key', expectedRevision: 12 });
  expect(run.transport.status).toHaveBeenCalledTimes(3);
});

it('a refused finish again shows the server words and keeps Cancel upload', async () => {
  const run = await finalizingResume(v1(-60_000));
  const words = 'Original finalization is still active; resume from status.';
  run.transport.finalize.mockRejectedValueOnce(new ApiError(409, '', { error: { message: words } }));
  const stopped = new Promise<void>(resolve => {
    run.progress.mockImplementation(progress => {
      if (progress.phase === 'stopped') resolve();
    });
  });
  const finished = run.command.run();
  await stopped;
  expect(run.progress).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'stopped', words }));
  await run.command.cancel();
  expect(await finished).toBeNull();
  expect(run.transport.finalize).toHaveBeenCalledOnce();
  expect(run.transport.abort).toHaveBeenCalledOnce();
});

const createWaiting = 'The server has not answered yet while opening the upload. It asks again by itself.';

it.each([false, true])('a silent create replays the same body after abort (transport rejects: %s)', async rejects => {
  vi.useFakeTimers();
  const run = harness();
  const admit = run.transport.create.getMockImplementation()!;
  run.transport.create.mockImplementationOnce((_body, signal) => new Promise((_resolve, reject) => {
    if (rejects) signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  })).mockImplementation(async (body, signal) => {
    expect(run.transport.create.mock.calls[0]![1]!.aborted).toBe(true);
    expect(signal!.aborted).toBe(false);
    return admit(body, signal);
  });
  const finished = run.command.run();
  await vi.advanceTimersByTimeAsync(119_999);
  expect(run.transport.create).toHaveBeenCalledOnce();
  expect(run.transport.part).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(await finished).toBe('retained-source');
  const [first, second] = run.transport.create.mock.calls;
  expect(second![0]).toBe(first![0]);
  expect(second![0].requestKey).toBe(first![0].requestKey);
  expect(second![1]).not.toBe(first![1]);
  expect(run.transport.revision).toHaveBeenCalledOnce();
  expect(run.progress).toHaveBeenCalledWith(waiting(createWaiting));
  expect(run.progress).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'stopped' }));
  expect(run.transport.part.mock.calls.map(call => call[1].number)).toEqual([1, 2, 3]);
  expect(run.transport.finalize).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['before', 'after'] as const)('a late first answer %s the replay settles cannot send parts', async when => {
  vi.useFakeTimers();
  const run = harness();
  let firstAnswer!: (value: UploadReceipt) => void;
  let replayAnswer!: (value: UploadReceipt) => void;
  run.transport.create.mockImplementationOnce(() => new Promise(resolve => { firstAnswer = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { replayAnswer = resolve; }));
  const finished = run.command.run();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(run.transport.create).toHaveBeenCalledTimes(2);
  expect(run.progress).toHaveBeenLastCalledWith(waiting(createWaiting));
  const late = { ...run.receipt, revision: 99 };
  if (when === 'before') {
    firstAnswer(late);
    await vi.advanceTimersByTimeAsync(1);
    expect(run.transport.part).not.toHaveBeenCalled();
  }
  replayAnswer(run.receipt);
  expect(await finished).toBe('retained-source');
  if (when === 'after') firstAnswer(late);
  const shown = run.progress.mock.calls.length;
  await vi.advanceTimersByTimeAsync(120_000);
  expect(run.progress).toHaveBeenCalledTimes(shown);
  expect(run.transport.part.mock.calls.map(call => call[1].number)).toEqual([1, 2, 3]);
  expect(run.transport.part.mock.calls[0]![1].headers['X-Upload-Revision']).toBe(1);
  expect(run.transport.finalize).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([false, true])('a create silent for the slot window stops in today\'s words (quota first: %s)',
  async quotaFirst => {
    vi.useFakeTimers();
    const run = harness();
    const admit = run.transport.create.getMockImplementation()!;
    if (quotaFirst) run.transport.create.mockRejectedValueOnce(quota('open_receipts',
      new Date(Date.now() + 2000).toISOString()));
    run.transport.create.mockImplementation(() => new Promise(() => {}));
    const finished = run.command.run();
    await vi.advanceTimersByTimeAsync(SLOT_WAIT_MS - 1);
    expect(run.progress).toHaveBeenLastCalledWith(waiting(createWaiting));
    expect(run.transport.part).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run.progress).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'stopped', words: SLOT_STOPPED }));
    const calls = run.transport.create.mock.calls;
    expect(calls).toHaveLength(quotaFirst ? 16 : 15);
    expect(calls.every(call => call[0] === calls[0]![0])).toBe(true);
    expect(calls.slice(quotaFirst ? 1 : 0).every(call => call[1]!.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(run.transport.create).toHaveBeenCalledTimes(calls.length);
    run.transport.create.mockImplementation(admit);
    run.command.retry();
    expect(await finished).toBe('retained-source');
    expect(run.transport.create.mock.lastCall![0]).toBe(calls[0]![0]);
    expect(run.transport.part.mock.calls.map(call => call[1].number)).toEqual([1, 2, 3]);
  });

// S1.3j. A create refused because the open-receipt slots are taken waits by itself, in drop order.
const quota = (limit: string, freesAt: string | null) => new ApiError(429, '', { error: { code: 'UPLOAD_QUOTA',
  message: `Refused for ${limit}.`, details: { limit, freesAt } } });
const waiting = (words: string) => expect.objectContaining({ phase: 'waiting', words });
const operatorWords = 'Waiting for a free upload slot; 2 of your uploads are open. It starts by itself.';
beforeEach(resetUploadSlotsForTests);
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

/** One transport whose creates are refused for a case slot until `free` admits them, in the order they arrive. */
function slotHarness() {
  const run = harness();
  const admit = run.transport.create.getMockImplementation()!;
  const slots = { free: 0, started: [] as string[] };
  run.transport.create.mockImplementation(async body => {
    if (slots.free < 1) throw quota('open_receipts_case', null);
    slots.free--;
    slots.started.push(body.filename);
    return admit(body);
  });
  const command = (name: string, progress = vi.fn()) => ({ progress, command: createUploadCommand({
    file: new File([new Uint8Array(LARGE_UPLOAD_MINIMUM)], name), acquiredAt: '2026-10-11T00:00:00Z',
    transport: run.transport, hash: async () => 'a'.repeat(64), publish: progress }) });
  return { ...run, slots, command };
}

it('S1.3j: a slot refusal with freesAt waits in words and starts once, with no press, when it frees', async () => {
  vi.useFakeTimers();
  const run = harness();
  const admit = run.transport.create.getMockImplementation()!;
  let open = true;
  const freesAt = new Date(Date.now() + 9000).toISOString();
  run.transport.create.mockImplementation(async body => {
    if (open) throw quota('open_receipts_operator', freesAt);
    return admit(body);
  });
  const finished = run.command.run();
  await vi.waitFor(() => expect(run.progress).toHaveBeenLastCalledWith(waiting(operatorWords)));
  expect(uploadWords(run.progress.mock.lastCall![0])).toBe(operatorWords);
  open = false;
  await vi.advanceTimersByTimeAsync(Date.parse(freesAt) - Date.now() - 1);
  expect(run.transport.create).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(await finished).toBe('retained-source');
  expect(run.transport.create.mock.calls.length).toBeGreaterThan(1);
  expect(new Set(run.transport.create.mock.calls.map(call => call[0]))).toEqual(new Set([
    run.transport.create.mock.calls[0]![0]]));
  expect(run.transport.part.mock.calls.map(call => call[1].number)).toEqual([1, 2, 3]);
  expect(run.transport.finalize).toHaveBeenCalledOnce();
  expect(run.progress).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'stopped' }));
});

it('a normal 202 slot wait re-asks the same create after 30 seconds without a failed request', async () => {
  vi.useFakeTimers();
  const run = harness();
  const create = run.transport.create;
  create.mockResolvedValueOnce({ state: 'waiting', limit: 'open_receipts_operator', freesAt: null } as never);
  const finished = run.command.run();
  await vi.advanceTimersByTimeAsync(0);
  expect(run.progress).toHaveBeenLastCalledWith(waiting(operatorWords));
  await vi.advanceTimersByTimeAsync(29_999);
  expect(create).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(await finished).toBe('retained-source');
  expect(create).toHaveBeenCalledTimes(2);
  expect(create.mock.calls[1]![0]).toBe(create.mock.calls[0]![0]);
  expect(run.progress).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'stopped' }));
});

it.each(['missing', 'later', 'past', 'invalid'] as const)(
  'a quota with %s freesAt asks again after 30 s without a local event', async timing => {
    vi.useFakeTimers();
    const run = harness();
    const now = Date.now();
    let freesAt: string | null = null;
    if (timing === 'later') freesAt = new Date(now + 60_000).toISOString();
    if (timing === 'past') freesAt = new Date(now - 1000).toISOString();
    if (timing === 'invalid') freesAt = 'not a date';
    run.transport.create.mockRejectedValueOnce(quota('open_receipts_operator', freesAt));
    const finished = run.command.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(run.progress).toHaveBeenLastCalledWith(waiting(operatorWords));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(run.transport.create).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(await finished).toBe('retained-source');
    expect(Date.now() - now).toBe(30_000);
    expect(run.transport.create).toHaveBeenCalledTimes(2);
    expect(run.transport.create.mock.calls[1]![0]).toBe(run.transport.create.mock.calls[0]![0]);
    expect(run.transport.part).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

it('a thrown command leaves no admission ticket behind', async () => {
  vi.useFakeTimers();
  const run = slotHarness();
  const failure = new Error('Progress callback failed.');
  const first = run.command('first.csv', vi.fn(progress => {
    if (progress.phase === 'waiting' || progress.phase === 'stopped') throw failure;
  }));
  const second = run.command('second.csv');
  await expect(first.command.run()).rejects.toBe(failure);
  run.slots.free = 1;
  expect(await second.command.run()).toBe('retained-source');
  expect(run.slots.started).toEqual(['second.csv']);
  expect(second.progress).not.toHaveBeenCalledWith(waiting(
    'Waiting for a free upload slot; an earlier file goes first. It starts by itself.'));
  expect(vi.getTimerCount()).toBe(0);
});

it('a command cancelled after admission leaves no ticket for the next file', async () => {
  vi.useFakeTimers();
  const run = slotHarness();
  const first = run.command('first.csv');
  const second = run.command('second.csv');
  run.transport.part.mockRejectedValueOnce(new ApiError(422, '', { error: { message: 'Part refused.' } }));
  const finished = first.command.run();
  await vi.advanceTimersByTimeAsync(0);
  expect(first.progress).toHaveBeenLastCalledWith(waiting(
    'Waiting for a free upload slot; 2 uploads are open in this case. It starts by itself.'));
  run.slots.free = 1;
  await vi.advanceTimersByTimeAsync(30_000);
  expect(first.progress).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'stopped' }));
  await first.command.cancel();
  expect(await finished).toBeNull();
  expect(run.transport.abort).toHaveBeenCalledOnce();
  run.slots.free = 1;
  expect(await second.command.run()).toBe('retained-source');
  expect(second.progress).not.toHaveBeenCalledWith(waiting(
    'Waiting for a free upload slot; an earlier file goes first. It starts by itself.'));
  expect(vi.getTimerCount()).toBe(0);
});

it('S1.3j: two files waiting for a slot start in the order they were dropped', async () => {
  vi.useFakeTimers();
  const run = slotHarness();
  const first = run.command('first.csv');
  const second = run.command('second.csv');
  const entry = { ...run.receipt, profile: limits.limits.version, sha256: 'a'.repeat(64),
    filename: 'control.csv', bytes: 1, receivedParts: 0, state: 'receiving' as const };
  const secondDone = second.command.run();
  await vi.waitFor(() => expect(second.progress).toHaveBeenLastCalledWith(expect.objectContaining({
    phase: 'waiting' })));
  const firstDone = first.command.run();
  await vi.waitFor(() => expect(first.progress).toHaveBeenLastCalledWith(waiting(
    'Waiting for a free upload slot; 2 uploads are open in this case. It starts by itself.')));
  run.slots.free = 1;
  await abortReceipt(run.transport, entry);
  expect(await firstDone).toBe('retained-source');
  expect(second.progress).toHaveBeenCalledWith(waiting(
    'Waiting for a free upload slot; an earlier file goes first. It starts by itself.'));
  run.slots.free = 1;
  await abortReceipt(run.transport, entry);
  expect(await secondDone).toBe('retained-source');
  expect(run.slots.started).toEqual(['first.csv', 'second.csv']);
});

/** Real batch caller and HTTP transport, with bounded test-only bytes and the published slot counts. */
function batchSlots(files: File[], holdFirstSend = false) {
  let releaseFirstSend!: () => void;
  const receipts = new Map<string, UploadReceipt>();
  const finishes = new Map<string, () => void>();
  const enrollments = new Map<string, () => void>();
  const attempted: string[] = [], admitted: string[] = [], sending: string[] = [];
  const failedRequests: number[] = [];
  let rows: FileOutcome[] = [];
  const respond = async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/upload-limits')) return Response.json({ ...limits,
      limits: { ...limits.limits, maxOriginalBytes: 8, partBytes: 4 },
      largeProfile: { ...limits.largeProfile, limits: { ...limits.largeProfile.limits, partBytes: 4 } } });
    if (path.endsWith('/cases/slots')) return Response.json({ case: { revision: 3 } });
    if (path.endsWith('/uploads')) {
      const body = await request.json() as UploadCreate;
      attempted.push(body.filename);
      const open = [...receipts.values()].filter(row => row.version === body.profile && row.state !== 'retained');
      const count = body.profile === limits.limits.version ? limits.limits.maxActivePerCase
        : limits.largeProfile.limits.maxActiveGlobal;
      if (open.length >= count) return Response.json({ state: 'waiting',
        limit: body.profile === limits.limits.version ? 'open_receipts_case' : 'open_receipts',
        freesAt: null }, { status: 202 });
      admitted.push(body.filename);
      const receipt = { id: body.filename, version: body.profile, revision: 1, currentCaseRevision: 3,
        state: 'receiving', parts: [], receivedBytes: 0 } as unknown as UploadReceipt;
      receipts.set(receipt.id, receipt);
      return Response.json(receipt);
    }
    if (path.endsWith('/intake/items')) {
      const body = await request.json() as { sourceId: string };
      await new Promise<void>(resolve => { enrollments.set(body.sourceId, resolve); });
      return Response.json({});
    }
    const id = path.match(/uploads\/([^/]+)/)![1]!;
    const receipt = receipts.get(id)!;
    if (path.includes('/parts/')) {
      if (!sending.includes(id)) sending.push(id);
      if (holdFirstSend && id === files[0]!.name)
        await new Promise<void>(resolve => { releaseFirstSend = resolve; });
      return Response.json(receipt);
    }
    expect(path).toMatch(/\/finalize$/);
    await new Promise<void>(resolve => { finishes.set(id, resolve); });
    const retained = { ...receipt, state: 'retained' as const, source: { sourceId: id } } as UploadReceipt;
    receipts.set(id, retained);
    return Response.json(retained);
  };
  vi.stubGlobal('fetch', async (request: Request) => {
    const response = await respond(request);
    if (!response.ok) failedRequests.push(response.status);
    return response;
  });
  const work = retainBatch('slots', files, update => { rows = update; });
  return { work, attempted, admitted, sending, finishes, enrollments, failedRequests, rows: () => rows,
    releaseFirstSend: () => releaseFirstSend() };
}

it('two batch files send together; the third waits on real quota and wakes at finalize, not enrollment', async () => {
  vi.useFakeTimers();
  const files = ['first.csv', 'second.csv', 'third.csv', 'fourth.csv'].map(name => new File(['test'], name));
  const run = batchSlots(files, true);
  await vi.waitFor(() => expect(run.attempted).toEqual(files.slice(0, 3).map(file => file.name)));
  expect(run.sending).toEqual(['first.csv', 'second.csv']);
  expect(run.finishes.has('first.csv')).toBe(false); // Its part is still in flight as the second sends.
  expect(run.rows()[2]!.upload).toMatchObject({ phase: 'waiting',
    words: 'Waiting for a free upload slot; 2 uploads are open in this case. It starts by itself.' });
  expect(uploadWords(run.rows()[3]!.upload!)).toBe(
    'Waiting for a free upload slot; an earlier file goes first. It starts by itself.');
  await vi.advanceTimersByTimeAsync(1000);
  expect(run.attempted).toHaveLength(3); // A local finalize wakes the wait before its 30 s re-ask.
  run.releaseFirstSend();
  await vi.waitFor(() => expect(run.finishes.size).toBe(2));
  run.finishes.get('second.csv')!();
  await vi.waitFor(() => expect(run.sending).toEqual(['first.csv', 'second.csv', 'third.csv']));
  expect(run.rows()[1]!.state).toBe('retaining'); // Its own enrollment has not answered.
  expect(run.finishes.has('first.csv')).toBe(true); // The earlier file is still finalizing.
  await vi.waitFor(() => expect(run.rows()[3]!.upload?.phase).toBe('waiting'));
  run.finishes.get('first.csv')!();
  await vi.waitFor(() => expect(run.sending).toEqual(files.map(file => file.name)));
  for (const name of ['third.csv', 'fourth.csv']) run.finishes.get(name)!();
  await vi.waitFor(() => expect(run.enrollments.size).toBe(4));
  for (const enroll of run.enrollments.values()) enroll();
  expect((await run.work).map(row => [row.name, row.state, row.sourceId]))
    .toEqual(files.map(file => [file.name, 'enrolled', file.name]));
  expect(run.admitted).toEqual(files.map(file => file.name));
  expect(run.failedRequests).toEqual([]);
});

it('FIFO batch admission uses two v1 receipts and one separate v2 receipt, without raising either limit', async () => {
  vi.useFakeTimers();
  const files = [new File(['test'], 'first.csv'), new File(['test_only!!!'], 'second.tif'),
    new File(['test'], 'third.csv'), new File(['test_only!!!'], 'fourth.tif')];
  const run = batchSlots(files);
  await vi.waitFor(() => expect(run.rows()[3]!.upload?.phase).toBe('waiting'));
  expect(run.sending).toEqual(files.slice(0, 3).map(file => file.name));
  expect(run.admitted).toEqual(files.slice(0, 3).map(file => file.name));
  run.finishes.get('second.tif')!();
  await vi.waitFor(() => expect(run.sending).toEqual(files.map(file => file.name)));
  for (const name of ['first.csv', 'third.csv', 'fourth.tif']) run.finishes.get(name)!();
  await vi.waitFor(() => expect(run.enrollments.size).toBe(4));
  for (const enroll of run.enrollments.values()) enroll();
  expect((await run.work).every(row => row.state === 'enrolled')).toBe(true);
});

it('a finalize during the refused create round trip wakes it without losing the notification', async () => {
  vi.useFakeTimers();
  const run = harness();
  const other = harness();
  run.transport.create.mockImplementationOnce(async () => {
    await other.command.run();
    throw quota('open_receipts_case', null);
  });
  expect(await run.command.run()).toBe('retained-source');
  expect(run.transport.create).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('a stopped create leaves the admission line so later files can start before its retry', async () => {
  vi.useFakeTimers();
  const run = slotHarness();
  const first = run.command('first.csv');
  const second = run.command('second.csv');
  run.transport.create.mockRejectedValueOnce(quota('open_receipts_case',
    new Date(Date.now() + 1000).toISOString())).mockRejectedValueOnce(new ApiError(503, '',
    { error: { message: 'Admission unavailable.' } }));
  const firstDone = first.command.run();
  await vi.advanceTimersByTimeAsync(1000);
  expect(first.progress).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'stopped' }));
  run.slots.free = 1;
  expect(await second.command.run()).toBe('retained-source');
  run.slots.free = 1;
  first.command.retry();
  expect(await firstDone).toBe('retained-source');
});

it('S1.3j: another 429 limit and a 500 keep the stopped words of today and are not asked again', async () => {
  vi.useFakeTimers();
  for (const error of [quota('case_retained_bytes', null),
    new ApiError(429, '', { error: { code: 'AREA_LIMIT', message: 'Another limit.' } }),
    new ApiError(500, '', { error: { code: 'INTERNAL', message: 'Server failure.' } })]) {
    const run = harness();
    run.transport.create.mockRejectedValue(error);
    void run.command.run();
    await vi.waitFor(() => expect(run.progress).toHaveBeenLastCalledWith(expect.objectContaining({
      phase: 'stopped', words: error.message })));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run.transport.create).toHaveBeenCalledOnce();
    expect(run.progress).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'waiting' }));
  }
});

it('S1.3j: after 30 minutes the wait stops with words and Retry upload waits again', async () => {
  vi.useFakeTimers();
  const run = harness();
  const admit = run.transport.create.getMockImplementation()!;
  run.transport.create.mockRejectedValue(quota('open_receipts', null));
  const finished = run.command.run();
  await vi.waitFor(() => expect(run.progress).toHaveBeenLastCalledWith(waiting(
    'Waiting for a free upload slot; 4 uploads are open on this service. It starts by itself.')));
  await vi.advanceTimersByTimeAsync(SLOT_WAIT_MS + 30_000);
  const stopped = run.progress.mock.lastCall![0];
  expect(stopped).toMatchObject({ phase: 'stopped', words: SLOT_STOPPED });
  expect(uploadWords(stopped)).toBe(`The upload stopped at part 1 of 3: ${SLOT_STOPPED}.`);
  const asked = run.transport.create.mock.calls.length;
  expect(asked).toBeLessThan(80);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(run.transport.create).toHaveBeenCalledTimes(asked);
  run.transport.create.mockImplementation(admit);
  run.command.retry();
  expect(await finished).toBe('retained-source');
});
