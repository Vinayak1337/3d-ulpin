import { useRef, useState } from 'react';
import { failureWords, prioritizeTarget } from './api';
import type { Target } from './model';

/** One request per opened listed building, shared by its list row and its progress row. */
export function usePriority(caseId: string) {
  const sent = useRef(new Set<string>());
  const [error, setError] = useState('');
  const open = (target: Target) => {
    if (!target.confirmationId || target.readiness === 'carded' || sent.current.has(target.targetId)) return;
    sent.current.add(target.targetId);
    void prioritizeTarget(caseId, target.targetId).catch(failure => setError(failureWords(failure)));
  };
  return { open, error };
}
