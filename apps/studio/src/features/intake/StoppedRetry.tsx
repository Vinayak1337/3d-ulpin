import { useRef, useState } from 'react';
import { Button } from '@ulpin/ui';
import type { IntakeItem } from './batch-model';
import { retryStoppedItem } from './batch-queries';
import { createRetryCommand, retryWords, type RetryState } from './retry-command';

/** A large file stopped after repeated step errors; the officer tries it again from the steps already done. */
export function StoppedRetry({ caseId, item, refresh }: { caseId: string; item: IntakeItem; refresh: () => void }) {
  const [state, setState] = useState<RetryState>({ busy: false, uncertain: false, result: null, error: '' });
  const current = useRef(refresh);
  current.current = refresh;
  const command = useRef<ReturnType<typeof createRetryCommand> | null>(null);
  command.current ??= createRetryCommand(key => retryStoppedItem(caseId, item.itemId, key), setState,
    () => current.current());
  if (state.result) return <p role="status">Trying again (retry {state.result.retry}).</p>;
  return <>
    <Button variant="soft" disabled={state.busy} onClick={() => void command.current?.()}
      aria-label={`${retryWords(state)}: ${item.name}`}>{retryWords(state)}</Button>
    {state.error ? <p role="alert">{state.error}</p> : null}
    {state.uncertain ? <p role="status">The outcome is not known.</p> : null}
  </>;
}
