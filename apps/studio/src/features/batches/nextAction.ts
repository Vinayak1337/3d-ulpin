import type { WorkItem } from '../../api/queries';
import { isProcessing } from '../../api/queries';

export interface NextAction {
  label: string;
  /** Route in the Studio, or null when the action waits on the system. */
  href: string | null;
  tone: 'primary' | 'neutral' | 'warning' | 'danger';
}

/**
 * GOAL override 7 and 8: the next action drives the flow and implies the stage, so Batches shows
 * no stage badge. Derived only from the recorded work-item fields.
 */
export function nextAction(item: WorkItem): NextAction {
  if (isProcessing(item.jobStatus)) return { label: 'Processing', href: null, tone: 'neutral' };
  if (item.jobStatus === 'failed') return { label: 'Review failed step', href: itemHref(item), tone: 'danger' };

  if (item.kind === 'dataset') return { label: 'Open dataset', href: `/studio/datasets/${item.id}`, tone: 'neutral' };

  if (item.kind === 'import') {
    switch (item.state) {
      case 'NEEDS_INPUT': return { label: 'Answer questions', href: itemHref(item), tone: 'warning' };
      case 'READY_FOR_REVIEW': return { label: 'Review details', href: itemHref(item), tone: 'primary' };
      case 'REVIEWED': return { label: 'Record reviewed details', href: itemHref(item), tone: 'primary' };
      case 'COMMITTED': return { label: 'Open map', href: item.areaId ? `/studio/areas/${item.areaId}` : null, tone: 'neutral' };
      default: return { label: 'Open import', href: itemHref(item), tone: 'neutral' };
    }
  }

  // kind === 'case'
  if (item.currentRecorded && item.buildingId) {
    return { label: 'Open register', href: `/studio/properties/${item.buildingId}/register`, tone: 'neutral' };
  }
  if (item.recordedHistory && item.buildingId) return { label: 'Review changes', href: itemHref(item), tone: 'warning' };
  if (item.buildingId) return { label: 'Review details', href: itemHref(item), tone: 'primary' };
  return { label: 'Continue import', href: itemHref(item), tone: 'primary' };
}

function itemHref(item: WorkItem): string {
  if (item.kind === 'dataset') return `/studio/datasets/${item.id}`;
  if (item.kind === 'import') return item.areaId ? `/studio/areas/${item.areaId}?package=${item.id}` : `/studio/work?item=${item.id}`;
  return `/studio/cases/${item.id}`;
}

export function classificationLabel(item: WorkItem): string {
  const { classification } = item.provenance;
  return classification === 'unknown'
    ? 'Unknown source classification'
    : `${classification[0]!.toUpperCase()}${classification.slice(1)} source`;
}
