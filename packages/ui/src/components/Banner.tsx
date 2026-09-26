import type { ReactNode } from 'react';
import { Info, Warning, WarningOctagon } from '@phosphor-icons/react';
import { Icon } from './Icon';

/** Floating status banner: what happened and what to do, with at most one action. */
export function Banner({ tone, children, action }: { tone: 'info' | 'warning' | 'danger'; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`ul-banner ul-banner--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon icon={tone === 'danger' ? WarningOctagon : tone === 'warning' ? Warning : Info} size={16} />
      <span className="ul-banner__text">{children}</span>
      {action}
    </div>
  );
}
