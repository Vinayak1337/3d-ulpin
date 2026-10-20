import { ApiError } from '@ulpin/api-client';
import { hashFile } from './hash-file';
import type { PartRequest, UploadTransport } from './upload-api';
import { uploadGuard, uploadPlan } from './upload-model';
import type { UploadCreate, UploadEntry, UploadGuard, UploadProgress, UploadReceipt } from './upload-model';

export const NOT_THE_FILE = 'This is not the file this upload was started with.';

/** A fresh upload states when its file was acquired; a resume continues the receipt it names, as admitted. */
type Start = { acquiredAt: string; resume?: undefined } | { resume: UploadEntry; acquiredAt?: undefined };
type Options = Start & {
  file: File;
  transport: UploadTransport;
  publish: (progress: UploadProgress) => void;
  hash?: typeof hashFile;
  key?: () => string;
  pause?: () => Promise<void>;
};
interface Control {
  receipt: UploadReceipt | null;
  cancelled: boolean;
  waiting: (() => void) | null;
  abort: Promise<void> | null;
  abortBody: UploadGuard | null;
  progress: UploadProgress;
}

/** Holds one upload through explicit retries; later files cannot start while this file is paused. */
export function createUploadCommand(options: Options) {
  const state: Control = { receipt: null, cancelled: false, waiting: null, abort: null, abortBody: null,
    progress: { phase: 'checking', doneBytes: 0, totalBytes: options.file.size, part: 1, parts: 0 } };
  const context = { ...options, hash: options.hash ?? hashFile, key: options.key ?? (() => crypto.randomUUID()),
    pause: options.pause ?? (() => new Promise<void>(resolve => setTimeout(resolve, 5000))), state };
  return {
    run: () => runUpload(context),
    retry: () => {
      state.waiting?.();
      state.waiting = null;
    },
    cancel: () => {
      state.abort ??= cancelUpload(context).catch(error => {
        state.abort = null;
        throw error;
      });
      return state.abort;
    },
  };
}
type Context = Options & { hash: typeof hashFile; key: () => string; pause: () => Promise<void>; state: Control };

function publish(context: Context, update: Partial<UploadProgress>) {
  context.state.progress = { ...context.state.progress, ...update };
  context.publish(context.state.progress);
}

async function runUpload(context: Context): Promise<string | null> {
  const { file, transport, state, resume } = context;
  if (resume && (file.name !== resume.filename || file.size !== resume.bytes)) throw new Error(NOT_THE_FILE);
  const limits = await transport.limits();
  const plan = uploadPlan(file.size, limits);
  publish(context, { parts: plan.parts });
  const sha256 = await context.hash(file, plan.partBytes, doneBytes => publish(context, { doneBytes }));
  if (state.cancelled) return null;
  state.receipt = await openReceipt(context, sha256, plan.profile);
  if (!state.receipt) return null;
  publish(context, { phase: 'uploading', doneBytes: state.receipt.receivedBytes });
  const stored = new Map(state.receipt.parts.map(part => [part.partNumber, part]));
  for (let number = 1; number <= plan.parts && !state.cancelled; number++) {
    const prior = stored.get(number);
    if (prior?.state === 'received') continue;
    const bytes = file.slice((number - 1) * plan.partBytes, number * plan.partBytes);
    const partHash = await context.hash(bytes, plan.partBytes, () => {});
    // A part the server already bound keeps its request key; the server refuses any other binding.
    const part = partRequest(context, number, bytes, partHash, prior?.requestKey);
    await sendPart(context, part, limits.limits.maxPartAttempts);
  }
  if (state.cancelled) return null;
  publish(context, { phase: 'verifying' });
  // A resumed receipt already finalizing is followed by its status only; a second finalize would queue it again.
  if (state.receipt!.state === 'receiving') {
    const finalize = { ...uploadGuard(state.receipt!, context.key()), sha256 };
    state.receipt = await guarded(context, () => transport.finalize(state.receipt!, finalize));
  }
  while (state.receipt?.state === 'finalizing' && !state.cancelled) {
    await context.pause();
    state.receipt = await guarded(context, () => transport.status(state.receipt!));
  }
  if (state.cancelled) return null;
  if (state.receipt?.state !== 'retained' || !state.receipt.source)
    throw new Error(state.receipt?.lastError || 'The server did not publish a retained original.');
  return state.receipt.source.sourceId;
}

