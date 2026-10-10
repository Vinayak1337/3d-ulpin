import { useEffect, useRef, useState } from 'react';
import { initialStream, reduceFrame } from './events';

/** One EventSource, as in demo-import.ts. Native reconnect sends Last-Event-ID; explicit retry uses cursor. */
export function useTableStream(caseId: string, sourceId: string, rawJobId: string, mappingJobId: string) {
  const [state, setState] = useState(() => initialStream(rawJobId, mappingJobId));
  const [fallback, setFallback] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const cursor = useRef('0');
  useEffect(() => {
    setState((previous) => ({ ...previous,
      rawJobId: rawJobId || previous.rawJobId, mappingJobId: mappingJobId || previous.mappingJobId }));
  }, [rawJobId, mappingJobId]);
  useEffect(() => {
    const url = `/api/v1/ingestion/cases/${caseId}/events?cursor=${cursor.current}`;
    const stream = new EventSource(url);
    const apply = (event: MessageEvent) => {
      try {
        const data: unknown = JSON.parse(event.data);
        setState((previous) => reduceFrame(previous, event.lastEventId, data, sourceId));
        if (event.lastEventId) cursor.current = event.lastEventId;
        if (event.type === 'resync') {
          const head = (data as { headCursor?: unknown }).headCursor;
          if (typeof head === 'string' && /^\d+$/.test(head)) cursor.current = head;
          stream.close();
          setFallback(true);
        }
      } catch {
        stream.close();
        setFallback(true);
      }
    };
    stream.onopen = () => setFallback(false);
    stream.onerror = () => setFallback(true);
    for (const kind of ['ready', 'ingestion.change', 'resync']) {
      stream.addEventListener(kind, apply as EventListener);
    }
    return () => stream.close();
  }, [caseId, sourceId, attempt]);
  return { state, fallback, reconnect: () => setAttempt((value) => value + 1) };
}
