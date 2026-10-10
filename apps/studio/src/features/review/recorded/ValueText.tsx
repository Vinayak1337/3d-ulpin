import type { RecordedValue } from './model';

/** A value the record holds as plain text; a value it lacks as its state word in the Unknown style. */
export function ValueText({ value }: { value: RecordedValue }) {
  if (value.known) return <span>{value.text}</span>;
  return <em className="ul-unknown">{value.text}</em>;
}
