import type { ReactNode } from 'react';

export interface Fact {
  label: string;
  value: ReactNode;
  mono?: boolean;
}

/** Label and value rows; every sourced value carries its EvidenceChip inside `value`. */
export function DescriptionList({ items }: { items: Fact[] }) {
  return (
    <dl className="ul-dl">
      {items.map((item) => (
        <div key={item.label} className="ul-dl__row">
          <dt>{item.label}</dt>
          <dd className={item.mono ? 'ul-mono' : undefined}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
