import { ApiError } from '@ulpin/api-client';

export interface CaseFrame {
  kind: string;
  id: string;
  data: unknown;
}

// Server heartbeatMs = 10,000 (ingestion/events.ts:15); three missed keep-alives end a silent transport.
export const CASE_STREAM_IDLE_MS = 30000;

export class CaseStreamSilence extends Error {
  constructor() { super('Live batch updates stopped answering.'); }
}

/** Fetch exposes refusal status/words without opening a second event reader to diagnose EventSource.onerror. */
export async function readCaseStream(path: string, signal: AbortSignal, opened: () => void,
  frame: (value: CaseFrame) => void): Promise<void> {
  const controller = new AbortController();
  const ended = () => controller.abort(signal.reason);
  signal.addEventListener('abort', ended, { once: true });
  if (signal.aborted) ended();
  let timer = setTimeout(() => controller.abort(new CaseStreamSilence()), CASE_STREAM_IDLE_MS);
  const activity = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new CaseStreamSilence()), CASE_STREAM_IDLE_MS);
  };
  try {
    await receiveStream(path, controller.signal, opened, frame, activity);
  } catch (error) {
    if (controller.signal.reason instanceof CaseStreamSilence) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', ended);
  }
}

async function receiveStream(path: string, signal: AbortSignal, opened: () => void,
  frame: (value: CaseFrame) => void, activity: () => void) {
  const response = await fetch(path, { signal, credentials: 'same-origin', headers: { Accept: 'text/event-stream' } });
  if (!response.ok) throw new ApiError(response.status, path, await response.json().catch(() => null));
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    throw new Error('The server did not supply live batch updates.');
  }
  opened();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (!signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('Live batch updates ended. Reconnecting.');
      if (chunk.value.length) activity();
      pending += decoder.decode(chunk.value, { stream: true });
      if (pending.length > 1024 * 1024) throw new Error('The live update exceeded the bounded frame size.');
      const parsed = takeFrames(pending);
      pending = parsed.remaining;
      for (const value of parsed.frames) frame(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function takeFrames(text: string): { frames: CaseFrame[]; remaining: string } {
  const parts = text.split(/\r?\n\r?\n/);
  const remaining = parts.pop() ?? '';
  const frames: CaseFrame[] = [];
  for (const part of parts) {
    let kind = 'message';
    let id = '';
    const data: string[] = [];
    for (const line of part.split(/\r?\n/)) {
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') kind = value;
      if (field === 'id') id = value;
      if (field === 'data') data.push(value);
    }
    if (data.length) frames.push({ kind, id, data: JSON.parse(data.join('\n')) });
  }
  return { frames, remaining };
}
