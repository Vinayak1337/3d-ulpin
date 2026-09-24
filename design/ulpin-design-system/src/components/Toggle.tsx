import { useState } from 'react';

export interface ToggleProps {
  /** On or off (controlled). */
  checked?: boolean;
  /** Initial state when uncontrolled. */
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  /** Accessible name, e.g. the layer name. */
  'aria-label': string;
}

/**
 * A 36×20 on/off switch (`role="switch"`), used for layer visibility and redaction toggles.
 */
export function Toggle({ checked, defaultChecked = false, onChange, ...rest }: ToggleProps) {
  const [inner, setInner] = useState(defaultChecked);
  const on = checked ?? inner;
  const flip = () => {
    setInner(!on);
    onChange?.(!on);
  };
  return (
    <span
      className="ul-toggle"
      role="switch"
      tabIndex={0}
      aria-checked={on}
      aria-label={rest['aria-label']}
      onClick={flip}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          flip();
        }
      }}
    />
  );
}
