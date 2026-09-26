export function FilterChip({ label, count, pressed, onToggle }: {
  label: string; count?: number; pressed: boolean; onToggle: () => void;
}) {
  return (
    <button type="button" className="ul-chip" aria-pressed={pressed} onClick={onToggle}>
      {label}
      {count === undefined ? null : <span className="ul-chip__count">{formatCount(count)}</span>}
    </button>
  );
}

/** Indian digit grouping for counts (design system content rules). */
export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}
