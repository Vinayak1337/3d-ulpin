import { useEffect, useRef, useState } from 'react';
import { INTAKE_SILENCE_MS, batchFrame, reconnectFailures, silenceDelay } from './batch-events';
import { runEventPath } from './run/events';
import { initialStream, type StreamState } from './table/events';

interface Connection {
  state: StreamState;
  stream: EventSource | null;
  lastActivity: number;
  reconnecting: boolean;
  failures: number;
}

/** Two independent subscribers remain: this tray/layout stream and the run panel's stream. */
export function useBatchStream(caseId: string, unsettled: boolean, refetch: () => unknown) {
  const current = useRef({ unsettled, refetch });
  current.current = { unsettled, refetch };
  const [disconnected, setDisconnected] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => startBatchUpdates(caseId, () => current.current, setDisconnected), [caseId, attempt]);
  return { disconnected, reconnect: () => setAttempt(value => value + 1) };
}

export function startBatchUpdates(caseId: string, current: () => { unsettled: boolean; refetch: () => unknown },
  disconnected: (value: boolean) => void) {
  const connection: Connection = { state: initialStream(), stream: null, lastActivity: Date.now(),
    reconnecting: false, failures: 0 };
  const refresh = () => {
    connection.lastActivity = Date.now();
    void current().refetch();
  };
  const connect = () => connectBatch(caseId, connection, refresh, disconnected);
  disconnected(false);
  connect();
  const timer = window.setInterval(() => {
    if (!connection.stream) connect();
    if (current().unsettled && silenceDelay(connection.lastActivity, Date.now()) === 0) refresh();
  }, INTAKE_SILENCE_MS);
  return () => {
    window.clearInterval(timer);
    connection.stream?.close();
  };
}

function connectBatch(caseId: string, connection: Connection, refresh: () => void,
  disconnected: (value: boolean) => void) {
  const stream = new EventSource(runEventPath(caseId, connection.state.cursor));
  connection.stream = stream;
  stream.onopen = () => {
    connection.failures = 0;
    disconnected(false);
  };
  const fail = () => {
    stream.close();
    connection.stream = null;
    connection.state.cursor = '0';
    connection.failures = reconnectFailures(connection.failures, connection.reconnecting);
    connection.reconnecting = true;
    disconnected(connection.failures >= 2);
  };
  stream.onerror = fail;
  const apply = (event: MessageEvent) => {
    try {
      const frame = batchFrame(connection.state, event.lastEventId, JSON.parse(event.data), event.type);
      connection.state = frame.state;
      if (frame.refresh) refresh();
      if (frame.reconnect) {
        stream.close();
        connection.stream = null;
        connection.reconnecting = true;
      }
    } catch {
      fail();
    }
  };
  for (const kind of ['ready', 'ingestion.change', 'resync']) stream.addEventListener(kind, apply as EventListener);
}
