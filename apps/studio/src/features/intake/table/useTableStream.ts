import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { initialStream, reduceFrame } from './events';
import type { StreamState } from './events';

/** Native reconnect sends Last-Event-ID; explicit retry uses the last accepted cursor. */
export function useTableStream(caseId: string, sourceId: string, rawJobId: string, mappingJobId: string) {
  const [state, setState] = useState(() => initialStream(rawJobId, mappingJobId));
  const [fallback, setFallback] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const cursor = useRef('0');
  const current = useRef(state);
  const selected = useRef({ rawJobId, mappingJobId });
  useEffect(() => {
    selected.current = { rawJobId, mappingJobId };
    const next = { ...current.current,
      rawJobId: rawJobId || current.current.rawJobId, mappingJobId: mappingJobId || current.current.mappingJobId };
    current.current = next;
    setState(next);
  }, [rawJobId, mappingJobId]);
  useEffect(() => openTableStream(caseId, sourceId, current, cursor, selected, setState, setFallback),
    [caseId, sourceId, attempt]);
  const followApproved = () => {
    selected.current.mappingJobId = '';
    setAttempt((value) => value + 1);
  };
  return { state, fallback, reconnect: () => setAttempt((value) => value + 1), followApproved };
}

function openTableStream(caseId: string, sourceId: string, current: RefObject<StreamState>,
  cursor: RefObject<string>, selected: RefObject<{ rawJobId: string; mappingJobId: string }>,
  publish: (state: StreamState) => void, fallback: (value: boolean) => void) {
  const stream = new EventSource(`/api/v1/ingestion/cases/${caseId}/events?cursor=${cursor.current}`);
  const apply = (event: MessageEvent) => {
    try {
      const data: unknown = JSON.parse(event.data);
      // Reduce synchronously so a bad frame reaches this catch, not React's render/error boundary.
      const next = reduceFrame(current.current, event.lastEventId, data, sourceId, selected.current);
      current.current = next;
      cursor.current = next.cursor;
      publish(next);
      if (event.type === 'resync') {
        const head = (data as { headCursor?: unknown }).headCursor;
        if (typeof head === 'string' && /^\d+$/.test(head)) cursor.current = head;
        stream.close();
        fallback(true);
      }
    } catch {
      stream.close();
      fallback(true);
    }
  };
  stream.onopen = () => fallback(false);
  stream.onerror = () => fallback(true);
  for (const kind of ['ready', 'ingestion.change', 'resync']) {
    stream.addEventListener(kind, apply as EventListener);
  }
  return () => stream.close();
}
