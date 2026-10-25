import { ApiError } from '@ulpin/api-client';
import { hashFile } from './hash-file';
import type { PartRequest, UploadTransport } from './upload-api';
import { uploadGuard, uploadPlan } from './upload-model';
import type { UploadCreate, UploadEntry, UploadGuard, UploadLimits, UploadProgress, UploadReceipt }
  from './upload-model';

export const NOT_THE_FILE = 'This is not the file this upload was started with.';
export const FINISHING_AGAIN = 'The last finish was interrupted; finishing the upload again.';
/** v2 storage job outcomes after which the job no longer holds the finish. */
const ENDED_JOBS: readonly string[] = ['failed', 'stale', 'cancelled'];
/** The open-receipt limits a finalize or abort frees, with the published count each names. */
const SLOT_LIMITS: Record<string, { count: string; words: string }> = {
  open_receipts: { count: 'maxActiveGlobal', words: 'uploads are open on this service' },
  open_receipts_operator: { count: 'maxActivePerOperator', words: 'of your uploads are open' },
  open_receipts_case: { count: 'maxActivePerCase', words: 'uploads are open in this case' },
};
const SLOT_FIRST_MS = 2000;
const SLOT_LONGEST_MS = 30_000;
export const SLOT_WAIT_MS = 30 * 60 * 1000;
export const SLOT_STOPPED = 'no upload slot became free within 30 minutes';
/** Commands that wait for an upload slot, by the order they were made; only the earliest asks the server. */
const slotLine = new Set<number>();
let lastTicket = 0;
type ProfileLimits = UploadLimits['limits'] | UploadLimits['largeProfile']['limits'];

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
    pause: options.pause ?? (() => sleep(5000)), state, ticket: ++lastTicket };
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
type Context = Options & {
  hash: typeof hashFile; key: () => string; pause: () => Promise<void>; state: Control; ticket: number;
};

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

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
  const profile = plan.profile === limits.limits.version ? limits.limits : limits.largeProfile.limits;
  state.receipt = await openReceipt(context, sha256, profile);
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
  publish(context, { phase: 'verifying', words: undefined });
  // A resumed receipt already finalizing is followed by its status; it is finalized once more only when the status
  // shows its finish is no longer held, and the server's rules decide that request.
  let again = Boolean(resume) && state.receipt!.state === 'finalizing';
  if (state.receipt!.state === 'receiving') await finalize(context, sha256);
  while (state.receipt?.state === 'finalizing' && !state.cancelled) {
    if (again && finishReleased(state.receipt)) {
      again = false;
      publish(context, { words: FINISHING_AGAIN });
      await finalize(context, sha256);
      continue;
    }
    await context.pause();
    state.receipt = await guarded(context, () => transport.status(state.receipt!));
  }
  if (state.cancelled) return null;
  if (state.receipt?.state !== 'retained' || !state.receipt.source)
    throw new Error(state.receipt?.lastError || 'The server did not publish a retained original.');
  return state.receipt.source.sourceId;
}

/** Sends the admitted SHA-256 under the receipt's current guard and a new request key. */
async function finalize(context: Context, sha256: string) {
  const body = { ...uploadGuard(context.state.receipt!, context.key()), sha256 };
  context.state.receipt = await guarded(context, () => context.transport.finalize(context.state.receipt!, body));
}

/** v1: the finalization lease has expired. v2: the storage job ended without publishing the original. */
function finishReleased(receipt: UploadReceipt) {
  if (receipt.version === 'large-original/1')
    return receipt.leaseExpiresAt !== null && Date.parse(receipt.leaseExpiresAt) <= Date.now();
  return ENDED_JOBS.includes(receipt.finalization?.jobStatus ?? '');
}