/** A resume names its receipt only after name, size and SHA-256 match the file; a mismatch sends nothing. */
async function openReceipt(context: Context, sha256: string, profile: UploadCreate['profile']) {
  const { file, transport } = context;
  if (context.resume) {
    const { resume } = context;
    if (sha256 !== resume.sha256) throw new Error(NOT_THE_FILE);
    return guarded(context, () => transport.status(resume));
  }
  const body: UploadCreate = { requestKey: context.key(), expectedCaseRevision: await transport.revision(),
    filename: file.name, mediaType: 'application/octet-stream', sha256, bytes: file.size, profile,
    provenance: { origin: 'not_stated', acquiredAt: context.acquiredAt } };
  return guarded(context, () => transport.create(body));
}

function partRequest(context: Context, number: number, bytes: Blob, hash: string,
  requestKey = context.key()): PartRequest {
  const receipt = context.state.receipt!;
  return { number, bytes, headers: { 'X-Request-Key': requestKey, 'X-Part-Sha256': hash,
    'X-Upload-Revision': receipt.revision, 'X-Case-Revision': receipt.currentCaseRevision } };
}

async function sendPart(context: Context, part: PartRequest, maximum: number) {
  let failures = 0;
  while (!context.state.cancelled) {
    publish(context, { phase: 'uploading', part: part.number, doneBytes: context.state.receipt!.receivedBytes });
    try {
      context.state.receipt = await context.transport.part(context.state.receipt!, part);
      publish(context, { doneBytes: context.state.receipt.receivedBytes });
      return;
    } catch (error) {
      failures++;
      const definite = error instanceof ApiError && error.status < 500;
      if (definite || failures >= maximum) {
        await waitForOfficer(context, error);
        if (context.state.cancelled) return;
        await reconcilePart(context, part);
        failures = 0;
      }
      // Unknown sends repeat every saved header and the same Blob; no revision is guessed.
    }
  }
}

async function reconcilePart(context: Context, part: PartRequest) {
  const receipt = await context.transport.status(context.state.receipt!);
  context.state.receipt = receipt;
  const stored = receipt.parts.find(value => value.partNumber === part.number);
  const mismatched = stored && (stored.requestKey !== part.headers['X-Request-Key']
    || stored.sha256 !== part.headers['X-Part-Sha256']);
  if (mismatched)
    throw new Error('The server reports a different immutable part binding. Cancel this upload.');
  // The status is a known outcome. A failed attempt advanced the receipt; only guards change, not key/hash/bytes.
  if (stored?.state === 'failed' || !stored) {
    part.headers['X-Upload-Revision'] = receipt.revision;
    part.headers['X-Case-Revision'] = receipt.currentCaseRevision;
  }
}

async function guarded(context: Context, send: () => Promise<UploadReceipt>): Promise<UploadReceipt | null> {
  while (!context.state.cancelled) {
    try { return await send(); }
    catch (error) { await waitForOfficer(context, error); }
  }
  return null;
}

function waitForOfficer(context: Context, error: unknown) {
  const words = error instanceof ApiError ? error.message : 'the server did not answer';
  publish(context, { phase: 'stopped', words });
  return new Promise<void>(resolve => { context.state.waiting = resolve; });
}

async function cancelUpload(context: Context) {
  const { state, transport } = context;
  // Cancel is offered only while paused, never racing an active part/finalization request.
  if (!state.waiting) return;
  if (!state.receipt) throw new Error('Send the same request again to find the upload before cancelling it.');
  if (!state.abortBody) {
    state.receipt = await transport.status(state.receipt);
    state.abortBody = uploadGuard(state.receipt, context.key());
  }
  await transport.abort(state.receipt, state.abortBody);
  state.cancelled = true;
  publish(context, { phase: 'cancelled' });
  state.waiting?.();
  state.waiting = null;
}

/** N04. Cancels a listed receipt with its own guard; a changed revision is refused by the server, in its words. */
export function abortReceipt(transport: UploadTransport, entry: UploadEntry,
  key: () => string = () => crypto.randomUUID()) {
  return transport.abort(entry, uploadGuard(entry, key()));
}
