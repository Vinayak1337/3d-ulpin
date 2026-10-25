import { useEffect, useRef } from 'react';
import { Button, Panel } from '@ulpin/ui';
import { PackageDetails, type AnchorItems } from './Packages';
import { cardsOnlyWords, confirmablePackages, confirmationWords, PACKAGE_PAGE,
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
  const packages = confirmablePackages(props.page);
  const { cards } = props;
  const locked = props.busy || props.uncertain;
  const typed = props.acknowledgement.trim().length > 0;
  const allowed = (cards ? cards.length : packages.length) > 0 && typed;
  return <Panel title="One confirmation" className={styles.stack}>
    {cards ? <CardsList cards={cards} close={props.closeCards} locked={locked} /> : <>
      <p>{confirmationWords(props.choice.length)}</p>
      {packages.map(pkg => <PackageDetails key={pkg.packageId} pkg={pkg} items={props.items} confirming />)}
      <PackagePages page={props.page} next={props.next} first={props.first} locked={locked} />
    </>}
    {cards ? null : <p>Recording cannot be undone.</p>}
    <label className={styles.field}>Your acknowledgement
      <textarea rows={3} maxLength={500} value={props.acknowledgement} disabled={locked}
        onChange={event => props.setAcknowledgement(event.target.value)} />
    </label>
    {props.error ? <p role="alert">{props.error}</p> : null}
    {props.uncertain ? <p role="status">The outcome is not known.</p> : null}
    <Button variant="primary" disabled={props.busy || (!props.uncertain && (!allowed || props.stale))}
      onClick={props.press}>
      {pressLabel(props.busy, props.uncertain, Boolean(cards))}
    </Button>
    {!typed && !props.uncertain ? <p>Type your acknowledgement before confirming.</p> : null}
    {!allowed && !props.uncertain && typed && !cards ? <p>No package can be recorded: each needs a current review,
      ready buildings or none, and no recording under way.</p> : null}
    {props.stale ? <p>The current batch could not be read. Refresh it before confirming.</p> : null}
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
      + 'a card is already in a confirmation.'}</p>
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
