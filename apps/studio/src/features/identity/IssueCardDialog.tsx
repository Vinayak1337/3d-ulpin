import { useState, type ReactNode } from 'react';
import { Banner, Button, Dialog } from '@ulpin/ui';
import { useBuildingCanonical, useBuildingRegister, type ListedCard } from '../../api/queries';
import { sourceLabelGaps, type RecordedUnit } from '../review/recorded/model';
import { assignSubject } from './assignment';
import { expiryError, expiryInstant, inclusionError, type IssueTarget } from './issue';
import { AnsweredFacts, IssueForm, PreviewFacts, TypedReason, type IssueEntries } from './IssueParts';
import type { Typed } from './prepare';
import { UnitDecided, UnitUnread } from './UnitDecided';
import { useFieldFocus } from './useFieldFocus';
import { useIssueFlow, type IssueFlow } from './useIssueFlow';
import styles from './Registry.module.css';

const STORES = 'Prepare is not a dry run: it stores a snapshot, a plan and a packet in the registry. '
  + 'Only Issue card stores a card.';
const READS = 'Prepare reads the listed card and the rows its next revision would state. It stores nothing. '
  + 'Only Issue new revision stores a card.';
const NO_CARD_YET = 'No card exists yet. Closing this dialog undoes nothing; opening it again starts a new Prepare.';
const SAME_REQUEST = 'The registry lists no new card for this unit. The card request can be sent again: it goes '
  + 'with the same key, so the registry stores at most one card for it.';

/** What the steps and the reads after them left to say: a stop, a refusal, an unknown outcome, a stored card. */
function Outcome({ flow }: { flow: IssueFlow }) {
  const card = flow.issue.data;
  return (
    <>
      {flow.stopped ? <Banner tone="warning">{flow.stopped} Prepare stopped: no plan was created.</Banner> : null}
      {flow.failure ? <Banner tone={flow.failure.unknown ? 'warning' : 'danger'}>{flow.failure.text}</Banner> : null}
      {flow.readError ? <Banner tone="warning">{flow.readError}</Banner> : null}
      {flow.again ? <Banner tone="info">{SAME_REQUEST}</Banner> : null}
      {flow.found ? (
        <Banner tone="info">
          The registry lists revision {flow.found.revision} of card {flow.found.cardId}: the card was stored.
        </Banner>
      ) : null}
      {card && !flow.busy && !flow.readError ? (
        <Banner tone="warning">
          The registry answered card {card.cardId}, revision {card.revision}. The cards read after it do not list
          this revision.
        </Banner>
      ) : null}
    </>
  );
}

function footer(flow: IssueFlow, primary: ReactNode, onClose: () => void) {
  if (flow.found) return <Button variant="primary" onClick={onClose}>Close</Button>;
  const issued = flow.issue.isSuccess;
  const refused = flow.prepared && flow.issue.error && !flow.mustRead;
  return (
    <div className={styles.actions}>
      <Button variant="ghost" onClick={onClose}>{flow.prepared ? 'Close' : 'Cancel'}</Button>
      {refused ? <Button disabled={flow.busy} onClick={flow.prepareAgain}>Prepare again</Button> : null}
      {flow.mustRead || issued ? (
        <Button disabled={flow.busy} onClick={flow.readAgain}>Read the record again</Button>
      ) : null}
      {issued ? null : primary}
    </div>
  );
}

/** What Prepare sends for what was typed, or null when the form refuses the expiry before anything is sent. */
function typedNow(entries: IssueEntries): Typed | null {
  const expiresAt = expiryInstant(entries.validUntil);
  if (!expiresAt || expiryError(entries.validUntil, Date.now())) return null;
  return { expiresAt, inclusionReason: entries.inclusion };
}

/** The form until Prepare answered; after it what was sent, what the registry answered and the rows of the card. */
function Prepared({ flow, first, sent, form }: {
  flow: IssueFlow; first: boolean; sent: Typed | null; form: ReactNode;
}) {
  const { prepared } = flow;
  const reason = first && sent ? <TypedReason typed={sent} /> : null;
  return (
    <>
      <p>{first ? STORES : READS}</p>
      {prepared ? reason : form}
      <AnsweredFacts answered={flow.answered} />
      {prepared ? <PreviewFacts preview={prepared.preview} /> : null}
      {prepared && first && !flow.issue.isSuccess && !flow.found ? <p className="ul-help">{NO_CARD_YET}</p> : null}
      <Outcome flow={flow} />
    </>
  );
}

/**
 * Issue a card of a recorded unit through the registry: a first card from a new plan, or the next revision of
 * the card that is valid now. The officer reads the rows the registry answers before the card exists, and the
 * dialog closes once the registry lists the card.
 */
export function IssueCardDialog({ buildingId, unit, floorLabel, target, listed, onClose }: {
  buildingId: string; unit: RecordedUnit; floorLabel: string; target: IssueTarget; listed: readonly ListedCard[];
  onClose: () => void;
}) {
  const canonical = useBuildingCanonical(buildingId);
  const registered = useBuildingRegister(buildingId);
  const [building, register, unread] = [canonical.data, registered.data, canonical.error ?? registered.error];
  const flow = useIssueFlow({ buildingId, unitId: unit.id }, target, listed, onClose);
  const [entries, setEntries] = useState<IssueEntries>({ validUntil: '', inclusion: '' });
  const [sent, setSent] = useState<Typed | null>(null);
  const [refused, setRefused] = useState(false);
  const first = target.mode === 'create';
  const subject = building && register ? assignSubject(building, register, unit.id) : null;
  const stated = subject && typeof subject !== 'string' ? subject : null;
  const ready = stated && !flow.mustRead && !flow.busy;
  const incomplete = !entries.validUntil || (first && Boolean(inclusionError(entries.inclusion)));
  const prepare = () => {
    const typed = typedNow(entries);
    setRefused(!typed);
    if (!typed || !stated) return;
    setSent(typed);
    flow.prepare.mutate({ subject: stated, typed });
  };
  const { prepared } = flow;
  const body = useFieldFocus(Boolean(subject) && !prepared);
  const primary = prepared
    ? <Button variant="primary" disabled={!ready} onClick={() => flow.issueCard(prepared)}>{target.label}</Button>
    : <Button variant="primary" disabled={!ready || incomplete} onClick={prepare}>Prepare</Button>;
  const form = (
    <IssueForm entries={entries} refused={refused} withReason={first}
      onChange={(next) => { setEntries(next); setRefused(false); }} />
  );
  return (
    <Dialog size="md" title={`${target.label} · ${unit.label}`} onClose={onClose}
      footer={footer(flow, primary, onClose)}>
      {subject ? (
        <div ref={body} className={styles.body}>
          <UnitDecided unit={unit} floorLabel={floorLabel} subject={subject} gaps={sourceLabelGaps(building!.gaps)}
            withCode />
          {typeof subject === 'string' ? (
            <Banner tone="warning">The record does not state {subject}, so no card can be prepared.</Banner>
          ) : null}
          <Prepared flow={flow} first={first} sent={sent} form={form} />
        </div>
      ) : <UnitUnread error={unread} />}
    </Dialog>
  );
}
