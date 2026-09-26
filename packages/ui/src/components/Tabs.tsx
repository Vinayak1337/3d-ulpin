import { useId, type KeyboardEvent } from 'react';

/** Underlined tabs; arrow keys move between them (WAI-ARIA tabs pattern, automatic activation). */
export function Tabs<T extends string>({ tabs, value, onChange, label }: {
  tabs: readonly { value: T; label: string; count?: number }[]; value: T; onChange: (value: T) => void; label: string;
}) {
  const id = useId();
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.value === value);
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = tabs[(index + delta + tabs.length) % tabs.length]!;
    onChange(next.value);
    document.getElementById(`${id}-${next.value}`)?.focus();
  };
  return (
    <div className="ul-tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          id={`${id}-${tab.value}`}
          type="button"
          role="tab"
          className="ul-tab"
          aria-selected={tab.value === value}
          tabIndex={tab.value === value ? 0 : -1}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {tab.count === undefined ? null : <span className="ul-tab__count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}
