import { useEffect, useRef } from 'react';
import { initialStream, type StreamState } from '../table/events';
import { runEventPath, runFrame } from './events';
import { shouldRefetch, type Target } from './model';

interface Connection {
  state: StreamState;
  lastActivity: number;
  stream: EventSource | null;
}

/** The table reducer supplies cursor/sequence deduplication; notifications only trigger reads. */
export function useRunStream(caseId: string, progress: readonly Target[], refresh: () => void) {
  const current = useRef({ progress, refresh });
  current.current = { progress, refresh };
  useEffect(() => {
    const connection: Connection = { state: initialStream(), lastActivity: Date.now(), stream: null };
    const refetch = () => current.current.refresh();
    connect(caseId, connection, refetch);
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (shouldRefetch(current.current.progress, connection.lastActivity, now)) {
        connection.lastActivity = now;
        refetch();
      }
      if (!connection.stream) connect(caseId, connection, refetch);
    }, 5000);
    return () => { window.clearInterval(timer); connection.stream?.close(); };
  }, [caseId]);
}

function connect(caseId: string, connection: Connection, refresh: () => void) {
  const stream = new EventSource(runEventPath(caseId, connection.state.cursor));
  connection.stream = stream;
  stream.onerror = () => {
    stream.close();
    connection.state.cursor = '0';
    connection.stream = null;
  };
  const apply = (event: MessageEvent) => {
    try {
      const frame = runFrame(connection.state, event.lastEventId, JSON.parse(event.data), event.type);
      connection.state = frame.state;
      if (frame.refresh) {
        connection.lastActivity = Date.now();
        refresh();
      }
      if (frame.reconnect) {
        stream.close();
        connection.stream = null;
      }
    } catch {
      stream.close();
      connection.stream = null;
    }
  };
  for (const kind of ['ready', 'ingestion.change', 'resync']) stream.addEventListener(kind, apply as EventListener);
}
