import { CircleDashed } from '@phosphor-icons/react';
import type { NormalizedBuilding } from '@ulpin/contracts/canonical-scene';
import { Badge, StatusBadge } from '@ulpin/ui';

/** The record's state as the canonical record states it: a candidate proposal or a reviewed record. */
export function RecordState({ state }: { state: NormalizedBuilding['recordState'] }) {
  if (state === 'reviewed') return <StatusBadge status="Reviewed" />;
  return <Badge icon={CircleDashed}>Candidate</Badge>;
}
