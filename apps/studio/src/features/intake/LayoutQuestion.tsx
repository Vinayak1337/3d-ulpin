import { useState } from 'react';
import { ApiError } from '@ulpin/api-client';
import { Banner, Button, Skeleton } from '@ulpin/ui';
import type { IntakeItem } from './batch-model';
import { approveLayout, useBatchRecipe } from './batch-queries';
import { changedLayoutWords, latestRecipe, layoutLines, noLayoutWords } from './layout-model';
import type { Recipe } from './layout-model';
import styles from './Batch.module.css';

/** Read and approve only. The officer's layout question is a separate task. */
export function LayoutQuestion({ caseId, item, refresh }: {
  caseId: string; item: IntakeItem; refresh: () => void;
}) {
  const query = useBatchRecipe(caseId, item.plan?.recipeId ?? '');
  const receipt = latestRecipe(query.data ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [changed, setChanged] = useState(false);
  const approve = async (shown: Recipe) => {
    setBusy(true);
    setError('');
    setChanged(false);
    try {
      await approveLayout(caseId, shown);
      await query.refetch();
      refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The server gave no answer. Refresh before approving.');
      if (failure instanceof ApiError && failure.status === 409) {
        setChanged(true);
        await query.refetch();
        refresh();
      }
    } finally {
      setBusy(false);
    }
  };
  return <LayoutPanel item={item} receipt={receipt} pending={query.isPending} readError={query.error?.message}
    busy={busy} changed={changed} error={error} approve={() => receipt && void approve(receipt)} />;
}

function LayoutPanel({ item, receipt, pending, readError, busy, changed, error, approve }: {
  item: IntakeItem; receipt?: Recipe; pending: boolean; readError?: string;
  busy: boolean; changed: boolean; error: string; approve: () => void;
}) {
  return <section className={styles.question} aria-label={`Layout for ${item.name}`}>
    <h2 className="ul-heading">Layout · {item.name}</h2>
    {!item.plan ? <p>{noLayoutWords}</p> : <>
      {pending ? <Skeleton /> : null}
      {readError ? <Banner tone="danger">{readError}</Banner> : null}
      {changed ? <Banner tone="warning">{changedLayoutWords}</Banner> : null}
      {error ? <p role="alert">{error}</p> : null}
      {receipt ? <>
        <p className="ul-help">Revision {receipt.revision} · {receipt.state}</p>
        {layoutLines(receipt, item.plan.origin).map((line, index) => <p key={index}>{line}</p>)}
        {receipt.state === 'proposed' ? <Button variant="primary" onClick={approve}
          disabled={busy || Boolean(readError)}>{busy ? 'Approving layout…' : 'Approve layout'}</Button>
          : <p>This layout is {receipt.state === 'approved' ? 'approved' : 'executed'} and is read-only.</p>}
      </> : null}
      {!pending && !readError && !receipt ? <p>Layout: not supplied by the record</p> : null}
    </>}
  </section>;
}
