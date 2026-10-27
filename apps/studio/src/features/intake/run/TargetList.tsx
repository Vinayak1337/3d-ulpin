import { useId } from 'react';
import { Button } from '@ulpin/ui';
import { DisabledReason } from '../DisabledReason';
import { focusSection } from '../StepStrip';
import { ArtefactLinks } from './ArtefactLinks';
import { readinessLabels, waitingReason, INTAKE_TARGET_LIMITS } from './model';
import type { Package, Readiness, Target } from './model';
import styles from './Run.module.css';

interface Props {
  targets: readonly Target[];
  choice: readonly Target[];
  filter: Readiness | '';
  setFilter: (filter: Readiness | '') => void;
  toggle: (target: Target) => void;
  selectable: (target: Target) => boolean;
  /** Packages another confirmation's run is recording; their buildings are not offered. */
  recording: ReadonlySet<string>;
  packages?: readonly Package[];
  onOpen: (target: Target) => void;
  showMore: () => void;
  hasMore: boolean;
  loading: boolean;
  locked: boolean;
}

export function TargetList(props: Props) {
  return <section className={styles.stack} aria-label="Buildings of the batch">
    <label className={styles.field}>Show buildings
      <select value={props.filter} disabled={props.locked || props.loading}
        onChange={event => props.setFilter(event.target.value as Readiness | '')}>
        <option value="">Any readiness</option>
        {(Object.keys(readinessLabels) as Readiness[]).map(readiness =>
          <option key={readiness} value={readiness}>{readinessLabels[readiness]}</option>)}
      </select>
    </label>
    <ul className={`${styles.list} ${styles.targetList}`} tabIndex={0} aria-label="Paged building list">
      {props.targets.map(target => <TargetRow key={target.targetId} target={target} props={props} />)}
    </ul>
    {!props.loading && props.targets.length === 0 ? <p>No buildings match this read.</p> : null}
    {props.hasMore ? <Button disabled={props.loading || props.locked} onClick={props.showMore}>
      {props.loading ? 'Reading buildings…' : 'Show more'}
    </Button> : null}
  </section>;
}

function TargetRow({ target, props }: { target: Target; props: Props }) {
  const reasonId = useId();
  const checked = props.choice.some(value => value.targetId === target.targetId);
  const atLimit = props.choice.length >= INTAKE_TARGET_LIMITS.confirmationTargets;
  const pkg = props.packages?.find(row => row.packageId === target.packageId);
  let reason = '';
  if (!props.locked) {
    if (!props.selectable(target)) {
      if (target.readiness !== 'ready') reason = waitingReason(target) ?? readinessLabels[target.readiness];
      else if (props.recording.has(target.packageId)) reason = 'Being recorded with its package.';
      else if (pkg?.reviewRefusal) reason = pkg.reviewRefusal.message;
      else if (pkg?.state === 'COMMITTED') reason = 'Its package is already recorded.';
      else reason = pkg ? 'Its package has no current review.' : 'Its package is not on this page.';
    } else if (!checked && atLimit) reason = `${props.choice.length} buildings already chosen.`;
  }
  let action;
  if (target.readiness === 'needs_answer') {
    action = { label: 'Answer', press: () => focusSection('intake-answers') };
  } else if (!checked && atLimit && props.selectable(target)) {
    action = { label: 'Change choice', press: () => focusSection('intake-run-panel', 'Clear choice') };
  }
  return <li className={styles.target}>
    <label className={styles.tick}>
      <input type="checkbox" checked={checked} disabled={props.locked || !props.selectable(target)
        || (!checked && atLimit)} aria-describedby={reason ? reasonId : undefined}
        onChange={() => props.toggle(target)} />
      <span className={styles.locator}>{target.locator}</span>
    </label>
    {reason ? <DisabledReason id={reasonId} action={action}>{reason}</DisabledReason> : null}
    {reason === readinessLabels[target.readiness] ? null : <p>{readinessLabels[target.readiness]}</p>}
    <ArtefactLinks target={target} onOpen={() => props.onOpen(target)} />
  </li>;
}
