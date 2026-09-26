/** 36 × 20 switch, always beside its visible label (same text as the accessible name). */
export function Toggle({ label, checked, onChange, disabled, hint }: {
  label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; hint?: string;
}) {
  return (
    <label className="ul-layer" style={disabled ? { opacity: 0.55 } : undefined}>
      <span className="ul-grow">
        {label}
        {hint ? <span className="ul-muted"> · {hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="ul-toggle"
        disabled={disabled}
        onClick={() => onChange(!checked)}
      />
    </label>
  );
}
