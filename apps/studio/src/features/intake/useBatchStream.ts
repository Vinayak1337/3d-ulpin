import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { INTAKE_SILENCE_MS, intakeRefreshFrame, silenceDelay } from './batch-events';

/** Events invalidate records. A quiet, unfinished batch is read at most once per five seconds. */
export function useBatchStream(caseId: string, unsettled: boolean, refetch: () => unknown) {
  const refresh = useRef(refetch);
  refresh.current = refetch;
  const lastEvent = useRef(Date.now());
  const cursor = useRef('0');
  const [disconnected, setDisconnected] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => openBatchStream(caseId, cursor, lastEvent, refresh, setDisconnected), [caseId, attempt]);
  useEffect(() => {
    if (!unsettled) return;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const delay = silenceDelay(lastEvent.current, Date.now());
      if (delay === 0) {
        lastEvent.current = Date.now();
        void refresh.current();
      }
      timer = setTimeout(check, delay || INTAKE_SILENCE_MS);
    };
    timer = setTimeout(check, INTAKE_SILENCE_MS);
    return () => clearTimeout(timer);
  }, [caseId, unsettled]);
  return { disconnected, reconnect: () => setAttempt((value) => value + 1) };
}

function openBatchStream(caseId: string, cursor: RefObject<string>, lastEvent: RefObject<number>,
  refresh: RefObject<() => unknown>, disconnected: (value: boolean) => void) {
  const stream = new EventSource(`/api/v1/ingestion/cases/${caseId}/events?cursor=${cursor.current}`);
  const apply = (event: MessageEvent) => {
    try {
      const data: unknown = JSON.parse(event.data);
      if (event.lastEventId) cursor.current = event.lastEventId;
      if (intakeRefreshFrame(data)) {
        lastEvent.current = Date.now();
        void refresh.current();
      }
      if (event.type === 'resync') {
        const head = (data as { headCursor?: unknown }).headCursor;
        if (typeof head === 'string' && /^\d+$/.test(head)) cursor.current = head;
        stream.close();
        disconnected(true);
      }
    } catch {
      stream.close();
      disconnected(true);
    }
  };
  stream.onopen = () => disconnected(false);
  stream.onerror = () => disconnected(true);
  for (const kind of ['ready', 'ingestion.change', 'resync']) {
    stream.addEventListener(kind, apply as EventListener);
  }
  return () => stream.close();
}
