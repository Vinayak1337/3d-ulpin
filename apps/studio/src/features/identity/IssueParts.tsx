import { useId } from 'react';
import { DescriptionList, formatDateTime } from '@ulpin/ui';
import { EXPIRY_RULE, factText, inclusionError, type CardFact, type CardPreview } from './issue';
import type { Answered, Typed } from './prepare';
import styles from './Registry.module.css';

const INCLUSION_HELP = 'Required, at most 2,048 characters. The plan keeps this reason with the citation.';

/** What the officer types before Prepare. `validUntil` is a local date and time, as the input holds it. */
export interface IssueEntries { validUntil: string; inclusion: string }

/** `Valid until`, and for a first card the reason for including the citation. Nothing is filled in beforehand. */
export function IssueForm({ entries, refused, withReason, onChange }: {
  entries: IssueEntries; refused: boolean; withReason: boolean; onChange: (entries: IssueEntries) => void;
}) {
  const id = useId();
  const tooLong = entries.inclusion.trim() ? inclusionError(entries.inclusion) : null;
  return (
    <>
      <div className={styles.field}>
        <label className="ul-label" htmlFor={`${id}-until`}>Valid until (required)</label>
        <input id={`${id}-until`} type="datetime-local" className={`ul-input ${styles.until}`}
          value={entries.validUntil} aria-invalid={refused} aria-describedby={`${id}-rule`}
          onChange={(event) => onChange({ ...entries, validUntil: event.target.value })} />
        <span id={`${id}-rule`} className={refused ? 'ul-error' : 'ul-help'} role={refused ? 'alert' : undefined}>
          {EXPIRY_RULE}
        </span>
      </div>
      {withReason ? (
        <div className={styles.field}>
          <label className="ul-label" htmlFor={`${id}-why`}>Why this citation is included (required)</label>
          <textarea id={`${id}-why`} className={styles.text} value={entries.inclusion}
            aria-invalid={Boolean(tooLong)} aria-describedby={`${id}-why-help`}
            onChange={(event) => onChange({ ...entries, inclusion: event.target.value })} />
          <span id={`${id}-why-help`} className={tooLong ? 'ul-error' : 'ul-help'}>{tooLong ?? INCLUSION_HELP}</span>
        </div>
      ) : null}
    </>
  );
}

/** What was typed, as it was sent with Prepare: it cannot change while the rows below are the ones read. */
export function TypedFacts({ typed, withReason }: { typed: Typed; withReason: boolean }) {
  const why = <p className={styles.reason}>{typed.inclusionReason}</p>;
  return (
    <DescriptionList items={[
      { label: 'Valid until', value: formatDateTime(typed.expiresAt) },
      ...(withReason ? [{ label: 'Why this citation is included', value: why }] : []),
    ]} />
  );
}

/** The entry, the plan and the packet as the steps of Prepare answered them. */
export function AnsweredFacts({ answered }: { answered: Answered }) {
  const { entry, plan, packet } = answered;
  if (!entry && !plan && !packet) return null;
  const cited = entry?.citation;
  return (
    <div className={styles.answeredList} aria-label="Answered by the registry">
      {entry ? (
        <p className={styles.answered}>
          Entry {entry.label} · {cited ? `source ${cited.sourceId} revision ${cited.revision} · ${cited.locator}`
            : 'no citation answered'} · {entry.includable ? 'includable' : `not includable (${entry.reasonCode})`}
          {' · '}binding {entry.bindingId}
        </p>
      ) : null}
      {plan ? <p className={styles.answered}>Plan {plan.planId} · version {plan.version}</p> : null}
      {packet ? (
        <p className={styles.answered}>Packet {packet.packetId} · sha256 {packet.artifact.sha256}</p>
      ) : null}
    </div>
  );
}

function factRow(fact: CardFact) {
  const { value, note } = factText(fact);
  return {
    label: fact.label,
    value: note ? <span className={styles.fact}>{value}<span className={styles.note}>{note}</span></span> : value,
  };
}

/** The rows the card would state, in the answered order, with the mode and the revision the registry answered. */
export function PreviewFacts({ preview }: { preview: CardPreview }) {
  return (
    <section className={styles.body} aria-label="Rows of the card">
      <h3 className={styles.heading}>Rows of the card</h3>
      <DescriptionList items={[
        { label: 'Mode', value: <span className="ul-mono">{preview.mode}</span> },
        { label: 'Revision', value: preview.revision },
        { label: 'Valid until', value: formatDateTime(preview.expiresAt) },
      ]} />
      <DescriptionList items={preview.facts.map(factRow)} />
    </section>
  );
}
