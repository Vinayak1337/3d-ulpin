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
const UPLOAD_IDLE_MS = 120_000;
/** Waits before a part is sent again by itself, after its first, second and later failures. */
const PART_BACKOFF_MS = [2000, 5000, 15_000];
const STALE_REVISION = /(?:upload|case) revision changed/i;
class UploadSilence extends Error {}
class PartBindingError extends Error {}
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
  silent: boolean;
}

/** Holds one upload through retries; a paused command keeps its controls while the queue continues. */
export function createUploadCommand(options: Options) {
  const state: Control = { receipt: null, cancelled: false, waiting: null, abort: null, abortBody: null, silent: false,
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
  if (context.state.silent) return;
  context.state.progress = { ...context.state.progress, ...update };
  context.publish(context.state.progress);
}

/** Except for idempotent creates, silence ends the command: the server may have received its request. */
function bounded<T>(context: Context, step: string, send: (activity: () => void) => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const activity = () => {
      if (settled) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        settled = true;
        const error = new UploadSilence(`No progress for 2 minutes while ${step}. Refresh the batch; `
          + 'resume the same file under Uploads not finished if listed, otherwise add it again');
        publish(context, { phase: 'stopped', words: error.message });
        context.state.silent = true;
        reject(error);
      }, UPLOAD_IDLE_MS);
    };
    activity();
    Promise.resolve().then(() => send(activity)).then(value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function checkedHash(context: Context, file: Blob, partBytes: number, whole = false) {
  return bounded(context, 'checking the file', activity => context.hash(file, partBytes, doneBytes => {
    activity();
    if (whole) publish(context, { doneBytes });
  }));
}

async function runUpload(context: Context): Promise<string | null> {
  const { file, transport, state, resume } = context;
  if (resume && (file.name !== resume.filename || file.size !== resume.bytes)) throw new Error(NOT_THE_FILE);
  const limits = await bounded(context, 'reading upload limits', () => transport.limits());
  const plan = uploadPlan(file.size, limits);
  publish(context, { parts: plan.parts });
  const sha256 = await checkedHash(context, file, plan.partBytes, true);
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
    const partHash = await checkedHash(context, bytes, plan.partBytes);
    // A part the server already bound keeps its request key; the server refuses any other binding.
    const part = partRequest(context, number, bytes, partHash, prior?.requestKey);
    await sendPart(context, part, profile);
  }
  if (state.cancelled) return null;
  publish(context, { phase: 'verifying', words: undefined });
  // A resumed receipt already finalizing is followed by its status; it is finalized once more only when the status
  // shows its finish is no longer held, and the server's rules decide that request.
  let again = Boolean(resume) && state.receipt!.state === 'finalizing';
  if (state.receipt!.state === 'receiving') await finalize(context, sha256, profile);
  while (state.receipt?.state === 'finalizing' && !state.cancelled) {
    if (again && finishReleased(state.receipt)) {
      again = false;
      publish(context, { words: FINISHING_AGAIN });
      await finalize(context, sha256, profile);
      continue;
    }
    await context.pause();
    state.receipt = await guarded(context, () => bounded(context, 'reading upload status',
      () => transport.status(state.receipt!)));
  }
  if (state.cancelled) return null;
  if (state.receipt?.state !== 'retained' || !state.receipt.source)
    throw new Error(state.receipt?.lastError || 'The server did not publish a retained original.');
  return state.receipt.source.sourceId;
}

/** Sends the admitted SHA-256 under the receipt's current guard and a new request key. */
async function finalize(context: Context, sha256: string, profile: ProfileLimits) {
  const body = { ...uploadGuard(context.state.receipt!, context.key()), sha256 };
  try {
    context.state.receipt = await guarded(context, () => whenSlotFree(context,
      () => bounded(context, 'finishing the upload', () => context.transport.finalize(context.state.receipt!, body)),
      profile));
  } finally { slotLine.delete(context.ticket); }
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
    return guarded(context, () => bounded(context, 'reading upload status', () => transport.status(resume)));
  }
  const revision = await bounded(context, 'reading the batch revision', () => transport.revision());
  const body: UploadCreate = { requestKey: context.key(), expectedCaseRevision: revision,
    filename: file.name, mediaType: 'application/octet-stream', sha256, bytes: file.size, profile: profile.version,
    provenance: { origin: 'not_stated', acquiredAt: context.acquiredAt } };
  try { return await guarded(context, () => whenSlotFree(context,
    remainingMs => createAttempt(context, body, remainingMs), profile, true)); }
  finally { slotLine.delete(context.ticket); }
}

/** Abort the old HTTP request before replaying its unchanged body; its late answer cannot win the race. */
async function createAttempt(context: Context, body: UploadCreate, remainingMs: number) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const quiet = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new UploadSilence());
      controller.abort();
    }, Math.max(0, Math.min(UPLOAD_IDLE_MS, remainingMs)));
  });
  try {
    return await Promise.race([quiet,
      Promise.resolve().then(() => context.transport.create(body, controller.signal))]);
  } finally { clearTimeout(timer!); }
}

/**
 * S1.3j. Slot refusals wait in drop order until 30 minutes pass. Creates also replay silence within that window;
 * resumed parts and finishes use the same line, but keep their terminal silence behaviour.
 */
