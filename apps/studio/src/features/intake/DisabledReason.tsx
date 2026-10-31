import type { ReactNode } from 'react';
import { Button } from '@ulpin/ui';

/** State beside a blocked control, with the action that clears it when one is available. */
export function DisabledReason({ id, children, action }: {
  id: string; children: ReactNode; action?: { label: string; press: () => void };
}) {
  return <p id={id} style={{ color: 'var(--ui-ink-soft)' }}>
    {children}{action ? <> <Button variant="ghost" onClick={action.press}
      style={{ color: 'var(--ui-primary)', textDecoration: 'underline' }}>{action.label}</Button></> : null}
  </p>;
}
