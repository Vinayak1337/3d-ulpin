import { Badge, Button } from '@ulpin/ui';
import { countWords } from './batch-model';
import type { BatchStep } from './needs-model';
import styles from './Batch.module.css';

export function focusSection(id: string, controlLabel?: string) {
  const section = document.getElementById(id);
  if (!section) return;
  const control = controlLabel ? Array.from(section.querySelectorAll('button'))
    .find(button => button.getAttribute('aria-label') === controlLabel) : null;
  const target = control ?? section;
  if (!control) target.setAttribute('tabindex', '-1');
  target.focus();
  target.scrollIntoView?.({ block: 'nearest' });
}

export function StepStrip({ steps, current }: { steps: readonly BatchStep[]; current: number }) {
  return <nav aria-label="Batch steps">
    <ol className={styles.steps}>{steps.map((step, index) => <li key={step.name}>
      <Button aria-current={index === current ? 'step' : undefined} onClick={() => focusSection(step.section)}>
        {step.name} <Badge icon={null}>
          {`${countWords(step.count)}${step.waiting && step.count !== null ? ' waiting' : ''}`}
        </Badge>
      </Button>
    </li>)}</ol>
  </nav>;
}
