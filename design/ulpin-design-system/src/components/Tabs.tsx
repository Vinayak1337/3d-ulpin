import { useState } from 'react';

export interface TabsProps {
  /** Tab labels in order, e.g. Overview · Rights · Evidence · Checks · History. */
  tabs: string[];
  /** Selected tab (controlled). */
  value?: string;
  /** Initial tab when uncontrolled; defaults to the first. */
  defaultValue?: string;
  onChange?: (tab: string) => void;
}

/**
 * An underlined tab row for inspector and register sections. The selected tab is `primary`.
 */
export function Tabs({ tabs, value, defaultValue, onChange }: TabsProps) {
  const [inner, setInner] = useState(defaultValue ?? tabs[0]);
  const current = value ?? inner;
  return (
    <div className="ul-tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t}
          type="button"
          className="ul-tab"
          role="tab"
          aria-selected={t === current}
          onClick={() => {
            setInner(t);
            onChange?.(t);
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
