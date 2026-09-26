import type { WorkTarget } from '@ulpin/api-client/draft';

/** Where a work-board target leads in the Studio. */
export function targetHref(target: WorkTarget): string {
  switch (target.kind) {
    case 'add-files': return target.batchId ? `/studio/add-files?batch=${target.batchId}` : '/studio/add-files';
    case 'register': return `/studio/properties/${target.buildingId}/register`;
    case 'finding': return `/studio/areas/${target.areaId}?feature=${target.buildingId}&mode=findings&finding=${target.findingId}`;
    case 'review': return `/studio/review/${target.buildingId}?level=${target.levelId}`;
    case 'level': return `/studio/areas/${target.areaId}?feature=${target.buildingId}&mode=level&level=${target.levelId}`;
    case 'space': return `/studio/areas/${target.areaId}?feature=${target.buildingId}&mode=level&level=${target.levelId}&record=${target.spaceId}`;
  }
}

export type Stage = 'add_files' | 'review' | 'check' | 'recorded';
export const STAGES: { value: Stage; label: string; tone: 'neutral' | 'info' | 'warning' | 'success' }[] = [
  { value: 'add_files', label: 'Add files', tone: 'neutral' },
  { value: 'review', label: 'Review details', tone: 'info' },
  { value: 'check', label: 'Check and record', tone: 'warning' },
  { value: 'recorded', label: 'Recorded', tone: 'success' },
];
