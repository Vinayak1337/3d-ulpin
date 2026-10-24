import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { ApiError } from '@ulpin/api-client';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { expect, it, vi } from 'vitest';
import published from '../../../../../docs/api/openapi.json';
import { hashSlices } from './file-hash';
import { partProgressWords } from './batch-model';
import { abortReceipt, cleanupReceipt, createUploadCommand, FINISHING_AGAIN, NOT_THE_FILE } from './upload-command';
import { LARGE_UPLOAD_MINIMUM, uploadPlan, uploadWords, type UploadCreate, type UploadEntry,
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

// N04. Real inputs from docs/api/datasets.json: a 4-part GeoJSON whose last part is short, and a 6-part GeoJSON.
const NIAGARA = 'E:/BhuAayam-data/datasets/map-formats/niagara-falls/'
  + 'Niagara_Falls_Building_Footprints_2018_1330698285055863645.geojson';
const NYC = 'E:/BhuAayam-data/datasets/nyc-second-area/nyc-office-of-technology-and-innovation/'
  + '5zhs-2jue-box-w74.025-s40.700-e73.940-n40.800.geojson';
const real = (path: string) => new File([readFileSync(path)], basename(path));
const realHash = (blob: Blob) => hashSlices(blob, limits.limits.partBytes, () => {});

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
});

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
  });

it('Cancel upload aborts a listed receipt with its own guard', async () => {
  const file = new File([new Uint8Array(LARGE_UPLOAD_MINIMUM)], 'control.geojson');
  const { entry, transport } = await openReceipt(file, [1]);
  await abortReceipt(transport, entry, () => 'abort-key');
  expect(transport.abort).toHaveBeenCalledWith(entry, { requestKey: 'abort-key', expectedRevision: 9,
    expectedCaseRevision: 3 });
});

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
