import assert from 'node:assert/strict';
import { CaseIngestionControlSchema, CaseIngestionEventSchema,
  type CaseIngestionEvent } from '../../../../packages/contracts/src/usp';

type Frame = { event: string; body: unknown };
type State = { frames: Frame[]; events: CaseIngestionEvent[]; ended: boolean; error?: unknown; wake?: () => void };

/** Two real HTTP readers, each parsed by the canonical wire schema; no event injection. */
export async function openStream(caseId: string) {
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${process.env.API_PORT}/api/v1/ingestion/cases/${caseId}/events`,
    { signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
  const state: State = { frames: [], events: [], ended: false };
  const running = consumeFrames(response.body!.getReader(), state).catch(error => {
    if (!controller.signal.aborted) state.error = error;
  }).finally(() => { state.ended = true; state.wake?.(); });
  const wait = (predicate: () => boolean) => awaitFrames(state, predicate);
  await wait(() => state.frames.some(frame => frame.event === 'ready'));
  return { status: response.status, events: state.events, frames: state.frames, wait,
    close: async () => { controller.abort(); await running; } };
}

async function consumeFrames(reader: ReadableStreamDefaultReader<Uint8Array>, state: State) {
  const decoder = new TextDecoder();
  let pending = '';
  while (true) {
    const part = await reader.read();
    if (part.done) return;
    pending += decoder.decode(part.value, { stream: true });
    let edge: number;
    while ((edge = pending.indexOf('\n\n')) >= 0) {
      const raw = pending.slice(0, edge);
      pending = pending.slice(edge + 2);
      const frame = parseFrame(raw);
      if (!frame) continue;
      state.frames.push(frame);
      if (frame.event === 'ingestion.change') state.events.push(CaseIngestionEventSchema.parse(frame.body));
      else CaseIngestionControlSchema.parse(frame.body);
      state.wake?.();
    }
  }
}

async function awaitFrames(state: State, predicate: () => boolean) {
  for (let index = 0; index < 20 && !predicate(); index++) {
    if (state.error) throw state.error;
    assert(!state.ended, 'The live reader ended before its required events: ' + JSON.stringify(state.frames));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Live notification not observed in 8 seconds.')), 8000);
      state.wake = () => { clearTimeout(timer); resolve(); };
    });
  }
  if (state.error) throw state.error;
  assert(predicate(), 'Live reader exceeded the bounded frame count.');
}

function parseFrame(raw: string): Frame | null {
  const lines = raw.split('\n');
  const event = lines.find(line => line.startsWith('event: '))?.slice(7);
  const data = lines.find(line => line.startsWith('data: '))?.slice(6);
  return event && data ? { event, body: JSON.parse(data) } : null;
}
