import { useEffect, useId, useRef } from 'react';
import { Button, Panel } from '@ulpin/ui';
import { PackageDetails, type AnchorItems } from './Packages';
import { cardsOnlyWords, confirmablePackages, confirmationWords, INTAKE_TARGET_LIMITS, PACKAGE_PAGE,
  remainingPackagesWords, type Target, type TargetPage } from './model';
import styles from './Run.module.css';

interface Props {
  page: TargetPage;
  /** The batch's files, to head each package with its file's name. */
  items?: AnchorItems;
  choice: readonly Target[];
  cards: readonly Target[] | null;
  closeCards: () => void;
  acknowledgement: string;
  setAcknowledgement: (words: string) => void;
  press: () => void;
  busy: boolean;
  uncertain: boolean;
  stale: boolean;
  error: string;
  /** Moves to the next page of packages; absent where the confirmation cannot move. */
  next?: () => void;
  /** Returns to the first page of packages; absent on the first page. */
  first?: () => void;
}

export function Confirm(props: Props) {
  const helpId = useId();
  const packages = confirmablePackages(props.page);
  const { cards } = props;
  const locked = props.busy || props.uncertain;
  const allowed = (cards ? cards.length : packages.length) > 0 && props.acknowledgement.trim().length > 0;
  return <Panel title="One confirmation" className={styles.stack}>
    {cards ? <CardsList cards={cards} close={props.closeCards} locked={locked} /> : <>
      <p>{confirmationWords(props.choice.length)}</p>
      {packages.map(pkg => <PackageDetails key={pkg.packageId} pkg={pkg} items={props.items} confirming />)}
      <PackagePages page={props.page} next={props.next} first={props.first} locked={locked} />
    </>}
    <p>{cards ? '' : 'Recording cannot be undone. '}If a building stops, completed steps are kept. A card proves
      what the record cites, not ownership or a right. Buildings do not receive a space identity.</p>
    <label className={styles.field}>Your acknowledgement
      <textarea rows={3} maxLength={500} value={props.acknowledgement} disabled={locked}
        aria-describedby={helpId} onChange={event => props.setAcknowledgement(event.target.value)} />
    </label>
    <p id={helpId} className="ul-help">Type your own words. They will be stored exactly as you type them.</p>
    {cards ? null : <p>{props.choice.length} of at most {INTAKE_TARGET_LIMITS.confirmationTargets} buildings
      chosen for a card.</p>}
    {props.error ? <p role="alert">{props.error}</p> : null}
    {props.uncertain ? <p>The outcome is not known. Send the same confirmation again to find or store it;
      the buildings and your words stay unchanged.</p> : null}
    <Button variant="primary" disabled={props.busy || (!props.uncertain && (!allowed || props.stale))}
      onClick={props.press}>
      {pressLabel(props.busy, props.uncertain, Boolean(cards))}
    </Button>
    {!allowed && !props.uncertain ? <p className="ul-help">Type your acknowledgement before confirming.
      {cards ? '' : ' Only packages with a current review, not being recorded, and with ready buildings or no '
        + 'buildings can be recorded.'}
    </p> : null}
    {props.stale ? <p className="ul-help">The current batch could not be read. Refresh it before confirming.</p> : null}
  </Panel>;
}

/** While packages not yet recorded follow the listed ones, the officer takes the next page for another press. */
export function PackagePages({ page, next, first, locked }: {
  page: TargetPage; next?: () => void; first?: () => void; locked: boolean;
}) {
  const after = page.packagesUnrecordedAfter ?? 0;
  const more = Boolean(next && page.packagesNextCursor && after > 0);
  if (!more && !first) return null;
  return <div className={styles.stack}>
    {more ? <p role="status">{remainingPackagesWords(page.packages.length, after)}</p> : null}
    <div className={styles.controls}>
      {more ? <Button disabled={locked} onClick={next}>Next {PACKAGE_PAGE} packages</Button> : null}
      {first ? <Button disabled={locked} onClick={first}>Back to the first packages</Button> : null}
    </div>
  </div>;
}

/** The recorded buildings a cards-only confirmation names, in the order their cards are made. */
function CardsList({ cards, close, locked }: { cards: readonly Target[]; close: () => void; locked: boolean }) {
  const words = useRef<HTMLParagraphElement>(null);
  useEffect(() => words.current?.focus(), []);
  return <>
    <p ref={words} tabIndex={-1}>{cards.length ? cardsOnlyWords(cards.length) : 'Every recorded building without '
      + 'a card is already listed in a confirmation; its card is made in turn.'}</p>
    <ol className={styles.list}>
      {cards.map(target => <li key={target.targetId} className={styles.target}>
        <span className="ul-id">{target.locator}</span>
      </li>)}
    </ol>
    <Button disabled={locked} onClick={close}>Back to recording packages</Button>
  </>;
}

function pressLabel(busy: boolean, uncertain: boolean, cardsOnly: boolean): string {
  if (busy) return 'Storing confirmation…';
  if (uncertain) return 'Send same confirmation again';
  return cardsOnly ? 'Make these cards' : 'Record packages and make chosen cards';
}
