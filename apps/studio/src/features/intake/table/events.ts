import type { Metrics } from './types';

export interface StreamState {
  cursor: string;
  sequence: string;
  rawJobId: string;
  mappingJobId: string;
  metrics: Metrics[];
  refresh: number;
}

export function initialStream(rawJobId = '', mappingJobId = ''): StreamState {
  return { cursor: '0', sequence: '0', rawJobId, mappingJobId, metrics: [], refresh: 0 };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error('The stream frame is not an object.');
  return value as Record<string, unknown>;
}

function metricOf(change: Record<string, unknown>): Metrics {
  const numbers = ['chunkIndex', 'teacherCalls', 'memoryHits', 'studentFields', 'teacherFields',
    'needsInput', 'latencyMs'];
  if (typeof change.jobId !== 'string' || !['new', 'memory'].includes(String(change.layout)) ||
      !numbers.every((key) => typeof change[key] === 'number' && Number.isFinite(change[key]) &&
        (change[key] as number) >= 0) ||
      !(change.learnerVersion === null || typeof change.learnerVersion === 'string')) {
    throw new Error('The learner frame is incomplete.');
  }
  return change as unknown as Metrics;
}

/** Notifications only trigger reads; status, reasons and column values come from the status/chunk responses. */
export function reduceFrame(state: StreamState, id: string, data: unknown, sourceId: string): StreamState {
  const frame = object(data);
  if (frame.kind === 'ready') return { ...state, cursor: id || state.cursor, refresh: state.refresh + 1 };
  if (frame.kind === 'resync') return { ...state, refresh: state.refresh + 1 };
  if (typeof frame.sequence !== 'string' || !/^[1-9]\d*$/.test(frame.sequence)) {
    throw new Error('The stream sequence is missing.');
  }
  if (BigInt(frame.sequence) <= BigInt(state.sequence)) return state;
  const next = { ...state, cursor: id || state.cursor, sequence: frame.sequence };
  const change = object(frame.change);
  if (change.kind === 'mapping.chunk') {
    const metric = metricOf(change);
    const metrics = state.metrics.filter((item) =>
      item.jobId !== metric.jobId || item.chunkIndex !== metric.chunkIndex);
    return { ...next, metrics: [...metrics, metric], refresh: state.refresh + 1 };
  }
  if (change.sourceId !== sourceId || typeof change.jobId !== 'string') return next;
  if (String(change.kind).startsWith('streaming-vector.')) {
    return { ...next, rawJobId: change.jobId, refresh: state.refresh + 1 };
  }
  if (String(change.kind).startsWith('chunk-mapping.')) {
    return { ...next, mappingJobId: change.jobId, refresh: state.refresh + 1 };
  }
  return next;
}
