import { ApiError } from '@ulpin/api-client';
import { batchFrame, INTAKE_SILENCE_MS, reconnectFailures, silenceDelay } from './batch-events';
import { runEventPath } from './run/events';
import { initialStream, type StreamState } from './table/events';
import { CaseStreamSilence, readCaseStream, type CaseFrame } from './stream-reader';

export interface LiveStatus {
  disconnected: boolean;
  error: string;
}
export interface Consumer {
  refresh: () => void;
  unsettled: () => boolean;
  status: (value: LiveStatus) => void;
}
interface Connection {
  state: StreamState;
  consumers: Set<Consumer>;
  abort: AbortController | null;
  lastActivity: number;
  failed: boolean;
  reconnecting: boolean;
  failures: number;
  status: LiveStatus;
  timer: ReturnType<typeof setInterval> | null;
  closed: () => void;
}

/** One page-local, ref-counted transport per case. It holds notifications only, never domain facts. */
export function createCaseSubscriptions(read = readCaseStream) {
  const connections = new Map<string, Connection>();
  const subscribe = (caseId: string, consumer: Consumer) => {
    let connection = connections.get(caseId);
    if (!connection) {
      connection = newConnection(() => connections.delete(caseId));
      connections.set(caseId, connection);
    }
    connection.consumers.add(consumer);
    consumer.status(connection.status);
    if (!connection.timer) {
      const owned = connection;
      owned.timer = setInterval(() => tick(caseId, owned, read), INTAKE_SILENCE_MS);
      connect(caseId, owned, read);
    }
    return () => {
      connection.consumers.delete(consumer);
      if (connection.consumers.size) return;
      if (connection.timer) clearInterval(connection.timer);
      connection.timer = null;
      connection.abort?.abort();
      // An immediate remount must wait for this reader's cancellation to settle.
      if (!connection.abort) connection.closed();
    };
  };
  const reconnect = (caseId: string) => {
    const connection = connections.get(caseId);
    if (!connection) return;
    connection.state.cursor = '0';
    connection.abort?.abort();
    if (!connection.abort) connect(caseId, connection, read);
  };
  return { subscribe, reconnect };
}

function newConnection(closed: () => void): Connection {
  return { state: initialStream(), consumers: new Set(), abort: null, lastActivity: Date.now(), failed: false,
    reconnecting: false, failures: 0, status: { disconnected: false, error: '' }, timer: null, closed };
}

function tick(caseId: string, connection: Connection, read: typeof readCaseStream) {
  if (!connection.abort) connect(caseId, connection, read);
  if (silenceDelay(connection.lastActivity, Date.now()) !== 0) return;
  const waiting = [...connection.consumers].filter(consumer => connection.failed || consumer.unsettled());
  if (!waiting.length) return;
  connection.lastActivity = Date.now();
  for (const consumer of waiting) consumer.refresh();
}

function connect(caseId: string, connection: Connection, read: typeof readCaseStream) {
  if (connection.abort || !connection.consumers.size) return;
  const abort = new AbortController();
  connection.abort = abort;
  const opened = () => {
    connection.failed = false;
    connection.failures = 0;
    connection.reconnecting = false;
    publish(connection, { disconnected: false, error: '' });
  };
  const apply = (value: CaseFrame) => {
    const next = batchFrame(connection.state, value.id, value.data, value.kind);
    connection.state = next.state;
    if (next.refresh) {
      connection.lastActivity = Date.now();
      for (const consumer of connection.consumers) consumer.refresh();
    }
    if (next.reconnect) {
      connection.reconnecting = true;
      abort.abort();
    }
  };
  void read(runEventPath(caseId, connection.state.cursor), abort.signal, opened, apply).catch(error => {
    if (!abort.signal.aborted) failed(connection, error);
  }).finally(() => {
    if (connection.abort === abort) connection.abort = null;
    if (!connection.consumers.size) connection.closed();
    else if (abort.signal.aborted) connect(caseId, connection, read);
  });
}

function failed(connection: Connection, error: unknown) {
  connection.state.cursor = '0';
  connection.failed = true;
  connection.failures = reconnectFailures(connection.failures, connection.reconnecting);
  connection.reconnecting = true;
  const words = error instanceof ApiError ? error.message : '';
  const disconnected = error instanceof CaseStreamSilence || Boolean(words) || connection.failures >= 2;
  publish(connection, { disconnected, error: words });
}

function publish(connection: Connection, status: LiveStatus) {
  connection.status = status;
  for (const consumer of connection.consumers) consumer.status(status);
}

export const caseSubscriptions = createCaseSubscriptions();
