import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx';
import { Icon, type IconName } from './Icon';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

/** The fixed status vocabulary. Don't invent synonyms. */
export type StatusWord =
  | 'Draft'
  | 'Needs evidence'
  | 'Needs review'
  | 'Reviewed'
  | 'Recorded'
  | 'Assigned'
  | 'Retired'
  | 'Cancelled'
  | 'Unknown'
  | 'Not assessed'
  | 'Not comparable'
  | 'Test fixture'
  | 'Blocking'
  | 'Provisional'
  | 'Passed';

export const STATUS_STYLE: Record<StatusWord, { tone: BadgeTone; icon: IconName }> = {
  Draft: { tone: 'neutral', icon: 'file-text' },
  'Needs evidence': { tone: 'warning', icon: 'warning' },
  'Needs review': { tone: 'warning', icon: 'warning' },
  Reviewed: { tone: 'success', icon: 'check-circle' },
  Recorded: { tone: 'success', icon: 'check-circle' },
  Assigned: { tone: 'success', icon: 'shield-check' },
  Retired: { tone: 'neutral', icon: 'clock-counter-clockwise' },
  Cancelled: { tone: 'neutral', icon: 'eye-slash' },
  Unknown: { tone: 'neutral', icon: 'eye-slash' },
  'Not assessed': { tone: 'neutral', icon: 'info' },
  'Not comparable': { tone: 'neutral', icon: 'info' },
  'Test fixture': { tone: 'neutral', icon: 'info' },
  Blocking: { tone: 'danger', icon: 'warning-octagon' },
  Provisional: { tone: 'neutral', icon: 'clock-counter-clockwise' },
  Passed: { tone: 'success', icon: 'check-circle' },
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** A word from the fixed status vocabulary; sets tone, icon and label together. */
  status?: StatusWord;
  /** Colour role. `danger` only for blocking findings and failures; `warning` for needs review/evidence. */
  tone?: BadgeTone;
  /** Leading icon. Pass `null` for no icon (counts, basis labels). */
  icon?: IconName | null;
  /** Label; defaults to the status word. */
  children?: ReactNode;
}

/**
 * A pill-shaped status word with its icon. Colour never carries the meaning alone.
 */
export function Badge({ status, tone, icon, children, className, ...rest }: BadgeProps) {
  const preset = status ? STATUS_STYLE[status] : undefined;
  const t = tone ?? preset?.tone ?? 'neutral';
  const ic = icon === null ? null : icon ?? preset?.icon;
  return (
    <span className={cx('ul-badge', t !== 'neutral' && `ul-badge--${t}`, className)} {...rest}>
      {ic && <Icon name={ic} />}
      {children ?? status}
    </span>
  );
}