async function whenSlotFree(context: Context, send: (remainingMs: number) => Promise<UploadReceipt>,
  profile: ProfileLimits, replaySilence = false) {
  let since = Date.now();
  let delay = 0;
  while (!context.state.cancelled) {
    if (slotAhead(context.ticket)) {
      publish(context, { phase: 'waiting', doneBytes: 0, words: 'Waiting for a free upload slot; an earlier file '
        + 'goes first. It starts by itself.' });
      await sleep(SLOT_FIRST_MS);
      continue;
    }
    try { return await send(SLOT_WAIT_MS - (Date.now() - since)); }
    catch (error) {
      const silence = replaySilence && error instanceof UploadSilence;
      if (error instanceof UploadSilence && !silence) throw error;
      const slot = slotRefusal(error);
      if ((slot || silence) && Date.now() - since < SLOT_WAIT_MS) {
        if (slot) slotLine.add(context.ticket);
        publish(context, { phase: 'waiting', doneBytes: 0, words: slot ? slotWords(slot.limit, profile)
          : 'The server has not answered yet while opening the upload. It asks again by itself.' });
        if (slot) {
          delay = slotDelay(delay, slot.freesAt);
          await sleep(delay);
        }
        continue;
      }
      slotLine.delete(context.ticket);
      if (!slot && !silence) throw error;
      await waitForOfficer(context, error, SLOT_STOPPED);
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

/**
 * A failed send reads the status first: a part shown received counts as sent, and a send that may succeed goes again
 * by itself with the same key, hash and bytes under refreshed guards. A confirmed failed part also goes again,
 * regardless of the send's HTTP code, within the attempt limit. A refusal that stays waits for the officer.
 */
async function sendPart(context: Context, part: PartRequest, profile: ProfileLimits) {
  let failures = 0;
  try {
    while (!context.state.cancelled) {
      publish(context, { phase: 'uploading', words: undefined, part: part.number,
        doneBytes: context.state.receipt!.receivedBytes });
      try {
        const receipt = await whenSlotFree(context, () => bounded(context, `sending part ${part.number}`,
          () => context.transport.part(context.state.receipt!, part)), profile);
        if (!receipt) return;
        context.state.receipt = receipt;
        publish(context, { doneBytes: receipt.receivedBytes });
        return;
      } catch (error) {
        if (error instanceof UploadSilence) throw error;
        const outcome = await reconcileFailedPart(context, part, error);
        if (outcome.received) return;
        failures++;
        const attempts = Math.max(failures, outcome.attempts);
        if ((outcome.failed || retryablePart(outcome.refusal)) && attempts < profile.maxPartAttempts) {
          await sleep(PART_BACKOFF_MS[Math.min(failures, PART_BACKOFF_MS.length) - 1]!);
          continue;
        }
        await waitForOfficer(context, outcome.refusal);
        if (context.state.cancelled || await reconciledAfterPress(context, part)) return;
        failures = 0;
      }
    }
  } finally { slotLine.delete(context.ticket); }
}

/** An unreadable status after a send that may succeed is weighed in its place; a refusal keeps its own words. */
async function reconcileFailedPart(context: Context, part: PartRequest, error: unknown) {
  try {
    const stored = await reconcilePart(context, part);
    return { received: stored?.state === 'received', failed: stored?.state === 'failed'
      && context.state.receipt?.state === 'receiving', refusal: error, attempts: stored?.attempts ?? 0 };
  } catch (statusError) {
    if (statusError instanceof UploadSilence) throw statusError;
    return { received: false, failed: false, refusal: retryablePart(error) ? statusError : error, attempts: 0 };
  }
}

async function reconciledAfterPress(context: Context, part: PartRequest) {
  const receipt = await guarded(context, async () => {
    await reconcilePart(context, part);
    return context.state.receipt!;
  });
  return receipt?.parts.some(value => value.partNumber === part.number && value.state === 'received');
}

/**
 * A part send that may succeed unchanged once the status is read: no answer, a server or body-read timeout, a full
 * reader allowance, a part still being written, or a stale upload or case revision. Every other refusal stays.
 */
function retryablePart(error: unknown) {
  if (!(error instanceof ApiError)) return !(error instanceof PartBindingError);
  if (error.status >= 500 || error.status === 408) return true;
  const code = errorCode(error);
  if (error.status === 429) return code === 'UPLOAD_CONCURRENCY';
  return [409, 412].includes(error.status) && (code === 'UPLOAD_BUSY' || STALE_REVISION.test(error.message));
}

function errorCode(error: ApiError) {
  return (error.body as { error?: { code?: string } } | null)?.error?.code;
}

async function reconcilePart(context: Context, part: PartRequest) {
  const receipt = await bounded(context, 'reading upload status',
    () => context.transport.status(context.state.receipt!));
  context.state.receipt = receipt;
  const stored = receipt.parts.find(value => value.partNumber === part.number);
  const mismatched = stored && (stored.requestKey !== part.headers['X-Request-Key']
    || stored.sha256 !== part.headers['X-Part-Sha256']);
  if (mismatched)
    throw new PartBindingError('The server reports a different immutable part binding. Cancel this upload.');
  // The status is a known outcome. A failed attempt advanced the receipt; only guards change, not key/hash/bytes.
  part.headers['X-Upload-Revision'] = receipt.revision;
  part.headers['X-Case-Revision'] = receipt.currentCaseRevision;
  publish(context, { doneBytes: receipt.receivedBytes });
  return stored;
}

async function guarded(context: Context, send: () => Promise<UploadReceipt | null>): Promise<UploadReceipt | null> {
  while (!context.state.cancelled) {
    try { return await send(); }
    catch (error) {
      if (error instanceof UploadSilence) throw error;
      await waitForOfficer(context, error);
    }
  }
  return null;
}

function waitForOfficer(context: Context, error: unknown, words =
  error instanceof ApiError || error instanceof PartBindingError ? error.message : 'the server did not answer') {
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
