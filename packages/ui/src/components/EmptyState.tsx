import type { ReactNode } from 'react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { Icon } from './Icon';

export function EmptyState({ icon, title, children, action }: {
  icon: PhosphorIcon; title: string; children?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="ul-empty" role="status">
      <Icon icon={icon} size={32} className="ul-empty__icon" />
      <h2 className="ul-heading">{title}</h2>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}
