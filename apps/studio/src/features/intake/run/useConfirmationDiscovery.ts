import { useEffect, useRef, useState } from 'react';
import { readTargets } from './api';
import { confirmationIds, type Target } from './model';

/** One unfiltered cursor sweep on mount recovers stored confirmations without replacing the visible list. */
export function useConfirmationDiscovery(caseId: string, first: readonly Target[] | undefined, cursor: string | null) {
  const initial = useRef({ first, cursor });
  initial.current = { first, cursor };
  const available = first !== undefined;
  const [ids, setIds] = useState<string[]>([]);
  const [reasons, setReasons] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setIds(current => [...new Set([...current, ...confirmationIds(first ?? [])])]);
    setReasons(current => packageReasons(current, first ?? []));
  }, [first]);
  useEffect(() => {
    if (!available) return;
    let live = true;
    const discover = async () => {
      let next = initial.current.cursor;
      while (live && next) {
        const page = await readTargets(caseId, undefined, next);
        if (!live) return;
        setIds(current => [...new Set([...current, ...confirmationIds(page.items)])]);
        setReasons(current => packageReasons(current, page.items));
        next = page.nextCursor;
      }
    };
    void discover().catch(failure => { if (live) setError(failure); });
    return () => { live = false; };
  }, [caseId, available]);
  return { ids, reasons, error };
}

function packageReasons(current: Record<string, string[]>, targets: readonly Target[]) {
  const next = { ...current };
  for (const target of targets) {
    if (!target.reason || !['preparing', 'held', 'needs_answer'].includes(target.readiness)) continue;
    next[target.packageId] = [...new Set([...(next[target.packageId] ?? []), target.reason])];
  }
  return next;
}
