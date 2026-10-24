import { ApiError, type Schemas } from '@ulpin/api-client';
import type { IntakeItem } from './batch-model';

export type RetryResult = Schemas['POST_ingestion_cases_caseId_intake_items_itemId_retry_Response_200_application_json'];
export interface RetryState {
  busy: boolean;
  uncertain: boolean;
  result: RetryResult | null;
  error: string;
}

// The server's sentence for a large file stopped after repeated step errors; only this one can be tried again.
export const stoppedReason = 'Preparing this file stopped after repeated errors; '
  + 'the steps already done are kept. Nothing more was prepared from it.';

export function canRetryStopped(item: IntakeItem): boolean {
  return Boolean(item.sourceId) && item.placement === 'not_understood' && item.limitReason === stoppedReason;
}

export function retryWords(state: RetryState): string {
  if (state.busy) return 'Trying again…';
  if (state.uncertain) return 'Send same retry again';
  return 'Try again';
}

/** One request key per retry until its outcome is known, so a lost answer resends the same retry. */
export function createRetryCommand(send: (requestKey: string) => Promise<RetryResult>,
  changed: (state: RetryState) => void, refresh: () => void, key: () => string = () => crypto.randomUUID()) {
  let pending: string | null = null;
  let state: RetryState = { busy: false, uncertain: false, result: null, error: '' };
  const publish = (update: Partial<RetryState>) => {
    state = { ...state, ...update };
    changed(state);
  };
  return async () => {
    if (state.busy || state.result) return;
    pending ??= key();
    publish({ busy: true, error: '' });
    try {
      const result = await send(pending);
      pending = null;
      publish({ result, uncertain: false });
      refresh();
    } catch (error) {
      const definite = error instanceof ApiError && error.status < 500;
      if (definite) pending = null;
      publish({ uncertain: !definite,
        error: error instanceof Error ? error.message : 'The server gave no answer. Send the same retry again.' });
      if (definite) refresh();
    } finally {
      publish({ busy: false });
    }
  };
}
