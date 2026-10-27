import { useEffect, useState } from 'react';
import { Button } from '@ulpin/ui';
import type { IntakeItem } from './batch-model';
import type { PendingAction } from './needs-model';
import { focusSection } from './StepStrip';
import styles from './Batch.module.css';

export function NeedsYou({ actions, status, choose }: {
  actions: readonly PendingAction[]; status: string; choose: (item: IntakeItem) => void;
}) {
  const [opening, setOpening] = useState<PendingAction | null>(null);
  useEffect(() => {
    if (!opening) return;
    focusSection(opening.section, opening.controlLabel);
    setOpening(null);
  }, [opening]);
  return <section id="intake-answers" className={styles.question} aria-label="Needs you">
    {actions.length ? <ul className={styles.needs}>{actions.map(action => <li key={action.key}>
      <Button variant="soft" onClick={() => {
        choose(action.item);
        setOpening(action);
      }}>{action.label}</Button>
    </li>)}</ul> : <p role="status">{status}</p>}
  </section>;
}
