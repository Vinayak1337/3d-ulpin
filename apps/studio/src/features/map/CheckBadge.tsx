import type { BuildingLedger } from '@ulpin/api-client/draft';
import { StatusBadge } from '@ulpin/ui';

/** A check's outcome with the fixed status words. */
export function CheckBadge({ state }: { state: BuildingLedger['checks'][number]['state'] }) {
  if (state === 'blocking') return <span className="ul-badge ul-badge--danger">Blocking</span>;
  if (state === 'passed') return <span className="ul-badge ul-badge--success">Passed</span>;
  return <StatusBadge status={state === 'needs_review' ? 'Needs review' : 'Not assessed'} />;
}
