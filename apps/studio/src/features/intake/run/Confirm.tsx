import { useId } from 'react';
import { Button, Panel } from '@ulpin/ui';
import { PackageDetails } from './Packages';
import { confirmablePackages, INTAKE_TARGET_LIMITS, type Target, type TargetPage } from './model';
import styles from './Run.module.css';

interface Props {
  page: TargetPage;
  choice: readonly Target[];
  acknowledgement: string;
  setAcknowledgement: (words: string) => void;
  press: () => void;
  busy: boolean;
  uncertain: boolean;
  stale: boolean;
  error: string;
}

export function Confirm(props: Props) {
  const helpId = useId();
  const packages = confirmablePackages(props.page);
  const locked = props.busy || props.uncertain;
  const allowed = packages.length > 0 && props.choice.length > 0 && props.acknowledgement.trim().length > 0;
  return <Panel title="One confirmation" className={styles.stack}>
    <p>These packages will be recorded in the register. The {props.choice.length} chosen buildings will then
      get a snapshot, an evidence plan and packet, and a property card made and verified without another press.
      Every other ready building of these packages will be recorded without a card.</p>
    {packages.map(pkg => <PackageDetails key={pkg.packageId} pkg={pkg} confirming />)}
    <p>Recording cannot be undone. If a building stops, completed steps are kept. A card proves what the
      record cites, not ownership or a right. Buildings do not receive a space identity.</p>
    <label className={styles.field}>Your acknowledgement
      <textarea rows={3} maxLength={500} value={props.acknowledgement} disabled={locked}
        aria-describedby={helpId} onChange={event => props.setAcknowledgement(event.target.value)} />
    </label>
    <p id={helpId} className="ul-help">Type your own words. They will be stored exactly as you type them.</p>
    <p>{props.choice.length} of at most {INTAKE_TARGET_LIMITS.confirmationTargets} buildings chosen for a card.</p>
    {props.error ? <p role="alert">{props.error}</p> : null}
    {props.uncertain ? <p>The outcome is not known. Send the same confirmation again to find or store it;
      the buildings and your words stay unchanged.</p> : null}
    <Button variant="primary" disabled={props.busy || (!props.uncertain && (!allowed || props.stale))}
      onClick={props.press}>
      {pressLabel(props.busy, props.uncertain)}
    </Button>
    {!allowed && !props.uncertain ? <p className="ul-help">Choose ready buildings and type your acknowledgement
      before confirming. Only packages with a current review can be recorded.</p> : null}
    {props.stale ? <p className="ul-help">The current batch could not be read. Refresh it before confirming.</p> : null}
  </Panel>;
}

function pressLabel(busy: boolean, uncertain: boolean): string {
  if (busy) return 'Storing confirmation…';
  if (uncertain) return 'Send same confirmation again';
  return 'Record packages and make chosen cards';
}