/** A resume names its receipt only after name, size and SHA-256 match the file; a mismatch sends nothing. */
async function openReceipt(context: Context, sha256: string, profile: ProfileLimits) {
  const { file, transport } = context;
  if (context.resume) {
    const { resume } = context;
    if (sha256 !== resume.sha256) throw new Error(NOT_THE_FILE);
    return guarded(context, () => transport.status(resume));
  }
  const body: UploadCreate = { requestKey: context.key(), expectedCaseRevision: await transport.revision(),
    filename: file.name, mediaType: 'application/octet-stream', sha256, bytes: file.size, profile: profile.version,
    provenance: { origin: 'not_stated', acquiredAt: context.acquiredAt } };
  try { return await createWhenFree(context, body, profile); }
  finally { slotLine.delete(context.ticket); }
}

/**
 * S1.3j. A create refused for an open-receipt slot waits and asks again by itself, after an earlier waiting file has
 * started, until 30 minutes pass; every other failure stops for the officer as before. The same body is sent again.
 */
async function createWhenFree(context: Context, body: UploadCreate, profile: ProfileLimits) {
  let since = Date.now();
  let delay = 0;
  while (!context.state.cancelled) {
    if (slotAhead(context.ticket)) {
      publish(context, { phase: 'waiting', doneBytes: 0, words: 'Waiting for a free upload slot; an earlier file '
        + 'goes first. It starts by itself.' });
      await sleep(SLOT_FIRST_MS);
      continue;
    }
    try { return await context.transport.create(body); }
    catch (error) {
      const slot = slotRefusal(error);
      if (slot && Date.now() - since < SLOT_WAIT_MS) {
        slotLine.add(context.ticket);
        publish(context, { phase: 'waiting', doneBytes: 0, words: slotWords(slot.limit, profile) });
        delay = slotDelay(delay, slot.freesAt);
        await sleep(delay);
        continue;
      }
      slotLine.delete(context.ticket);
      await waitForOfficer(context, error, slot ? SLOT_STOPPED : undefined);
      since = Date.now();
      delay = 0;
    }
  }
  return null;
}

function slotAhead(ticket: number) {
  return [...slotLine].some(other => other < ticket);
}

/** The slot a 429 UPLOAD_QUOTA names and when it frees at the latest; null for every other failure. */
function slotRefusal(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 429) return null;
  const wrapped = (error.body as { error?: { code?: unknown; details?: { limit?: unknown; freesAt?: unknown } } }
    | null)?.error;
  const limit = String(wrapped?.details?.limit);
  if (wrapped?.code !== 'UPLOAD_QUOTA' || !Object.hasOwn(SLOT_LIMITS, limit)) return null;
  const freesAt = wrapped.details?.freesAt;
  return { limit, freesAt: typeof freesAt === 'string' ? Date.parse(freesAt) : NaN };
}

function slotWords(limit: string, profile: ProfileLimits) {
  const { count, words } = SLOT_LIMITS[limit]!;
  const open = (profile as Record<string, unknown>)[count];
  const reason = typeof open === 'number' ? `${open} ${words}` : 'the open uploads are at their limit';
  return `Waiting for a free upload slot; ${reason}. It starts by itself.`;
}

/** Doubles from 2 to 30 seconds; a slot whose receipt expires sooner is asked for just after it frees. */
function slotDelay(previous: number, freesAt: number) {
  const backoff = Math.min(SLOT_LONGEST_MS, Math.max(SLOT_FIRST_MS, previous * 2));
  const untilFree = freesAt - Date.now() + 500;
  return Number.isFinite(untilFree) ? Math.max(SLOT_FIRST_MS, Math.min(backoff, untilFree)) : backoff;
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

function waitForOfficer(context: Context, error: unknown,
  words = error instanceof ApiError ? error.message : 'the server did not answer') {
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

/** A receipt left being cancelled finishes through the existing cleanup route, with its own guard. */
export function cleanupReceipt(transport: UploadTransport, entry: UploadEntry,
  key: () => string = () => crypto.randomUUID()) {
  return transport.cleanup(entry, uploadGuard(entry, key()));
}
