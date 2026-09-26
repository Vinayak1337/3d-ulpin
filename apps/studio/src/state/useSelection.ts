import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { readSelection, transition, writeSelection, type Selection, type SelectionEvent } from './selection';

/** Selection from the URL, and a dispatcher that writes transitions back (each a history entry). */
export function useSelection() {
  const [params, setParams] = useSearchParams();
  const selection = useMemo(() => readSelection(params), [params]);
  const dispatch = useCallback((event: SelectionEvent) => {
    setParams((current) => writeSelection(transition(readSelection(current), event), current));
  }, [setParams]);
  const patch = useCallback((change: Partial<Selection>) => {
    setParams((current) => writeSelection({ ...readSelection(current), ...change }, current), { replace: true });
  }, [setParams]);
  return { selection, dispatch, patch };
}
