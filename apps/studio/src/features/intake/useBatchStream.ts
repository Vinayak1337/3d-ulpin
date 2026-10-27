import { useEffect, useRef, useState } from 'react';
import { caseSubscriptions, type LiveStatus } from './case-subscription';

/** Tray and run consumers share one case transport; callbacks always read the current render's facts. */
export function useBatchStream(caseId: string, unsettled: boolean, refetch: () => unknown) {
  const current = useRef({ unsettled, refetch });
  current.current = { unsettled, refetch };
  const [status, setStatus] = useState<LiveStatus>({ disconnected: false, error: '' });
  useEffect(() => caseSubscriptions.subscribe(caseId, {
    refresh: () => { void current.current.refetch(); },
    unsettled: () => current.current.unsettled,
    status: setStatus,
  }), [caseId]);
  return { ...status, reconnect: () => caseSubscriptions.reconnect(caseId) };
}
