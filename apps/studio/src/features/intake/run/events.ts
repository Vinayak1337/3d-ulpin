import { reduceFrame, type StreamState } from '../table/events';

/** Reuse sequence/cursor validation; only a target notification (or stream control) asks for current facts. */
export function runFrame(state: StreamState, id: string, data: unknown, kind: string) {
  const next = reduceFrame(state, id, data, '');
  const frame = data as { change?: { kind?: string }; headCursor?: string };
  const changed = next.sequence !== state.sequence;
  const reconnect = kind === 'resync';
  if (reconnect) next.cursor = frame.headCursor ?? '0';
  return {
    state: { ...next, metrics: [] }, reconnect,
    refresh: kind !== 'ingestion.change' || (changed && frame.change?.kind === 'intake.target'),
  };
}
