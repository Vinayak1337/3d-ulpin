import type { SVGProps } from 'react';
import { ICON_PATHS, type IconName } from '../icons.data';
import { cx } from '../cx';

export type { IconName };

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  /** Phosphor Regular icon name from the 3D ULPIN set. */
  name: IconName;
  /** `md` is 20px (Studio default), `sm` is 16px (dense cells, chips, small buttons). */
  size?: 'md' | 'sm';
  /** Accessible label. Omit for decorative icons next to a text label. */
  label?: string;
}

/**
 * A Phosphor Regular icon that inherits `currentColor`. Never the only label for an action.
 */
export function Icon({ name, size = 'md', label, className, ...rest }: IconProps) {
  return (
    <svg
      className={cx('ul-ico', size === 'sm' && 'ul-ico--sm', className)}
      viewBox="0 0 256 256"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...rest}
    >
      {ICON_PATHS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

/** Every icon name in the set, in alphabetical order. */
export const iconNames = Object.keys(ICON_PATHS) as IconName[];
