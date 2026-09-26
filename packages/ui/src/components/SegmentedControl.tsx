/** Pill of 2–4 exclusive view options. Changes the view only, never data or selection. */
export function SegmentedControl<T extends string>({ options, value, onChange, label }: {
  options: readonly { value: T; label: string }[]; value: T; onChange: (value: T) => void; label: string;
}) {
  return (
    <div className="ul-seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}
