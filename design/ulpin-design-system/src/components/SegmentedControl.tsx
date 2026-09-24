import { useState, type CSSProperties } from 'react';
import { Icon, type IconName } from './Icon';

export interface SegmentedOption {
  value: string;
  label: string;
  icon?: IconName;
}

export interface SegmentedControlProps {
  /** 2 to 4 mutually exclusive view options. */
  options: SegmentedOption[];
  /** Selected value (controlled). */
  value?: string;
  /** Initial value when uncontrolled; defaults to the first option. */
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Names the group for screen readers, e.g. "View". */
  'aria-label': string;
  style?: CSSProperties;
  className?: string;
}

/**
 * A pill of 2 to 4 view options (2D/3D, Model/Volumes, Plan/Oblique/Section). Changes the view only.
 */
export function SegmentedControl({ options, value, defaultValue, onChange, style, className, ...rest }: SegmentedControlProps) {
  const [inner, setInner] = useState(defaultValue ?? options[0]?.value);
  const current = value ?? inner;
  return (
    <div className={['ul-seg', className].filter(Boolean).join(' ')} role="group" aria-label={rest['aria-label']} style={style}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === current}
          onClick={() => {
            setInner(o.value);
            onChange?.(o.value);
          }}
        >
          {o.icon && <Icon name={o.icon} size="sm" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}
