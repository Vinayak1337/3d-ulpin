import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx';
import { Icon, type IconName } from './Icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary` for the one next step on a screen; `soft` for an inline suggested action; `ghost` for cancel and quiet actions; `danger` for retire or cancel code. */
  variant?: 'default' | 'primary' | 'soft' | 'ghost' | 'danger';
  /** `md` is the 40px Studio control; `lg` is the 44px Portal touch target. */
  size?: 'md' | 'lg';
  /** Leading icon. */
  icon?: IconName;
  /** Icon-only square button; `aria-label` is required. */
  iconOnly?: boolean;
  children?: ReactNode;
}

/**
 * A button whose label says exactly what happens ("Record reviewed details", "Request evidence").
 */
export function Button({
  variant = 'default',
  size = 'md',
  icon,
  iconOnly,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'ul-btn',
        variant !== 'default' && `ul-btn--${variant}`,
        size === 'lg' && 'ul-btn--lg',
        iconOnly && 'ul-btn--icon',
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      {!iconOnly && children}
    </button>
  );
}
