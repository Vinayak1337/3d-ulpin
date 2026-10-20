import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Button, Dialog } from '@ulpin/ui';
import { ArtefactLinks } from '../../intake/run/ArtefactLinks';
import { failureWords, readTargetByFeature } from '../../intake/run/api';
import { cardsOnlyWords, readinessLabels, readinessWords, stageWords, type Target } from '../../intake/run/model';
import { useConfirmationCommand } from '../../intake/run/useConfirmationCommand';
import { useRunStream } from '../../intake/run/useRunStream';
import { batchPath, cardState, followCard } from './cardState';
import styles from './Inspector.module.css';

export const buildingTargetKey = (featureId: string, packageId?: string) =>
  ['intake-target-by-feature', featureId, packageId ?? ''];

/**
 * The property card of a building picked on the map, read from the intake target that names it: a recorded
 * building with no card is carded by one cards-only confirmation in the officer's own words, and the run is
 * followed to its card. A building no target names shows nothing.
 */
export function BuildingCard({ featureId, packageId, name }: {
  featureId: string; packageId?: string; name: string;
}) {
  const read = useQuery({ queryKey: buildingTargetKey(featureId, packageId), retry: false,
    queryFn: () => readTargetByFeature(featureId, packageId) });
  if (read.error) {
    return <p className={styles.note}>The batch of this building could not be read. {failureWords(read.error)}</p>;
  }
  if (!read.data) return null;
  return <TargetCard key={read.data.targetId} target={read.data} name={name}
    refetch={() => void read.refetch()} />;
}

export function TargetCard({ target, name, refetch }: { target: Target; name: string; refetch: () => void }) {
  const state = cardState(target);
  const watched = useRef(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const next = followCard(watched.current, state);
    watched.current = next.watched;
    if (next.open) setOpen(true);
  }, [state]);
  const pressed = () => {
    watched.current = true;
    refetch();
  };
  return <section className={styles.cardSection} aria-label="Property card">
    <h3 className={styles.sectionTitle}>Property card</h3>
    {state === 'make' ? <MakeCard target={target} stored={pressed} moved={refetch} /> : null}
    {state === 'making' ? <MakingCard target={target} refetch={refetch} /> : null}
    {state === 'carded' ? <span className={styles.actions}>
      <Button onClick={() => setOpen(true)}>Open the property card</Button>
    </span> : null}
    {state === 'other' ? <BatchStanding target={target} /> : null}
    {open ? <BuildingCardDialog target={target} name={name} onClose={() => setOpen(false)} /> : null}
  </section>;
}

/** The batch page's cards-only confirmation for this one building: its words, a typed acknowledgement, one press. */
function MakeCard({ target, stored, moved }: { target: Target; stored: () => void; moved: () => void }) {
  const helpId = useId();
  const [acknowledgement, setAcknowledgement] = useState('');
  const command = useConfirmationCommand(target.caseId, stored, moved);
  const locked = command.busy || command.uncertain;
  const allowed = acknowledgement.trim().length > 0;
  return <>
    <p>{cardsOnlyWords(1)}</p>
    <p>If a building stops, completed steps are kept. A card proves what the record cites, not ownership or a
      right. Buildings do not receive a space identity.</p>
    <label className={styles.field}>Your acknowledgement
      <textarea rows={3} maxLength={500} value={acknowledgement} disabled={locked} aria-describedby={helpId}
        onChange={event => setAcknowledgement(event.target.value)} />
    </label>
    <p id={helpId} className="ul-help">Type your own words. They will be stored exactly as you type them.</p>
    {command.error ? <p role="alert">{command.error}</p> : null}
    {command.uncertain ? <p>The outcome is not known. Send the same confirmation again to find or store it;
      the building and your words stay unchanged.</p> : null}
    <span className={styles.actions}>
      <Button disabled={command.busy || (!command.uncertain && !allowed)}
        onClick={() => void command.pressCards([target], acknowledgement)}>
        {command.busy ? 'Storing confirmation…' : command.uncertain ? 'Send same confirmation again'
          : 'Make the property card'}
      </Button>
    </span>
    {!allowed && !command.uncertain ? <p className="ul-help">Type your acknowledgement before confirming.</p> : null}
  </>;
}

/** A building listed in a confirmation: its step and words, refreshed by the case's one subscription. */
function MakingCard({ target, refetch }: { target: Target; refetch: () => void }) {
  useRunStream(target.caseId, [target], refetch);
  return <>
    <p role="status">{target.reason ?? readinessWords[target.readiness]}</p>
    <p className={styles.note}>{target.locator} · {stageWords[target.stage]}</p>
    <Link to={batchPath(target.caseId)}>Open batch</Link>
  </>;
}

/** A building that is not recorded with no card: where it stands in its batch, and the batch. */
function BatchStanding({ target }: { target: Target }) {
  return <>
    <p><b>{readinessLabels[target.readiness]}.</b> {readinessWords[target.readiness]}</p>
    {target.reason ? <p className={styles.note}>{target.reason}</p> : null}
    <Link to={batchPath(target.caseId)}>Open batch</Link>
  </>;
}

/** The card the run made: its PDF, its verification and the record it cites. */
export function BuildingCardDialog({ target, name, onClose }: { target: Target; name: string; onClose: () => void }) {
  return <Dialog title={`Property card · ${name}`} size="md" onClose={onClose}
    footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
    <p>{readinessWords[target.readiness]} A card proves what the record cites, not ownership or a right.</p>
    <ArtefactLinks target={target} />
  </Dialog>;
}
