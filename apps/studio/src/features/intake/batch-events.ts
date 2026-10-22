import { runFrame } from './run/events';
import type { StreamState } from './table/events';

export function batchFrame(state: StreamState, id: string, data: unknown, kind: string) {
  const frame = runFrame(state, id, data, kind);
  return { ...frame, refresh: kind !== 'ingestion.change'
    || (frame.state.sequence !== state.sequence && intakeRefreshFrame(data)) };
}

export function reconnectFailures(previous: number, wasReconnect: boolean): number {
  return wasReconnect ? previous + 1 : previous;
}

export function intakeRefreshFrame(data: unknown) {
  if (!data || typeof data !== 'object') return false;
  if ('kind' in data && (data.kind === 'ready' || data.kind === 'resync')) return true;
  if (!('change' in data) || !data.change || typeof data.change !== 'object') return false;
  return 'kind' in data.change && ['intake.item', 'intake.target', 'recipe.changed'].includes(String(data.change.kind));
}

export const INTAKE_SILENCE_MS = 5000;

export function silenceDelay(lastEventAt: number, now: number) {
  return Math.max(INTAKE_SILENCE_MS - (now - lastEventAt), 0);
}

/** ZP2. The wait before a stream that refused its cursor opens again: 1, 2 and 4 seconds, then never over 5. */
export function resumeDelay(attempt: number) {
  return Math.min(1000 * 2 ** attempt, INTAKE_SILENCE_MS);
}
