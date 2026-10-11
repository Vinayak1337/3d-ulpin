import { Button } from '@ulpin/ui';
import { ArtefactLinks } from './ArtefactLinks';
import { readinessLabels, readinessWords, waitingReason, INTAKE_TARGET_LIMITS } from './model';
import type { Readiness, Target } from './model';
import styles from './Run.module.css';

interface Props {
  targets: readonly Target[];
  choice: readonly Target[];
  filter: Readiness | '';
  setFilter: (filter: Readiness | '') => void;
  toggle: (target: Target) => void;
  selectable: (target: Target) => boolean;
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
  const checked = props.choice.some(value => value.targetId === target.targetId);
  const atLimit = props.choice.length >= INTAKE_TARGET_LIMITS.confirmationTargets;
  const reason = waitingReason(target);
  return <li className={styles.target}>
    <label className={styles.tick}>
      <input type="checkbox" checked={checked} disabled={props.locked || !props.selectable(target)
        || (!checked && atLimit)} onChange={() => props.toggle(target)} />
      <span className={styles.locator}>{target.locator}</span>
    </label>
    <p>{readinessWords[target.readiness]}</p>
    {reason ? <p className={styles.reason}>{reason}</p> : null}
    <ArtefactLinks target={target} onOpen={() => props.onOpen(target)} />
  </li>;
}
