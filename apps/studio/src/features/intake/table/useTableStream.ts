import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { resumeDelay } from '../batch-events';
import { initialStream, reduceFrame } from './events';
import type { StreamState } from './events';

/** Native reconnect sends Last-Event-ID; explicit retry uses the last accepted cursor. */
export function useTableStream(caseId: string, sourceId: string, rawJobId: string, mappingJobId: string) {
  const [state, setState] = useState(() => initialStream(rawJobId, mappingJobId));
  const [fallback, setFallback] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const cursor = useRef('0');
  const resumes = useRef(0);
  const current = useRef(state);
  const selected = useRef({ rawJobId, mappingJobId });
  useEffect(() => {
    selected.current = { rawJobId, mappingJobId };
    const next = { ...current.current,
      rawJobId: rawJobId || current.current.rawJobId, mappingJobId: mappingJobId || current.current.mappingJobId };
    current.current = next;
    setState(next);
  }, [rawJobId, mappingJobId]);
  useEffect(() => openTableStream(caseId, sourceId, { current, cursor, selected, resumes },
    { publish: setState, fallback: setFallback, reopen: () => setAttempt((value) => value + 1) }),
  [caseId, sourceId, attempt]);
  const followApproved = () => {
    selected.current.mappingJobId = '';
    setAttempt((value) => value + 1);
  };
  return { state, fallback, reconnect: () => setAttempt((value) => value + 1), followApproved };
}

interface TableStreamRefs {
  current: RefObject<StreamState>;
  cursor: RefObject<string>;
  selected: RefObject<{ rawJobId: string; mappingJobId: string }>;
  resumes: RefObject<number>;
}
interface TableStreamEffects {
  publish: (state: StreamState) => void;
  fallback: (value: boolean) => void;
  reopen: () => void;
}

/** The first open replays from the cursor; an empty cursor tails the head, as a refused replay resumes. */
function tableEventPath(caseId: string, cursor: string) {
  const path = `/api/v1/ingestion/cases/${caseId}/events`;
  return cursor ? `${path}?cursor=${cursor}` : path;
}

export function openTableStream(caseId: string, sourceId: string, refs: TableStreamRefs,
  effects: TableStreamEffects) {
  const stream = new EventSource(tableEventPath(caseId, refs.cursor.current));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const restart = () => {
    stream.close();
    effects.fallback(true);
    timer = setTimeout(effects.reopen, resumeDelay(refs.resumes.current++));
  };
  const apply = (event: MessageEvent) => {
    try {
      const data: unknown = JSON.parse(event.data);
      // Reduce synchronously so a bad frame reaches this catch, not React's render/error boundary.
      accept(refs, effects, reduceFrame(refs.current.current, event.lastEventId, data, sourceId,
        refs.selected.current));
      if (event.type === 'resync') {
        const head = (data as { headCursor?: unknown }).headCursor;
        if (typeof head === 'string' && /^\d+$/.test(head)) refs.cursor.current = head;
        restart();
      }
    } catch {
      stream.close();
      effects.fallback(true);
    }
  };
  stream.onopen = () => {
    refs.resumes.current = 0;
    effects.fallback(false);
  };
  stream.onerror = () => {
    if (stream.readyState !== EventSource.CLOSED) {
      effects.fallback(true);
      return;
    }
    // ZP2. A refused open (409 on a replay past its bound) closes the source for good: re-read, then tail the head.
    accept(refs, effects, { ...refs.current.current, cursor: '', refresh: refs.current.current.refresh + 1 });
    restart();
  };
  for (const kind of ['ready', 'ingestion.change', 'resync']) {
    stream.addEventListener(kind, apply as EventListener);
  }
  return () => {
    clearTimeout(timer);
    stream.close();
  };
}

function accept(refs: TableStreamRefs, effects: TableStreamEffects, next: StreamState) {
  refs.current.current = next;
  refs.cursor.current = next.cursor;
  effects.publish(next);
}
