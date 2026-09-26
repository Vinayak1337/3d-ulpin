import { Link } from 'react-router';
import { Hammer } from '@phosphor-icons/react';
import { EmptyState } from '@ulpin/ui';

/** Routes kept for saved links whose screens are not rebuilt yet (docs/frontend/PLAN.md). */
export function PlannedPage({ title, milestone }: { title: string; milestone: string }) {
  return (
    <div style={{ padding: 'var(--ui-space-6)' }}>
      <EmptyState icon={Hammer} title={`${title} is being rebuilt`} action={<Link to="/studio/work">Back to Batches</Link>}>
        This screen arrives in milestone {milestone} of the Studio rebuild. Saved links to it keep working.
      </EmptyState>
    </div>
  );
}
