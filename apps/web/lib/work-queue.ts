export type WorkItem = {
  id: string; kind: 'case' | 'import' | 'dataset'; name: string; areaId: string | null;
  areaName: string | null; dataKind: string | null; buildingId: string | null;
  sourceCount: number; updatedAt: string; state: string | null; jobStatus: string | null;
  recordedHistory: boolean; currentRecorded?: boolean;
};
export type WorkQueueResult = {items: WorkItem[]; total: number; page: number; pageSize: number};
export function workItemAction(item: WorkItem) {
  if (item.kind === 'dataset' && item.jobStatus) return {label:item.jobStatus==='succeeded'?'Review extraction':'View processing',status:item.jobStatus==='failed'?'Needs attention':item.jobStatus==='succeeded'?'ML candidates · needs review':'Processing',href:`/studio/processing/${item.id}`};
  if (item.kind === 'dataset') return {label:'Open saved map',status:'Saved · needs review',href:`/studio/showcase?saved=${item.id}`};
  if (item.kind === 'import') return item.state === 'COMMITTED'
    ? {label: 'Open map', status: 'Recorded', href: `/studio/areas/${item.areaId}`}
    : {label: 'Review boundaries', status: 'Needs review', href: `/studio/imports/${item.id}`};
  const href = `/studio/cases/${item.id}?mode=build${item.areaId ? `&area=${item.areaId}` : ''}`;
  if (['queued','running','dispatched','retrying'].includes(item.jobStatus || '')) return {label: 'View progress', status: 'Processing', href};
  if (item.jobStatus === 'failed') return {label: 'Review processing issue', status: 'Needs attention', href};
  if (item.currentRecorded && item.buildingId) return {label: 'Open recorded details', status: 'Recorded', href: `/studio/properties/${item.buildingId}/register${item.areaId ? `?area=${item.areaId}` : ''}`};
  if (!item.sourceCount) return {label: 'Add files', status: 'No files yet', href: `/studio/add-files?case=${item.id}${item.areaId ? `&area=${item.areaId}` : ''}${item.buildingId ? `&building=${item.buildingId}` : ''}`};
  return {label: 'Review details', status: 'Needs review', href};
}
