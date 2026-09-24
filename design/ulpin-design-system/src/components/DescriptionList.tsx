import type { ReactNode } from 'react';

export interface DescriptionItem {
  /** Muted term on the left, e.g. "Carpet area". */
  label: ReactNode;
  /** Value on the right; may include EvidenceChips and Badges inline. */
  value: ReactNode;
  /** Render the value in the mono face (codes, parcel ULPINs). */
  mono?: boolean;
}

export interface DescriptionListProps {
  items: DescriptionItem[];
}

/**
 * Label/value fact rows (`ul-dl`) for the inspector, checks and the Property Card.
 */
export function DescriptionList({ items }: DescriptionListProps) {
  return (
    <dl className="ul-dl">
      {items.map((it, i) => (
        <Row key={i} {...it} />
      ))}
    </dl>
  );
}

function Row({ label, value, mono }: DescriptionItem) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={mono ? 'ul-mono' : undefined}>{value}</dd>
    </>
  );
}
