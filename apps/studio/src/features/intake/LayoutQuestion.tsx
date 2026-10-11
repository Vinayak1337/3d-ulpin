import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Skeleton } from '@ulpin/ui';
import type { IntakeItem } from './batch-model';
import { recipeKey, useBatchRecipe } from './batch-queries';
import { changedLayoutWords, latestRecipe, layoutLines, recipeStateWords } from './layout-model';
import type { Recipe } from './layout-model';
import { needsLayoutAnswer } from './question-model';
import { LayoutAnswer } from './LayoutAnswer';
import { useLayoutCommand } from './useLayoutCommand';
import styles from './Batch.module.css';

export function LayoutQuestion({ caseId, item, refresh }: {
  caseId: string; item: IntakeItem; refresh: () => void;
}) {
  const cache = useQueryClient();
  const refreshLayout = () => {
    refresh();
    void cache.invalidateQueries({ queryKey: recipeKey(caseId) }, { cancelRefetch: false });
  };
  const command = useLayoutCommand(caseId, item.sourceId ?? '', refreshLayout);
  const query = useBatchRecipe(caseId, item.plan?.recipeId ?? command.state.receipt?.id ?? '');
  const receipt = latestRecipe([...(query.data ?? []), ...(command.state.receipt ? [command.state.receipt] : [])]);
  const [editingRevision, setEditingRevision] = useState<number | null>(null);
  const editing = editingRevision !== null && !command.state.changed
    && (!command.state.receipt || command.state.receipt.revision <= editingRevision);
  const answer = needsLayoutAnswer(item) && !receipt || editing
    || command.state.uncertain && command.state.phase === 'author';
  const authored = command.state.authored && receipt?.planHash === command.state.receipt?.planHash;
  const origin = authored ? 'officer' : item.plan?.origin ?? null;
  return <section className={styles.question} aria-label={`Layout for ${item.name}`}>
    <h2 className="ul-heading">Layout · {item.name}</h2>
    {command.state.changed ? <Banner tone="warning">{changedLayoutWords}</Banner> : null}
    {answer && item.sourceId ? <LayoutAnswer key={editingRevision ?? 'new'} caseId={caseId} sourceId={item.sourceId}
      receipt={editing ? receipt : undefined} command={command} /> : <>
      {query.isPending && (item.plan || command.state.receipt) ? <Skeleton /> : null}
      {query.error ? <Banner tone="danger">{query.error.message}</Banner> : null}
      {receipt ? <LayoutReview receipt={receipt} origin={origin} command={command}
        readFailed={Boolean(query.error)} change={() => setEditingRevision(receipt.revision)} /> : null}
      {!receipt && !query.error && !item.plan ?
        <p>{item.limitReason ?? 'Layout: not supplied by the record'}</p> : null}
    </>}
  </section>;
}

function LayoutReview({ receipt, origin, command, readFailed, change }: {
  receipt: Recipe; origin: NonNullable<IntakeItem['plan']>['origin'];
  command: ReturnType<typeof useLayoutCommand>; readFailed: boolean; change: () => void;
}) {
  const locked = command.state.busy || command.state.uncertain;
  const proposed = receipt.state === 'proposed';
  return <>
    <p className="ul-help">Revision {receipt.revision}</p>
    {layoutLines(receipt, origin).map((line, index) => <p key={index}>{line}</p>)}
    <p>{recipeStateWords(receipt.state)}</p>
    {command.state.error ? <p role="alert">{command.state.error}</p> : null}
    {command.state.uncertain ? <p>The outcome is not known. Send the same approval again;
      its layout and request stay unchanged.</p> : null}
    {proposed || command.state.uncertain ? <div className="ul-row">
      <Button variant="primary" disabled={command.state.busy || readFailed}
        onClick={() => void command.approve(receipt)}>
        {approveWords(command.state.busy, command.state.uncertain)}
      </Button>
      <Button variant="soft" disabled={locked || readFailed || !proposed} onClick={change}>Change</Button>
    </div> : null}
  </>;
}

function approveWords(busy: boolean, uncertain: boolean): string {
  if (busy) return 'Approving layout…';
  if (uncertain) return 'Send same approval again';
  return 'Approve layout';
}
