import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { Icon } from './Icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger';
  icon?: PhosphorIcon;
  /** Icon-only button; `aria-label` becomes required in practice. */
  iconOnly?: boolean;
  children?: ReactNode;
}

export function Button({ variant = 'secondary', icon, iconOnly, className, children, type = 'button', ...rest }: ButtonProps) {
  const classes = ['ul-btn'];
  if (variant !== 'secondary') classes.push(`ul-btn--${variant}`);
  if (iconOnly) classes.push('ul-btn--icon');
  if (className) classes.push(className);
  return (
    <button type={type} className={classes.join(' ')} {...rest}>
      {icon ? <Icon icon={icon} /> : null}
      {iconOnly ? null : children}
    </button>
  );
}
