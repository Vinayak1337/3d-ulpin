import { Link } from 'react-router';
import { MapTrifold } from '@phosphor-icons/react';
import { EmptyState } from '@ulpin/ui';

export function NotFoundPage() {
  return (
    <div style={{ padding: 'var(--ui-space-6)' }}>
      <EmptyState icon={MapTrifold} title="This page does not exist" action={<Link to="/studio/work">Go to Batches</Link>}>
        Check the address, or start from Batches.
      </EmptyState>
    </div>
  );
}
