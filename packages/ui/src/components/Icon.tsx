import type { Icon as PhosphorIcon } from '@phosphor-icons/react';

export interface IconProps {
  icon: PhosphorIcon;
  size?: 16 | 20 | 24 | 32 | 48;
  /** Accessible name; omit for decorative icons next to visible text. */
  label?: string;
  className?: string;
}

/** The one icon wrapper: Phosphor Regular weight only. */
export function Icon({ icon: Glyph, size = 20, label, className }: IconProps) {
  return (
    <Glyph
      size={size}
      weight="regular"
      className={className ? `ul-ico ${className}` : 'ul-ico'}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  );
}
