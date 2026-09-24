import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { Icon } from './Icon';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'children'> {
  /** Label above the input. Units go in the label: "Lower limit (m, SD-1)". Never use the placeholder as the label. */
  label: string;
  /** Helper text below the input. */
  help?: ReactNode;
  /** Error text: what happened and the fix. Sets `aria-invalid`. */
  error?: ReactNode;
}

/**
 * A labelled text input: label above, helper below, error below that.
 */
export function Field({ label, help, error, id, ...rest }: FieldProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className="ul-field">
      <label className="ul-label" htmlFor={fid}>
        {label}
      </label>
      <input className="ul-input" id={fid} aria-invalid={error ? true : undefined} {...rest} />
      {help && !error && <span className="ul-help">{help}</span>}
      {error && (
        <span className="ul-error">
          <Icon name="warning-octagon" size="sm" />
          {error}
        </span>
      )}
    </div>
  );
}
